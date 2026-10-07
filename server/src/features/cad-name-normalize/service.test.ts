import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { analyzeNames, previewNames, renameNames, writeNames } from "./service.js";
import { scanCadWorkspaceIndex, startCadIndexScan } from "../../lib/cadIndexScanService.js";
import * as renameService from "../../lib/pnwRenameService.js";
import * as bomService from "../../lib/bomAttributeService.js";
import { getRenameJob, startRenameJob } from "./renameJobs.js";
import { readFcstdEmbeddedBomFields } from "../../lib/fcstdDocumentXmlService.js";
import { pnwCreateDb } from "@phoenix-wing/db-node";

vi.mock("../../lib/cadIndexScanService.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/cadIndexScanService.js")>(),
  startCadIndexScan: vi.fn(() => ({ id: "refresh-once", workspace: "fixture", state: "running", phase: "reading", scanned: 0, message: "更新中" })),
}));
const roots: string[] = [];
const part = "candidates/710101.001-H-DEMO-OLD.FCStd";
const assembly = "candidates/710202.001-H-DEMO-OLD.ASSY.FCStd";
const outside = "other/Host.ASSY.FCStd";
const upper = "upper/Top.ASSY.FCStd";
const partTarget = "candidates/710101.001-H-DEMO-测试侧板.FCStd";
const assemblyTarget = "candidates/710202.001-H-DEMO-总成.ASSY.FCStd";
function model(label: string, number: string, name: string, links: string[] = []) {
  const properties = { Label: label, PartNumber: number, PartVersion: "001", TypeCode: "H", ModelSeries: "DEMO", PartName: name };
  return `<Document><Objects><Object name="Body" type="PartDesign::Body"/>${links.map((_, i) => `<Object name="Link${i}" type="App::Link"/>`).join("")}</Objects><ObjectData><Object name="Body"><Properties Count="6">${Object.entries(properties).map(([key, value]) => `<Property name="${key}" type="App::PropertyString"><String value="${value}"/></Property>`).join("")}</Properties></Object>${links.map((link, i) => `<Object name="Link${i}"><Properties Count="2"><Property name="Label" type="App::PropertyString"><String value="old link label"/></Property><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${link}"/></Property></Properties></Object>`).join("")}</ObjectData></Document>`;
}
function save(root: string, rel: string, xml: string) {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml), "shape.brp": strToU8("unchanged shape") }));
}
const bytes = (root: string, rel: string) => fs.readFileSync(path.join(root, rel));
const xml = (root: string, rel: string) => strFromU8(unzipSync(bytes(root, rel))["Document.xml"]);
async function fixture(options: { noHosts?: boolean; basename?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-name-normalize-")); roots.push(root);
  save(root, part, model("710101.001-H-DEMO-测试侧板", "710101", "测试侧板"));
  if (!options.noHosts) {
    save(root, assembly, model("710202.001-H-DEMO-总成.ASSY", "710202", "总成.ASSY", [path.posix.basename(part)]));
    save(root, outside, model("100003.001-宿主", "100003", "宿主", [options.basename ? path.posix.basename(part) : `../${part}`, `../${assembly}`]));
    save(root, upper, model("100004.001-顶层", "100004", "顶层", [`../${outside}`]));
  }
  await scanCadWorkspaceIndex(root);
  return root;
}
async function prepare(root: string) {
  const preview = await previewNames(root, { batch_dir: "candidates" });
  expect(preview.rows.every(row => row.status === "needs_fix")).toBe(true);
  const written = writeNames(root, { plan_id: preview.plan_id, rels: preview.rows.map(row => row.rel), confirmed: true });
  expect(written.results.every(row => row.status === "written")).toBe(true);
  expect(startCadIndexScan).not.toHaveBeenCalled();
  return { preview, written };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it.each([
  ["S", "710101.001-S"], ["a", "710101.001-有效标签"], ["", "710101.001-S"], ["", "710101.001-"],
])("marks invalid name %j / label %j for review and prevents writes and renames", async (name, label) => {
  const root = await fixture({ noHosts: true });
  save(root, part, model(label, "710101", name));
  const original = bytes(root, part);
  const plan = await previewNames(root, { batch_dir: "candidates" });
  expect(plan.rows[0]).toMatchObject({ eligible: false, status: "needs_review", current_name: name, proposed_name: "", target_rel: "", message: expect.stringContaining("为空或仅为一个英文字母") });
  expect(() => writeNames(root, { plan_id: plan.plan_id, rels: [part], confirmed: true })).toThrow(/可用文件/);
  const analysis = analyzeNames(root, { plan_id: plan.plan_id });
  expect(analysis.rows).toEqual([]);
  expect(() => renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true })).toThrow();
  expect(bytes(root, part)).toEqual(original);
  expect(fs.existsSync(path.join(root, ".phoenix/name-normalize-backups"))).toBe(false);
  expect(startCadIndexScan).not.toHaveBeenCalled();
});

