import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { patchBomLinkLabels } from "./pnwBomXrefService.js";
import { fcstdLinkInstances } from "./fcstdLinkIdentity.js";
import { inspectIncomingObjectLabels, verifyIncomingLabelSources, verifyIncomingObjectLabels } from "./renameObjectLabelPlan.js";
import * as archiveReader from "./fcstdBatchFiles.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });
const property = (label: string) => `<Property name="Label" type="App::PropertyString"><String value="${label}"/></Property>`;
const group = (names: string[]) => `<Property name="Group" type="App::PropertyLinkList"><LinkList>${names.map(name => `<Link value="${name}"/>`).join("")}</LinkList></Property>`;
const linked = (name: string, target: string, file = "../parts/Model.FCStd") => `<Object name="${name}"><Properties>${property("old")}<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="${target}" stamp="kept"/></Property></Properties></Object>`;
const object = (name: string, label: string, extra = "") => `<Object name="${name}"><Properties>${property(label)}${extra}</Properties></Object>`;
function doc(objects: string[], declarations: Array<[string, string]>) {
  return `<Document><Objects>${declarations.map(([name, type]) => `<Object name="${name}" type="${type}"/>`).join("")}</Objects><ObjectData>${objects.join("")}</ObjectData></Document>`;
}
function save(root: string, rel: string, xml: string) {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml), "GuiDocument.xml": strToU8("opaque gui"), "shape.brp": strToU8("opaque geometry") }));
}
const bytes = (root: string, rel: string) => fs.readFileSync(path.join(root, rel));
const xml = (root: string, rel: string) => strFromU8(unzipSync(bytes(root, rel))["Document.xml"]);
const source = { xlink_file_attr: "../parts/Model.FCStd", target_repo_rel_path: "parts/Model.FCStd", resolve_status: "resolved" };
const host = "hosts/Scene.ASSY.FCStd";
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rename-object-plan-")); roots.push(root);
  save(root, "parts/Model.FCStd", doc([object("Body", "Display A"), object("Branch", "Display B")], [["Body", "PartDesign::Body"], ["Branch", "PartDesign::Body"]]));
  save(root, "parts/Other.FCStd", doc([object("Body", "Other display")], [["Body", "PartDesign::Body"]]));
  // Declaration order differs from Group order; third is a different level.
  save(root, host, doc([object("Root", "Host", group(["First", "Second", "BranchLink", "Other", "Sub"])),
    linked("Second", "Body"), linked("BranchLink", "Branch"), linked("First", "Body"),
    linked("Other", "Body", "../parts/Other.FCStd"), object("Sub", "Local", group(["Third"])), linked("Third", "Body")],
    [["Root", "App::Part"], ["Second", "App::Link"], ["BranchLink", "App::Link"], ["First", "App::Link"], ["Other", "App::Link"], ["Sub", "App::Part"], ["Third", "App::Link"]]));
  await scanCadWorkspaceIndex(root);
  return root;
}

