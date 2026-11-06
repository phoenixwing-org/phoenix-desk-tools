import fs from "node:fs";
import path from "node:path";
import {
  pnwExtractEmbeddedBomFieldsFromDocumentXml,
  pnwPatchEmbeddedBomFieldsInDocumentXml,
  type PnwCadEmbeddedBomFields,
} from "@phoenix-wing/cad-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { reconcileFcstdPropertyCounts } from "./fcstdPropertyCounts.js";
import { isFcstdObjectName, xmlAttribute } from "./fcstdLinkIdentity.js";
import { fcstdBomSelectionXml } from "./fcstdBomSelection.js";

export type FcstdEmbeddedBomWriteResult = {
  changed: boolean;
  objectName: string;
};

const FREECAD_DYNAMIC_STRING_PROPERTY_META: Record<string, { group: string; doc: string }> = {
  PartNumber: { group: "CustomDefine", doc: "零件号" },
  PartVersion: { group: "CustomDefine", doc: "零件版本" },
  TypeCode: { group: "CustomDefine", doc: "类型码 (H/S/R)" },
  ModelSeries: { group: "CustomDefine", doc: "型号系列" },
  PartName: { group: "CustomDefine", doc: "零件名称" },
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function objectBlock(xml: string, objectName: string): { start: number; text: string } | null {
  // Modern FCStd keeps self-closing declarations in Objects and the actual
  // property containers in ObjectData. Never start a span at a declaration.
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => " ".repeat(text.length));
  const data = /<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/i.exec(semantic);
  const offset = data?.index != null ? data.index + data[0].indexOf(">") + 1 : 0;
  const objectPattern = /<Object\b([^>]*?)(?<!\/)>([\s\S]*?)<\/Object>/gi;
  for (const match of (data?.[1] ?? semantic).matchAll(objectPattern)) {
    if (match.index == null) continue;
    if (xmlAttribute(match[1], "name") === objectName) {
      const start = offset + match.index;
      return { start, text: xml.slice(start, start + match[0].length) };
    }
  }
  return null;
}

/** Read the saved TypeId, never the temporary App::Part selection probe. */
function savedObjectTypeId(xml: string, objectName: string): string {
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => " ".repeat(text.length));
  const declarations = /<Objects\b[^>]*>([\s\S]*?)<\/Objects>/i.exec(semantic)?.[1] || "";
  const types = new Set<string>();
  for (const [tag] of declarations.matchAll(/<Object\b[^>]*>/gi)) {
    if (xmlAttribute(tag, "name") === objectName && xmlAttribute(tag, "type")) types.add(xmlAttribute(tag, "type"));
  }
  const opening = objectBlock(semantic, objectName)?.text.match(/^<Object\b[^>]*>/i)?.[0];
  if (opening && xmlAttribute(opening, "type")) types.add(xmlAttribute(opening, "type"));
  // Unknown or conflicting type declarations cannot justify a default-name exception.
  return types.size === 1 ? [...types][0] : "";
}

function propertyOpeningMatch(block: string, propertyName: string): RegExpExecArray | null {
  const pattern = new RegExp(`<Property\\b[^>]*\\bname\\s*=\\s*(["'])${escapeRegExp(propertyName)}\\1[^>]*>`, "i");
  const semantic = block.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => " ".repeat(text.length));
  return pattern.exec(semantic);
}

function propertyOpening(block: string, propertyName: string): string | null {
  return propertyOpeningMatch(block, propertyName)?.[0] || null;
}

function ensureOpeningAttribute(opening: string, name: string, value: string): string {
  if (new RegExp(`\\b${escapeRegExp(name)}\\s*=`, "i").test(opening)) return opening;
  const encoded = value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return opening.replace(/>$/, ` ${name}="${encoded}">`);
}

/**
 * Wing 0.6.3 owns root-object selection and value patching, but its compact
 * replacement drops dynamic-property metadata and does not update Properties
 * Count when inserting fields. Restore both serialization invariants so FreeCAD
 * loads all fields and keeps them after save/reopen. Remove this compatibility
 * layer once the public Wing writer preserves them.
 */
