import fs from "node:fs";
import path from "node:path";
import type { PnwCadNativeV1Placement } from "@phoenix-wing/cad-contracts";
import { fcstdFingerprint, fcstdWorkspace, readFcstdLightArchive, readFcstdLightBytes, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { fcstdXmlObjects, isFcstdObjectName } from "../../lib/fcstdLinkIdentity.js";
import { fcstdNativeXlinkFiles } from "../../lib/fcstdNativeXlinkFiles.js";
import { readFcstdAssemblyState } from "../../lib/fcstdAssemblyState.js";
import { CadObjectInfoBudget, measureCadObjectInfoJsonBytes } from "../cad-object-info/budget.js";
import { CadObjectInfoError, decodeCadXmlAttribute, parseCadObjectDocumentXml } from "../cad-object-info/document.js";

export const SAVED_ASSEMBLY_BASELINE_LIMITS = Object.freeze({ files: 100, bytes: 64 * 1024 * 1024, xmlBytes: 32 * 1024 * 1024 });
export type SavedAssemblyFileStat = { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number };
export type SavedAssemblyProperty = { type: string; rawXml: string };
export interface SavedAssemblyObjectBaseline {
  name: string;
  typeId: string;
  label: string;
  children: string[];
  placement: PnwCadNativeV1Placement | null;
  rigid: boolean | null;
  /** Every original property, including all user attributes and their metadata.
   * This is lossless saved XML, not the scalar-only v1 property projection. */
  properties: Record<string, SavedAssemblyProperty>;
  joint: { kind: "Joint"; proxyRawXml: string; reference1RawXml: string; reference2RawXml: string }
    | { kind: "GroundedJoint"; proxyRawXml: string; objectToGroundRawXml: string } | null;
}
export interface SavedAssemblyFileBaseline {
  rel: string;
  sha256: string;
  bytes: number;
  stat: SavedAssemblyFileStat;
  documentProperties: Record<string, SavedAssemblyProperty>;
  objects: SavedAssemblyObjectBaseline[];
}
export interface SavedAssemblyLinkBaseline {
  sourceRel: string;
  objectName: string;
  propertyName: string;
  targetRel: string;
  targetObjectName: string;
  savedFile: string;
  rawXml: string;
}
export interface SavedAssemblyStaleDerivedLink {
  sourceRel: string;
  objectName: string;
  ownerObjectName: string;
  targetRel: string;
  targetObjectName: string;
  sourceAssemblyRel: string;
  sourceAssemblyObjectName: string;
  selectedHostObjects: string[];
  proof: "selected_owned_app_link_absent_from_source_group";
}
/** Internal server-only DTO: root is never an API response or a native safety
 * certificate. Actual/world frames must be captured natively and compared to
 * this opening-before saved identity before an update may proceed. */
export interface SavedAssemblyBaseline {
  version: 1;
  root: string;
  hostRel: string;
  complete: true;
  scope: "saved_xml_before_native_open";
  actualFrames: "not_available_from_saved_xml";
  files: SavedAssemblyFileBaseline[];
  links: SavedAssemblyLinkBaseline[];
  /** Preflight candidates only. Never permission to delete: the Native staged
   * diff must independently prove and disclose each actual removal. */
  staleDerivedLinks: SavedAssemblyStaleDerivedLink[];
}
export class SavedAssemblyBaselineError extends CadObjectInfoError {
  constructor(code: "manual_required" | "source_changed" | "resource_limit", readonly reason: string) {
    super(code, code === "source_changed" ? "装配或依赖在读取后发生变化，请重新检查" : code === "resource_limit"
      ? "装配完整依赖图超过安全预算，请缩小范围后人工处理" : "装配保存结构或依赖不能完整证明安全，请人工处理");
  }
}
export type SavedAssemblyBaselineOptions = {
  /** Internal test seams may lower, never raise, production limits. */
  maxFiles?: number; maxBytes?: number; maxXmlBytes?: number; budget?: CadObjectInfoBudget;
  selectedHostObjects?: readonly string[];
};
function manual(reason: string): never { throw new SavedAssemblyBaselineError("manual_required", reason); }
function changed(): never { throw new SavedAssemblyBaselineError("source_changed", "fingerprint_changed"); }
function limited(): never { throw new SavedAssemblyBaselineError("resource_limit", "closure_budget_exceeded"); }
const relative = (root: string, file: string) => path.relative(root, file).replace(/\\/g, "/");
const inside = (root: string, file: string) => {
  const rel = path.relative(root, file);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const statIdentity = (stat: fs.Stats): SavedAssemblyFileStat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
const sameStat = (a: SavedAssemblyFileStat, b: SavedAssemblyFileStat) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const semanticXml = (xml: string) => xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, value => " ".repeat(value.length));
const tags = (value: string, name: string) => [...value.matchAll(new RegExp(`<${name}\\b(?:[^"'>]|"[^"]*"|'[^']*')*>`, "g"))].map(match => match[0]);
function attr(tag: string, key: string): string | undefined {
  const raw = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag)?.[2];
  return raw === undefined ? undefined : decodeCadXmlAttribute(raw.replace(/[\t\r\n]/g, " "));
}
function attributeNames(tag: string): string[] {
  return [...tag.matchAll(/\s([A-Za-z_][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g)].map(match => match[1]);
}
function assertSafeJointProxy(content: string, python: string[]) {
  // Installed JointObject.Joint/GroundedJoint.dumps() both return None. Native
  // serializes this as base64 JSON null. Metadata alone must not certify a
  // file-backed/legacy state, extra restore attributes, or nested serializer.
  if (python.length !== 1 || !/^\s*<Python\b(?:[^"'>]|"[^"]*"|'[^']*')*\/>\s*$/.test(content)
    || attr(python[0], "value") !== "bnVsbA==" || attr(python[0], "encoded") !== "yes"
    || attributeNames(python[0]).sort().join(",") !== "class,encoded,module,value") manual("unreviewed_joint_proxy_state");
}
function assertSafeExtensions(semantic: string, reviewedJoints: Set<string>) {
  const start = semantic.indexOf("<ObjectData"), end = semantic.indexOf("</ObjectData>", start);
  const data = start < 0 ? "" : semantic.slice(start, end);
  let accounted = 0;
  for (const object of data.matchAll(/<Object\b((?:[^"'>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/Object>/g)) {
    const name = attr(`<Object ${object[1]}>`, "name"), body = object[2];
    const containers = tags(body, "Extensions"), extensions = [...body.matchAll(/<Extension\b((?:[^"'>]|"[^"]*"|'[^']*')*)(?:\/>|>([\s\S]*?)<\/Extension>)/g)];
    if (extensions.length || containers.length) {
      if (containers.length !== 1 || !/^\d+$/.test(attr(containers[0], "Count") ?? "")
        || Number(attr(containers[0], "Count")) !== extensions.length) manual("unknown_extension_serialization");
    }
    const seen = new Set<string>();
    for (const extension of extensions) {
      const tag = `<Extension ${extension[1]}>`, type = attr(tag, "type"), extensionName = attr(tag, "name"); accounted++;
      if (!type || !extensionName || seen.has(extensionName)) manual("unknown_extension_serialization");
      seen.add(extensionName);
      if (/Python/.test(type)) {
        // The native Joint constructor adds this one empty C++ suppressible
        // extension. Other Python extensions have not been audited for open.
        if (!name || !reviewedJoints.has(name) || type !== "App::SuppressibleExtensionPython"
          || extensionName !== "SuppressibleExtensionPython" || (extension[2] ?? "").trim()
          || attributeNames(tag).sort().join(",") !== "name,type") manual("unreviewed_python_extension");
      }
    }
  }
  if (tags(semantic, "Extension").length !== accounted) manual("unknown_extension_serialization");
}
function bound(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error("保存基线测试预算不能提高生产上限");
  return value;
}
function selection(workspacePath: string, filePath: string) {
  if (typeof workspacePath !== "string" || !workspacePath.trim() || workspacePath.includes("\0")
    || typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0") || !/\.fcstd$/i.test(filePath)) manual("invalid_selection");
  try {
    // Reject a symlink workspace spelling too: a mirror must have one stable root.
    const lexicalRoot = path.resolve(workspacePath), root = fcstdWorkspace(workspacePath);
    if (root !== lexicalRoot) manual("symlink_workspace");
    const file = safeFcstdPath(root, filePath);
    if (!fs.statSync(file).isFile()) manual("not_regular_file");
    return { root, hostRel: relative(root, file) };
  } catch (error) {
    if (error instanceof SavedAssemblyBaselineError) throw error;
    return manual("unsafe_or_missing_selection");
  }
}
function dependency(root: string, sourceRel: string, savedFile: string): string {
  if (!savedFile) return sourceRel;
  if (savedFile.length > 4096 || /[\x00-\x1f]/.test(savedFile) || path.posix.isAbsolute(savedFile) || path.win32.isAbsolute(savedFile)
    || /^[A-Za-z][A-Za-z\d+.-]*:/.test(savedFile) || !/\.fcstd$/i.test(savedFile)) manual("unsupported_dependency_path");
  const target = path.resolve(root, path.dirname(sourceRel), savedFile.replace(/\\/g, "/"));
  if (!inside(root, target)) manual("dependency_outside_workspace");
  try {
    const safe = safeFcstdPath(root, relative(root, target));
    if (!fs.statSync(safe).isFile()) manual("dependency_not_regular_file");
    return relative(root, safe);
  } catch (error) {
    if (error instanceof SavedAssemblyBaselineError) throw error;
    return manual("missing_or_symlink_dependency");
  }
}
function assertKnownFileAttributes(semantic: string) {
  for (const [serialized] of semantic.matchAll(/<[A-Za-z_][\w:.-]*\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g)) {
    const file = attr(serialized, "file");
    if (file === undefined || /^<XLink\b/.test(serialized)) continue;
    // Shape/Python archive members are not filesystem dependencies. Only
    // known basename-only archive-member serializers may carry `file`.
    if (!/^<(?:Part|Python|PlacementList|VectorList)\b/.test(serialized) || /[\\/\x00-\x1f:]/.test(file) || /\.fcstd$/i.test(file) || file === "." || file === "..") {
      manual("unsupported_external_reference");
    }
  }
}

async function savedObjects(root: string, rel: string, xml: string, signal: AbortSignal | undefined, budget: CadObjectInfoBudget) {
  const parsed = await parseCadObjectDocumentXml(xml, signal, budget);
  const semantic = semanticXml(xml), rawObjects = fcstdXmlObjects(semantic);
  assertKnownFileAttributes(semantic);
  const boundary = semantic.search(/<(?:Objects|ObjectData|Object)\b/), prefix = boundary < 0 ? semantic : semantic.slice(0, boundary);
  const documentProperties: Record<string, SavedAssemblyProperty> = Object.create(null);
  let documentPropertyCount = 0;
  for (const property of prefix.matchAll(/<Property\b((?:[^"'>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/Property>/g)) {
    budget.check(); const name = attr(property[0].slice(0, property[0].indexOf(">") + 1), "name"), type = attr(property[0].slice(0, property[0].indexOf(">") + 1), "type");
    if (!name || !type || documentProperties[name] || !/^App::Property(?:String|StringList|Map|UUID|Bool|Enumeration|Integer|IntegerList|Float|FloatList)$/.test(type)) manual("unknown_document_property");
    documentProperties[name] = { type, rawXml: xml.slice(property.index!, property.index! + property[0].length) }; documentPropertyCount++;
  }
  if (tags(prefix, "Property").length !== documentPropertyCount) manual("unsupported_document_property_serialization");
  if (rawObjects.length !== parsed.document.objects.length) manual("unsupported_object_serialization");
  const projected = new Map(parsed.document.objects.map(object => [object.name, object]));
  // The saved declarations determine which native constructors will run.
  // A conflicting inline type must not hide an executable declaration behind
  // the generic reader's inline-type compatibility projection.
  for (const tag of tags(semantic, "Object")) {
    const name = attr(tag, "name"), type = attr(tag, "type");
    if (type !== undefined && (!name || projected.get(name)?.type_id !== type)) manual("conflicting_object_type");
  }
  const saved = readFcstdAssemblyState(xml);
  if (saved.joint_issues.length) manual("saved_disconnected_joint");
  const rigid = new Map(saved.links.map(link => [link.object_name, link.rigid]));
  const links: SavedAssemblyLinkBaseline[] = [], objects: SavedAssemblyObjectBaseline[] = [];
  let propertyCount = 0, emptyOptionalXlinks = 0, emptyExpressionEngines = 0, reviewedProxyCount = 0;
  const reviewedJoints = new Set<string>();
  for (const object of rawObjects) {
    budget.check();
    const known = projected.get(object.name);
    if (!known || !known.type_id || !isFcstdObjectName(object.name)) manual("unknown_object_identity");
    if (known.children.some(name => !projected.has(name))) manual("missing_group_member");
    const proxy = object.properties.get("Proxy"), python = tags(proxy?.content ?? "", "Python");
    const proxyClass = python.length === 1 && attr(python[0], "module") === "JointObject" ? attr(python[0], "class") : undefined;
    const jointProxy = proxyClass === "Joint", groundedProxy = proxyClass === "GroundedJoint";
    if ((/Python/.test(known.type_id) || proxy?.type === "App::PropertyPythonObject")
      && ((!jointProxy && !groundedProxy) || known.type_id !== "App::FeaturePython" || proxy?.type !== "App::PropertyPythonObject")) {
      manual("unknown_python_proxy");
    }
    if (jointProxy || groundedProxy) {
      assertSafeJointProxy(proxy!.content, python); reviewedProxyCount++; reviewedJoints.add(object.name);
    }
    const properties: Record<string, SavedAssemblyProperty> = Object.create(null);
    for (const [name, property] of object.properties) {
      budget.check(); propertyCount++;
      if (!name || !property.type) manual("unsupported_property_serialization");
      // Offsets come from the shared read-only extractor, after full bounded XML
      // validation. Slice the original, not its masked semantic copy, so CDATA,
      // comments, metadata and complete nested Joint subpaths are retained.
      const start = semantic.lastIndexOf("<Property", property.start - 1), end = property.start + property.content.length + "</Property>".length;
      if (start < 0 || semantic.slice(start, property.start).indexOf(">") !== property.start - start - 1) manual("unsupported_property_serialization");
      const rawXml = xml.slice(start, end);
      properties[name] = { type: property.type, rawXml };
      if (/Python/.test(property.type) && (property.type !== "App::PropertyPythonObject" || name !== "Proxy" || (!jointProxy && !groundedProxy))) manual("unknown_python_property");
      if (/Expression/.test(property.type)) {
        const engines = tags(property.content, "ExpressionEngine");
        // Expressions can evaluate on restore/recompute independently of the
        // Assembly solver setting. Only the ordinary empty engine is proved.
        if (property.type !== "App::PropertyExpressionEngine" || engines.length !== 1 || attr(engines[0], "count") !== "0"
          || attributeNames(engines[0]).join(",") !== "count"
          || property.content.replace(/<\/?ExpressionEngine\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g, "").trim()) manual("unreviewed_expression_engine");
        emptyExpressionEngines++;
      }
      const xlinks = tags(property.content, "XLink");
      if (/PropertyXLink/.test(property.type) && !/^App::PropertyXLink(?:Sub)?$/.test(property.type)) manual("unsupported_xlink_property_type");
      if (/Property(?:File|Path)/.test(property.type)) manual("unsupported_file_property_type");
      const groundedGlobal = property.type === "App::PropertyLinkGlobal" && name === "ObjectToGround" && groundedProxy
        && known.type_id === "App::FeaturePython" && proxy?.type === "App::PropertyPythonObject";
      // Native App::Link always saves an empty hidden ColoredElements link.
      // Only this proved-empty form is supported; nonempty/other hidden links
      // must not evade the explicit reference map used for stale-copy proof.
      const hiddenTags = tags(property.content, "LinkSub");
      const emptyColoredElements = known.type_id === "App::Link" && name === "ColoredElements" && property.type === "App::PropertyLinkSubHidden"
        && hiddenTags.length === 1 && attr(hiddenTags[0], "value") === "" && attr(hiddenTags[0], "count") === "0"
        && !property.content.replace(/<\/?LinkSub\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g, "").trim();
      if (/Link/.test(property.type) && !/^App::Property(?:XLink(?:Sub)?|Link(?:Sub|List|SubList)?)$/.test(property.type)
        && !groundedGlobal && !emptyColoredElements) manual("unsupported_link_property_type");
      if (/^App::PropertyLink(?:Sub|List|SubList)?$/.test(property.type)) {
        for (const tag of [...tags(property.content, "Link"), ...tags(property.content, "LinkSub")]) {
          const target = attr(tag, "value") ?? attr(tag, "name");
          if (target && !projected.has(target)) manual("missing_local_link_target");
        }
      }
      if (!xlinks.length) {
        if (/^App::PropertyXLink/.test(property.type)) manual("missing_xlink_serialization");
        continue;
      }
      if (!/^App::PropertyXLink(?:Sub)?$/.test(property.type) || xlinks.length !== 1) manual("unsupported_xlink_serialization");
      const tag = xlinks[0], file = attr(tag, "file"), target = attr(tag, "name");
      // Native App::Link's optional copy-on-change source is explicitly null
      // unless that feature is used. This exact empty slot has no dependency;
      // it is still counted against whole-document XLink completeness below.
      if (known.type_id === "App::Link" && name === "LinkCopyOnChangeSource" && property.type === "App::PropertyXLink"
        && file === "" && target === "" && !property.content.replace(/<\/?XLink\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g, "").trim()) {
        emptyOptionalXlinks++; continue;
      }
      if (file === undefined || !target || !isFcstdObjectName(target)) manual("unresolved_xlink_identity");
      // The supported serializer is one XLink with optional Sub children. Do
      // not interpret an unknown wrapper/list as a complete single reference.
      const structure = semanticXml(property.content).replace(/<\/?(?:XLink|Sub)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g, "");
      if (structure.trim()) manual("unsupported_xlink_structure");
      links.push({ sourceRel: rel, objectName: object.name, propertyName: name, targetRel: dependency(root, rel, file),
        targetObjectName: target, savedFile: file, rawXml });
    }
    let joint: SavedAssemblyObjectBaseline["joint"] = null;
    if (jointProxy || object.properties.has("Reference1") || object.properties.has("Reference2")) {
      if (!jointProxy || known.type_id !== "App::FeaturePython" || proxy?.type !== "App::PropertyPythonObject") manual("unknown_joint_proxy");
      for (const name of ["Reference1", "Reference2"] as const) {
        if (properties[name]?.type !== "App::PropertyXLinkSub" || !links.some(link => link.objectName === object.name && link.propertyName === name)) manual("unknown_joint_reference");
      }
      joint = { kind: "Joint", proxyRawXml: properties.Proxy.rawXml, reference1RawXml: properties.Reference1.rawXml, reference2RawXml: properties.Reference2.rawXml };
    }
    if (groundedProxy) {
      const grounded = object.properties.get("ObjectToGround"), targets = tags(grounded?.content ?? "", "Link");
      const target = targets.length === 1 ? attr(targets[0], "value") : undefined;
      // Current native GroundedJoint uses LinkGlobal. Legacy Link migrates in
      // onDocumentRestored; require the user to migrate/save it separately so
      // opening the staged document cannot silently change this baseline type.
      if (grounded?.type === "App::PropertyLink") manual("legacy_grounded_target_requires_migration");
      if (grounded?.type !== "App::PropertyLinkGlobal" || !target || !projected.has(target)
        || !/^\s*<Link\b(?:[^"'>]|"[^"]*"|'[^']*')*\/>\s*$/.test(grounded.content)) manual("unknown_grounded_target");
      joint = { kind: "GroundedJoint", proxyRawXml: properties.Proxy.rawXml, objectToGroundRawXml: properties.ObjectToGround.rawXml };
    }
    const savedRigid = rigid.get(object.name) ?? null;
    if (known.type_id === "Assembly::AssemblyLink" && savedRigid === null) manual("unknown_rigid_state");
    objects.push({ name: known.name, typeId: known.type_id, label: known.label, children: [...known.children], placement: known.placement,
      rigid: savedRigid, properties, joint });
  }
  // These whole-document cross-checks are deliberately not the index's lossy
  // projection: a bare/unknown XLink must never disappear from the closure.
  if (tags(semantic, "Property").length !== propertyCount + documentPropertyCount || tags(semantic, "XLink").length !== links.length + emptyOptionalXlinks
    || parsed.document.xlinks.length !== links.length + emptyOptionalXlinks) manual("unaccounted_reference_serialization");
  const externalFiles = fcstdNativeXlinkFiles(xml);
  if (JSON.stringify(externalFiles) !== JSON.stringify(links.map(link => link.savedFile).filter(Boolean))) manual("incomplete_dependency_projection");
  if (tags(semantic, "Python").length !== reviewedProxyCount) manual("unaccounted_python_serialization");
  if (tags(semantic, "Expression").length || tags(semantic, "ExpressionEngine").length !== emptyExpressionEngines) manual("unreviewed_expression_engine");
  assertSafeExtensions(semantic, reviewedJoints);
  return { objects, links, documentProperties };
}

const identity = (rel: string, name: string) => `${rel}\0${name}`;
/** All saved subpaths are examined, not just the top-level XLink `name`.
 * Unknown path syntax cannot be used to certify an unreferenced old copy. */
function savedSubpathSegments(rawXml: string): string[] {
  const values: string[] = [], semantic = semanticXml(rawXml);
  for (const tag of [...tags(semantic, "Sub"), ...tags(semantic, "XLink"), ...tags(semantic, "LinkSub"), ...tags(semantic, "Link")]) {
    if (/^<Sub\b/.test(tag)) {
      const value = attr(tag, "value");
      if (value === undefined) manual("unknown_subpath_for_stale_proof");
      values.push(value);
    } else {
      const value = attr(tag, "sub"); if (value !== undefined) values.push(value);
      if (/\s(?:subname|subnames|subpath)\s*=/.test(tag)) manual("unknown_subpath_for_stale_proof");
    }
  }
  const segments: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const parts = value.endsWith(".") ? value.slice(0, -1).split(".") : value.split(".");
    if (!parts.length || parts.some(part => !isFcstdObjectName(part))) manual("unknown_subpath_for_stale_proof");
    segments.push(...parts);
  }
  return segments;
}

function staleDerivedCandidates(files: SavedAssemblyFileBaseline[], links: SavedAssemblyLinkBaseline[], hostRel: string,
  selected: readonly string[] | undefined, budget: CadObjectInfoBudget): SavedAssemblyStaleDerivedLink[] {
  const objects = new Map<string, SavedAssemblyObjectBaseline>();
  const groupOwners = new Map<string, string[]>();
  for (const file of files) for (const object of file.objects) {
    budget.check(); objects.set(identity(file.rel, object.name), object);
    for (const child of object.children) {
      const key = identity(file.rel, child), owners = groupOwners.get(key) ?? [];
      owners.push(object.name); groupOwners.set(key, owners);
    }
  }
  if (selected !== undefined && (!Array.isArray(selected) || selected.length > 100 || new Set(selected).size !== selected.length
    || selected.some(name => typeof name !== "string" || !isFcstdObjectName(name)
      || objects.get(identity(hostRel, name))?.typeId !== "Assembly::AssemblyLink"))) manual("invalid_selected_host_objects");
  const missing = links.filter(link => !objects.has(identity(link.targetRel, link.targetObjectName)));
  if (!missing.length) return [];
  if (!selected?.length) manual("missing_link_target_object");
  const linked = new Map(links.filter(link => link.propertyName === "LinkedObject").map(link => [identity(link.sourceRel, link.objectName), link]));
  const group = (rel: string, object: SavedAssemblyObjectBaseline): string[] => {
    const property = object.properties.Group, raw = semanticXml(property?.rawXml ?? "");
    const lists = tags(raw, "LinkList"), children = tags(raw, "Link");
    if (property?.type !== "App::PropertyLinkList" || lists.length !== 1 || !/^\d+$/.test(attr(lists[0], "count") ?? "")
      || Number(attr(lists[0], "count")) !== children.length || children.length !== object.children.length
      || children.some((tag, index) => attr(tag, "value") !== object.children[index])
      || raw.replace(/<\/?(?:Property|LinkList|Link)\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g, "").trim()) manual("unproven_group_for_stale_copy");
    if (object.children.some(name => !objects.has(identity(rel, name)))) manual("missing_group_member");
    return object.children;
  };
  type Scope = { rel: string; name: string; selected: string };
  const scopes = new Map<string, Set<string>>(), pending: Scope[] = [];
  const authorize = (rel: string, name: string, selectedName: string) => {
    const key = identity(rel, name), names = scopes.get(key) ?? new Set<string>();
    if (!names.has(selectedName)) { names.add(selectedName); scopes.set(key, names); pending.push({ rel, name, selected: selectedName }); }
  };
  const sources = new Map<string, { rel: string; object: SavedAssemblyObjectBaseline }>();
  for (const name of selected) {
    if (objects.get(identity(hostRel, name))?.typeId !== "Assembly::AssemblyLink") manual("invalid_selected_host_objects");
    authorize(hostRel, name, name);
  }
  for (let index = 0; index < pending.length; index++) {
    budget.check();
    const scope = pending[index], owner = objects.get(identity(scope.rel, scope.name))!;
    if (owner.typeId !== "Assembly::AssemblyLink") manual("unproven_derived_owner");
    const trail = new Set<string>(); let currentRel = scope.rel, current = owner;
    while (current.typeId === "Assembly::AssemblyLink") {
      budget.check(); const key = identity(currentRel, current.name);
      if (trail.has(key)) manual("cyclic_owner_source"); trail.add(key);
      const source = linked.get(key);
      if (!source || current.properties.LinkedObject?.type !== "App::PropertyXLink" || savedSubpathSegments(source.rawXml).length) manual("unproven_derived_owner_source");
      const target = objects.get(identity(source.targetRel, source.targetObjectName));
      if (!target) manual("missing_assembly_source");
      currentRel = source.targetRel; current = target;
      if (current.typeId === "Assembly::AssemblyLink") authorize(currentRel, current.name, scope.selected);
    }
    if (current.typeId !== "Assembly::AssemblyObject") manual("unproven_derived_owner_source");
    sources.set(identity(scope.rel, scope.name), { rel: currentRel, object: current });
    const sourceChildren = new Set(group(currentRel, current));
    // Dependency definitions in the selected source hierarchy are part of the
    // same proved branch, even when a still-old host copy has not materialized
    // a newly introduced child yet. No other dependency branch is authorized.
    for (const name of sourceChildren) {
      const child = objects.get(identity(currentRel, name))!;
      if (child.typeId === "Assembly::AssemblyLink" && groupOwners.get(identity(currentRel, name))?.length === 1) authorize(currentRel, name, scope.selected);
    }
    for (const name of group(scope.rel, owner)) {
      const child = objects.get(identity(scope.rel, name))!;
      if (child.typeId !== "Assembly::AssemblyLink" || groupOwners.get(identity(scope.rel, name))?.length !== 1) continue;
      const source = linked.get(identity(scope.rel, name));
      if (source?.targetRel === currentRel && sourceChildren.has(source.targetObjectName)
        && objects.get(identity(currentRel, source.targetObjectName))?.typeId === "Assembly::AssemblyLink") authorize(scope.rel, name, scope.selected);
    }
  }
  const candidates: SavedAssemblyStaleDerivedLink[] = [];
  const candidateRefs = new Set<string>();
  for (const link of missing) {
    budget.check();
    const object = objects.get(identity(link.sourceRel, link.objectName));
    const owners = groupOwners.get(identity(link.sourceRel, link.objectName));
    const ownerName = owners?.length === 1 ? owners[0] : undefined;
    const source = ownerName ? sources.get(identity(link.sourceRel, ownerName)) : undefined;
    const authority = ownerName ? scopes.get(identity(link.sourceRel, ownerName)) : undefined;
    if (object?.typeId !== "App::Link" || object.children.length || link.propertyName !== "LinkedObject" || object.properties.LinkedObject?.type !== "App::PropertyXLink" || !ownerName || !source || !authority
      || source.rel !== link.targetRel || source.object.children.includes(link.targetObjectName) || savedSubpathSegments(link.rawXml).length) manual("missing_link_target_object");
    candidates.push({ sourceRel: link.sourceRel, objectName: link.objectName, ownerObjectName: ownerName,
      targetRel: link.targetRel, targetObjectName: link.targetObjectName, sourceAssemblyRel: source.rel, sourceAssemblyObjectName: source.object.name,
      selectedHostObjects: [...authority].sort(), proof: "selected_owned_app_link_absent_from_source_group" });
    candidateRefs.add(identity(link.sourceRel, link.objectName) + "\0LinkedObject");
  }
  const localCandidates = new Map(candidates.map(candidate => [identity(candidate.sourceRel, candidate.objectName), candidate]));
  const targetCandidates = new Set(candidates.map(candidate => identity(candidate.targetRel, candidate.targetObjectName)));
  // AssemblyLink subpaths may retain the source member's name even when a
  // materialized local copy has a collision-renamed identity. Both spellings
  // are unsafe references, never a reason to guess which endpoint was meant.
  const localSourceAliases = new Set(candidates.map(candidate => identity(candidate.sourceRel, candidate.targetObjectName)));
  const checkReference = (sourceRel: string, objectName: string, propertyName: string, targetRel: string, targetName: string, subpaths: string[]) => {
    budget.check(); const targetKey = identity(targetRel, targetName), local = localCandidates.get(targetKey);
    const ownedGroup = local && sourceRel === local.sourceRel && objectName === local.ownerObjectName && propertyName === "Group";
    if (local && !ownedGroup) manual("stale_copy_is_referenced");
    if (targetCandidates.has(targetKey) && !candidateRefs.has(identity(sourceRel, objectName) + "\0" + propertyName)) manual("stale_source_is_referenced");
    for (const segment of subpaths) if (localCandidates.has(identity(targetRel, segment)) || targetCandidates.has(identity(targetRel, segment))
      || localSourceAliases.has(identity(targetRel, segment))) manual("stale_copy_subpath_is_referenced");
  };
  for (const link of links) checkReference(link.sourceRel, link.objectName, link.propertyName, link.targetRel, link.targetObjectName, savedSubpathSegments(link.rawXml));
  for (const file of files) for (const object of file.objects) for (const [name, property] of Object.entries(object.properties)) {
    budget.check();
    if (!/^App::PropertyLink(?:Sub|List|SubList|Global)?$/.test(property.type)) continue;
    const raw = semanticXml(property.rawXml), subpaths = savedSubpathSegments(raw);
    for (const tag of [...tags(raw, "Link"), ...tags(raw, "LinkSub")]) {
      const target = attr(tag, "value") ?? attr(tag, "name");
      if (target === undefined) manual("unknown_local_reference_for_stale_proof");
      if (target) checkReference(file.rel, object.name, name, file.rel, target, subpaths);
    }
  }
  return candidates;
}

/** Explicit host plus actual transitive XLink closure only. Never enumerates a
 * directory, calls Native, repairs a reference, or writes CAD/DB/configuration. */
export async function captureSavedAssemblyBaseline(workspacePath: string, filePath: string, signal?: AbortSignal,
  options: SavedAssemblyBaselineOptions = {}): Promise<SavedAssemblyBaseline> {
  const budget = options.budget ?? new CadObjectInfoBudget(signal);
  const maxFiles = bound(options.maxFiles, SAVED_ASSEMBLY_BASELINE_LIMITS.files), maxBytes = bound(options.maxBytes, SAVED_ASSEMBLY_BASELINE_LIMITS.bytes);
  const maxXmlBytes = bound(options.maxXmlBytes, SAVED_ASSEMBLY_BASELINE_LIMITS.xmlBytes);
  budget.check();
  const { root, hostRel } = selection(workspacePath, filePath);
  const files: SavedAssemblyFileBaseline[] = [], links: SavedAssemblyLinkBaseline[] = [], pending = [hostRel], queued = new Set(pending);
  let bytes = 0, xmlBytes = 0;
  while (pending.length) {
    budget.check();
    const rel = pending.shift()!;
    if (files.length >= maxFiles) limited();
    let filename: string, before: fs.Stats;
    try { filename = safeFcstdPath(root, rel); before = fs.statSync(filename); }
    catch { return manual("missing_or_unsafe_dependency"); }
    if (!before.isFile()) manual("dependency_not_regular_file");
    if (bytes + before.size > maxBytes) limited();
    const archive = readFcstdLightArchive(filename, budget);
    bytes += archive.bytes.byteLength; xmlBytes += archive.documentBytes.byteLength;
    if (bytes > maxBytes || xmlBytes > maxXmlBytes) limited();
    const saved = await savedObjects(root, rel, archive.xml, signal, budget);
    if (!files.length && !saved.objects.some(object => ["Assembly::AssemblyObject", "Assembly::AssemblyLink"].includes(object.typeId))) manual("not_assembly");
    if (!sameStat(statIdentity(before), statIdentity(fs.statSync(filename)))) changed();
    files.push({ rel, sha256: fcstdFingerprint(archive.bytes), bytes: archive.bytes.byteLength, stat: statIdentity(before), documentProperties: saved.documentProperties, objects: saved.objects });
    links.push(...saved.links);
    for (const link of saved.links) if (!queued.has(link.targetRel)) { queued.add(link.targetRel); if (queued.size > maxFiles) limited(); pending.push(link.targetRel); }
  }
  const staleDerivedLinks = staleDerivedCandidates(files, links, hostRel, options.selectedHostObjects, budget);
  const baseline: SavedAssemblyBaseline = { version: 1, root, hostRel, complete: true, scope: "saved_xml_before_native_open",
    actualFrames: "not_available_from_saved_xml", files, links, staleDerivedLinks };
  await measureCadObjectInfoJsonBytes(baseline, budget);
  await verifySavedAssemblyBaseline(baseline, signal, budget);
  return baseline;
}

/** Recheck every source byte and identity immediately before mirror creation
 * and again before publication. A changed dependency invalidates the full job. */
export async function verifySavedAssemblyBaseline(baseline: SavedAssemblyBaseline, signal?: AbortSignal,
  budget = new CadObjectInfoBudget(signal)): Promise<void> {
  for (const file of baseline.files) {
    budget.check();
    await new Promise<void>(resolve => setImmediate(resolve)); budget.check();
    try {
      const filename = safeFcstdPath(baseline.root, file.rel), before = statIdentity(fs.statSync(filename));
      if (!sameStat(file.stat, before)) changed();
      const bytes = readFcstdLightBytes(filename, budget);
      if (fcstdFingerprint(bytes) !== file.sha256 || !sameStat(before, statIdentity(fs.statSync(filename)))) changed();
    } catch (error) {
      if (error instanceof CadObjectInfoError) throw error;
      changed();
    }
  }
}
