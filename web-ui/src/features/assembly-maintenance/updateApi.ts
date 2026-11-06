import { jsonFetch } from "../../api";
import type { AssemblyUpdateJob, AssemblyUpdatePreview, AssemblyUpdateReconciliation } from "../../../../shared/assembly-maintenance";
export type { AssemblyUpdateReconciliation } from "../../../../shared/assembly-maintenance";

function invalid(): never { throw new Error("装配更新响应未通过验证，请核对任务记录；不要重复发布。"); }
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 16384 && !/[\x00-\x1f]/.test(value);
const rel = (value: unknown): value is string => text(value) && !!value && !/^[\\/]|[\\:]/.test(value) && !value.split("/").some(part => !part || part === "." || part === "..");
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const statuses = ["preparing", "ready", "unchanged", "blocked", "failed", "cancelled", "published", "needs_reconcile"];
const phases = ["capturing", "mirroring", "native_update", "native_reopen", "ready", "publishing", "completed"];
const uuid = (value: unknown): value is string => text(value) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function preview(value: unknown): AssemblyUpdatePreview {
  const data = object(value);
  for (const key of ["added", "removed"]) {
    if (!Array.isArray(data[key]) || data[key].length > 10000) invalid();
    for (const value of data[key]) {
      const row = object(value);
      if (![row.object_name, row.label, row.type_id, row.parent_object].every(text) || !row.object_name || !row.type_id) invalid();
    }
  }
  if (!count(data.preserved_joint_count) || !count(data.preserved_instance_count) || !text(data.engine_version)
    || ["rigid_unchanged", "placements_unchanged", "joint_frames_unchanged", "dependency_bytes_unchanged", "independently_reopened"].some(key => data[key] !== true)) invalid();
  return data as unknown as AssemblyUpdatePreview;
}
export function validateAssemblyUpdateJob(value: unknown): AssemblyUpdateJob {
  const data = object(value);
  if (data.protocol_version !== 1 || !uuid(data.id) || !rel(data.file_path)
    || !Array.isArray(data.selected_objects) || !data.selected_objects.length || data.selected_objects.length > 100 || !data.selected_objects.every(text)
    || new Set(data.selected_objects).size !== data.selected_objects.length
    || !statuses.includes(String(data.status)) || !phases.includes(String(data.phase))
    || !text(data.created_at) || !Number.isFinite(Date.parse(data.created_at))
    || (data.expires_at !== null && (!text(data.expires_at) || !Number.isFinite(Date.parse(data.expires_at))))
    || (data.source_sha256 !== null && (typeof data.source_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.source_sha256)))
    || typeof data.can_publish !== "boolean" || ![data.suggested_copy_rel, data.output_rel, data.backup_rel].every(value => value === null || rel(value))
    || !Array.isArray(data.warnings) || data.warnings.length > 100 || !data.warnings.every(text)) invalid();
  if (data.preview !== null) preview(data.preview);
  if (data.error !== null) {
    const error = object(data.error); if (!text(error.code) || !text(error.message)) invalid();
  }
  if (data.can_publish && (data.status !== "ready" || data.phase !== "ready" || !data.preview || data.expires_at === null)) invalid();
  if (data.status === "published" && !data.output_rel) invalid();
  return data as unknown as AssemblyUpdateJob;
}
export function validateAssemblyUpdateReconciliation(value: unknown): AssemblyUpdateReconciliation {
  const data = object(value);
  if (data.protocol_version !== 1 || !uuid(data.id) || data.read_only !== true || data.can_publish !== false
    || !["published_observed", "not_published_observed", "unknown"].includes(String(data.observed_publication))
    || !["absent", "intent", "source_claimed", "published", "failure", "unknown"].includes(String(data.receipt_state))
    || !["original", "updated", "other", "missing", "unknown"].includes(String(data.source_state))
    || ![data.target_state, data.backup_state].every(value => ["verified", "other", "missing", "unknown"].includes(String(value)))
    || !["unchanged", "changed", "unknown"].includes(String(data.dependencies_state)) || typeof data.requires_manual_review !== "boolean" || !text(data.message)) invalid();
  if (data.operation !== null) {
    const operation = object(data.operation);
    if (!rel(operation.file_path) || !statuses.includes(String(operation.status)) || !phases.includes(String(operation.phase)) || !text(operation.created_at)
      || !Number.isFinite(Date.parse(operation.created_at)) || (operation.output_rel !== null && !rel(operation.output_rel))) invalid();
  }
  return data as unknown as AssemblyUpdateReconciliation;
}
async function post(action: string, input: unknown, signal?: AbortSignal) {
  const response = object(await jsonFetch<unknown>(`/api/cad/assembly-maintenance/update/${action}`, { method: "POST", body: JSON.stringify(input), signal }));
  if (response.success !== true) invalid();
  return response.data;
}
export const assemblyUpdateApi = {
  start: async (input: { workspacePath: string; filePath: string; selectedObjects: string[] }) => validateAssemblyUpdateJob(await post("start", input)),
  status: async (input: { workspacePath: string; id: string }, signal?: AbortSignal) => validateAssemblyUpdateJob(await post("status", input, signal)),
  cancel: async (input: { workspacePath: string; id: string }) => validateAssemblyUpdateJob(await post("cancel", input)),
  publish: async (input: { workspacePath: string; id: string; mode: "verified_copy" | "replace_source"; confirmedClosed: boolean; confirmedNotReopened: boolean }) => validateAssemblyUpdateJob(await post("publish", input)),
  reconcile: async (input: { workspacePath: string; id: string }, signal?: AbortSignal) => validateAssemblyUpdateReconciliation(await post("reconcile", input, signal)),
  history: async (input: { workspacePath: string; limit?: number }, signal?: AbortSignal) => {
    const data = object(await post("history", input, signal));
    if (data.protocol_version !== 1 || !Array.isArray(data.records) || data.records.length > 50 || typeof data.truncated !== "boolean") invalid();
    return { protocol_version: 1 as const, records: data.records.map(validateAssemblyUpdateReconciliation), truncated: data.truncated };
  },
};
export type AssemblyUpdateApi = typeof assemblyUpdateApi;
