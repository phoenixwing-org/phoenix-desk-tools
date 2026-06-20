import { computed, inject, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import type { BomFields } from "../api";
import type { AppConfig, LauncherPrefs, NavItem, ShellLayout } from "../types/config";
import {
  fetchAppConfig,
  fetchLauncherPrefs,
  fetchShellLog,
  getWorkspace,
  patchNavModules,
  patchShellLayout,
  setWorkspace,
} from "../api";
import { collectPageStates } from "./usePageSession";
import { loadWorkbenchSession, saveWorkbenchSessionAll } from "./workbenchSession";
import { createWorkbench, type WorkbenchContext } from "./useWorkbench";
import { basenameFromRel, normalizeRepoRelForApi } from "../utils/workspaceFileQuery";
import { normalizeDetailTabRel, partKeyTabContextKey } from "../utils/detailTabRoute";
import {
  ONBOARDING_PAGES_ALWAYS,
  WORKSPACE_GATE_MSG,
} from "../utils/onboardingConstants";
import { useOnboardingStore } from "../stores/onboarding";
import type { OpenTabOptions, WorkbenchTab, WorkbenchTabPayload } from "../types/workbench";

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
  /** 当前激活 Tab 的 pageId */
  currentPage: Ref<string>;
  navHover: Ref<string | null>;
  shellLayout: Ref<ShellLayout>;
  currentNavItem: Ref<NavItem | undefined>;
  statusText: Ref<string>;
  logText: Ref<string>;
  logSource: Ref<string | null>;
  setStatus: (msg: string) => void;
  appendLog: (text: string, opts?: LogAppendOptions) => void;
  clearLog: () => void;
  setLogOpen: (open: boolean) => void;
  /** 全屏配置层（遮住主内容区，不占 Tab 栏） */
  configOverlayOpen: Ref<boolean>;
  openConfig: () => void;
  closeConfig: () => void;
  goToPage: (pageId: string) => void;
  canNavigateToPage: (pageId: string) => boolean;
  /** 打开主页并滚动到新手指南区块 */
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
  /** 离开欢迎页，进入 Ribbon 工作台（无 Tab 时打开默认工具页） */
  enterWorkbenchFromWelcome: () => Promise<void>;
  persistShellLayout: (patch: Partial<ShellLayout>) => Promise<void>;
  enabledNavModules: Ref<string[]>;
  isNavItemVisible: (item: NavItem) => boolean;
  isPageModuleVisible: (pageId: string) => boolean;
  persistNavModules: (enabled: string[]) => Promise<void>;
  toggleNavModule: (id: string) => Promise<void>;
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
  /** Code 模块右侧栏：工作空间树 / 忽略设定 Tab */
  codeRightSidebarTab: Ref<"tree" | "ignore">;
  openCodeIgnoreSidebar: () => Promise<void>;
};

const APP_SHELL_KEY: InjectionKey<AppShellContext> = Symbol("appShell");

const MAX_LOG_CHARS = 500_000;

const DEFAULT_SHELL: ShellLayout = {
  nav_rail_mode: 0,
  ribbon_mode: 1,
  right_panel_open: true,
  mid_right_sash_px: null,
  right_panel_width_px: 300,
  log_panel_open: true,
  log_panel_height_px: 180,
  log_auto_open_on_append: true,
  workspace_tree_dock: "right",
  shell_log_dock: "right",
};

const NAV_ALWAYS_VISIBLE = new Set(["welcome", "home", "config", "unit_tests"]);

/** 不在 navigation 中、但属于某模块的 Tab 页 */
const PAGE_MODULE_FALLBACK: Record<string, string> = {
  file_detail: "cad",
  bom_apply: "cad",
  rename_analysis: "cad",
};

const DEFAULT_NAV_MODULES = ["cad", "code"];

const CODE_RIGHT_TAB_KEY = "phoenix-code-right-tab";

function readCodeRightSidebarTab(): "tree" | "ignore" {
  try {
    const v = sessionStorage.getItem(CODE_RIGHT_TAB_KEY);
    return v === "ignore" ? "ignore" : "tree";
  } catch {
    return "tree";
  }
}

