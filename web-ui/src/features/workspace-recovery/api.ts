import { jsonFetch } from "../../api";
import type { WorkspaceBackupReceipt, WorkspaceRecoveryInspection, WorkspaceRestoreReceipt } from "./types";

const MAX_TOTAL = 192 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(label: string): never { throw new Error(`备份与恢复接口数据无效：${label}`); }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) fail(`${label}字段`);
  return row;
}
function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== "string" || !value.trim() || new TextEncoder().encode(value).byteLength > max || /[\u0000-\u001f\u007f]/.test(value)) fail(label);
  return value;
}
function integer(value: unknown, label: string, max: number, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(label);
  return Number(value);
}
function schema(value: unknown): void { if (value !== null) integer(value, "数据库 schema", Number.MAX_SAFE_INTEGER); }
function warnings(value: unknown): void {
  if (!Array.isArray(value) || value.length > 100) fail("warnings");
  for (const entry of value) if (typeof entry !== "string" || !entry.trim() || entry.includes("\0") || new TextEncoder().encode(entry).byteLength > 4096) fail("warning");
}
export function absoluteRecoveryDirectory(value: unknown): string {
  const result = text(value, "规范绝对目录");
  const normalized = result.replaceAll("\\", "/");
  if (result !== result.trim() || !/^(?:\/|[A-Za-z]:\/|\/\/[^/]+\/[^/]+)/.test(normalized)
    || normalized.split("/").some(part => part === "." || part === "..")
    || /\/\//.test(normalized.replace(/^\/\//, ""))
    || (/[\\/]$/.test(result) && result !== "/" && !/^[A-Za-z]:[\\/]$/.test(result))) fail("规范绝对目录");
  return result;
}
export function joinNewRecoveryDirectory(parent: string, name: string): string {
  absoluteRecoveryDirectory(parent); const segment = text(name, "新目录名", 255);
  if (segment === "." || segment === ".." || /[\\/:]/.test(segment) || /[. ]$/.test(segment)
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)) fail("新目录名");
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return absoluteRecoveryTarget(`${parent.replace(/[\\/]+$/, "")}${separator}${segment}`);
}
export function absoluteRecoveryTarget(value: unknown): string {
  const result = absoluteRecoveryDirectory(value), normalized = result.replaceAll("\\", "/"), base = normalized.split("/").at(-1)!;
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized) || /^\/\/[^/]+\/[^/]+$/.test(normalized)
    || !base || /[:. ]$/.test(base) || base.includes(":") || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)
    || new TextEncoder().encode(base).byteLength > 255) fail("新目标目录名称");
  return result;
}
function id(value: unknown): string { const result = text(value, "inspection_id", 36); if (!uuid.test(result)) fail("inspection_id"); return result; }
export function validateWorkspaceRecoveryInspection(value: unknown): WorkspaceRecoveryInspection {
  const row = object(value, ["inspection_id", "expires_at", "backup_directory", "manifest_sha256", "file_count", "total_bytes", "directory_count", "database_schema_version"], "检查结果");
  id(row.inspection_id); absoluteRecoveryDirectory(row.backup_directory);
  const stamp = text(row.expires_at, "expires_at", 32), time = Date.parse(stamp);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== stamp) fail("expires_at");
  if (!/^[0-9a-f]{64}$/.test(text(row.manifest_sha256, "manifest_sha256", 64))) fail("manifest_sha256");
  integer(row.file_count, "file_count", 4096, 1); integer(row.total_bytes, "total_bytes", MAX_TOTAL, 1);
  integer(row.directory_count, "directory_count", 4096); schema(row.database_schema_version);
  return row as unknown as WorkspaceRecoveryInspection;
}
export function validateWorkspaceBackupReceipt(value: unknown): WorkspaceBackupReceipt {
  const outer = object(value, ["receipt"], "备份响应"), row = object(outer.receipt, ["backupDirectory", "fileCount", "totalBytes", "databaseSchemaVersion", "warnings"], "备份回执");
  absoluteRecoveryDirectory(row.backupDirectory); integer(row.fileCount, "fileCount", 4096, 1);
  integer(row.totalBytes, "totalBytes", MAX_TOTAL, 1); schema(row.databaseSchemaVersion); warnings(row.warnings);
  return row as unknown as WorkspaceBackupReceipt;
}
export function validateWorkspaceRestoreReceipt(value: unknown): WorkspaceRestoreReceipt {
  const outer = object(value, ["receipt"], "恢复响应"), row = object(outer.receipt, ["workspace", "fileCount", "totalBytes", "warnings"], "恢复回执");
  absoluteRecoveryDirectory(row.workspace); integer(row.fileCount, "fileCount", 4096, 1);
  integer(row.totalBytes, "totalBytes", MAX_TOTAL, 1); warnings(row.warnings);
  return row as unknown as WorkspaceRestoreReceipt;
}
export async function inspectWorkspaceRecovery(workspace: string, backup: string, signal?: AbortSignal): Promise<WorkspaceRecoveryInspection> {
  const ws = absoluteRecoveryDirectory(workspace);
  const raw = await jsonFetch<unknown>("/api/workspace-recovery/inspect", { method: "POST", body: JSON.stringify({ workspace: ws, backup_directory: absoluteRecoveryDirectory(backup) }), signal });
  try { return validateWorkspaceRecoveryInspection(raw); }
  catch (error) {
    const candidate = raw && typeof raw === "object" && "inspection_id" in raw ? raw.inspection_id : null;
    if (typeof candidate === "string" && uuid.test(candidate)) void releaseWorkspaceRecovery(ws, candidate).catch(() => undefined);
    throw error;
  }
}
export async function backupWorkspaceRecovery(workspace: string, target: string, signal?: AbortSignal): Promise<WorkspaceBackupReceipt> {
  return validateWorkspaceBackupReceipt(await jsonFetch<unknown>("/api/workspace-recovery/backup", { method: "POST", body: JSON.stringify({ workspace: absoluteRecoveryDirectory(workspace), target_directory: absoluteRecoveryTarget(target), confirmed: true }), signal }));
}
export async function restoreWorkspaceRecovery(workspace: string, inspection: string, target: string, signal?: AbortSignal): Promise<WorkspaceRestoreReceipt> {
  return validateWorkspaceRestoreReceipt(await jsonFetch<unknown>("/api/workspace-recovery/restore", { method: "POST", body: JSON.stringify({ workspace: absoluteRecoveryDirectory(workspace), inspection_id: id(inspection), target_directory: absoluteRecoveryTarget(target), confirmed: true }), signal }));
}
export async function releaseWorkspaceRecovery(workspace: string, inspection: string): Promise<void> {
  const row = object(await jsonFetch<unknown>("/api/workspace-recovery/release", { method: "POST", body: JSON.stringify({ workspace: absoluteRecoveryDirectory(workspace), inspection_id: id(inspection) }) }), ["released"], "释放响应");
  if (row.released !== true) fail("released");
}
