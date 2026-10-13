import { effectScope, nextTick, ref } from "vue";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ loadTasks: vi.fn(), saveTask: vi.fn(), previewTask: vi.fn(), applyTask: vi.fn() }));
import { loadTasks, saveTask, previewTask, applyTask, type RenameTask, type RenamePreview } from "./api";
import { useRenameTasks } from "./useRenameTasks";
const task: RenameTask = { id: "task-a", revision: 1, updated_at: "", name: "Docs", mappings: [{ old: "A", target: "B", enabled: true }], roots: ["/docs"], filenames: true, contents: true, include_stem: false, attempts: [] };
const plan: RenamePreview = { plan_id: "plan-a", roots: ["/docs"], mappings: [], conflicts: [], expires_at: "", rows: [], scanned: 0, skipped: 0, warnings: [] };
beforeEach(() => vi.mocked(loadTasks).mockResolvedValue({ tasks: [structuredClone(task)] }));
afterEach(() => vi.resetAllMocks());
async function setup() {
  const scope = effectScope(), workspace = ref("/workspace"), report = vi.fn(), changed = vi.fn();
  const rename = scope.run(() => useRenameTasks(workspace, report, changed))!;
  await nextTick(); return { scope, workspace, report, changed, rename };
}
it("loads saved tasks without scanning, auto-saves edited config before explicit preview, and invalidates edited plans", async () => {
  const { scope, rename } = await setup();
  try {
    expect(previewTask).not.toHaveBeenCalled(); expect(saveTask).not.toHaveBeenCalled();
    rename.draft.value.name = "Edited";
    const updated = { ...task, name: "Edited", revision: 2 };
    vi.mocked(saveTask).mockResolvedValue(updated); vi.mocked(loadTasks).mockResolvedValue({ tasks: [updated] }); vi.mocked(previewTask).mockResolvedValue(plan);
    await rename.search();
    expect(saveTask).toHaveBeenCalledWith("/workspace", expect.objectContaining({ name: "Edited" }), "task-a", 1);
    expect(previewTask).toHaveBeenCalledWith("/workspace", updated); expect(rename.selected.value).toEqual([]);
    expect(rename.preview.value?.plan_id).toBe("plan-a");
    rename.draft.value.roots.push("/more"); expect(rename.preview.value).toBeNull();
  } finally { scope.stop(); }
});
it("copies configs to a new task without copying executable plans or attempts", async () => {
  const { scope, rename } = await setup();
  try {
    vi.mocked(saveTask).mockResolvedValue({ ...task, name: "Docs 副本", id: "copy" });
    await rename.create(true);
    expect(saveTask).toHaveBeenCalledWith("/workspace", expect.objectContaining({ name: "Docs 副本" }), undefined, undefined);
    const draft = vi.mocked(saveTask).mock.calls[0][1]; expect(draft).not.toHaveProperty("attempts"); expect(draft).not.toHaveProperty("id");
    expect(rename.activeId.value).toBe("copy"); expect(rename.tasks.value).toHaveLength(2);
  } finally { scope.stop(); }
});
it("consumes a failed apply request and refreshes only its original workspace tree", async () => {
  const { scope, rename, report, changed } = await setup();
  try {
    vi.mocked(previewTask).mockResolvedValue(plan); await rename.search(); rename.selected.value = ["selected"];
    vi.mocked(applyTask).mockRejectedValue(new Error("file changed"));
    await rename.apply(); await rename.apply();
    expect(applyTask).toHaveBeenCalledTimes(1); expect(rename.consumed.value).toBe(true);
    expect(report).toHaveBeenCalledWith("file changed", true); expect(changed).toHaveBeenCalledWith("/workspace");
  } finally { scope.stop(); }
});
it("discards late responses and attempt refreshes when changing workspaces", async () => {
  const { scope, rename, workspace } = await setup();
  try {
    let resolve!: (value: { tasks: RenameTask[] }) => void;
    vi.mocked(previewTask).mockResolvedValue(plan);
    vi.mocked(loadTasks).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = rename.search(); await nextTick();
    vi.mocked(loadTasks).mockResolvedValue({ tasks: [] }); workspace.value = "/other"; await nextTick();
    resolve({ tasks: [task] }); await pending;
    expect(rename.tasks.value).toEqual([]); expect(rename.preview.value).toBeNull(); expect(rename.busy.value).toBe(false);
  } finally { scope.stop(); }
});
it("keeps the selected saved task on refresh instead of silently switching to the newest task", async () => {
  const { scope, rename } = await setup();
  try {
    const other = { ...task, id: "task-b", name: "Other" };
    vi.mocked(loadTasks).mockResolvedValue({ tasks: [other, task] });
    await rename.load();
    expect(rename.activeId.value).toBe("task-a");
    expect(rename.draft.value.name).toBe("Docs");
  } finally { scope.stop(); }
});
it("invalidates the old plan even when refreshing tasks fails", async () => {
  const { scope, rename } = await setup();
  try {
    vi.mocked(previewTask).mockResolvedValue(plan); await rename.search(); rename.selected.value = ["selected"];
    vi.mocked(loadTasks).mockRejectedValue(new Error("offline"));
    await rename.load();
    expect(rename.preview.value).toBeNull(); expect(rename.canApply.value).toBe(false);
  } finally { scope.stop(); }
});
it("does not keep an executable preview when the task revision changes during attempt refresh", async () => {
  const { scope, rename } = await setup();
  try {
    vi.mocked(previewTask).mockResolvedValue(plan);
    vi.mocked(loadTasks).mockResolvedValue({ tasks: [{ ...task, revision: 2 }] });
    await rename.search(); rename.selected.value = ["selected"];
    expect(rename.preview.value).toBeNull(); expect(rename.canApply.value).toBe(false);
    expect(rename.error.value).toContain("任务已被修改");
    expect(rename.active.value?.revision).toBe(1); // Do not adopt an unseen version and overwrite it on the next save.
  } finally { scope.stop(); }
});
it("does not offer apply after the task was deleted while refreshing attempts", async () => {
  const { scope, rename } = await setup();
  try {
    vi.mocked(previewTask).mockResolvedValue(plan); vi.mocked(loadTasks).mockResolvedValue({ tasks: [] });
    await rename.search(); rename.selected.value = ["selected"];
    expect(rename.canApply.value).toBe(false); await rename.apply(); expect(applyTask).not.toHaveBeenCalled();
  } finally { scope.stop(); }
});
it("does not discard edits that arrive while saving an older configuration", async () => {
  const { scope, rename } = await setup();
  try {
    let resolve!: (task: RenameTask) => void;
    vi.mocked(saveTask).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    rename.draft.value.name = "First edit"; const pending = rename.save();
    rename.draft.value.name = "Later edit";
    resolve({ ...task, name: "First edit", revision: 2 });
    expect(await pending).toBe(false);
    expect(rename.active.value?.revision).toBe(2); expect(rename.draft.value.name).toBe("Later edit"); expect(rename.dirty.value).toBe(true);
  } finally { scope.stop(); }
});
it("clears stale phase and errors when the workspace is closed", async () => {
  const { scope, rename, workspace } = await setup();
  try {
    let reject!: (error: Error) => void;
    vi.mocked(previewTask).mockReturnValue(new Promise((_done, fail) => { reject = fail; }));
    const pending = rename.search(); workspace.value = ""; reject(new Error("old workspace")); await pending;
    expect(rename.phase.value).toBe(""); expect(rename.error.value).toBe(""); expect(rename.busy.value).toBe(false);
  } finally { scope.stop(); }
});
it("saves and restores all three independent scopes without auto-selecting preview rows", async () => {
  const { scope, rename } = await setup();
  try {
    rename.draft.value.directories = true;
    expect(rename.draft.value).toMatchObject({ directories: true, filenames: true, contents: true });
    const saved = { ...structuredClone(task), directories: true, revision: 2 };
    vi.mocked(saveTask).mockResolvedValue(saved);
    vi.mocked(loadTasks).mockResolvedValue({ tasks: [saved] });
    vi.mocked(previewTask).mockResolvedValue(plan);
    await rename.search();
    expect(saveTask).toHaveBeenCalledWith("/workspace", expect.objectContaining({ directories: true, filenames: true, contents: true }), "task-a", 1);
    expect(previewTask).toHaveBeenCalledWith("/workspace", saved);
    expect(rename.selected.value).toEqual([]);
    await rename.load();
    expect(rename.draft.value).toMatchObject({ directories: true, filenames: true, contents: true });
    expect(rename.preview.value).toBeNull();
    await rename.search(); rename.selected.value = ["selected"];
    rename.draft.value.filenames = false;
    expect(rename.draft.value).toMatchObject({ directories: true, filenames: false, contents: true });
    expect(rename.preview.value).toBeNull(); expect(rename.selected.value).toEqual([]); expect(rename.canApply.value).toBe(false);
  } finally { scope.stop(); }
});
it("keeps joint scopes isolated between tasks and restores their saved configurations", async () => {
  const joint = { ...structuredClone(task), directories: true };
  const other = { ...structuredClone(task), id: "task-b", name: "Other", directories: false, filenames: false, contents: true };
  vi.mocked(loadTasks).mockResolvedValue({ tasks: [joint, other] });
  const { scope, rename } = await setup();
  try {
    expect(rename.draft.value).toMatchObject({ directories: true, filenames: true, contents: true });
    rename.draft.value.contents = false;
    const updated = { ...joint, contents: false, revision: 2 };
    vi.mocked(saveTask).mockResolvedValue(updated); await rename.save();
    rename.choose("task-b");
    expect(rename.draft.value).toMatchObject({ directories: false, filenames: false, contents: true });
    expect(rename.dirty.value).toBe(false);
    rename.choose("task-a");
    expect(rename.draft.value).toMatchObject({ directories: true, filenames: true, contents: false });
    expect(rename.dirty.value).toBe(false);
  } finally { scope.stop(); }
});
