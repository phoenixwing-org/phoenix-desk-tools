import { effectScope, ref } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { useBatchAttributes } from "./useBatchAttributes";
import type { BomNameSource } from "../utils/bomNameSource";
import type { DraftStorage } from "./batchAttributeDraftCache";
import { applyBatchAttributes, previewBatchAttributes, type BatchAttributePreview } from "../api";
vi.mock("../api", () => ({ applyBatchAttributes: vi.fn(), previewBatchAttributes: vi.fn() }));
const data: BatchAttributePreview = { plan_id: "plan", batch_dir: ".", scanned: 1, overwrite: false, errors: [], skipped: [], rows: [{ rel: "A.FCStd", object_name: "Body", changes: [
  { field: "PartNumber", current: "", proposed: "100001", source: "文件名推断", eligible: true, note: "补充" },
  { field: "PartName", current: "keep", proposed: "new", source: "文件名推断", eligible: false, note: "保留" },
] }] };
function setup(storage?: DraftStorage) {
  const scope = effectScope(); const workspace = ref("/workspace"); const dir = ref("."); const overwrite = ref(false);
  const nameSource = ref<BomNameSource>("label");
  const includeDrawings = ref(false);
  const state = scope.run(() => useBatchAttributes(workspace, dir, overwrite, nameSource, includeDrawings, storage))!;
  return { scope, workspace, dir, overwrite, state, nameSource, includeDrawings };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(previewBatchAttributes).mockResolvedValue(data); vi.mocked(applyBatchAttributes).mockResolvedValue({ results: [{ rel: "A.FCStd", status: "written", message: "ok" }] }); });
