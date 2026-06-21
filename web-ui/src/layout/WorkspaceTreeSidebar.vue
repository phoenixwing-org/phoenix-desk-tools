<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import TreeBranch from "../components/TreeBranch.vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import FileWorksetPanel from "../components/FileWorksetPanel.vue";
import ShellLogPanel from "./ShellLogPanel.vue";
import PagePropertiesPanel from "../components/PagePropertiesPanel.vue";
import { usePagePropertiesHost, setPropertiesActivePage } from "../composables/pagePropertiesHost";
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
import { bindPointerDrag } from "../utils/pointerDrag";

const LOG_MIN_H = 80;
const LOG_MAX_RATIO = 0.7;
const TREE_MIN_H = 120;
const LOG_RESIZER_H = 6;
const PROPS_MIN_H = 100;
const PROPS_MAX_RATIO = 0.45;
const PROPS_RESIZER_H = 6;

const props = withDefaults(
  defineProps<{
    dockSide?: "left" | "right";
    showTree?: boolean;
    showLog?: boolean;
    showProps?: boolean;
  }>(),
  {
    dockSide: "right",
    showTree: true,
    showLog: true,
    showProps: false,
  },
);

const shell = useAppShell();
const worksetStore = useFileWorksetsStore();
const { hasProperties } = usePagePropertiesHost();
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
  (pageId) => setPropertiesActivePage(pageId),
  { immediate: true },
);

const sidebarTab = computed({
  get: () => shell.workspaceSidebarTab.value,
  set: (v: "tree" | "workset" | "ignore") => {
    shell.workspaceSidebarTab.value = v;
  },
});

