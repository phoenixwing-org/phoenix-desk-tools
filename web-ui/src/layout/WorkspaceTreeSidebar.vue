<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import TreeBranch from "../components/TreeBranch.vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import FileWorksetPanel from "../components/FileWorksetPanel.vue";
import ShellLogPanel from "./ShellLogPanel.vue";
import PagePropertiesPanel from "../components/PagePropertiesPanel.vue";
import GitCommitPanel from "../components/shell/GitCommitPanel.vue";
import CaaDialogIndexPanel from "../components/caa/CaaDialogIndexPanel.vue";
import CaaDialogTreePanel from "../components/caa/CaaDialogTreePanel.vue";
import { usePnwPagePropertiesHost, pnwSetPropertiesActivePage } from "phoenix-wing";
import { fetchTree, type TreeNode } from "../api";
import { useAppShell } from "../composables/useAppShell";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { countTreeFiles, filterTreeNode } from "../utils/workspaceTreeFilter";
import { collectTreeFilePaths } from "../utils/treeFilePaths";
import {
  applyProfileDefaults,
  ensureTreeFilterSelection,
  resolveWorkspaceTreeFilterProfile,
  treeFetchOptions,
  type WorkspaceTreeFilterState,
} from "../utils/workspaceTreeFilters";
import { pnwBindPointerDrag } from "phoenix-wing";
import {
  maxStoredLogHeightPx,
  maxStoredPropsFooterHeightPx,
  maxStoredPropsHeightPx,
  resolveSidebarStackLayout,
  SIDEBAR_LOG_MIN_H,
  SIDEBAR_PROPS_FOOTER_MIN_H,
  SIDEBAR_PROPS_MIN_H,
} from "../utils/sidebarStackLayout";

const props = withDefaults(
  defineProps<{
    dockSide?: "left" | "right";
    showTree?: boolean;
    showCaaTree?: boolean;
    showLog?: boolean;
    showProps?: boolean;
    showGitCommit?: boolean;
    showWorksetBlock?: boolean;
  }>(),
  {
    dockSide: "right",
    showTree: true,
    showCaaTree: false,
    showLog: true,
    showProps: false,
    showGitCommit: false,
  },
);

const shell = useAppShell();
const worksetStore = useFileWorksetsStore();
const worksetBlockMode = computed(() => props.showWorksetBlock ?? false);
const { hasProperties } = usePnwPagePropertiesHost();
const sidebarRef = ref<HTMLElement | null>(null);
const sidebarHeight = ref(0);

const filters = ref<WorkspaceTreeFilterState>({
  wantFcstd: true,
  wantSw: false,
  wantCpp: false,
  wantHeader: false,
});

const tree = ref<TreeNode | null>(null);
const fileCount = ref(0);
const selectedRel = ref<string | null>(null);
const treeFilterQuery = ref("");
const dirOnlyFilter = ref(false);
const loading = ref(false);

const filterProfile = computed(() =>
  resolveWorkspaceTreeFilterProfile(
    shell.enabledNavModules.value,
    shell.currentPage.value,
    shell.appConfig.value?.navigation,
  ),
);

const showCadFilters = computed(() => filterProfile.value === "cad");
const showCodeFilters = computed(() => filterProfile.value === "code");

watch(
  () => shell.currentPage.value,
  (pageId) => pnwSetPropertiesActivePage(pageId),
  { immediate: true },
);

const sidebarTab = computed({
  get: () => shell.workspaceSidebarTab.value,
  set: (v: "tree" | "workset" | "ignore") => {
    shell.workspaceSidebarTab.value = v;
  },
});

function keepDirsOnly(node: TreeNode): TreeNode | null {
  if (node.type !== "dir") return null;
  const children = (node.children || []).map(keepDirsOnly).filter(Boolean) as TreeNode[];
  return { ...node, children };
}

const displayTree = computed((): TreeNode | null => {
  let t = tree.value;
  if (!t) return null;
  if (dirOnlyFilter.value) {
    t = keepDirsOnly(t);
    if (!t) return null;
  }
  const q = treeFilterQuery.value.trim();
  if (!q) return t;
  return filterTreeNode(t, q);
});