function restoreFreeCadPropertyMetadata(
  originalXml: string,
  patchedXml: string,
  objectName: string,
  fields: Partial<PnwCadEmbeddedBomFields>,
): string {
  const original = objectBlock(originalXml, objectName);
  const patched = objectBlock(patchedXml, objectName);
  if (!patched) return patchedXml;
  let nextBlock = patched.text;
  for (const propertyName of Object.keys(fields).map(key => key === "label" ? "Label" : key)) {
    const match = propertyOpeningMatch(nextBlock, propertyName);
    if (!match) continue;
    const patchedOpening = match[0];
    const originalOpening = original ? propertyOpening(original.text, propertyName) : null;
    let replacement = originalOpening || patchedOpening;
    const meta = FREECAD_DYNAMIC_STRING_PROPERTY_META[propertyName];
    if (meta) {
      replacement = ensureOpeningAttribute(replacement, "group", meta.group);
      replacement = ensureOpeningAttribute(replacement, "doc", meta.doc);
      replacement = ensureOpeningAttribute(replacement, "attr", "0");
      replacement = ensureOpeningAttribute(replacement, "ro", "0");
      replacement = ensureOpeningAttribute(replacement, "hide", "0");
      replacement = ensureOpeningAttribute(replacement, "status", "2097152");
    }
    nextBlock = nextBlock.slice(0, match.index) + replacement + nextBlock.slice(match.index + patchedOpening.length);
  }
  return patchedXml.slice(0, patched.start)
    + nextBlock
    + patchedXml.slice(patched.start + patched.text.length);
}

