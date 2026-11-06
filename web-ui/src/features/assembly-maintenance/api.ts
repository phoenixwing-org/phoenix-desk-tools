import { jsonFetch } from "../../api";
import type { AssemblyMaintenanceInspection } from "../../../../shared/assembly-maintenance";

function invalid(): never { throw new Error("装配检查响应无效，请重新检查；未修改 CAD 文件。"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 16384 && !value.includes("\0");
const nullableText = (value: unknown) => value === null || text(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validateAssemblyInspection(value: unknown): AssemblyMaintenanceInspection {
  const result = object(value), source = object(result.source), summary = object(result.summary), update = object(result.update);
  if (result.protocol_version !== 1 || !text(result.rel) || !result.rel
    || result.scope !== "current_saved_file" || result.synchronization !== "not_checked"
    || !/^[a-f0-9]{64}$/.test(String(source.sha256)) || !count(source.bytes)
    || typeof source.mtime_ms !== "number" || !Number.isFinite(source.mtime_ms)
    || update.available !== false || !["requires_verified_preview", "native_refresh_not_validated"].includes(String(update.reason_code)) || !text(update.message)
    || !Array.isArray(result.links) || result.links.length > 100000
    || !Array.isArray(result.joint_issues) || result.joint_issues.length > 100000
    || !Array.isArray(result.warnings) || !result.warnings.every(text)) invalid();
  for (const item of result.links) {
    const link = object(item);
    if (!text(link.object_name) || !text(link.label) || !nullableText(link.target_file)
      || !nullableText(link.target_object_name) || !nullableText(link.target_rel)
      || (link.rigid !== true && link.rigid !== false && link.rigid !== null)
      || !["present", "missing", "local", "outside_workspace", "unknown"].includes(String(link.path_status))) invalid();
  }
  for (const item of result.joint_issues) {
    const issue = object(item);
    if (!text(issue.object_name) || !text(issue.label) || !nullableText(issue.target_object_name)
      || !["Reference1", "Reference2"].includes(String(issue.reference))
      || !["empty_reference", "missing_local_object"].includes(String(issue.reason))) invalid();
  }
  if (![summary.assembly_link_count, summary.joint_issue_count, summary.missing_path_count, summary.unknown_path_count].every(count)
    || summary.assembly_link_count !== result.links.length || summary.joint_issue_count !== result.joint_issues.length
    || summary.missing_path_count !== result.links.filter(item => object(item).path_status === "missing").length) invalid();
  return result as unknown as AssemblyMaintenanceInspection;
}

export const assemblyMaintenanceApi = {
  inspect: async (input: { workspacePath: string; filePath: string }, signal?: AbortSignal) => {
    const response = object(await jsonFetch<unknown>("/api/cad/assembly-maintenance/inspect", {
      method: "POST", body: JSON.stringify(input), signal,
    }));
    if (response.success !== true) invalid();
    return validateAssemblyInspection(response.data);
  },
};
export type AssemblyMaintenanceApi = Pick<typeof assemblyMaintenanceApi, "inspect">;
