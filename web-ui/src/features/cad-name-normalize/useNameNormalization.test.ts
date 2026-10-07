import { effectScope, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNameNormalization } from "./useNameNormalization";
import { analyzeNames, previewNames, startRenameJob, fetchRenameJob, writeNames, type NamePreview } from "./api";
import { fetchCadIndexScan } from "../../api";
import type { BomNameSource } from "../../utils/bomNameSource";
vi.mock("./api", () => ({ analyzeNames: vi.fn(), previewNames: vi.fn(), startRenameJob: vi.fn(), fetchRenameJob: vi.fn(), writeNames: vi.fn() }));
vi.mock("../../api", () => ({ fetchCadIndexScan: vi.fn() }));
const preview: NamePreview = { plan_id: "preview", batch_dir: "parts", scanned: 1, errors: [], rows: [{ rel: "A.FCStd", target_rel: "B.FCStd", object_name: "Body", current_name: "A", proposed_name: "B", current_label: "001.001-B", proposed_label: "001.001-B", attributes_changed: true, rename_changed: true, eligible: true, message: "change", warnings: [] }] };
const job = { id: "index", workspace: "/fixture", state: "running" as const, phase: "reading", scanned: 0, message: "updating" };
function setup() {
  const scope = effectScope(); const workspace = ref("/fixture"); const directory = ref("parts");
  const options = ref({ fixXref: true, syncLabels: true, fixBasename: true });
  const nameSource = ref<BomNameSource>("label");
  const notify = vi.fn();
  const state = scope.run(() => useNameNormalization(workspace, directory, options, nameSource, undefined, notify))!;
  return { scope, state, workspace, options, nameSource, notify };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  vi.mocked(previewNames).mockResolvedValue(preview);
  vi.mocked(writeNames).mockResolvedValue({ prepared_id: "prepared", results: [{ rel: "A.FCStd", status: "written", message: "written" }] });
  vi.mocked(analyzeNames).mockResolvedValue({ analysis_id: "analysis", warning: "workspace index", rows: [{ rel: "A.FCStd", target_rel: "B.FCStd", eligible: true, message: "ready", hosts: [], outside_scope: [] }] });
  vi.mocked(startRenameJob).mockResolvedValue({ id: "rename-job", state: "done", completed: 1, total: 1, current_rel: "", message: "done", results: [{ rel: "A.FCStd", target_rel: "B.FCStd", status: "renamed", message: "done" }], index_update: job });
  vi.mocked(fetchCadIndexScan).mockResolvedValue({ ...job, state: "done", scanned: 42 });
});
afterEach(() => vi.useRealTimers());
it("invalidates plans on drawing mode changes and never enables attribute writes for drawings", async () => {
  const scope = effectScope(), mode = ref<"models" | "drawings">("models");
  const state = scope.run(() => useNameNormalization(ref("/fixture"), ref("parts"), undefined, ref("label"), mode))!;
  try {
    await state.analyzePreview(); state.selectAll(true); expect(state.canWrite.value).toBe(true);
    mode.value = "drawings"; expect(state.preview.value).toBeNull(); expect(state.selected.value).toEqual([]);
    await state.analyzePreview(); state.selectAll(true);
    expect(previewNames).toHaveBeenLastCalledWith("/fixture", "parts", "label", "drawings");
    expect(state.canWrite.value).toBe(false); await state.write("preview"); expect(writeNames).not.toHaveBeenCalled();
    await state.analyzeRename(); state.selectAll(true, "rename"); await state.submitRenamePlan("analysis");
    expect(startRenameJob).toHaveBeenCalledWith("/fixture", "analysis", ["A.FCStd"]);
  } finally { scope.stop(); }
});
async function prepare(state: ReturnType<typeof useNameNormalization>) {
  await state.analyzePreview(); state.selectAll(true); await state.write("preview"); await state.analyzeRename(); state.selectAll(true, "rename");
}
it("defaults to label and invalidates attribute and rename plans on source change", async () => {
  const { scope, state, nameSource } = setup();
  try {
    await prepare(state);
    expect(previewNames).toHaveBeenLastCalledWith("/fixture", "parts", "label", "models");
    nameSource.value = "filename";
    expect(state.preview.value).toBeNull(); expect(state.analysis.value).toBeNull();
    expect(state.selected.value).toEqual([]); expect(state.renameSelected.value).toEqual([]);
    await state.submitRenamePlan("analysis"); expect(startRenameJob).not.toHaveBeenCalled();
    await state.analyzePreview(); expect(previewNames).toHaveBeenLastCalledWith("/fixture", "parts", "filename", "models");
  } finally { scope.stop(); }
});
it("does not process on entry and invalidates rename analysis when shared options change", async () => {
  const { scope, state, options } = setup();
  try {
    expect(previewNames).not.toHaveBeenCalled(); expect(fetchCadIndexScan).not.toHaveBeenCalled();
    await prepare(state); expect(state.canRename.value).toBe(true);
    expect(analyzeNames).toHaveBeenCalledWith("/fixture", { prepared_id: "prepared" }, { fixXref: true, syncLabels: true, fixBasename: true });
    options.value.syncLabels = false;
    expect(state.analysis.value).toBeNull(); expect(state.renameSelected.value).toEqual([]);
    await state.submitRenamePlan("analysis"); expect(startRenameJob).not.toHaveBeenCalled();
  } finally { scope.stop(); }
});
it("can analyze a read-only preview and rename consistent attributes without any attribute write", async () => {
  const { scope, state } = setup();
  vi.mocked(previewNames).mockResolvedValueOnce({ ...preview, rows: preview.rows.map(row => ({ ...row, attributes_changed: false, current_name: row.proposed_name })) });
  try {
    expect(state.canAnalyze.value).toBe(false);
    await state.analyzePreview(); expect(state.canAnalyze.value).toBe(true);
    await state.analyzeRename();
    expect(analyzeNames).toHaveBeenCalledWith("/fixture", { plan_id: "preview" }, { fixXref: true, syncLabels: true, fixBasename: true });
    expect(writeNames).not.toHaveBeenCalled();
    state.selectAll(true, "rename"); await state.submitRenamePlan("analysis");
    expect(startRenameJob).toHaveBeenCalledWith("/fixture", "analysis", ["A.FCStd"]);
    expect(state.attributes.value).toBeNull(); expect(state.canWrite.value).toBe(false);
    expect(state.canAnalyze.value).toBe(false);
  } finally { scope.stop(); }
});
it("allows early analysis of attribute differences, then clears that analysis when attributes are written", async () => {
  const { scope, state } = setup();
  vi.mocked(analyzeNames).mockResolvedValueOnce({ analysis_id: "early", warning: "pending attributes", rows: [{ rel: "A.FCStd", target_rel: "B.FCStd", eligible: false, message: "属性仍有差异", hosts: [], outside_scope: [] }] });
  try {
    await state.analyzePreview(); await state.analyzeRename();
    state.selectAll(true, "rename"); expect(state.canRename.value).toBe(false);
    state.selectAll(true); await state.write("preview");
    expect(state.analysis.value).toBeNull(); expect(state.renameSelected.value).toEqual([]);
    expect(state.canAnalyze.value).toBe(true);
    await state.analyzeRename();
    expect(analyzeNames).toHaveBeenLastCalledWith("/fixture", { prepared_id: "prepared" }, { fixXref: true, syncLabels: true, fixBasename: true });
  } finally { scope.stop(); }
});
it("polls the one backend-started index job without reissuing rename or starting another scan", async () => {
  const { scope, state } = setup();
  try {
    await prepare(state); await state.submitRenamePlan("analysis");
    expect(state.indexing.value).toBe(true); expect(state.canRename.value).toBe(false);
    await state.analyzePreview(); expect(previewNames).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchCadIndexScan).toHaveBeenCalledWith("/fixture", "index");
    expect(state.indexUpdate.value?.state).toBe("done");
    await vi.advanceTimersByTimeAsync(5000); expect(fetchCadIndexScan).toHaveBeenCalledTimes(1);
    expect(startRenameJob).toHaveBeenCalledTimes(1);
  } finally { scope.stop(); }
});
it("preserves file results when index status polling fails, and stops polling on scope change", async () => {
  const { scope, state, workspace } = setup();
  try {
    await prepare(state); await state.submitRenamePlan("analysis");
    vi.mocked(fetchCadIndexScan).mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(500);
    expect(state.renamed.value?.results[0].status).toBe("renamed");
    expect(state.indexUpdate.value).toMatchObject({ state: "failed", message: expect.stringContaining("任务可能仍在运行") });
    workspace.value = "/other";
    await vi.advanceTimersByTimeAsync(5000); expect(fetchCadIndexScan).toHaveBeenCalledTimes(1);
    expect(state.indexUpdate.value).toBeNull(); expect(state.renamed.value).toBeNull();
  } finally { scope.stop(); }
});