it("normalizes, renames and fixes cross-directory and selected-host references, then starts one index refresh", async () => {
  const root = await fixture(); const originalHost = bytes(root, outside); const upperBefore = bytes(root, upper);
  const { preview, written } = await prepare(root);
  expect(preview.rows.find(row => row.rel === assembly)).toMatchObject({ proposed_name: "总成", proposed_label: "710202.001-总成.ASSY", target_rel: assemblyTarget });
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  const partRow = analysis.rows.find(row => row.rel === part)!;
  expect(partRow.eligible).toBe(true);
  expect(partRow.outside_scope).toEqual(expect.arrayContaining([outside, upper]));
  expect(partRow.hosts).toEqual(expect.arrayContaining([expect.objectContaining({ host_repo_rel_path: upper, usage_kind: "indirect" })]));
  expect(bytes(root, outside)).toEqual(originalHost);
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part, assembly], confirmed: true });
  expect(result.results.map(row => ({ status: row.status, errors: row.failed_hosts, message: row.message }))).toEqual([
    expect.objectContaining({ status: "renamed", errors: [], message: expect.stringContaining("全部完成") }),
    expect.objectContaining({ status: "renamed", errors: [] }),
  ]);
  expect(xml(root, outside)).toContain(`file="../${partTarget}"`);
  expect(xml(root, outside)).toContain(`file="../${assemblyTarget}"`);
  expect(xml(root, outside)).toContain('value="710101.001-测试侧板"');
  expect(xml(root, outside)).toContain('value="710202.001-总成.ASSY"');
  expect(xml(root, assemblyTarget)).toContain(path.posix.basename(partTarget));
  expect(readFcstdEmbeddedBomFields(path.join(root, assemblyTarget))).toMatchObject({ PartName: "总成", label: "710202.001-总成.ASSY" });
  expect(bytes(root, upper)).toEqual(upperBefore); // indirect ancestors are analyzed, not indiscriminately rewritten
  const backup = result.results[0].host_backups!.find(item => item.rel === outside)!;
  expect(bytes(root, backup.backup)).toEqual(originalHost);
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
  expect(result.index_update?.state).toBe("running");
  expect(() => renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true })).toThrow(/失效/);
});

it("skips empty host lists successfully and still refreshes the index exactly once", async () => {
  const root = await fixture({ noHosts: true }); const { written } = await prepare(root);
  const spy = vi.spyOn(renameService, "applyRenameCorrections");
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0]).toMatchObject({ status: "renamed", xlink_patches: 0, label_patches: 0 });
  expect(spy).not.toHaveBeenCalled(); expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("corrects unique basename-only links outside the candidate directory", async () => {
  const root = await fixture({ basename: true }); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  expect(analysis.rows.find(row => row.rel === part)?.eligible).toBe(true);
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0].status).toBe("renamed"); expect(xml(root, outside)).toContain(`file="../${partTarget}"`);
});

