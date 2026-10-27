import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
vi.mock("./api", () => ({ applyDrawingAudit: vi.fn(), cancelDrawingBatchJob: vi.fn(), fetchDrawingBatchJob: vi.fn(), fetchDrawingTemplates: vi.fn(), previewDrawingAudit: vi.fn(), previewDrawingGeneration: vi.fn(), startDrawingGeneration: vi.fn() }));
import { applyDrawingAudit, cancelDrawingBatchJob, fetchDrawingBatchJob, fetchDrawingTemplates, previewDrawingAudit, previewDrawingGeneration, startDrawingGeneration } from "./api";
import { syntheticAudit, syntheticGeneration, syntheticJob } from "./fixtures.test-support";
import { useDrawingBatch } from "./useDrawingBatch";
import type { DrawingAuditPreview } from "./types";
import { DRAWING_REPAIR_MAX_ISSUES_PER_FILE } from "./types";
const scopes: Array<{ stop(): void }> = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2035-01-01T00:00:00.000Z")); vi.clearAllMocks();
  vi.mocked(previewDrawingAudit).mockResolvedValue(syntheticAudit()); vi.mocked(previewDrawingGeneration).mockResolvedValue(syntheticGeneration());
  vi.mocked(applyDrawingAudit).mockResolvedValue(syntheticJob()); vi.mocked(startDrawingGeneration).mockResolvedValue(syntheticJob({ kind: "generation" }));
  vi.mocked(fetchDrawingBatchJob).mockResolvedValue(syntheticJob()); vi.mocked(cancelDrawingBatchJob).mockResolvedValue(syntheticJob({ cancel_requested: true }));
  vi.mocked(fetchDrawingTemplates).mockResolvedValue({ root: "/templates", items: [] });
});
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); vi.useRealTimers(); });
function setup() {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/example"), directory = ref("demo"), recursive = ref(false), active = ref(true);
  const host = { appendLog: vi.fn(), confirm: vi.fn().mockResolvedValue(true), changed: vi.fn() };
  return { workspace, directory, recursive, active, host, state: scope.run(() => useDrawingBatch(workspace, directory, recursive, host, active))! };
}
it("does not scan or write automatically and defaults both previews to no selection", async () => {
  const { state } = setup();
  expect(previewDrawingAudit).not.toHaveBeenCalled(); expect(fetchDrawingTemplates).not.toHaveBeenCalled();
  expect(state.dimensionFont.value).toBe("osifont"); expect(state.annotationFont.value).toBe("");
  await state.previewAudit(); await state.previewGeneration();
  expect(state.selectedIssues.value).toEqual({}); expect(state.selectedGeneration.value).toEqual([]);
  expect(state.canApplyAudit.value).toBe(false); expect(state.canStartGeneration.value).toBe(false);
  expect(applyDrawingAudit).not.toHaveBeenCalled(); expect(startDrawingGeneration).not.toHaveBeenCalled();
});
it("sends explicit empty fonts to suppress suggestions, rather than restoring server defaults", async () => {
  const { state } = setup(); state.dimensionFont.value = ""; state.annotationFont.value = ""; await state.previewAudit();
  expect(previewDrawingAudit).toHaveBeenCalledWith("/example", { directory: "demo", recursive: false, dimension_font: "", annotation_font: "" }, expect.any(AbortSignal));
});
it("submits only ready issues in non-error files after explicit confirmation, then consumes the plan", async () => {
  const { state, host } = setup(); await state.previewAudit();
  state.selectAllAudit(true);
  expect(state.auditSelections.value).toEqual([{ id: "drawing-a", issue_ids: ["ready-a"] }]);
  state.selectIssue(state.audit.value!.rows[0], "manual-a", true);
  state.selectedIssues.value["drawing-a"].push("conflict-a", "forged");
  await state.applyAudit(); await state.applyAudit();
  expect(applyDrawingAudit).toHaveBeenCalledExactlyOnceWith("/example", "audit-example", [{ id: "drawing-a", issue_ids: ["ready-a"] }], expect.any(AbortSignal));
  expect(host.confirm.mock.calls[0][1]).toContain("不需要关闭整个 FreeCAD"); expect(host.confirm.mock.calls[0][1]).toContain("原生预校验通过并备份");
  expect(state.audit.value).toBeNull(); expect(state.job.value?.status).toBe("queued");
  await state.previewGeneration(); expect(previewDrawingGeneration).not.toHaveBeenCalled(); // Running results cannot be washed out.
});
it("allows only eligible source rows in generation and retains actual cancelled partial outputs", async () => {
  const { state } = setup(); await state.previewGeneration();
  state.selectedGeneration.value = ["model-a", "model-b", "forged"];
  await state.startGeneration();
  expect(startDrawingGeneration).toHaveBeenCalledExactlyOnceWith("/example", "generation-example", ["model-a"], expect.any(AbortSignal));
  vi.mocked(cancelDrawingBatchJob).mockResolvedValue(syntheticJob({ kind: "generation", status: "cancelled", completed: 1, results: [{ id: "model-a", rel: "demo/ShapeA.FCStd", status: "completed", message: "初稿完成", outputs: ["demo/ShapeA.Drawing.FCStd"], manual_review_required: true }] }));
  await state.cancelJob();
  expect(state.job.value?.results[0].outputs).toEqual(["demo/ShapeA.Drawing.FCStd"]); expect(state.job.value?.status).toBe("cancelled");
});
it("requires an identity PDF candidate only when explicitly restricted and never uses a new target PDF as reference", async () => {
  const { state } = setup(), value = syntheticGeneration(), good = value.rows[0]; state.allowWithoutPdf.value = false;
  value.rows = [good,
    { ...good, id: "missing", reference_pdf: undefined, reference_status: "missing" },
    { ...good, id: "ambiguous", reference_status: "ambiguous" },
    { ...good, id: "unknown", reference_status: undefined },
    { ...good, id: "new-pdf", reference_pdf: good.output_paths[1] },
  ];
  vi.mocked(previewDrawingGeneration).mockResolvedValue(value); await state.previewGeneration(); state.selectAllGeneration(true);
  expect(state.selectedGeneration.value).toEqual(["model-a"]);
  state.selectedGeneration.value = value.rows.map(row => row.id); await state.startGeneration();
  expect(startDrawingGeneration).toHaveBeenCalledExactlyOnceWith("/example", "generation-example", ["model-a"], expect.any(AbortSignal));
});
it("allows no-PDF research drafts by default and binds the opt-out to fresh preview settings", async () => {
  const { state } = setup(), value = syntheticGeneration();
  value.rows = [{ ...value.rows[0], reference_pdf: undefined, reference_status: "missing_allowed" }];
  vi.mocked(previewDrawingGeneration).mockResolvedValue(value); await state.previewGeneration(); state.selectAllGeneration(true);
  expect(state.allowWithoutPdf.value).toBe(true); expect(state.generationIds.value).toEqual(["model-a"]);
  expect(previewDrawingGeneration).toHaveBeenCalledWith("/example", expect.objectContaining({ allow_without_pdf: true }), expect.any(AbortSignal));
  state.allowWithoutPdf.value = false;
  expect(state.generation.value).toBeNull(); expect(state.selectedGeneration.value).toEqual([]);
  await state.previewGeneration(); state.selectAllGeneration(true); expect(state.generationIds.value).toEqual([]);
  expect(previewDrawingGeneration).toHaveBeenLastCalledWith("/example", expect.objectContaining({ allow_without_pdf: false }), expect.any(AbortSignal));
});
it("decline does not consume or apply a plan", async () => {
  const { state, host } = setup(); host.confirm.mockResolvedValue(false); await state.previewAudit(); state.selectAllAudit(true);
  await state.applyAudit(); expect(applyDrawingAudit).not.toHaveBeenCalled(); expect(state.audit.value?.plan_id).toBe("audit-example");
});
it("blocks a late confirmation after selection changes, including toggling back", async () => {
  const { state, host } = setup(); await state.previewAudit(); state.selectAllAudit(true);
  let resolve!: (value: boolean) => void; host.confirm.mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = state.applyAudit(); state.selectedIssues.value = {}; state.selectedIssues.value = { "drawing-a": ["ready-a"] }; resolve(true); await pending;
  expect(applyDrawingAudit).not.toHaveBeenCalled();
});
it("rejects confirmation after deactivation, expiry or a scope change", async () => {
  const { state, host, active } = setup(); await state.previewAudit(); state.selectAllAudit(true);
  let resolve!: (value: boolean) => void; host.confirm.mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = state.applyAudit(); active.value = false; resolve(true); await pending;
  expect(applyDrawingAudit).not.toHaveBeenCalled(); expect(state.audit.value).toBeNull();
  active.value = true; await state.previewAudit(); state.selectAllAudit(true);
  await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
  expect(state.auditExpired.value).toBe(true); expect(state.canApplyAudit.value).toBe(false);
});
it("is single-flight and discards old scope or font-option responses", async () => {
  const { state, directory } = setup(); let resolve!: (value: DrawingAuditPreview) => void;
  vi.mocked(previewDrawingAudit).mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = state.previewAudit(); await state.previewAudit(); await state.previewGeneration();
  expect(previewDrawingAudit).toHaveBeenCalledTimes(1); expect(previewDrawingGeneration).not.toHaveBeenCalled();
  directory.value = "other"; resolve(syntheticAudit()); await pending; expect(state.audit.value).toBeNull();
  directory.value = "demo";
  const next = state.previewAudit(); state.dimensionFont.value = ""; resolve(syntheticAudit()); await next;
  expect(state.audit.value).toBeNull();
});
it("does not revive a late preview after an option is changed and then changed back", async () => {
  const { state } = setup(); let resolve!: (value: ReturnType<typeof syntheticGeneration>) => void;
  vi.mocked(previewDrawingGeneration).mockReturnValue(new Promise(done => { resolve = done; }));
  const pending = state.previewGeneration(); state.allowWithoutPdf.value = false; state.allowWithoutPdf.value = true;
  resolve(syntheticGeneration()); await pending; expect(state.generation.value).toBeNull();
});
it("keeps plans one-use after a failed submission and opens Bottom with the error", async () => {
  const { state, host } = setup(); await state.previewAudit(); state.selectAllAudit(true);
  vi.mocked(applyDrawingAudit).mockRejectedValue(new Error("snapshot changed"));
  await state.applyAudit(); await state.applyAudit(); expect(applyDrawingAudit).toHaveBeenCalledTimes(1);
  expect(state.audit.value).toBeNull(); expect(state.error.value).toContain("不会自动重试");
  expect(host.appendLog).toHaveBeenCalledWith(expect.stringContaining("snapshot changed"), { source: "drawing_batch", open: true });
});
it("distinguishes real HTTP rejection from an unknown submission and preserves rejected preview for review", async () => {
  const { state, host } = setup(); await state.previewAudit(); state.selectAllAudit(true);
  vi.mocked(applyDrawingAudit).mockRejectedValue(new ApiError("CAS validation failed", 400, { code: "request_rejected" }));
  await state.applyAudit();
  expect(state.error.value).toContain("服务已拒绝提交，未启动本次任务"); expect(state.error.value).toContain("CAS validation failed"); expect(state.error.value).not.toContain("结果未确认");
  expect(state.audit.value?.plan_id).toBe("audit-example"); expect(state.auditRejected.value).toBe(true); expect(state.canApplyAudit.value).toBe(false);
  await state.applyAudit(); expect(applyDrawingAudit).toHaveBeenCalledTimes(1);
  expect(host.appendLog).toHaveBeenCalledWith(expect.stringContaining("CAS validation failed"), { source: "drawing_batch", open: true });
});
it("retains only explicitly unconsumed queue-rejected tickets for a separately confirmed retry", async () => {
  const { state, host } = setup(); await state.previewAudit(); state.selectAllAudit(true);
  vi.mocked(applyDrawingAudit).mockRejectedValueOnce(new ApiError("Capacity unavailable", 400, { code: "queue_busy", plan_consumed: false })).mockResolvedValue(syntheticJob());
  await state.applyAudit(); expect(state.audit.value?.plan_id).toBe("audit-example"); expect(state.auditRejected.value).toBe(false); expect(state.canApplyAudit.value).toBe(true);
  expect(state.auditSelections.value).toEqual([{ id: "drawing-a", issue_ids: ["ready-a"] }]);
  expect(applyDrawingAudit).toHaveBeenCalledTimes(1); expect(host.confirm).toHaveBeenCalledTimes(1);
  await state.applyAudit(); expect(applyDrawingAudit).toHaveBeenCalledTimes(2); expect(host.confirm).toHaveBeenCalledTimes(2); expect(state.audit.value).toBeNull();
});
it("uses structured queue state for generation, without guessing from error strings or restoring consumed plans", async () => {
  const { state } = setup(); await state.previewGeneration(); state.selectAllGeneration(true);
  vi.mocked(startDrawingGeneration).mockRejectedValue(new ApiError("queue_busy", 400, { code: "request_rejected" })); await state.startGeneration();
  expect(state.generationRejected.value).toBe(true); expect(state.canStartGeneration.value).toBe(false);
  await state.previewGeneration(); state.selectAllGeneration(true);
  vi.mocked(startDrawingGeneration).mockRejectedValue(new ApiError("Validation rejected", 400, { code: "queue_full", plan_consumed: true })); await state.startGeneration();
  expect(state.generationRejected.value).toBe(true); expect(state.canStartGeneration.value).toBe(false);
  await state.previewGeneration(); state.selectAllGeneration(true);
  vi.mocked(startDrawingGeneration).mockRejectedValue(new ApiError("Capacity", 400, { code: "queue_full", plan_consumed: false })); await state.startGeneration();
  expect(state.generationRejected.value).toBe(false); expect(state.canStartGeneration.value).toBe(true);
});
it("treats 5xx or lost response as unconfirmed and does not revive a retry ticket", async () => {
  const { state } = setup(); await state.previewGeneration(); state.selectAllGeneration(true);
  vi.mocked(startDrawingGeneration).mockRejectedValue(new ApiError("gateway lost response", 503, { code: "queue_busy", plan_consumed: false }));
  await state.startGeneration(); expect(state.generation.value).toBeNull(); expect(state.error.value).toContain("提交结果未确认"); expect(state.error.value).toContain("先查询任务");
  await state.startGeneration(); expect(startDrawingGeneration).toHaveBeenCalledTimes(1);
});
it("stops polling while inactive, preserves the job, and only resumes a read when activated", async () => {
  const { state, active } = setup(); await state.previewAudit(); state.selectAllAudit(true); await state.applyAudit();
  active.value = false; await vi.advanceTimersByTimeAsync(5000); expect(fetchDrawingBatchJob).not.toHaveBeenCalled();
  expect(state.job.value?.id).toBe("job-example"); active.value = true; await nextTick();
  expect(fetchDrawingBatchJob).toHaveBeenCalledTimes(1); expect(applyDrawingAudit).toHaveBeenCalledTimes(1);
  expect(cancelDrawingBatchJob).not.toHaveBeenCalled();
});
it("resumes polling safely when activation happens before an aborted old read finishes", async () => {
  const { state, active } = setup(); await state.previewAudit(); state.selectAllAudit(true); await state.applyAudit();
  let resolve!: (value: ReturnType<typeof syntheticJob>) => void;
  vi.mocked(fetchDrawingBatchJob).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue(syntheticJob({ status: "completed", completed: 1 }));
  const pending = state.refreshJob(); active.value = false; active.value = true;
  resolve(syntheticJob()); await pending; expect(state.job.value?.status).toBe("queued");
  await vi.advanceTimersByTimeAsync(1200); expect(state.job.value?.status).toBe("completed");
  expect(applyDrawingAudit).toHaveBeenCalledTimes(1); expect(cancelDrawingBatchJob).not.toHaveBeenCalled();
});
it("logs failures individually once, while successful results do not grab Bottom", async () => {
  const { state, host } = setup(); await state.previewAudit(); state.selectAllAudit(true); await state.applyAudit(); host.appendLog.mockClear();
  const complete = syntheticJob({ status: "completed", total: 2, completed: 1, failed: 1, results: [
    { id: "ok", rel: "demo/One.Drawing.FCStd", status: "completed", message: "已修正", manual_review_required: true },
    { id: "bad", rel: "demo/Two.Drawing.FCStd", status: "failed", message: "字体不可用", manual_review_required: true },
  ] });
  vi.mocked(fetchDrawingBatchJob).mockResolvedValue(complete); await state.refreshJob(); await state.refreshJob();
  expect(host.appendLog.mock.calls.filter(([text]) => text.includes("Two.Drawing"))).toHaveLength(1);
  expect(host.appendLog).toHaveBeenCalledWith(expect.stringContaining("字体不可用"), { source: "drawing_batch", open: true });
  expect(host.appendLog).toHaveBeenCalledWith(expect.stringContaining("One.Drawing"), { source: "drawing_batch", open: false });
  const previous = state.job.value; await state.previewGeneration(); expect(state.job.value).toEqual(previous);
});
it("filters by issue status and all space-separated search words", async () => {
  const { state } = setup(); await state.previewAudit();
  state.filter.value = "ready"; expect(state.visibleAuditRows.value.map(row => row.id)).toEqual(["drawing-a"]);
  state.filter.value = "conflict"; expect(state.visibleAuditRows.value.map(row => row.id)).toEqual(["drawing-a"]);
  state.filter.value = "error"; expect(state.visibleAuditRows.value.map(row => row.id)).toEqual(["drawing-b"]);
  state.filter.value = "all"; state.query.value = "ShapeA manual"; expect(state.visibleAuditRows.value.map(row => row.id)).toEqual(["drawing-a"]);
  state.query.value = "ShapeA absent"; expect(state.visibleAuditRows.value).toEqual([]);
  state.selectedIssues.value = { "drawing-a": ["ready-a"] }; state.selectAllAudit(false); expect(state.selectedIssues.value).toEqual({});
});
it("does not silently truncate an over-limit selection or send a rejected bulk write", async () => {
  const { state } = setup(), value = syntheticGeneration();
  value.rows = Array.from({ length: 501 }, (_, index) => ({ ...value.rows[0], id: `synthetic-${index}` }));
  vi.mocked(previewDrawingGeneration).mockResolvedValue(value); await state.previewGeneration(); state.selectAllGeneration(true);
  expect(state.generationIds.value).toHaveLength(501); expect(state.generationSelectionTooLarge.value).toBe(true); expect(state.canStartGeneration.value).toBe(false);
  await state.startGeneration(); expect(startDrawingGeneration).not.toHaveBeenCalled();
});
it("blocks 101 issues without consuming a preview and submits exactly 100 after reducing selection", async () => {
  const { state, host } = setup(), value = syntheticAudit(), row = value.rows[0];
  row.issues = Array.from({ length: 101 }, (_, index) => ({ ...row.issues[0], id: `issue-${index}`, location: `Note${index}` }));
  value.rows = [row]; vi.mocked(previewDrawingAudit).mockResolvedValue(value);
  await state.previewAudit(); state.selectAllAudit(true);
  expect(DRAWING_REPAIR_MAX_ISSUES_PER_FILE).toBe(100);
  expect(state.auditSelections.value[0].issue_ids).toHaveLength(101);
  expect(state.auditSelectionTooLarge.value).toBe(true); expect(state.canApplyAudit.value).toBe(false);
  await state.applyAudit(); expect(applyDrawingAudit).not.toHaveBeenCalled(); expect(host.confirm).not.toHaveBeenCalled();
  expect(state.audit.value?.plan_id).toBe("audit-example");
  state.selectIssue(state.audit.value!.rows[0], "issue-100", false);
  expect(state.auditSelectionTooLarge.value).toBe(false); expect(state.canApplyAudit.value).toBe(true);
  await state.applyAudit(); expect(applyDrawingAudit).toHaveBeenCalledOnce();
  expect(vi.mocked(applyDrawingAudit).mock.calls[0][2][0].issue_ids).toHaveLength(100);
});
it("retains the independent 500-file repair limit", async () => {
  const { state } = setup(), value = syntheticAudit(), row = value.rows[0];
  value.rows = Array.from({ length: 501 }, (_, index) => ({ ...row, id: `file-${index}`, rel: `demo/Synthetic${index}.Drawing.FCStd`, issues: [row.issues[0]] }));
  vi.mocked(previewDrawingAudit).mockResolvedValue(value); await state.previewAudit(); state.selectAllAudit(true);
  expect(state.auditSelections.value).toHaveLength(501); expect(state.canApplyAudit.value).toBe(false);
  state.selectFile(state.audit.value!.rows[500], false);
  expect(state.auditSelections.value).toHaveLength(500); expect(state.canApplyAudit.value).toBe(true);
});
it("never submits manual missing-material suggestions, even if selected state is forged", async () => {
  const { state } = setup(), value = syntheticAudit(), row = value.rows[0];
  row.issues.push({ id: "unknown-material", kind: "material", location: "Template", field: "part_material", current: "", proposed: "", status: "manual", message: "缺少源材料/明确配置，需人工确认" });
  vi.mocked(previewDrawingAudit).mockResolvedValue(value); await state.previewAudit();
  state.selectedIssues.value = { "drawing-a": ["ready-a", "unknown-material"] };
  await state.applyAudit();
  expect(applyDrawingAudit).toHaveBeenCalledWith("/example", "audit-example", [{ id: "drawing-a", issue_ids: ["ready-a"] }], expect.any(AbortSignal));
});
it("binds jobs to their workspace without cancelling old tasks or replaying writes", async () => {
  const { state, workspace } = setup(); await state.previewAudit(); state.selectAllAudit(true); await state.applyAudit();
  workspace.value = "/other"; await nextTick(); expect(state.job.value).toBeNull();
  expect(cancelDrawingBatchJob).not.toHaveBeenCalled(); workspace.value = "/example"; await nextTick();
  expect(state.job.value?.id).toBe("job-example"); expect(applyDrawingAudit).toHaveBeenCalledTimes(1);
});
it("clears stale plans on explicit refresh but preserves finished results", async () => {
  const { state } = setup(); await state.previewAudit(); state.selectAllAudit(true);
  vi.mocked(applyDrawingAudit).mockResolvedValue(syntheticJob({ status: "completed", completed: 1 })); await state.applyAudit();
  await state.previewGeneration(); state.selectAllGeneration(true); state.clearPreviews();
  expect(state.generation.value).toBeNull(); expect(state.selectedGeneration.value).toEqual([]); expect(state.job.value?.status).toBe("completed");
});
it("defaults to automatic paper and transmits manual A1/A0 and the explicitly chosen template unchanged", async () => {
  const { state } = setup(); expect(state.paper.value).toBe("auto"); await state.previewGeneration(); expect(previewDrawingGeneration).toHaveBeenLastCalledWith("/example", expect.objectContaining({ paper: "auto" }), expect.any(AbortSignal));
  for (const paper of ["A1", "A0"] as const) { state.paper.value = paper; expect(state.generation.value).toBeNull(); state.template.value = "Independent.svg"; await state.previewGeneration(); expect(previewDrawingGeneration).toHaveBeenLastCalledWith("/example", expect.objectContaining({ paper, template: "Independent.svg" }), expect.any(AbortSignal)); }
});
it("invalidates a pending generation response when paper changes away and back to auto", async () => {
  const { state } = setup(); let resolve!: (value: ReturnType<typeof syntheticGeneration>) => void; vi.mocked(previewDrawingGeneration).mockReturnValue(new Promise(done => { resolve = done; })); const pending = state.previewGeneration(); state.paper.value = "A3"; state.paper.value = "auto"; resolve(syntheticGeneration()); await pending; expect(state.generation.value).toBeNull(); expect(state.selectedGeneration.value).toEqual([]);
});
