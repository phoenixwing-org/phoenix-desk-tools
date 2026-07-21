<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch, type Component } from "vue";
import AppToolbar from "./AppToolbar.vue";
import PnwRibbonShell from "phoenix-wing/layout/PnwRibbonShell.vue";
import RibbonPanel from "./ribbon/RibbonPanel.vue";
import { useRibbonTabs } from "./ribbon/useRibbonTabs";
import { useUiPrefsStore } from "../stores/uiPrefs";
import StatusBar from "./StatusBar.vue";
import WorkspaceTreeSidebar from "./WorkspaceTreeSidebar.vue";
import WelcomePage from "../pages/WelcomePage.vue";
import WorkbenchIdlePage from "../pages/WorkbenchIdlePage.vue";
import WorkbenchViewLoadingPage from "./WorkbenchViewLoadingPage.vue";
import PlaceholderPage from "../pages/PlaceholderPage.vue";
import { PAGE_COMPONENTS, preloadPageComponent } from "./pageRegistry";
import { createAsyncViewSwitchController } from "./asyncViewSwitch";
import { isPageSideBlockOpen } from "../composables/usePageSideBlockVisibility";
import { pnwBindPointerDrag } from "phoenix-wing";
import { fetchPhoenixDatabaseStatus, recreatePhoenixDatabase } from "../api";
import { provideAppShell } from "../composables/useAppShell";
import { WORKBENCH_IDLE_PAGE } from "../constants/workbench";
import { usePnwDocumentTitle } from "phoenix-wing";
import { useWorkspaceSwitcher } from "../composables/useWorkspaceSwitcher";
import ChoiceDialogHost from "phoenix-wing/components/PnwChoiceDialogHost.vue";
import GitDiffPreviewHost from "../components/git/GitDiffPreviewHost.vue";
import CaaRelatedFilePreviewHost from "../components/caa/CaaRelatedFilePreviewHost.vue";
import AsyncProgressOverlay from "phoenix-wing/components/PnwAsyncProgressOverlay.vue";
import GlobalWorkbenchBottomPanel from "../components/workbench/GlobalWorkbenchBottomPanel.vue";
import type { WorkbenchTab } from "../types/workbench";

const shell = provideAppShell();
const { workspacePath, workspaceShort } = useWorkspaceSwitcher(shell);
const loading = ref(true);
const loadError = ref("");
const legacyDbBanner = ref(false);
const legacyDbReasons = ref<string[]>([]);
const legacyDbRecreating = ref(false);
const legacyDbError = ref("");
const legacyDbExpectedSchema = ref(13);

const uiPrefs = useUiPrefsStore();
const activeTab = computed(() => shell.activeTab());
const displayedTab = shallowRef<WorkbenchTab>();
const pendingViewLabel = ref("");
const viewLoadError = ref("");

const viewSwitch = createAsyncViewSwitchController<WorkbenchTab>({
  load: preloadPageComponent,
  onState(state) {
    displayedTab.value = state.displayed;
    pendingViewLabel.value = state.pending?.title ?? state.pending?.pageId ?? "";
    viewLoadError.value = state.error;
  },
  onError(target, message) {
    shell.appendLog(`[Workbench][View] ${target.pageId} 加载失败：${message}`, { source: "workbench" });
  },
});

watch(activeTab, (tab) => {
  void viewSwitch.select(tab);
}, { immediate: true });

const isWelcomeFullscreen = computed(() => shell.currentPage.value === "welcome");

const ribbonCollapsed = ref(false);
const ribbonLayout = computed(() => uiPrefs.ribbonLayoutMode === "inline" ? "inline" : "stacked");

const shellLayout = computed(() => shell.shellLayout.value);
const navigation = computed(() => shell.appConfig.value?.navigation ?? []);
const activePageBlockId = computed(() => isPageSideBlockOpen(shell.currentPage.value)
  ? shell.currentPage.value
  : "");

const pageLabel = computed(() => {
  const page = shell.currentPage.value;
  if (page === "welcome" || page === WORKBENCH_IDLE_PAGE) return "";
  return navigation.value.find((n) => n.page === page)?.label;
});

usePnwDocumentTitle({ workspaceShort, workspacePath, pageLabel });

const { activeTab: ribbonActiveTab, visibleTabs: ribbonVisibleTabs, activeTabDef: ribbonActiveTabDef } =
  useRibbonTabs({
    navigation,
    currentPage: computed(() => shell.currentPage.value),
    enabledModules: computed(() => shell.enabledNavModules.value),
    workbenchFocusScope: shell.workbenchFocusScope,
  });