it("blocks a changed host before any disk rename or automatic index refresh", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  save(root, outside, model("100003.001-外部修改", "100003", "keep external change"));
  const changed = bytes(root, outside);
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0]).toMatchObject({ status: "failed", message: expect.stringContaining("已变化") });
  expect(fs.existsSync(path.join(root, part))).toBe(true); expect(bytes(root, outside)).toEqual(changed);
  expect(startCadIndexScan).not.toHaveBeenCalled();
});

it("reports label failures without claiming complete success, preserving path fixes and refreshing once", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  const actual = renameService.applyRenameCorrections;
  vi.spyOn(renameService, "applyRenameCorrections").mockImplementation((workspace, body) => {
    if (body.labels_only) throw new Error("fixture label failure");
    return actual(workspace, body);
  });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0].status).toBe("references_pending");
  expect(result.results[0].failed_hosts?.some(item => item.error.includes("fixture label failure"))).toBe(true);
  expect(xml(root, outside)).toContain(`file="../${partTarget}"`);
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("binds disabled correction options to analysis and does not call that fully repaired", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id!, options: { syncLabels: false } });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0]).toMatchObject({ status: "references_pending", label_patches: 0 });
  expect(xml(root, outside)).toContain('value="old link label"');
});

it("keeps rename results when starting the final index refresh fails", async () => {
  const root = await fixture({ noHosts: true }); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  vi.mocked(startCadIndexScan).mockImplementationOnce(() => { throw new Error("index busy"); });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0].status).toBe("renamed"); expect(result.index_update).toMatchObject({ state: "failed", message: expect.stringContaining("index busy") });
});

it("refreshes once after attribute-only correction when no disk rename is required", async () => {
  const root = await fixture({ noHosts: true });
  fs.renameSync(path.join(root, part), path.join(root, partTarget));
  await scanCadWorkspaceIndex(root);
  const plan = await previewNames(root, { batch_dir: "candidates" });
  expect(plan.rows[0]).toMatchObject({ attributes_changed: true, rename_changed: false });
  const result = writeNames(root, { plan_id: plan.plan_id, rels: [partTarget], confirmed: true });
  expect(result.prepared_id).toEqual(expect.any(String)); expect(startCadIndexScan).toHaveBeenCalledTimes(1);
  expect(result.index_update?.state).toBe("running");
  expect(analyzeNames(root, { prepared_id: result.prepared_id! }).rows[0]).toMatchObject({ eligible: false, status: "normal", message: "文件名已一致，无需改名" });
});

it("analyzes directly from preview and renames without writing consistent attributes, preserving source backups", async () => {
  const root = await fixture();
  save(root, part, model("710101.001-测试侧板", "710101", "测试侧板"));
  await scanCadWorkspaceIndex(root);
  const original = bytes(root, part); const host = bytes(root, outside);
  const plan = await previewNames(root, { batch_dir: "candidates" });
  expect(plan.rows.find(row => row.rel === part)).toMatchObject({ attributes_changed: false, rename_changed: true, message: "属性已一致，可直接分析改名与引用" });
  const analysis = analyzeNames(root, { plan_id: plan.plan_id });
  expect(analysis.rows.find(row => row.rel === part)).toMatchObject({ eligible: true, status: "needs_fix", outside_scope: expect.arrayContaining([outside, upper]) });
  expect(bytes(root, part)).toEqual(original); expect(bytes(root, outside)).toEqual(host);
  expect(fs.existsSync(path.join(root, ".phoenix/name-normalize-backups"))).toBe(false);
  expect(startCadIndexScan).not.toHaveBeenCalled();
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0].status).toBe("renamed");
  expect(bytes(root, partTarget)).toEqual(original);
  expect(bytes(root, result.results[0].backup!)).toEqual(original);
  expect(xml(root, outside)).toContain(`file="../${partTarget}"`);
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
  expect(() => writeNames(root, { plan_id: plan.plan_id, rels: [part], confirmed: true })).toThrow(/失效/);
});

