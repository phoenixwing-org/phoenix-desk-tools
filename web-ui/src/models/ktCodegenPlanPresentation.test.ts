import { describe, expect, it } from "vitest";
import {
  deriveKtCodegenPlanPresentation,
  ktCodegenApplyStateLabel,
} from "./ktCodegenPlanPresentation";

function preflight(patch: Partial<{
  safe_to_apply: boolean;
  source_scan_truncated: boolean;
  canApply: boolean;
  severity: string;
}> = {}) {
  return {
    safe_to_apply: patch.safe_to_apply ?? true,
    source_scan_truncated: patch.source_scan_truncated ?? false,
    plan: {
      canApply: patch.canApply ?? true,
      diagnostics: patch.severity ? [{ severity: patch.severity }] : [],
    },
  };
}

describe("KT Codegen plan presentation", () => {
  it("distinguishes a complete plan from Wing-safe partial Apply", () => {
    expect(deriveKtCodegenPlanPresentation(preflight())).toMatchObject({
      tone: "ready",
      label: "可 Apply",
      partial: false,
    });
    expect(deriveKtCodegenPlanPresentation(preflight({ canApply: false, severity: "error" }))).toMatchObject({
      tone: "warning",
      label: "可安全局部 Apply",
      partial: true,
    });
    expect(ktCodegenApplyStateLabel(true, false)).toBe("可安全局部 Apply");
  });

  it("keeps host scan truncation and unsafe plans closed", () => {
    expect(deriveKtCodegenPlanPresentation(preflight({
      safe_to_apply: false,
      source_scan_truncated: true,
    }))).toMatchObject({ tone: "warning", label: "扫描不完整，Apply 已关闭" });
    expect(deriveKtCodegenPlanPresentation(preflight({
      safe_to_apply: false,
      canApply: false,
      severity: "error",
    }))).toMatchObject({ tone: "error", label: "安全门禁未通过" });
  });
});