watch(ribbonActiveTab, () => {
  if (ribbonCollapsed.value) ribbonCollapsed.value = false;
});

watch(ribbonActiveTab, (tabId) => {
  if (shell.currentPage.value !== WORKBENCH_IDLE_PAGE) return;
  if (tabId === "cad") shell.workbenchFocusScope.value = "cad";
  else if (tabId === "code") shell.workbenchFocusScope.value = "code";
  else shell.workbenchFocusScope.value = "all";
});

const dockVis = computed(() => {
  const layout = shellLayout.value;
  const rightShowTree = layout.right_panel_open;
  const rightShowProps = layout.properties_panel_open;
  const rightShowGitCommit = shell.currentPage.value === "git" && layout.git_commit_panel_open;
  const rightShowWorkset = layout.workset_panel_open;
  return {
    // 左栏只承载页面贡献的 VS Code 式 Block；系统块统一固定在右栏。
    leftVisible: Boolean(activePageBlockId.value),
    leftShowTree: false,
    leftShowLog: false,
    leftShowProps: false,
    leftShowGitCommit: false,
    leftShowWorkset: false,
    leftPageBlockId: activePageBlockId.value,
    rightShowTree,
    // 运行日志只允许出现在 AppShell 的全局底部面板。
    rightShowLog: false,
    rightShowProps,
    rightShowGitCommit,
    rightShowWorkset,
    rightVisible: Boolean(
      rightShowTree
      || rightShowProps
      || rightShowGitCommit
      || rightShowWorkset
    ),
  };
});

const leftPanelWidth = computed(() => `${shellLayout.value.left_panel_width_px}px`);
const rightPanelWidth = computed(() => `${shellLayout.value.right_panel_width_px}px`);

const mainMargins = computed(() => ({
  marginLeft: dockVis.value.leftVisible ? leftPanelWidth.value : undefined,
  marginRight: dockVis.value.rightVisible ? rightPanelWidth.value : undefined,
}));

function pageComponent(pageId: string): Component {
  return PAGE_COMPONENTS[pageId] ?? PlaceholderPage;
}

function onRibbonOpen(pageId: string) {
  shell.goToPage(pageId);
}

function retryActiveView(): void {
  void viewSwitch.select(activeTab.value);
}

function onResizeStart(e: PointerEvent, side: "left" | "right") {
  const widthKey = side === "left" ? "left_panel_width_px" : "right_panel_width_px";
  const startX = e.clientX;
  const startW = shell.shellLayout.value[widthKey];
  const minWidth = side === "left" ? 240 : 220;

  pnwBindPointerDrag(e, {
    cursor: "col-resize",
    onMove(ev) {
      const delta = side === "right" ? startX - ev.clientX : ev.clientX - startX;
      const next = Math.min(560, Math.max(minWidth, startW + delta));
      shell.shellLayout.value[widthKey] = next;
    },
    onEnd() {
      void shell.persistShellLayout({
        [widthKey]: shell.shellLayout.value[widthKey],
      });
    },
  });
}

async function refreshLegacyDatabaseBanner() {
  try {
    const status = await fetchPhoenixDatabaseStatus();
    legacyDbBanner.value = status.needs_recreate;
    legacyDbReasons.value = status.reasons;
    legacyDbExpectedSchema.value = status.expected_schema_version;
    legacyDbError.value = "";
  } catch (e) {
    legacyDbError.value = String(e);
  }
}

async function confirmRecreateLegacyDatabase() {
  const ok = window.confirm(
    `将删除当前工作空间数据库并创建空的 phoenix-workspace.sqlite（schema v${legacyDbExpectedSchema.value}）。\n`
      + "遗留文件（cad-database.sqlite / phoenix-cad.sqlite）与含旧表名的库也会被清除。\n"
      + "CAD 索引、BOM 引用与改名历史需重新扫描。\n\n确定继续？",
  );
  if (!ok) return;
  legacyDbRecreating.value = true;
  legacyDbError.value = "";
  try {
    await recreatePhoenixDatabase();
    window.location.reload();
  } catch (e) {
    legacyDbError.value = String(e);
  } finally {
    legacyDbRecreating.value = false;
  }
}