it("analyzes pending attributes without forcing a write and invalidates early analysis on optional attribute write", async () => {
  const root = await fixture(); const original = bytes(root, part);
  const plan = await previewNames(root, { batch_dir: "candidates" });
  const early = analyzeNames(root, { plan_id: plan.plan_id });
  expect(early.rows.find(row => row.rel === part)).toMatchObject({ eligible: true, status: "needs_fix", message: expect.stringContaining("属性差异保留"), hosts: expect.arrayContaining([expect.objectContaining({ host_repo_rel_path: outside })]) });
  expect(bytes(root, part)).toEqual(original); expect(startCadIndexScan).not.toHaveBeenCalled();
  const result = writeNames(root, { plan_id: plan.plan_id, rels: [part], confirmed: true });
  expect(() => renameNames(root, { analysis_id: early.analysis_id, rels: [part], confirmed: true })).toThrow(/失效/);
  expect(analyzeNames(root, { prepared_id: result.prepared_id! }).rows[0].eligible).toBe(true);
});

it("renames directly from a preview while leaving suggested model attributes untouched", async () => {
  const root = await fixture({ noHosts: true }); const original = bytes(root, part);
  const plan = await previewNames(root, { batch_dir: "candidates" });
  expect(plan.rows[0].attributes_changed).toBe(true);
  const analysis = analyzeNames(root, { plan_id: plan.plan_id });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0].status).toBe("renamed");
  expect(bytes(root, partTarget)).toEqual(original);
});

function drawing(refs: string[]) {
  return `<Document><Objects><Object type="TechDraw::DrawPage" name="Page"/></Objects><ObjectData><Object name="Page"><Properties Count="0"/></Object>${refs.map((file, i) => `<Object name="Source${i}"><Properties Count="1"><Property name="Source" type="App::PropertyXLink"><XLink file="${file}" name="Body"/></Property></Properties></Object>`).join("")}</ObjectData></Document>`;
}
it.each([true, false])("repairs drawing source paths without treating absent assembly Labels as failed work (syncLabels=%s)", async syncLabels => {
  const root = await fixture({ noHosts: true });
  const sheet = "sheets/Sheet.Drawing.FCStd";
  save(root, sheet, drawing([`../${part}`]));
  await scanCadWorkspaceIndex(root);
  const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id!, options: { syncLabels } });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true });
  expect(result.results[0]).toMatchObject({ status: "renamed", failed_hosts: [], xlink_patches: 1, label_patches: 0 });
  if (syncLabels) expect(result.results[0].message).toContain("未找到可同步的装配实例 Label，已跳过");
  expect(xml(root, sheet)).toContain(`file="../${partTarget}"`);
  expect(xml(root, sheet)).not.toContain('name="PartName"');
});
it.each([false, true])("syncs a drawing with its unique model without BOM writes (assembly=%s)", async assy => {
  const root = await fixture({ noHosts: true });
  const source = assy ? "candidates/710101.001-H-DEMO-测试侧板.ASSY.FCStd" : partTarget;
  fs.renameSync(path.join(root, part), path.join(root, source));
  const rel = "sheets/Old.Drawing.FCStd";
  save(root, rel, drawing([`../${source}`, `../${source}`]));
  await scanCadWorkspaceIndex(root);
  const original = bytes(root, rel), modelOriginal = bytes(root, source);
  const normal = await previewNames(root, { batch_dir: "sheets" });
  expect(normal.rows[0]).toMatchObject({ kind: "drawing", eligible: false });
  const plan = await previewNames(root, { batch_dir: "sheets", mode: "drawings" });
  const target = "sheets/710101.001-H-DEMO-测试侧板.Drawing.FCStd";
  expect(plan.rows[0]).toMatchObject({ source_rel: source, target_rel: target, attributes_changed: false, eligible: true });
  expect(() => writeNames(root, { plan_id: plan.plan_id, rels: [rel], confirmed: true })).toThrow(/不写 BOM/);
  const analysis = analyzeNames(root, { plan_id: plan.plan_id });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [rel], confirmed: true });
  expect(result.results[0].status).toBe("renamed");
  expect(bytes(root, target)).toEqual(original); expect(bytes(root, source)).toEqual(modelOriginal);
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});
it("blocks ambiguous, missing, escaped and conflicting drawing sources; never guesses by filename", async () => {
  const root = await fixture({ noHosts: true });
  save(root, "sheets/A.Drawing.FCStd", drawing([`../${part}`, "../other.FCStd"]));
  save(root, "sheets/B.Drawing.FCStd", drawing(["../Missing.FCStd"]));
  save(root, "sheets/C.Drawing.FCStd", drawing(["../../Escape.FCStd"]));
  save(root, "sheets/D.Drawing.FCStd", drawing([]));
  save(root, "sheets/E.Drawing.FCStd", drawing([`../${part}`]));
  save(root, "sheets/F.Drawing.FCStd", drawing([`../${part}`]));
  const plan = await previewNames(root, { batch_dir: "sheets", mode: "drawings" });
  expect(plan.rows).toHaveLength(6); expect(plan.rows.every(row => !row.eligible)).toBe(true);
  expect(plan.rows.find(row => row.rel.endsWith("A.Drawing.FCStd"))?.message).toContain("多个源模型");
  expect(plan.rows.find(row => row.rel.endsWith("E.Drawing.FCStd"))?.message).toContain("同一目标");
});
it("revalidates a drawing's source model after analysis before any rename", async () => {
  const root = await fixture({ noHosts: true });
  const rel = "sheets/Old.Drawing.FCStd"; save(root, rel, drawing([`../${part}`])); await scanCadWorkspaceIndex(root);
  const plan = await previewNames(root, { batch_dir: "sheets", mode: "drawings" });
  const analysis = analyzeNames(root, { plan_id: plan.plan_id });
  save(root, part, model("externally modified", "710101", "Changed"));
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [rel], confirmed: true });
  expect(result.results[0]).toMatchObject({ status: "failed", message: expect.stringContaining("已变化") });
  expect(fs.existsSync(path.join(root, rel))).toBe(true); expect(startCadIndexScan).not.toHaveBeenCalled();
});

