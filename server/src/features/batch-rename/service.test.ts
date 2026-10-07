import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pnwCodeReplaceStringByRules } from "@phoenix-wing/code-core";
import { applyFileChanges } from "./fileOperations.js";
import { applyRenameTask, previewRenameTask } from "./service.js";
import { listRenameTasks, saveRenameTask, type RenameTaskDraft } from "./tasks.js";
import { resolveTaskRules } from "./rules.js";
import { renameTaskRoutes } from "./routes.js";
const roots: string[] = [];
function directory() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "rename-tasks-test-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const draft = (root: string): RenameTaskDraft => ({ name: "文档名称更新", mappings: [{ old: "Draft", target: "Released", enabled: true }], roots: [root], filenames: true, contents: true, include_stem: false });
it("loads without creating a database, saves multiple independent tasks and guards revisions", () => {
  const workspace = directory(), other = directory(), docs = directory();
  expect(listRenameTasks(workspace)).toEqual([]); expect(fs.readdirSync(workspace)).toEqual([]);
  const first = saveRenameTask(workspace, { draft: draft(docs) });
  const second = saveRenameTask(workspace, { draft: { ...draft(docs), name: "另一任务" } });
  expect(listRenameTasks(workspace).map(task => task.id)).toEqual([second.id, first.id]);
  expect(listRenameTasks(other)).toEqual([]);
  const updated = saveRenameTask(workspace, { id: first.id, revision: first.revision, draft: { ...draft(docs), name: "更新" } });
  expect(updated.revision).toBe(2);
  expect(() => saveRenameTask(workspace, { id: first.id, revision: 1, draft: draft(docs) })).toThrow("已被修改");
  expect(() => saveRenameTask(workspace, { id: first.id, draft: draft(docs) })).toThrow("版本不匹配");
  expect(fs.readdirSync(docs)).toEqual([]);
});
it("previews without CAD history and applies only selected files without automatic backups, retaining attempt records", async () => {
  const workspace = directory(), docs = directory(), second = directory();
  fs.writeFileSync(path.join(docs, "Draft.md"), "Draft\r\n"); fs.writeFileSync(path.join(second, "keep.txt"), "Draft");
  const task = saveRenameTask(workspace, { draft: { ...draft(docs), roots: [docs, second] } });
  const query = { task_id: task.id, revision: task.revision };
  const preview = await previewRenameTask(workspace, query);
  expect(preview.rows).toHaveLength(2); expect(fs.existsSync(path.join(docs, ".phoenix"))).toBe(false);
  expect(listRenameTasks(workspace)[0].attempts[0]).toMatchObject({ kind: "preview", state: "done", matched: 2 });
  const body = { ...query, plan_id: preview.plan_id, ids: [preview.rows.find(row => row.rel === "Draft.md")!.id], confirmed: true };
  await expect(applyFileChanges(workspace, body)).rejects.toThrow("失效"); // CAD cannot consume this plan.
  const result = await applyRenameTask(workspace, body);
  expect(result.applied).toBe(1); expect(result.failed).toBe(0);
  expect(fs.readFileSync(path.join(docs, "Released.md"), "utf8")).toBe("Released\r\n");
  expect(fs.readFileSync(path.join(second, "keep.txt"), "utf8")).toBe("Draft");
  expect(result.results[0].backup).toBeUndefined();
  expect(fs.existsSync(path.join(docs, ".phoenix"))).toBe(false);
  expect(listRenameTasks(workspace)[0].attempts[0]).toMatchObject({ kind: "apply", applied: 1, state: "done" });
  await expect(applyRenameTask(workspace, body)).rejects.toThrow("失效");
  expect((await previewRenameTask(workspace, query)).rows).toHaveLength(1);
});
it("rejects plans from another task or changed config and continues other files on source changes", async () => {
  const workspace = directory(), docs = directory();
  fs.writeFileSync(path.join(docs, "a.txt"), "Draft"); fs.writeFileSync(path.join(docs, "b.txt"), "Draft");
  const task = saveRenameTask(workspace, { draft: draft(docs) });
  const another = saveRenameTask(workspace, { draft: draft(docs) });
  const preview = await previewRenameTask(workspace, { task_id: task.id, revision: 1 });
  const body = { task_id: task.id, revision: 1, plan_id: preview.plan_id, ids: preview.rows.map(row => row.id), confirmed: true };
  await expect(applyRenameTask(workspace, { ...body, task_id: another.id })).rejects.toThrow("失效");
  saveRenameTask(workspace, { id: task.id, revision: 1, draft: { ...draft(docs), contents: false } });
  await expect(applyRenameTask(workspace, body)).rejects.toThrow("已被修改");
  const secondPlan = await previewRenameTask(workspace, { task_id: another.id, revision: 1 });
  fs.writeFileSync(path.join(docs, "a.txt"), "user edit");
  const result = await applyRenameTask(workspace, { ...body, task_id: another.id, plan_id: secondPlan.plan_id, ids: secondPlan.rows.map(row => row.id) });
  expect(result.failed).toBe(1); expect(result.applied).toBe(1);
  expect(fs.readFileSync(path.join(docs, "a.txt"), "utf8")).toBe("user edit");
});
it("validates mappings, refuses chains/cycles/ambiguous rules, and protects final names on repeat previews", () => {
  const input = draft("/synthetic");
  const resolved = resolveTaskRules({ ...input, mappings: [{ old: "Unit", target: "UnitNew", enabled: true }] });
  const result = pnwCodeReplaceStringByRules("Unit UnitNew", resolved.rules).output;
  expect(result).toBe("UnitNew UnitNew"); expect(pnwCodeReplaceStringByRules(result, resolved.rules).output).toBe(result);
  expect(resolveTaskRules({ ...input, mappings: [{ old: "A", target: "B", enabled: true }, { old: "B", target: "C", enabled: true }] }).excluded_rules?.[0]?.reason).toContain("合并");
  expect(resolveTaskRules({ ...input, mappings: [{ old: "A", target: "B", enabled: true }, { old: "A", target: "C", enabled: true }] }).excluded_rules?.[0]?.reason).toContain("冲突");
  expect(resolveTaskRules({ ...input, mappings: [{ old: "", target: "B", enabled: true }] }).excluded_rules?.[0]?.reason).toContain("填写");
  expect(resolveTaskRules({ ...input, mappings: [...input.mappings, { old: "", target: "", enabled: false }] }).conflicts).toEqual([]);
});
it("keeps FCStd and binary contents protected and accepts no malformed route requests", async () => {
  const workspace = directory(), docs = directory();
  fs.writeFileSync(path.join(docs, "Draft.FCStd"), "Draft"); fs.writeFileSync(path.join(docs, "Draft.png"), Buffer.from([0, 1, 2]));
  const task = saveRenameTask(workspace, { draft: draft(docs) });
  const preview = await previewRenameTask(workspace, { task_id: task.id, revision: task.revision });
  expect(preview.rows.find(row => row.rel.endsWith("FCStd"))?.eligible).toBe(false);
  expect(preview.rows.find(row => row.rel.endsWith("png"))).toMatchObject({ binary: true, eligible: true, diffs: [] });
  const url = `/preview?workspace=${encodeURIComponent(workspace)}`;
  expect((await renameTaskRoutes.request(url, { method: "POST", body: "null" })).status).toBe(400);
  expect((await renameTaskRoutes.request(url, { method: "POST", body: JSON.stringify({ task_id: task.id }) })).status).toBe(400);
});
it("blocks linked CATIA models but permits CATDrawing and STEP disk names without content changes", async () => {
  const workspace = directory(), docs = directory();
  for (const extension of ["CATPart", "CATProduct", "CATDrawing", "CATShape", "CATProcess", "CATAnalysis", "CATMaterial", "stp", "step"]) fs.writeFileSync(path.join(docs, `Draft.${extension}`), "Draft fixture");
  const task = saveRenameTask(workspace, { draft: draft(docs) });
  const query = { task_id: task.id, revision: task.revision };
  const preview = await previewRenameTask(workspace, query);
  expect(preview.rows.filter(row => row.eligible).map(row => row.rel).sort()).toEqual(["Draft.CATDrawing", "Draft.step", "Draft.stp"]);
  expect(preview.rows.find(row => row.rel.endsWith("CATDrawing"))).toMatchObject({ binary: true, message: "待改文件名（CATDrawing 内部内容及引用不修改）" });
  expect(preview.rows.filter(row => row.eligible).every(row => row.diffs.length === 0 && row.occurrences === 0)).toBe(true);
  expect(preview.rows.filter(row => !row.eligible).every(row => row.binary && row.message.includes("CATIA"))).toBe(true);
  const body = { ...query, plan_id: preview.plan_id, confirmed: true };
  await expect(applyRenameTask(workspace, { ...body, ids: preview.rows.map(row => row.id) })).rejects.toThrow("无效");
  const result = await applyRenameTask(workspace, { ...body, ids: preview.rows.filter(row => row.eligible).map(row => row.id) });
  expect(result.applied).toBe(3); expect(fs.readFileSync(path.join(docs, "Released.stp"), "utf8")).toBe("Draft fixture");
  expect(fs.readFileSync(path.join(docs, "Released.CATDrawing"), "utf8")).toBe("Draft fixture");
  expect(fs.readFileSync(path.join(docs, "Draft.CATPart"), "utf8")).toBe("Draft fixture");
});
it("keeps CATDrawing untouched for content-only searches and prevents suffix conversion", async () => {
  const workspace = directory(), docs = directory();
  fs.writeFileSync(path.join(docs, "Draft.cAtDrAwInG"), "Draft fixture");
  let task = saveRenameTask(workspace, { draft: { ...draft(docs), filenames: false } });
  expect((await previewRenameTask(workspace, { task_id: task.id, revision: 1 })).rows).toEqual([]);
  for (const mappings of [
    [{ old: "Draft.cAtDrAwInG", target: "Released.txt", enabled: true }],
    [{ old: "Draft.cAtDrAwInG", target: "Released.CATPart", enabled: true }],
  ]) {
    task = saveRenameTask(workspace, { draft: { ...draft(docs), mappings } });
    const preview = await previewRenameTask(workspace, { task_id: task.id, revision: 1 });
    expect(preview.rows).toHaveLength(1); expect(preview.rows[0].eligible).toBe(false);
  }
});
it("rejects canonically equivalent Unicode destinations before writing either source", async () => {
  const workspace = directory(), docs = directory();
  fs.writeFileSync(path.join(docs, "source-one.txt"), "one"); fs.writeFileSync(path.join(docs, "source-two.txt"), "two");
  const task = saveRenameTask(workspace, { draft: { ...draft(docs), contents: false, mappings: [
    { old: "source-one", target: "caf\u00e9", enabled: true },
    { old: "source-two", target: "cafe\u0301", enabled: true },
  ] } });
  const query = { task_id: task.id, revision: task.revision };
  const preview = await previewRenameTask(workspace, query);
  expect(preview.rows).toHaveLength(2); expect(preview.rows.every(row => !row.eligible)).toBe(true);
  await expect(applyRenameTask(workspace, { ...query, plan_id: preview.plan_id, confirmed: true, ids: preview.rows.map(row => row.id) })).rejects.toThrow("无效");
  expect(fs.readFileSync(path.join(docs, "source-one.txt"), "utf8")).toBe("one");
  expect(fs.readFileSync(path.join(docs, "source-two.txt"), "utf8")).toBe("two");
});
it("detects an existing decomposed Unicode target during preview", async () => {
  const workspace = directory(), docs = directory();
  fs.writeFileSync(path.join(docs, "source.txt"), "original"); fs.writeFileSync(path.join(docs, "cafe\u0301.txt"), "existing");
  const task = saveRenameTask(workspace, { draft: { ...draft(docs), contents: false, mappings: [{ old: "source", target: "caf\u00e9", enabled: true }] } });
  const preview = await previewRenameTask(workspace, { task_id: task.id, revision: task.revision });
  expect(preview.rows[0]).toMatchObject({ eligible: false });
  expect(fs.readFileSync(path.join(docs, "cafe\u0301.txt"), "utf8")).toBe("existing");
});

it("skips conflicting rule rows but previews and applies independent rules", async () => {
  const workspace = directory(), docs = directory();
  fs.writeFileSync(path.join(docs, "Bad-Safe.txt"), "Bad Safe");
  const task = saveRenameTask(workspace, { draft: { ...draft(docs), mappings: [{ old: "Bad", target: "One", enabled: true }, { old: "Bad", target: "Two", enabled: true }, { old: "Safe", target: "Ready", enabled: true }] } });
  const plan = await previewRenameTask(workspace, { task_id: task.id, revision: task.revision });
  expect(plan.conflicts).toEqual([]); expect(plan.excluded_rules?.map(row => row.row)).toEqual([1,2]);
  expect(plan.rows[0]?.target).toBe("Bad-Ready.txt");
  const result = await applyRenameTask(workspace, { task_id: task.id, revision: task.revision, plan_id: plan.plan_id, ids: plan.rows.map(row => row.id), confirmed: true });
  expect(result.applied).toBe(1); expect(fs.readFileSync(path.join(docs, "Bad-Ready.txt"), "utf8")).toBe("Bad Ready");
});