onMounted(async () => {
  try {
    await shell.init();
    await refreshLegacyDatabaseBanner();
  } catch (e) {
    loadError.value = String(e);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  viewSwitch.cancel();
  for (const tab of shell.tabs.value) {
    shell.registerPageMessages(tab.id, null);
  }
});
</script>

<template>
  <div v-if="loading" class="shell-loading">载入中…</div>
  <div v-else-if="loadError" class="shell-loading err">{{ loadError }}</div>
  <div v-else class="shell" :class="{ 'shell-welcome': isWelcomeFullscreen }">
    <div v-if="legacyDbBanner && !isWelcomeFullscreen" class="legacy-db-banner" role="alert">
      <div class="legacy-db-banner-text">
        <strong>工作空间数据库需要重建</strong>
        <span>检测到旧文件、旧表或 schema 版本不匹配。重建后才能继续使用索引与 BOM 功能。</span>
        <span v-if="legacyDbReasons.length" class="legacy-db-reasons">{{ legacyDbReasons.join(" · ") }}</span>
        <span v-if="legacyDbError" class="legacy-db-error">{{ legacyDbError }}</span>
      </div>
      <button
        type="button"
        class="legacy-db-action"
        :disabled="legacyDbRecreating"
        @click="confirmRecreateLegacyDatabase"
      >
        {{ legacyDbRecreating ? "重建中…" : "确认重建数据库" }}
      </button>
    </div>
    <AppToolbar
      v-if="!isWelcomeFullscreen"
      :ribbon-tabs="ribbonVisibleTabs"
      v-model:ribbon-active-tab="ribbonActiveTab"
      v-model:ribbon-collapsed="ribbonCollapsed"
    />
    <PnwRibbonShell
      v-if="!isWelcomeFullscreen"
      :collapsed="ribbonCollapsed"
      :layout="ribbonLayout"
      @update:layout="(v) => uiPrefs.setRibbonLayoutMode(v === 'inline' ? 'inline' : 'grouped')"
    >
      <RibbonPanel
        v-if="!ribbonCollapsed && ribbonActiveTabDef"
        :tab="ribbonActiveTabDef"
        :navigation="navigation"
        :current-page="shell.currentPage.value"
        :can-open="(p) => shell.canNavigateToPage(p)"
        @open="onRibbonOpen"
      />
    </PnwRibbonShell>
    <div class="shell-body" :class="{ 'shell-body-welcome': isWelcomeFullscreen }">
      <!-- 左栏 NavSidebar（快捷栏）默认不渲染；日后可能迁入工作空间树，见 layout/NavSidebar.vue -->
      <main
        class="shell-main"
        :class="{ 'shell-main-welcome': isWelcomeFullscreen }"
        :style="isWelcomeFullscreen ? undefined : mainMargins"
      >
        <div class="shell-pages" :class="{ 'shell-pages-welcome': isWelcomeFullscreen }" data-tour="main-content">
          <WelcomePage v-if="isWelcomeFullscreen" />
          <KeepAlive v-else :max="24">
            <component
              v-if="displayedTab"
              :key="displayedTab.id"
              :is="pageComponent(displayedTab.pageId)"
              :workbench-tab-id="displayedTab.id"
            />
            <WorkbenchViewLoadingPage
              v-else-if="activeTab"
              key="workbench-view-loading"
              :label="pendingViewLabel || activeTab.title"
              :error="viewLoadError"
              @retry="retryActiveView"
            />
            <WorkbenchIdlePage v-else key="workbench-idle" />
          </KeepAlive>
          <div v-if="pendingViewLabel && displayedTab" class="view-switch-indicator" role="status">
            正在准备 {{ pendingViewLabel }}…
          </div>
          <div v-if="viewLoadError && displayedTab" class="view-switch-error" role="alert">
            <span>View 加载失败：{{ viewLoadError }}</span>
            <button type="button" @click="retryActiveView">重试</button>
          </div>
        </div>
        <GlobalWorkbenchBottomPanel v-if="!isWelcomeFullscreen" />
      </main>
      <div
        v-if="!isWelcomeFullscreen && dockVis.leftVisible"
        class="shell-resizer shell-resizer-left"
        :style="{ left: leftPanelWidth }"
        title="拖拽调节宽度"
        @pointerdown="onResizeStart($event, 'left')"
      />
      <WorkspaceTreeSidebar
        v-if="!isWelcomeFullscreen && dockVis.leftVisible"
        dock-side="left"
        :show-tree="dockVis.leftShowTree"
        :page-block-id="dockVis.leftPageBlockId"
        :page-block-tab-id="activeTab?.id ?? ''"
        :show-props="dockVis.leftShowProps"
        :show-git-commit="dockVis.leftShowGitCommit"
        :show-workset-block="dockVis.leftShowWorkset"
      />
      <div
        v-if="!isWelcomeFullscreen && dockVis.rightVisible"
        class="shell-resizer shell-resizer-right"
        :style="{ right: rightPanelWidth }"
        title="拖拽调节宽度"
        @pointerdown="onResizeStart($event, 'right')"
      />
      <WorkspaceTreeSidebar
        v-if="!isWelcomeFullscreen && dockVis.rightVisible"
        dock-side="right"
        :show-tree="dockVis.rightShowTree"
        page-block-id=""
        page-block-tab-id=""
        :show-props="dockVis.rightShowProps"
        :show-git-commit="dockVis.rightShowGitCommit"
        :show-workset-block="dockVis.rightShowWorkset"
      />
    </div>

    <StatusBar v-if="!isWelcomeFullscreen" />
    <ChoiceDialogHost />
    <GitDiffPreviewHost />
    <CaaRelatedFilePreviewHost />
    <AsyncProgressOverlay />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--shell-bg);
}