it("shows already-normal files in direct analysis without requiring an index or a write", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-name-normal-")); roots.push(root);
  save(root, partTarget, model("710101.001-测试侧板", "710101", "测试侧板"));
  const plan = await previewNames(root, { batch_dir: "candidates" });
  expect(plan.rows[0].status).toBe("normal");
  const result = analyzeNames(root, { plan_id: plan.plan_id });
  expect(result.rows[0]).toMatchObject({ eligible: false, status: "normal", message: "文件名已一致，无需改名" });
  expect(startCadIndexScan).not.toHaveBeenCalled();
});

it("recognizes a STEP source consumed by Body, but reports real multiple roots with readable candidate values", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-name-imported-")); roots.push(root);
  const imported = '<Object name="Imported"><Properties><Property name="Label" type="App::PropertyString"><String value="Imported STEP"/></Property></Properties></Object>';
  const sourceXml = model("710101.001-测试侧板", "710101", "测试侧板")
    .replace('</Objects>', '<Object name="Imported" type="Part::Feature"/></Objects>')
    .replace('</Properties>', '<Property name="BaseFeature" type="App::PropertyLink"><Link value="Imported"/></Property></Properties>')
    .replace('</ObjectData>', `${imported}</ObjectData>`);
  save(root, partTarget, sourceXml);
  const original = bytes(root, partTarget);
  const plan = await previewNames(root, { batch_dir: "candidates" });
  expect(plan.rows[0]).toMatchObject({ object_name: "Body", current_name: "测试侧板", current_label: "710101.001-测试侧板", attributes_changed: false, rename_changed: false, status: "normal" });
  expect(bytes(root, partTarget)).toEqual(original);
  save(root, partTarget, sourceXml.replace('name="BaseFeature"', 'name="Tip"'));
  const ambiguous = await previewNames(root, { batch_dir: "candidates" });
  expect(ambiguous.rows[0]).toMatchObject({ object_name: "Body", current_name: "测试侧板", current_label: "710101.001-测试侧板", eligible: false, status: "needs_review", message: expect.stringContaining("另有 Imported") });
});

