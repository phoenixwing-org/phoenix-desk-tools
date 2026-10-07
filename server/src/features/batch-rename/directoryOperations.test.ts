import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { previewDirectoryChanges, applyDirectoryChanges } from "./directoryOperations.js";
import { resolveTaskRules } from "./rules.js";
import { saveRenameTask } from "./tasks.js";
import { previewRenameTask, applyRenameTask } from "./service.js";
const roots: string[] = [];
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "rename-folders-")); roots.push(root); return root; }
function rules(old = "Old", target = "New") { return resolveTaskRules({ name: "test", mappings: [{ old, target, enabled: true }], roots: [], directories: true, filenames: false, contents: false, include_stem: false }); }
function preview(root: string) { return previewDirectoryChanges(root, { roots: [root], filenames: false, contents: false }, rules(), "test"); }
function apply(root: string, plan: ReturnType<typeof preview>, ids = plan.rows.filter(row => row.eligible).map(row => row.id)) { return applyDirectoryChanges(root, { plan_id: plan.plan_id, ids, confirmed: true }, "test"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("renames nested selections child-first, preserving file names/content without automatic backups", () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old-parent/Old-child"), { recursive: true });
  fs.writeFileSync(path.join(root, "Old-parent/Old-child/Old.txt"), "Old content");
  const plan = preview(root); expect(plan.rows).toHaveLength(2); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
  const result = apply(root, plan); expect(result.applied).toBe(2); expect(result.failed).toBe(0);
  expect(fs.readFileSync(path.join(root, "New-parent/New-child/Old.txt"), "utf8")).toBe("Old content");
  expect(result.results.find(row => row.rel.endsWith("Old-child"))?.target).toBe("New-parent/New-child");
  const parent = result.results.find(row => row.rel === "Old-parent")!;
  expect(parent.backup).toBeUndefined();
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
  expect(() => apply(root, plan)).toThrow("失效");
});
it("moves only the selected directory and leaves the processing root unchanged", () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old-one")); fs.mkdirSync(path.join(root, "Old-two"));
  const plan = preview(root); const selected = plan.rows.find(row => row.rel === "Old-one")!;
  expect(apply(root, plan, [selected.id]).applied).toBe(1);
  expect(fs.existsSync(path.join(root, "Old-two"))).toBe(true); expect(fs.existsSync(root)).toBe(true);
});
it("rejects changed descendants before moving the folder", () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old")); fs.writeFileSync(path.join(root, "Old/x.txt"), "before");
  const plan = preview(root); fs.writeFileSync(path.join(root, "Old/x.txt"), "after");
  expect(apply(root, plan).failed).toBe(1); expect(fs.existsSync(path.join(root, "New"))).toBe(false);
});
it("refuses occupied targets at preview and again at apply", () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old"));
  const plan = preview(root); fs.mkdirSync(path.join(root, "New")); fs.writeFileSync(path.join(root, "New/keep"), "keep");
  expect(preview(root).rows[0]?.eligible).toBe(false); expect(apply(root, plan).failed).toBe(1);
  expect(fs.readFileSync(path.join(root, "New/keep"), "utf8")).toBe("keep");
});
it("rejects canonical Unicode collisions and multiple destinations", () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old")); fs.mkdirSync(path.join(root, "Cafe\u0301"));
  const plan = previewDirectoryChanges(root, { roots: [root], filenames: false, contents: false }, rules("Old", "Café"), "test");
  expect(plan.rows[0]?.eligible).toBe(false);
});
it.each(["part.FCStd", "part.CATPart", ".git", ".phoenix"])("blocks moving protected descendant %s", name => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old"));
  if (name.startsWith(".")) fs.mkdirSync(path.join(root, "Old", name)); else fs.writeFileSync(path.join(root, "Old", name), "synthetic");
  expect(preview(root).rows.find(row => row.rel === "Old")?.eligible).toBe(false);
});
it("does not follow symlinks in selected directories", () => {
  const root = fixture(), outside = fixture(); fs.mkdirSync(path.join(root, "Old")); fs.symlinkSync(outside, path.join(root, "Old/link"));
  expect(preview(root).rows[0]?.eligible).toBe(false);
});
it("routes persisted directory-only tasks independently from file/content tasks", async () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old"));
  const task = saveRenameTask(root, { draft: { name: "folders", mappings: [{ old: "Old", target: "New", enabled: true }], roots: [root], directories: true, filenames: false, contents: false, include_stem: false } });
  const plan = await previewRenameTask(root, { task_id: task.id, revision: task.revision });
  expect(plan.rows[0]?.kind).toBe("directory");
  expect((await applyRenameTask(root, { task_id: task.id, revision: task.revision, plan_id: plan.plan_id, ids: plan.rows.map(row => row.id), confirmed: true })).applied).toBe(1);
});
it("rejects mixed directory and file writes", () => {
  const root = fixture();
  expect(() => previewDirectoryChanges(root, { roots: [root], filenames: true, contents: true }, rules(), "test")).toThrow("独立执行");
});

it("does not absorb an external edit while rebasing a selected parent after its child move", () => {
  const root = fixture(); fs.mkdirSync(path.join(root, "Old-parent/Old-child"), { recursive: true }); fs.writeFileSync(path.join(root, "Old-parent/keep.txt"), "before");
  const plan = preview(root), originalRename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
    originalRename(source, target);
    if (String(source).endsWith("Old-child")) fs.writeFileSync(path.join(root, "Old-parent/keep.txt"), "external change");
  });
  const result = apply(root, plan);
  expect(result.applied).toBe(1); expect(result.failed).toBe(1);
  expect(fs.existsSync(path.join(root, "New-parent"))).toBe(false);
  expect(fs.readFileSync(path.join(root, "Old-parent/keep.txt"), "utf8")).toBe("external change");
});
