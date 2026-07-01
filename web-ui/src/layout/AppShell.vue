<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue";
import AppToolbar from "./AppToolbar.vue";
import RibbonShell from "./ribbon/RibbonShell.vue";
import { useRibbonTabs } from "./ribbon/useRibbonTabs";
import StatusBar from "./StatusBar.vue";
import WorkspaceTreeSidebar from "./WorkspaceTreeSidebar.vue";
import FileWorksetPanel from "../components/FileWorksetPanel.vue";
import HomePage from "../pages/HomePage.vue";
import WelcomePage from "../pages/WelcomePage.vue";
import ConfigPage from "../pages/ConfigPage.vue";
import FileDetailPage from "../pages/FileDetailPage.vue";
import FcstdMapPage from "../pages/FcstdMapPage.vue";
import XlinkFixPage from "../pages/XlinkFixPage.vue";
import PartDedupPage from "../pages/PartDedupPage.vue";
import StepBatchPage from "../pages/StepBatchPage.vue";
import SwStepExportPage from "../pages/SwStepExportPage.vue";
import ReorderMembersPage from "../pages/ReorderMembersPage.vue";
import CodeIndexPage from "../pages/CodeIndexPage.vue";
import CodeIgnorePage from "../pages/CodeIgnorePage.vue";
import CodeRenamePage from "../pages/CodeRenamePage.vue";
import CodeUuidReplacePage from "../pages/CodeUuidReplacePage.vue";
import PartCatalogPage from "../pages/PartCatalogPage.vue";
import PartKeyDetailPage from "../pages/PartKeyDetailPage.vue";
import FileRenamePage from "../pages/FileRenamePage.vue";
import BomExportPage from "../pages/BomExportPage.vue";
import UnitTestsPage from "../pages/UnitTestsPage.vue";
import TestFixturesPage from "../pages/TestFixturesPage.vue";
import GitPage from "../pages/GitPage.vue";
import CaaDialogEditorPage from "../pages/CaaDialogEditorPage.vue";
import CaaDialogHomePage from "../pages/CaaDialogHomePage.vue";
import WorkbenchIdlePage from "../pages/WorkbenchIdlePage.vue";
import PlaceholderPage from "../pages/PlaceholderPage.vue";
import { pnwSideDockVisibility } from "phoenix-wing";
import { pnwBindPointerDrag } from "phoenix-wing";
import { fetchPhoenixDatabaseStatus, recreatePhoenixDatabase } from "../api";
import { provideAppShell } from "../composables/useAppShell";
import { isCaaEditorPage } from "../constants/caaPages";
import { WORKBENCH_IDLE_PAGE } from "../constants/workbench";
import { usePnwDocumentTitle } from "phoenix-wing";
import { useWorkspaceSwitcher } from "../composables/useWorkspaceSwitcher";
import ChoiceDialogHost from "phoenix-wing/components/PnwChoiceDialogHost.vue";
import GitDiffPreviewHost from "../components/git/GitDiffPreviewHost.vue";
import CaaRelatedFilePreviewHost from "../components/caa/CaaRelatedFilePreviewHost.vue";
import AppModalOverlay from "phoenix-wing/components/PnwAppModalOverlay.vue";
import AsyncProgressOverlay from "phoenix-wing/components/PnwAsyncProgressOverlay.vue";

const shell = provideAppShell();
const { workspacePath, workspaceShort } = useWorkspaceSwitcher(shell);
const loading = ref(true);
const loadError = ref("");
const legacyDbBanner = ref(false);
const legacyDbReasons = ref<string[]>([]);
const legacyDbRecreating = ref(false);
const legacyDbError = ref("");

const activeTab = computed(() => shell.activeTab());

const isWelcomeFullscreen = computed(() => shell.currentPage.value === "welcome");

const ribbonCollapsed = ref(false);

const shellLayout = computed(() => shell.shellLayout.value);
const navigation = computed(() => shell.appConfig.value?.navigation ?? []);

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

const dockVis = computed(() =>
  pnwSideDockVisibility(shellLayout.value, {
    onGitPage: shell.currentPage.value === "git",
    onCaaPage: isCaaEditorPage(shell.currentPage.value),
  }),
);

