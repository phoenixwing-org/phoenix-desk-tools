import { onScopeDispose, ref, watch, type Ref } from "vue";
import { ApiError } from "../../api";
import { fetchCadObjectInfo } from "./api";
import type { CadObjectInfoResult } from "./types";

export function useCadObjectInfo(workspacePath: Ref<string>, filePath: Ref<string>, active: Ref<boolean>) {
  const result = ref<CadObjectInfoResult | null>(null), busy = ref(false), error = ref(""), errorCode = ref(""), message = ref("");
  let epoch = 0, disposed = false, controller: AbortController | undefined;
  function invalidate() {
    epoch++; controller?.abort(); controller = undefined;
    result.value = null; busy.value = false; error.value = ""; errorCode.value = ""; message.value = "";
  }
  function cancel() { invalidate(); message.value = "对象信息读取已取消；没有修改模型或索引。"; }
  async function load() {
    if (disposed || !active.value) return;
    invalidate();
    const seq = epoch, ws = workspacePath.value, rel = filePath.value;
    if (!ws || !rel) { message.value = "请选择工作空间中的 FCStd 文件。"; return; }
    const abort = new AbortController(); controller = abort; busy.value = true;
    const current = () => !disposed && seq === epoch && ws === workspacePath.value && rel === filePath.value && active.value;
    try { const data = await fetchCadObjectInfo(ws, rel, abort.signal); if (current()) result.value = data; }
    catch (cause) {
      if (current()) {
        if (abort.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) message.value = "对象信息读取已取消；没有修改模型或索引。";
        else {
          error.value = cause instanceof Error ? cause.message : String(cause);
          if (cause instanceof ApiError && cause.payload && typeof cause.payload === "object" && "code" in cause.payload) errorCode.value = String(cause.payload.code);
        }
      }
    } finally { if (current()) { busy.value = false; controller = undefined; } }
  }
  watch([workspacePath, filePath, active], () => { invalidate(); if (active.value) void load(); }, { immediate: true, flush: "sync" });
  onScopeDispose(() => { disposed = true; invalidate(); });
  return { result, busy, error, errorCode, message, load, cancel };
}