it("defaults to label and invalidates the selected plan on source change", async () => {
  const { scope, state, nameSource } = setup();
  try {
    await state.analyze(); state.selectAll(true);
    expect(previewBatchAttributes).toHaveBeenLastCalledWith("/workspace", ".", false, "label", false);
    nameSource.value = "filename";
    expect(state.preview.value).toBeNull(); expect(state.selection.value).toEqual({});
    await state.apply("plan"); expect(applyBatchAttributes).not.toHaveBeenCalled();
    await state.analyze(); expect(previewBatchAttributes).toHaveBeenLastCalledWith("/workspace", ".", false, "filename", false);
  } finally { scope.stop(); }
});
it("does no file processing on entry, and selecting a file includes only eligible fields", async () => {
  const { scope, state } = setup();
  try {
    expect(previewBatchAttributes).not.toHaveBeenCalled();
    expect(applyBatchAttributes).not.toHaveBeenCalled();
    state.selectFile("A.FCStd", true);
    expect(state.selections.value).toEqual([]);
    await state.analyze();
    state.selectFile("A.FCStd", true);
    expect(state.selections.value).toEqual([{ rel: "A.FCStd", fields: ["PartNumber"] }]);
    state.busy.value = true;
    state.selectFile("A.FCStd", false);
    expect(state.selections.value).toHaveLength(1);
    state.busy.value = false;
    state.selectFile("A.FCStd", false);
    expect(state.selections.value).toEqual([]);
  } finally { scope.stop(); }
});
it("requires explicit selections and sends only eligible fields, then consumes the plan", async () => {
  const { scope, state } = setup();
  try {
    await state.analyze(); expect(state.canApply.value).toBe(false);
    state.selectAll(true); state.selection.value["A.FCStd"].push("PartName");
    expect(state.selections.value).toEqual([{ rel: "A.FCStd", fields: ["PartNumber"] }]);
    await state.apply("other"); expect(applyBatchAttributes).not.toHaveBeenCalled();
    await state.apply("plan"); expect(applyBatchAttributes).toHaveBeenCalledWith("/workspace", "plan", [{ rel: "A.FCStd", fields: ["PartNumber"] }], false);
    expect(state.result.value?.results[0].status).toBe("written"); expect(state.canApply.value).toBe(false);
    expect(state.preview.value).toBeNull();
    expect(state.displayPreview.value).toEqual(data);
    expect(state.completed.value).toBe(true);
    expect(state.submittedSelection.value).toEqual({ "A.FCStd": ["PartNumber"] });
    state.selectAll(true); state.selectFile("A.FCStd", true);
    expect(state.selections.value).toEqual([]);
  } finally { scope.stop(); }
});
it("invalidates preview on directory, overwrite or workspace changes, including a pending response", async () => {
  const { scope, workspace, dir, overwrite, state } = setup();
  try {
    for (const change of [() => { dir.value = "parts"; }, () => { overwrite.value = true; }, () => { workspace.value = "/other"; }]) {
      await state.analyze(); state.selectAll(true); change();
      await state.apply("plan"); expect(state.preview.value).toBeNull(); expect(state.selections.value).toEqual([]);
    }
    expect(applyBatchAttributes).not.toHaveBeenCalled();
    let resolve!: (value: BatchAttributePreview) => void;
    vi.mocked(previewBatchAttributes).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = state.analyze(); workspace.value = "/new"; resolve(data); await pending;
    expect(state.preview.value).toBeNull();
  } finally { scope.stop(); }
});
it("does not retry a failed write under an old preview", async () => {
  const { scope, state } = setup();
  try {
    await state.analyze(); state.selectAll(true); vi.mocked(applyBatchAttributes).mockRejectedValueOnce(new Error("stale"));
    await state.apply("plan"); expect(state.error.value).toContain("stale"); expect(state.preview.value).toBeNull();
    expect(state.displayPreview.value).toEqual(data);
    expect(state.completed.value).toBe(true);
    expect(state.result.value).toBeNull();
    await state.apply("plan"); expect(applyBatchAttributes).toHaveBeenCalledTimes(1);
  } finally { scope.stop(); }
});
it("retains mixed results without including unchecked files and clears snapshots on a new scope", async () => {
  const { scope, state, dir } = setup();
  try {
    vi.mocked(previewBatchAttributes).mockResolvedValueOnce({ ...data, rows: [data.rows[0], { ...data.rows[0], rel: "B.FCStd" }, { ...data.rows[0], rel: "C.FCStd" }] });
    await state.analyze(); state.selectFile("A.FCStd", true); state.selectFile("B.FCStd", true);
    vi.mocked(applyBatchAttributes).mockResolvedValueOnce({ results: [{ rel: "A.FCStd", status: "written", message: "ok" }, { rel: "B.FCStd", status: "failed", message: "changed" }] });
    await state.apply("plan");
    expect(state.result.value?.results.map(row => row.status)).toEqual(["written", "failed"]);
    expect(state.displayPreview.value?.rows).toHaveLength(3);
    expect(Object.keys(state.submittedSelection.value)).toEqual(["A.FCStd", "B.FCStd"]);
    dir.value = "other";
    expect(state.displayPreview.value).toBeNull(); expect(state.result.value).toBeNull();
    expect(state.submittedSelection.value).toEqual({});
  } finally { scope.stop(); }
});
it("reports writing only during an actual request and discards late results after a workspace change", async () => {
  const { scope, state, workspace } = setup();
  try {
    let finish!: (value: Awaited<ReturnType<typeof applyBatchAttributes>>) => void;
    vi.mocked(applyBatchAttributes).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await state.analyze(); state.selectAll(true);
    const pending = state.apply("plan");
    expect(state.writing.value).toBe(true);
    expect(state.submittedSelection.value).toEqual({ "A.FCStd": ["PartNumber"] });
    workspace.value = "/new";
    finish({ results: [{ rel: "A.FCStd", status: "written", message: "ok" }] }); await pending;
    expect(state.writing.value).toBe(false); expect(state.displayPreview.value).toBeNull();
    expect(state.result.value).toBeNull(); expect(state.submittedSelection.value).toEqual({});
  } finally { scope.stop(); }
});

