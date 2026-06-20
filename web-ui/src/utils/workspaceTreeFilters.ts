import type { Ref } from "vue";
import type { AppConfig, NavItem } from "../types/config";

export type WorkspaceTreeFilterProfile = "cad" | "code";

const PAGE_MODULE_FALLBACK: Record<string, string> = {
  file_detail: "cad",
  bom_apply: "cad",
  rename_analysis: "cad",
};

function pageModule(
  pageId: string,
  navigation: NavItem[] | undefined,
): string | undefined {
  const id = pageId === "rename_analysis" ? "file_rename" : pageId;
  if (id === "welcome" || id === "home" || id === "config") return undefined;
  const nav = navigation?.find((n) => n.page === id);
  if (nav?.module) return nav.module;
  return PAGE_MODULE_FALLBACK[id];
}

/** 侧栏树扩展名筛选：仅 Code / 仅 CAD / 双模块时按当前页模块默认。 */
export function resolveWorkspaceTreeFilterProfile(
  enabledModules: string[],
  currentPage: string,
  navigation: NavItem[] | undefined,
): WorkspaceTreeFilterProfile {
  const hasCad = enabledModules.includes("cad");
  const hasCode = enabledModules.includes("code");
  if (hasCode && !hasCad) return "code";
  if (hasCad && !hasCode) return "cad";
  if (pageModule(currentPage, navigation) === "code") return "code";
  return "cad";
}

export type WorkspaceTreeFilterState = {
  wantFcstd: boolean;
  wantSw: boolean;
  wantCpp: boolean;
  wantHeader: boolean;
};

export function defaultTreeFilters(profile: WorkspaceTreeFilterProfile): WorkspaceTreeFilterState {
  if (profile === "code") {
    return { wantFcstd: false, wantSw: false, wantCpp: true, wantHeader: true };
  }
  return { wantFcstd: true, wantSw: false, wantCpp: false, wantHeader: false };
}

export function treeFetchOptions(state: WorkspaceTreeFilterState) {
  return {
    fcstd: state.wantFcstd,
    sw: state.wantSw,
    cpp: state.wantCpp,
    header: state.wantHeader,
  };
}

/** 至少勾选一种扩展名，避免空树误以为是工作空间无文件。 */
export function ensureTreeFilterSelection(
  state: WorkspaceTreeFilterState,
  profile: WorkspaceTreeFilterProfile,
): boolean {
  if (profile === "code") {
    return state.wantCpp || state.wantHeader;
  }
  return state.wantFcstd || state.wantSw;
}

export function applyProfileDefaults(
  state: Ref<WorkspaceTreeFilterState>,
  profile: WorkspaceTreeFilterProfile,
) {
  const d = defaultTreeFilters(profile);
  state.value = { ...d };
}
