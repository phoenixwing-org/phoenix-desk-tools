export type KtCodegenPlanTone = "idle" | "ready" | "warning" | "error";

export type KtCodegenPlanPresentation = {
  readonly tone: KtCodegenPlanTone;
  readonly label: string;
  readonly detail: string;
  readonly partial: boolean;
};

type KtCodegenPreflightPresentationSource = {
  readonly safe_to_apply: boolean;
  readonly source_scan_truncated: boolean;
  readonly plan: {
    readonly canApply: boolean;
    readonly diagnostics: ReadonlyArray<{ readonly severity: string }>;
  };
};

/**
 * 只把 Wing/Host 已决定的状态映射为工作台文案；不在 Web 重新计算 Apply 安全性。
 */
export function deriveKtCodegenPlanPresentation(
  preflight: KtCodegenPreflightPresentationSource | null | undefined,
): KtCodegenPlanPresentation {
  if (!preflight) {
    return { tone: "idle", label: "尚未预检", detail: "运行预检后生成计划", partial: false };
  }
  if (preflight.source_scan_truncated) {
    return {
      tone: "warning",
      label: "扫描不完整，Apply 已关闭",
      detail: "请通过 Code Ignore 缩小源码范围后重新预检",
      partial: false,
    };
  }
  if (preflight.safe_to_apply && preflight.plan.canApply) {
    return { tone: "ready", label: "可 Apply", detail: "完整计划已通过", partial: false };
  }
  if (preflight.safe_to_apply) {
    return {
      tone: "warning",
      label: "可安全局部 Apply",
      detail: "损坏 Marker 已隔离，只写回完整区域",
      partial: true,
    };
  }
  return {
    tone: preflight.plan.diagnostics.some((item) => item.severity === "error") ? "error" : "warning",
    label: "安全门禁未通过",
    detail: "请处理预检诊断后重新预检",
    partial: false,
  };
}

export function ktCodegenApplyStateLabel(safeToApply: boolean, planCanApply: boolean): string {
  if (!safeToApply) return "门禁未通过";
  return planCanApply ? "可 Apply" : "可安全局部 Apply";
}
