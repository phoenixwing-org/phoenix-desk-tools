import {
  pnwIsCadNativeV1FcstdDocument,
  type PnwCadNativeV1FcstdDocument,
  type PnwCadNativeV1FcstdObject,
  type PnwCadNativeV1Placement,
  type PnwCadNativeV1PropertyValue,
} from "@phoenix-wing/cad-contracts";
import { reconcileFcstdPropertyCounts } from "../../lib/fcstdPropertyCounts.js";
import { CadObjectInfoError } from "./error.js";
import { CadObjectInfoBudget } from "./budget.js";
export { CadObjectInfoError } from "./error.js";

// The legacy light reader accepted 32 MiB XML. This full-object projection
// deliberately retains its reviewed 16 MiB cap; carrying byte-count metadata
// does not authorize increasing parsing/output amplification budgets.
export const CAD_OBJECT_LIMITS = Object.freeze({ xmlBytes: 16 * 1024 * 1024, nodes: 150_000, depth: 128, objects: 10_000 });
type XmlNode = { tag: string; attrs: Record<string, string>; children: XmlNode[]; text: string };
const badXml = () => { throw new CadObjectInfoError("invalid_document_xml", "Document.xml 不完整或格式无效"); };
const limit = () => { throw new CadObjectInfoError("resource_limit", "对象文档超过安全解析上限"); };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export function assertCadObjectInfoActive(signal?: AbortSignal, budget?: CadObjectInfoBudget) {
  if (signal?.aborted) throw new CadObjectInfoError("cancelled", "对象信息读取已取消");
  budget?.check();
}

function xmlChar(code: number) {
  return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
    || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}
function decode(value: string): string {
  for (const char of value) if (!xmlChar(char.codePointAt(0)!)) badXml();
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&([^;]*);|&/g, (_all, entity: string | undefined) => {
    if (!entity) return badXml();
    if (Object.hasOwn(named, entity)) return named[entity];
    const match = /^(?:#([0-9]+)|#x([0-9a-fA-F]+))$/.exec(entity);
    if (!match) return badXml();
    const code = Number.parseInt(match[1] ?? match[2], match[1] ? 10 : 16);
    if (!xmlChar(code)) return badXml();
    return String.fromCodePoint(code);
  });
}

// Shared read-only compatibility port: decode entities once; reject unknown/invalid XML characters.
export { decode as decodeCadXmlAttribute };

