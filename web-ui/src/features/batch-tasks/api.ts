import { jsonFetch, type FileWorksetPayload } from "../../api";
import type { ActionDescriptor, BatchPlan, BatchRun, BatchTask, RunDetail, TaskDraft } from "../../../../shared/batch-tasks/contracts";

export type AdmissionRequest = { protocol_version: 2; plan_id: string; digest: string; client_request_id: string; confirmed: true };
/** A persisted pointer can identify an old request, not upgrade its authority. */
export type AdmissionRecovery = Omit<AdmissionRequest, "protocol_version"> & { protocol_version?: 1 | 2 };
/** Editable suggestions only: no plan, digest, run authorization or old request ID. */
export interface RetryDraftGroup {
  id: string; action_instance_id: string; action_key: string; action_title: string; action_version: number;
  scope: "file" | "batch"; failed_steps: number; available: boolean; reason?: string; draft?: TaskDraft;
}
export interface RetryDrafts { run_id: string; groups: RetryDraftGroup[] }
function request<T>(workspace: string, path: string, body?: unknown): Promise<T> {
  const url = `/api/batch-tasks${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspace)}`;
  return jsonFetch<T>(url, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
}
export const batchTasksApi = {
  actions: (workspace: string) => request<{ actions: ActionDescriptor[] }>(workspace, "/actions"),
  tasks: (workspace: string) => request<{ tasks: BatchTask[] }>(workspace, "/tasks"),
  save: (workspace: string, draft: TaskDraft, id?: string, expected_revision?: number, creationId?: string) => request<{ task: BatchTask }>(workspace, "/tasks", { draft, id, expected_revision, creation_id: creationId }),
  archive: (workspace: string, task: BatchTask, archived: boolean) => request<{ task: BatchTask }>(workspace, `/tasks/${encodeURIComponent(task.id)}/archive`, { expected_revision: task.revision, archived }),
  preview: (workspace: string, task: BatchTask) => request<{ plan: BatchPlan }>(workspace, `/tasks/${encodeURIComponent(task.id)}/preview`, { expected_revision: task.revision }),
  admit: (workspace: string, body: AdmissionRequest) => request<{ run: BatchRun }>(workspace, "/runs", body),
  runs: (workspace: string) => request<{ runs: BatchRun[] }>(workspace, "/runs"),
  detail: (workspace: string, id: string) => request<RunDetail>(workspace, `/runs/${encodeURIComponent(id)}?after=0`),
  retryDrafts: (workspace: string, id: string) => request<RetryDrafts>(workspace, `/runs/${encodeURIComponent(id)}/retry-drafts`),
  cancel: (workspace: string, id: string) => request<{ run: BatchRun }>(workspace, `/runs/${encodeURIComponent(id)}/cancel`, {}),
  byRequest: (workspace: string, id: string) => request<{ run: BatchRun }>(workspace, `/runs/by-request/${encodeURIComponent(id)}`),
  backup: (workspace: string) => request<unknown>(workspace, "/backup", {}),
};
export type BatchTasksApi = typeof batchTasksApi;
/** Host may ignore the query, so callers must verify the returned workspace_path. */
export const fetchBatchInputWorksets = (workspace: string) => jsonFetch<FileWorksetPayload>(`/api/file-worksets?workspace=${encodeURIComponent(workspace)}`);
