<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SidebarBlock from "../shell/SidebarBlock.vue";
import { fetchCaaIndexGroups, scanCaaIndex } from "../../api/caaDialog";
import { useAppShell } from "../../composables/useAppShell";
import type { CaaDialogListGroup, CaaDialogListItem } from "../../types/caaDialogList";

const shell = useAppShell();

const expanded = defineModel<boolean>("expanded", { default: true });

const loading = ref(false);
const scanning = ref(false);
const query = ref("");
const groups = ref<CaaDialogListGroup[]>([]);
const count = ref(0);
const indexed = ref(false);
const errorText = ref("");

const workspaceReady = computed(() => Boolean(shell.workspacePath.value.trim()));

const visibleCount = computed(() => count.value);
const filteredGroups = computed(() => groups.value);
let searchTimer: ReturnType<typeof window.setTimeout> | null = null;

async function loadIndex(q = query.value) {
  if (!workspaceReady.value) {
    groups.value = [];
    count.value = 0;
    indexed.value = false;
    return;
  }
  loading.value = true;
  errorText.value = "";
  try {
    const data = await fetchCaaIndexGroups(q, { fallbackWorkspaceRoot: shell.workspacePath.value.trim() });
    groups.value = data.groups;
    count.value = data.count;
    indexed.value = data.indexed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorText.value = msg;
    shell.setStatus(`CAA 索引加载失败：${msg}`);
  } finally {
    loading.value = false;
  }
}

function scheduleLoadIndex() {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = null;
    void loadIndex();
  }, 220);
}

async function rescan() {
  if (!workspaceReady.value) return;
  scanning.value = true;
  errorText.value = "";
  try {
    const data = await scanCaaIndex({ fallbackWorkspaceRoot: shell.workspacePath.value.trim() });
    groups.value = data.groups;
    count.value = data.count;
    indexed.value = data.indexed;
    shell.setStatus(data.summary || `CAA 索引已扫描 ${data.count} 个对话框`);
    if (query.value.trim()) {
      await loadIndex(query.value);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorText.value = msg;
    shell.setStatus(`CAA 索引扫描失败：${msg}`);
  } finally {
    scanning.value = false;
  }
}

function openDialog(item: CaaDialogListItem) {
  shell.openCaaDialogForRel({
    catDlgRel: item.catDlgRel,
    dialogName: item.dialogName,
    isDemo: item.isDemo,
  });
}

watch(
  () => shell.workspacePath.value,
  () => {
    query.value = "";
    void loadIndex();
  },
);

watch(query, () => {
  if (!indexed.value || !workspaceReady.value) return;
  scheduleLoadIndex();
});

onMounted(() => {
  void loadIndex();
});

onBeforeUnmount(() => {
  if (searchTimer) window.clearTimeout(searchTimer);
});
</script>

<template>
  <SidebarBlock
    v-model:expanded="expanded"
    class="caa-dialog-index-panel"
    title="对话框索引"
    variant="strip"
    body-scroll
    aria-label="CAA 对话框索引"
  >
    <template #suffix>
      <span>{{ query.trim() ? `${visibleCount}/${count}` : count }}</span>
    </template>
    <template #actions>
      <el-button
        size="small"
        text
        :loading="loading"
        title="重新加载索引"
        @click.stop="loadIndex"
      >
        刷新
      </el-button>
      <el-button
        size="small"
        text
        :loading="scanning"
        title="扫描工作空间 .CATDlg 并更新索引库"
        @click.stop="rescan"
      >
        扫描
      </el-button>
    </template>

    <div class="caa-index-body">
      <el-input
        v-model="query"
        size="small"
        clearable
        type="search"
        placeholder="搜索对话框 / 模块 / 路径…"
        spellcheck="false"
        :disabled="!indexed || loading || scanning"
      />

      <p v-if="!workspaceReady" class="muted small caa-index-empty">请选择工作空间</p>
      <p v-else-if="errorText" class="caa-index-error">{{ errorText }}</p>
      <p v-else-if="!indexed && !loading && !scanning" class="muted small caa-index-empty">
        尚未建立 CAA 索引，点击「扫描」检索 .CATDlg。
      </p>

      <div v-if="indexed" class="caa-index-list">
        <template v-if="filteredGroups.length">
          <section v-for="group in filteredGroups" :key="group.groupKey" class="caa-index-group">
            <header>{{ group.label || group.groupKey }}</header>
            <button
              v-for="item in group.items"
              :key="item.catDlgRel"
              type="button"
              class="caa-index-row"
              :title="item.catDlgRel"
              @click="openDialog(item)"
            >
              <span class="caa-index-file">{{ item.fileName }}</span>
              <span class="caa-index-name">{{ item.dialogName }}</span>
            </button>
          </section>
        </template>
        <p v-else class="muted small caa-index-empty">无匹配对话框</p>
      </div>
    </div>
  </SidebarBlock>
</template>

<style scoped>
.caa-dialog-index-panel:not(.sidebar-block--collapsed) {
  flex: 1 1 auto;
  min-height: 150px;
  width: 100%;
}

.caa-index-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.caa-index-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.caa-index-group {
  margin: 0 0 8px;
}

.caa-index-group header {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 4px 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--el-text-color-secondary);
  background: var(--sidebar-bg);
}

.caa-index-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  margin: 0;
  padding: 5px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.caa-index-row:hover {
  background: var(--el-fill-color-light);
}

.caa-index-file,
.caa-index-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caa-index-file {
  color: #2563eb;
  font-size: 12px;
  font-weight: 600;
}

.caa-index-name {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.caa-index-error,
.caa-index-empty {
  margin: 2px 0;
}

.caa-index-error {
  color: var(--el-color-danger);
  font-size: 12px;
}
</style>