function memoryStorage(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
const editable: BatchAttributePreview = { ...data, scanned: 2, rows: ["A.FCStd", "B.FCStd"].map(rel => ({ ...data.rows[0], rel, name_editable: true, changes: [data.rows[0].changes[0], { field: "PartName", current: "", proposed: "框架", source: "标签名", eligible: true, note: "补充", reason: "ready" }] })) };
it("restores local drafts but never restores plan authority, and isolates drawing/source/workspace options", async () => {
  const storage = memoryStorage(); vi.mocked(previewBatchAttributes).mockResolvedValue(editable);
  const first = setup(storage); await first.state.analyze(); first.state.setName("A.FCStd", "定制框架"); first.scope.stop();
  const next = setup(storage);
  try {
    expect(next.state.restored.value).toBe(true); expect(next.state.preview.value).toBeNull();
    expect(next.state.displayPreview.value?.plan_id).toBe(""); expect(next.state.displayPreview.value?.rows[0].changes[1].proposed).toBe("定制框架");
    await next.state.applyOne("plan", "A.FCStd"); expect(applyBatchAttributes).not.toHaveBeenCalled();
    await next.state.analyze(); expect(next.state.displayPreview.value?.rows[0].changes[1].proposed).toBe("定制框架");
    next.includeDrawings.value = true; expect(next.state.displayPreview.value).toBeNull();
    await next.state.analyze(); expect(previewBatchAttributes).toHaveBeenLastCalledWith("/workspace", ".", false, "label", true);
    expect(next.state.displayPreview.value?.rows[0].changes[1].proposed).toBe("框架");
    next.includeDrawings.value = false; expect(next.state.restored.value).toBe(true);
    next.nameSource.value = "filename"; expect(next.state.displayPreview.value).toBeNull();
    next.nameSource.value = "label"; expect(next.state.displayPreview.value?.rows[0].changes[1].proposed).toBe("定制框架");
    next.workspace.value = "/other"; expect(next.state.displayPreview.value).toBeNull();
  } finally { next.scope.stop(); }
});
it("writes one edited row while retaining other drafts, results and a usable remaining plan", async () => {
  vi.mocked(previewBatchAttributes).mockResolvedValue(editable);
  const { scope, state } = setup(memoryStorage());
  try {
    await state.analyze(); state.setName("A.FCStd", "框架甲"); state.setName("B.FCStd", "框架乙"); state.selectAll(true);
    await state.applyOne("plan", "A.FCStd");
    expect(applyBatchAttributes).toHaveBeenLastCalledWith("/workspace", "plan", [{ rel: "A.FCStd", fields: ["PartNumber", "PartName"], values: { PartName: "框架甲" } }], false, true);
    expect(state.completed.value).toBe(false); expect(state.preview.value?.plan_id).toBe("plan");
    expect(state.displayPreview.value?.rows[1].changes[1].proposed).toBe("框架乙");
    expect(state.selections.value.map(row => row.rel)).toEqual(["B.FCStd"]);
    await state.applyOne("plan", "A.FCStd"); expect(applyBatchAttributes).toHaveBeenCalledTimes(1);
    vi.mocked(applyBatchAttributes).mockResolvedValueOnce({ results: [{ rel: "B.FCStd", status: "written", message: "ok" }] });
    await state.apply("plan");
    expect(applyBatchAttributes).toHaveBeenLastCalledWith("/workspace", "plan", [{ rel: "B.FCStd", fields: ["PartNumber", "PartName"], values: { PartName: "框架乙" } }], false);
    expect(state.result.value?.results).toHaveLength(2); expect(state.completed.value).toBe(true);
  } finally { scope.stop(); }
});
it.each(["bad/名称", "", "S", " s ", "A", "z", "Ｓ"])("does not write a row whose edited name %j is invalid", async invalidName => {
  vi.mocked(previewBatchAttributes).mockResolvedValue(editable);
  const { scope, state } = setup();
  try {
    await state.analyze(); state.selectFile("A.FCStd", true); state.setName("A.FCStd", invalidName);
    expect(state.canApply.value).toBe(false); expect(state.rowFields("A.FCStd")).toEqual([]);
    await state.applyOne("plan", "A.FCStd"); expect(applyBatchAttributes).not.toHaveBeenCalled();
    state.setName("A.FCStd", "正确名称"); expect(state.canApply.value).toBe(true);
    expect(state.selections.value[0].fields).toContain("PartName");
    await state.analyze(); expect(state.displayPreview.value?.rows[0].changes[1].proposed).toBe("正确名称");
  } finally { scope.stop(); }
});
it("locks a single row after an uncertain response, preserving the other row for explicit application", async () => {
  vi.mocked(previewBatchAttributes).mockResolvedValue(editable);
  const { scope, state } = setup();
  try {
    await state.analyze(); vi.mocked(applyBatchAttributes).mockRejectedValueOnce(new Error("connection lost"));
    await state.applyOne("plan", "A.FCStd"); expect(state.error.value).toContain("重新预览");
    expect(state.rowFields("A.FCStd")).toEqual([]); expect(state.rowFields("B.FCStd")).toHaveLength(2);
    await state.applyOne("plan", "A.FCStd"); expect(applyBatchAttributes).toHaveBeenCalledTimes(1);
    let finish!: (value: Awaited<ReturnType<typeof applyBatchAttributes>>) => void;
    vi.mocked(applyBatchAttributes).mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const pending = state.applyOne("plan", "B.FCStd"); expect(state.writingFiles.value).toEqual(["B.FCStd"]);
    finish({ results: [{ rel: "B.FCStd", status: "written", message: "ok" }] }); await pending;
    expect(state.writingFiles.value).toEqual([]);
  } finally { scope.stop(); }
});
it("warns about storage failures without preventing in-memory editing", async () => {
  vi.mocked(previewBatchAttributes).mockResolvedValue(editable);
  const { scope, state } = setup({ ...memoryStorage(), setItem: () => { throw new Error("quota"); } });
  try {
    await state.analyze(); state.setName("A.FCStd", "新名称");
    expect(state.cacheWarning.value).toContain("缓存失败"); expect(state.displayPreview.value?.rows[0].changes[1].proposed).toBe("新名称");
  } finally { scope.stop(); }
});
