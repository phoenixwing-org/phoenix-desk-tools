import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import iconv from "iconv-lite";
import { afterEach, expect, it } from "vitest";
import { pnwCodeReplaceStringByRules } from "@phoenix-wing/code-core";
import { executeDiskFileRename, type RenameLog } from "../../lib/pnwRenameService.js";
import { applyDocumentSync, documentSyncHistory, previewDocumentSync, resolveDocumentSync } from "./service.js";
import { resolveRenameChains } from "./rules.js";
const temp: string[] = [];
function dir() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "document-sync-test-")); temp.push(root); return root; }
afterEach(() => { for (const root of temp.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const workspace = dir(), docs = dir(), other = dir();
  fs.writeFileSync(path.join(workspace, "draft.FCStd"), "synthetic");
  const first = executeDiskFileRename(workspace, "draft.FCStd", { filename: "review.FCStd" });
  executeDiskFileRename(workspace, "review.FCStd", { filename: "final.FCStd" });
  return { workspace, docs, other, log: first.rename_log_id };
}
function log(id: number, old: string, target: string): RenameLog { return { id, old_repo_rel_path: old, new_repo_rel_path: target, old_filename: path.posix.basename(old), new_filename: path.posix.basename(target), old_basename: old, new_basename: target, created_at: "2026-01-01T00:00:00Z" }; }

it("flattens complete path chains and protects final names from recursive replacement", () => {
  const resolved = resolveRenameChains([log(1, "a/A.txt", "a/B.txt"), log(2, "a/B.txt", "a/AA.txt")], [1], true);
  expect(resolved.conflicts).toEqual([]);
  expect(resolved.mappings.map(row => [row.old, row.target])).toEqual([["a/A.txt", "a/AA.txt"], ["a/B.txt", "a/AA.txt"]]);
  const once = pnwCodeReplaceStringByRules("A.txt B.txt AA.txt A.md", resolved.rules).output;
  expect(once).toBe("AA.txt AA.txt AA.txt AA.md");
  expect(pnwCodeReplaceStringByRules(once, resolved.rules).output).toBe(once);
});
it("blocks branches, cycles and same-name/different-directory ambiguity", () => {
  expect(resolveRenameChains([log(1, "A", "B"), log(2, "A", "C")], [1], false).conflicts[0]).toContain("多个去向");
  expect(resolveRenameChains([log(1, "A", "B"), log(2, "B", "A")], [1], false).conflicts[0]).toContain("循环");
  expect(resolveRenameChains([log(1, "x/A.txt", "x/B.txt"), log(2, "y/A.txt", "y/C.txt")], [1, 2], false).conflicts[0]).toContain("冲突");
  expect(resolveRenameChains([log(1, "x/A.txt", "x/B.txt"), log(2, "y/B.txt", "y/C.txt")], [1, 2], false).conflicts[0]).toContain("最终名称");
});
it("previews multiple repositories read-only, then selectively applies with backups and receipts", async () => {
  const { workspace, docs, other, log: id } = fixture();
  fs.writeFileSync(path.join(docs, "guide.md"), "draft.FCStd\r\nreview.FCStd\r\nfinal.FCStd");
  const binary = Buffer.from([0, 10, 4, 255]);
  fs.writeFileSync(path.join(other, "draft.FCStd.png"), binary);
  const plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs, other] });
  expect(plan.rows).toHaveLength(2);
  expect(fs.existsSync(path.join(docs, ".phoenix"))).toBe(false);
  expect(plan.rows.find(row => row.rel === "guide.md")?.diffs).toHaveLength(2);
  expect(plan.mappings).toHaveLength(2);
  const result = await applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: plan.rows.map(row => row.id), confirmed: true });
  expect(result.applied).toBe(2);
  expect(fs.readFileSync(path.join(docs, "guide.md"), "utf8")).toBe("final.FCStd\r\nfinal.FCStd\r\nfinal.FCStd");
  expect(fs.readFileSync(path.join(other, "final.FCStd.png"))).toEqual(binary);
  expect(fs.existsSync(path.join(other, "draft.FCStd.png"))).toBe(false);
  for (const row of result.results) expect(JSON.parse(fs.readFileSync(`${row.backup}.json`, "utf8")).status).toBe("applied");
  expect(documentSyncHistory(workspace).entries).toHaveLength(2);
  await expect(applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: [plan.rows[0].id], confirmed: true })).rejects.toThrow("已失效");
  expect((await previewDocumentSync(workspace, { log_ids: [id], roots: [docs, other] })).rows).toEqual([]);
});
it("retains BOM, GBK and line endings; excludes binary content and ignore directories", async () => {
  const { workspace, docs, log: id } = fixture();
  fs.writeFileSync(path.join(docs, "bom.txt"), Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from("中文 draft.FCStd\r\n")]));
  fs.writeFileSync(path.join(docs, "legacy.custom"), iconv.encode("采购 review.FCStd\r\n", "gbk"));
  fs.writeFileSync(path.join(docs, "binary.pdf"), "%PDF draft.FCStd");
  fs.writeFileSync(path.join(docs, "binary.data"), Buffer.concat([Buffer.from([0]), Buffer.from("draft.FCStd")]));
  fs.mkdirSync(path.join(docs, "node_modules")); fs.writeFileSync(path.join(docs, "node_modules", "x.txt"), "draft.FCStd");
  const plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs] });
  expect(plan.rows.map(row => row.rel).sort()).toEqual(["bom.txt", "legacy.custom"]);
  await applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: plan.rows.map(row => row.id), confirmed: true });
  expect(fs.readFileSync(path.join(docs, "bom.txt")).subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
  expect(iconv.decode(fs.readFileSync(path.join(docs, "legacy.custom")), "gbk")).toBe("采购 final.FCStd\r\n");
});
it("continues independent files after stale input, and prevents target overwrite at apply", async () => {
  const { workspace, docs, log: id } = fixture();
  fs.writeFileSync(path.join(docs, "draft.FCStd.md"), "draft.FCStd");
  fs.writeFileSync(path.join(docs, "stale.md"), "draft.FCStd");
  fs.writeFileSync(path.join(docs, "ok.md"), "draft.FCStd");
  const plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs] });
  fs.writeFileSync(path.join(docs, "final.FCStd.md"), "do not overwrite");
  fs.writeFileSync(path.join(docs, "stale.md"), "user changed");
  const result = await applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: plan.rows.map(row => row.id), confirmed: true });
  expect(result.applied).toBe(1); expect(result.failed).toBe(2);
  expect(fs.readFileSync(path.join(docs, "final.FCStd.md"), "utf8")).toBe("do not overwrite");
  expect(fs.readFileSync(path.join(docs, "stale.md"), "utf8")).toBe("user changed");
});
it("rejects overlapping roots, workspace replay, path aliases, and tampered backups", async () => {
  const { workspace, docs, other, log: id } = fixture();
  fs.mkdirSync(path.join(docs, "sub"));
  await expect(previewDocumentSync(workspace, { log_ids: [id], roots: [docs, path.join(docs, "sub")] })).rejects.toThrow("包含");
  await expect(previewDocumentSync(workspace, { log_ids: [id], roots: ["/"] })).rejects.toThrow("整个磁盘");
  fs.writeFileSync(path.join(docs, "a.md"), "draft.FCStd");
  fs.symlinkSync(path.join(docs, "a.md"), path.join(docs, "linked.md"));
  const plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs] });
  expect(plan.rows).toHaveLength(1);
  await expect(applyDocumentSync(other, { plan_id: plan.plan_id, ids: [plan.rows[0].id], confirmed: true })).rejects.toThrow("失效");
  fs.symlinkSync(other, path.join(docs, ".phoenix"));
  const result = await applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: [plan.rows[0].id], confirmed: true });
  expect(result.failed).toBe(1); expect(result.results[0].message).toContain("符号链接");
  expect(fs.readdirSync(other)).toEqual([]);
});
it("detects collisions and blocks CAD disk renames; honors filename/content selection", async () => {
  const { workspace, docs, log: id } = fixture();
  fs.writeFileSync(path.join(docs, "draft.FCStd"), "binary-like synthetic");
  fs.writeFileSync(path.join(docs, "draft.FCStd.md"), "draft.FCStd");
  fs.writeFileSync(path.join(docs, "final.FCStd.md"), "preserve");
  let plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs] });
  expect(plan.rows.every(row => !row.eligible)).toBe(true);
  plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs], filenames: false });
  expect(plan.rows).toHaveLength(1); expect(plan.rows[0].target).toBe("draft.FCStd.md");
  await expect(applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: ["not-in-plan"], confirmed: true })).rejects.toThrow("无效");
});
it("renames only selected CATDrawing filenames without rewriting content or linked models", async () => {
  const { workspace, docs, log: id } = fixture();
  const raw = Buffer.from("draft.FCStd referenced model: draft.CATPart\r\n");
  for (const name of ["draft.CATDrawing", "review-sheet.catdrawing", "draft.CATPart"]) fs.writeFileSync(path.join(docs, name), raw);
  const plan = await previewDocumentSync(workspace, { log_ids: [id], roots: [docs], include_stem: true, contents: true });
  const selected = plan.rows.find(row => row.rel === "draft.CATDrawing")!;
  expect(selected).toMatchObject({ eligible: true, binary: true, target: "final.CATDrawing", occurrences: 0, diffs: [] });
  expect(plan.rows.find(row => row.rel === "draft.CATPart")?.eligible).toBe(false);
  const result = await applyDocumentSync(workspace, { plan_id: plan.plan_id, ids: [selected.id], confirmed: true });
  expect(result.applied).toBe(1);
  expect(fs.readFileSync(path.join(docs, "final.CATDrawing"))).toEqual(raw);
  expect(fs.readFileSync(result.results[0].backup!)).toEqual(raw);
  expect(fs.readFileSync(path.join(docs, "review-sheet.catdrawing"))).toEqual(raw);
  expect(fs.readFileSync(path.join(docs, "draft.CATPart"))).toEqual(raw);
});