/** 写临时文件、保留原件作短暂备份，再原子替换；失败时恢复原件。 */
export function replaceFileAtomically(filename: string, bytes: Uint8Array): void {
  const token = `${process.pid}-${Date.now()}`;
  const dir = path.dirname(filename);
  const base = path.basename(filename);
  const temp = path.join(dir, `.${base}.phoenix-${token}.tmp`);
  const backup = path.join(dir, `.${base}.phoenix-${token}.backup`);
  fs.writeFileSync(temp, bytes);
  try {
    fs.renameSync(filename, backup);
    try {
      fs.renameSync(temp, filename);
    } catch (error) {
      fs.renameSync(backup, filename);
      throw error;
    }
    fs.rmSync(backup, { force: true });
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** Node adapter：只解压 Document.xml，领域字段解析由 Wing cad-core 唯一负责。 */
export function extractDocumentXmlFromFcstdBytes(raw: Uint8Array): string | null {
  try {
    const files = unzipSync(raw, {
      filter: (file) => file.name.replace(/\\/g, "/") === "Document.xml",
    });
    const bytes = files["Document.xml"];
    return bytes ? strFromU8(bytes) : null;
  } catch {
    return null;
  }
}

export function readFcstdDocumentXml(filePath: string): string | null {
  try {
    return extractDocumentXmlFromFcstdBytes(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

export async function readFcstdDocumentXmlAsync(filePath: string): Promise<string | null> {
  try {
    return extractDocumentXmlFromFcstdBytes(await fs.promises.readFile(filePath));
  } catch {
    return null;
  }
}

export function readFcstdEmbeddedBomFields(filePath: string): PnwCadEmbeddedBomFields | null {
  const xml = readFcstdDocumentXml(filePath);
  return xml ? extractFcstdEmbeddedBomSnapshot(xml).fields : null;
}

/** Keep explicitly empty properties distinct from absent ones when merging UI hints. */
export function extractFcstdEmbeddedBomSnapshot(xml: string) {
  const selection = fcstdBomSelectionXml(xml);
  const fields = pnwExtractEmbeddedBomFieldsFromDocumentXml(selection.xml);
  const selected = pnwPatchEmbeddedBomFieldsInDocumentXml(selection.xml, {});
  const block = selected ? objectBlock(selection.xml, selected.objectName) : null;
  const present = new Set<keyof PnwCadEmbeddedBomFields>();
  if (fields && block) for (const key of [...Object.keys(FREECAD_DYNAMIC_STRING_PROPERTY_META), "label"] as (keyof PnwCadEmbeddedBomFields)[]) {
    const propertyName = key === "label" ? "Label" : key;
    if (!propertyOpening(block.text, propertyName)) continue;
    present.add(key);
    // Wing's display-label fallback to the object name must not undo an explicit clear.
    if (key === "label") {
      const property = new RegExp(`<Property\\b[^>]*\\bname\\s*=\\s*(["'])Label\\1[^>]*>([\\s\\S]*?)<\\/Property>`, "i").exec(block.text);
      const stringTag = property?.[2].match(/<String\b[^>]*>/i)?.[0];
      fields.label = "";
      if (stringTag && /\bvalue\s*=/.test(stringTag)) fields.label = xmlAttribute(stringTag, "value");
      else if (stringTag) {
        const text = /<String\b[^>]*>([^<]*)<\/String>/i.exec(property?.[2] || "")?.[1] || "";
        fields.label = xmlAttribute(`value="${text.replaceAll('"', "&quot;")}"`, "value").trim();
      }
    }
  }
  // A missing Label is not an existing business name. Wing's internal-name
  // display fallback must not outrank a valid filename recommendation.
  if (fields && !present.has("label")) fields.label = "";
  return { fields, present, objectName: selected?.objectName || "", typeId: selected ? savedObjectTypeId(xml, selected.objectName) : "" };
}

export async function readFcstdEmbeddedBomFieldsAsync(
  filePath: string,
): Promise<PnwCadEmbeddedBomFields | null> {
  const xml = await readFcstdDocumentXmlAsync(filePath);
  return xml ? extractFcstdEmbeddedBomSnapshot(xml).fields : null;
}

/** Wing 负责根 BOM 对象与字段补丁；Node 负责 ZIP/I/O 及旧版序列化兼容。 */
export function patchFcstdEmbeddedBomDocumentXml(originalXml: string, fields: Partial<PnwCadEmbeddedBomFields>) {
  const selection = fcstdBomSelectionXml(originalXml);
  const target = pnwPatchEmbeddedBomFieldsInDocumentXml(selection.xml, {});
  if (!target || !isFcstdObjectName(target.objectName)) throw new Error("未找到可写的 BOM 根对象");
  const originalBlock = objectBlock(originalXml, target.objectName);
  if (!originalBlock) throw new Error("根对象属性容器不可读，未改写文件");
  // Keep comments/CDATA byte-for-byte without letting example Property/Object
  // text inside them participate in Wing's compact field matcher.
  let marker = "PNW_BOM_OPAQUE_";
  while (originalBlock.text.includes(marker)) marker += "_";
  const opaque: string[] = [];
  const protectedBlock = originalBlock.text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => `<!--${marker}${opaque.push(text) - 1}-->`);
  // The declaration is a temporary single-target scope, not a new Part node.
  const scopedXml = `<Document><Objects><Object name="${target.objectName}" type="App::Part"/></Objects><ObjectData>${protectedBlock}</ObjectData></Document>`;
  const result = pnwPatchEmbeddedBomFieldsInDocumentXml(scopedXml, fields);
  if (!result || result.objectName !== target.objectName) throw new Error("属性写入目标不一致，未改写文件");
  const patchedBlock = objectBlock(result.xml, result.objectName);
  if (!patchedBlock) throw new Error("根对象属性容器不可读，未改写文件");
  // A shared whole-property rewrite cannot preserve opaque content *inside*
  // an edited field. Refuse that exceptional layout instead of losing data.
  if (opaque.some((_, index) => !patchedBlock.text.includes(`<!--${marker}${index}-->`))) {
    throw new Error("待写属性内部含注释或 CDATA，无法安全保留该特殊结构；本次未修改文件，请确认该属性");
  }
  const restoredBlock = patchedBlock.text.replace(new RegExp(`<!--${marker}(\\d+)-->`, "g"), (_, index) => opaque[Number(index)]);
  // Never persist a selection probe: it may omit/mask unrelated objects.
  const patchedXml = originalXml.slice(0, originalBlock.start) + restoredBlock + originalXml.slice(originalBlock.start + originalBlock.text.length);
  const restoredXml = restoreFreeCadPropertyMetadata(originalXml, patchedXml, result.objectName, fields);
  const xml = reconcileFcstdPropertyCounts(restoredXml, result.objectName).xml;
  return { xml, changed: xml !== originalXml, objectName: result.objectName };
}

/** Batch-only exemption for source geometry consumed by the selected Body.
 * A Part::Feature or Part::FeaturePython referenced through Body/FeatureBase.BaseFeature is not
 * a second independent part. Do not infer this from names, visibility, Tip,
 * arbitrary dependencies or general links; Wing still selects the write target. */
function batchImportedBaseSources(xml: string, selectedName: string): Set<string> {
  const semanticXml = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const attr = xmlAttribute;
  const types = new Map<string, string>();
  const declarations = /<Objects\b[^>]*>([\s\S]*?)<\/Objects>/i.exec(semanticXml)?.[1] || "";
  for (const [tag] of declarations.matchAll(/<Object\b[^>]*>/g)) types.set(attr(tag, "name"), attr(tag, "type"));
  const data = /<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/i.exec(semanticXml)?.[1] || "";
  const blocks = new Map<string, string>();
  for (const match of data.matchAll(/<Object\b([^>]*)>([\s\S]*?)<\/Object>/g)) {
    const name = attr(match[1], "name"); blocks.set(name, match[2]);
    if (attr(match[1], "type")) types.set(name, attr(match[1], "type"));
  }
  const hasBom = (name: string) => Object.keys(FREECAD_DYNAMIC_STRING_PROPERTY_META).some(field => propertyOpening(blocks.get(name) || "", field));
  const groups = new Map<string, string[]>();
  for (const [name, block] of blocks) for (const property of block.matchAll(/<Property\b([^>]*)>([\s\S]*?)<\/Property>/g)) {
    if (attr(property[1], "name") === "Group" && attr(property[1], "type") === "App::PropertyLinkList") {
      groups.set(name, [...property[2].matchAll(/<Link\b[^>]*>/g)].map(([tag]) => attr(tag, "value") || attr(tag, "name")));
    }
  }
  const sources = new Set<string>(); const visited = new Set<string>(); const owned = [selectedName];
  const isSourceShape = (name: string) => ["Part::Feature", "Part::FeaturePython"].includes(types.get(name) || "");
  while (owned.length) {
    const name = owned.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const type = types.get(name);
    if (!["PartDesign::Body", "PartDesign::FeatureBase", "App::Part", "App::LinkGroup"].includes(type || "") && !type?.includes("Assembly")) continue;
    for (const property of (blocks.get(name) || "").matchAll(/<Property\b([^>]*)>([\s\S]*?)<\/Property>/g)) {
      const key = attr(property[1], "name"); const propertyType = attr(property[1], "type");
      const links = [...property[2].matchAll(/<Link\b[^>]*>/g)].map(([tag]) => attr(tag, "value") || attr(tag, "name"));
      if (key === "Group" && propertyType === "App::PropertyLinkList") owned.push(...links);
      if (key !== "BaseFeature" || propertyType !== "App::PropertyLink" || !["PartDesign::Body", "PartDesign::FeatureBase"].includes(type || "")) continue;
      for (const source of links) {
        if (!isSourceShape(source) || !blocks.has(source)) continue;
        // Explicit BOM properties on the source require a human decision.
        if (hasBom(source)) continue;
        sources.add(source);
      }
    }
  }
  // STEP imports can wrap several raw shapes in App::Part. If this pure,
  // unannotated geometry container owns a proven BaseFeature source, it belongs
  // to that import, not to another independently attributed part. Preserve its
  // Group links in the probe so sibling imported shapes remain owned by it.
  function geometryMembers(name: string, visiting = new Set<string>()): string[] | null {
    if (!blocks.has(name) || hasBom(name) || visiting.has(name)) return null;
    if (isSourceShape(name)) return [name];
    if (types.get(name) !== "App::Part" || !groups.get(name)?.length) return null;
    const next = new Set(visiting).add(name); const members: string[] = [];
    for (const child of groups.get(name)!) {
      const shapes = geometryMembers(child, next);
      if (!shapes) return null;
      members.push(...shapes);
    }
    return members;
  }
  for (const [name, type] of types) {
    if (type !== "App::Part" || name === selectedName) continue;
    const members = geometryMembers(name);
    if (members?.some(member => sources.has(member))) sources.add(name);
  }
  return sources;
}

export class FcstdBatchTargetAmbiguityError extends Error {
  constructor(readonly objectName: string, readonly current: PnwCadEmbeddedBomFields, otherName: string) {
    super(`检测到多个独立属性对象：候选 ${objectName}，另有 ${otherName}。无法安全批量选择，本次跳过；请在文件详情确认写入对象。`);
    this.name = "FcstdBatchTargetAmbiguityError";
  }
}

/** Let Wing choose the root, then test for a second independent root. Preserve
 * Group links and exclude only proven, unannotated BaseFeature sources. */
export function inspectFcstdBatchTarget(xml: string) {
  // Joint containers/constraints are assembly infrastructure, never BOM roots.
  // Match serialized types, not the user-editable name "Joints". This is a
  // read-only selection probe: retain all real objects and constraints on write.
  const selection = fcstdBomSelectionXml(xml);
  const selectionXml = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => " ".repeat(text.length)).replace(/<Object\b[^>]*>/g, tag => tag.replace(
    /\btype\s*=\s*(["'])Assembly::(?:JointGroup|Joint)\1/, 'type="App::Feature"',
  ));
  const root = pnwPatchEmbeddedBomFieldsInDocumentXml(selection.xml, {});
  const snapshot = extractFcstdEmbeddedBomSnapshot(xml);
  const current = snapshot.fields;
  if (!root || !current || !isFcstdObjectName(root.objectName)) throw new Error("没有明确可写的根对象，请在文件详情检查");
  const excluded = batchImportedBaseSources(xml, root.objectName); excluded.add(root.objectName);
  const withoutRootType = selectionXml.replace(/<Object\b[^>]*>/g, tag => {
    const name = xmlAttribute(tag, "name");
    // The document's unique native assembly is the explicit write target.
    // Sibling Bodies remain untouched; this is not an ownership inference.
    if (selection.nativeAssembly && /\btype\s*=\s*(["'])PartDesign::Body\1/.test(tag)) return tag.replace(/\btype\s*=\s*(["'])[\s\S]*?\1/, 'type="App::Feature"');
    if (!name || !excluded.has(name)) return tag;
    if (/\btype\s*=/.test(tag)) return tag.replace(/\btype\s*=\s*(["'])[\s\S]*?\1/, 'type="App::Feature"');
    return tag.replace(/(\/?>)$/, ' type="App::Feature"$1');
  });
  const other = pnwPatchEmbeddedBomFieldsInDocumentXml(withoutRootType, {});
  if (other) throw new FcstdBatchTargetAmbiguityError(root.objectName, current, other.objectName);
  const block = objectBlock(xml, root.objectName);
  if (!block) throw new Error("根对象属性容器不可读");
  const types: Record<string, string> = {};
  for (const key of [...Object.keys(FREECAD_DYNAMIC_STRING_PROPERTY_META), "Label"]) {
    const opening = propertyOpening(block.text, key);
    if (opening) types[key] = /\btype\s*=\s*(["'])(.*?)\1/.exec(opening)?.[2] || "unknown";
  }
  return { objectName: root.objectName, typeId: snapshot.typeId, current, types };
}

export function writeFcstdEmbeddedBomFields(
  filePath: string,
  fields: Partial<PnwCadEmbeddedBomFields>,
): FcstdEmbeddedBomWriteResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(fs.readFileSync(filePath)));
  } catch (error: any) {
    throw new Error(`Invalid FCStd/ZIP: ${filePath} (${error.message || error})`);
  }
  const documentBytes = files["Document.xml"];
  if (!documentBytes) throw new Error(`Document.xml is missing from ${filePath}`);
  const originalXml = strFromU8(documentBytes);
  const result = patchFcstdEmbeddedBomDocumentXml(originalXml, fields);
  const changed = result.changed;
  if (changed) {
    files["Document.xml"] = strToU8(result.xml);
    replaceFileAtomically(filePath, zipSync(files, { level: 6 }));
  }
  return { changed, objectName: result.objectName };
}
