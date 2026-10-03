<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch, type Component } from "vue";
import {
  PnwDockablePrimarySection,
  PnwDockableToolWindow,
  PnwIcon,
  PnwWorkbenchShell,
  PnwPhoenixWingMark,
  pnwNormalizeDockableToolState,
  pnwNavigationFromRibbonTabs,
  type PnwDockableToolState,
  type PnwNavigationNode,
  type PnwViewBlockId,
  type PnwWorkbenchDisplayPreferences,
} from "phoenix-wing";
import { useUiPrefsStore } from "../stores/uiPrefs";
import StatusBar from "./StatusBar.vue";
import WorkspaceTreeSidebar from "./WorkspaceTreeSidebar.vue";
import WelcomePage from "../pages/WelcomePage.vue";
import WorkbenchViewLoadingPage from "./WorkbenchViewLoadingPage.vue";
import PlaceholderPage from "../pages/PlaceholderPage.vue";
import { PAGE_COMPONENTS, preloadPageComponent } from "./pageRegistry";
import { pageSideBlockComponent } from "./pageSideBlockRegistry";
import { createAsyncViewSwitchController } from "./asyncViewSwitch";
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
import { usePdtWorkbenchBottomPanel } from "../composables/usePdtWorkbenchBottomPanel";
import { buildRibbonTabs } from "./ribbon/ribbonConfig";
import { ribbonIconFor } from "./ribbon/ribbonIcons";
import GiteeIcon from "../components/icons/GiteeIcon.vue";
import { PROJECT_GITEE_HOME } from "../constants/projectLinks";
import { pdtWithWorkbenchLayoutState } from "../workbench/PdtWorkbenchDisplayPreferences";
import type { WorkbenchTab } from "../types/workbench";
import WorkspaceDockableToolContent from "../components/workspace/WorkspaceDockableToolContent.vue";
import {
  PDT_WORKSPACE_TOOL_DEFINITION,
  PDT_WORKSPACE_TOOL_STATE_KEY,
  pdtCreateWorkspaceToolState,
  pdtToggleWorkspaceTool,
} from "../workbench/pdtWorkspaceDockableTool";

const shell = provideAppShell();
const { workspacePath, workspaceShort } = useWorkspaceSwitcher(shell);
const loading = ref(true);
const loadError = ref("");
const legacyDbBanner = ref(false);
const legacyDbReasons = ref<string[]>([]);
const legacyDbRecreating = ref(false);
const legacyDbError = ref("");
const legacyDbExpectedSchema = ref(13);

function readWorkspaceToolState(): PnwDockableToolState {
  try {
    const stored = localStorage.getItem(PDT_WORKSPACE_TOOL_STATE_KEY);
    if (stored) return pnwNormalizeDockableToolState(JSON.parse(stored));
  } catch {
    /* 使用安全默认值 */
  }
  return pdtCreateWorkspaceToolState();
}

const workspaceToolState = ref<PnwDockableToolState>(readWorkspaceToolState());

function updateWorkspaceToolState(next: PnwDockableToolState): void {
  workspaceToolState.value = pnwNormalizeDockableToolState(next);
}

function toggleWorkspaceTool(): void {
  updateWorkspaceToolState(pdtToggleWorkspaceTool(workspaceToolState.value));
}

watch(workspaceToolState, (state) => {
  try {
    localStorage.setItem(PDT_WORKSPACE_TOOL_STATE_KEY, JSON.stringify(state));
  } catch {
    /* Host 禁用 storage 时仅保留当前 session 状态 */
  }
}, { deep: true });

const uiPrefs = useUiPrefsStore();
const pnwBottomPanel = usePdtWorkbenchBottomPanel(shell);
const activeTab = computed(() => shell.activeTab());
const pnwActiveBottomTabId = ref("output");
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

const shellLayout = computed(() => shell.shellLayout.value);
const navigation = computed(() => shell.appConfig.value?.navigation ?? []);
// 与旧 useRibbonTabs 一致：系统页始终保留，受模块开关控制的页面不进入 Pnw 单一导航树。
const pnwVisibleNavigation = computed(() => navigation.value.filter((item) =>
  !item.module || shell.enabledNavModules.value.includes(item.module),
));
const pnwNavigationNodes = computed(() => pnwNavigationFromRibbonTabs(
  buildRibbonTabs(pnwVisibleNavigation.value),
  { iconFor: ribbonIconFor },
));
const pnwExpandedNodeIds = ref<readonly string[]>([]);
const activePageBlockComponent = computed(() => pageSideBlockComponent(shell.currentPage.value));

