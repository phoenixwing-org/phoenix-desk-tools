import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { ApiError } from "../../api";
import { fetchCadLightInfo } from "./api";
import type { CadLightInfoResult } from "./types";

type Host = { appendLog: (text: string, options: { source: string; open: boolean }) => void };
const knownCodes = new Set(["invalid_arguments", "path_escape", "io_error", "invalid_fcstd_archive", "invalid_document_xml", "missing_document_xml", "resource_limit", "timeout", "cancelled", "source_changed"]);

/** Manual-only, volatile snapshot: changing any context cancels without rereading. */
export function useCadLightInfo(workspacePath: Ref<string>, filePath: Ref<string>, active: Ref<boolean>, host?: Host) {
  const result = shallowRef<CadLightInfoResult | null>(null), busy = ref(false), error = ref(""), errorCode = ref(""), message = ref("");
  let epoch = 0, disposed = false, controller: AbortController | undefined;
  function invalidate() {
    epoch++; controller?.abort(); controller = undefined;
    result.value = null; busy.value = false; error.value = errorCode.value = message.value = "";
  }
  function cancel() { invalidate(); message.value = "轻量摘要读取已取消；没有修改模型或索引。"; }
  async function load() {
    if (disposed || !active.value) return;
    invalidate();
    const seq = epoch, ws = workspacePath.value, rel = filePath.value;
    if (!ws || !rel) { message.value = "请选择工作空间中的 FCStd 文件。"; return; }
    const abort = new AbortController(); controller = abort; busy.value = true;
    const current = () => !disposed && seq === epoch && ws === workspacePath.value && rel === filePath.value && active.value;
    try {
      const data = await fetchCadLightInfo(ws, rel, abort.signal);
      if (!current()) return;
      result.value = data;
      const problems = data.diagnostics.counts.ambiguous + data.diagnostics.counts.missing + data.diagnostics.counts.self + data.diagnostics.counts.non_fcstd;
      if (problems || data.warnings.length) host?.appendLog(`[轻量摘要] 读取完成：${problems} 项源 XLink 文件诊断需核对，${data.warnings.length} 项解析提示；不是实例或 BOM 数量。`, { source: "file_detail", open: true });
    } catch (cause) {
      if (!current()) return;
      if (abort.signal.aborted || (cause instanceof Error && cause.name === "AbortError")) message.value = "轻量摘要读取已取消；没有修改模型或索引。";
      else {
        error.value = cause instanceof Error ? cause.message : String(cause);
        const code = cause instanceof ApiError && cause.payload && typeof cause.payload === "object" && "code" in cause.payload ? cause.payload.code : null;
        if (typeof code === "string" && knownCodes.has(code)) errorCode.value = code;
        // Backend detail can contain machine paths; never copy it into the shared log.
        host?.appendLog(`[轻量摘要] 读取失败（${errorCode.value || "response_error"}）；未显示部分结果，请核对模型后重新读取。`, { source: "file_detail", open: true });
      }
    } finally { if (current()) { busy.value = false; controller = undefined; } }
  }
  watch([workspacePath, filePath, active], invalidate, { immediate: true, flush: "sync" });
  onScopeDispose(() => { disposed = true; invalidate(); });
  return { result, busy, error, errorCode, message, load, cancel };
}
