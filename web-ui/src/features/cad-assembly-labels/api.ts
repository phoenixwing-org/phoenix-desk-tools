import { jsonFetch } from "../../api";
export type LabelRow = { rel: string; total: number; pending: number; issues: number; eligible: boolean; status: "normal" | "needs_fix" | "needs_review"; message: string };
export type LabelPreview = { plan_id: string; batch_dir: string; scanned: number; rows: LabelRow[]; errors: Array<{ rel: string; message: string }> };
export type LabelResult = { rel: string; status: "written" | "failed" | "uncertain"; count: number; message: string; backup?: string };
export type LabelJob = { id: string; state: "running" | "done" | "attention" | "failed"; completed: number; total: number; current_rel: string; results: LabelResult[]; message: string; index_state: "pending" | "updated" | "not_needed" | "failed" };
function request<T>(workspace: string, action: string, body: unknown) {
  return jsonFetch<T>(`/api/cad/assembly-labels/${action}?workspace=${encodeURIComponent(workspace)}`, { method: "POST", body: JSON.stringify(body) });
}
export const previewAssemblyLabels = (workspace: string, batch_dir: string) => request<LabelPreview>(workspace, "preview", { batch_dir });
export const startAssemblyLabelJob = (workspace: string, plan_id: string, rels: string[]) => request<LabelJob>(workspace, "jobs", { plan_id, rels, confirmed: true });
export const fetchAssemblyLabelJob = (workspace: string, id: string) => jsonFetch<LabelJob>(`/api/cad/assembly-labels/jobs/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`);
