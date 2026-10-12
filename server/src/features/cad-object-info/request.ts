import { CadObjectInfoBudget } from "./budget.js";
import { CadObjectInfoError } from "./error.js";

export const CAD_OBJECT_REQUEST_BYTES = 64 * 1024;
const tooLarge = () => new CadObjectInfoError("resource_limit", "对象信息请求 JSON 超过 64 KiB 安全上限");

/** Only two path strings are needed. Count actual stream bytes even when a client
 * supplies Content-Length, and share the endpoint deadline rather than buffering
 * an unbounded body before the handler starts (as installed body-limit can do).
 */
export async function readCadObjectInfoRequest(request: Request, budget: CadObjectInfoBudget): Promise<unknown> {
  budget.check();
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > CAD_OBJECT_REQUEST_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!request.body) throw new CadObjectInfoError("invalid_arguments", "对象信息请求缺少 JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0; let complete = false;
  try {
    while (true) {
      const { done, value } = await budget.waitFor(reader.read());
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > CAD_OBJECT_REQUEST_BYTES) throw tooLarge();
      if (value.byteLength) chunks.push(value);
    }
    budget.check();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    budget.check();
    return result;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
