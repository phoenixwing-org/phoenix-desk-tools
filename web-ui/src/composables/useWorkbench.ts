import { computed, ref, type Ref } from "vue";
import type { AppConfig } from "../types/config";
import { CAA_EDITOR_PAGE_ID, CAA_HOME_PAGE_ID } from "../constants/caaPages";
import type { OpenTabOptions, PageTabPolicy, WorkbenchSessionSnapshot, WorkbenchTab, WorkbenchTabPayload } from "../types/workbench";
import { getPageSession } from "./usePageSession";
import { confirmCloseAllTabs, confirmDirtyTabClose } from "./tabCloseConfirm";

let tabSeq = 0;

/** 不落盘、不参与 session 恢复的 Tab 页（欢迎页另有全屏层） */
const EPHEMERAL_TAB_PAGES = new Set(["welcome", "home", "config"]);

function newTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now()}-${tabSeq}`;
}

function basename(path: string): string {
  const s = path.replace(/\\/g, "/").trim();
  return s.split("/").pop() ?? s;
}

export function createWorkbench(appConfig: Ref<AppConfig | null>) {
  const tabs = ref<WorkbenchTab[]>([]);
  const activeTabId = ref("");

  function pagePolicy(pageId: string): PageTabPolicy {
    const wb = appConfig.value?.workbench;
    const pages = wb?.pages ?? {};
    const p = pages[pageId];
    return {
      maxTabs: p?.max_tabs ?? wb?.default_max_tabs ?? 1,
      tabEnabled: p?.tab_enabled ?? false,
    };
  }

  function navLabel(pageId: string): string {
    const fromNav = appConfig.value?.navigation.find((n) => n.page === pageId)?.label;
    if (fromNav) return fromNav;
    const extras: Record<string, string> = {
      config: "配置",
      part_key_detail: "零件详情",
      rename_analysis: "文件改名",
      [CAA_HOME_PAGE_ID]: "CAA 对话框",
      [CAA_EDITOR_PAGE_ID]: "CAA 对话框",
    };
    return extras[pageId] ?? pageId;
  }

  function findTabsForPage(pageId: string): WorkbenchTab[] {
    return tabs.value.filter((t) => t.pageId === pageId);
  }

  function getTab(tabId: string): WorkbenchTab | undefined {
    return tabs.value.find((t) => t.id === tabId);
  }

  function activeTab(): WorkbenchTab | undefined {
    return getTab(activeTabId.value);
  }

  const activePageId = computed(() => activeTab()?.pageId ?? "home");

  /** 工作台 Tab 栏（欢迎页不在 Tab 系统中） */
  const tabBarTabs = computed(() => tabs.value.filter((t) => t.pageId !== "welcome"));

  const showTabBar = computed(() => tabBarTabs.value.length > 0);

  function applyPayload(tab: WorkbenchTab, payload?: WorkbenchTabPayload) {
    if (!payload) return;
    tab.payload = payload;
    tab.payloadConsumed = false;
  }

  function openTab(opts: OpenTabOptions): string {
    const { pageId, title, subtitle, contextKey, payload, forceNew } = opts;
    if (pageId === "welcome") {
      throw new Error("欢迎页不在 Tab 工作台中");
    }
    const { maxTabs } = pagePolicy(pageId);
    const existing = findTabsForPage(pageId);

    if (!forceNew && maxTabs === 1 && existing.length) {
      const tab = existing[0];
      if (title) tab.title = title;
      if (subtitle !== undefined) tab.subtitle = subtitle;
      if (contextKey) tab.contextKey = contextKey;
      applyPayload(tab, payload);
      activeTabId.value = tab.id;
      return tab.id;
    }

    if (!forceNew && existing.length) {
      const tab = existing[existing.length - 1];
      if (payload) applyPayload(tab, payload);
      activeTabId.value = tab.id;
      return tab.id;
    }

    if (existing.length >= maxTabs) {
      throw new Error(`${navLabel(pageId)} 最多 ${maxTabs} 个 Tab，请先关闭部分 Tab`);
    }

    const tab: WorkbenchTab = {
      id: newTabId(),
      pageId,
      title: title ?? navLabel(pageId),
      subtitle,
      contextKey,
      dirty: false,
      payload,
      payloadConsumed: false,
    };
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    return tab.id;
  }

  function navigateToPage(pageId: string): void {
    openTab({ pageId });
  }

  function openNewTabForPage(pageId: string): string {
    return openTab({ pageId, forceNew: true });
  }

  function activateTab(tabId: string): void {
    if (getTab(tabId)) activeTabId.value = tabId;
  }

  function updateTab(
    tabId: string,
    patch: Partial<Pick<WorkbenchTab, "title" | "subtitle" | "contextKey" | "dirty">>,
  ): void {
    const tab = getTab(tabId);
    if (!tab) return;
    if (patch.title !== undefined) tab.title = patch.title;
    if (patch.subtitle !== undefined) tab.subtitle = patch.subtitle;
    if (patch.contextKey !== undefined) tab.contextKey = patch.contextKey;
    if (patch.dirty !== undefined) tab.dirty = patch.dirty;
  }

  function setTabDirty(tabId: string, dirty: boolean): void {
    updateTab(tabId, { dirty });
  }

  function consumeTabPayload(tabId: string): WorkbenchTabPayload | undefined {
    const tab = getTab(tabId);
    if (!tab?.payload || tab.payloadConsumed) return undefined;
    tab.payloadConsumed = true;
    return tab.payload;
  }

  function canOpenNewTab(pageId: string): boolean {
    const { maxTabs, tabEnabled } = pagePolicy(pageId);
    if (!tabEnabled || maxTabs <= 1) return false;
    return findTabsForPage(pageId).length < maxTabs;
  }

  async function closeTab(tabId: string): Promise<boolean> {
    const idx = tabs.value.findIndex((t) => t.id === tabId);
    if (idx < 0) return false;
    const tab = tabs.value[idx];
    const api = getPageSession(tabId);
    const dirty = api?.isDirty() ?? tab.dirty;
    if (dirty) {
      const choice = await confirmDirtyTabClose(tab.title, Boolean(api?.flush));
      if (choice === "cancel") return false;
      if (choice === "flush" && api?.flush) {
        const ok = await api.flush();
        if (!ok) return false;
        tab.dirty = false;
      }
    }
    tabs.value.splice(idx, 1);
    if (activeTabId.value === tabId) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? tabs.value[0];
      activeTabId.value = next?.id ?? "";
    }
    if (!tabs.value.length) {
      activeTabId.value = "";
    }
    return true;
  }

  async function closeAllTabs(): Promise<boolean> {
    const list = tabs.value;
    if (list.length <= 1) return false;

    const dirtyTitles: string[] = [];
    for (const tab of list) {
      const api = getPageSession(tab.id);
      if (api?.isDirty() ?? tab.dirty) dirtyTitles.push(tab.title);
    }
    if (!(await confirmCloseAllTabs(list.length, dirtyTitles))) return false;

    tabs.value = [];
    activeTabId.value = "";
    return true;
  }

  function toolTabDirtyTitles(): string[] {
    const out: string[] = [];
    for (const tab of tabs.value) {
      if (EPHEMERAL_TAB_PAGES.has(tab.pageId)) continue;
      const api = getPageSession(tab.id);
      if (api?.isDirty() ?? tab.dirty) out.push(tab.title);
    }
    return out;
  }

  function discardAllToolTabs(): void {
    tabs.value = [];
    activeTabId.value = "";
  }

  function ensureInitialTab(pageId: string): void {
    if (!tabs.value.length) {
      openTab({ pageId });
    }
  }

  function consumeTabPageState(tabId: string): Record<string, unknown> | undefined {
    const tab = getTab(tabId);
    if (!tab?.pageState) return undefined;
    const state = tab.pageState;
    delete tab.pageState;
    return state;
  }

  function restoreSession(snapshot: WorkbenchSessionSnapshot): boolean {
    if (snapshot.version !== 1 || !snapshot.tabs.length) return false;
    const mapped = snapshot.tabs
      .map((t) => ({
        id: t.id,
        pageId:
          t.pageId === "rename_analysis"
            ? "file_rename"
            : t.pageId === "bom_apply"
              ? "file_detail"
              : t.pageId === "home" && t.title === "配置"
                ? "config"
                : t.pageId,
        title: t.title,
        subtitle: t.subtitle,
        contextKey: t.contextKey,
        dirty: false,
        payloadConsumed: true,
        pageState: t.pageState,
      }))
      .filter((t) => !EPHEMERAL_TAB_PAGES.has(t.pageId));
    if (!mapped.length) return false;
    tabs.value = mapped;
    const active = snapshot.activeTabId && getTab(snapshot.activeTabId);
    activeTabId.value = active ? snapshot.activeTabId : tabs.value[0].id;
    return true;
  }

  function exportSession(
    pageStates: Record<string, Record<string, unknown> | undefined>,
  ): WorkbenchSessionSnapshot {
    const persistent = tabs.value.filter((t) => !EPHEMERAL_TAB_PAGES.has(t.pageId));
    let activeId = activeTabId.value;
    if (!persistent.some((t) => t.id === activeId)) {
      activeId = persistent[0]?.id ?? "";
    }
    return {
      version: 1,
      activeTabId: activeId,
      tabs: persistent.map((t) => ({
        id: t.id,
        pageId: t.pageId,
        title: t.title,
        subtitle: t.subtitle,
        contextKey: t.contextKey,
        pageState: pageStates[t.id],
      })),
    };
  }

  return {
    tabs,
    activeTabId,
    activePageId,
    tabBarTabs,
    showTabBar,
    pagePolicy,
    getTab,
    activeTab,
    openTab,
    navigateToPage,
    openNewTabForPage,
    activateTab,
    updateTab,
    setTabDirty,
    consumeTabPayload,
    canOpenNewTab,
    closeTab,
    closeAllTabs,
    toolTabDirtyTitles,
    discardAllToolTabs,
    ensureInitialTab,
    consumeTabPageState,
    restoreSession,
    exportSession,
    basename,
  };
}

export type WorkbenchContext = ReturnType<typeof createWorkbench>;
