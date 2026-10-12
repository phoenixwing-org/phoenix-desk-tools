import { performance } from "node:perf_hooks";
import { CadObjectInfoError } from "./error.js";

export const CAD_OBJECT_RESPONSE_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, durationMs: 30_000 });
/** Internal test seams may lower limits; request bodies cannot configure or raise them. */
export type CadObjectInfoBudgetOptions = { bytes?: number; durationMs?: number; now?: () => number };

export class CadObjectInfoBudget {
  private readonly now: () => number;
  private readonly started: number;
  private readonly bytes: number;
  private readonly durationMs: number;
  private readonly strings = new Map<string, number>();
  constructor(private readonly signal?: AbortSignal, options: CadObjectInfoBudgetOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.started = this.now();
    this.bytes = boundedLimit(options.bytes, CAD_OBJECT_RESPONSE_LIMITS.bytes);
    this.durationMs = boundedLimit(options.durationMs, CAD_OBJECT_RESPONSE_LIMITS.durationMs);
  }
  check() {
    if (this.signal?.aborted) throw new CadObjectInfoError("cancelled", "对象信息读取已取消");
    if (this.now() - this.started >= this.durationMs) throw new CadObjectInfoError("timeout", "对象信息读取超过 30 秒期限，请缩小模型后重试");
  }
  checkBytes(bytes: number) {
    this.check();
    if (bytes > this.bytes) throw new CadObjectInfoError("resource_limit", "对象信息完整响应超过 64 MiB 安全上限");
  }
  /** Also bound async waits (notably request body reads); synchronous bounded work
   * remains cooperative and is checked before/after, not advertised as preemptible.
   */
  waitFor<T>(pending: Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (ok: boolean, value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.signal?.removeEventListener("abort", cancelled);
        if (ok) resolve(value as T); else reject(value);
      };
      const cancelled = () => finish(false, new CadObjectInfoError("cancelled", "对象信息读取已取消"));
      const timer = setTimeout(() => finish(false, new CadObjectInfoError("timeout", "对象信息读取超过 30 秒期限，请缩小模型后重试")), Math.max(1, this.durationMs - (this.now() - this.started)));
      this.signal?.addEventListener("abort", cancelled, { once: true });
      if (this.signal?.aborted) cancelled();
      pending.then(value => {
        try { this.check(); finish(true, value); } catch (error) { finish(false, error); }
      }, error => finish(false, error));
    });
  }
  /** Exact UTF-8 JSON string size, without constructing its escaped representation.
   * Cache by string value so a large inherited Label is scanned once, not per XLink.
   */
  stringBytes(value: string): number {
    this.check();
    const known = this.strings.get(value);
    if (known !== undefined) return known;
    let bytes = 2;
    for (let i = 0; i < value.length; i++) {
      if (i % 4096 === 0) this.checkBytes(bytes);
      const code = value.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2;
      else if (code < 32) bytes += 6;
      else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else if (code >= 0xd800 && code <= 0xdfff) bytes += 6; // Well-formed JSON escapes lone surrogates.
      else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    this.checkBytes(bytes);
    this.strings.set(value, bytes);
    return bytes;
  }
}

function boundedLimit(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error("对象信息测试预算必须为正整数且不能提高生产上限");
  return value;
}

/** Count the complete success envelope before Hono serializes it. No whole-response
 * stringify, escaped-string allocation, linked-file read, or persisted output occurs here.
 */
export async function measureCadObjectInfoJsonBytes(value: unknown, budget: CadObjectInfoBudget): Promise<number> {
  let bytes = 0; let steps = 0;
  const pending: unknown[] = [value];
  while (pending.length) {
    budget.check();
    if (++steps % 256 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); budget.check(); }
    const item = pending.pop();
    if (item === null) bytes += 4;
    else if (typeof item === "string") bytes += budget.stringBytes(item);
    else if (typeof item === "boolean") bytes += item ? 4 : 5;
    else if (typeof item === "number" && Number.isFinite(item)) bytes += JSON.stringify(item).length;
    else if (Array.isArray(item)) {
      bytes += 2 + Math.max(0, item.length - 1);
      for (let i = item.length - 1; i >= 0; i--) pending.push(item[i]);
    } else if (item && typeof item === "object") {
      const entries = Object.entries(item);
      bytes += 2 + Math.max(0, entries.length - 1);
      for (const [key, child] of entries) {
        bytes += budget.stringBytes(key) + 1;
        budget.checkBytes(bytes);
        pending.push(child);
      }
    } else throw new CadObjectInfoError("invalid_document_xml", "对象响应包含非 JSON 契约字段");
    budget.checkBytes(bytes);
  }
  return bytes;
}
