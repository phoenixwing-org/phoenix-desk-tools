/** The native exact-patch planner accepts at most 100 changes per document. */
export const DRAWING_REPAIR_MAX_ISSUES_PER_FILE = 100;

export type DrawingIssueStatus = "ready" | "manual" | "conflict" | "ok";
export type DrawingIssue = {
  id: string; kind: "resource" | "titleblock" | "label" | "link" | "material" | "scale" | "font" | "dimension" | "source";
  location: string; field: string; current: string; proposed: string;
  status: DrawingIssueStatus; message: string;
};
export type DrawingAuditRow = {
  id: string; rel: string; fingerprint: string; source_rel?: string; source_node?: string;
  issues: DrawingIssue[]; error?: string;
};
export type DrawingAuditPreview = {
  plan_id: string; workspace: string; directory: string; recursive: boolean;
  expires_at: string; scanned: number; rows: DrawingAuditRow[]; warnings: string[];
};
export type GenerationRow = {
  id: string; rel: string; node: string; label: string; kind: "part" | "assembly";
  eligible: boolean; message: string; paper: string; scale: string;
  template_root: string; template: string; output_paths: string[];
  material?: string; material_source?: string;
  contour_line_width_mm?: number; dimension_line_width_mm?: number;
  reference_pdf?: string;
  reference_status?: "candidate_needs_review" | "missing" | "missing_allowed" | "ambiguous" | "manual";
  reference_candidates?: Array<{rel:string;status:"candidate"|"manual";message?:string}>;
};
export type DrawingGenerationPreview = {
  plan_id: string; workspace: string; directory: string; recursive: boolean;
  expires_at: string; scanned: number; rows: GenerationRow[]; warnings: string[];
};
export type DrawingBatchResult = {
  id: string; rel: string; status: "completed" | "failed" | "cancelled";
  message: string; outputs?: string[]; backup?: string; warnings?: string[];
  manual_review_required: boolean;
};
export type DrawingBatchJob = {
  id: string; workspace: string; kind: "repair" | "generation";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number; completed: number; failed: number; cancel_requested: boolean;
  active_rel?: string; results: DrawingBatchResult[]; error?: string;
};
