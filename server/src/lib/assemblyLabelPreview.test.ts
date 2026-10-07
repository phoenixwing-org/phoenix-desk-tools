import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { buildHostObjectAssemblyTree } from "./assemblyLabelPreview.js";
import { fcstdLinkInstances, fcstdXmlObjects, objectString } from "./fcstdLinkIdentity.js";
import { patchFcstdReferenceLabels, patchReferenceLabelsInDocumentXml } from "./fcstdReferenceLabelService.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const prop = (name: string, value: string) => `<Property name="${name}" type="App::PropertyString"><String value="${value}"/></Property>`;
const group = (names: string[]) => `<Property name="Group" type="App::PropertyLinkList"><LinkList>${names.map(name => `<Link value="${name}"/>`).join("")}</LinkList></Property>`;
const obj = (name: string, label: string, extra = "") => `<Object name="${name}"><Properties>${prop("Label", label)}${extra}</Properties></Object>`;
const link = (file: string, name: string, property = "LinkedObject") => `<Property name="${property}" type="App::PropertyXLink"><XLink name="${name}" stamp="1" file="${file}"/></Property>`;
const doc = (...objects: string[]) => `<Document><ObjectData>${objects.join("")}</ObjectData></Document>`;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assembly-object-labels-")); dirs.push(dir);
  const source = doc(obj("PartA", "DEMO-A.001-零件甲"), obj("PartB", "DEMO-B.001-零件乙"));
  const projection = doc(obj("Projected", "wrong projection", link("parts.FCStd", "PartA")));
  // Declaration order is deliberately unlike Group/tree order.
  const xml = doc(obj("Root", "总成", group(["A1", "A2", "B", "Sub"])),
    obj("A2", "wrong", link("parts.FCStd", "PartA")),
    obj("B", "wrong", link("parts.FCStd", "PartB") + link("parts.FCStd", "PartA", "LinkCopyOnChangeSource")),
    obj("A1", "wrong", link("projection.FCStd", "Projected")),
    obj("Sub", "本地分组", group(["A3"])), obj("A3", "wrong", link("parts.FCStd", "PartA")));
  for (const [name, content] of [["host.FCStd", xml], ["parts.FCStd", source], ["projection.FCStd", projection]]) {
    fs.writeFileSync(path.join(dir, name), zipSync({ "Document.xml": strToU8(content), "GuiDocument.xml": strToU8("untouched") }));
  }
  const indexed = ["parts.FCStd", "projection.FCStd"].map(file => ({ id: file, host_repo_rel: "./host.FCStd", repo_rel_path: file,
    resolve_status: "resolved", xlink_file_attr: file, basename: file, link_label: "misleading index label", rule_label: "WRONG FILE ROOT", children: [] }));
  return { dir, xml, indexed };
}

