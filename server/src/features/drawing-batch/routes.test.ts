import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ audit: vi.fn(), repair: vi.fn(), generation: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn(), templates: vi.fn() }));
vi.mock("./audit.js", () => ({ previewDrawingAudit: ports.audit }));
vi.mock("./repair.js", () => ({ startDrawingRepairs: ports.repair }));
vi.mock("./generation.js", () => ({ previewDrawingGeneration: ports.generation, startDrawingGeneration: ports.start }));
vi.mock("./batchJobs.js", () => ({ getBatchJob: ports.get, cancelBatchJob: ports.cancel }));
vi.mock("../drawing-research/service.js", () => ({ templateCatalog: ports.templates }));
import { drawingBatchRoutes } from "./routes.js";
import { DrawingBatchQueueError } from "./errors.js";
const app = new Hono().route("/api/cad/drawing-batch", drawingBatchRoutes);
const workspace = "/synthetic workspace";
const request = (route: string, value: unknown) => app.request(`/api/cad/drawing-batch/${route}?workspace=${encodeURIComponent(workspace)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
beforeEach(() => { for (const port of Object.values(ports)) { port.mockReset(); port.mockReturnValue({ id: "owned", status: "queued" }); } });
it("binds previews to the explicit workspace and forwards only validated options", async () => {
  const response = await request("audit/preview", { directory: "drawings", recursive: true, dimension_font: "osifont", annotation_font: "Example CJK" });
  expect(response.status).toBe(200);
  expect(ports.audit).toHaveBeenCalledWith(workspace, { directory: "drawings", recursive: true, dimension_font: "osifont", annotation_font: "Example CJK", native_inspection: true, signal: expect.any(AbortSignal) });
  expect((await request("generation/preview", { directory: ".", paper: "A3", scale: "1:2" })).status).toBe(200);
  expect(ports.generation).toHaveBeenCalledWith(workspace, { directory: ".", recursive: false, paper: "A3", scale: "1:2", template_root: undefined, template: undefined, allow_without_pdf: true,signal:expect.any(AbortSignal) });
  expect((await request("generation/preview", { directory: ".", allow_without_pdf: false })).status).toBe(200);
  expect(ports.generation.mock.calls.at(-1)?.[1].allow_without_pdf).toBe(false);
});
it('accepts automatic paper and forwards generation cancellation without enabling arbitrary sizes',async()=>{
 const control=new AbortController(),body=JSON.stringify({directory:'.',paper:'auto',scale:'auto'}),raw=new Request(`http://localhost/api/cad/drawing-batch/generation/preview?workspace=${encodeURIComponent(workspace)}`,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))},body,signal:control.signal});
 expect((await app.fetch(raw)).status).toBe(200);const passed=ports.generation.mock.calls[0][1];expect(passed.paper).toBe('auto');expect(passed.signal).toBe(raw.signal);control.abort();expect(passed.signal.aborted).toBe(true);
 for(const paper of ['A1','A0'])expect((await request('generation/preview',{directory:'.',paper})).status).toBe(200);
});
it('preserves generation cancellation when the body limiter clones the request',async()=>{
 const control=new AbortController(),raw=new Request(`http://localhost/api/cad/drawing-batch/generation/preview?workspace=${encodeURIComponent(workspace)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({directory:'.',paper:'auto'}),signal:control.signal});
 expect((await app.fetch(raw)).status).toBe(200);const passed=ports.generation.mock.calls[0][1].signal;control.abort();expect(passed.aborted).toBe(true);
});
it("passes the raw request's exact abort signal internally to audit preview", async () => {
  const control = new AbortController(), body = JSON.stringify({ directory: "drawings" }), raw = new Request(`http://localhost/api/cad/drawing-batch/audit/preview?workspace=${encodeURIComponent(workspace)}`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }, body, signal: control.signal });
  expect((await app.fetch(raw)).status).toBe(200);
  const passed = ports.audit.mock.calls[0][1].signal;expect(passed).toBe(raw.signal);expect(passed.aborted).toBe(false);control.abort();expect(passed.aborted).toBe(true);
});
it("preserves cancellation when the body limiter clones a request without content-length", async () => {
  const control = new AbortController(), raw = new Request(`http://localhost/api/cad/drawing-batch/audit/preview?workspace=${encodeURIComponent(workspace)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ directory: "drawings" }), signal: control.signal });
  expect((await app.fetch(raw)).status).toBe(200);const passed = ports.audit.mock.calls[0][1].signal;control.abort();expect(passed.aborted).toBe(true);
});
it.each([
  ["non_boolean_recursive", "audit/preview", { directory: ".", recursive: "false" }],
  ["control_font", "audit/preview", { directory: ".", annotation_font: "bad\nfont" }],
  ["unsupported_paper", "generation/preview", { directory: ".", paper: "A5" }],
  ["unsupported_scale", "generation/preview", { directory: ".", scale: "1:7" }],
  ["non_boolean_pdf_option", "generation/preview", { directory: ".", allow_without_pdf: "false" }],
  ["patch_injection", "audit/preview", { directory: ".", patches: [{ field: "Label", proposed: "injected" }] }],
  ["native_bypass", "audit/preview", { directory: ".", native_inspection: false }],
  ["signal_injection", "audit/preview", { directory: ".", signal: "client signal" }],
])("rejects unsafe preview options without reaching the engine (%s)", async (_case, route, value) => {
  expect((await request(route, value)).status).toBe(400);
  expect(ports.audit).not.toHaveBeenCalled(); expect(ports.generation).not.toHaveBeenCalled();
});
it("accepts only explicit confirmation and unique, bounded file/issue selections", async () => {
  const valid = { plan_id: "preview", selections: [{ id: "file", issue_ids: ["field-1", "field-2"] }], confirmed: true };
  expect((await request("audit/apply", valid)).status).toBe(202);
  expect(ports.repair).toHaveBeenCalledWith(workspace, valid);
  ports.repair.mockClear();
  for (const invalid of [{ ...valid, confirmed: false }, { ...valid, selections: [] }, { ...valid, selections: [{ id: "file", issue_ids: ["same", "same"] }] }, { ...valid, selections: [{ id: "file", issue_ids: ["x"], patches: [] }] }]) expect((await request("audit/apply", invalid)).status).toBe(400);
  expect(ports.repair).not.toHaveBeenCalled();
  expect((await request("generation/start", { plan_id: "preview", ids: ["node"], confirmed: true })).status).toBe(202);
  expect((await request("generation/start", { plan_id: "preview", ids: ["node", "node"], confirmed: true })).status).toBe(400);
});
it("accepts 100 issues per file, rejects 101 before the service, and keeps the 500-file limit", async () => {
  const issues = Array.from({ length: 101 }, (_, index) => `field-${index}`);
  const input = { plan_id: "same-preview", selections: [{ id: "file", issue_ids: issues }], confirmed: true };
  const rejected = await request("audit/apply", input);
  expect(rejected.status).toBe(400);
  expect((await rejected.json() as { detail: string }).detail).toContain("1–100");
  expect(ports.repair).not.toHaveBeenCalled();
  expect((await request("audit/apply", { ...input, selections: [{ id: "file", issue_ids: issues.slice(0, 100) }] })).status).toBe(202);
  expect(ports.repair).toHaveBeenCalledWith(workspace, expect.objectContaining({ plan_id: "same-preview", selections: [{ id: "file", issue_ids: issues.slice(0, 100) }] }));
  ports.repair.mockClear();
  const files = Array.from({ length: 500 }, (_, index) => ({ id: `file-${index}`, issue_ids: ["field"] }));
  expect((await request("audit/apply", { ...input, selections: files })).status).toBe(202);
  ports.repair.mockClear();
  expect((await request("audit/apply", { ...input, selections: [...files, { id: "extra", issue_ids: ["field"] }] })).status).toBe(400);
  expect(ports.repair).not.toHaveBeenCalled();
});
it("requires workspace ownership for progress/cancel and keeps cancellation explicit", async () => {
  expect((await app.request(`/api/cad/drawing-batch/jobs/owned?workspace=${encodeURIComponent(workspace)}`)).status).toBe(200);
  expect(ports.get).toHaveBeenCalledWith(workspace, "owned");
  expect((await request("jobs/owned/cancel", {})).status).toBe(200);
  expect(ports.cancel).toHaveBeenCalledWith(workspace, "owned");
  ports.get.mockClear();
  expect((await app.request("/api/cad/drawing-batch/jobs/owned")).status).toBe(400);
  expect(ports.get).not.toHaveBeenCalled();
});
it("reports a known queue rejection without consuming the preview ticket", async () => {
  ports.start.mockImplementation(() => { throw new DrawingBatchQueueError("queue_busy", "等待当前任务"); });
  const response = await request("generation/start", { plan_id: "preview", ids: ["node"], confirmed: true });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ detail: "等待当前任务", code: "queue_busy", plan_consumed: false });
  ports.repair.mockImplementation(() => { throw new Error("源文件变化"); });
  const rejected = await request("audit/apply", { plan_id: "preview", selections: [{ id: "file", issue_ids: ["field"] }], confirmed: true });
  expect(await rejected.json()).toEqual({ detail: "源文件变化", code: "request_rejected" });
});
it("bounds the raw JSON payload before parsing", async () => {
  const response = await request("audit/preview", { directory: ".", padding: "x".repeat(256 * 1024) });
  expect(response.status).toBe(413);
  expect(ports.audit).not.toHaveBeenCalled();
});
