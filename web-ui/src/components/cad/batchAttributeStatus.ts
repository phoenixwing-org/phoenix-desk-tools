import type { BatchAttributePreview, BatchAttributeResult } from "../../api";

type Row = BatchAttributePreview["rows"][number] & { name_draft_invalid?: boolean };
export type BatchAttributeRowStatus = "pending" | "unchanged" | "needs_review" | "writing" | "written" | "failed" | "unknown" | "not_selected";
export const batchAttributeStatusTone = {
  pending: "warning", unchanged: "success", needs_review: "warning", writing: "primary",
  written: "success", failed: "danger", unknown: "warning", not_selected: "info",
} as const satisfies Record<BatchAttributeRowStatus, string>;
export function isBatchAttributeUnchanged(change: Row["changes"][number]) {
  // Compatible with an already-running API without the additive reason enum.
  return !change.eligible && (change.reason === "unchanged" || (!change.reason && change.note === "值已一致"));
}
export function batchAttributeRowStatus(row: Row, execution: {
  completed?: boolean;
  writing?: boolean;
  submitted?: string[];
  result?: BatchAttributeResult["results"][number];
} = {}): { kind: BatchAttributeRowStatus; label: string; detail: string } {
  const count = row.changes.filter(change => change.eligible).length;
  const submittedCount = new Set(execution.submitted ?? []).size;
  if (submittedCount && execution.result?.status === "written") return { kind: "written", label: `已写入（${submittedCount}项）`, detail: execution.result.message };
  if (submittedCount && execution.result?.status === "failed") return { kind: "failed", label: "写入失败", detail: execution.result.message };
  if (submittedCount && execution.writing) return { kind: "writing", label: `写入中（${submittedCount}项）`, detail: "等待后台逐文件执行结果" };
  if (submittedCount) {
    return { kind: "unknown", label: "结果待确认", detail: "未收到该文件的执行结果，请重新预览核对；不要直接重复提交" };
  }
  if (row.name_draft_invalid) return { kind: "needs_review", label: "名称需修正", detail: "请先修正目标零件名，本行暂不写入" };
  if (execution.completed && count) return { kind: "not_selected", label: "未写入", detail: "本次未勾选此文件；再次操作请重新预览" };
  if (count) {
    const blocked = row.changes.filter(change => !change.eligible && !isBatchAttributeUnchanged(change)).length;
    return { kind: "pending", label: `待写入（${count}项）`, detail: blocked ? `另有 ${blocked} 项需确认，勾选只写可写字段` : "勾选文件后确认写入" };
  }
  if (row.changes.length && row.changes.every(isBatchAttributeUnchanged)) return { kind: "unchanged", label: "一致", detail: "无需写入；不代表本次执行过写入" };
  return { kind: "needs_review", label: "需确认", detail: "没有可写字段，请核对来源、属性类型或覆盖选项" };
}
