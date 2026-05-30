import { computed, inject, provide, ref, shallowRef, type InjectionKey, type Ref } from "vue";
import type { AppConfig, LauncherPrefs, NavItem, ShellLayout } from "../types/config";
import {
  fetchAppConfig,
  fetchLauncherPrefs,
  getWorkspace,
  patchShellLayout,
  setWorkspace,
} from "../api";

export type AppShellContext = {
  appConfig: Ref<AppConfig | null>;
  launcher: Ref<LauncherPrefs | null>;
  workspacePath: Ref<string>;
  currentPage: Ref<string>;
  navHover: Ref<string | null>;
  shellLayout: Ref<ShellLayout>;
  currentNavItem: Ref<NavItem | undefined>;
  statusText: Ref<string>;
  setStatus: (msg: string) => void;
  goToPage: (pageId: string) => void;
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

const DEFAULT_SHELL: ShellLayout = {
  nav_rail_mode: 1,
  right_panel_open: true,
  mid_right_sash_px: null,
  right_panel_width_px: 300,
};

export function provideAppShell(): AppShellContext {
  const appConfig = shallowRef<AppConfig | null>(null);
  const launcher = shallowRef<LauncherPrefs | null>(null);
  const workspacePath = ref("");
  const currentPage = ref("home");
  const navHover = ref<string | null>(null);
  const shellLayout = ref<ShellLayout>({ ...DEFAULT_SHELL });
  const statusText = ref("");
  const treeSelectHandler = shallowRef<((rel: string) => void) | null>(null);
  const treeRescanToken = ref(0);
  const treeSelectAfterRescan = ref<string | null>(null);

  const currentNavItem = computed(() =>
    appConfig.value?.navigation.find((n) => n.page === currentPage.value),
  );

  function setStatus(msg: string) {
    statusText.value = msg;
  }

  function goToPage(pageId: string) {
    currentPage.value = pageId;
    navHover.value = null;
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

  async function init() {
    appConfig.value = await fetchAppConfig();
    const ws = await getWorkspace();
    workspacePath.value = ws.path;
    await reloadLauncher();
    const first = appConfig.value.navigation[0]?.page;
    if (first) currentPage.value = first;
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
    setStatus,
    goToPage,
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
