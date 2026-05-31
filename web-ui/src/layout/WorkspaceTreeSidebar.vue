<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import TreeBranch from "../components/TreeBranch.vue";
import ShellLogPanel from "./ShellLogPanel.vue";
import { fetchTree, type TreeNode } from "../api";
import { useAppShell } from "../composables/useAppShell";

const LOG_MIN_H = 80;
const LOG_MAX_RATIO = 0.7;

const shell = useAppShell();
const sidebarRef = ref<HTMLElement | null>(null);
const sidebarHeight = ref(0);

const wantFcstd = ref(true);
const wantSw = ref(false);
const tree = ref<TreeNode | null>(null);
const fileCount = ref(0);
const selectedRel = ref<string | null>(null);
const loading = ref(false);

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

const gridTemplateRows = computed(() => {
  if (!logOpen.value) return "minmax(0, 1fr)";
  return `minmax(0, 1fr) 5px ${displayLogHeightPx.value}px`;
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
  loading.value = true;
  try {
    const data = await fetchTree(wantFcstd.value, wantSw.value);
    tree.value = data.tree;
    fileCount.value = data.file_count;
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

function onSelect(rel: string) {
  selectedRel.value = rel;
  shell.treeSelectHandler.value?.(rel);
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

watch(workspacePath, () => {
  selectedRel.value = null;
  scan();
});

watch(
  () => shell.treeRescanToken.value,
  async () => {
    await scan();
    const pick = shell.treeSelectAfterRescan.value;
    if (pick) {
      selectedRel.value = pick;
      shell.treeSelectHandler.value?.(pick);
      shell.treeSelectAfterRescan.value = null;
    }
  },
);

onMounted(() => scan());

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
    :style="{ width: panelWidth, gridTemplateRows }"
  >
    <div class="ws-tree-section">
      <div class="ws-head">
        <span class="ws-title">工作空间树（{{ fileCount }}）</span>
        <div class="ws-filters">
          <label class="chk"><input v-model="wantFcstd" type="checkbox" @change="scan" /> FCStd</label>
          <label class="chk"><input v-model="wantSw" type="checkbox" @change="scan" /> .sldprt</label>
          <button type="button" class="mini" :disabled="loading" @click="scan">
            {{ loading ? "…" : "刷新" }}
          </button>
        </div>
      </div>
      <div class="ws-tree">
        <TreeBranch
          v-if="tree"
          :node="tree"
          :selected="selectedRel"
          @select-file="onSelect"
        />
        <p v-else class="muted">扫描中…</p>
      </div>
    </div>

    <template v-if="logOpen">
      <div
        class="log-resizer"
        title="拖拽调节日志区高度"
        @mousedown="onLogResizeStart"
      />
      <ShellLogPanel />
    </template>
  </aside>
</template>

<style scoped>
.ws-sidebar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: grid;
  min-height: 0;
  background: var(--sidebar-bg);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

.ws-tree-section {
  min-height: 0;
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

.ws-title {
  display: block;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 6px;
}

.ws-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 0.78rem;
}

.chk {
  display: flex;
  align-items: center;
  gap: 3px;
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
  overflow: auto;
  padding: 6px 0 12px;
  font-size: 0.84rem;
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