const displayFileCount = computed(() => {
  if (!displayTree.value) return 0;
  return countTreeFiles(displayTree.value);
});

const treeTitle = computed(() => {
  const q = treeFilterQuery.value.trim();
  if (!q) return `工作空间树（${fileCount.value}）`;
  return `工作空间树（${displayFileCount.value} / ${fileCount.value}）`;
});

const shellLayout = computed(() => shell.shellLayout.value);
const workspacePath = computed(() => shell.workspacePath.value);
const panelWidth = computed(() => {
  const px =
    props.dockSide === "left"
      ? shellLayout.value.left_panel_width_px
      : shellLayout.value.right_panel_width_px;
  return `${px}px`;
});

const logOpen = computed(() => shellLayout.value.log_panel_open);
const propsOpen = computed(() => shellLayout.value.properties_panel_open);
const gitCommitBodyExpanded = ref(true);

const showPropsPanel = computed(() => props.showProps && propsOpen.value && hasProperties.value);
const showGitCommitPanel = computed(
  () =>
    props.showGitCommit &&
    shell.currentPage.value === "git" &&
    shellLayout.value.git_commit_panel_open,
);
const gitCommitStackedWithProps = computed(() => showGitCommitPanel.value && showPropsPanel.value);
const showPropsWrap = computed(() => showPropsPanel.value || showGitCommitPanel.value);
const showGitCommitStandalone = computed(
  () => showGitCommitPanel.value && !gitCommitStackedWithProps.value,
);

const panelVisible = computed(
  () =>
    props.showTree ||
    props.showCaaTree ||
    (props.showLog && logOpen.value) ||
    showPropsWrap.value,
);

const showMainBlock = computed(() => props.showTree || props.showCaaTree);

const stackLayout = computed(() =>
  resolveSidebarStackLayout({
    totalHeightPx: sidebarHeight.value,
    showMain: showMainBlock.value,
    showPropsWrap: showPropsWrap.value,
    showPropsMain: showPropsPanel.value,
    showPropsFooter: showGitCommitPanel.value && gitCommitStackedWithProps.value,
    propsFooterExpanded: gitCommitBodyExpanded.value,
    showLog: props.showLog && logOpen.value,
    storedPropsHeightPx: shellLayout.value.properties_panel_height_px,
    storedLogHeightPx: shellLayout.value.log_panel_height_px,
    storedPropsFooterHeightPx: shellLayout.value.properties_footer_height_px,
  }),
);

const bodyStyle = computed(() => {
  if (!showMainBlock.value) return undefined;
  if (stackLayout.value.mainFlex) {
    return { flex: "1 1 auto", minHeight: `${stackLayout.value.mainMinHeightPx}px` };
  }
  return { flex: "1 1 auto", minHeight: "0" };
});

const propsPanelStyle = computed(() => {
  if (!showPropsWrap.value) return undefined;
  if (stackLayout.value.propsWrapFlex) {
    return { flex: "1 1 auto", minHeight: "0" };
  }
  return { height: `${stackLayout.value.propsWrapHeightPx}px`, flexShrink: "0" };
});

const propsFooterStyle = computed(() => {
  if (!showGitCommitPanel.value) return undefined;
  if (!gitCommitBodyExpanded.value) {
    return { flexShrink: "0" };
  }
  if (!gitCommitStackedWithProps.value) {
    return { flex: "1 1 auto", minHeight: "0" };
  }
  return { height: `${stackLayout.value.propsFooterHeightPx}px`, flexShrink: "0" };
});

const logPanelStyle = computed(() => {
  if (!logOpen.value || !props.showLog) return undefined;
  if (stackLayout.value.logFlex) {
    return { flex: "1 1 auto", minHeight: "0" };
  }
  return { height: `${stackLayout.value.logHeightPx}px`, flexShrink: "0" };
});

const hasBottomFixed = computed(
  () =>
    showMainBlock.value &&
    ((props.showLog && logOpen.value) || showPropsWrap.value),
);

