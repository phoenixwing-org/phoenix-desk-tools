import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";
import { createWorkspaceRecoveryBackup, inspectWorkspaceRecoveryBackup, restoreWorkspaceRecoveryBackup, WorkspaceRecoveryError,
  type WorkspaceBackupReceipt, type WorkspaceRestoreReceipt } from "./recovery.js";

const TTL = 10 * 60 * 1000, MAX_INSPECTIONS = 4;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type Status = 400 | 409 | 410 | 413 | 415;
type Identity = { dev: number; ino: number };
export type WorkspaceRecoveryInspection = { inspection_id: string; expires_at: string; backup_directory: string; manifest_sha256: string;
  file_count: number; total_bytes: number; directory_count: number; database_schema_version: number | null };
export class WorkspaceRecoveryRequestError extends WorkspaceRecoveryError {
  constructor(code: string, readonly status: Status, detail: string, readonly causes?: readonly string[], incompleteDirectory?: string) {
    super(code, detail, incompleteDirectory); this.name = "WorkspaceRecoveryRequestError";
  }
}
type Dependencies = { currentWorkspace: () => string; now: () => number; id: () => string;
  backup: typeof createWorkspaceRecoveryBackup; inspect: typeof inspectWorkspaceRecoveryBackup; restore: typeof restoreWorkspaceRecoveryBackup };
type Session = { id: string; workspace: string; workspaceIdentity: Identity; backupDirectory: string; backupIdentity: Identity;
  expiresAt: number; live: boolean; controller: AbortController; summary?: WorkspaceRecoveryInspection };