describe("incoming rename object labels", () => {
  it("reuses live object and sibling rules while keeping unrelated links, paths, source files and opaque entries unchanged", async () => {
    const root = await fixture(), before = bytes(root, host), modelBefore = bytes(root, "parts/Model.FCStd");
    const plan = inspectIncomingObjectLabels(root, host, [source], [source.target_repo_rel_path]);
    expect(plan.expectations.map(patch => [patch.host_object_name, patch.target_object_name, patch.link_label])).toEqual([
      ["Second", "Body", "Display A.002"], ["BranchLink", "Branch", "Display B"], ["First", "Body", "Display A.001"], ["Third", "Body", "Display A"],
    ]);
    expect(bytes(root, host)).toEqual(before);
    const applied = patchBomLinkLabels(root, plan.patches.map(patch => ({ host_repo_rel: host, ...patch })));
    expect(applied).toMatchObject({ label_patches: 4, failed: [] });
    expect(() => verifyIncomingObjectLabels(root, host, plan.expectations)).not.toThrow();
    const labels = fcstdLinkInstances(xml(root, host));
    expect(labels.find(link => link.host_object_name === "Other")?.link_label).toBe("old");
    expect(labels.every(link => link.xlink_file_attr === (link.host_object_name === "Other" ? "../parts/Other.FCStd" : source.xlink_file_attr))).toBe(true);
    expect(xml(root, host)).toContain('stamp="kept"');
    expect(bytes(root, "parts/Model.FCStd")).toEqual(modelBefore);
    expect(unzipSync(bytes(root, host))["shape.brp"]).toEqual(unzipSync(before)["shape.brp"]);
    expect(unzipSync(bytes(root, host))["GuiDocument.xml"]).toEqual(unzipSync(before)["GuiDocument.xml"]);
    expect(inspectIncomingObjectLabels(root, host, [source]).patches).toEqual([]);
  });

  it("ignores an unresolved unrelated instance, but rejects an affected missing named object without root fallback", async () => {
    const root = await fixture();
    save(root, "parts/Other.FCStd", doc([], []));
    expect(inspectIncomingObjectLabels(root, host, [source]).patches).toHaveLength(4);
    save(root, "parts/Model.FCStd", doc([object("Body", "Display A")], [["Body", "PartDesign::Body"]]));
    const before = bytes(root, host);
    expect(() => inspectIncomingObjectLabels(root, host, [source])).toThrow(/无法安全推荐/);
    expect(bytes(root, host)).toEqual(before);
  });

  it("rejects ambiguous indexed identity and a same-basename target outside the exact rename scope", async () => {
    const root = await fixture();
    expect(() => inspectIncomingObjectLabels(root, host, [{ ...source, resolve_status: "ambiguous" }])).toThrow(/未唯一解析/);
    expect(() => inspectIncomingObjectLabels(root, host, [source], ["elsewhere/Model.FCStd"])).toThrow(/本次改名对象/);
  });

  it("keeps the host XML hash guard and verifies the exact identity rather than an aggregated file rule", async () => {
    const root = await fixture(), plan = inspectIncomingObjectLabels(root, host, [source]);
    save(root, host, xml(root, host).replace('value="Host"', 'value="external host edit"'));
    const changed = bytes(root, host);
    expect(patchBomLinkLabels(root, plan.patches.map(patch => ({ host_repo_rel: host, ...patch }))).failed).toEqual([
      expect.objectContaining({ error: expect.stringContaining("总成内容已变化") }),
    ]);
    expect(bytes(root, host)).toEqual(changed);
    expect(() => verifyIncomingObjectLabels(root, host, plan.expectations)).toThrow(/预期一致/);
  });

  it("allows one nameless link only after proving a unique actual root and rejects multiple roots or repeated nameless instances", async () => {
    const root = await fixture();
    save(root, host, doc([linked("Legacy", "")], [["Legacy", "App::Link"]]));
    expect(() => inspectIncomingObjectLabels(root, host, [source])).toThrow();
    save(root, "parts/Model.FCStd", doc([object("Body", "Unique display")], [["Body", "PartDesign::Body"]]));
    expect(inspectIncomingObjectLabels(root, host, [source]).patches).toEqual([
      expect.objectContaining({ host_object_name: "Legacy", target_object_name: "", link_label: "Unique display" }),
    ]);
    save(root, host, doc([linked("Legacy", ""), linked("LegacyAgain", "")], [["Legacy", "App::Link"], ["LegacyAgain", "App::Link"]]));
    expect(() => inspectIncomingObjectLabels(root, host, [source])).toThrow(/重复实例缺少目标对象身份/);
  });

  it("rejects a stale basename-resolved nameless edge when the actual reference now names another file", async () => {
    const root = await fixture(), attr = "../elsewhere/Model.FCStd";
    save(root, "parts/Model.FCStd", doc([object("Body", "Unique display")], [["Body", "PartDesign::Body"]]));
    save(root, host, doc([linked("Legacy", "", attr)], [["Legacy", "App::Link"]]));
    await scanCadWorkspaceIndex(root);
    const db = pnwCreateDb(path.join(root, ".phoenix/phoenix-workspace.sqlite"));
    let edge: typeof source;
    try { edge = db.get<typeof source>("SELECT xlink_file_attr,target_repo_rel_path,resolve_status FROM phoenix_cad_bom_xref WHERE host_repo_rel_path IN (?,?) AND xlink_file_attr = ?", [host, `./${host}`, attr])!; }
    finally { db.close(); }
    expect(edge).toMatchObject({ xlink_file_attr: attr, resolve_status: "resolved" });
    expect(edge.target_repo_rel_path.replace(/^\.\//, "")).toBe("parts/Model.FCStd");
    // The host has not changed, but the previously absent real path appears.
    save(root, "elsewhere/Model.FCStd", doc([object("Body", "Different source")], [["Body", "PartDesign::Body"]]));
    const before = bytes(root, host), intendedBefore = bytes(root, "parts/Model.FCStd");
    expect(() => inspectIncomingObjectLabels(root, host, [edge], ["parts/Model.FCStd"])).toThrow(/真实引用路径与索引目标不一致/);
    expect(bytes(root, host)).toEqual(before);
    expect(bytes(root, "parts/Model.FCStd")).toEqual(intendedBefore);
  });

  it("never certifies a changed target object or XLink path from an earlier exact expectation", async () => {
    const root = await fixture(), plan = inspectIncomingObjectLabels(root, host, [source]);
    save(root, host, xml(root, host).replace('name="Body" stamp="kept"', 'name="OtherBody" stamp="kept"'));
    expect(() => verifyIncomingObjectLabels(root, host, plan.expectations)).toThrow(/预期一致/);
  });

  it("binds chained projection labels to their actual source bytes, not just the direct renamed file", async () => {
    const root = await fixture();
    save(root, "parts/Leaf.FCStd", doc([object("Final", "Leaf display")], [["Final", "PartDesign::Body"]]));
    save(root, "parts/Model.FCStd", doc([object("Body", "projection label", '<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Leaf.FCStd" name="Final"/></Property>'), object("Branch", "Display B")], [["Body", "App::Link"], ["Branch", "PartDesign::Body"]]));
    const before = bytes(root, host);
    const plan = inspectIncomingObjectLabels(root, host, [source]);
    expect(plan.expectations.find(patch => patch.host_object_name === "First")?.link_label).toBe("Leaf display.001");
    expect(plan.sources.map(item => item.repo_rel_path)).toEqual(expect.arrayContaining(["parts/Model.FCStd", "parts/Leaf.FCStd", "parts/Other.FCStd"]));
    expect(() => verifyIncomingLabelSources(root, plan)).not.toThrow();
    save(root, "parts/Leaf.FCStd", doc([object("Final", "changed leaf")], [["Final", "PartDesign::Body"]]));
    expect(() => verifyIncomingLabelSources(root, plan)).toThrow(/源模型.*已变化/);
    expect(bytes(root, host)).toEqual(before);
  });

  it("rejects target drift while the live recommendation is being projected, before returning a plan", async () => {
    const root = await fixture(), before = bytes(root, host);
    const actual = archiveReader.readFcstdBatchArchive;
    let changed = false;
    vi.spyOn(archiveReader, "readFcstdBatchArchive").mockImplementation((filename, all) => {
      const archive = actual(filename, all);
      if (filename.endsWith("/parts/Model.FCStd") && !changed) {
        changed = true;
        save(root, "parts/Model.FCStd", archive.xml.replace('value="Display A"', 'value="changed source"'));
      }
      return archive;
    });
    expect(() => inspectIncomingObjectLabels(root, host, [source])).toThrow(/源模型.*已变化/);
    expect(bytes(root, host)).toEqual(before);
    expect(xml(root, "parts/Model.FCStd")).toContain('value="changed source"');
  });
});