it.each(["测试块-工序A", "测试块-工序B", "测试块-工序C", "示例支架", "示例面板-A"])("keeps embedded name %s and filename unchanged while normalizing a full-format Label", async name => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-name-property-first-")); roots.push(root);
  const rel = `candidates/710101.001-H-DEMO-${name}.FCStd`;
  save(root, rel, model(`710101.001-H-DEMO-${name}`, "710101", name));
  const before = bytes(root, rel);
  const preview = await previewNames(root, { batch_dir: "candidates" });
  expect(preview.rows[0]).toMatchObject({ current_name: name, proposed_name: name, proposed_label: `710101.001-${name}`, target_rel: rel, attributes_changed: true, rename_changed: false, warnings: [] });
  expect(bytes(root, rel)).toEqual(before);
  const result = writeNames(root, { plan_id: preview.plan_id, rels: [rel], confirmed: true });
  expect(result.results[0].status).toBe("written");
  expect(readFcstdEmbeddedBomFields(path.join(root, rel))).toMatchObject({ PartName: name, label: `710101.001-${name}` });
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("defaults missing PartName to Label, allows filename, and preserves explicit different PartName", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-name-name-source-")); roots.push(root);
  save(root, partTarget, model("710101.001-不要用标签名", "710101", ""));
  let preview = await previewNames(root, { batch_dir: "candidates" });
  expect(preview.rows[0]).toMatchObject({ proposed_name: "不要用标签名", rename_changed: true });
  preview = await previewNames(root, { batch_dir: "candidates", name_source: "filename" });
  expect(preview.rows[0]).toMatchObject({ proposed_name: "测试侧板", target_rel: partTarget, rename_changed: false });
  save(root, partTarget, model("710101.001-不要用标签名", "710101", "自定义名称"));
  preview = await previewNames(root, { batch_dir: "candidates" });
  expect(preview.rows[0]).toMatchObject({ proposed_name: "自定义名称", proposed_label: "710101.001-自定义名称", target_rel: "candidates/710101.001-H-DEMO-自定义名称.FCStd", rename_changed: true });
});

it.each([[part, assembly], [assembly, part]])("finishes references before the next single-file rename, including a selected host in either order [case %#]", async (first, second) => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  const single = vi.spyOn(bomService, "renameBomFcstdFile");
  const completed: number[] = [];
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [first, second], confirmed: true }, progress => {
    if (!progress.completed) return;
    completed.push(progress.completed);
    if (progress.completed === 1) {
      expect(single).toHaveBeenCalledTimes(1);
      expect(xml(root, outside)).toContain(first === part ? `file="../${partTarget}"` : `file="../${assemblyTarget}"`);
      expect(fs.existsSync(path.join(root, second))).toBe(true);
      expect(startCadIndexScan).not.toHaveBeenCalled();
    }
  });
  expect(single.mock.calls.map(call => call[1])).toEqual([first, second]);
  expect(result.results.every(row => row.status === "renamed")).toBe(true);
  expect(completed).toContain(2); expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("exposes a bounded background job and continues the queue after incomplete reference repair", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id!, options: { syncLabels: false } });
  const accepted = startRenameJob(root, { analysis_id: analysis.analysis_id, rels: [part, assembly], confirmed: true });
  expect(accepted).toMatchObject({ state: "running", total: 2 });
  expect(() => startRenameJob(root, { analysis_id: analysis.analysis_id, rels: [part], confirmed: true })).toThrow(/已有/);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "desk-other-job-")); roots.push(other);
  expect(() => getRenameJob(other, accepted.id)).toThrow(/不属于/);
  await vi.waitFor(() => expect(getRenameJob(root, accepted.id).state).toBe("attention"));
  const done = getRenameJob(root, accepted.id);
  expect(done.completed).toBe(2);
  expect(done.results.map(row => row.status)).toEqual(["references_pending", "references_pending"]);
  expect(done.message).toContain("其余项目已继续处理");
  expect(fs.existsSync(path.join(root, assemblyTarget))).toBe(true);
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("continues with a shared host after the first item's label repair throws, preserving tracked path writes", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  const actual = renameService.applyRenameCorrections;
  let fail = true;
  vi.spyOn(renameService, "applyRenameCorrections").mockImplementation((workspace, body) => {
    if (body.labels_only && fail) { fail = false; throw new Error("fixture label failure"); }
    return actual(workspace, body);
  });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part, assembly], confirmed: true });
  expect(result.results.map(row => row.status)).toEqual(["references_pending", "renamed"]);
  expect(result.results[0].failed_hosts).toEqual(expect.arrayContaining([expect.objectContaining({ error: "fixture label failure" })]));
  expect(xml(root, outside)).toContain(`file="../${assemblyTarget}"`);
  expect(xml(root, assemblyTarget)).toContain(path.posix.basename(partTarget));
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("reports a changed source without preventing the next safe file from being renamed", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  save(root, part, model("710101.001-外部编辑", "710101", "外部编辑"));
  const original = bytes(root, part);
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part, assembly], confirmed: true });
  expect(result.results.map(row => row.status)).toEqual(["failed", "renamed"]);
  expect(result.results[0].message).toContain("已变化");
  expect(bytes(root, part)).toEqual(original);
  expect(xml(root, assemblyTarget)).toContain(path.posix.basename(part));
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
});

