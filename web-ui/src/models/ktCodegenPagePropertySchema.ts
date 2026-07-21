import type { KtCodegenPageParam } from "./ktCodegenPageParam";
import { ktCodegenApplyStateLabel } from "./ktCodegenPlanPresentation";

export type KtCodegenPropertyValueKey =
  | "file"
  | "path"
  | "className"
  | "format"
  | "encoding"
  | "rows"
  | "documentState"
  | "blocks"
  | "preflightState"
  | "plan"
  | "applyState";

export type KtCodegenPropertyFieldSchema = {
  readonly id: string;
  readonly label: string;
  readonly valueKey: KtCodegenPropertyValueKey;
  readonly mono?: boolean;
};

export type KtCodegenPropertyGroupSchema = {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly KtCodegenPropertyFieldSchema[];
};

/** 与 Vue/Element 无关的页面 Property 声明。 */
export const KT_CODEGEN_PROPERTY_SCHEMA: readonly KtCodegenPropertyGroupSchema[] = [
  {
    id: "document",
    label: "当前 JSON View",
    fields: [
      { id: "file", label: "配置文档", valueKey: "file" },
      { id: "path", label: "路径", valueKey: "path", mono: true },
      { id: "class", label: "类名", valueKey: "className", mono: true },
      { id: "format", label: "格式", valueKey: "format" },
      { id: "encoding", label: "编码", valueKey: "encoding" },
      { id: "rows", label: "配置行", valueKey: "rows" },
      { id: "state", label: "保存状态", valueKey: "documentState" },
    ],
  },
  {
    id: "generation",
    label: "生成计划",
    fields: [
      { id: "blocks", label: "控制符", valueKey: "blocks" },
      { id: "preflight", label: "预检", valueKey: "preflightState" },
      { id: "plan", label: "计划", valueKey: "plan" },
      { id: "apply", label: "写回", valueKey: "applyState" },
    ],
  },
] as const;

export type KtCodegenPageView = Record<KtCodegenPropertyValueKey, string | number> & {
  readonly summary: string;
};

/** Param + Schema 的纯 derive 层；View 只消费文案和值，不判断宿主状态。 */
export function deriveKtCodegenPageView(param: KtCodegenPageParam): KtCodegenPageView {
  const pageDocument = param.document;
  const className = pageDocument ? `${pageDocument.namePrefix}${pageDocument.nameMiddle}` : "";
  return {
    file: pageDocument?.fileName ?? "未打开",
    path: pageDocument?.path ?? "—",
    className: className || "—",
    format: pageDocument
      ? pageDocument.format === "legacy-17-column-csv" ? "17 列 CSV" : "v4 JSON"
      : "—",
    encoding: pageDocument
      ? pageDocument.encoding === "utf8-bom" ? "UTF-8 BOM" : pageDocument.encoding === "gbk" ? "GBK" : "UTF-8"
      : "—",
    rows: pageDocument?.rowCount ?? 0,
    documentState: documentState(param),
    blocks: `${param.selectedBlockCount} / ${param.totalBlockCount}`,
    preflightState: param.preflighting
      ? "正在预检"
      : !param.preflight
        ? "尚未预检"
        : ktCodegenApplyStateLabel(param.preflight.safeToApply, param.preflight.planCanApply),
    plan: param.preflight
      ? `${param.preflight.regionCount} 区域 · ${param.preflight.artifactCount} 产物 · ${param.preflight.diagnosticCount} 诊断`
      : "—",
    applyState: param.applying
      ? "正在写回"
      : param.lastApply ? `${param.lastApply.fileCount} 文件 · ${param.lastApply.regionCount} 区域` : "尚未 Apply",
    summary: pageDocument
      ? `${pageDocument.fileName}${param.dirty ? " *" : ""} · ${pageDocument.rowCount} 行 · ${param.status}`
      : param.status,
  };
}

function documentState(param: KtCodegenPageParam): string {
  if (!param.document) return "未打开";
  if (param.hasRecoveryConflict) return "草稿冲突";
  if (param.hasExternalChange) return "磁盘已变化";
  return param.dirty ? "有未保存修改" : "已保存";
}
