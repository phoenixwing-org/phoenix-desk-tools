import { watch } from "vue";
import type { LogAppendOptions } from "../../composables/useAppShell";
import type { AttributeResults, IndexUpdate, NamePreview, RenameJob, RenameResults } from "./api";

type LogState = {
  preview: NamePreview | null;
  error: string;
  attributes: AttributeResults | null;
  renamed: RenameResults | null;
  renameJob: RenameJob | null;
  indexUpdate: IndexUpdate | null;
};

/** Log server results independently of table filters; repeated polling must not duplicate them. */
export function useNameNormalizationLog(state: LogState, appendLog: (text: string, options?: LogAppendOptions) => void) {
  const seen = new Map<string, string>();
  const log = (message: string, error = false) => appendLog(`[名称统一] ${message}`, { source: "name_normalize", open: error });
  function once(key: string, message: string, error = false) {
    if (seen.get(key) === message) return;
    seen.set(key, message); log(message, error);
  }
  watch(() => state.preview?.plan_id, () => { seen.clear(); }, { flush: "sync" });
  watch(() => state.error, error => { if (error) log(`请求失败：${error}`, true); }, { immediate: true });
  watch(() => state.attributes, result => {
    for (const row of result?.results ?? []) {
      once(`attributes:${row.rel}`, `属性${row.status === "failed" ? "写入失败" : "完成"} · ${row.rel}\n  ${row.message}`, row.status === "failed");
    }
  }, { immediate: true });
  watch(() => state.renamed, result => {
    for (const row of result?.results ?? []) {
      const status = { renamed: "改名完成", references_pending: "文件已改名，引用待修正", failed: "改名失败", uncertain: "改名结果未确认", skipped: "未执行" }[row.status];
      const detail = (row.failed_hosts ?? []).map(host => `  宿主 ${host.host_repo_rel_path}：${host.error}`).join("\n");
      once(`rename:${state.renameJob?.id ?? ""}:${row.rel}`, `${status} · ${row.rel}\n  目标：${row.target_rel}\n  ${row.message}${detail ? `\n${detail}` : ""}`, row.status !== "renamed");
    }
  }, { immediate: true });
  watch(() => state.renameJob, job => {
    if (!job) return;
    if (job.state === "running") {
      once(`job:${job.id}:start`, `开始逐项改名 · 共 ${job.total} 个文件`);
    } else {
      once(`job:${job.id}:end`, `批次结束 · ${job.message}`, job.state !== "done");
    }
  }, { immediate: true });
  watch(() => state.indexUpdate, index => {
    if (index?.state === "failed") once("index:error", `CAD 索引更新失败：${index.message}`, true);
  }, { immediate: true });
}
