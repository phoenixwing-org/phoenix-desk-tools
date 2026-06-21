import type { ModuleScope } from "../constants/moduleScope";
import type { WorkbenchTab } from "../types/workbench";

const DOCUMENT_PAGES = new Set([
  "file_detail",
  "part_key_detail",
  "bom_apply",
  "file_rename",
]);

export function tabMatchesModuleScope(
  tab: WorkbenchTab,
  scope: ModuleScope,
  pageModuleOf: (pageId: string) => string | undefined,
): boolean {
  if (scope === "all") return true;
  const mod = pageModuleOf(tab.pageId);
  if (!mod) return false;
  return mod === scope;
}

export function isDocumentTab(tab: WorkbenchTab): boolean {
  if (tab.contextKey?.trim()) return true;
  return DOCUMENT_PAGES.has(tab.pageId);
}

/** 按模块范围选择应激活的 Tab：优先当前 Tab → 文档 Tab → 范围内最近 Tab */
export function resolveTabForModuleScope(
  tabs: WorkbenchTab[],
  activeTabId: string,
  scope: ModuleScope,
  pageModuleOf: (pageId: string) => string | undefined,
): string | undefined {
  if (!tabs.length) return undefined;
  const active = tabs.find((t) => t.id === activeTabId);

  if (scope === "all") {
    return active?.id ?? tabs[tabs.length - 1]?.id;
  }

  const inScope = tabs.filter((t) => tabMatchesModuleScope(t, scope, pageModuleOf));
  if (!inScope.length) return undefined;

  if (active && tabMatchesModuleScope(active, scope, pageModuleOf)) {
    return active.id;
  }

  const docTab = [...inScope].reverse().find((t) => isDocumentTab(t));
  if (docTab) return docTab.id;

  return inScope[inScope.length - 1]?.id;
}

export function defaultPageForModuleScope(
  scope: ModuleScope,
  enabledModules: readonly string[],
): string {
  if (scope === "code" && enabledModules.includes("code")) return "code_index";
  if (scope === "cad" && enabledModules.includes("cad")) return "fcstd_map";
  if (enabledModules.includes("cad")) return "fcstd_map";
  if (enabledModules.includes("code")) return "code_index";
  return "fcstd_map";
}
