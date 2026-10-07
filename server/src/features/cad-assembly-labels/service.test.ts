import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { scanCadWorkspaceIndex } from "../../lib/cadIndexScanService.js";
import * as xref from "../../lib/pnwBomXrefService.js";
import { fcstdLinkInstances } from "../../lib/fcstdLinkIdentity.js";
import { getAssemblyLabelJob, previewAssemblyLabels, startAssemblyLabelJob, type LabelJob } from "./service.js";
import { assemblyLabelRoutes } from "./routes.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const prop = (name: string, value: string) => `<Property name="${name}" type="App::PropertyString"><String value="${value}"/></Property>`;
function model(host = false, label = "DEMO.001-示例件") {
  const names = host ? ["Root", "A2", "B", "A1"] : ["Body", "PartB"];
  return `<Document><Objects>${names.map(name => `<Object name="${name}" type="${name === "Root" ? "App::Part" : name.startsWith("A") || name === "B" ? "App::Link" : "PartDesign::Body"}"/>`).join("")}</Objects><ObjectData>${names.map(name => {
    const primary = name === "Root" || name === "Body";
    const extra = primary ? prop("PartNumber", host ? "DEMO-HOST" : "DEMO") + prop("PartVersion", "001") + prop("PartName", "示例") + prop("TypeCode", "H") : "";
    const group = name === "Root" ? '<Property name="Group" type="App::PropertyLinkList"><LinkList count="3"><Link value="A1"/><Link value="A2"/><Link value="B"/></LinkList></Property>' : "";
    const link = host && name !== "Root" ? `<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="../parts/Part.FCStd" name="${name === "B" ? "PartB" : "Body"}" stamp="unchanged-stamp"/></Property>` : "";
    return `<Object name="${name}"><Properties>${prop("Label", host ? name === "Root" ? "主总成" : "错误的总成名" : name === "Body" ? label : "DEMO-B.001-示例乙")}${extra}${group}${link}</Properties></Object>`;
  }).join("")}</ObjectData></Document>`;
}
function save(root: string, rel: string, xml: string) {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml), "shape.brp": strToU8("untouched geometry"), "GuiDocument.xml": strToU8("untouched gui") }));
}
const bytes = (root: string, rel: string) => fs.readFileSync(path.join(root, rel));
const xml = (root: string, rel: string) => strFromU8(unzipSync(bytes(root, rel))["Document.xml"]);
async function fixture(index = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-label-batch-")); roots.push(root);
  save(root, "parts/Part.FCStd", model());
  for (const name of ["A", "B", "C"]) save(root, `assemblies/${name}.ASSY.FCStd`, model(true));
  if (index) await scanCadWorkspaceIndex(root);
  return root;
}
async function wait(root: string, job: LabelJob) {
  for (let i = 0; i < 500 && job.state === "running"; i++) { await nextTurn(); job = getAssemblyLabelJob(root, job.id); }
  expect(job.state).not.toBe("running"); return job;
}

it("previews one row per ASSY with actual instance counts, without writing any CAD file", async () => {
  const root = await fixture(), before = bytes(root, "assemblies/A.ASSY.FCStd");
  const preview = await previewAssemblyLabels(root, { batch_dir: "." });
  expect(preview.rows).toHaveLength(3);
  expect(preview.rows.every(row => row.pending === 3 && row.total === 3 && row.eligible)).toBe(true);
  expect(bytes(root, "assemblies/A.ASSY.FCStd")).toEqual(before);
  expect(fs.existsSync(path.join(root, ".phoenix/reference-label-backups"))).toBe(false);
  expect(() => startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: [preview.rows[0].rel] })).toThrow("明确确认");
  expect(() => startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: ["parts/Part.FCStd"], confirmed: true })).toThrow("可修正");
});