const pageLabel = computed(() => {
  const page = shell.currentPage.value;
  if (page === "welcome" || page === WORKBENCH_IDLE_PAGE) return "";
  return navigation.value.find((n) => n.page === page)?.label;
});

usePnwDocumentTitle({ workspaceShort, workspacePath, pageLabel });

const dockVis = computed(() => {
  const layout = shellLayout.value;
  const rightShowTree = layout.right_panel_open;
  const rightShowProps = layout.properties_panel_open;
  const rightShowGitCommit = shell.currentPage.value === "git" && layout.git_commit_panel_open;
  const rightShowWorkset = layout.workset_panel_open;
  return {
    rightShowTree,
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

const pnwContributions = computed(() => ({
  primary: Boolean(activePageBlockComponent.value || workspaceToolState.value.mode === "primary"),
  bottom: true,
  secondary: dockVis.value.rightVisible,
}));

const pnwDisplayPreferences = computed(() => uiPrefs.workbenchDisplayPreferences);

function updatePnwDisplayPreferences(next: PnwWorkbenchDisplayPreferences): void {
  uiPrefs.setWorkbenchDisplayPreferences(next);
}

function updatePnwLayoutState(next: PnwWorkbenchDisplayPreferences["layoutState"]): void {
  updatePnwDisplayPreferences(pdtWithWorkbenchLayoutState(pnwDisplayPreferences.value, next));
}

function updatePnwPresentation(presentation: PnwWorkbenchDisplayPreferences["presentation"]): void {
  updatePnwDisplayPreferences({ ...pnwDisplayPreferences.value, presentation });
}

function updatePnwRibbonAppearance(ribbonAppearance: PnwWorkbenchDisplayPreferences["ribbonAppearance"]): void {
  updatePnwDisplayPreferences({ ...pnwDisplayPreferences.value, ribbonAppearance });
}

function updatePnwTreeAppearance(treeAppearance: PnwWorkbenchDisplayPreferences["treeAppearance"]): void {
  updatePnwDisplayPreferences({ ...pnwDisplayPreferences.value, treeAppearance });
}

function updatePnwColorScheme(colorScheme: PnwWorkbenchDisplayPreferences["colorScheme"]): void {
  updatePnwDisplayPreferences({ ...pnwDisplayPreferences.value, colorScheme });
}

function updatePnwTabBarPlacement(tabBarPlacement: PnwWorkbenchDisplayPreferences["tabBarPlacement"]): void {
  updatePnwDisplayPreferences({ ...pnwDisplayPreferences.value, tabBarPlacement });
}

function updatePnwSettingsPositions(settingsPositions: PnwWorkbenchDisplayPreferences["settingsPositions"]): void {
  updatePnwDisplayPreferences({ ...pnwDisplayPreferences.value, settingsPositions });
}

function pageComponent(pageId: string): Component {
  return PAGE_COMPONENTS[pageId] ?? PlaceholderPage;
}

function onPnwActivate(pageId: string) {
  if (!navigation.value.some((item) => item.page === pageId)) return;
  shell.goToPage(pageId);
}

function pnwFirstLeaf(node: PnwNavigationNode): string | undefined {
  if (!node.children?.length) return node.id;
  for (const child of node.children) {
    const leaf = pnwFirstLeaf(child);
    if (leaf) return leaf;
  }
  return undefined;
}

function onPnwSelectModule(moduleId: string): void {
  const module = pnwNavigationNodes.value.find((node) => node.id === moduleId);
  const pageId = module ? pnwFirstLeaf(module) : undefined;
  if (pageId) onPnwActivate(pageId);
}

function onPnwToggleBlock(blockId: PnwViewBlockId): void {
  // PnwWorkbenchLayout 已先通过 update:layout-state 返回新 visibility；这里仅记录事件。
  shell.appendLog(`[Workbench][Layout] 切换 ${blockId} Block`, { source: "workbench" });
}

function retryActiveView(): void {
  void viewSwitch.select(activeTab.value);
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
      + "CAD 索引、BOM 引用与改名历史将清空；之后需在 KT Auto CAD 重新扫描。\n\n确定继续？",
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
  <div v-else class="shell">
    <WelcomePage
      :color-scheme="pnwDisplayPreferences.colorScheme"
      @update:color-scheme="updatePnwColorScheme"
    >
      <template #workbench="{ showWelcome }">
        <div class="desk-gated-workbench">
          <div v-if="legacyDbBanner" class="legacy-db-banner" role="alert">
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
          <PnwWorkbenchShell
      class="desk-pnw-workbench-shell"
      :nodes="pnwNavigationNodes"
      :presentation="pnwDisplayPreferences.presentation"
      :active-node-id="shell.currentPage.value"
      :expanded-node-ids="pnwExpandedNodeIds"
      :ribbon-appearance="pnwDisplayPreferences.ribbonAppearance"
      :tree-collapsed="pnwDisplayPreferences.treeCollapsed"
      :tree-appearance="pnwDisplayPreferences.treeAppearance"
      :contributions="pnwContributions"
      :layout-state="pnwDisplayPreferences.layoutState"
      :bottom-tabs="pnwBottomPanel.tabs.value"
      :active-bottom-tab-id="pnwActiveBottomTabId"
      :color-scheme="pnwDisplayPreferences.colorScheme"
      :tabs="shell.tabBarTabs.value"
      :tab-bar-placement="pnwDisplayPreferences.tabBarPlacement"
      :active-tab-id="shell.activeTabId.value"
      :can-close-all-tabs="shell.tabs.value.length > 1"
      :brand-title="shell.appConfig.value?.title ?? 'Phoenix Desk Tools'"
      :brand-subtitle="workspaceShort"
      :show-empty-view="!activeTab"
      empty-view-title="尚未打开工具"
      empty-view-description="从上方 Ribbon 或侧面导航树选择一个 Desk Tools 页面。"
      @activate="onPnwActivate"
      @select-module="onPnwSelectModule"
      @select-tab="shell.activateTab"
      @close-tab="(tabId) => void shell.closeTab(tabId)"
      @close-all-tabs="() => void shell.closeAllTabs()"
      @toggle-block="onPnwToggleBlock"
      @update:expanded-node-ids="pnwExpandedNodeIds = $event"
      @update:presentation="updatePnwPresentation"
      @update:ribbon-appearance="updatePnwRibbonAppearance"
      @update:tree-collapsed="(treeCollapsed) => updatePnwDisplayPreferences({ ...pnwDisplayPreferences, treeCollapsed })"
      @update:tree-appearance="updatePnwTreeAppearance"
      @update:color-scheme="updatePnwColorScheme"
      @update:layout-state="updatePnwLayoutState"
      @update:active-bottom-tab-id="pnwActiveBottomTabId = $event"
      @update:tab-bar-placement="updatePnwTabBarPlacement"
      @update:display-settings-positions="updatePnwSettingsPositions"
    >
      <template #brand>
        <button
          type="button"
          class="desk-workbench-brand"
          :title="workspacePath ? `${shell.appConfig.value?.title ?? 'Phoenix Desk Tools'}\n${workspacePath}` : '返回欢迎页'"
          @click="showWelcome"
        >
          <PnwPhoenixWingMark class="desk-workbench-brand-mark" decorative />
          <span class="desk-workbench-brand-copy">
            <strong>{{ shell.appConfig.value?.title ?? 'Phoenix Desk Tools' }}</strong>
            <small>{{ workspaceShort || '选择或打开工作空间' }}</small>
          </span>
        </button>
      </template>
      <template #header-actions>
        <button
          type="button"
          class="desk-workbench-header-action"
          :class="{ 'is-active': workspaceToolState.mode !== 'closed' }"
          :title="workspaceToolState.mode === 'closed' ? '打开工作空间工具' : '关闭工作空间工具'"
          :aria-pressed="workspaceToolState.mode !== 'closed'"
          @click="toggleWorkspaceTool"
        >
          <PnwIcon name="folder" :size="17" />
        </button>
        <a
          class="desk-workbench-gitee"
          :href="PROJECT_GITEE_HOME"
          target="_blank"
          rel="noopener noreferrer"
          title="Gitee 仓库主页 · phoenix-desk-tools"
          aria-label="Gitee 仓库主页"
        ><GiteeIcon /></a>
      </template>
      <div class="shell-pages" data-tour="main-content">
        <KeepAlive :max="24">
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
        </KeepAlive>
        <div v-if="pendingViewLabel && displayedTab" class="view-switch-indicator" role="status">
          正在准备 {{ pendingViewLabel }}…
        </div>
        <div v-if="viewLoadError && displayedTab" class="view-switch-error" role="alert">
          <span>View 加载失败：{{ viewLoadError }}</span>
          <button type="button" @click="retryActiveView">重试</button>
        </div>
      </div>

      <template v-if="activePageBlockComponent || workspaceToolState.mode === 'primary'" #primary>
        <div class="desk-primary-stack">
          <PnwDockablePrimarySection
            :definition="PDT_WORKSPACE_TOOL_DEFINITION"
            :state="workspaceToolState"
            @update:state="updateWorkspaceToolState"
          >
            <WorkspaceDockableToolContent />
          </PnwDockablePrimarySection>
          <component
            :is="activePageBlockComponent"
            v-if="activePageBlockComponent"
            :key="activeTab?.id ?? shell.currentPage.value"
            :page-id="shell.currentPage.value"
            :workbench-tab-id="activeTab?.id"
            class="desk-page-primary-contribution"
          />
        </div>
      </template>

      <template v-if="dockVis.rightVisible" #secondary>
        <WorkspaceTreeSidebar
          embedded
          dock-side="right"
          :show-tree="dockVis.rightShowTree"
          page-block-id=""
          page-block-tab-id=""
          :show-props="dockVis.rightShowProps"
          :show-git-commit="dockVis.rightShowGitCommit"
          :show-workset-block="dockVis.rightShowWorkset"
        />
      </template>

      <template #bottom="bottomSlotProps">
        <GlobalWorkbenchBottomPanel embedded :active-tab-id="bottomSlotProps.activeTabId" />
      </template>
      <template #bottom-summary>
        {{ pnwBottomPanel.summary('output') }}
      </template>
      <template #footer>
        <StatusBar :show-panel-toggles="false" />
      </template>
          </PnwWorkbenchShell>

          <PnwDockableToolWindow
            :definition="PDT_WORKSPACE_TOOL_DEFINITION"
            :state="workspaceToolState"
            :color-scheme="pnwDisplayPreferences.colorScheme"
            :constrain-insets="{ top: 48, bottom: 24 }"
            @update:state="updateWorkspaceToolState"
          >
            <WorkspaceDockableToolContent />
          </PnwDockableToolWindow>
        </div>
      </template>
    </WelcomePage>

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

.desk-gated-workbench {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.desk-pnw-workbench-shell {
  flex: 1 1 auto;
  min-height: 0;
}

.desk-workbench-brand {
  min-width: 0;
  max-width: min(290px, 32vw);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.desk-workbench-brand:hover { background: var(--phoenix-brand-hover-bg, rgba(37, 99, 235, 0.08)); }
.desk-workbench-brand:focus-visible { outline: 2px solid var(--phoenix-focus-ring, #2563eb); outline-offset: -2px; }
.desk-workbench-brand-mark {
  width: 27px;
  height: 27px;
  flex: 0 0 auto;
  --pnw-phoenix-wing-mark-size: 27px;
}
.desk-workbench-brand-copy { min-width: 0; display: grid; gap: 1px; line-height: 1.2; }
.desk-workbench-brand-copy strong,
.desk-workbench-brand-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desk-workbench-brand-copy strong { font-size: 0.78rem; }
.desk-workbench-brand-copy small { color: var(--phoenix-text-muted, #64748b); font-size: 0.64rem; }
.desk-workbench-gitee { width: 34px; height: 34px; display: inline-grid; place-items: center; color: var(--phoenix-text-muted, #64748b); }
.desk-workbench-gitee:hover { background: var(--phoenix-brand-hover-bg, rgba(37, 99, 235, 0.08)); color: var(--phoenix-accent, #2563eb); }
.desk-workbench-gitee:focus-visible { outline: 2px solid var(--phoenix-focus-ring, #2563eb); outline-offset: -2px; }
.desk-workbench-header-action {
  width: 34px;
  height: 34px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--phoenix-text-muted, #64748b);
  background: transparent;
  cursor: pointer;
}
.desk-workbench-header-action:hover,
.desk-workbench-header-action.is-active {
  color: var(--phoenix-accent, #2563eb);
  background: var(--phoenix-brand-hover-bg, rgba(37, 99, 235, 0.08));
}
.desk-workbench-header-action:focus-visible { outline: 2px solid var(--phoenix-focus-ring, #2563eb); outline-offset: -2px; }

.desk-primary-stack {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
}
.desk-page-primary-contribution { min-height: 0; flex: 1 1 auto; }

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

</style>

<style>
/* 配置弹层内容区（非 scoped，作用于 ConfigPage 根节点） */
.config-modal-panel .config-page {
  padding: 20px 24px 28px;
  box-sizing: border-box;
}
</style>