const displayTree = computed((): TreeNode | null => {
  if (!tree.value) return null;
  const q = treeFilterQuery.value.trim();
  if (!q) return tree.value;
  return filterTreeNode(tree.value, q);
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
const showPropsPanel = computed(() => props.showProps && propsOpen.value && hasProperties.value);

const panelVisible = computed(
  () =>
    props.showTree ||
    (props.showLog && logOpen.value) ||
    showPropsPanel.value,
);

const splitTreeAndLog = computed(
  () => props.showTree && props.showLog && logOpen.value && !showPropsPanel.value,
);
const splitTreeAndProps = computed(
  () => props.showTree && showPropsPanel.value && !(props.showLog && logOpen.value),
);
const splitAllThree = computed(
  () => props.showTree && showPropsPanel.value && props.showLog && logOpen.value,
);
const splitPropsAndLogOnly = computed(
  () => !props.showTree && showPropsPanel.value && props.showLog && logOpen.value,
);

function maxPropsHeightPx(sidebarH: number): number {
  if (sidebarH <= 0) return shellLayout.value.properties_panel_height_px;
  const reserved =
    (props.showTree ? TREE_MIN_H : 0) +
    (props.showLog && logOpen.value ? displayLogHeightPx.value + LOG_RESIZER_H : 0);
  const byTree = sidebarH - reserved - PROPS_RESIZER_H;
  const byRatio = Math.floor(sidebarH * PROPS_MAX_RATIO);
  return Math.max(PROPS_MIN_H, Math.min(byTree, byRatio));
}

const displayPropsHeightPx = computed(() => {
  const stored = shellLayout.value.properties_panel_height_px;
  if (!showPropsPanel.value) return stored;
  if (sidebarHeight.value <= 0) return stored;
  return Math.min(maxPropsHeightPx(sidebarHeight.value), Math.max(PROPS_MIN_H, stored));
});

const propsPanelStyle = computed(() => {
  if (!showPropsPanel.value) return undefined;
  if (props.showTree && (splitTreeAndProps.value || splitAllThree.value)) {
    return { height: `${displayPropsHeightPx.value}px`, flexShrink: "0" };
  }
  if (splitPropsAndLogOnly.value) {
    return { height: `${displayPropsHeightPx.value}px`, flexShrink: "0" };
  }
  return { flex: "1 1 auto", minHeight: "0" };
});

function maxLogHeightPx(sidebarH: number): number {
  if (sidebarH <= 0) return shellLayout.value.log_panel_height_px;
  const reserved =
    (props.showTree ? TREE_MIN_H : 0) +
    (showPropsPanel.value ? displayPropsHeightPx.value + PROPS_RESIZER_H : 0);
  const byTree = sidebarH - reserved - LOG_RESIZER_H;
  const byRatio = Math.floor(sidebarH * LOG_MAX_RATIO);
  return Math.max(LOG_MIN_H, Math.min(byTree, byRatio));
}

const displayLogHeightPx = computed(() => {
  const stored = shellLayout.value.log_panel_height_px;
  if (!props.showLog || !logOpen.value) return stored;
  if (sidebarHeight.value <= 0) return stored;
  const needsClamp = splitTreeAndLog.value || splitAllThree.value || splitPropsAndLogOnly.value;
  if (!needsClamp && props.showTree) return stored;
  if (!needsClamp && !props.showTree) return stored;
  return Math.min(maxLogHeightPx(sidebarHeight.value), Math.max(LOG_MIN_H, stored));
});

const logPanelStyle = computed(() => {
  if (!logOpen.value || !props.showLog) return undefined;
  if (!props.showTree && !showPropsPanel.value) {
    return { flex: "1 1 auto", minHeight: "0" };
  }
  if (splitTreeAndLog.value || splitAllThree.value || splitPropsAndLogOnly.value) {
    return { height: `${displayLogHeightPx.value}px`, flexShrink: "0" };
  }
  return { flex: "1 1 auto", minHeight: "0" };
});

const bodyFlex = computed(() => {
  if (!props.showTree) return undefined;
  if (splitTreeAndLog.value || splitTreeAndProps.value || splitAllThree.value) {
    return { flex: "1 1 auto", minHeight: `${TREE_MIN_H}px` };
  }
  return { flex: "1 1 auto", minHeight: "0" };
});

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

function onPropsResizeStart(e: PointerEvent) {
  if (!showPropsPanel.value) return;
  const sidebarEl = sidebarRef.value;
  if (!sidebarEl) return;
  const startY = e.clientY;
  const startH = shellLayout.value.properties_panel_height_px;

  bindPointerDrag(e, {
    cursor: "row-resize",
    onMove(ev) {
      const delta = startY - ev.clientY;
      const maxH = maxPropsHeightPx(sidebarEl.clientHeight);
      const next = Math.min(maxH, Math.max(PROPS_MIN_H, startH + delta));
      shell.shellLayout.value.properties_panel_height_px = next;
    },
    onEnd() {
      void shell.persistShellLayout({
        properties_panel_height_px: shell.shellLayout.value.properties_panel_height_px,
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

  bindPointerDrag(e, {
    cursor: "row-resize",
    onMove(ev) {
      const delta = startY - ev.clientY;
      const maxH = maxLogHeightPx(sidebarEl.clientHeight);
      const next = Math.min(maxH, Math.max(LOG_MIN_H, startH + delta));
      shell.shellLayout.value.log_panel_height_px = next;
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
        'log-only': showLog && !showTree && !showPropsPanel,
        'props-only': showPropsPanel && !showTree && !(showLog && logOpen),
        'has-split': splitTreeAndLog || splitTreeAndProps || splitAllThree || splitPropsAndLogOnly,
        'has-props-split': showPropsPanel && (showTree || (showLog && logOpen)),
      },
    ]"
    data-tour="workspace-tree"
    :style="{ width: panelWidth }"
  >
    <div v-if="showTree" class="ws-body" :style="bodyFlex">
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
            <TreeBranch :node="displayTree" :selected="selectedRel" @select-file="onSelect" />
          </div>
          <p v-else-if="tree && treeFilterQuery.trim()" class="muted">无匹配文件</p>
          <p v-else class="muted">{{ loading ? "扫描中…" : "无数据" }}</p>
        </div>
      </div>

      <div v-show="sidebarTab === 'workset'" class="ws-workset-section">
        <FileWorksetPanel />
      </div>

      <div v-show="showCodeFilters && sidebarTab === 'ignore'" class="ws-ignore-section">
        <CodeIgnorePanel layout="sidebar" />
      </div>
    </div>

    <template v-if="showPropsPanel">
      <div
        v-if="showTree || (showLog && logOpen)"
        class="props-resizer panel-resizer"
        title="拖拽调节属性区高度"
        @pointerdown="onPropsResizeStart"
      />
      <div class="ws-props-wrap" :style="propsPanelStyle">
        <PagePropertiesPanel />
      </div>
    </template>

    <template v-if="showLog && logOpen">
      <div
        v-if="showTree || showPropsPanel"
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
.ws-sidebar.props-only .ws-props-wrap {
  flex: 1;
  min-height: 0;
}

.ws-sidebar.has-split .ws-body {
  flex: 1 1 auto;
  min-height: 120px;
}

.ws-props-wrap {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.panel-resizer {
  flex-shrink: 0;
  height: 6px;
  cursor: row-resize;
  touch-action: none;
  background: var(--panel-head-bg, #f1f5f9);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  position: relative;
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ws-log-wrap {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
