import fs from "node:fs";
import path from "node:path";
import {
  pnwExtractEmbeddedBomFieldsFromDocumentXml,
  pnwPatchEmbeddedBomFieldsInDocumentXml,
  type PnwCadEmbeddedBomFields,
} from "@phoenix-wing/cad-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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
  const objectPattern = /<Object\b([^>]*)>([\s\S]*?)<\/Object>/gi;
  for (const match of xml.matchAll(objectPattern)) {
    if (match.index == null) continue;
    const nameMatch = /\bname\s*=\s*(["'])([\s\S]*?)\1/i.exec(match[1]);
    if (nameMatch?.[2] === objectName) return { start: match.index, text: match[0] };
  }
  return null;
}

function propertyOpening(block: string, propertyName: string): string | null {
  const pattern = new RegExp(`<Property\\b[^>]*\\bname\\s*=\\s*(["'])${escapeRegExp(propertyName)}\\1[^>]*>`, "i");
  return pattern.exec(block)?.[0] || null;
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
 * replacement currently drops FreeCAD's dynamic-property metadata. Restore
 * existing tags and add the canonical metadata for newly introduced fields so
 * FreeCAD keeps them after save/reopen.
 */
function restoreFreeCadPropertyMetadata(
  originalXml: string,
  patchedXml: string,
  objectName: string,
): string {
  const original = objectBlock(originalXml, objectName);
  const patched = objectBlock(patchedXml, objectName);
  if (!patched) return patchedXml;
  let nextBlock = patched.text;
  for (const propertyName of ["Label", ...Object.keys(FREECAD_DYNAMIC_STRING_PROPERTY_META)]) {
    const patchedOpening = propertyOpening(nextBlock, propertyName);
    if (!patchedOpening) continue;
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
    nextBlock = nextBlock.replace(patchedOpening, replacement);
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
  return xml ? pnwExtractEmbeddedBomFieldsFromDocumentXml(xml) : null;
}

export async function readFcstdEmbeddedBomFieldsAsync(
  filePath: string,
): Promise<PnwCadEmbeddedBomFields | null> {
  const xml = await readFcstdDocumentXmlAsync(filePath);
  return xml ? pnwExtractEmbeddedBomFieldsFromDocumentXml(xml) : null;
}

/** Node 宿主只负责 ZIP 与文件 I/O；根 BOM 对象选择和 XML 更新由 Wing cad-core 负责。 */
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
  const result = pnwPatchEmbeddedBomFieldsInDocumentXml(strFromU8(documentBytes), fields);
  if (!result) throw new Error(`No writable BOM root object found in ${filePath}`);
  const originalXml = strFromU8(documentBytes);
  const patchedXml = restoreFreeCadPropertyMetadata(originalXml, result.xml, result.objectName);
  const changed = patchedXml !== originalXml;
  if (changed) {
    files["Document.xml"] = strToU8(patchedXml);
    replaceFileAtomically(filePath, zipSync(files, { level: 6 }));
  }
  return { changed, objectName: result.objectName };
}
