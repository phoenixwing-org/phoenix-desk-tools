import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { workspaceRecoveryService, workspaceRecoveryFailure, WorkspaceRecoveryRequestError, type WorkspaceRecoveryService } from "./service.js";

const MAX_BODY = 16 * 1024;
function cancelled(signal: AbortSignal) { if (signal.aborted) throw new WorkspaceRecoveryRequestError("cancelled", 400, "备份/恢复请求已取消"); }
function duplicateKeys(text: string) {
  let depth = 0; const keys = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let next = i + 1; while (next < text.length && /\s/.test(text[next])) next++;
      if (depth === 1 && text[next] === ":") {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) throw new WorkspaceRecoveryRequestError("invalid_arguments", 400, "请求 JSON 不接受重复字段");
        keys.add(key);
      }
    } else if (text[i] === "{" || text[i] === "[") depth++;
    else if (text[i] === "}" || text[i] === "]") depth--;
  }
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  cancelled(request.signal);
  const fail = (code: string, status: 400 | 413 | 415, detail: string): never => { void request.body?.cancel().catch(() => {}); throw new WorkspaceRecoveryRequestError(code, status, detail); };
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail("unsupported_media_type", 415, "仅接受 application/json 请求");
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY) fail("resource_limit", 413, "请求 JSON 超过 16 KiB 安全上限");
  if (!request.body) fail("invalid_arguments", 400, "请求缺少 JSON");
  const reader = request.body!.getReader(), chunks: Uint8Array[] = []; let size = 0, complete = false;
  try {
    while (true) {
      cancelled(request.signal); let abort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new WorkspaceRecoveryRequestError("cancelled", 400, "备份/恢复请求已取消")); request.signal.addEventListener("abort", abort, { once: true }); });
      let item: ReadableStreamReadResult<Uint8Array>;
      try { item = await Promise.race([reader.read(), aborted]); } finally { request.signal.removeEventListener("abort", abort); }
      cancelled(request.signal);
      if (item.done) { complete = true; break; }
      size += item.value.byteLength;
      if (size > MAX_BODY) throw new WorkspaceRecoveryRequestError("resource_limit", 413, "请求 JSON 超过 16 KiB 安全上限");
      if (item.value.byteLength) chunks.push(item.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body: unknown = JSON.parse(text); duplicateKeys(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof WorkspaceRecoveryRequestError) throw error;
    throw new WorkspaceRecoveryRequestError("invalid_arguments", 400, "请求必须是有效 UTF-8 JSON 对象");
  } finally { if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function fields(body: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(body).some(key => !expected.includes(key)) || expected.some(key => !Object.hasOwn(body, key))) throw new WorkspaceRecoveryRequestError("invalid_arguments", 400, "请求字段缺失或包含不允许的字段");
  for (const key of expected) if (key !== "confirmed" && typeof body[key] !== "string") throw new WorkspaceRecoveryRequestError("invalid_arguments", 400, `${key} 必须是字符串`);
  if (expected.includes("confirmed") && body.confirmed !== true) throw new WorkspaceRecoveryRequestError("invalid_arguments", 400, "操作需要明确 confirmed:true 确认");
}
export function createWorkspaceRecoveryRoutes(service: WorkspaceRecoveryService = workspaceRecoveryService) {
  const routes = new Hono<{ Bindings: Partial<HttpBindings> }>();
  for (const action of ["inspect", "backup", "restore", "release"] as const) routes.post(`/${action}`, async c => {
    c.header("Cache-Control", "no-store");
    try {
      const body = await readJson(c.req.raw);
      fields(body, action === "inspect" ? ["workspace", "backup_directory"] : action === "release" ? ["workspace", "inspection_id"]
        : action === "backup" ? ["workspace", "target_directory", "confirmed"] : ["workspace", "inspection_id", "target_directory", "confirmed"]);
      const signal = c.req.raw.signal; cancelled(signal);
      if (action === "inspect") {
        const workspace = body.workspace as string, inspection = await service.inspect(workspace, body.backup_directory as string, signal);
        const outgoing = c.env?.outgoing;
        const abandon = () => { try { service.release(workspace, inspection.inspection_id); } catch { /* Cap/TTL bounds the unavoidable delivered-but-lost window. */ } };
        if (signal.aborted) { abandon(); cancelled(signal); }
        if (outgoing && !outgoing.writableFinished) {
          const detach = () => { signal.removeEventListener("abort", abort); outgoing.off("finish", detach); };
          const abort = () => { detach(); abandon(); };
          signal.addEventListener("abort", abort, { once: true }); outgoing.once("finish", detach);
        }
        return c.json(inspection);
      }
      if (action === "release") return c.json(service.release(body.workspace as string, body.inspection_id as string, signal));
      if (action === "backup") return c.json(await service.backup(body.workspace as string, body.target_directory as string, true, signal));
      return c.json(await service.restore(body.workspace as string, body.inspection_id as string, body.target_directory as string, true, signal));
    } catch (error) {
      if (c.req.raw.signal.aborted && c.env?.outgoing?.destroyed === true) return RESPONSE_ALREADY_SENT.clone();
      const failure = workspaceRecoveryFailure(error);
      return c.json({ code: failure.code, detail: failure.message, ...(failure.causes ? { causes: failure.causes } : {}),
        ...(failure.incompleteDirectory ? { incompleteDirectory: failure.incompleteDirectory } : {}) }, failure.status);
    }
  });
  return routes;
}
export const workspaceRecoveryRoutes = createWorkspaceRecoveryRoutes();