describe("assembly object label preview and exact writes", () => {
  it("shows actual host labels, preserves Group order, counts siblings and numbers each level separately", () => {
    const { dir, indexed } = fixture();
    const before = fs.readFileSync(path.join(dir, "host.FCStd"));
    const tree = buildHostObjectAssemblyTree(dir, "./host.FCStd", indexed)!;
    expect(tree.structure_source).toBe("host_objects");
    expect(tree.nodes.map(node => node.host_object_name)).toEqual(["A1", "B", "Sub"]);
    expect(tree.nodes[0]).toMatchObject({ link_label: "wrong", ref_count: 2 });
    expect(tree.nodes[0].xref_instances?.[0]).toMatchObject({
      resolved_target_repo_rel: "parts.FCStd", resolved_target_object_name: "PartA", direct_target_repo_rel: "projection.FCStd",
    });
    expect(tree.nodes[0].repo_rel_path).toBe("projection.FCStd"); // Direct path stays available for relinking.
    expect(tree.nodes[0].xref_instances?.[1]).toMatchObject({ resolved_target_repo_rel: "parts.FCStd", direct_target_repo_rel: "parts.FCStd" });
    expect(tree.nodes[0].xref_instances?.map((i: any) => [i.host_object_name, i.rule_label])).toEqual([
      ["A1", "DEMO-A.001-零件甲.001"], ["A2", "DEMO-A.001-零件甲.002"],
    ]);
    expect(tree.nodes[1].rule_label).toBe("DEMO-B.001-零件乙");
    expect(tree.nodes[2].children?.[0].rule_label).toBe("DEMO-A.001-零件甲");
    expect(fs.readFileSync(path.join(dir, "host.FCStd"))).toEqual(before);
  });

  it("applies only the selected host object, never siblings, target file or other XLink properties", () => {
    const { dir, xml, indexed } = fixture();
    const tree = buildHostObjectAssemblyTree(dir, "./host.FCStd", indexed)!;
    const selected = tree.nodes[0].xref_instances![1] as any;
    const sourceBefore = fs.readFileSync(path.join(dir, "parts.FCStd"));
    const backup = path.join(dir, "backup", "host.FCStd");
    const result = patchFcstdReferenceLabels(path.join(dir, "host.FCStd"), [{ ...selected, old_label: selected.link_label, link_label: selected.rule_label }], backup);
    expect(result.count).toBe(1);
    expect(result.changes[0]).toMatchObject({ host_object_name: "A2", target_object_name: "PartA", new_label: "DEMO-A.001-零件甲.002" });
    const patched = patchReferenceLabelsInDocumentXml(xml, [{ ...selected, old_label: selected.link_label, link_label: selected.rule_label }]).xml;
    expect(fcstdXmlObjects(patched).map(o => [o.name, objectString(o, "Label")])).toContainEqual(["B", "wrong"]);
    expect(patched).toContain(link("parts.FCStd", "PartA", "LinkCopyOnChangeSource"));
    expect(fs.readFileSync(path.join(dir, "parts.FCStd"))).toEqual(sourceBefore);
    expect(fs.existsSync(backup)).toBe(true);
  });

  it("rejects file-wide root stamping when the same file supplies different objects", () => {
    const { xml } = fixture();
    expect(() => patchReferenceLabelsInDocumentXml(xml, { "parts.FCStd": "wrong root" })).toThrow("多个目标对象");
  });

  it("rejects stale, conflicting and missing object patches before writing anything", () => {
    const { xml } = fixture();
    const instance = fcstdLinkInstances(xml).find(i => i.host_object_name === "B")!;
    const patch = { ...instance, old_label: "wrong", link_label: "new" };
    expect(() => patchReferenceLabelsInDocumentXml(xml, [{ ...patch, old_label: "old snapshot" }])).toThrow("其他操作修改");
    expect(() => patchReferenceLabelsInDocumentXml(xml, [{ ...patch, target_object_name: "Other" }])).toThrow("已变化");
    expect(() => patchReferenceLabelsInDocumentXml(xml, [patch, { ...patch, link_label: "conflict" }])).toThrow("冲突");
    expect(() => patchReferenceLabelsInDocumentXml(xml, [{ ...patch, document_hash: "stale hierarchy" }])).toThrow("总成内容已变化");
  });

  it("does not derive a named missing target from the file root, and stops cyclic links", () => {
    const { dir, indexed } = fixture();
    fs.writeFileSync(path.join(dir, "parts.FCStd"), zipSync({ "Document.xml": strToU8(doc(obj("PartA", "wrong", link("parts.FCStd", "PartA")))) }));
    const tree = buildHostObjectAssemblyTree(dir, "./host.FCStd", indexed)!;
    const instances = tree.nodes.flatMap(n => n.xref_instances ?? []) as any[];
    expect(instances.every(instance => !instance.rule_label)).toBe(true);
    expect(instances.every(instance => instance.rule_error.includes("目标对象"))).toBe(true);
  });

  it("decodes escaped file/object identities and preserves quoted labels", () => {
    const xml = doc(obj("Node&amp;1", "old", link("A&amp;B.FCStd", "Part&quot;A")));
    const instance = fcstdLinkInstances(xml)[0];
    expect(instance).toMatchObject({ host_object_name: "Node&1", target_object_name: 'Part"A', xlink_file_attr: "A&B.FCStd" });
    const result = patchReferenceLabelsInDocumentXml(xml, [{ ...instance, old_label: "old", link_label: 'A&B "Label"' }]);
    expect(result.xml).toContain('value="A&amp;B &quot;Label&quot;"');
    const singleQuoted = xml.replace('value="old"', "value='old'");
    const quoted = patchReferenceLabelsInDocumentXml(singleQuoted, [{ ...instance, old_label: "old", link_label: "O'Brien" }]);
    expect(quoted.xml).toContain("value='O&apos;Brien'");
    expect(fcstdLinkInstances(quoted.xml)[0].link_label).toBe("O'Brien");
  });
});
