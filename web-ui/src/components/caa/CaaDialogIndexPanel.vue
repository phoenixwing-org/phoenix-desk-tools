<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Grid, Folder } from "@element-plus/icons-vue";
import SidebarBlock from "../shell/SidebarBlock.vue";
import { fetchCaaIndexGroups, scanCaaIndex } from "../../api/caaDialog";
import { useAppShell } from "../../composables/useAppShell";
import { useCaaDialogPageStore } from "../../stores/caaDialogPage";
import type { CaaDialogListGroup, CaaDialogListItem } from "../../types/caaDialogList";

const shell = useAppShell();
const store = useCaaDialogPageStore();

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

/** table 模式：平铺列表 + 序号 */
const flatRows = computed(() => {
  const rows: (CaaDialogListItem & { _idx: number })[] = [];
  let i = 1;
  for (const g of groups.value) {
    for (const item of g.items) {
      rows.push({ ...item, _idx: i++ });
    }
  }
  return rows;
});

/** 去掉 .CATDlg 后缀 */
function shortName(fileName: string) {
  return fileName.replace(/\.CATDlg$/i, "");
}

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
      <el-button size="small" text class="act-btn" :title="store.indexViewMode === 'tree' ? '列表视图' : '分组视图'" @click.stop="store.indexViewMode = store.indexViewMode === 'tree' ? 'table' : 'tree'">{{ store.indexViewMode === 'tree' ? '📋' : '🌳' }}</el-button>
      <el-button size="small" text class="act-btn" :loading="loading" title="刷新索引" @click.stop="loadIndex()">🔄</el-button>
      <el-button size="small" text class="act-btn" :loading="scanning" title="扫描 .CATDlg" @click.stop="rescan">🔍</el-button>
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
        <!-- tree 模式：分组 -->
        <template v-if="store.indexViewMode === 'tree'">
          <template v-if="filteredGroups.length">
            <section v-for="group in filteredGroups" :key="group.groupKey" class="caa-index-group">
              <header><el-icon><Folder /></el-icon> {{ group.label || group.groupKey }}</header>
              <button
                v-for="item in group.items"
                :key="item.catDlgRel"
                type="button"
                class="caa-index-row"
                :title="item.catDlgRel"
                @click="openDialog(item)"
              >
                <el-icon class="caa-file-icon"><Grid /></el-icon>
                <span class="caa-index-file">{{ shortName(item.fileName) }}</span>
              </button>
            </section>
          </template>
          <p v-else class="muted small caa-index-empty">无匹配对话框</p>
        </template>

        <!-- table 模式：平铺序号 + 文件名（去 .CATDlg） -->
        <table v-else class="caa-index-table">
          <tbody>
            <tr
              v-for="row in flatRows"
              :key="row.catDlgRel"
              class="caa-index-table-row"
              :title="row.catDlgRel"
              @click="openDialog(row)"
            >
              <td class="caa-idx-num">{{ row._idx }}</td>
              <td class="caa-idx-icon"><el-icon><Grid /></el-icon></td>
              <td class="caa-idx-file">{{ shortName(row.fileName) }}</td>
            </tr>
          </tbody>
        </table>
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
  display: flex;
  align-items: center;
  gap: 1px;
  width: 100%;
  margin: 0;
  padding: 4px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.caa-file-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
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

/* ── table 模式 ── */

.caa-index-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.caa-index-table-row {
  cursor: pointer;
  transition: background 0.12s;
}

.caa-index-table-row:hover {
  background: var(--el-fill-color-light);
}

.caa-index-table-row td {
  padding: 3px 4px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.caa-idx-num {
  width: 24px;
  color: var(--el-text-color-placeholder);
  text-align: right;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.caa-idx-icon {
  width: 20px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.caa-idx-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #2563eb;
  font-weight: 600;
}
</style>

<style>
.caa-dialog-index-panel .sidebar-block-actions {
  gap: 2px;
  padding-left: 3px;
}
.caa-dialog-index-panel .sidebar-block-actions .act-btn {
  padding: 2px 3px !important;
}
.caa-dialog-index-panel .sidebar-block-actions .act-btn:hover {
  color: #3b82f6 !important;
  background: rgba(59,130,246,0.08) !important;
}
</style>