it("continues after a single-file rename fails before moving the source", async () => {
  const root = await fixture(); const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  vi.spyOn(bomService, "renameBomFcstdFile").mockRejectedValueOnce(new Error("fixture permission denied"));
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part, assembly], confirmed: true });
  expect(result.results.map(row => row.status)).toEqual(["failed", "renamed"]);
  expect(result.results[0].message).toContain("fixture permission denied");
  expect(fs.existsSync(path.join(root, part))).toBe(true);
  expect(fs.existsSync(path.join(root, assemblyTarget))).toBe(true);
});

it("stops with the specific global cause when an unrelated operation changes the reference index", async () => {
  const root = await fixture();
  const third = "candidates/710303.001-H-DEMO-OLD.FCStd";
  save(root, third, model("710303.001-H-DEMO-示例块", "710303", "示例块"));
  await scanCadWorkspaceIndex(root);
  const { written } = await prepare(root);
  const analysis = analyzeNames(root, { prepared_id: written.prepared_id! });
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels: [part, assembly, third], confirmed: true }, progress => {
    if (progress.completed !== 1) return;
    const db = pnwCreateDb(path.join(root, ".phoenix/phoenix-workspace.sqlite"));
    try { db.run("UPDATE phoenix_cad_bom_xref SET link_label = ?", ["external change"]); } finally { db.close(); }
  });
  expect(result.results.map(row => row.status)).toEqual(["renamed", "failed", "skipped"]);
  expect(result.results[1].message).toContain("索引被其他操作改变");
  expect(result.results[2].message).toContain("索引被其他操作改变");
  expect(fs.existsSync(path.join(root, assembly))).toBe(true);
});

it("processes more than sixty selected files despite an early local failure and refreshes once", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-large-name-batch-")); roots.push(root);
  const rels = Array.from({ length: 63 }, (_, i) => `candidates/${720001 + i}.001-H-DEMO-OLD.FCStd`);
  rels.forEach((rel, i) => save(root, rel, model(`${720001 + i}.001-示例${i}`, String(720001 + i), `示例${i}`)));
  await scanCadWorkspaceIndex(root);
  const preview = await previewNames(root, { batch_dir: "candidates" });
  const analysis = analyzeNames(root, { plan_id: preview.plan_id });
  vi.spyOn(bomService, "renameBomFcstdFile").mockRejectedValueOnce(new Error("fixture first-item failure"));
  const result = await renameNames(root, { analysis_id: analysis.analysis_id, rels, confirmed: true });
  expect(result.results).toHaveLength(63);
  expect(result.results[0].status).toBe("failed");
  expect(result.results.slice(1).every(row => row.status === "renamed")).toBe(true);
  expect(startCadIndexScan).toHaveBeenCalledTimes(1);
}, 20_000);
