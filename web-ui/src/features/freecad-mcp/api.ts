import { jsonFetch } from "../../api";
import type { FreecadMcpConnection, FreecadMcpInstallPlan, FreecadMcpInstallResult, FreecadMcpSettings, FreecadMcpStatus } from "../../../../shared/freecad-mcp/contracts";
import type { OwnedWorkerObservation } from "../../../../shared/freecad-mcp/worker";

const base = "/api/freecad-mcp";
function fail(): never { throw new Error("FreeCAD MCP 接口响应无效，请重新检测。"); }
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string { return typeof value === "string" && value.length <= 8192 && !value.includes("\0"); }
function nullableText(value: unknown): boolean { return value === null || text(value); }
function state(value: unknown, allowed: string[]): boolean { return typeof value === "string" && allowed.includes(value); }
function observation(value: unknown, allowed: string[]) {
  const result = row(value); if (!state(result.state, allowed) || !text(result.reason)) fail(); return result;
}
export function validateOwnedWorker(value: unknown): OwnedWorkerObservation {
  const result = row(value), fields = ["schema_version", "id", "phase", "reason_code", "message", "owned", "configuration_revision"];
  const uuid = (item: unknown) => typeof item === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item);
  if (Object.keys(result).length !== fields.length || Object.keys(result).some(key => !fields.includes(key)) || result.schema_version !== 1
    || !(result.id === null || uuid(result.id)) || !state(result.phase, ["idle", "starting", "ready", "leased", "stopping", "stopped", "failed", "unknown"])
    || !state(result.reason_code, ["not_started", "launching", "worker_ready", "session_leased", "stop_requested", "stopped_after_owned_close", "startup_failed", "session_lost", "session_not_reusable", "cleanup_failed"])
    || !text(result.message) || typeof result.owned !== "boolean" || !nullableText(result.configuration_revision)
    || (result.owned && (!uuid(result.id) || !text(result.configuration_revision) || !result.configuration_revision))
    || (["starting", "ready", "leased", "stopping"].includes(String(result.phase)) && result.owned !== true)) fail();
  return result as unknown as OwnedWorkerObservation;
}
export function validateConnection(value: unknown): FreecadMcpConnection {
  const result = observation(value, ["not_checked", "blocked", "failed", "ready"]);
  if (!state(result.phase, ["none", "bridge", "mcp"]) || !nullableText(result.bridge_version)
    || typeof result.mcp_verified !== "boolean" || !Array.isArray(result.supported_methods)
    || result.supported_methods.length > 256 || !result.supported_methods.every(text)
    || (result.state === "ready" && (result.phase !== "mcp" || result.mcp_verified !== true))) fail();
  return result as unknown as FreecadMcpConnection;
}
export function validateStatus(value: unknown): FreecadMcpStatus {
  const result = row(value), settings = row(result.settings);
  if (result.schema_version !== 1 || !text(result.revision) || !result.revision
    || !state(settings.mode, ["owned_batch", "existing"]) || !text(settings.mod_directory)
    || typeof settings.mod_directory_confirmed !== "boolean" || !Number.isInteger(settings.existing_port)
    || Number(settings.existing_port) < 1024 || Number(settings.existing_port) > 65535) fail();
  const executable = observation(result.freecad, ["available", "unavailable"]);
  if (!nullableText(executable.executable)) fail();
  const directory = observation(result.mod_directory, ["unselected", "unsafe", "missing", "filesystem_checked"]);
  if (!state(directory.evidence, ["none", "user_confirmed"])) fail();
  for (const item of [
    observation(result.installation, ["not_checked", "absent", "managed", "unmanaged", "modified", "invalid"]),
    observation(result.resource, ["missing", "invalid", "ready"]),
  ]) if (!nullableText(item.version)) fail();
  validateConnection(result.connection); observation(result.batch, ["blocked"]);
  if (result.owned_worker !== undefined) {
    const worker = row(result.owned_worker);
    if (Object.keys(worker).some(key => !["enabled", "reason", "observation"].includes(key)) || typeof worker.enabled !== "boolean" || !text(worker.reason)) fail();
    validateOwnedWorker(worker.observation);
  }
  return result as unknown as FreecadMcpStatus;
}
export function validatePlan(value: unknown): FreecadMcpInstallPlan {
  const result = observation(value, ["blocked", "ready"]);
  if (result.state === "ready") {
    if (![result.plan_id, result.expires_at, result.source_version, result.target, result.backup_parent].every(value => text(value) && Boolean(value))
      || !state(result.operation, ["install", "update", "unchanged"]) || !/^[a-f0-9]{64}$/.test(String(result.source_digest))
      || !Number.isFinite(Date.parse(String(result.expires_at))) || !Array.isArray(result.changes)
      || result.changes.length > 4096 || !result.changes.every(value => {
        const change = row(value); return text(change.path) && state(change.kind, ["add", "change", "remove"]);
      })) fail();
  }
  return result as unknown as FreecadMcpInstallPlan;
}
function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return jsonFetch<T>(`${base}${path}`, { method: "POST", body: JSON.stringify(body), signal });
}
export const freecadMcpApi = {
  status: async (signal?: AbortSignal) => validateStatus(await jsonFetch<unknown>(`${base}/status`, { signal })),
  save: async (settings: FreecadMcpSettings, revision: string) => validateStatus(await jsonFetch<unknown>(`${base}/settings`, { method: "PUT", body: JSON.stringify({ settings, expected_revision: revision }) })),
  preview: async (revision: string, signal?: AbortSignal) => validatePlan(await post<unknown>("/install/preview", { revision }, signal)),
  apply: async (plan_id: string): Promise<FreecadMcpInstallResult> => {
    const result = row(await post<unknown>("/install/apply", { plan_id, confirmed: true }));
    if (!state(result.state, ["installed", "unchanged"]) || !nullableText(result.backup) || typeof result.restart_required !== "boolean") fail();
    validateStatus(result.status); return result as unknown as FreecadMcpInstallResult;
  },
  check: async (revision: string, signal?: AbortSignal) => validateConnection(await post<unknown>("/connection/check", { revision }, signal)),
  start: async (revision: string) => validateOwnedWorker(await post<unknown>("/instance/start", { revision, confirmed: true })),
  stop: async (id: string) => validateOwnedWorker(await post<unknown>("/instance/stop", { id, confirmed: true })),
};
export type FreecadMcpApi = typeof freecadMcpApi;
