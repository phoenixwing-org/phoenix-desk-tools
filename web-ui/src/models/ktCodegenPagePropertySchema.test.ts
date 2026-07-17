import { describe, expect, it } from "vitest";
import { createKtCodegenPageParam, type KtCodegenPageParamInput } from "./ktCodegenPageParam";
import { KT_CODEGEN_PROPERTY_SCHEMA, deriveKtCodegenPageView } from "./ktCodegenPagePropertySchema";

function input(patch: Partial<KtCodegenPageParamInput> = {}): KtCodegenPageParamInput {
  return {
    status: "就绪",
    document: {
      fileName: "guard.json",
      path: "config/guard.json",
      namePrefix: "Kt",
      nameMiddle: "Guard",
      format: "legacy-v4-json",
      encoding: "utf8-bom",
      rowCount: 2,
    },
    dirty: false,
    hasRecoveryConflict: false,
    hasExternalChange: false,
    selectedBlockCount: 2,
    totalBlockCount: 32,
    preflighting: false,
    preflight: { safeToApply: true, regionCount: 2, artifactCount: 2, diagnosticCount: 0 },
    applying: false,
    lastApply: { fileCount: 1, regionCount: 2 },
    ...patch,
  };
}

describe("KtCodegen Page Param / PropertySchema", () => {
  it("derives stable property values without Vue or Element metadata", () => {
    const view = deriveKtCodegenPageView(createKtCodegenPageParam(input({ dirty: true })));
    expect(view).toMatchObject({
      file: "guard.json",
      path: "config/guard.json",
      className: "KtGuard",
      format: "v4 JSON",
      encoding: "UTF-8 BOM",
      rows: 2,
      documentState: "有未保存修改",
      blocks: "2 / 32",
      preflightState: "可 Apply",
      plan: "2 区域 · 2 产物 · 0 诊断",
      applyState: "1 文件 · 2 区域",
    });
    expect(view.summary).toContain("guard.json * · 2 行");
    expect(KT_CODEGEN_PROPERTY_SCHEMA.flatMap((group) => group.fields).map((field) => field.id))
      .toEqual(["file", "path", "class", "format", "encoding", "rows", "state", "blocks", "preflight", "plan", "apply"]);
  });

  it("keeps conflict/external precedence and running states deterministic", () => {
    expect(deriveKtCodegenPageView(createKtCodegenPageParam(input({
      dirty: true,
      hasRecoveryConflict: true,
      hasExternalChange: true,
      preflighting: true,
      applying: true,
    })))).toMatchObject({
      documentState: "草稿冲突",
      preflightState: "正在预检",
      applyState: "正在写回",
    });
    expect(deriveKtCodegenPageView(createKtCodegenPageParam(input({
      hasExternalChange: true,
    }))).documentState).toBe("磁盘已变化");
  });

  it("represents an unopened page and normalizes invalid counters", () => {
    const view = deriveKtCodegenPageView(createKtCodegenPageParam(input({
      document: null,
      selectedBlockCount: Number.NaN,
      totalBlockCount: -1,
      preflight: null,
      lastApply: null,
    })));
    expect(view).toMatchObject({
      file: "未打开",
      rows: 0,
      documentState: "未打开",
      blocks: "0 / 0",
      preflightState: "尚未预检",
      plan: "—",
      applyState: "尚未 Apply",
    });
  });
});