let resizeObserver: ResizeObserver | null = null;

function bindSidebarObserver(el: HTMLElement | null) {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) {
    sidebarHeight.value = 0;
    return;
  }
  resizeObserver = new ResizeObserver((entries) => {
    sidebarHeight.value = Math.round(entries[0]?.contentRect.height ?? 0);
  });
  resizeObserver.observe(el);
  sidebarHeight.value = el.clientHeight;
}

async function scan() {
  if (!props.showTree) return;
  if (!ensureTreeFilterSelection(filters.value, filterProfile.value)) {
    tree.value = null;
    fileCount.value = 0;
    shell.setStatus("请至少勾选一种文件类型");
    return;
  }
  loading.value = true;
  try {
    const data = await fetchTree(treeFetchOptions(filters.value));
    tree.value = data.tree;
    fileCount.value = data.file_count;
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  void scan();
}

async function onSelect(rel: string) {
  selectedRel.value = rel;
  await shell.dispatchTreeSelect(rel);
}

function onAddVisibleToWorkset() {
  const paths = collectTreeFilePaths(displayTree.value);
  if (!paths.length) {
    shell.setStatus("当前树中无文件可加入");
    return;
  }
  const { added } = worksetStore.addPathsToActive(paths, "tree:visible");
  shell.setStatus(worksetStore.lastMessage);
  if (added > 0) sidebarTab.value = "workset";
}

function onPickDir(rel: string) {
  shell.dispatchDirPick(rel);
  const name = rel.replace(/\/+$/, "").split("/").filter(Boolean).pop() || rel || "?";
  const { added } = worksetStore.addEntriesToWorkset(null, [{ path: rel, type: "dir" }], "tree:pick");
  const msg = added > 0 ? `📌 【${name}】已添加到工作集` : `📌 【${name}】已在工作集中`;
  shell.setStatus(msg);
}

function onPropsResizeStart(e: PointerEvent) {
  if (!showPropsWrap.value) return;
  const sidebarEl = sidebarRef.value;
  if (!sidebarEl) return;
  const startY = e.clientY;
  const startH = shellLayout.value.properties_panel_height_px;

  pnwBindPointerDrag(e, {
    cursor: "row-resize",
    onMove(ev) {
      const delta = ev.clientY - startY;
      const maxH = maxStoredPropsHeightPx(
        sidebarEl.clientHeight,
        showMainBlock.value,
        props.showLog && logOpen.value,
        shell.shellLayout.value.log_panel_height_px,
      );
      const next = Math.min(maxH, Math.max(SIDEBAR_PROPS_MIN_H, startH - delta));
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        properties_panel_height_px: next,
      };
    },
    onEnd() {
      void shell.persistShellLayout({
        properties_panel_height_px: shell.shellLayout.value.properties_panel_height_px,
      });
    },
  });
}

function onPropsFooterResizeStart(e: PointerEvent) {
  if (!showGitCommitPanel.value || !gitCommitBodyExpanded.value) return;
  const startY = e.clientY;
  const startH = shellLayout.value.properties_footer_height_px ?? SIDEBAR_PROPS_FOOTER_MIN_H;
  const wrapH = stackLayout.value.propsWrapHeightPx;
  let nextFooterH = startH;

  pnwBindPointerDrag(e, {
    cursor: "row-resize",
    onMove(ev) {
      const delta = ev.clientY - startY;
      const maxH = maxStoredPropsFooterHeightPx(wrapH);
      nextFooterH = Math.min(maxH, Math.max(SIDEBAR_PROPS_FOOTER_MIN_H, startH + delta));
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        properties_footer_height_px: nextFooterH,
      };
    },
    onEnd() {
      void shell.persistShellLayout({ properties_footer_height_px: nextFooterH }).catch((err) => {
        shell.setStatus(String(err));
      });
    },
  });
}

