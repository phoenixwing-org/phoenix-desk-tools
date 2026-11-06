import { computed, ref, type Ref } from "vue";
import type { AppConfig } from "../types/config";
import { CAA_EDITOR_PAGE_ID, CAA_HOME_PAGE_ID } from "../constants/caaPages";
import { CODE_PAGE_FALLBACK, RETIRED_CODE_PAGE_IDS } from "../constants/retiredCodePages";
import type { OpenTabOptions, PageTabPolicy, WorkbenchSessionSnapshot, WorkbenchTab, WorkbenchTabPayload } from "../types/workbench";
import { getPageSession } from "./usePageSession";
import { confirmCloseAllTabs, confirmDirtyTabClose } from "./tabCloseConfirm";

let tabSeq = 0;

/** 不落盘、不参与 session 恢复的 Tab 页（欢迎页另有全屏层） */
const EPHEMERAL_TAB_PAGES = new Set(["welcome", "home", "config"]);
const PREVIEW_TAB_PAGES = new Set(["file_detail", "part_key_detail"]);

function newTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now()}-${tabSeq}`;
}

function basename(path: string): string {
  const s = path.replace(/\\/g, "/").trim();
  return s.split("/").pop() ?? s;
}

export function createWorkbench(
  appConfig: Ref<AppConfig | null>,
  options: { onTabLimit?: (message: string) => void } = {},
) {
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
    const { pageId, title, subtitle, contextKey, payload, forceNew, preview: requestedPreview } = RETIRED_CODE_PAGE_IDS.has(opts.pageId)
      ? { pageId: CODE_PAGE_FALLBACK }
      : opts;
    if (pageId === "welcome") {
      throw new Error("欢迎页不在 Tab 工作台中");
    }
    const { maxTabs } = pagePolicy(pageId);
    const existing = findTabsForPage(pageId);
    const preview = requestedPreview === true && PREVIEW_TAB_PAGES.has(pageId);
    // Preview navigation must never retarget an existing permanent detail tab.
    if (requestedPreview !== undefined && contextKey) {
      const same = existing.find(tab => tab.contextKey === contextKey);
      if (same) {
        if (!preview) keepTab(same.id);
        activeTabId.value = same.id;
        return same.id;
      }
    }
    let replaced: WorkbenchTab | undefined;
    if (preview) {
      for (const candidate of tabs.value.filter(tab => tab.preview)) {
        const api = getPageSession(candidate.id);
        // Restored snapshots and in-flight writes are never silently discarded.
        if (candidate.dirty || candidate.pageState || api?.isDirty() || api?.isBusy?.()) {
          keepTab(candidate.id);
        } else {
          replaced = candidate;
          break;
        }
      }
    }

    if (requestedPreview === undefined && !forceNew && maxTabs === 1 && existing.length) {
      const tab = existing[0];
      if (title) tab.title = title;
      if (subtitle !== undefined) tab.subtitle = subtitle;
      if (contextKey) tab.contextKey = contextKey;
      applyPayload(tab, payload);
      activeTabId.value = tab.id;
      return tab.id;
    }

    if (requestedPreview === undefined && !forceNew && existing.length) {
      const tab = existing[existing.length - 1];
      if (payload) applyPayload(tab, payload);
      activeTabId.value = tab.id;
      return tab.id;
    }

    if (existing.length - (replaced?.pageId === pageId ? 1 : 0) >= maxTabs) {
      const message = `${navLabel(pageId)}已打开 ${existing.length} / ${maxTabs} 个视图，无法打开新视图。请先关闭部分视图后重试。`;
      options.onTabLimit?.(message);
      throw new Error(message);
    }

    const tab: WorkbenchTab = {
      id: newTabId(),
      pageId,
      title: title ?? navLabel(pageId),
      subtitle,
      contextKey,
      dirty: false,
      preview,
      payload,
      payloadConsumed: false,
    };
    if (replaced) tabs.value.splice(tabs.value.indexOf(replaced), 1, tab);
    else tabs.value.push(tab);
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

  function keepTab(tabId: string): void {
    const tab = getTab(tabId);
    if (tab) tab.preview = false;
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
    if (patch.dirty !== undefined) {
      tab.dirty = patch.dirty;
      if (patch.dirty) keepTab(tabId);
    }
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
    if (RETIRED_CODE_PAGE_IDS.has(pageId)) return false;
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
    if (api?.requestClose) {
      if (!await api.requestClose()) return false;
    } else if (dirty) {
      const choice = await confirmDirtyTabClose(tab.title, Boolean(api?.flush));
      if (choice === "cancel") return false;
      if (choice === "flush" && api?.flush) {
        const ok = await api.flush();
        if (!ok) return false;
        tab.dirty = false;
      }
    }
    // A page-owned modal/save may outlive another close or a context change.
    const closingIndex = tabs.value.indexOf(tab);
    if (closingIndex < 0 || getPageSession(tabId) !== api || api?.isBusy?.()) return false;
    tabs.value.splice(closingIndex, 1);
    if (activeTabId.value === tabId) {
      const next = tabs.value[closingIndex] ?? tabs.value[closingIndex - 1] ?? tabs.value[0];
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
    const retiredCadPage = (pageId: string) => pageId === "fcstd_map" || pageId === "bom_export";
    const hasCurrentPartCatalog = snapshot.tabs.some((tab) => tab.pageId === "part_catalog");
    const sourceTabs = hasCurrentPartCatalog
      ? snapshot.tabs.filter((tab) => !retiredCadPage(tab.pageId))
      : snapshot.tabs;
    const hasCodeFallback = sourceTabs.some((tab) => tab.pageId === CODE_PAGE_FALLBACK);
    const mapped = sourceTabs
      .filter((tab) => !hasCodeFallback || !RETIRED_CODE_PAGE_IDS.has(tab.pageId))
      .map((t) => ({
        id: t.id,
        pageId:
          RETIRED_CODE_PAGE_IDS.has(t.pageId)
            ? CODE_PAGE_FALLBACK
            : t.pageId === "rename_analysis"
              ? "file_rename"
              : t.pageId === "bom_apply"
                ? "file_detail"
                : retiredCadPage(t.pageId)
                  ? "part_catalog"
                  : t.pageId === "home" && t.title === "配置"
                    ? "config"
                    : t.pageId,
        title: RETIRED_CODE_PAGE_IDS.has(t.pageId)
          ? navLabel(CODE_PAGE_FALLBACK)
          : retiredCadPage(t.pageId) ? "零件目录" : t.title,
        subtitle: RETIRED_CODE_PAGE_IDS.has(t.pageId) ? undefined : t.subtitle,
        contextKey: RETIRED_CODE_PAGE_IDS.has(t.pageId) ? undefined : t.contextKey,
        dirty: false,
        payloadConsumed: true,
        pageState: retiredCadPage(t.pageId) || RETIRED_CODE_PAGE_IDS.has(t.pageId) ? undefined : t.pageState,
      }))
      .filter((t) => !EPHEMERAL_TAB_PAGES.has(t.pageId))
      .filter((tab, index, all) =>
        tab.pageId !== "part_catalog" || all.findIndex((candidate) => candidate.pageId === "part_catalog") === index,
      )
      .filter((tab, index, all) =>
        tab.pageId !== CODE_PAGE_FALLBACK || all.findIndex((candidate) => candidate.pageId === CODE_PAGE_FALLBACK) === index,
      );
    if (!mapped.length) return false;
    tabs.value = mapped;
    const active = snapshot.activeTabId ? getTab(snapshot.activeTabId) : undefined;
    const activeWasRetired = snapshot.tabs.some((tab) => tab.id === snapshot.activeTabId && RETIRED_CODE_PAGE_IDS.has(tab.pageId));
    activeTabId.value = active?.id
      ?? (activeWasRetired ? tabs.value.find((tab) => tab.pageId === CODE_PAGE_FALLBACK)?.id : undefined)
      ?? tabs.value[0].id;
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
        // An unmounted restored page has no serializer yet. Keep its unconsumed
        // snapshot unless the caller explicitly supplies a new value (including undefined).
        pageState: Object.prototype.hasOwnProperty.call(pageStates, t.id) ? pageStates[t.id] : t.pageState,
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
    keepTab,
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
