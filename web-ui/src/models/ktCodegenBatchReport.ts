import {
  ktCodegenBuildApplyReport,
  type KtCodegenApplyReportItem,
  type KtCodegenApplyReportUiModel,
} from "@phoenix-wing/kt-codegen/ui/report-model";
import type { KtCodegenPrimaryReportUiModel } from "@phoenix-wing/kt-codegen/ui";

export type KtCodegenBatchReportItem = KtCodegenApplyReportItem;

/** Desk 会话索引在 Wing 共享完整报告上附加 Primary 列表摘要。 */
export interface KtCodegenBatchReport extends KtCodegenApplyReportUiModel {
  readonly id: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly summary: KtCodegenPrimaryReportUiModel;
}

export function buildKtCodegenBatchReport(input: {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly items: readonly KtCodegenBatchReportItem[];
}): KtCodegenBatchReport {
  const itemCount = input.items.length;
  const hasErrors = input.items.some((item) => item.health === "error");
  const hasWarnings = input.items.some((item) => item.health === "warning");
  const changedCount = input.items.filter((item) => item.change === "updated" || item.change === "partial").length;
  const health = hasErrors ? "error" as const : hasWarnings ? "warning" as const : "success" as const;
  const change = hasErrors
    ? changedCount ? "partial" as const : "not-applied" as const
    : changedCount ? "updated" as const : "unchanged" as const;
  const startedMs = Date.parse(input.startedAt);
  const completedMs = Date.parse(input.completedAt);
  const elapsedMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
    ? Math.max(0, completedMs - startedMs)
    : 0;
  const id = `desk-batch:${input.startedAt}:${itemCount}`;
  const shared = ktCodegenBuildApplyReport({
    reportId: id,
    applyKind: "batch",
    startedAt: input.startedAt,
    finishedAt: input.completedAt,
    elapsedMilliseconds: elapsedMs,
    items: input.items,
  });
  return {
    ...shared,
    id,
    completedAt: input.completedAt,
    elapsedMs,
    summary: {
      id,
      subject: `${itemCount} 份 JSON`,
      startedAt: input.startedAt,
      applyKind: "batch",
      itemCount,
      health,
      change,
    },
  };
}