function onLogResizeStart(e: PointerEvent) {
  if (!props.showLog || !logOpen.value) return;
  const sidebarEl = sidebarRef.value;
  if (!sidebarEl) return;
  const startY = e.clientY;
  const startH = shellLayout.value.log_panel_height_px;

  pnwBindPointerDrag(e, {
    cursor: "row-resize",
    onMove(ev) {
      const delta = ev.clientY - startY;
      const maxH = maxStoredLogHeightPx(
        sidebarEl.clientHeight,
        showMainBlock.value,
        showPropsWrap.value,
        shell.shellLayout.value.properties_panel_height_px,
      );
      const next = Math.min(maxH, Math.max(SIDEBAR_LOG_MIN_H, startH - delta));
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        log_panel_height_px: next,
      };
    },
    onEnd() {
      void shell.persistShellLayout({
        log_panel_height_px: shell.shellLayout.value.log_panel_height_px,
      });
    },
  });
}

watch(sidebarRef, (el) => bindSidebarObserver(el), { flush: "post" });

watch(
  filterProfile,
  (profile) => {
    if (!props.showTree) return;
    applyProfileDefaults(filters, profile);
    void scan();
  },
  { immediate: true },
);

watch(workspacePath, () => {
  if (!props.showTree) return;
  selectedRel.value = null;
  treeFilterQuery.value = "";
  void scan();
});

