<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import TreeBranch from "../components/TreeBranch.vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import ShellLogPanel from "./ShellLogPanel.vue";
import { fetchTree, type TreeNode } from "../api";
import { useAppShell } from "../composables/useAppShell";
import { countTreeFiles, filterTreeNode } from "../utils/workspaceTreeFilter";
import {
  applyProfileDefaults,
  ensureTreeFilterSelection,
  resolveWorkspaceTreeFilterProfile,
  treeFetchOptions,
  type WorkspaceTreeFilterState,
} from "../utils/workspaceTreeFilters";

const LOG_MIN_H = 80;
const LOG_MAX_RATIO = 0.7;

const shell = useAppShell();
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
const codeRightTab = computed({
  get: () => shell.codeRightSidebarTab.value,
  set: (v: "tree" | "ignore") => {
    shell.codeRightSidebarTab.value = v;
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
const panelWidth = computed(() => `${shellLayout.value.right_panel_width_px}px`);
const open = computed(() => shellLayout.value.right_panel_open);
const logOpen = computed(() => shellLayout.value.log_panel_open);

/** 展示高度：按侧栏可用空间钳制，但不改写已保存的偏好（避免切页后越变越矮） */
const displayLogHeightPx = computed(() => {
  const stored = shellLayout.value.log_panel_height_px;
  if (sidebarHeight.value <= 0) return stored;
  const maxH = Math.floor(sidebarHeight.value * LOG_MAX_RATIO);
  return Math.min(maxH, Math.max(LOG_MIN_H, stored));
});

const logPanelStyle = computed(() =>
  logOpen.value ? { height: `${displayLogHeightPx.value}px`, flexShrink: "0" } : undefined,
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

function onLogResizeStart(e: MouseEvent) {
  e.preventDefault();
  const startY = e.clientY;
  const startH = shellLayout.value.log_panel_height_px;
  const sidebarEl = sidebarRef.value;
  if (!sidebarEl) return;
  const startSidebarH = sidebarEl.clientHeight;

  function onMove(ev: MouseEvent) {
    const delta = startY - ev.clientY;
    const maxH = Math.floor(startSidebarH * LOG_MAX_RATIO);
    const next = Math.min(maxH, Math.max(LOG_MIN_H, startH + delta));
    shell.shellLayout.value.log_panel_height_px = next;
  }

  async function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    await shell.persistShellLayout({
      log_panel_height_px: shell.shellLayout.value.log_panel_height_px,
    });
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

watch(sidebarRef, (el) => bindSidebarObserver(el), { flush: "post" });

watch(
  filterProfile,
  (profile) => {
    applyProfileDefaults(filters, profile);
    void scan();
  },
  { immediate: true },
);

watch(workspacePath, () => {
  selectedRel.value = null;
  treeFilterQuery.value = "";
  void scan();
});

watch(
  () => shell.treeRescanToken.value,
  async () => {
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
    v-show="open"
    ref="sidebarRef"
    class="ws-sidebar"
    data-tour="workspace-tree"
    :style="{ width: panelWidth }"
  >
    <div class="ws-body">
      <div v-if="showCodeFilters" class="ws-tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          class="ws-tab"
          :class="{ active: codeRightTab === 'tree' }"
          :aria-selected="codeRightTab === 'tree'"
          @click="codeRightTab = 'tree'"
        >
          工作空间树
        </button>
        <button
          type="button"
          role="tab"
          class="ws-tab"
          :class="{ active: codeRightTab === 'ignore' }"
          :aria-selected="codeRightTab === 'ignore'"
          @click="codeRightTab = 'ignore'"
        >
          忽略设定
        </button>
      </div>

      <div v-show="!showCodeFilters || codeRightTab === 'tree'" class="ws-tree-section">
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
        </div>
      </div>
      <div class="ws-tree">
        <div v-if="displayTree" class="ws-tree-scroll">
          <TreeBranch
            :node="displayTree"
            :selected="selectedRel"
            @select-file="onSelect"
          />
        </div>
        <p v-else-if="tree && treeFilterQuery.trim()" class="muted">无匹配文件</p>
        <p v-else class="muted">{{ loading ? "扫描中…" : "无数据" }}</p>
      </div>
    </div>

    <div v-show="showCodeFilters && codeRightTab === 'ignore'" class="ws-ignore-section">
      <CodeIgnorePanel layout="sidebar" />
    </div>
    </div>

    <template v-if="logOpen">
      <div
        class="log-resizer"
        title="拖拽调节日志区高度"
        @mousedown="onLogResizeStart"
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
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--sidebar-bg);
  border-left: 1px solid var(--border);
  overflow: hidden;
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

.ws-ignore-section {
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

.log-resizer {
  cursor: row-resize;
  background: transparent;
}

.log-resizer:hover {
  background: rgba(59, 130, 246, 0.25);
}
</style>