it("hands off final literal rules without scanning or modifying document files", async () => {
  const { workspace, docs, log: id } = fixture();
  fs.writeFileSync(path.join(docs, "guide.md"), "draft.FCStd review.FCStd draft.txt");
  const resolved = resolveDocumentSync(workspace, { log_ids: [id], include_stem: true });
  expect(resolved.version).toBe(1); expect(resolved.conflicts).toEqual([]);
  expect(resolved.pairs).toEqual(expect.arrayContaining([{ old: "draft.FCStd", target: "final.FCStd", enabled: true }, { old: "review", target: "final", enabled: true }]));
  expect(resolved).not.toHaveProperty("plan_id");
  expect(fs.readFileSync(path.join(docs, "guide.md"), "utf8")).toBe("draft.FCStd review.FCStd draft.txt");
  const { resolveTaskRules } = await import("../batch-rename/rules.js");
  const taskRules = resolveTaskRules({ name: "Imported", mappings: resolved.pairs, roots: [docs], filenames: true, contents: true, include_stem: false });
  expect(taskRules.conflicts).toEqual([]);
  expect(pnwCodeReplaceStringByRules("draft.FCStd review.FCStd draft.txt final.FCStd", taskRules.rules).output).toBe("final.FCStd final.FCStd final.txt final.FCStd");
});