.legacy-db-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: #fef3c7;
  border-bottom: 1px solid #f59e0b;
  color: #92400e;
  font-size: 13px;
}

.legacy-db-banner-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.legacy-db-reasons,
.legacy-db-error {
  font-size: 12px;
  opacity: 0.9;
}

.legacy-db-error {
  color: #b45309;
}

.legacy-db-action {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid #d97706;
  border-radius: 6px;
  background: #fff;
  color: #92400e;
  cursor: pointer;
  font-size: 13px;
}

.legacy-db-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.shell-loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--phoenix-text-muted);
}

.shell-loading.err {
  color: var(--phoenix-warning-text);
  padding: 24px;
  text-align: center;
}

.shell-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.shell-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
  transition: margin-left 0.15s ease, margin-right 0.15s ease;
}

.shell-pages {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--page-bg);
}

.view-switch-indicator,
.view-switch-error {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, calc(100% - 24px));
  padding: 6px 10px;
  border: 1px solid var(--phoenix-border);
  border-radius: var(--phoenix-radius-sm);
  background: var(--phoenix-bg-elevated);
  box-shadow: var(--phoenix-shadow-sm);
  color: var(--phoenix-text-muted);
  font-size: 12px;
}

.view-switch-error {
  border-color: var(--phoenix-warning-border);
  color: var(--phoenix-warning-text);
}

.view-switch-error button {
  padding: 2px 8px;
  border: 1px solid currentColor;
  border-radius: var(--phoenix-radius-sm);
  background: transparent;
  color: inherit;
}

.shell-pages :deep(> .page),
.shell-pages :deep(> div) {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
}

/* 页内自管滚动（如 Git：固定 PageHeader，仅 body 区滚动） */
.shell-pages :deep(> .page.git-page) {
  min-height: 0;
  overflow: hidden;
}

.shell-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 5;
  background: transparent;
}

.shell-resizer-right {
  margin-right: -3px;
}

.shell-resizer-left {
  margin-left: -3px;
}

.shell-resizer:hover {
  background: rgba(59, 130, 246, 0.25);
}

.shell-welcome {
  background: var(--phoenix-bg-welcome-rail);
}

.shell-body-welcome {
  flex: 1;
  min-height: 0;
}

.shell-main-welcome {
  background: transparent;
}

.shell-pages-welcome {
  overflow: hidden;
}

.shell-pages-welcome :deep(> div) {
  overflow: hidden;
}

/* 工作集独立面板 */
.ws-workset-panel {
  position: absolute;
  top: 0;
  bottom: 32px;
  display: flex;
  flex-direction: column;
  background: var(--phoenix-bg-toolbar, #fff);
  border-left: 1px solid var(--phoenix-border, #e5e7eb);
  z-index: 10;
  overflow: hidden;
}

.ws-panel-head {
  padding: 6px 10px;
  font-size: 0.75rem;
  font-weight: 600;
  border-bottom: 1px solid var(--phoenix-border, #e5e7eb);
  flex-shrink: 0;
}

.ws-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
</style>

<style>
/* 配置弹层内容区（非 scoped，作用于 ConfigPage 根节点） */
.config-modal-panel .config-page {
  padding: 20px 24px 28px;
  box-sizing: border-box;
}
</style>