/** Bounded, non-resolving XML reader. DTD/external entities are deliberately unsupported. */
async function xmlTree(xml: string, signal: AbortSignal | undefined, budget: CadObjectInfoBudget): Promise<XmlNode> {
  assertCadObjectInfoActive(signal, budget);
  if (Buffer.byteLength(xml, "utf8") > CAD_OBJECT_LIMITS.xmlBytes) limit();
  let character = 0;
  for (const char of xml) {
    if (++character % 4096 === 0) assertCadObjectInfoActive(signal, budget);
    if (!xmlChar(char.codePointAt(0)!)) badXml();
  }
  try { reconcileFcstdPropertyCounts(xml); } catch { badXml(); }
  assertCadObjectInfoActive(signal, budget);
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/g;
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined; let end = 0; let count = 0; let seenDeclaration = false;
  for (const match of xml.matchAll(tokens)) {
    assertCadObjectInfoActive(signal, budget);
    if (++count > CAD_OBJECT_LIMITS.nodes) limit();
    if (count % 512 === 0) { await tick(); assertCadObjectInfoActive(signal, budget); }
    const gap = xml.slice(end, match.index);
    if (gap.includes("<") || gap.includes("]]>")) badXml();
    const text = decode(gap);
    if (stack.length) stack.at(-1)!.text += text;
    else if (text.trim()) badXml();
    const token = match[0]; end = match.index! + token.length;
    if (token.startsWith("<!--")) {
      if (token.slice(4, -3).includes("--") || token.slice(4, -3).endsWith("-")) badXml();
      continue;
    }
    if (token.startsWith("<![CDATA[")) {
      if (!stack.length) badXml();
      const raw = token.slice(9, -3);
      for (const char of raw) if (!xmlChar(char.codePointAt(0)!)) badXml();
      stack.at(-1)!.text += raw; continue;
    }
    if (token.startsWith("<?")) {
      const target = /^<\?([A-Za-z_][\w:.-]*)(?:\s|\?>)/.exec(token)?.[1];
      if (!target) badXml();
      if (target!.toLowerCase() === "xml") {
        if (target !== "xml" || root || seenDeclaration || match.index !== 0
          || !/^<\?xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])[A-Za-z][\w.-]*\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/.test(token)) badXml();
        const encoding = /\bencoding\s*=\s*(["'])([^"']+)\1/.exec(token)?.[2];
        if (encoding && !/^utf-?8$/i.test(encoding)) throw new CadObjectInfoError("invalid_document_xml", "对象信息仅支持 UTF-8 Document.xml");
        seenDeclaration = true;
      }
      continue;
    }
    const tag = /^<\/?([\w:.-]+)/.exec(token)![1];
    if (token.startsWith("</")) {
      if (!/^<\/[\w:.-]+\s*>$/.test(token) || stack.pop()?.tag !== tag) badXml();
      continue;
    }
    const attrs: Record<string, string> = Object.create(null);
    for (const attr of token.matchAll(/\s([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      if (Object.hasOwn(attrs, attr[1])) badXml();
      attrs[attr[1]] = decode(attr[3].replace(/[\t\n\r]/g, " "));
    }
    const node: XmlNode = { tag, attrs, children: [], text: "" };
    if (stack.length) stack.at(-1)!.children.push(node);
    else { if (root || tag !== "Document") badXml(); root = node; }
    if (!token.endsWith("/>")) stack.push(node);
    if (stack.length > CAD_OBJECT_LIMITS.depth) limit();
  }
  if (!root || stack.length || xml.slice(end).trim()) badXml();
  return root!;
}

function descendants(node: XmlNode, budget?: CadObjectInfoBudget): XmlNode[] {
  const result: XmlNode[] = []; const stack = [...node.children].reverse();
  while (stack.length) {
    if (result.length % 512 === 0) budget?.check();
    const child = stack.pop()!; result.push(child);
    for (let i = child.children.length - 1; i >= 0; i--) stack.push(child.children[i]);
  }
  return result;
}
function stringValue(property?: XmlNode): string | undefined {
  const string = property?.children.find(child => child.tag === "String");
  return string ? string.attrs.value ?? string.text : undefined;
}
function finite(value: string | undefined, integer = false): number {
  if (value == null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    throw new CadObjectInfoError("invalid_numeric_value", "对象属性包含无效数值，未使用默认值替代");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && (!/^[+-]?\d+$/.test(value.trim()) || !Number.isSafeInteger(number)))) {
    throw new CadObjectInfoError("invalid_numeric_value", "对象属性包含非有限值或不安全整数");
  }
  return number;
}
const floats = new Set(["Float", "PropertyLength", "PropertyDistance", "PropertyFloat"]);
const integers = new Set(["Integer", "PropertyInteger"]);
function scalar(property: XmlNode): PnwCadNativeV1PropertyValue | undefined {
  for (const child of property.children) {
    if (child.tag === "String") return child.attrs.value ?? child.text;
    if (floats.has(child.tag)) return finite(child.attrs.value);
    if (integers.has(child.tag)) return finite(child.attrs.value, true);
  }
  return undefined;
}
function placement(property?: XmlNode): PnwCadNativeV1Placement | null {
  const saved = property?.children.find(child => child.tag === "PropertyPlacement");
  if (!saved) return null;
  return { x: finite(saved.attrs.Px), y: finite(saved.attrs.Py), z: finite(saved.attrs.Pz),
    q0: finite(saved.attrs.Q0), q1: finite(saved.attrs.Q1), q2: finite(saved.attrs.Q2), q3: finite(saved.attrs.Q3) };
}
function validBom(type: string) {
  return ["PartDesign::Body", "App::Part", "App::LinkGroup"].includes(type) || type.includes("Part::") || type.includes("Assembly");
}

/** Saved local properties only: no model execution, linked-file reads or world-transform inference. */
export async function parseCadObjectDocumentXml(xml: string, signal?: AbortSignal, budget = new CadObjectInfoBudget(signal)): Promise<{ document: PnwCadNativeV1FcstdDocument; warnings: string[] }> {
  assertCadObjectInfoActive(signal, budget);
  const tree = await xmlTree(xml.replace(/^\uFEFF/, ""), signal, budget);
  const declarations = tree.children.filter(child => child.tag === "Objects").flatMap(node => node.children.filter(child => child.tag === "Object"));
  const data = tree.children.filter(child => child.tag === "ObjectData").flatMap(node => node.children.filter(child => child.tag === "Object"));
  const direct = tree.children.filter(child => child.tag === "Object");
  const types = new Map<string, string>();
  for (const node of declarations) {
    if (node.attrs.name == null || types.has(node.attrs.name)) badXml();
    types.set(node.attrs.name, node.attrs.type ?? "");
  }
  const all = [...data, ...direct]; const names = new Set<string>();
  for (const node of all) { if (node.attrs.name == null || names.has(node.attrs.name)) badXml(); names.add(node.attrs.name); }
  for (const node of declarations) if (!names.has(node.attrs.name)) all.push(node);
  if (all.length > CAD_OBJECT_LIMITS.objects) limit();
  const objects: Array<PnwCadNativeV1FcstdObject & { level: number }> = [];
  const xlinks: Array<{ file: string; label: string | null }> = [];
  let unsupported = 0;
  for (const [index, node] of all.entries()) {
    assertCadObjectInfoActive(signal, budget);
    if (index % 100 === 0) { await tick(); assertCadObjectInfoActive(signal, budget); }
    const props = node.children.filter(child => child.tag === "Properties").flatMap(child => child.children.filter(prop => prop.tag === "Property"));
    const map = new Map<string, XmlNode>();
    for (const prop of props) { if (prop.attrs.name == null || map.has(prop.attrs.name)) badXml(); map.set(prop.attrs.name, prop); }
    const name = node.attrs.name; const label = stringValue(map.get("Label")) ?? name;
    const type_id = node.attrs.type || types.get(name) || "";
    const group = map.get("Group");
    const children = group ? descendants(group, budget).filter(child => child.tag === "Link").map(child => child.attrs.value ?? child.attrs.name).filter((value): value is string => value !== undefined) : [];
    if (group?.attrs.value !== undefined) children.push(group.attrs.value);
    const properties: Record<string, PnwCadNativeV1PropertyValue> = Object.create(null);
    for (const [key, prop] of map) {
      if (["Label", "Group", "Material", "Placement"].includes(key)) continue;
      const value = scalar(prop);
      if (value !== undefined) properties[key] = value;
      else if (!descendants(prop, budget).some(child => child.tag === "XLink")) unsupported++;
    }
    objects.push({ name, label, type_id, children, properties, material: stringValue(map.get("Material")) ?? null,
      placement: placement(map.get("Placement")), is_valid_bom_item: validBom(type_id), level: 0 });
    for (const link of descendants(node, budget).filter(child => child.tag === "XLink")) {
      // Preserve every instance, including modern PropertyXLink/LinkedObject nesting.
      if (link.attrs.file !== undefined) xlinks.push({ file: link.attrs.file, label: link.attrs.label ?? label });
    }
  }
  const parents = new Set(objects.flatMap(object => [...object.children]));
  const root_names = objects.filter(object => object.is_valid_bom_item && object.type_id !== "App::Link" && !parents.has(object.name)).map(object => object.name);
  const byName = new Map(objects.map(object => [object.name, object]));
  const visited = new Set<string>(); const queue = root_names.map(name => ({ name, level: 0 }));
  for (let i = 0; i < queue.length; i++) {
    if (i % 256 === 0) assertCadObjectInfoActive(signal, budget);
    const current = queue[i]; if (visited.has(current.name)) continue;
    visited.add(current.name); const object = byName.get(current.name); if (!object) continue;
    object.level = current.level;
    for (const name of object.children) if (!visited.has(name)) queue.push({ name, level: current.level + 1 });
  }
  // Detect cycles separately from BFS: a reachable cycle still gets finite first-arrival levels.
  const colors = new Map<string, number>(); let cyclic = false;
  for (const start of objects) {
    if (colors.has(start.name) || cyclic) continue;
    const stack = [{ object: start, index: 0 }]; colors.set(start.name, 1);
    while (stack.length && !cyclic) {
      assertCadObjectInfoActive(signal, budget);
      const frame = stack.at(-1)!;
      if (frame.index >= frame.object.children.length) { colors.set(frame.object.name, 2); stack.pop(); continue; }
      const child = byName.get(frame.object.children[frame.index++]); if (!child) continue;
      if (colors.get(child.name) === 1) cyclic = true;
      else if (!colors.has(child.name)) { colors.set(child.name, 1); stack.push({ object: child, index: 0 }); }
    }
  }
  const warnings: string[] = [];
  if (unsupported) warnings.push(`${unsupported} 个非字符串/数值属性未投影到 v1 properties；未转换为 0`);
  if (objects.some(object => object.children.some(name => !byName.has(name)))) warnings.push("Group 中有未声明的子对象，保留原始引用名称");
  if (cyclic) warnings.push("Group 存在循环引用；level 仅为从 BOM 根广度优先首次到达的深度");
  if (objects.some(object => parents.has(object.name) && !visited.has(object.name))) warnings.push("有未从 BOM 根到达的对象（可能为环或非 BOM 分组），level 保持 0；对象仍完整保留");
  const document: PnwCadNativeV1FcstdDocument = { objects, xlinks, root_names };
  if (!pnwIsCadNativeV1FcstdDocument(document)) throw new CadObjectInfoError("invalid_document_xml", "对象文档不符合 Wing native v1 契约");
  assertCadObjectInfoActive(signal, budget);
  return { document, warnings };
}
