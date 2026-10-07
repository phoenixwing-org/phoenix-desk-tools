import type { LabelRow, LabelJob } from "./api";
export function labelRowState(row: LabelRow, job: LabelJob | null, submitted: string[], consumed: boolean) {
  const result = job?.results.find(item => item.rel === row.rel);
  if (result) return { group: result.status === "written" ? "normal" : "problem", label: result.status === "written" ? "已修正" : result.status === "uncertain" ? "需核对" : "失败", detail: result.message, tone: result.status === "written" ? "success" : "danger" };
  if (submitted.includes(row.rel)) return { group: "problem", label: job?.state === "running" ? job.current_rel === row.rel ? "修正中" : "等待执行" : "结果待确认", detail: job?.state === "running" ? "后台逐个总成处理" : "请重新预览核对磁盘", tone: job?.state === "running" ? "primary" : "warning" };
  return { group: row.status === "normal" ? "normal" : row.status === "needs_fix" ? "pending" : "problem",
    label: consumed && row.eligible ? "未勾选" : row.status === "normal" ? "正常" : row.status === "needs_fix" ? "待修正" : "需确认", detail: row.message,
    tone: row.status === "normal" ? "success" : "warning" };
}
