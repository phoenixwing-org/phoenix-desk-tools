import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { fetchAssemblyLabelJob, previewAssemblyLabels, startAssemblyLabelJob, type LabelPreview, type LabelJob } from "./api";
import { useAssemblyLabels } from "./useAssemblyLabels";
vi.mock("./api", () => ({ fetchAssemblyLabelJob: vi.fn(), previewAssemblyLabels: vi.fn(), startAssemblyLabelJob: vi.fn() }));
const scopes: EffectScope[] = [];
const preview: LabelPreview = { plan_id: "plan", batch_dir: "assemblies", scanned: 4, errors: [], rows: [
  { rel: "A.ASSY.FCStd", total: 3, pending: 3, issues: 0, eligible: true, status: "needs_fix", message: "ready" },
  { rel: "B.ASSY.FCStd", total: 1, pending: 0, issues: 0, eligible: false, status: "normal", message: "normal" },
  { rel: "C.ASSY.FCStd", total: 1, pending: 0, issues: 1, eligible: false, status: "needs_review", message: "missing" },
] };
const job: LabelJob = { id: "job", state: "running", completed: 0, total: 1, current_rel: "A.ASSY.FCStd", results: [], message: "running", index_state: "pending" };
const done: LabelJob = { ...job, state: "done", completed: 1, current_rel: "", index_state: "updated", results: [{ rel: "A.ASSY.FCStd", status: "written", count: 3, message: "written" }] };
function setup() {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/fixture"), directory = ref("assemblies");
  return { state: scope.run(() => useAssemblyLabels(workspace, directory))!, workspace, directory };
}
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); vi.mocked(previewAssemblyLabels).mockResolvedValue(preview); vi.mocked(startAssemblyLabelJob).mockResolvedValue(job); vi.mocked(fetchAssemblyLabelJob).mockResolvedValue(done); });
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers(); });
it("never scans on entry, defaults to no selection and only selects eligible rows", async () => {
  const { state } = setup(); expect(previewAssemblyLabels).not.toHaveBeenCalled();
  await state.analyze(); expect(state.selected.value).toEqual([]);
  state.select("B.ASSY.FCStd", true); state.select("C.ASSY.FCStd", true); expect(state.canApply.value).toBe(false);
  state.select("A.ASSY.FCStd", true); expect(state.canApply.value).toBe(true);
  await state.apply("wrong plan"); expect(startAssemblyLabelJob).not.toHaveBeenCalled();
});
it("polls a single accepted job and never repeats apply on double clicks or read retries", async () => {
  const { state } = setup(); await state.analyze(); state.select("A.ASSY.FCStd", true); await state.apply("plan");
  expect(startAssemblyLabelJob).toHaveBeenCalledExactlyOnceWith("/fixture", "plan", ["A.ASSY.FCStd"]);
  vi.mocked(fetchAssemblyLabelJob).mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(300); expect(state.error.value).toContain("正在重试");
  await state.apply("plan"); await state.analyze(); expect(previewAssemblyLabels).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1500); expect(state.job.value).toEqual(done); expect(state.busy.value).toBe(false);
  expect(startAssemblyLabelJob).toHaveBeenCalledTimes(1); expect(state.canApply.value).toBe(false);
});
it("marks lost POST results as consumed instead of allowing a write replay", async () => {
  const { state } = setup(); await state.analyze(); state.select("A.ASSY.FCStd", true);
  vi.mocked(startAssemblyLabelJob).mockRejectedValueOnce(new Error("connection lost")); await state.apply("plan");
  expect(state.error.value).toContain("未确认执行结果"); expect(state.consumed.value).toBe(true);
  await state.apply("plan"); expect(startAssemblyLabelJob).toHaveBeenCalledTimes(1);
});
it("invalidates scope and ignores a late preview response", async () => {
  let resolve!: (value: LabelPreview) => void;
  vi.mocked(previewAssemblyLabels).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, directory } = setup(); const request = state.analyze(); directory.value = "other"; resolve(preview); await request;
  expect(state.preview.value).toBeNull(); expect(state.selected.value).toEqual([]);
});
it("stops tracking on workspace change and stops retries for a missing server job", async () => {
  const { state, workspace } = setup(); await state.analyze(); state.select("A.ASSY.FCStd", true); await state.apply("plan");
  vi.mocked(fetchAssemblyLabelJob).mockRejectedValueOnce(new ApiError("not found", 404, null));
  await vi.advanceTimersByTimeAsync(300); expect(state.job.value?.state).toBe("failed"); expect(state.busy.value).toBe(false);
  await vi.advanceTimersByTimeAsync(5000); expect(fetchAssemblyLabelJob).toHaveBeenCalledTimes(1);
  workspace.value = "/other"; expect(state.preview.value).toBeNull(); expect(state.job.value).toBeNull();
});
