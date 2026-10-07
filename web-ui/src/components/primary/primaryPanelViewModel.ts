import type { PagePrimarySection } from "../../composables/usePagePrimaryContribution";

export type PrimarySectionLayout = "readonly-grid" | "properties" | "boolean-grid" | "stack";

export type PrimaryPanelBlock =
  | { kind: "section"; key: string; section: PagePrimarySection }
  | { kind: "context" | "status"; key: string };

/** DOM order and keyboard order agree; no CSS-only visual reordering. */
export function primaryPanelBlocks(sections: readonly PagePrimarySection[]): PrimaryPanelBlock[] {
  const blocks = sections.map((section): PrimaryPanelBlock => ({ kind: "section", key: `section:${section.id}`, section }));
  return [
    ...blocks.filter((block) => block.kind === "section" && block.section.placement === "before-context"),
    { kind: "context", key: "context" },
    { kind: "status", key: "status" },
    ...blocks.filter((block) => block.kind === "section" && block.section.placement !== "before-context"),
  ];
}

/** 只读指标和纯开关区可安全使用紧凑双列；混合表单保持单列阅读顺序。 */
export function primarySectionLayout(section: PagePrimarySection): PrimarySectionLayout {
  const controls = section.controls ?? [];
  if (controls.length && section.readonlyLayout === "properties" && controls.every((control) => control.kind === "readonly")) return "properties";
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
