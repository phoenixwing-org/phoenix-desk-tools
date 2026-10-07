import { jsonFetch, type RefScanPayload, type CadIndexScanJob } from "../../api";

export type NameRow = {
  kind?: "model" | "drawing"; source_rel?: string;
  rel: string; object_name: string; current_name: string; current_label: string;
  proposed_name: string; proposed_label: string; target_rel: string;
  attributes_changed: boolean; rename_changed: boolean; eligible: boolean; message: string; warnings: string[];
  status?: "normal" | "needs_fix" | "needs_review";
};
export type NamePreview = { plan_id: string; batch_dir: string; scanned: number; rows: NameRow[]; errors: Array<{ rel: string; message: string }> };
export type IndexUpdate = CadIndexScanJob | { state: "failed"; message: string };
export type AttributeResults = { prepared_id: string | null; index_update?: IndexUpdate; results: Array<{ rel: string; status: "written" | "unchanged" | "failed"; message: string; backup?: string }> };
export type RenameOptions = { fixXref: boolean; syncLabels: boolean; fixBasename: boolean };
export type RenameAnalysis = { analysis_id: string; warning: string; options?: RenameOptions; rows: Array<{ rel: string; target_rel: string; eligible: boolean; status?: NameRow["status"]; message: string; hosts: RefScanPayload["hosts"]; outside_scope: string[] }> };
export type RenameResults = { index_update?: IndexUpdate; results: Array<{ rel: string; target_rel: string; status: "renamed" | "references_pending" | "failed" | "uncertain" | "skipped"; message: string; rename_log_id?: number; backup?: string; xlink_patches?: number; label_patches?: number; failed_hosts?: Array<{ host_repo_rel_path: string; error: string }>; host_backups?: Array<{ rel: string; backup: string }> }> };
export type RenameJob = RenameResults & { id: string; state: "running" | "done" | "attention" | "failed"; completed: number; total: number; current_rel: string; message: string };
function request<T>(workspace: string, action: string, body: unknown) {
  return jsonFetch<T>(`/api/cad/name-normalize/${action}?workspace=${encodeURIComponent(workspace)}`, { method: "POST", body: JSON.stringify(body) });
}
export const previewNames = (workspace: string, batch_dir: string, name_source: import("../../utils/bomNameSource").BomNameSource = "label", mode: "models" | "drawings" = "models") => request<NamePreview>(workspace, "preview", { batch_dir, name_source, mode });
export const writeNames = (workspace: string, plan_id: string, rels: string[]) => request<AttributeResults>(workspace, "attributes", { plan_id, rels, confirmed: true });
export const analyzeNames = (workspace: string, plan: { prepared_id: string } | { plan_id: string }, options?: RenameOptions) => request<RenameAnalysis>(workspace, "analyze", { ...plan, options });
export const renameNames = (workspace: string, analysis_id: string, rels: string[]) => request<RenameResults>(workspace, "rename", { analysis_id, rels, confirmed: true });
export const startRenameJob = (workspace: string, analysis_id: string, rels: string[]) => request<RenameJob>(workspace, "rename-jobs", { analysis_id, rels, confirmed: true });
export const fetchRenameJob = (workspace: string, id: string) => jsonFetch<RenameJob>(`/api/cad/name-normalize/rename-jobs/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`);
