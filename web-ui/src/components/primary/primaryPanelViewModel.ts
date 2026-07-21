import type { PagePrimarySection } from "../../composables/usePagePrimaryContribution";

export type PrimarySectionLayout = "readonly-grid" | "boolean-grid" | "stack";

/** 只读指标和纯开关区可安全使用紧凑双列；混合表单保持单列阅读顺序。 */
export function primarySectionLayout(section: PagePrimarySection): PrimarySectionLayout {
  const controls = section.controls ?? [];
  if (controls.length > 1 && controls.every((control) => control.kind === "readonly")) return "readonly-grid";
  if (controls.length > 1 && controls.every((control) => control.kind === "boolean")) return "boolean-grid";
  return "stack";
}

export function primarySectionCountLabel(section: PagePrimarySection): string {
  const controlCount = section.controls?.length ?? 0;
  const actionCount = section.actions?.length ?? 0;
  if (controlCount && actionCount) return `${controlCount} 项 · ${actionCount} 操作`;
  if (controlCount) return `${controlCount} 项`;
  if (actionCount) return `${actionCount} 操作`;
  return "";
}

export function primarySectionStateKey(
  pageId: string,
  workbenchTabId: string,
  sectionId: string,
): string {
  return `${workbenchTabId || pageId}:${sectionId}`;
}