watch(
  () => shell.treeRescanToken.value,
  async () => {
    if (!props.showTree) return;
    await scan();
    const pick = shell.treeSelectAfterRescan.value;
    if (pick) {
      selectedRel.value = pick;
      await shell.dispatchTreeSelect(pick);
      shell.treeSelectAfterRescan.value = null;
    }
  },
);

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <aside
    v-show="panelVisible"
    ref="sidebarRef"
    class="ws-sidebar"
    :class="[
      `dock-${dockSide}`,
      {
        'log-only': showLog && !showMainBlock && !showPropsWrap,
        'props-only': showPropsWrap && !showMainBlock && !(showLog && logOpen),
        'git-commit-only':
          showGitCommitPanel && !showPropsPanel && !showMainBlock && !(showLog && logOpen),
        'has-stack': hasBottomFixed,
        'has-props-stack-split': stackLayout.propsStackResizer,
        'has-caa-tree': showCaaTree,
      },
    ]"
    data-tour="workspace-tree"
    :style="{ width: panelWidth }"
  >
    <div v-if="showCaaTree" class="ws-body ws-caa-tree-body" :style="bodyStyle">
      <CaaDialogIndexPanel />
      <CaaDialogTreePanel />
    </div>

    <div v-if="showTree" class="ws-body" :style="bodyStyle">
      <div class="ws-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          class="ws-tab"
          :class="{ active: sidebarTab === 'tree' }"
          :aria-selected="sidebarTab === 'tree'"
          @click="sidebarTab = 'tree'"
        >
          工作空间树
        </button>
        <button
          type="button"
          role="tab"
          class="ws-tab"
          :class="{ active: sidebarTab === 'workset' }"
          :aria-selected="sidebarTab === 'workset'"
          @click="sidebarTab = 'workset'"
        >
          工作集
        </button>
        <button
          type="button"
          class="ws-tab ws-tab-icon"
          title="弹出为独立面板（可和树同时显示）"
          @click="shell.toggleWorksetPanel()"
        >⇲</button>
        <button
          v-if="showCodeFilters"
          type="button"
          role="tab"
          class="ws-tab"
          :class="{ active: sidebarTab === 'ignore' }"
          :aria-selected="sidebarTab === 'ignore'"
          @click="sidebarTab = 'ignore'"
        >
          忽略设定
        </button>
      </div>

      <div v-show="sidebarTab === 'tree'" class="ws-tree-section">
        <div class="ws-head">
          <div class="ws-title-row">
            <span class="ws-title" :title="treeTitle">{{ treeTitle }}</span>
            <div class="ws-filters">
              <template v-if="showCadFilters">
                <label class="chk">
                  <input v-model="filters.wantFcstd" type="checkbox" @change="onFilterChange" />
                  FCStd
                </label>
                <label class="chk">
                  <input v-model="filters.wantSw" type="checkbox" @change="onFilterChange" />
                  .sldprt
                </label>
              </template>
              <template v-else-if="showCodeFilters">
                <label class="chk">
                  <input v-model="filters.wantCpp" type="checkbox" @change="onFilterChange" />
                  .cpp
                </label>
                <label class="chk">
                  <input v-model="filters.wantHeader" type="checkbox" @change="onFilterChange" />
                  .h/.hpp
                </label>
              </template>
              <label class="chk dir-only-chk">
                <input v-model="dirOnlyFilter" type="checkbox" />
                仅目录
              </label>
            </div>
          </div>
          <div class="ws-search-row">
            <input
              v-model="treeFilterQuery"
              class="ws-search-input"
              type="search"
              spellcheck="false"
              placeholder="筛选文件名 / 路径…"
            />
            <button type="button" class="mini" :disabled="loading" title="重新扫描工作空间树" @click="scan">
              {{ loading ? "…" : "刷新" }}
            </button>
            <button
              v-if="treeFilterQuery.trim()"
              type="button"
              class="mini"
              title="清除筛选"
              @click="treeFilterQuery = ''"
            >
              清除
            </button>
            <button
              type="button"
              class="mini"
              title="将当前可见文件加入活动工作集"
              :disabled="!displayFileCount"
              @click="onAddVisibleToWorkset"
            >
              +工作集
            </button>
          </div>
        </div>
        <div class="ws-tree">
          <div v-if="displayTree" class="ws-tree-scroll">
            <TreeBranch :node="displayTree" :selected="selectedRel" @select-file="onSelect" @pick-dir="(p) => onPickDir(p)" />
          </div>
          <p v-else-if="tree && treeFilterQuery.trim()" class="muted">无匹配文件</p>
          <p v-else class="muted">{{ loading ? "扫描中…" : "无数据" }}</p>
        </div>
      </div>

      <!-- 工作集（Tab 模式） -->
      <div v-show="!worksetBlockMode && sidebarTab === 'workset'" class="ws-workset-section">
        <FileWorksetPanel />
      </div>

      <div v-show="showCodeFilters && sidebarTab === 'ignore'" class="ws-ignore-section">
        <CodeIgnorePanel layout="sidebar" />
      </div>
    </div>

    <!-- 工作集（Block 模式 — 独立堆叠区块） -->
    <template v-if="worksetBlockMode">
      <div class="panel-resizer" title="拖拽调节工作集高度" @pointerdown="onPropsResizeStart" />
      <div class="ws-props-wrap" :style="{ height: '200px' }">
        <div class="ws-props-stack-head">工作集</div>
        <div style="flex:1;overflow:auto;padding:4px"><FileWorksetPanel /></div>
      </div>
    </template>

    <template v-if="showGitCommitStandalone">
      <div
        v-if="showMainBlock || (showLog && logOpen)"
        class="props-resizer panel-resizer"
        title="拖拽调节 Git 提交区高度"
        @pointerdown="onPropsResizeStart"
      />
      <div class="ws-props-wrap ws-git-commit-wrap" :style="propsPanelStyle">
        <div
          class="ws-props-stack-head"
          :class="{ 'is-collapsed': !gitCommitBodyExpanded }"
          :style="propsFooterStyle"
        >
          <GitCommitPanel v-model:expanded="gitCommitBodyExpanded" />
        </div>
      </div>
    </template>

    <template v-else-if="showPropsPanel || gitCommitStackedWithProps">
      <div
        v-if="showMainBlock || (showLog && logOpen)"
        class="props-resizer panel-resizer"
        title="拖拽调节属性区高度"
        @pointerdown="onPropsResizeStart"
      />
      <div class="ws-props-wrap" :style="propsPanelStyle">
        <div
          v-if="gitCommitStackedWithProps"
          class="ws-props-stack-head"
          :class="{ 'is-collapsed': !gitCommitBodyExpanded }"
          :style="propsFooterStyle"
        >
          <GitCommitPanel v-model:expanded="gitCommitBodyExpanded" />
        </div>
        <div
          v-if="stackLayout.propsStackResizer"
          class="props-stack-resizer panel-resizer"
          title="拖拽调节 Git 提交区高度"
          @pointerdown="onPropsFooterResizeStart"
        />
        <div v-if="showPropsPanel" class="ws-props-main">
          <PagePropertiesPanel />
        </div>
      </div>
    </template>

    <template v-if="showLog && logOpen">
      <div
        v-if="showMainBlock || showPropsWrap"
        class="log-resizer panel-resizer"
        title="拖拽调节日志区高度"
        @pointerdown="onLogResizeStart"
      />
      <div class="ws-log-wrap" :style="logPanelStyle">
        <ShellLogPanel />
      </div>
    </template>
  </aside>
