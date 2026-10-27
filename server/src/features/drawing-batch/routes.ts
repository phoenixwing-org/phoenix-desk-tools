import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { previewDrawingAudit } from "./audit.js";
import { startDrawingRepairs } from "./repair.js";
import { previewDrawingGeneration, startDrawingGeneration } from "./generation.js";
import { getBatchJob, cancelBatchJob } from "./batchJobs.js";
import { templateCatalog } from "../drawing-research/service.js";
import { DrawingBatchQueueError } from "./errors.js";
import { DRAWING_REPAIR_MAX_ISSUES_PER_FILE } from "./types.js";

export const drawingBatchRoutes = new Hono();
drawingBatchRoutes.use("*", bodyLimit({ maxSize: 256 * 1024, onError: c => c.json({ detail: "请求超过 256 KiB，请缩小勾选范围" }, 413) }));
drawingBatchRoutes.onError((error, c) => c.json(error instanceof DrawingBatchQueueError
  ? { detail: error.message, code: error.code, plan_consumed: false }
  : { detail: error.message, code: "request_rejected" }, 400));
function text(value: unknown, label: string, required = false, max = 4096): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f]/u.test(value) || (required && !value.trim())) throw new Error(`${label}无效`);
  return value;
}
function workspace(c: Context): string { return text(c.req.query("workspace"), "工作空间", true)!; }
async function body(c: Context, keys: string[]): Promise<Record<string, unknown>> {
  const value = await c.req.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求必须为对象");
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error("请求包含不支持的字段");
  return value;
}
function scope(value: Record<string, unknown>) {
  if (value.recursive !== undefined && typeof value.recursive !== "boolean") throw new Error("递归选项必须为布尔值");
  return { directory: text(value.directory, "目录", true)!, recursive: value.recursive === true };
}
function plan(value: Record<string, unknown>): string {
  if (value.confirmed !== true) throw new Error("必须明确确认应用本次预览");
  return text(value.plan_id, "预览标识", true, 200)!;
}
function ids(value: unknown, label: string, max = 500): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new Error(`请选择 1–${max} 个${label}`);
  const result = value.map(item => text(item, label, true, 200)!);
  if (new Set(result).size !== result.length) throw new Error(`${label}不能重复`);
  return result;
}
drawingBatchRoutes.post("/audit/preview", async c => {
  const b = await body(c, ["directory", "recursive", "dimension_font", "annotation_font"]);
  return c.json(await previewDrawingAudit(workspace(c), { ...scope(b), dimension_font: text(b.dimension_font, "尺寸字体", false, 256), annotation_font: text(b.annotation_font, "备注字体", false, 256), native_inspection: true, signal: c.req.raw.signal }));
});
drawingBatchRoutes.post("/audit/apply", async c => {
  const b = await body(c, ["plan_id", "selections", "confirmed"]), plan_id = plan(b);
  if (!Array.isArray(b.selections) || !b.selections.length || b.selections.length > 500) throw new Error("请选择 1–500 个图纸");
  const selections = b.selections.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["id", "issue_ids"].includes(key))) throw new Error("图纸勾选格式无效");
    const row = item as Record<string, unknown>;
    return { id: text(row.id, "图纸标识", true, 200)!, issue_ids: ids(row.issue_ids, "修正项（每份图纸）", DRAWING_REPAIR_MAX_ISSUES_PER_FILE) };
  });
  if (new Set(selections.map(item => item.id)).size !== selections.length) throw new Error("图纸勾选不能重复");
  return c.json(await startDrawingRepairs(workspace(c), { plan_id, selections, confirmed: true }), 202);
});
drawingBatchRoutes.post("/generation/preview", async c => {
  const b = await body(c, ["directory", "recursive", "template_root", "template", "paper", "scale", "allow_without_pdf"]);
  const paper = text(b.paper, "幅面", false, 16), scale = text(b.scale, "比例", false, 16);
  if (paper && !["auto", "A4", "A3", "A2", "A1", "A0"].includes(paper)) throw new Error("请选择自动或 A4/A3/A2/A1/A0");
  if (scale && !["auto", "1:1", "2:1", "5:1", "1:2", "1:5", "1:10"].includes(scale)) throw new Error("请选择自动或常用比例");
  if (b.allow_without_pdf !== undefined && typeof b.allow_without_pdf !== "boolean") throw new Error("参考 PDF 选项必须为布尔值");
  return c.json(await previewDrawingGeneration(workspace(c), { ...scope(b), template_root: text(b.template_root, "模板目录"), template: text(b.template, "模板"), paper, scale, allow_without_pdf: b.allow_without_pdf !== false,signal:c.req.raw.signal }));
});
drawingBatchRoutes.post("/generation/start", async c => {
  const b = await body(c, ["plan_id", "ids", "confirmed"]);
  return c.json(await startDrawingGeneration(workspace(c), { plan_id: plan(b), ids: ids(b.ids, "计划项"), confirmed: true }), 202);
});
drawingBatchRoutes.get("/jobs/:id", c => c.json(getBatchJob(workspace(c), text(c.req.param("id"), "任务标识", true, 200)!)));
drawingBatchRoutes.post("/jobs/:id/cancel", c => c.json(cancelBatchJob(workspace(c), text(c.req.param("id"), "任务标识", true, 200)!)));
drawingBatchRoutes.get("/templates", c => c.json(templateCatalog(text(c.req.query("root"), "模板目录") || "")));
