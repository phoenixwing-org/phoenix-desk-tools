import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import manifest from "../../../../package.json" with { type: "json" };
import { prepareCadBomTransfer, revalidateCadBomTransfer, type PreparedCadBomTransfer } from "./snapshot.js";
import { exportPreparedCadBomTransfer } from "./export.js";

const TTL = 10 * 60 * 1000;
const MAX_PREVIEWS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class CadBomDeliveryError extends Error {
  constructor(readonly code: string, readonly status: 400 | 409 | 410 | 413 | 415, detail: string, readonly causes?: readonly string[]) {
    super(detail); this.name = "CadBomDeliveryError";
  }
}

/** Internal factory seams only. No dependency or producer version comes from HTTP. */
type Dependencies = {
  now: () => number;
  id: () => string;
  version: () => string;
  prepare: typeof prepareCadBomTransfer;
  revalidate: typeof revalidateCadBomTransfer;
  publish: typeof exportPreparedCadBomTransfer;
};
type Session = {
  id: string; workspace: string; expiresAt: number; live: boolean; reason?: "released" | "expired" | "disposed";
  phase: "preparing" | "idle" | "exporting"; activeSignal?: AbortSignal; prepared?: PreparedCadBomTransfer;
};

function invalid(detail: string): never { throw new CadBomDeliveryError("invalid_arguments", 400, detail); }
function workspaceRoot(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0") || !path.isAbsolute(value)) invalid("工作空间必须是非空绝对目录路径");
  try {
    const canonical = fs.realpathSync(value);
    if (!fs.statSync(canonical).isDirectory()) invalid("工作空间不是目录");
    return canonical;
  } catch (error) { if (error instanceof CadBomDeliveryError) throw error; invalid("工作空间目录不存在或不可读取"); }
}
function assertSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new CadBomDeliveryError("cancelled", 400, "操作已取消；如已开始导出，请核对目标文件结果");
}
function validateId(value: string) { if (typeof value !== "string" || !UUID.test(value)) invalid("preview_id 必须是服务端签发的 UUID"); }
function suggested(prepared: PreparedCadBomTransfer) { return `phoenix-bom-${prepared.envelope.transferId}.json`; }

/** Bounded diagnostics, including AggregateError branches; never serialize stacks. */
export function cadBomDeliveryFailure(error: unknown): CadBomDeliveryError {
  if (error instanceof CadBomDeliveryError) return error;
  const causes: string[] = [], seen = new Set<unknown>(), pending = [error];
  while (pending.length && causes.length < 8) {
    const current = pending.shift(); if (seen.has(current)) continue; seen.add(current);
    const text = (current instanceof Error ? current.message : String(current)).slice(0, 512);
    if (text) causes.push(text);
    if (current instanceof AggregateError) pending.push(...current.errors.slice(0, 8));
    if (current instanceof Error && current.cause !== undefined) pending.push(current.cause);
  }
  return new CadBomDeliveryError("conflict", 409, causes[0] || "BOM 交付失败，请重新预览并核对目标文件", Object.freeze(causes));
}