</template>

<style scoped>
.ws-sidebar {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--sidebar-bg);
  overflow: hidden;
}

.ws-sidebar.dock-right {
  right: 0;
  border-left: 1px solid var(--border);
}

.ws-sidebar.dock-left {
  left: 0;
  border-right: 1px solid var(--border);
}

.ws-sidebar.log-only .ws-log-wrap,
.ws-sidebar.props-only .ws-props-wrap,
.ws-sidebar.git-commit-only .ws-props-wrap {
  flex: 1;
  min-height: 0;
}

.ws-props-wrap {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.ws-props-main {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ws-props-stack-head {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.ws-props-stack-head.is-collapsed {
  height: auto !important;
  overflow: visible;
}

.ws-props-stack-head > :deep(.sidebar-block:not(.sidebar-block--collapsed)) {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.ws-props-stack-head > :deep(.sidebar-block.sidebar-block--collapsed) {
  flex: 0 0 auto;
  height: auto !important;
  overflow: visible;
}

.ws-props-main :deep(.page-props.sidebar-block--collapsed) {
  flex: 0 0 auto;
  overflow: visible;
}

.ws-sidebar.has-props-stack-split .ws-props-main {
  flex: 1 1 auto;
  min-height: 0;
}

.panel-resizer {
  flex-shrink: 0;
  position: relative;
  z-index: 4;
  height: 6px;
  cursor: row-resize;
  touch-action: none;
  background: var(--panel-head-bg, #f1f5f9);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  box-sizing: border-box;
}

.panel-resizer::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28px;
  height: 3px;
  margin: -1.5px 0 0 -14px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.55);
  pointer-events: none;
}

.panel-resizer:hover {
  background: rgba(59, 130, 246, 0.12);
}

.panel-resizer:hover::after {
  background: rgba(59, 130, 246, 0.55);
}

.ws-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-caa-tree-body {
  min-height: 0;
}

.ws-caa-tree-body :deep(.caa-dialog-tree-panel) {
  flex: 1 1 auto;
  min-height: 0;
}

.ws-log-wrap {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.ws-tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
  flex-shrink: 0;
}

.ws-tab {
  flex: 1;
  padding: 7px 6px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 0.72rem;
  color: var(--muted);
  cursor: pointer;
}

.ws-tab.active {
  color: var(--text);
  font-weight: 600;
  border-bottom-color: var(--accent);
  background: var(--sidebar-bg);
}

.ws-tab-icon {
  flex: 0 0 auto;
  padding: 7px 8px;
  font-size: 0.78rem;
  opacity: 0.5;
}

.ws-tab-icon:hover {
  opacity: 1;
}

.ws-ignore-section,
.ws-workset-section {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-tree-section {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
  flex-shrink: 0;
}

.ws-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  min-width: 0;
}

.ws-title {
  font-weight: 600;
  font-size: 0.85rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-search-row {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.ws-search-row .mini {
  flex-shrink: 0;
}

.ws-search-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.78rem;
}

.ws-filters {
  display: flex;
  flex-shrink: 0;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  font-size: 0.72rem;
}

.chk {
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.mini {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--btn-bg);
  font-size: 0.75rem;
}

.ws-tree {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 0 12px;
  font-size: 0.84rem;
}

.ws-tree-scroll {
  display: inline-block;
  min-width: 100%;
  width: max-content;
  padding: 0 8px 0 4px;
  box-sizing: border-box;
}

.muted {
  padding: 12px;
  color: var(--muted);
  font-size: 0.82rem;
}
</style>
