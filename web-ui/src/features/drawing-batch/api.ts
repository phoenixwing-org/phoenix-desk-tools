import { jsonFetch } from "../../api";
import { parseDrawingLineWidths } from "./lineWidthSettings";
import type { DrawingLineWidths } from "./types";
import type { DrawingAuditOptions, DrawingAuditPreview, DrawingAuditSelection, DrawingBatchJob, DrawingGenerationOptions, DrawingGenerationPreview, DrawingScope, DrawingTemplateCatalog } from "./types";
const base = "/api/cad/drawing-batch";
function request<T>(workspace: string, route: string, body?: unknown, signal?: AbortSignal) {
  const url = `${base}/${route}${route.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspace)}`;
  return jsonFetch<T>(url, body === undefined ? { signal } : { method: "POST", body: JSON.stringify(body), signal });
}
export const previewDrawingAudit = (workspace: string, scope: DrawingScope & DrawingAuditOptions, signal?: AbortSignal) => request<DrawingAuditPreview>(workspace, "audit/preview", scope, signal);
export const applyDrawingAudit = (workspace: string, plan_id: string, selections: DrawingAuditSelection[], signal?: AbortSignal) => request<DrawingBatchJob>(workspace, "audit/apply", { plan_id, selections, confirmed: true }, signal);
export const previewDrawingGeneration = (workspace: string, scope: DrawingScope & DrawingGenerationOptions, signal?: AbortSignal) => request<DrawingGenerationPreview>(workspace, "generation/preview", scope, signal);
export const startDrawingGeneration = (workspace: string, plan_id: string, ids: string[], signal?: AbortSignal) => request<DrawingBatchJob>(workspace, "generation/start", { plan_id, ids, confirmed: true }, signal);
export const fetchDrawingBatchJob = (workspace: string, id: string, signal?: AbortSignal) => request<DrawingBatchJob>(workspace, `jobs/${encodeURIComponent(id)}`, undefined, signal);
export const cancelDrawingBatchJob = (workspace: string, id: string, signal?: AbortSignal) => request<DrawingBatchJob>(workspace, `jobs/${encodeURIComponent(id)}/cancel`, {}, signal);
export const fetchDrawingTemplates = (workspace: string, root: string, signal?: AbortSignal) => request<DrawingTemplateCatalog>(workspace, `templates?root=${encodeURIComponent(root)}`, undefined, signal);
export async function fetchDrawingLineWidths(workspace: string, signal?: AbortSignal): Promise<DrawingLineWidths> {
  return parseDrawingLineWidths(await jsonFetch<unknown>(`/api/drawing-research/defaults?workspace=${encodeURIComponent(workspace)}`, { signal }));
}
export async function saveDrawingLineWidths(workspace: string, input: DrawingLineWidths, signal?: AbortSignal): Promise<DrawingLineWidths> {
  const defaults = parseDrawingLineWidths(input);
  const saved = parseDrawingLineWidths(await jsonFetch<unknown>("/api/drawing-research/defaults", { method: "PUT", body: JSON.stringify({ workspace, scope: "workspace", defaults }), signal }));
  if (saved.contour_line_width_mm !== defaults.contour_line_width_mm || saved.dimension_line_width_mm !== defaults.dimension_line_width_mm) throw new Error("线宽保存响应与提交值不同，请重新读取核对。");
  return saved;
}