it("applies only selected hosts with the single-host writer, ordered duplicates and one final local index refresh", async () => {
  const root = await fixture(), source = bytes(root, "parts/Part.FCStd"), skipped = bytes(root, "assemblies/C.ASSY.FCStd"), before = bytes(root, "assemblies/A.ASSY.FCStd");
  const refresh = vi.spyOn(xref, "refreshBomXrefsForHosts"), writer = vi.spyOn(xref, "patchBomLinkLabels");
  const preview = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  const job = await wait(root, startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: preview.rows.slice(0, 2).map(row => row.rel), confirmed: true }));
  expect(job).toMatchObject({ state: "done", completed: 2, index_state: "updated" });
  expect(job.results.map(row => row.count)).toEqual([3, 3]);
  expect(writer).toHaveBeenCalledTimes(2); expect(writer.mock.calls.every(call => call[2]?.refreshIndex === false)).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1); expect(refresh.mock.calls[0][1]).toHaveLength(2);
  const links = fcstdLinkInstances(xml(root, "assemblies/A.ASSY.FCStd"));
  expect(links.map(link => [link.host_object_name, link.link_label])).toEqual([["A2", "DEMO.001-示例件.002"], ["B", "DEMO-B.001-示例乙"], ["A1", "DEMO.001-示例件.001"]]);
  expect(links.every(link => link.xlink_file_attr === "../parts/Part.FCStd")).toBe(true);
  expect(xml(root, "assemblies/A.ASSY.FCStd")).toContain('stamp="unchanged-stamp"');
  expect(bytes(root, "parts/Part.FCStd")).toEqual(source); expect(bytes(root, "assemblies/C.ASSY.FCStd")).toEqual(skipped);
  expect(bytes(root, job.results[0].backup!)).toEqual(before);
  expect(unzipSync(bytes(root, "assemblies/A.ASSY.FCStd"))["shape.brp"]).toEqual(unzipSync(before)["shape.brp"]);
  expect(() => startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: [preview.rows[0].rel], confirmed: true })).toThrow("失效");
  const after = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  expect(after.rows.map(row => row.pending)).toEqual([0, 0, 3]);
});

it("rejects a stale host without losing another selected host result", async () => {
  const root = await fixture(), preview = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  save(root, preview.rows[0].rel, model(true).replace("主总成", "用户改动"));
  const changed = bytes(root, preview.rows[0].rel);
  const job = await wait(root, startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: preview.rows.slice(0, 2).map(row => row.rel), confirmed: true }));
  expect(job.state).toBe("attention"); expect(job.results.map(row => row.status)).toEqual(["failed", "written"]);
  expect(job.results[0].message).toContain("总成已变化"); expect(bytes(root, preview.rows[0].rel)).toEqual(changed);
});

it("rejects changed target recommendations and does not refresh an unchanged batch", async () => {
  const root = await fixture(), preview = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  const before = bytes(root, preview.rows[0].rel), refresh = vi.spyOn(xref, "refreshBomXrefsForHosts");
  save(root, "parts/Part.FCStd", model(false, "changed target"));
  const job = await wait(root, startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: [preview.rows[0].rel], confirmed: true }));
  expect(job).toMatchObject({ state: "attention", index_state: "not_needed" });
  expect(job.results[0].message).toContain("推荐发生变化"); expect(bytes(root, preview.rows[0].rel)).toEqual(before); expect(refresh).not.toHaveBeenCalled();
});

it("reports missing index, missing targets and unreadable ASSY files as blocked, never normal", async () => {
  const root = await fixture(false);
  let preview = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  expect(preview.rows.every(row => !row.eligible && row.message.includes("缺少 CAD"))).toBe(true);
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
  await scanCadWorkspaceIndex(root);
  fs.unlinkSync(path.join(root, "parts/Part.FCStd"));
  fs.writeFileSync(path.join(root, "assemblies/B.ASSY.FCStd"), "broken zip");
  preview = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  expect(preview.rows.every(row => !row.eligible && row.status === "needs_review")).toBe(true);
});

it("binds plans/jobs to a workspace, refuses duplicate active jobs and preserves writes if index refresh fails", async () => {
  const root = await fixture(), other = await fixture(false), preview = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  expect(() => startAssemblyLabelJob(other, { plan_id: preview.plan_id, rels: [preview.rows[0].rel], confirmed: true })).toThrow("工作空间");
  const second = await previewAssemblyLabels(root, { batch_dir: "assemblies" });
  vi.spyOn(xref, "refreshBomXrefsForHosts").mockImplementation(() => { throw new Error("synthetic index failure"); });
  const pending = startAssemblyLabelJob(root, { plan_id: preview.plan_id, rels: [preview.rows[0].rel], confirmed: true });
  expect(() => startAssemblyLabelJob(root, { plan_id: second.plan_id, rels: [second.rows[1].rel], confirmed: true })).toThrow("已有标签");
  expect(() => getAssemblyLabelJob(other, pending.id)).toThrow("工作空间");
  const job = await wait(root, pending);
  expect(job).toMatchObject({ state: "attention", index_state: "failed" }); expect(job.results[0].status).toBe("written");
});

it("exposes explicit preview/start/status routes and keeps GET from writing", async () => {
  const root = await fixture(), query = `?workspace=${encodeURIComponent(root)}`;
  const response = await assemblyLabelRoutes.request(`/preview${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_dir: "assemblies" }) });
  const preview = await response.json() as Awaited<ReturnType<typeof previewAssemblyLabels>>;
  expect(response.status).toBe(200); expect(preview.rows).toHaveLength(3);
  const bad = await assemblyLabelRoutes.request(`/jobs${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: preview.plan_id, rels: [preview.rows[0].rel] }) });
  expect(bad.status).toBe(400);
  expect((await assemblyLabelRoutes.request(`/jobs/unknown${query}`)).status).toBe(404);
});