function fail(code: string, status: Status, detail: string): never { throw new WorkspaceRecoveryRequestError(code, status, detail); }
function signalActive(signal?: AbortSignal) { if (signal?.aborted) fail("cancelled", 400, "备份/恢复请求已取消；若发布已开始，请核对目标目录"); }
function absolute(value: string) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)
    || !path.isAbsolute(value) || path.normalize(value) !== value) fail("invalid_arguments", 400, "目录必须是规范化的非空绝对路径");
  return value;
}
function directory(value: string): Identity {
  absolute(value); const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(value) !== value) fail("unsafe_path", 400, "目录不是 canonical 普通目录");
  return { dev: stat.dev, ino: stat.ino };
}
function same(a: Identity, b: Identity) { return a.dev === b.dev && a.ino === b.ino; }
function target(value: string) {
  absolute(value); const base = path.basename(value);
  if (!base || value === path.parse(value).root || /[:. ]$/.test(base) || base.includes(":")
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base) || Buffer.byteLength(base) > 255) fail("invalid_arguments", 400, "目标目录名称不安全");
  return value;
}
function outsideWorkspace(workspace: string, destination: string) {
  const contains = (parent: string, child: string) => { const rel = path.relative(parent, child); return !rel || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); };
  if (contains(workspace, destination) || contains(destination, workspace)) fail("workspace_conflict", 409, "恢复目标不得与当前工作空间相同、嵌套或成为其祖先");
}
/** Read only the host-selected workspace; never initialize preferences or a database. */
function hostWorkspace() {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.join(runtimeUserDataDir(), "launcher-prefs.json"), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 128 * 1024) return "";
    const buffer = Buffer.alloc(stat.size + 1); let length = 0;
    while (length < buffer.length) { const n = fs.readSync(fd, buffer, length, buffer.length - length, length); if (!n) break; length += n; }
    if (length !== stat.size) return "";
    const prefs: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    return prefs && typeof prefs === "object" && "workspace" in prefs && typeof prefs.workspace === "string" ? prefs.workspace : "";
  } catch { return ""; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
/** Bounded diagnostics: messages only, never Error.stack or an entire manifest. */
export function workspaceRecoveryFailure(error: unknown): WorkspaceRecoveryRequestError {
  if (error instanceof WorkspaceRecoveryRequestError) return error;
  const causes: string[] = [], seen = new Set<unknown>(), pending = [error];
  while (pending.length && causes.length < 8) {
    const current = pending.shift(); if (seen.has(current)) continue; seen.add(current);
    const text = (current instanceof Error ? current.message : String(current)).slice(0, 512); if (text) causes.push(text);
    if (current instanceof AggregateError) pending.push(...current.errors.slice(0, 8));
    if (current instanceof Error && current.cause !== undefined) pending.push(current.cause);
  }
  const code = error instanceof WorkspaceRecoveryError ? error.code : "io_error";
  const status: Status = code === "resource_limit" ? 413 : code === "expired" ? 410
    : ["invalid_arguments", "invalid_backup", "unsafe_path", "missing_database", "cancelled", "inactive"].includes(code) ? 400 : 409;
  return new WorkspaceRecoveryRequestError(code, status, (error instanceof WorkspaceRecoveryError ? error.message : "备份/恢复失败，请核对目录与日志").slice(0, 512),
    Object.freeze(causes), error instanceof WorkspaceRecoveryError ? error.incompleteDirectory : undefined);
}

/** Internal DI only. HTTP cannot select a workspace provider, engine, clock or ID. */
export function createWorkspaceRecoveryService(injected: Partial<Dependencies> = {}) {
  const deps: Dependencies = { currentWorkspace: hostWorkspace, now: Date.now, id: randomUUID,
    backup: createWorkspaceRecoveryBackup, inspect: inspectWorkspaceRecoveryBackup, restore: restoreWorkspaceRecoveryBackup, ...injected };
  const sessions = new Map<string, Session>(); let busy = false, disposed = false, active: Session | undefined, operationController: AbortController | undefined;
  const expire = () => {
    for (const session of sessions.values()) if (deps.now() >= session.expiresAt) {
      session.live = false; session.controller.abort(); sessions.delete(session.id);
    }
  };
  const scope = (workspace: string) => {
    absolute(workspace); const selected = deps.currentWorkspace();
    // Do not stat, resolve or read a body-selected noncurrent workspace.
    if (typeof selected !== "string" || !selected || !path.isAbsolute(selected)) fail("workspace_conflict", 409, "Host 当前没有可用工作空间");
    const canonical = fs.realpathSync(selected);
    if (workspace !== canonical) fail("workspace_conflict", 409, "请求不属于 Host 当前工作空间，未访问请求目录");
    return directory(canonical);
  };
  const acquire = () => {
    if (disposed) fail("inactive", 400, "工作空间恢复服务已失活");
    if (busy) fail("busy", 409, "已有备份、检查或恢复正在执行，请稍后重试"); busy = true;
  };
  const guard = (workspace: string, expected: Identity, signal?: AbortSignal, session?: Session) => {
    if (session && deps.now() >= session.expiresAt) { session.live = false; sessions.delete(session.id); fail("expired", 410, "检查已过期，请重新检查"); }
    if (disposed || (session && !session.live)) fail("inactive", 400, "检查已释放或服务已失活，操作已停止");
    signalActive(signal);
    if (!same(scope(workspace), expected)) fail("workspace_conflict", 409, "当前工作空间目录身份已变化，操作已停止");
    if (session && !same(directory(session.backupDirectory), session.backupIdentity)) fail("source_changed", 409, "检查的备份目录已被替换，请重新检查");
  };
  const lookup = (workspace: string, id: string, release = false) => {
    absolute(workspace); if (typeof id !== "string" || !UUID.test(id)) fail("invalid_arguments", 400, "inspection_id 必须是服务端签发的 UUID"); expire();
    const session = sessions.get(id) ?? (release && active?.id === id ? active : undefined);
    if (!session || !session.live || deps.now() >= session.expiresAt) fail("expired", 410, "检查不存在、已使用、已释放、过期或服务已重启，请重新检查");
    if (workspace !== session.workspace) fail("workspace_conflict", 409, "检查属于另一个工作空间"); return session;
  };
  return {
    async inspect(workspace: string, backupDirectory: string, signal?: AbortSignal): Promise<WorkspaceRecoveryInspection> {
      signalActive(signal); const workspaceIdentity = scope(workspace); absolute(backupDirectory); expire(); acquire();
      let session: Session | undefined;
      try {
        if (sessions.size >= MAX_INSPECTIONS) fail("inspection_limit", 409, "最多保留 4 个检查，请先释放旧检查");
        const backupIdentity = directory(backupDirectory), id = deps.id();
        if (!UUID.test(id) || sessions.has(id)) fail("conflict", 409, "无法签发唯一检查标识");
        session = { id, workspace, workspaceIdentity, backupDirectory, backupIdentity, expiresAt: deps.now() + TTL, live: true, controller: new AbortController() };
        sessions.set(id, session); active = session;
        const current = session, combined = signal ? AbortSignal.any([signal, current.controller.signal]) : current.controller.signal;
        const assertActive = () => guard(workspace, workspaceIdentity, combined, current);
        assertActive(); const manifest = await deps.inspect(backupDirectory, combined, assertActive); assertActive();
        const summary: WorkspaceRecoveryInspection = { inspection_id: id, expires_at: new Date(session.expiresAt).toISOString(), backup_directory: backupDirectory,
          manifest_sha256: createHash("sha256").update(`${JSON.stringify(manifest)}\n`).digest("hex"), file_count: manifest.fileCount,
          total_bytes: manifest.totalBytes, directory_count: manifest.directories.length, database_schema_version: manifest.databaseSchemaVersion };
        session.summary = Object.freeze(summary); return { ...summary };
      } catch (error) { if (session) { session.live = false; sessions.delete(session.id); } throw workspaceRecoveryFailure(error); }
      finally { active = undefined; busy = false; }
    },
    async backup(workspace: string, destination: string, confirmed: boolean, signal?: AbortSignal): Promise<{ receipt: WorkspaceBackupReceipt }> {
      signalActive(signal); if (confirmed !== true) fail("invalid_arguments", 400, "备份需要明确 confirmed:true 确认");
      const identity = scope(workspace); target(destination); acquire(); const controller = new AbortController(); operationController = controller;
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try { const receipt = await deps.backup({ workspace, destinationDirectory: destination, signal: combined, assertActive: () => guard(workspace, identity, combined) }); return { receipt }; }
      catch (error) { throw workspaceRecoveryFailure(error); } finally { operationController = undefined; busy = false; }
    },
    async restore(workspace: string, id: string, destination: string, confirmed: boolean, signal?: AbortSignal): Promise<{ receipt: WorkspaceRestoreReceipt }> {
      signalActive(signal); if (confirmed !== true) fail("invalid_arguments", 400, "恢复需要明确 confirmed:true 确认");
      scope(workspace); target(destination); outsideWorkspace(workspace, destination); const session = lookup(workspace, id);
      if (!session.summary) fail("busy", 409, "备份检查尚未完成"); acquire(); sessions.delete(id); active = session;
      const combined = signal ? AbortSignal.any([signal, session.controller.signal]) : session.controller.signal;
      try {
        guard(workspace, session.workspaceIdentity, combined, session);
        const receipt = await deps.restore({ backupDirectory: session.backupDirectory, destinationWorkspace: destination,
          expectedManifestSha256: session.summary.manifest_sha256, signal: combined, assertActive: () => guard(workspace, session.workspaceIdentity, combined, session) });
        return { receipt }; // Publication succeeded: never replace it with a late cancellation error.
      } catch (error) { throw workspaceRecoveryFailure(error); }
      finally { session.live = false; active = undefined; busy = false; }
    },
    release(workspace: string, id: string, signal?: AbortSignal) {
      signalActive(signal); const session = lookup(workspace, id, true); session.live = false; session.controller.abort(); sessions.delete(id);
      return { released: true as const }; // Mapping validation only; no access to an old workspace filesystem.
    },
    dispose() {
      disposed = true; operationController?.abort(); active?.controller.abort();
      if (active) active.live = false;
      for (const session of sessions.values()) { session.live = false; session.controller.abort(); } sessions.clear();
    },
  };
}
export type WorkspaceRecoveryService = ReturnType<typeof createWorkspaceRecoveryService>;
export const workspaceRecoveryService = createWorkspaceRecoveryService();
