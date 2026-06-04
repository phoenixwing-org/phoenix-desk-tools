import { computed, inject, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import type { AppConfig, LauncherPrefs, NavItem, ShellLayout } from "../types/config";
import type { BomFields } from "../api";
import {
  fetchAppConfig,
  fetchLauncherPrefs,
  fetchShellLog,
  getWorkspace,
  patchShellLayout,
  setWorkspace,
} from "../api";
import { collectPageStates } from "./usePageSession";
import { loadWorkbenchSession, saveWorkbenchSessionAll } from "./workbenchSession";
import { createWorkbench, type WorkbenchContext } from "./useWorkbench";
import { basenameFromRel, normalizeRepoRelForApi } from "../utils/workspaceFileQuery";
import { normalizeDetailTabRel, partKeyTabContextKey } from "../utils/detailTabRoute";
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
  goToPage: (pageId: string) => void;
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
  persistShellLayout: (patch: Partial<ShellLayout>) => Promise<void>;
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
};

const APP_SHELL_KEY: InjectionKey<AppShellContext> = Symbol("appShell");

const MAX_LOG_CHARS = 500_000;

const DEFAULT_SHELL: ShellLayout = {
  nav_rail_mode: 1,
  right_panel_open: true,
  mid_right_sash_px: null,
  right_panel_width_px: 300,
  log_panel_open: true,
  log_panel_height_px: 180,
  log_auto_open_on_append: true,
};

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

  const currentPage = wb.activePageId;
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

  function goToPage(pageId: string) {
    wb.navigateToPage(pageId === "rename_analysis" ? "file_rename" : pageId);
    navHover.value = null;
  }

  function openPartKeyDetail(
    partNumber: string,
    partVersion: string,
    opts?: { partName?: string; label?: string },
  ) {
    const pn = partNumber.trim();
    const pv = partVersion.trim();
    if (!pn || !pv) return;
    const contextKey = partKeyTabContextKey(pn, pv);
    const existing = findPartKeyTab(pn, pv);
    if (existing) {
      if (opts?.partName?.trim() || opts?.label?.trim()) {
        existing.subtitle = opts.partName?.trim() || opts.label?.trim() || existing.subtitle;
      }
      wb.activateTab(existing.id);
      return;
    }
    const subtitle = opts?.partName?.trim() || opts?.label?.trim() || undefined;
    try {
      wb.openTab({
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
      wb.activateTab(existing.id);
      return;
    }
    try {
      const relApi = normalizeRepoRelForApi(rel) || rel;
      const tabId = wb.openTab({
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
      wb.openTab({
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
    await restoreWorkbenchSession();
    setStatus(`工作空间: ${ws.path}`);
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
    if (snap && wb.restoreSession(snap)) return;
    wb.tabs.value = [];
    wb.activeTabId.value = "";
    const page = resolveInitialPage() ?? "home";
    wb.ensureInitialTab(page);
  }

  function setupWorkbenchPersistence() {
    watch(wb.tabs, () => {
      syncDetailTabMaps();
      pruneTreeHandlers();
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
    if (fromUrl && nav.some((n) => n.page === fromUrl)) {
      return fromUrl;
    }
    return "home";
  }

  function applyUrlDeepLink(): void {
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page")?.trim();
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
    goToPage(page);
  }

  async function init() {
    appConfig.value = await fetchAppConfig();
    const ws = await getWorkspace();
    workspacePath.value = ws.path;
    await reloadLauncher();
    await restoreWorkbenchSession();
    applyUrlDeepLink();
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
    goToPage,
    openPartKeyDetail,
    openBomApplyForRel,
    openFileDetailForRel,
    rerouteFileDetailTab,
    openFileRenameForRel,
    openRenameAnalysis,
    switchWorkspace,
    persistShellLayout,
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
    openTab: wb.openTab,
    openNewTabForPage: wb.openNewTabForPage,
    activateTab: wb.activateTab,
    closeTab: wb.closeTab,
    closeAllTabs: wb.closeAllTabs,
    getTab: wb.getTab,
    activeTab: wb.activeTab,
    updateTab: wb.updateTab,
    setTabDirty: wb.setTabDirty,
    consumeTabPayload: wb.consumeTabPayload,
    consumeTabPageState: wb.consumeTabPageState,
    canOpenNewTab: wb.canOpenNewTab,
    scheduleWorkbenchSave,
  };

  provide(APP_SHELL_KEY, ctx);
  return ctx;
}

export function useAppShell(): AppShellContext {
  const ctx = inject(APP_SHELL_KEY);
  if (!ctx) throw new Error("useAppShell() 需在 AppShell 内调用");
  return ctx;
}