const leftPanelWidth = computed(() => `${shellLayout.value.left_panel_width_px}px`);
const rightPanelWidth = computed(() => `${shellLayout.value.right_panel_width_px}px`);

const mainMargins = computed(() => ({
  marginLeft: dockVis.value.leftVisible ? leftPanelWidth.value : undefined,
  marginRight: dockVis.value.rightVisible ? rightPanelWidth.value : undefined,
}));

const PAGE_COMPONENTS: Record<string, Component> = {
  home: HomePage,
  config: ConfigPage,
  git: GitPage,
  bom_apply: FileDetailPage,
  file_detail: FileDetailPage,
  file_rename: FileRenamePage,
  rename_analysis: FileRenamePage,
  fcstd_map: FcstdMapPage,
  part_catalog: PartCatalogPage,
  part_key_detail: PartKeyDetailPage,
  xlink_fix: XlinkFixPage,
  part_dedup: PartDedupPage,
  step_batch: StepBatchPage,
  sw_step_export: SwStepExportPage,
  reorder_members: ReorderMembersPage,
  code_index: CodeIndexPage,
  code_ignore: CodeIgnorePage,
  code_rename: CodeRenamePage,
  code_uuid: CodeUuidReplacePage,
  bom_export: BomExportPage,
  unit_tests: UnitTestsPage,
  test_fixtures: TestFixturesPage,
  caa_dialog_home: CaaDialogHomePage,
  caa_dialog: CaaDialogEditorPage,
};

function pageComponent(pageId: string): Component {
  return PAGE_COMPONENTS[pageId] ?? PlaceholderPage;
}

function onRibbonOpen(pageId: string) {
  shell.goToPage(pageId);
}

function onResizeStart(e: PointerEvent, side: "left" | "right") {
  const widthKey = side === "left" ? "left_panel_width_px" : "right_panel_width_px";
  const startX = e.clientX;
  const startW = shell.shellLayout.value[widthKey];

  pnwBindPointerDrag(e, {
    cursor: "col-resize",
    onMove(ev) {
      const delta = side === "right" ? startX - ev.clientX : ev.clientX - startX;
      const next = Math.min(560, Math.max(160, startW + delta));
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
    legacyDbError.value = "";
  } catch (e) {
    legacyDbError.value = String(e);
  }
}

async function confirmRecreateLegacyDatabase() {
  const ok = window.confirm(
    "将删除当前工作空间数据库并创建空的 phoenix-workspace.sqlite（schema v10）。\n"
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
        <strong>检测到旧版 CAD 数据库</strong>
        <span>（旧库文件名或旧表名）。需重建为 phoenix-workspace.sqlite 后才能继续使用索引与 BOM 功能。</span>
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
    <RibbonShell
      v-if="!isWelcomeFullscreen"
      :active-tab-def="ribbonActiveTabDef"
      :collapsed="ribbonCollapsed"
      :navigation="navigation"
      :current-page="shell.currentPage.value"
      :can-open="(p) => shell.canNavigateToPage(p)"
      @open="onRibbonOpen"
    />
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
              v-if="activeTab"
              :key="activeTab.id"
              :is="pageComponent(activeTab.pageId)"
              :workbench-tab-id="activeTab.id"
            />
            <WorkbenchIdlePage v-else key="workbench-idle" />
          </KeepAlive>
        </div>
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
        :show-caa-tree="dockVis.leftShowCaaTree"
        :show-log="dockVis.leftShowLog"
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
        :show-log="dockVis.rightShowLog"
        :show-props="dockVis.rightShowProps"
        :show-git-commit="dockVis.rightShowGitCommit"
        :show-workset-block="dockVis.rightShowWorkset"
      />
    </div>

    <StatusBar v-if="!isWelcomeFullscreen" />
    <ChoiceDialogHost />
    <GitDiffPreviewHost />
    <CaaRelatedFilePreviewHost />
    <AppModalOverlay
      :open="shell.configOverlayOpen.value"
      aria-label="配置"
      panel-class="config-modal-panel"
      @close="shell.closeConfig()"
    >
      <ConfigPage />
    </AppModalOverlay>
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
