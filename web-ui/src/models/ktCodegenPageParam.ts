export type KtCodegenPageDocumentParam = {
  fileName: string;
  path: string;
  namePrefix: string;
  nameMiddle: string;
  format: "legacy-17-column-csv" | "legacy-v4-json";
  encoding: "utf8" | "utf8-bom" | "gbk";
  rowCount: number;
};

export type KtCodegenPagePreflightParam = {
  safeToApply: boolean;
  planCanApply: boolean;
  regionCount: number;
  artifactCount: number;
  diagnosticCount: number;
};

export type KtCodegenPageApplyParam = {
  fileCount: number;
  regionCount: number;
};

/** KT Codegen 页的 UI 无关会话参数；文件真相仍由 host/store adapter 持有。 */
export type KtCodegenPageParam = {
  pageId: "kt_codegen";
  status: string;
  document: KtCodegenPageDocumentParam | null;
  dirty: boolean;
  hasRecoveryConflict: boolean;
  hasExternalChange: boolean;
  selectedBlockCount: number;
  totalBlockCount: number;
  preflighting: boolean;
  preflight: KtCodegenPagePreflightParam | null;
  applying: boolean;
  lastApply: KtCodegenPageApplyParam | null;
};

export type KtCodegenPageParamInput = Omit<KtCodegenPageParam, "pageId">;

/** 把 store/host 快照规范化为页面唯一 Param，不保留 Ref、API 或组件实例。 */
export function createKtCodegenPageParam(input: KtCodegenPageParamInput): KtCodegenPageParam {
  return {
    pageId: "kt_codegen",
    ...input,
    selectedBlockCount: nonNegativeInteger(input.selectedBlockCount),
    totalBlockCount: nonNegativeInteger(input.totalBlockCount),
    document: input.document
      ? { ...input.document, rowCount: nonNegativeInteger(input.document.rowCount) }
      : null,
    preflight: input.preflight
      ? {
          ...input.preflight,
          regionCount: nonNegativeInteger(input.preflight.regionCount),
          artifactCount: nonNegativeInteger(input.preflight.artifactCount),
          diagnosticCount: nonNegativeInteger(input.preflight.diagnosticCount),
        }
      : null,
    lastApply: input.lastApply
      ? {
          fileCount: nonNegativeInteger(input.lastApply.fileCount),
          regionCount: nonNegativeInteger(input.lastApply.regionCount),
        }
      : null,
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
