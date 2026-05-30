<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import TreeBranch from "../components/TreeBranch.vue";
import { fetchTree, type TreeNode } from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

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
</script>

<template>
  <aside v-show="open" class="ws-sidebar" :style="{ width: panelWidth }">
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
  background: var(--sidebar-bg);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

.ws-head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
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
  overflow: auto;
  padding: 6px 0 12px;
  font-size: 0.84rem;
}

.muted {
  padding: 12px;
  color: var(--muted);
  font-size: 0.82rem;
}
</style>
