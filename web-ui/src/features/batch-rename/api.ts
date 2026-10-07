import { jsonFetch } from "../../api";
export type RenameRow = { kind?: "file" | "directory"; id: string; root: string; rel: string; target: string; occurrences: number; binary: boolean; eligible: boolean; message: string; diffs: Array<{ line: number; before: string; after: string }>; truncated: boolean };
export type RenamePreview = { excluded_rules?: Array<{ row: number; old: string; target: string; reason: string }>; plan_id: string; expires_at: string; roots: string[]; mappings: Array<{ old: string; target: string; chain: string[] }>; conflicts: string[]; rows: RenameRow[]; scanned: number; skipped: number; warnings: string[] };
export type RenameResult = { id: string; root: string; rel: string; target: string; status: "applied" | "failed"; message: string; backup?: string };
export type RenameResults = { results: RenameResult[]; applied: number; failed: number };
export type TaskDraft = { name: string; mappings: Array<{ old: string; target: string; enabled: boolean }>; roots: string[]; directories?: boolean; filenames: boolean; contents: boolean; include_stem: boolean };
export type RenameAttempt = { id: string; revision: number; at: string; kind: "preview" | "apply"; state: "done" | "failed" | "running"; matched?: number; applied?: number; failed?: number; message?: string };
export type RenameTask = TaskDraft & { id: string; revision: number; updated_at: string; attempts: RenameAttempt[] };
function request<T>(workspace: string, action: string, body?: unknown) {
  return jsonFetch<T>(`/api/rename-tasks/${action}?workspace=${encodeURIComponent(workspace)}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
}
export const loadTasks = (workspace: string) => request<{ tasks: RenameTask[] }>(workspace, "tasks");
export const saveTask = (workspace: string, draft: TaskDraft, id?: string, revision?: number) => request<RenameTask>(workspace, "save", { draft, id, revision });
export const previewTask = (workspace: string, task: RenameTask) => request<RenamePreview>(workspace, "preview", { task_id: task.id, revision: task.revision });
export const applyTask = (workspace: string, task: RenameTask, plan_id: string, ids: string[]) => request<RenameResults>(workspace, "apply", { task_id: task.id, revision: task.revision, plan_id, ids, confirmed: true });
