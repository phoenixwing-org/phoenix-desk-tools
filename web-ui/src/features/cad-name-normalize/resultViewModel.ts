import { matchesBatchFilename } from "../../components/cad/batchAttributeFilter";
import type { AttributeResults, NamePreview, NameRow, RenameAnalysis, RenameResults } from "./api";

export type NameResultFilter = "all" | "normal" | "needs_fix" | "needs_review";
/** Follow confirmed disk moves, not merely proposed target names. */
export function nameDetailRel(rel: string, renamed?: RenameResults | null): string {
  const result = renamed?.results.find(item => item.rel === rel);
  return result && (result.status === "renamed" || result.status === "references_pending" || (result.status === "uncertain" && result.rename_log_id))
    ? result.target_rel : rel;
}
export type NameResultState = {
  group: Exclude<NameResultFilter, "all">;
  label: string;
  tone: "success" | "warning" | "danger" | "primary";
  detail: string;
};
type Execution = {
  attributes?: AttributeResults | null; renamed?: RenameResults | null;
  attributeSubmitted?: string[]; renameSubmitted?: string[];
  attributeDone?: boolean; renameDone?: boolean; action?: string;
};
function state(group: NameResultState["group"], detail: string, label?: string, tone?: NameResultState["tone"]): NameResultState {
  return { group, label: label || { normal: "正常", needs_fix: "需修正", needs_review: "需确认" }[group],
    tone: tone || (group === "normal" ? "success" : "warning"), detail };
}
function renameExecution(rel: string, execution: Execution): NameResultState | undefined {
  const result = execution.renamed?.results.find(item => item.rel === rel);
  if (result) {
    if (result.status === "renamed") return state("normal", result.message);
    if (result.status === "skipped") return state("needs_fix", result.message, "未执行");
    if (result.status === "references_pending") return result.failed_hosts?.length
      ? state("needs_review", result.message, "引用修正失败", "danger")
      : state("needs_fix", result.message, "需修正引用");
    return state("needs_review", result.message, result.status === "failed" ? "改名失败" : "结果待确认", result.status === "failed" ? "danger" : "warning");
  }
  if (execution.renameSubmitted?.includes(rel)) return execution.action === "rename"
    ? state("needs_fix", "等待后台逐文件执行结果", "改名中", "primary")
    : state("needs_review", "未收到改名结果，请核对磁盘与改名记录，不要直接重复执行", "结果待确认");
}
export function nameRowState(row: NameRow, execution: Execution = {}): NameResultState {
  const renamed = renameExecution(row.rel, execution);
  if (renamed) return renamed;
  const result = execution.attributes?.results.find(item => item.rel === row.rel);
  if (result) {
    if (result.status === "failed") return state("needs_review", result.message, "写入失败", "danger");
    if (result.message.includes("失败") || result.message.includes("索引未更新")) return state("needs_review", result.message);
    return state(row.rename_changed ? "needs_fix" : "normal", result.message);
  }
  if (execution.attributeSubmitted?.includes(row.rel)) return execution.action === "attributes"
    ? state("needs_fix", "等待后台逐文件执行结果", "写入中", "primary")
    : state("needs_review", "未收到写入结果，请重新预览核对，不要直接重复执行", "结果待确认");
  const group = row.status || (row.eligible ? "needs_fix" : row.message === "已一致（本次未写入）" ? "normal" : "needs_review");
  return state(group, execution.attributeDone && row.eligible ? "未勾选，未写入；再次操作请重新预览" : row.message);
}
export function renameRowState(row: RenameAnalysis["rows"][number], execution: Execution = {}): NameResultState {
  const result = renameExecution(row.rel, execution);
  if (result) return result;
  const group = row.status || (row.eligible ? "needs_fix" : row.message === "文件名已一致，无需改名" ? "normal" : "needs_review");
  return state(group, execution.renameDone && row.eligible ? "未勾选，未改名；再次操作请重新预览" : row.message);
}
export function namePreviewRows(preview: NamePreview | null): NameRow[] {
  const rows = new Map(preview?.rows.map(row => [row.rel, { ...row }]) ?? []);
  for (const item of preview?.errors ?? []) {
    const row = rows.get(item.rel);
    rows.set(item.rel, { rel: item.rel, object_name: "", current_name: "", current_label: "", proposed_name: "", proposed_label: "", target_rel: "",
      attributes_changed: false, rename_changed: false, warnings: [], ...row,
      eligible: false, status: "needs_review", message: [row?.message, item.message].filter(Boolean).join("；") });
  }
  return [...rows.values()];
}
export function filterNameRows<T extends { row: { rel: string; target_rel: string }; state: NameResultState }>(rows: T[], query: string, filter: NameResultFilter): T[] {
  return rows.filter(item => (matchesBatchFilename(item.row.rel, query) || matchesBatchFilename(item.row.target_rel, query))
    && (filter === "all" || item.state.group === filter));
}
