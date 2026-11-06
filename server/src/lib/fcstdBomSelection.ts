import { fcstdXmlObjects, isFcstdObjectName, xmlAttribute } from "./fcstdLinkIdentity.js";

/** Registry/local Wing currently prefer Body over a native assembly. This
 * bounded Host policy scopes Wing's existing field reader/writer to the actual
 * root Assembly::AssemblyObject. It never creates, renames or removes objects.
 * Remove the compatibility scope once the shared selector has this policy. */
export function fcstdBomSelectionXml(xml: string): { xml: string; nativeAssembly: boolean } {
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => " ".repeat(text.length));
  const declarations = /<Objects\b[^>]*>([\s\S]*?)<\/Objects>/i.exec(semantic)?.[1] || "";
  const tags = [...declarations.matchAll(/<Object\b[^>]*>/g)].map(match => match[0]);
  const nativeNames = tags.filter(tag => xmlAttribute(tag, "type") === "Assembly::AssemblyObject").map(tag => xmlAttribute(tag, "name"));
  const data = /<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/i.exec(semantic)?.[1] || "";
  for (const match of data.matchAll(/<Object\b[^>]*>/g)) {
    if (xmlAttribute(match[0], "type") === "Assembly::AssemblyObject" && !nativeNames.includes(xmlAttribute(match[0], "name"))) nativeNames.push(xmlAttribute(match[0], "name"));
  }
  if (!nativeNames.length) {
    // Joints/JointGroup are infrastructure, not BOM roots. Only the probe is
    // masked; the writer transplants one patched object into the original XML.
    return { xml: semantic.replace(/<Object\b[^>]*>/g, tag => tag.replace(/\btype\s*=\s*(["'])Assembly::(?:JointGroup|Joint)\1/, 'type="App::Feature"')), nativeAssembly: false };
  }
  const objects = fcstdXmlObjects(semantic);
  const byName = new Map(objects.map(object => [object.name, object]));
  const children = new Map<string, string[]>();
  for (const object of objects) {
    const group = object.properties.get("Group");
    if (group?.type === "App::PropertyLinkList") children.set(object.name, [...group.content.matchAll(/<Link\b[^>]*>/g)].map(([tag]) => xmlAttribute(tag, "value") || xmlAttribute(tag, "name")).filter(Boolean));
  }
  const invalid = (): never => { throw new Error("装配根对象结构不完整或不一致，请在 FreeCAD 中确认后重新读取；未改写文件"); };
  for (const name of nativeNames) {
    if (!isFcstdObjectName(name) || !byName.has(name)) invalid();
    const declared = tags.filter(tag => xmlAttribute(tag, "name") === name);
    const serialized = [...data.matchAll(/<Object\b[^>]*>/g)].filter(([tag]) => xmlAttribute(tag, "name") === name);
    if (declared.length > 1 || serialized.length !== 1 || declared.some(tag => xmlAttribute(tag, "type") !== "Assembly::AssemblyObject") || serialized.some(([tag]) => xmlAttribute(tag, "type") && xmlAttribute(tag, "type") !== "Assembly::AssemblyObject")) invalid();
    const walk = (node: string, visiting: Set<string>, visited: Set<string>) => {
      if (visiting.has(node)) invalid();
      if (visited.has(node)) return;
      visiting.add(node);
      for (const child of children.get(node) || []) walk(child, visiting, visited);
      visiting.delete(node); visited.add(node);
    };
    walk(name, new Set(), new Set());
  }
  const owned = new Set([...children.values()].flat());
  const roots = nativeNames.filter(name => !owned.has(name));
  if (roots.length > 1) throw new Error(`检测到多个独立装配根对象：${roots.join("、")}；无法安全选择，未改写文件`);
  if (!roots.length) return { xml: semantic, nativeAssembly: false };
  const name = roots[0];
  const block = new RegExp(`<Object\\b([^>]*?)(?<!\\/)>([\\s\\S]*?)<\\/Object>`, "g");
  const target = [...data.matchAll(block)].find(match => xmlAttribute(match[1], "name") === name)?.[0];
  if (!target) invalid();
  // All unrelated objects remain in the original document, not this scope.
  return { xml: `<Document><Objects><Object name="${name}" type="Assembly::AssemblyObject"/></Objects><ObjectData>${target}</ObjectData></Document>`, nativeAssembly: true };
}
