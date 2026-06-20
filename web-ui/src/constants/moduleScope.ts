/** 工作空间功能模块范围（欢迎页最近工程 / 工作空间偏好）。 */

export type ModuleScope = "all" | "cad" | "code";

export const MODULE_SCOPE_OPTIONS: ReadonlyArray<{ id: ModuleScope; label: string }> = [
  { id: "all", label: "全部" },
  { id: "cad", label: "CAD" },
  { id: "code", label: "Code" },
];

export function moduleScopeLabel(scope: ModuleScope | string | undefined): string {
  const hit = MODULE_SCOPE_OPTIONS.find((o) => o.id === scope);
  return hit?.label ?? "全部";
}

export function moduleScopeTagType(
  scope: ModuleScope | string | undefined,
): "info" | "success" | "warning" {
  if (scope === "cad") return "success";
  if (scope === "code") return "warning";
  return "info";
}
