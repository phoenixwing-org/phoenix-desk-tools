import { computed, inject, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import type { BomFields } from "../api";
import type { AppConfig, LauncherPrefs, NavItem, ShellLayout, WorkspaceNavModules } from "../types/config";
import {
  closeWorkspaceApi,
  fetchAppConfig,
  fetchLauncherPrefs,
  fetchShellLog,
  fetchWorkspaceNavModules,
  getWorkspace,
  patchShellLayout,
  patchWorkspaceNavModules,
  resetLauncherFactory,
  setWorkspace,
} from "../api";
import { collectPageStates } from "./usePageSession";
import { loadWorkbenchSession, saveWorkbenchSessionAll, writeLocalWorkbenchSession } from "./workbenchSession";
import { createWorkbench, type WorkbenchContext } from "./useWorkbench";
import { basenameFromRel, normalizeRepoRelForApi } from "../utils/workspaceFileQuery";
import { normalizeDetailTabRel, partKeyTabContextKey } from "../utils/detailTabRoute";
import {
  ONBOARDING_PAGES_ALWAYS,
  WORKSPACE_GATE_MSG,
} from "../utils/onboardingConstants";
import { parseShellUrl, replaceShellUrl, type ShellUrlIntent } from "../utils/shellUrlSync";
import { useOnboardingStore } from "../stores/onboarding";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { useUiPrefsStore } from "../stores/uiPrefs";
import { clearPhoenixBrowserStorage } from "../utils/phoenixBrowserStorage";
import { confirmCloseWorkspace } from "./tabCloseConfirm";
import type { ModuleScope } from "../constants/moduleScope";
import { WORKBENCH_IDLE_PAGE } from "../constants/workbench";
import { runShellTour } from "./useShellTour";
import {
  resolveTabForModuleScope,
} from "../utils/moduleScopeNavigation";

export { WORKBENCH_IDLE_PAGE };

/** 返回 false 表示当前 Tab 未接管此次树点击，由 shell 回退打开文件详情 */
export type TreeSelectHandler = (rel: string) => void | boolean | Promise<void | boolean>;

export type LogAppendOptions = {
  /** 强制展开 / 仅追加不展开；默认遵循 log_auto_open_on_append */
  open?: boolean;
  /** 可选来源页 id，用于日志标题 */
  source?: string;
};

/** @deprecated 使用 Tab payload；保留类型供页面过渡 */
export type PendingFileRename = {
  rel: string;
  form: Partial<BomFields>;
  baseline: Partial<BomFields>;
};

/** @deprecated 使用 Tab payload */
export type PendingRenameAnalysis = {
  renameLogId?: number;
  oldBasename?: string;
  newBasename?: string;
  excludeRepoRel?: string;
  autoAnalyze?: boolean;
};

export type AppShellContext = {
  appConfig: Ref<AppConfig | null>;
  launcher: Ref<LauncherPrefs | null>;
  workspacePath: Ref<string>;
  /** 当前激活 Tab 的 pageId；无 Tab 时为 workbench_idle */
  currentPage: Ref<string>;
  /** 无打开页面时 Ribbon 所聚焦的模块范围 */
  workbenchFocusScope: Ref<ModuleScope>;
  navHover: Ref<string | null>;
  shellLayout: Ref<ShellLayout>;
  currentNavItem: Ref<NavItem | undefined>;
  statusText: Ref<string>;
  /** 当前页提供的只读摘要（如索引统计），显示在底栏 */
  pageSummary: Ref<string>;
  logText: Ref<string>;
  logSource: Ref<string | null>;
  setStatus: (msg: string) => void;
  setPageSummary: (msg: string) => void;
  appendLog: (text: string, opts?: LogAppendOptions) => void;
  clearLog: () => void;
  setLogOpen: (open: boolean) => void;
  setPropertiesOpen: (open: boolean) => void;
  /** 全屏配置层（遮住主内容区，不占 Tab 栏） */
  configOverlayOpen: Ref<boolean>;
  openConfig: () => void;
  closeConfig: () => void;
  goToPage: (pageId: string) => void;
  canNavigateToPage: (pageId: string) => boolean;
  /** 进入工作台并开始界面巡游（driver.js 逐步介绍壳层） */
  openOnboardingGuide: () => void;
  scrollToGuideToken: Ref<number>;
  openPartKeyDetail: (
    partNumber: string,
    partVersion: string,
    opts?: { partName?: string; label?: string },
  ) => void;
  openBomApplyForRel: (repoRelPath: string) => void;
  openFileDetailForRel: (
    repoRelPath: string,
    opts?: {
      subTab?: import("../types/fileDetail").FileDetailSubTab;
      preferredNewFilename?: string;
      form?: Partial<BomFields>;
      baseline?: Partial<BomFields>;
    },
  ) => void;
  /** 磁盘改名后更新文件详情 Tab 路由（避免同文件占两个 Tab） */
  rerouteFileDetailTab: (oldRel: string, newRel: string, tabId: string) => void;
  openFileRenameForRel: (
    repoRelPath: string,
    form: Partial<BomFields>,
    baseline: Partial<BomFields>,
  ) => void;
  openRenameAnalysis: (opts?: PendingRenameAnalysis) => void;
  switchWorkspace: (path: string) => Promise<void>;
  openToolTabCount: () => number;
  toolTabDirtyTitles: () => string[];
  discardAllToolTabs: () => void;
  closeWorkspace: (opts?: { skipTabCheck?: boolean }) => Promise<void>;
  requestCloseWorkspace: () => Promise<boolean>;
  resetToFactorySettings: () => Promise<void>;
  /** 离开欢迎页，进入 Ribbon 工作台；按模块范围定位 Ribbon，不自动打开工具页 */
  enterWorkbenchFromWelcome: (opts?: { scope?: ModuleScope }) => Promise<void>;
  persistShellLayout: (patch: Partial<ShellLayout>) => Promise<void>;
  enabledNavModules: Ref<string[]>;
  isNavItemVisible: (item: NavItem) => boolean;
  isPageModuleVisible: (pageId: string) => boolean;
  persistNavModules: (enabled: string[]) => Promise<void>;
  toggleNavModule: (id: string) => Promise<void>;
  setWorkspaceModuleScope: (path: string, scope: ModuleScope) => Promise<void>;
  reloadLauncher: () => Promise<void>;
  init: () => Promise<void>;
  treeSelectHandler: Ref<TreeSelectHandler | null>;
  /** 仅当前激活 Tab 会收到树点击；未注册或返回 false 时回退为打开文件详情 */
  registerTreeSelect: (tabId: string | undefined, fn: TreeSelectHandler | null) => void;
  dispatchTreeSelect: (rel: string) => Promise<void>;
  treeRescanToken: Ref<number>;
  treeSelectAfterRescan: Ref<string | null>;
  requestTreeRescan: (selectRel?: string) => void;
  // Workbench / Tab
  tabs: Ref<WorkbenchTab[]>;
  activeTabId: Ref<string>;
  tabBarTabs: Ref<WorkbenchTab[]>;
  showTabBar: Ref<boolean>;
  openTab: (opts: OpenTabOptions) => string;
  openNewTabForPage: (pageId: string) => string;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => Promise<boolean>;
  closeAllTabs: () => Promise<boolean>;
  getTab: (tabId: string) => WorkbenchTab | undefined;
  activeTab: () => WorkbenchTab | undefined;
  updateTab: (tabId: string, patch: Partial<Pick<WorkbenchTab, "title" | "subtitle" | "dirty">>) => void;
  setTabDirty: (tabId: string, dirty: boolean) => void;
  consumeTabPayload: (tabId: string) => WorkbenchTabPayload | undefined;
  consumeTabPageState: (tabId: string) => Record<string, unknown> | undefined;
  canOpenNewTab: (pageId: string) => boolean;
  scheduleWorkbenchSave: () => void;
  /** 侧栏 Tab：工作空间树 / 文件工作集（系统）/ Code 忽略设定 */
  workspaceSidebarTab: Ref<"tree" | "workset" | "ignore">;
  openCodeIgnoreSidebar: () => Promise<void>;
  openWorksetSidebar: () => Promise<void>;
  /** @deprecated 使用 workspaceSidebarTab */
  codeRightSidebarTab?: Ref<"tree" | "workset" | "ignore">;
};

const APP_SHELL_KEY: InjectionKey<AppShellContext> = Symbol("appShell");

const MAX_LOG_CHARS = 500_000;

const DEFAULT_SHELL: ShellLayout = {
  nav_rail_mode: 0,
  ribbon_mode: 1,
  right_panel_open: true,
  mid_right_sash_px: null,
  left_panel_width_px: 300,
  right_panel_width_px: 300,
  log_panel_open: true,
  log_panel_height_px: 180,
  log_auto_open_on_append: true,
  workspace_tree_dock: "right",
  shell_log_dock: "right",
  properties_panel_open: true,
  properties_panel_height_px: 220,
  properties_panel_dock: "left",
  properties_name_col_width_px: 132,
};

function clampPanelWidth(px: number): number {
  return Math.min(560, Math.max(160, px));
}

function normalizeShellLayout(partial?: Partial<ShellLayout>): ShellLayout {
  const merged = { ...DEFAULT_SHELL, ...partial };
  merged.right_panel_width_px = clampPanelWidth(merged.right_panel_width_px);
  if (typeof merged.left_panel_width_px !== "number" || merged.left_panel_width_px < 160) {
    merged.left_panel_width_px = merged.right_panel_width_px;
  } else {
    merged.left_panel_width_px = clampPanelWidth(merged.left_panel_width_px);
  }
  if (typeof merged.properties_panel_height_px !== "number" || merged.properties_panel_height_px < 80) {
    merged.properties_panel_height_px = DEFAULT_SHELL.properties_panel_height_px;
  }
  if (merged.properties_panel_dock !== "left" && merged.properties_panel_dock !== "right") {
    merged.properties_panel_dock = DEFAULT_SHELL.properties_panel_dock;
  }
  if (typeof merged.properties_panel_open !== "boolean") {
    merged.properties_panel_open = DEFAULT_SHELL.properties_panel_open;
  }
  if (typeof merged.properties_name_col_width_px !== "number" || merged.properties_name_col_width_px < 72) {
    merged.properties_name_col_width_px = readLegacyNameColWidth() ?? DEFAULT_SHELL.properties_name_col_width_px;
  } else {
    merged.properties_name_col_width_px = Math.min(240, Math.max(72, merged.properties_name_col_width_px));
  }
  return merged;
}

const NAV_ALWAYS_VISIBLE = new Set(["welcome", "home", "config", "unit_tests", "test_fixtures"]);

/** 不在 navigation 中、但属于某模块的 Tab 页 */
const PAGE_MODULE_FALLBACK: Record<string, string> = {
  file_detail: "cad",
  bom_apply: "cad",
  rename_analysis: "cad",
};

const DEFAULT_NAV_MODULES = ["cad", "code"];

const SIDEBAR_TAB_KEY = "phoenix-workspace-sidebar-tab";
const LEGACY_SIDEBAR_TAB_KEY = "phoenix-code-right-tab";
const LEGACY_NAME_COL_KEY = "phoenix-properties-name-col-v1";

function readLegacyNameColWidth(): number | undefined {
  try {
    const n = Number(localStorage.getItem(LEGACY_NAME_COL_KEY));
    if (Number.isFinite(n) && n >= 72) return Math.min(240, n);
  } catch {
    /* ignore */
  }
  return undefined;
}

function readWorkspaceSidebarTab(): "tree" | "workset" | "ignore" {
  try {
    let v = sessionStorage.getItem(SIDEBAR_TAB_KEY);
    if (!v) v = sessionStorage.getItem(LEGACY_SIDEBAR_TAB_KEY);
    if (v === "ignore" || v === "workset") return v;
    return "tree";
  } catch {
    return "tree";
  }
}

export function provideAppShell(): AppShellContext {
  const appConfig = shallowRef<AppConfig | null>(null);
  const launcher = shallowRef<LauncherPrefs | null>(null);
  const workspacePath = ref("");
  const navHover = ref<string | null>(null);
  const shellLayout = ref<ShellLayout>(normalizeShellLayout());
  const statusText = ref("");
  const pageSummary = ref("");
  const logText = ref("");
  const logSource = ref<string | null>(null);
  const logAutoOpenSuppressed = ref(false);
  const treeSelectHandler = shallowRef<TreeSelectHandler | null>(null);
  const treeHandlersByTab = new Map<string, TreeSelectHandler>();
  const treeRescanToken = ref(0);
  const treeSelectAfterRescan = ref<string | null>(null);
  const scrollToGuideToken = ref(0);
  const configOverlayOpen = ref(false);
  const showWelcomeScreen = ref(true);
  const workbenchFocusScope = ref<ModuleScope>("all");

  function openWelcome() {
    showWelcomeScreen.value = true;
    navHover.value = null;
    syncShellUrl();
  }

  function leaveWelcomeForWorkbench() {
    showWelcomeScreen.value = false;
    syncShellUrl();
  }
  const workspaceSidebarTab = ref<"tree" | "workset" | "ignore">(readWorkspaceSidebarTab());
  const onboarding = useOnboardingStore();

  function normalizePageId(pageId: string): string {
    return pageId === "rename_analysis" ? "file_rename" : pageId;
  }

  const enabledNavModules = computed(() => {
    const raw = launcher.value?.nav_modules?.enabled;
    if (Array.isArray(raw) && raw.length) return [...raw];
    return [...DEFAULT_NAV_MODULES];
  });

  function pageModule(pageId: string): string | undefined {
    const id = normalizePageId(pageId);
    if (NAV_ALWAYS_VISIBLE.has(id)) return undefined;
    const nav = appConfig.value?.navigation.find((n) => n.page === id);
    if (nav?.module) return nav.module;
    return PAGE_MODULE_FALLBACK[id];
  }

  function isPageModuleVisible(pageId: string): boolean {
    const id = normalizePageId(pageId);
    if (NAV_ALWAYS_VISIBLE.has(id)) return true;
    const mod = pageModule(id);
    if (!mod) return true;
    return enabledNavModules.value.includes(mod);
  }

  function isNavItemVisible(item: NavItem): boolean {
    if (NAV_ALWAYS_VISIBLE.has(item.page)) return true;
    if (!item.module) return true;
    return enabledNavModules.value.includes(item.module);
  }

  function purgeHiddenModuleTabs() {
    const rest = wb.tabs.value.filter((t) => isPageModuleVisible(t.pageId));
    if (rest.length === wb.tabs.value.length) return;
    wb.tabs.value = rest;
    const active = wb.activeTab();
    if (!active || !isPageModuleVisible(active.pageId)) {
      if (rest.length) {
        wb.activeTabId.value = rest[0]!.id;
        leaveWelcomeForWorkbench();
      } else {
        stayInWorkbenchIdle();
      }
    }
    syncDetailTabMaps();
    pruneTreeHandlers();
  }

  function canNavigateToPage(pageId: string): boolean {
    const id = normalizePageId(pageId);
    if (ONBOARDING_PAGES_ALWAYS.has(id)) return true;
    return onboarding.workspaceOk;
  }

  function requireWorkspace(): boolean {
    if (onboarding.workspaceOk) return true;
    setStatus(WORKSPACE_GATE_MSG);
    openConfig();
    return false;
  }

  /** 配置改为全屏层，不再作为工作台 Tab 保留 */
  function purgeConfigTabs() {
    const list = wb.tabs.value;
    const rest = list.filter((t) => t.pageId !== "config");
    if (rest.length === list.length) return;
    const activeWasConfig = wb.activeTab()?.pageId === "config";
    wb.tabs.value = rest;
    if (activeWasConfig || !rest.some((t) => t.id === wb.activeTabId.value)) {
      wb.activeTabId.value = rest[0]?.id ?? "";
    }
    if (!wb.tabs.value.length) {
      stayInWorkbenchIdle();
    }
  }

  function stayInWorkbenchIdle() {
    if (!workspacePath.value || !onboarding.workspaceOk) {
      openWelcome();
      return;
    }
    leaveWelcomeForWorkbench();
    wb.activeTabId.value = "";
    focusWorkbenchForModuleScope(workbenchFocusScope.value);
  }

  function openConfig() {
    purgeConfigTabs();
    configOverlayOpen.value = true;
    navHover.value = null;
  }

  function closeConfig() {
    configOverlayOpen.value = false;
  }

  function syncOnboardingFromTabs() {
    onboarding.syncFileDetailFromTabs(workspacePath.value, wb.tabs.value);
  }

  function syncActiveTreeHandler() {
    const id = wb.activeTabId.value;
    treeSelectHandler.value = id ? (treeHandlersByTab.get(id) ?? null) : null;
  }

  function pruneTreeHandlers() {
    const ids = new Set(wb.tabs.value.map((t) => t.id));
    for (const id of treeHandlersByTab.keys()) {
      if (!ids.has(id)) treeHandlersByTab.delete(id);
    }
    syncActiveTreeHandler();
  }
  const wb: WorkbenchContext = createWorkbench(appConfig);

  function shellOpenTab(opts: OpenTabOptions): string {
    if (opts.pageId === "welcome") {
      openWelcome();
      return "";
    }
    leaveWelcomeForWorkbench();
    return wb.openTab(opts);
  }

  function shellActivateTab(tabId: string) {
    leaveWelcomeForWorkbench();
    wb.activateTab(tabId);
  }

  /** repo_rel（规范化）→ Tab id，避免同文件重复打开 */
  const fileDetailTabByRel = new Map<string, string>();
  /** part_number.part_version → Tab id */
  const partKeyTabByKey = new Map<string, string>();

  function syncDetailTabMaps() {
    fileDetailTabByRel.clear();
    partKeyTabByKey.clear();
    for (const t of wb.tabs.value) {
      if ((t.pageId === "file_detail" || t.pageId === "bom_apply") && t.contextKey) {
        const k = normalizeDetailTabRel(t.contextKey);
        if (k) fileDetailTabByRel.set(k, t.id);
      }
      if (t.pageId === "part_key_detail" && t.contextKey?.trim()) {
        partKeyTabByKey.set(t.contextKey.trim(), t.id);
      }
    }
  }

  function findFileDetailTab(repoRel: string): WorkbenchTab | undefined {
    const key = normalizeDetailTabRel(repoRel);
    if (!key) return undefined;
    const mappedId = fileDetailTabByRel.get(key);
    if (mappedId) {
      const tab = wb.getTab(mappedId);
      if (tab && (tab.pageId === "file_detail" || tab.pageId === "bom_apply")) return tab;
      fileDetailTabByRel.delete(key);
    }
    const found = wb.tabs.value.find(
      (t) =>
        (t.pageId === "file_detail" || t.pageId === "bom_apply") &&
        normalizeDetailTabRel(t.contextKey ?? "") === key,
    );
    if (found) fileDetailTabByRel.set(key, found.id);
    return found;
  }

  function findPartKeyTab(partNumber: string, partVersion: string): WorkbenchTab | undefined {
    const key = partKeyTabContextKey(partNumber, partVersion);
    if (!key || key === ".") return undefined;
    const mappedId = partKeyTabByKey.get(key);
    if (mappedId) {
      const tab = wb.getTab(mappedId);
      if (tab?.pageId === "part_key_detail") return tab;
      partKeyTabByKey.delete(key);
    }
    const found = wb.tabs.value.find(
      (t) => t.pageId === "part_key_detail" && (t.contextKey ?? "").trim() === key,
    );
    if (found) partKeyTabByKey.set(key, found.id);
    return found;
  }

  function rerouteFileDetailTab(oldRel: string, newRel: string, tabId: string) {
    const oldKey = normalizeDetailTabRel(oldRel);
    const newKey = normalizeDetailTabRel(newRel);
    if (!newKey) return;
    if (oldKey) fileDetailTabByRel.delete(oldKey);
    fileDetailTabByRel.set(newKey, tabId);
    const tab = wb.getTab(tabId);
    if (tab) {
      tab.contextKey = normalizeRepoRelForApi(newRel) || newRel.trim();
    }
  }

  const currentPage = computed(() =>
    showWelcomeScreen.value
      ? "welcome"
      : (wb.activeTab()?.pageId ?? WORKBENCH_IDLE_PAGE),
  );
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let persistenceReady = false;

  function syncShellUrl() {
    replaceShellUrl({
      showWelcome: showWelcomeScreen.value,
      activeTab: wb.activeTab(),
    });
  }

  const currentNavItem = computed(() =>
    appConfig.value?.navigation.find((n) => n.page === currentPage.value),
  );

  function setStatus(msg: string) {
    statusText.value = msg;
  }

  function setPageSummary(msg: string) {
    pageSummary.value = msg;
  }

  watch(currentPage, () => {
    pageSummary.value = "";
  });

  function appendLog(text: string, opts?: LogAppendOptions) {
    if (!text) return;
    const chunk = text.endsWith("\n") ? text : `${text}\n`;
    logText.value += chunk;
    if (logText.value.length > MAX_LOG_CHARS) {
      logText.value = logText.value.slice(-MAX_LOG_CHARS);
    }
    if (opts?.source) {
      logSource.value = opts.source;
    }

    const wantOpen =
      opts?.open ??
      (shellLayout.value.log_auto_open_on_append && !logAutoOpenSuppressed.value);
    if (wantOpen && shellLayout.value.right_panel_open && !shellLayout.value.log_panel_open) {
      shellLayout.value = { ...shellLayout.value, log_panel_open: true };
      void persistShellLayout({ log_panel_open: true });
    }
  }

  function clearLog() {
    logText.value = "";
    logSource.value = null;
  }

  async function setLogOpen(open: boolean) {
    logAutoOpenSuppressed.value = !open;
    await persistShellLayout({ log_panel_open: open });
  }

  async function setPropertiesOpen(open: boolean) {
    await persistShellLayout({ properties_panel_open: open });
  }

  function goToPage(pageId: string) {
    const id = normalizePageId(pageId);
    if (id === "welcome") {
      openWelcome();
      return;
    }
    if (id === "config") {
      openConfig();
      return;
    }
    leaveWelcomeForWorkbench();
    if (!isPageModuleVisible(id)) {
      setStatus("该功能模块已关闭");
      navHover.value = null;
      return;
    }
    if (!canNavigateToPage(id)) {
      setStatus(WORKSPACE_GATE_MSG);
      openConfig();
      navHover.value = null;
      return;
    }
    wb.navigateToPage(id);
    navHover.value = null;
  }

  function openPartKeyDetail(
    partNumber: string,
    partVersion: string,
    opts?: { partName?: string; label?: string },
  ) {
    if (!requireWorkspace()) return;
    const pn = partNumber.trim();
    const pv = partVersion.trim();
    if (!pn || !pv) return;
    const contextKey = partKeyTabContextKey(pn, pv);
    const existing = findPartKeyTab(pn, pv);
    if (existing) {
      if (opts?.partName?.trim() || opts?.label?.trim()) {
        existing.subtitle = opts.partName?.trim() || opts.label?.trim() || existing.subtitle;
      }
      shellActivateTab(existing.id);
      return;
    }
    const subtitle = opts?.partName?.trim() || opts?.label?.trim() || undefined;
    try {
      shellOpenTab({
        pageId: "part_key_detail",
        title: contextKey,
        subtitle,
        contextKey,
        payload: { partKey: { partNumber: pn, partVersion: pv } },
        forceNew: true,
      });
    } catch (e) {
      setStatus(String(e));
    }
  }

  function openFileDetailForRel(
    repoRelPath: string,
    opts?: {
      subTab?: import("../types/fileDetail").FileDetailSubTab;
      preferredNewFilename?: string;
      form?: Partial<BomFields>;
      baseline?: Partial<BomFields>;
    },
  ) {
    const rel = repoRelPath.trim();
    if (!rel) return;
    if (!requireWorkspace()) return;
    const existing = findFileDetailTab(rel);
    if (existing) {
      const relApi = normalizeRepoRelForApi(rel) || rel;
      existing.title = wb.basename(rel);
      existing.subtitle = relApi;
      existing.contextKey = relApi;
      fileDetailTabByRel.set(normalizeDetailTabRel(rel), existing.id);
      if (opts?.subTab || opts?.preferredNewFilename || opts?.form) {
        existing.payload = {
          fileDetail: {
            rel,
            subTab: opts?.subTab,
            preferredNewFilename: opts?.preferredNewFilename,
          },
          ...(opts?.form
            ? {
                fileRename: {
                  rel,
                  form: { ...opts.form },
                  baseline: { ...(opts.baseline ?? opts.form) },
                },
              }
            : {}),
        };
        existing.payloadConsumed = false;
      }
      shellActivateTab(existing.id);
      onboarding.markFileDetailOpened(workspacePath.value);
      return;
    }
    try {
      const relApi = normalizeRepoRelForApi(rel) || rel;
      const tabId = shellOpenTab({
        pageId: "file_detail",
        title: wb.basename(rel),
        subtitle: relApi,
        contextKey: relApi,
        payload: {
          fileDetail: {
            rel,
            subTab: opts?.subTab,
            preferredNewFilename: opts?.preferredNewFilename,
          },
          ...(opts?.form
            ? {
                fileRename: {
                  rel,
                  form: { ...opts.form },
                  baseline: { ...(opts.baseline ?? opts.form) },
                },
              }
            : {}),
        },
        forceNew: true,
      });
      fileDetailTabByRel.set(normalizeDetailTabRel(rel), tabId);
      onboarding.markFileDetailOpened(workspacePath.value);
      syncOnboardingFromTabs();
    } catch (e) {
      setStatus(String(e));
    }
  }

  function openBomApplyForRel(repoRelPath: string) {
    openFileDetailForRel(repoRelPath, { subTab: "edit" });
  }

  function openFileRenameForRel(
    repoRelPath: string,
    form: Partial<BomFields>,
    baseline: Partial<BomFields>,
  ) {
    const preferred = String(form.filename ?? "").trim() || undefined;
    openFileDetailForRel(repoRelPath, {
      subTab: "rename",
      preferredNewFilename: preferred,
      form,
      baseline,
    });
  }

  function openRenameAnalysis(opts?: PendingRenameAnalysis) {
    const title = opts?.renameLogId != null ? `改名 #${opts.renameLogId}` : "改名分析";
    try {
      shellOpenTab({
        pageId: "file_rename",
        title,
        payload: { renameAnalysis: opts ? { ...opts } : {} },
        forceNew: true,
      });
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function reloadLauncher() {
    launcher.value = await fetchLauncherPrefs();
    const sl = launcher.value.shell_layout;
    shellLayout.value = normalizeShellLayout(sl);
  }

  function applyWorkspaceNavModules(nav: WorkspaceNavModules) {
    if (!launcher.value) return;
    launcher.value = {
      ...launcher.value,
      nav_modules: { enabled: [...nav.enabled] },
    };
    purgeHiddenModuleTabs();
  }

  async function switchWorkspace(path: string) {
    flushWorkbenchSession();
    const ws = await setWorkspace(path.trim());
    workspacePath.value = ws.path;
    await reloadLauncher();
    const nav = ws.nav_modules ?? (await fetchWorkspaceNavModules(ws.path));
    applyWorkspaceNavModules(nav);
    await onboarding.refreshStatus();
    await restoreWorkbenchSession();
    purgeHiddenModuleTabs();
    syncOnboardingFromTabs();
    void useFileWorksetsStore().hydrate(ws.path, true);
    setStatus(`工作空间: ${ws.path}`);
  }

  function openToolTabCount(): number {
    return wb.tabs.value.filter((t) => t.pageId !== "home").length;
  }

  function clearWorkbenchAfterWorkspaceClose() {
    wb.tabs.value = [];
    wb.activeTabId.value = "";
    treeHandlersByTab.clear();
    fileDetailTabByRel.clear();
    partKeyTabByKey.clear();
    treeSelectHandler.value = null;
    syncShellUrl();
  }

  async function closeWorkspace(opts?: { skipTabCheck?: boolean }) {
    if (!workspacePath.value) {
      setStatus("当前未打开工作空间");
      return;
    }
    if (!opts?.skipTabCheck) {
      const n = openToolTabCount();
      if (n > 0) {
        throw new Error(`请先关闭 ${n} 个工具 Tab（可保留「主页」）。`);
      }
    }
    flushWorkbenchSession({ force: true });
    await closeWorkspaceApi();
    workspacePath.value = "";
    clearWorkbenchAfterWorkspaceClose();
    await reloadLauncher();
    await onboarding.refreshStatus();
    openWelcome();
    setStatus("已关闭工作空间");
  }

  async function requestCloseWorkspace(): Promise<boolean> {
    if (!workspacePath.value) {
      setStatus("当前未打开工作空间");
      return false;
    }
    const n = openToolTabCount();
    const decision = await confirmCloseWorkspace(n, wb.toolTabDirtyTitles());
    if (!decision) return false;
    if (decision === "close_all") {
      wb.discardAllToolTabs();
    }
    await closeWorkspace({ skipTabCheck: true });
    return true;
  }

  async function resetToFactorySettings() {
    const n = openToolTabCount();
    if (n > 0) {
      throw new Error(`请先关闭 ${n} 个工具 Tab（可保留「主页」），再恢复初始状态。`);
    }
    if (workspacePath.value) {
      await closeWorkspace();
    } else {
      await closeWorkspaceApi().catch(() => undefined);
      workspacePath.value = "";
      clearWorkbenchAfterWorkspaceClose();
    }
    await resetLauncherFactory();
    clearPhoenixBrowserStorage();
    onboarding.resetLocalState();
    useUiPrefsStore().resetToDefaults();
    await reloadLauncher();
    shellLayout.value = normalizeShellLayout(launcher.value?.shell_layout);
    await onboarding.refreshStatus();
    openWelcome();
    openConfig();
    setStatus("已恢复为初始安装状态");
  }

  function focusWorkbenchForModuleScope(scope: ModuleScope) {
    workbenchFocusScope.value = scope;
    const tabId = resolveTabForModuleScope(
      wb.tabs.value,
      wb.activeTabId.value,
      scope,
      pageModule,
    );
    if (tabId) {
      wb.activateTab(tabId);
      return;
    }
    wb.activeTabId.value = "";
  }

  async function enterWorkbenchFromWelcome(opts?: { scope?: ModuleScope }) {
    if (!workspacePath.value) {
      openConfig();
      return;
    }
    await onboarding.refreshStatus();
    if (!onboarding.workspaceOk) {
      setStatus(WORKSPACE_GATE_MSG);
      openConfig();
      return;
    }
    leaveWelcomeForWorkbench();
    purgeHiddenModuleTabs();
    const scope = opts?.scope ?? "all";
    focusWorkbenchForModuleScope(scope);
  }

  function flushWorkbenchSession(opts?: { force?: boolean }) {
    if (!workspacePath.value) return;
    if (!persistenceReady && !opts?.force) return;
    const ids = wb.tabs.value.map((t) => t.id);
    const states = persistenceReady ? collectPageStates(ids) : {};
    const snap = wb.exportSession(states);
    if (persistenceReady) {
      void saveWorkbenchSessionAll(workspacePath.value, snap);
    } else {
      writeLocalWorkbenchSession(workspacePath.value, snap);
    }
  }

  function scheduleWorkbenchSave() {
    if (!persistenceReady) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushWorkbenchSession();
    }, 800);
  }

  async function restoreWorkbenchSession(): Promise<boolean> {
    const snap = await loadWorkbenchSession(workspacePath.value);
    if (snap && wb.restoreSession(snap)) {
      if (!wb.tabs.value.length) {
        leaveWelcomeForWorkbench();
        focusWorkbenchForModuleScope("all");
        return false;
      }
      leaveWelcomeForWorkbench();
      return true;
    }
    wb.tabs.value = [];
    wb.activeTabId.value = "";
    const page = resolveInitialPage();
    if (page) {
      leaveWelcomeForWorkbench();
      wb.ensureInitialTab(page);
      return true;
    }
    if (workspacePath.value && onboarding.workspaceOk) {
      leaveWelcomeForWorkbench();
      focusWorkbenchForModuleScope("all");
      return false;
    }
    openWelcome();
    return false;
  }

  async function closeTab(tabId: string): Promise<boolean> {
    const ok = await wb.closeTab(tabId);
    if (ok && !wb.tabs.value.length) {
      stayInWorkbenchIdle();
    }
    return ok;
  }

  async function closeAllTabs(): Promise<boolean> {
    const ok = await wb.closeAllTabs();
    if (ok) {
      stayInWorkbenchIdle();
    }
    return ok;
  }

  function setupWorkbenchPersistence() {
    watch(wb.tabs, () => {
      syncDetailTabMaps();
      pruneTreeHandlers();
      syncOnboardingFromTabs();
      scheduleWorkbenchSave();
      syncShellUrl();
    }, { deep: true });
    watch(wb.activeTabId, () => {
      syncActiveTreeHandler();
      scheduleWorkbenchSave();
      syncShellUrl();
    }, { immediate: true });
    watch(showWelcomeScreen, () => {
      syncShellUrl();
    });
    if (typeof window !== "undefined") {
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushWorkbenchSession({ force: true });
      });
      window.addEventListener("beforeunload", () => flushWorkbenchSession({ force: true }));
      window.addEventListener("pagehide", () => flushWorkbenchSession({ force: true }));
    }
    persistenceReady = true;
    syncShellUrl();
  }

  let shellLogCursor = 0;
  let shellLogPollTimer: ReturnType<typeof setInterval> | null = null;

  function pollShellLog() {
    void fetchShellLog(shellLogCursor)
      .then((data) => {
        for (const line of data.lines) {
          appendLog(line.text, { source: line.source, open: true });
        }
        shellLogCursor = data.total;
      })
      .catch(() => {
        /* 服务已关闭或未就绪 */
      });
  }

  function setupShellLogPolling() {
    if (typeof window === "undefined" || shellLogPollTimer) return;
    shellLogPollTimer = setInterval(pollShellLog, 2500);
  }

  async function persistShellLayout(patch: Partial<ShellLayout>) {
    shellLayout.value = normalizeShellLayout({ ...shellLayout.value, ...patch });
    const updated = await patchShellLayout(patch);
    shellLayout.value = normalizeShellLayout({ ...shellLayout.value, ...updated });
  }

  async function persistNavModules(enabled: string[]) {
    const updated = await patchWorkspaceNavModules({ enabled });
    applyWorkspaceNavModules(updated);
    const active = wb.activeTab()?.pageId;
    if (active && !isPageModuleVisible(active)) {
      wb.tabs.value = wb.tabs.value.filter((t) => isPageModuleVisible(t.pageId));
      const next = wb.tabs.value.find((t) => t.id === wb.activeTabId.value) ?? wb.tabs.value[0];
      wb.activeTabId.value = next?.id ?? "";
      if (!wb.tabs.value.length) {
        stayInWorkbenchIdle();
      }
    }
  }

  async function toggleNavModule(id: string) {
    const cur = [...enabledNavModules.value];
    const idx = cur.indexOf(id);
    if (idx >= 0) {
      if (cur.length <= 1) {
        setStatus("至少保留一个功能模块");
        return;
      }
      cur.splice(idx, 1);
    } else {
      cur.push(id);
    }
    await persistNavModules(cur);
  }

  async function setWorkspaceModuleScope(path: string, scope: ModuleScope) {
    const nav = await patchWorkspaceNavModules({ path, scope });
    await reloadLauncher();
    if (path === workspacePath.value) {
      applyWorkspaceNavModules(nav);
    }
  }

  function registerTreeSelect(tabId: string | undefined, fn: TreeSelectHandler | null) {
    if (!tabId) return;
    if (fn) treeHandlersByTab.set(tabId, fn);
    else treeHandlersByTab.delete(tabId);
    syncActiveTreeHandler();
  }

  async function dispatchTreeSelect(rel: string) {
    const norm = rel.replace(/\\/g, "/").trim();
    if (!norm) return;

    const handler = treeSelectHandler.value;
    if (handler) {
      try {
        const accepted = await handler(norm);
        if (accepted !== false) return;
      } catch {
        /* 当前 Tab 处理失败时回退文件详情 */
      }
    }

    if (/\.fcstd$/i.test(basenameFromRel(norm))) {
      openFileDetailForRel(norm);
    }
  }

  function requestTreeRescan(selectRel?: string) {
    treeSelectAfterRescan.value = selectRel ?? null;
    treeRescanToken.value += 1;
  }

  function resolveInitialPage(): string | undefined {
    const nav = appConfig.value?.navigation ?? [];
    const intent = parseShellUrl();
    if (!intent || intent.kind === "welcome" || intent.kind === "config") {
      return undefined;
    }
    if (intent.kind === "page" && nav.some((n) => n.page === intent.pageId) && isPageModuleVisible(intent.pageId)) {
      return intent.pageId;
    }
    return undefined;
  }

  function tabMatchesUrlIntent(tab: WorkbenchTab, intent: Extract<ShellUrlIntent, { kind: "page" }>): boolean {
    const { pageId, rel } = intent;
    const pid = tab.pageId;
    if (pageId === "bom_apply" || pageId === "file_detail") {
      if (pid !== "file_detail" && pid !== "bom_apply") return false;
    } else if (pid !== normalizePageId(pageId)) {
      return false;
    }
    if (!rel) return true;
    const key = (tab.contextKey || tab.subtitle || "").trim();
    return key === rel.trim();
  }

  /** 刷新后：优先在已恢复 Tab 中激活与 URL 匹配的页，避免重复开 Tab */
  function focusTabFromUrlIntent(intent: ShellUrlIntent): boolean {
    if (intent.kind !== "page") return false;
    const hit = wb.tabs.value.find((t) => tabMatchesUrlIntent(t, intent));
    if (hit) {
      shellActivateTab(hit.id);
      return true;
    }
    return false;
  }

  function applyShellUrlIntent(intent: ShellUrlIntent): void {
    if (intent.kind === "welcome") {
      openWelcome();
      return;
    }
    if (intent.kind === "config") {
      openConfig();
      return;
    }
    if (intent.kind !== "page") return;

    const { pageId, rel, renameLogId, analyze } = intent;
    if (pageId === "bom_apply" && rel) {
      openBomApplyForRel(rel);
      return;
    }
    if (pageId === "file_rename" && rel) {
      openFileDetailForRel(rel, { subTab: "rename" });
      return;
    }
    if (pageId === "rename_analysis" || pageId === "file_rename") {
      openRenameAnalysis({
        renameLogId,
        autoAnalyze: analyze,
      });
      return;
    }
    if (pageId === "part_key_detail" && rel) {
      const dot = rel.indexOf(".");
      if (dot > 0) {
        openPartKeyDetail(rel.slice(0, dot), rel.slice(dot + 1));
      }
      return;
    }
    goToPage(pageId);
  }

  function applyUrlDeepLink(): boolean {
    const intent = parseShellUrl();
    if (!intent) return false;
    applyShellUrlIntent(intent);
    return true;
  }

  async function openCodeIgnoreSidebar() {
    workspaceSidebarTab.value = "ignore";
    try {
      sessionStorage.setItem(SIDEBAR_TAB_KEY, "ignore");
    } catch {
      /* ignore */
    }
    await persistShellLayout({ right_panel_open: true });
  }

  async function openWorksetSidebar() {
    workspaceSidebarTab.value = "workset";
    try {
      sessionStorage.setItem(SIDEBAR_TAB_KEY, "workset");
    } catch {
      /* ignore */
    }
    await persistShellLayout({ right_panel_open: true });
  }

  watch(workspaceSidebarTab, (tab) => {
    try {
      sessionStorage.setItem(SIDEBAR_TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  });

  async function init() {
    appConfig.value = await fetchAppConfig();
    const ws = await getWorkspace();
    workspacePath.value = ws.path;
    await reloadLauncher();
    if (workspacePath.value) {
      try {
        applyWorkspaceNavModules(await fetchWorkspaceNavModules());
      } catch {
        /* 工作空间尚未就绪 */
      }
    }
    await onboarding.refreshStatus();

    const urlIntent = parseShellUrl();
    const sessionRestored = await restoreWorkbenchSession();

    syncOnboardingFromTabs();
    purgeConfigTabs();

    if (urlIntent) {
      if (urlIntent.kind === "welcome") {
        openWelcome();
      } else if (sessionRestored && urlIntent.kind === "page") {
        if (!focusTabFromUrlIntent(urlIntent)) {
          applyShellUrlIntent(urlIntent);
        }
      } else if (urlIntent.kind === "config") {
        openConfig();
      } else {
        applyShellUrlIntent(urlIntent);
      }
    } else if (sessionRestored) {
      leaveWelcomeForWorkbench();
    } else if (workspacePath.value && onboarding.workspaceOk) {
      leaveWelcomeForWorkbench();
      if (!wb.tabs.value.length) {
        focusWorkbenchForModuleScope("all");
      }
    }

    if (!onboarding.workspaceOk) {
      if (!wb.tabs.value.length && !urlIntent) {
        openWelcome();
      }
      openConfig();
    }

    purgeHiddenModuleTabs();
    setupWorkbenchPersistence();
    syncShellUrl();
    setupShellLogPolling();
    if (workspacePath.value) {
      void useFileWorksetsStore().hydrate(workspacePath.value);
    }
  }

  const ctx: AppShellContext = {
    appConfig,
    launcher,
    workspacePath,
    currentPage,
    workbenchFocusScope,
    navHover,
    shellLayout,
    currentNavItem,
    statusText,
    pageSummary,
    logText,
    logSource,
    setStatus,
    setPageSummary,
    appendLog,
    clearLog,
    setLogOpen,
    setPropertiesOpen,
    configOverlayOpen,
    openConfig,
    closeConfig,
    goToPage,
    canNavigateToPage,
    openOnboardingGuide: () => {
      void runShellTour(ctx, true);
    },
    scrollToGuideToken,
    openPartKeyDetail,
    openBomApplyForRel,
    openFileDetailForRel,
    rerouteFileDetailTab,
    openFileRenameForRel,
    openRenameAnalysis,
    switchWorkspace,
    openToolTabCount,
    toolTabDirtyTitles: () => wb.toolTabDirtyTitles(),
    discardAllToolTabs: () => wb.discardAllToolTabs(),
    closeWorkspace,
    requestCloseWorkspace,
    resetToFactorySettings,
    enterWorkbenchFromWelcome,
    persistShellLayout,
    enabledNavModules,
    isNavItemVisible,
    isPageModuleVisible,
    persistNavModules,
    toggleNavModule,
    setWorkspaceModuleScope,
    reloadLauncher,
    init,
    treeSelectHandler,
    registerTreeSelect,
    dispatchTreeSelect,
    treeRescanToken,
    treeSelectAfterRescan,
    requestTreeRescan,
    tabs: wb.tabs,
    activeTabId: wb.activeTabId,
    tabBarTabs: wb.tabBarTabs,
    showTabBar: wb.showTabBar,
    openTab: shellOpenTab,
    openNewTabForPage: (pageId: string) => shellOpenTab({ pageId, forceNew: true }),
    activateTab: shellActivateTab,
    closeTab,
    closeAllTabs,
    getTab: wb.getTab,
    activeTab: wb.activeTab,
    updateTab: wb.updateTab,
    setTabDirty: wb.setTabDirty,
    consumeTabPayload: wb.consumeTabPayload,
    consumeTabPageState: wb.consumeTabPageState,
    canOpenNewTab: wb.canOpenNewTab,
    scheduleWorkbenchSave,
    workspaceSidebarTab,
    /** @deprecated 使用 workspaceSidebarTab */
    codeRightSidebarTab: workspaceSidebarTab,
    openCodeIgnoreSidebar,
    openWorksetSidebar,
  };

  provide(APP_SHELL_KEY, ctx);
  return ctx;
}

export function useAppShell(): AppShellContext {
  const ctx = inject(APP_SHELL_KEY);
  if (!ctx) throw new Error("useAppShell() 需在 AppShell 内调用");
  return ctx;
}
