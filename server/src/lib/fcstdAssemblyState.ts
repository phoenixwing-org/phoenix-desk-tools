import { decodeCadXmlAttribute } from "../features/cad-object-info/document.js";
import { fcstdXmlObjects } from "./fcstdLinkIdentity.js";

/** Saved per-instance intent, not the solver state or a file-wide property. */
export type FcstdAssemblyLinkState = {
  object_name: string;
  label: string;
  target_object_name: string | null;
  target_file: string | null;
  rigid: boolean | null;
};
export type FcstdAssemblyJointIssue = {
  object_name: string;
  label: string;
  reference: "Reference1" | "Reference2";
  reason: "empty_reference" | "missing_local_object";
  target_object_name: string | null;
};

const tagPattern = (name: string) => new RegExp(`<${name}\\b(?:[^"'>]|"[^"]*"|'[^']*')*>`, "g");
function attr(tag: string, key: string): string | undefined {
  const value = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag)?.[2];
  return value === undefined ? undefined : decodeCadXmlAttribute(value.replace(/[\t\n\r]/g, " "));
}

/** Call after the host's bounded Document.xml validation. Never follows links. */
export function readFcstdAssemblyState(xml: string): { links: FcstdAssemblyLinkState[]; joint_issues: FcstdAssemblyJointIssue[] } {
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, value => " ".repeat(value.length));
  const types = new Map<string, Set<string>>();
  for (const [tag] of semantic.matchAll(tagPattern("Object"))) {
    const name = attr(tag, "name"), type = attr(tag, "type");
    if (!name || !type) continue;
    const found = types.get(name) || new Set<string>(); found.add(type); types.set(name, found);
  }
  const rows: FcstdAssemblyLinkState[] = [];
  const objects = fcstdXmlObjects(semantic);
  for (const object of objects) {
    const declared = types.get(object.name);
    if (declared?.size !== 1 || !declared.has("Assembly::AssemblyLink")) continue;
    const strings = [...(object.properties.get("Label")?.content || "").matchAll(tagPattern("String"))];
    const label = strings.length === 1 ? attr(strings[0][0], "value") ?? object.name : object.name;
    const property = object.properties.get("Rigid");
    const bools = [...(property?.content || "").matchAll(tagPattern("Bool"))];
    const saved = property?.type === "App::PropertyBool" && bools.length === 1 ? attr(bools[0][0], "value") : undefined;
    // Missing, differently typed or malformed values are not the default true.
    const rigid = saved === "true" || saved === "1" ? true : saved === "false" || saved === "0" ? false : null;
    const linked = object.properties.get("LinkedObject");
    const links = /^App::PropertyXLink(?:Sub)?$/.test(linked?.type || "")
      ? [...(linked?.content || "").matchAll(tagPattern("XLink"))] : [];
    rows.push({ object_name: object.name, label,
      target_object_name: links.length === 1 ? attr(links[0][0], "name") || null : null,
      target_file: links.length === 1 ? attr(links[0][0], "file") || null : null,
      rigid });
  }
  const jointIssues: FcstdAssemblyJointIssue[] = [];
  const savedNames = new Set([...types.keys(), ...objects.map(object => object.name)]);
  for (const object of objects) {
    if (types.get(object.name)?.size !== 1 || !types.get(object.name)?.has("App::FeaturePython")) continue;
    const proxies = [...(object.properties.get("Proxy")?.content || "").matchAll(tagPattern("Python"))];
    // Do not label arbitrary Reference1/2 properties or legacy migrations as
    // broken joints. This is a narrow saved-state check, not native solving.
    if (proxies.length !== 1 || attr(proxies[0][0], "module") !== "JointObject" || attr(proxies[0][0], "class") !== "Joint") continue;
    const labelTag = [...(object.properties.get("Label")?.content || "").matchAll(tagPattern("String"))];
    const label = labelTag.length === 1 ? attr(labelTag[0][0], "value") ?? object.name : object.name;
    for (const reference of ["Reference1", "Reference2"] as const) {
      const property = object.properties.get(reference);
      if (property?.type !== "App::PropertyXLinkSub") continue;
      const links = [...property.content.matchAll(tagPattern("XLink"))];
      if (links.length !== 1) continue;
      const name = attr(links[0][0], "name"), file = attr(links[0][0], "file");
      if (name === "") jointIssues.push({ object_name: object.name, label, reference, reason: "empty_reference", target_object_name: null });
      else if (name && file === "" && !savedNames.has(name)) jointIssues.push({ object_name: object.name, label, reference, reason: "missing_local_object", target_object_name: name });
    }
  }
  return { links: rows, joint_issues: jointIssues };
}

export const readFcstdAssemblyLinks = (xml: string) => readFcstdAssemblyState(xml).links;