it("polls per-file progress, retries status reads without replaying writes, and starts index tracking only after completion", async () => {
  const { scope, state, notify } = setup();
  const running = { id: "batch", state: "running" as const, total: 2, completed: 0, current_rel: "A.FCStd", message: "running", results: [] };
  vi.mocked(startRenameJob).mockResolvedValueOnce(running);
  vi.mocked(fetchRenameJob).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ...running, completed: 1, results: [{ rel: "A.FCStd", target_rel: "B.FCStd", status: "renamed", message: "done" }] })
    .mockResolvedValueOnce({ ...running, state: "done", completed: 2, index_update: job });
  try {
    await prepare(state); await state.submitRenamePlan("analysis");
    expect(state.busy.value).toBe(true); expect(state.indexUpdate.value).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(state.error.value).toContain("请勿重复改名");
    await state.submitRenamePlan("analysis"); expect(startRenameJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.renameJob.value?.completed).toBe(1); expect(state.renamed.value?.results).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(state.busy.value).toBe(false); expect(state.renameDone.value).toBe(true); expect(state.indexing.value).toBe(true);
    expect(notify).toHaveBeenCalledExactlyOnceWith("/fixture");
    await vi.advanceTimersByTimeAsync(3000);
    expect(notify).toHaveBeenCalledTimes(1);
  } finally { scope.stop(); }
});

it.each(["done", "attention", "failed"] as const)("refreshes once on batch %s without waiting for a successful index", async status => {
  const { scope, state, notify } = setup();
  vi.mocked(startRenameJob).mockResolvedValueOnce({ id: "batch", state: status, completed: 1, total: 1, current_rel: "", message: "complete", results: [] });
  try {
    await prepare(state); expect(notify).not.toHaveBeenCalled();
    await state.submitRenamePlan("analysis"); expect(notify).toHaveBeenCalledExactlyOnceWith("/fixture");
  } finally { scope.stop(); }
});
it("refreshes after an uncertain submission and never replays it", async () => {
  const { scope, state, notify } = setup();
  vi.mocked(startRenameJob).mockRejectedValueOnce(Error("lost reply"));
  try {
    await prepare(state); await state.submitRenamePlan("analysis");
    expect(notify).toHaveBeenCalledExactlyOnceWith("/fixture");
    await state.submitRenamePlan("analysis"); expect(startRenameJob).toHaveBeenCalledTimes(1);
  } finally { scope.stop(); }
});