export function createCadBomDeliveryService(injected: Partial<Dependencies> = {}) {
  const deps: Dependencies = { now: Date.now, id: randomUUID, version: () => manifest.version,
    prepare: prepareCadBomTransfer, revalidate: revalidateCadBomTransfer, publish: exportPreparedCadBomTransfer, ...injected };
  const sessions = new Map<string, Session>(); let busy = false, disposed = false;
  const expire = () => {
    for (const session of sessions.values()) if (deps.now() >= session.expiresAt) {
      session.live = false; session.reason = "expired"; sessions.delete(session.id);
    }
  };
  const check = (session: Session) => {
    if (deps.now() >= session.expiresAt) { session.live = false; session.reason = "expired"; sessions.delete(session.id); }
    if (!session.live) throw new CadBomDeliveryError(session.reason === "expired" ? "expired" : "inactive", session.reason === "expired" ? 410 : 400,
      session.reason === "expired" ? "预览已过期，请重新预览" : "预览已释放或服务已失活，操作已停止");
    assertSignal(session.activeSignal);
  };
  const lookup = (workspace: string, id: string, forRelease = false) => {
    validateId(id); expire();
    const session = sessions.get(id);
    if (!session) throw new CadBomDeliveryError("expired", 410, "预览不存在、已释放或服务已重启，请重新预览");
    if (session.workspace !== workspace) throw new CadBomDeliveryError("workspace_conflict", 409, "预览属于另一个工作空间，请重新预览");
    // Release is an independent request: an aborted active export must not
    // prevent it from revoking the session.
    if (!forRelease) check(session); return session;
  };
  const acquire = () => {
    if (disposed) throw new CadBomDeliveryError("inactive", 400, "BOM 交付服务已失活");
    if (busy) throw new CadBomDeliveryError("busy", 409, "已有 BOM 来源检查或导出正在执行，请稍后重试");
    busy = true;
  };
  const ensureDefaultParent = async (session: Session, target: string) => {
    const prepared = session.prepared!;
    const parent = path.join(session.workspace, ".phoenix", "outbox");
    if (path.dirname(target) !== parent) return;
    await deps.revalidate(session.workspace, prepared, trusted => {
      check(session); trusted.assertCurrent();
      const phoenix = path.dirname(parent), identity = fs.lstatSync(phoenix);
      if (!identity.isDirectory() || identity.isSymbolicLink() || fs.realpathSync(phoenix) !== phoenix) throw new Error("默认 outbox 的索引父目录不安全");
      try { fs.mkdirSync(parent, { mode: 0o700 }); }
      catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
      const current = fs.lstatSync(phoenix), outbox = fs.lstatSync(parent);
      if (current.dev !== identity.dev || current.ino !== identity.ino || !outbox.isDirectory() || outbox.isSymbolicLink() || fs.realpathSync(parent) !== parent) throw new Error("默认 outbox 目录已改变或不安全");
    });
  };
  return {
    async preview(workspace: string, signal?: AbortSignal) {
      assertSignal(signal); const root = workspaceRoot(workspace); expire(); acquire();
      let session: Session | undefined;
      try {
        if (sessions.size >= MAX_PREVIEWS) throw new CadBomDeliveryError("preview_limit", 409, "最多保留 4 个预览，请释放旧预览后重试");
        const id = deps.id();
        if (!UUID.test(id) || sessions.has(id)) throw new CadBomDeliveryError("conflict", 409, "无法签发唯一预览标识，请重试");
        session = { id, workspace: root, expiresAt: deps.now() + TTL, live: true, phase: "preparing", activeSignal: signal };
        sessions.set(id, session);
        const current = session;
        const prepared = await deps.prepare(root, { producerVersion: deps.version(), assertActive: () => check(current) });
        check(session); session.prepared = prepared;
        return { preview_id: id, expires_at: new Date(session.expiresAt).toISOString(), envelope: prepared.envelope,
          bytes: prepared.bytes.byteLength, suggested_filename: suggested(prepared) };
      } catch (error) {
        if (session) { session.live = false; sessions.delete(session.id); }
        throw cadBomDeliveryFailure(error);
      } finally { if (session) { session.activeSignal = undefined; session.phase = "idle"; } busy = false; }
    },
    async exportPreview(workspace: string, id: string, target: string, confirmed: boolean, signal?: AbortSignal) {
      assertSignal(signal);
      if (confirmed !== true) invalid("导出需要明确 confirmed:true 确认");
      if (typeof target !== "string" || !target.trim() || target.length > 4096 || target.includes("\0") || !path.isAbsolute(target)) invalid("target_path 必须是非空绝对文件路径");
      if (target.endsWith(path.sep) || path.normalize(target) !== target || [".", ".."].includes(path.basename(target))) invalid("target_path 必须使用规范目录及安全文件名");
      const root = workspaceRoot(workspace), session = lookup(root, id);
      if (!session.prepared) throw new CadBomDeliveryError("busy", 409, "预览仍在生成，请稍后重试");
      acquire(); session.phase = "exporting"; session.activeSignal = signal;
      try {
        check(session); await ensureDefaultParent(session, target); check(session);
        const receipt = await deps.publish(root, session.prepared, target, { assertActive: () => check(session) });
        // Do not turn an already-published receipt into a cancellation/error.
        return { receipt };
      } catch (error) { throw cadBomDeliveryFailure(error); }
      finally { session.activeSignal = undefined; session.phase = "idle"; busy = false; }
    },
    release(workspace: string, id: string, signal?: AbortSignal) {
      assertSignal(signal); const root = workspaceRoot(workspace), session = lookup(root, id, true);
      session.live = false; session.reason = "released"; sessions.delete(id);
      return { released: true as const };
    },
    dispose() {
      disposed = true;
      for (const session of sessions.values()) { session.live = false; session.reason = "disposed"; }
      sessions.clear();
    },
  };
}
export type CadBomDeliveryService = ReturnType<typeof createCadBomDeliveryService>;
export const cadBomDeliveryService = createCadBomDeliveryService();