export function provideAppShell(): AppShellContext {
  const appConfig = shallowRef<AppConfig | null>(null);
  const launcher = shallowRef<LauncherPrefs | null>(null);
  const workspacePath = ref("");
  const navHover = ref<string | null>(null);
  const shellLayout = ref<ShellLayout>({ ...DEFAULT_SHELL });
  const statusText = ref("");
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

  function openWelcome() {
    showWelcomeScreen.value = true;
    navHover.value = null;
  }

  function leaveWelcomeForWorkbench() {
    showWelcomeScreen.value = false;
  }
  const codeRightSidebarTab = ref<"tree" | "ignore">(readCodeRightSidebarTab());
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
        openWelcome();
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
      openWelcome();
    }
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
    showWelcomeScreen.value ? "welcome" : (wb.activeTab()?.pageId ?? "home"),
  );
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let persistenceReady = false;

  const currentNavItem = computed(() =>
    appConfig.value?.navigation.find((n) => n.page === currentPage.value),
  );

  function setStatus(msg: string) {
    statusText.value = msg;
  }

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

  function openOnboardingGuide() {
    goToPage("home");
    scrollToGuideToken.value += 1;
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
      setStatus("该功能模块已在主页关闭");
      wb.navigateToPage("home");
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
    shellLayout.value = { ...DEFAULT_SHELL, ...sl };
  }

  async function switchWorkspace(path: string) {
    flushWorkbenchSession();
    const ws = await setWorkspace(path.trim());
    workspacePath.value = ws.path;
    await reloadLauncher();
    await onboarding.refreshStatus();
    await restoreWorkbenchSession();
    syncOnboardingFromTabs();
    setStatus(`工作空间: ${ws.path}`);
  }

  function pickDefaultWorkbenchPage(): string {
    if (enabledNavModules.value.includes("cad")) return "fcstd_map";
    if (enabledNavModules.value.includes("code")) return "code_index";
    return "fcstd_map";
  }

  async function enterWorkbenchFromWelcome() {
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
    if (!wb.tabs.value.length) {
      goToPage(pickDefaultWorkbenchPage());
    }
  }

  function flushWorkbenchSession() {
    if (!persistenceReady || !workspacePath.value) return;
    const ids = wb.tabs.value.map((t) => t.id);
    const states = collectPageStates(ids);
    const snap = wb.exportSession(states);
    void saveWorkbenchSessionAll(workspacePath.value, snap);
  }

  function scheduleWorkbenchSave() {
    if (!persistenceReady) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushWorkbenchSession();
    }, 800);
  }

  async function restoreWorkbenchSession() {
    const snap = await loadWorkbenchSession(workspacePath.value);
    if (snap && wb.restoreSession(snap)) {
      if (!wb.tabs.value.length) {
        openWelcome();
        return;
      }
      leaveWelcomeForWorkbench();
      return;
    }
    wb.tabs.value = [];
    wb.activeTabId.value = "";
    const page = resolveInitialPage();
    if (page) {
      leaveWelcomeForWorkbench();
      wb.ensureInitialTab(page);
    } else {
      openWelcome();
    }
  }

  async function closeTab(tabId: string): Promise<boolean> {
    const ok = await wb.closeTab(tabId);
    if (ok && !wb.tabs.value.length) {
      openWelcome();
    }
    return ok;
  }

  async function closeAllTabs(): Promise<boolean> {
    const ok = await wb.closeAllTabs();
    if (ok) {
      openWelcome();
    }
    return ok;
  }

  function setupWorkbenchPersistence() {
    watch(wb.tabs, () => {
      syncDetailTabMaps();
      pruneTreeHandlers();
      syncOnboardingFromTabs();
      scheduleWorkbenchSave();
    }, { deep: true });
    watch(wb.activeTabId, () => {
      syncActiveTreeHandler();
      scheduleWorkbenchSave();
    }, { immediate: true });
    if (typeof window !== "undefined") {
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushWorkbenchSession();
      });
      window.addEventListener("beforeunload", () => flushWorkbenchSession());
    }
    persistenceReady = true;
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
    shellLayout.value = { ...shellLayout.value, ...patch };
    const updated = await patchShellLayout(patch);
    shellLayout.value = { ...shellLayout.value, ...updated };
  }

  async function persistNavModules(enabled: string[]) {
    const updated = await patchNavModules(enabled);
    if (launcher.value) {
      launcher.value = { ...launcher.value, nav_modules: updated };
    }
    purgeHiddenModuleTabs();
    const active = wb.activeTab()?.pageId;
    if (active && !isPageModuleVisible(active)) {
      wb.navigateToPage("home");
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
    const fromUrl = new URLSearchParams(window.location.search).get("page")?.trim();
    if (fromUrl === "welcome") {
      return undefined;
    }
    if (fromUrl && nav.some((n) => n.page === fromUrl) && isPageModuleVisible(fromUrl)) {
      return fromUrl;
    }
    return undefined;
  }

  function applyUrlDeepLink(): void {
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page")?.trim();
    if (page === "welcome") {
      openWelcome();
      return;
    }
    if (!page) return;

    const rel = params.get("rel")?.trim();
    if (page === "bom_apply" && rel) {
      openBomApplyForRel(rel);
      return;
    }
    if (page === "file_rename" && rel) {
      openFileDetailForRel(rel, { subTab: "rename" });
      return;
    }
    if (page === "rename_analysis" || (page === "file_rename" && params.get("rename_log_id"))) {
      const logRaw = params.get("rename_log_id")?.trim();
      const logId = logRaw ? Number(logRaw) : NaN;
      openRenameAnalysis({
        renameLogId: Number.isFinite(logId) ? logId : undefined,
        autoAnalyze: params.get("analyze") === "1",
      });
      return;
    }
    if (page === "config") {
      openConfig();
      return;
    }
    goToPage(page);
  }

  async function openCodeIgnoreSidebar() {
    codeRightSidebarTab.value = "ignore";
    try {
      sessionStorage.setItem(CODE_RIGHT_TAB_KEY, "ignore");
    } catch {
      /* ignore */
    }
    await persistShellLayout({ right_panel_open: true });
  }

  watch(codeRightSidebarTab, (tab) => {
    try {
      sessionStorage.setItem(CODE_RIGHT_TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  });

  async function init() {
    appConfig.value = await fetchAppConfig();
    const ws = await getWorkspace();
    workspacePath.value = ws.path;
    await reloadLauncher();
    await onboarding.refreshStatus();
    await restoreWorkbenchSession();
    syncOnboardingFromTabs();
    purgeConfigTabs();
    if (!onboarding.workspaceOk) {
      openWelcome();
      openConfig();
    }
    applyUrlDeepLink();
    purgeHiddenModuleTabs();
    setupWorkbenchPersistence();
    setupShellLogPolling();
  }

  const ctx: AppShellContext = {
    appConfig,
    launcher,
    workspacePath,
    currentPage,
    navHover,
    shellLayout,
    currentNavItem,
    statusText,
    logText,
    logSource,
    setStatus,
    appendLog,
    clearLog,
    setLogOpen,
    configOverlayOpen,
    openConfig,
    closeConfig,
    goToPage,
    canNavigateToPage,
    openOnboardingGuide,
    scrollToGuideToken,
    openPartKeyDetail,
    openBomApplyForRel,
    openFileDetailForRel,
    rerouteFileDetailTab,
    openFileRenameForRel,
    openRenameAnalysis,
    switchWorkspace,
    enterWorkbenchFromWelcome,
    persistShellLayout,
    enabledNavModules,
    isNavItemVisible,
    isPageModuleVisible,
    persistNavModules,
    toggleNavModule,
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
    codeRightSidebarTab,
    openCodeIgnoreSidebar,
  };

  provide(APP_SHELL_KEY, ctx);
  return ctx;
}

export function useAppShell(): AppShellContext {
  const ctx = inject(APP_SHELL_KEY);
  if (!ctx) throw new Error("useAppShell() 需在 AppShell 内调用");
  return ctx;
}
