import { computed, inject, provide, ref, shallowRef, type InjectionKey, type Ref } from "vue";
import type { AppConfig, LauncherPrefs, NavItem, ShellLayout } from "../types/config";
import type { BomFields } from "../api";
import {
  fetchAppConfig,
  fetchLauncherPrefs,
  getWorkspace,
  patchShellLayout,
  setWorkspace,
} from "../api";

export type LogAppendOptions = {
  /** 强制展开 / 仅追加不展开；默认遵循 log_auto_open_on_append */
  open?: boolean;
  /** 可选来源页 id，用于日志标题 */
  source?: string;
};

export type PendingFileRename = {
  rel: string;
  form: Partial<BomFields>;
  baseline: Partial<BomFields>;
};

export type AppShellContext = {
  appConfig: Ref<AppConfig | null>;
  launcher: Ref<LauncherPrefs | null>;
  workspacePath: Ref<string>;
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
  partKeyDetail: Ref<{ partNumber: string; partVersion: string } | null>;
  openPartKeyDetail: (partNumber: string, partVersion: string) => void;
  closePartKeyDetail: () => void;
  pendingBomRel: Ref<string | null>;
  pendingFileRename: Ref<PendingFileRename | null>;
  openBomApplyForRel: (repoRelPath: string) => void;
  openFileRenameForRel: (
    repoRelPath: string,
    form: Partial<BomFields>,
    baseline: Partial<BomFields>,
  ) => void;
  switchWorkspace: (path: string) => Promise<void>;
  persistShellLayout: (patch: Partial<ShellLayout>) => Promise<void>;
  reloadLauncher: () => Promise<void>;
  init: () => Promise<void>;
  treeSelectHandler: Ref<((rel: string) => void) | null>;
  registerTreeSelect: (fn: ((rel: string) => void) | null) => void;
  treeRescanToken: Ref<number>;
  treeSelectAfterRescan: Ref<string | null>;
  requestTreeRescan: (selectRel?: string) => void;
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
  const currentPage = ref("home");
  const navHover = ref<string | null>(null);
  const shellLayout = ref<ShellLayout>({ ...DEFAULT_SHELL });
  const statusText = ref("");
  const logText = ref("");
  const logSource = ref<string | null>(null);
  const logAutoOpenSuppressed = ref(false);
  const treeSelectHandler = shallowRef<((rel: string) => void) | null>(null);
  const treeRescanToken = ref(0);
  const treeSelectAfterRescan = ref<string | null>(null);
  const partKeyDetail = ref<{ partNumber: string; partVersion: string } | null>(null);
  const pendingBomRel = ref<string | null>(null);
  const pendingFileRename = ref<PendingFileRename | null>(null);

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
    currentPage.value = pageId;
    navHover.value = null;
  }

  function openPartKeyDetail(partNumber: string, partVersion: string) {
    const pn = partNumber.trim();
    const pv = partVersion.trim();
    if (!pn || !pv) return;
    partKeyDetail.value = { partNumber: pn, partVersion: pv };
    goToPage("part_catalog");
  }

  function closePartKeyDetail() {
    partKeyDetail.value = null;
  }

  function openBomApplyForRel(repoRelPath: string) {
    const rel = repoRelPath.trim();
    if (!rel) return;
    pendingBomRel.value = rel;
    goToPage("bom_apply");
  }

  function openFileRenameForRel(
    repoRelPath: string,
    form: Partial<BomFields>,
    baseline: Partial<BomFields>,
  ) {
    const rel = repoRelPath.trim();
    if (!rel) return;
    pendingFileRename.value = {
      rel,
      form: { ...form },
      baseline: { ...baseline },
    };
    goToPage("file_rename");
  }

  async function reloadLauncher() {
    launcher.value = await fetchLauncherPrefs();
    const sl = launcher.value.shell_layout;
    shellLayout.value = { ...DEFAULT_SHELL, ...sl };
  }

  async function switchWorkspace(path: string) {
    const ws = await setWorkspace(path.trim());
    workspacePath.value = ws.path;
    await reloadLauncher();
    setStatus(`工作空间: ${ws.path}`);
  }

  async function persistShellLayout(patch: Partial<ShellLayout>) {
    shellLayout.value = { ...shellLayout.value, ...patch };
    const updated = await patchShellLayout(patch);
    shellLayout.value = { ...shellLayout.value, ...updated };
  }

  function registerTreeSelect(fn: ((rel: string) => void) | null) {
    treeSelectHandler.value = fn;
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
    return nav.find((n) => n.page !== "home")?.page ?? nav[0]?.page;
  }

  async function init() {
    appConfig.value = await fetchAppConfig();
    const ws = await getWorkspace();
    workspacePath.value = ws.path;
    await reloadLauncher();
    const page = resolveInitialPage();
    if (page) currentPage.value = page;
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
    partKeyDetail,
    openPartKeyDetail,
    closePartKeyDetail,
    pendingBomRel,
    pendingFileRename,
    openBomApplyForRel,
    openFileRenameForRel,
    switchWorkspace,
    persistShellLayout,
    reloadLauncher,
    init,
    treeSelectHandler,
    registerTreeSelect,
    treeRescanToken,
    treeSelectAfterRescan,
    requestTreeRescan,
  };

  provide(APP_SHELL_KEY, ctx);
  return ctx;
}

export function useAppShell(): AppShellContext {
  const ctx = inject(APP_SHELL_KEY);
  if (!ctx) throw new Error("useAppShell() 需在 AppShell 内调用");
  return ctx;
}
