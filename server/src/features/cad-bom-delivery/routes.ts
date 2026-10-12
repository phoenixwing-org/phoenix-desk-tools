import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { cadBomDeliveryService, cadBomDeliveryFailure, CadBomDeliveryError, type CadBomDeliveryService } from "./service.js";

const MAX_BODY = 16 * 1024;
function cancelled(signal: AbortSignal) { if (signal.aborted) throw new CadBomDeliveryError("cancelled", 400, "BOM 交付请求已取消"); }
function duplicateKeys(text: string) {
  let depth = 0; const keys = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') { if (text[i] === "\\") i++; i++; }
      let next = i + 1; while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (depth === 1 && text[next] === ":") {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (keys.has(key)) throw new CadBomDeliveryError("invalid_arguments", 400, "请求 JSON 不接受重复字段");
        keys.add(key);
      }
    } else if (text[i] === "{" || text[i] === "[") depth++;
    else if (text[i] === "}" || text[i] === "]") depth--;
  }
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  cancelled(request.signal);
  const fail = (code: string, status: 400 | 413 | 415, detail: string): never => { void request.body?.cancel().catch(() => {}); throw new CadBomDeliveryError(code, status, detail); };
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") fail("unsupported_media_type", 415, "仅接受 application/json 请求");
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY) fail("resource_limit", 413, "请求 JSON 超过 16 KiB 安全上限");
  if (!request.body) fail("invalid_arguments", 400, "请求缺少 JSON");
  const reader = request.body!.getReader(), chunks: Uint8Array[] = []; let size = 0, complete = false;
  try {
    while (true) {
      cancelled(request.signal);
      let abort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new CadBomDeliveryError("cancelled", 400, "BOM 交付请求已取消")); request.signal.addEventListener("abort", abort, { once: true }); });
      let item: ReadableStreamReadResult<Uint8Array>;
      try { item = await Promise.race([reader.read(), aborted]); }
      finally { request.signal.removeEventListener("abort", abort); }
      cancelled(request.signal);
      if (item.done) { complete = true; break; }
      size += item.value.byteLength;
      if (size > MAX_BODY) throw new CadBomDeliveryError("resource_limit", 413, "请求 JSON 超过 16 KiB 安全上限");
      // A zero-byte chunk must not grow retained bookkeeping independently of
      // the byte limit (e.g. an interrupted/host-supplied stream).
      if (item.value.byteLength) chunks.push(item.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body: unknown = JSON.parse(text); duplicateKeys(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CadBomDeliveryError) throw error;
    throw new CadBomDeliveryError("invalid_arguments", 400, "请求必须是有效 UTF-8 JSON 对象");
  } finally { if (!complete) void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function fields(body: Record<string, unknown>, expected: readonly string[]) {
  if (Object.keys(body).some(key => !expected.includes(key)) || expected.some(key => !Object.hasOwn(body, key))) {
    throw new CadBomDeliveryError("invalid_arguments", 400, "请求字段缺失或包含不允许的字段");
  }
  for (const key of expected) if (key !== "confirmed" && typeof body[key] !== "string") throw new CadBomDeliveryError("invalid_arguments", 400, `${key} 必须是字符串`);
  if (expected.includes("confirmed") && body.confirmed !== true) throw new CadBomDeliveryError("invalid_arguments", 400, "导出需要明确 confirmed:true 确认");
}
export function createCadBomDeliveryRoutes(service: CadBomDeliveryService = cadBomDeliveryService) {
  const routes = new Hono<{ Bindings: Partial<HttpBindings> }>();
  for (const action of ["preview", "export", "release"] as const) routes.post(`/${action}`, async c => {
    c.header("Cache-Control", "no-store");
    try {
      const body = await readJson(c.req.raw);
      fields(body, action === "preview" ? ["workspace"] : action === "release" ? ["workspace", "preview_id"] : ["workspace", "preview_id", "target_path", "confirmed"]);
      cancelled(c.req.raw.signal);
      if (action === "preview") {
        const workspace = body.workspace as string;
        const preview = await service.preview(workspace, c.req.raw.signal);
        const signal = c.req.raw.signal, outgoing = c.env?.outgoing;
        const abandon = () => {
          // Independent lifecycle cleanup, not an export cancellation source.
          // Expiry/release or a directory disappearing may have won already.
          try { service.release(workspace, preview.preview_id); } catch { /* bounded TTL remains the fallback */ }
        };
        if (signal.aborted) { abandon(); cancelled(signal); }
        if (outgoing && !outgoing.writableFinished) {
          const detach = () => { signal.removeEventListener("abort", abort); outgoing.off("finish", detach); };
          const abort = () => { detach(); abandon(); };
          signal.addEventListener("abort", abort, { once: true }); outgoing.once("finish", detach);
          // Once response delivery finishes, this old request no longer owns
          // the session. A client may still lose a delivered response; cap/TTL
          // bound that unavoidable residual window without evicting other tabs.
        }
        return c.json(preview);
      }
      if (action === "release") return c.json(service.release(body.workspace as string, body.preview_id as string, c.req.raw.signal));
      return c.json(await service.exportPreview(body.workspace as string, body.preview_id as string, body.target_path as string, body.confirmed === true, c.req.raw.signal));
    } catch (error) {
      if (c.req.raw.signal.aborted && c.env?.outgoing?.destroyed === true) return RESPONSE_ALREADY_SENT.clone();
      const failure = cadBomDeliveryFailure(error);
      return c.json({ code: failure.code, detail: failure.message, ...(failure.causes ? { causes: failure.causes } : {}) }, failure.status);
    }
  });
  return routes;
}
export const cadBomDeliveryRoutes = createCadBomDeliveryRoutes();
