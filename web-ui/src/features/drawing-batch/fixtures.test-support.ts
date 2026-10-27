import type { DrawingAuditPreview, DrawingBatchJob, DrawingGenerationPreview } from "./types";
// Independent UI protocol samples, not extracted CAD inventories or geometry.
export function syntheticAudit(): DrawingAuditPreview {
  return { plan_id: "audit-example", workspace: "/example", directory: "demo", recursive: false, expires_at: "2035-01-01T00:30:00.000Z", scanned: 2, warnings: [], rows: [
    { id: "drawing-a", rel: "demo/ShapeA.Drawing.FCStd", fingerprint: "example-hash", source_rel: "demo/ShapeA.FCStd", source_node: "Main", issues: [
      { id: "ready-a", kind: "label", location: "Page", field: "Label", current: "Old", proposed: "New", status: "ready", message: "明确匹配" },
      { id: "manual-a", kind: "dimension", location: "View", field: "References", current: "Edge", proposed: "", status: "manual", message: "人工检查几何" },
      { id: "conflict-a", kind: "material", location: "Template", field: "Material", current: "Manual", proposed: "Suggested", status: "conflict", message: "保留人工值" },
    ] },
    { id: "drawing-b", rel: "demo/ShapeB.Drawing.FCStd", fingerprint: "example-hash-b", error: "资源不完整", issues: [{ id: "blocked-ready", kind: "label", location: "Page", field: "Label", current: "Old", proposed: "New", status: "ready", message: "不应提交" }] },
  ] };
}
export function syntheticGeneration(): DrawingGenerationPreview {
  return { plan_id: "generation-example", workspace: "/example", directory: "demo", recursive: false, expires_at: "2035-01-01T00:30:00.000Z", scanned: 2, warnings: [], rows: [
    { id: "model-a", rel: "demo/ShapeA.FCStd", node: "Main", label: "Example shape", kind: "part", eligible: true, message: "初稿待审", paper: "A4", scale: "1:2", template_root: "/templates", template: "Example.svg", output_paths: ["demo/ShapeA.Drawing.FCStd", "demo/ShapeA.Drawing.pdf"], material: "Example alloy", material_source: "model", reference_pdf: "demo/ShapeA.Original.pdf", reference_status: "candidate_needs_review" },
    { id: "model-b", rel: "demo/ShapeB.FCStd", node: "", label: "Other", kind: "assembly", eligible: false, message: "节点待确认", paper: "A4", scale: "auto", template_root: "", template: "", output_paths: [] },
  ] };
}
export function syntheticJob(value: Partial<DrawingBatchJob> = {}): DrawingBatchJob {
  return { id: "job-example", workspace: "/example", kind: "repair", status: "queued", total: 1, completed: 0, failed: 0, cancel_requested: false, results: [], ...value };
}
