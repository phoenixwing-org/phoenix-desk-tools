import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
import { jsonFetch } from "../../api";
import { applyDrawingAudit, cancelDrawingBatchJob, fetchDrawingBatchJob, fetchDrawingLineWidths, saveDrawingLineWidths, fetchDrawingTemplates, previewDrawingAudit, previewDrawingGeneration, startDrawingGeneration } from "./api";
import { DRAWING_PAPER_OPTIONS, type DrawingLineWidths } from "./types";
beforeEach(() => vi.clearAllMocks());
it("binds every action to explicit workspace, escaping identifiers and passing abort signals", async () => {
  const signal = new AbortController().signal, ws = "/example scope";
  await previewDrawingAudit(ws, { directory: "demo", recursive: true, dimension_font: "osifont" }, signal);
  expect(jsonFetch).toHaveBeenLastCalledWith("/api/cad/drawing-batch/audit/preview?workspace=%2Fexample%20scope", { method: "POST", signal, body: JSON.stringify({ directory: "demo", recursive: true, dimension_font: "osifont" }) });
  await applyDrawingAudit(ws, "plan", [{ id: "drawing", issue_ids: ["issue"] }], signal);
  expect(JSON.parse(vi.mocked(jsonFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ plan_id: "plan", selections: [{ id: "drawing", issue_ids: ["issue"] }], confirmed: true });
  await previewDrawingGeneration(ws, { directory: "demo", recursive: false, paper: "A3", scale: "auto" }, signal);
  expect(vi.mocked(jsonFetch).mock.calls.at(-1)![0]).toContain("/generation/preview?workspace=");
  await startDrawingGeneration(ws, "generation", ["model"], signal);
  expect(JSON.parse(vi.mocked(jsonFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ plan_id: "generation", ids: ["model"], confirmed: true });
  await fetchDrawingBatchJob(ws, "job/a", signal);
  expect(jsonFetch).toHaveBeenLastCalledWith("/api/cad/drawing-batch/jobs/job%2Fa?workspace=%2Fexample%20scope", { signal });
  await cancelDrawingBatchJob(ws, "job/a", signal);
  expect(jsonFetch).toHaveBeenLastCalledWith("/api/cad/drawing-batch/jobs/job%2Fa/cancel?workspace=%2Fexample%20scope", { method: "POST", body: "{}", signal });
  await fetchDrawingTemplates(ws, "/example templates", signal);
  expect(jsonFetch).toHaveBeenLastCalledWith("/api/cad/drawing-batch/templates?root=%2Fexample%20templates&workspace=%2Fexample%20scope", { signal });
});
it("reads effective workspace widths and saves only the numeric whitelist to workspace, never machine", async () => {
  const signal = new AbortController().signal, workspace = "/independent scope", values = { contour_line_width_mm: 0.7, dimension_line_width_mm: 0.3 };
  vi.mocked(jsonFetch).mockResolvedValue({ ...values, creator: "Independent", annotation_font: "Unchanged" });
  expect(await fetchDrawingLineWidths(workspace, signal)).toEqual(values);
  expect(jsonFetch).toHaveBeenLastCalledWith("/api/drawing-research/defaults?workspace=%2Findependent%20scope", { signal });
  expect(await saveDrawingLineWidths(workspace, { ...values, creator: "must not send", scope: "machine" } as DrawingLineWidths, signal)).toEqual(values);
  expect(jsonFetch).toHaveBeenLastCalledWith("/api/drawing-research/defaults", { method: "PUT", signal, body: JSON.stringify({ workspace, scope: "workspace", defaults: values }) });
});
it.each([null, {}, { contour_line_width_mm: "0.5", dimension_line_width_mm: 0.25 }, { contour_line_width_mm: 0.5, dimension_line_width_mm: 0.5 }, { contour_line_width_mm: Infinity, dimension_line_width_mm: 0.25 }])("rejects malformed settings responses [case %#]", async value => {
  vi.mocked(jsonFetch).mockResolvedValue(value);
  await expect(fetchDrawingLineWidths("/independent")).rejects.toThrow(/线宽/);
});
it("rejects bad input before HTTP and treats a differing save receipt as unconfirmed", async () => {
  await expect(saveDrawingLineWidths("/independent", { contour_line_width_mm: 0, dimension_line_width_mm: 0.25 })).rejects.toThrow(/线宽/);
  expect(jsonFetch).not.toHaveBeenCalled();
  vi.mocked(jsonFetch).mockResolvedValue({ contour_line_width_mm: 0.8, dimension_line_width_mm: 0.3 });
  await expect(saveDrawingLineWidths("/independent", { contour_line_width_mm: 0.7, dimension_line_width_mm: 0.3 })).rejects.toThrow(/响应与提交值不同/);
});
it.each(DRAWING_PAPER_OPTIONS)("serializes the explicit %s paper policy without substituting a fixed A4 or dropping a chosen template", async paper => {
  await previewDrawingGeneration("/independent", { directory: ".", recursive: false, paper, template: "Independent.svg", scale: "auto" });
  expect(JSON.parse(vi.mocked(jsonFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ directory: ".", recursive: false, paper, template: "Independent.svg", scale: "auto" });
});
