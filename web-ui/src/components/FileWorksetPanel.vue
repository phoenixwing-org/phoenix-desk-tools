<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAppShell } from "../composables/useAppShell";
import { promptChoice } from "../composables/choiceDialog";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { basenameFromRel, repoDirFromRel } from "../utils/workspaceFileQuery";

const shell = useAppShell();
const store = useFileWorksetsStore();

const pathFilter = ref("");
const renameDraft = ref("");
const pruning = ref(false);

const active = computed(() => store.activeWorkset);
const activeIdSelect = computed({
  get: () => store.activeId ?? "",
  set: (id: string) => onSelectWorkset(id),
});

function _activePaths(ws: typeof active.value): string[] {
  if (!ws) return [];
  return (ws.entries ?? ws.paths ?? []).map((e: any) => (typeof e === "string" ? e : e.path));
}

const activeEntryCount = computed(() => _activePaths(active.value).length);

const filteredEntries = computed(() => {
  const entries = active.value?.entries ?? (active.value?.paths ?? []).map((p: string) => ({ path: p, type: "file" as const }));
  const q = pathFilter.value.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e: any) => e.path.toLowerCase().includes(q));
});
const dirCount = computed(() => (active.value?.entries ?? []).filter((e: any) => e.type === "dir").length);
const fileCount = computed(() => (active.value?.entries ?? []).filter((e: any) => e.type === "file").length);

watch(
  () => shell.workspacePath.value,
  (ws) => {
    if (ws) void store.hydrate(ws);
  },
  { immediate: true },
);

watch(active, (ws) => {
  renameDraft.value = ws?.name ?? "";
});

function onSelectWorkset(id: string) {
  if (id) store.setActiveId(id);
}

function onCreate() {
  store.createWorkset();
}

function onRename() {
  if (!active.value) return;
  store.renameWorkset(active.value.id, renameDraft.value);
}

async function onDelete() {
  if (!active.value) return;
  const ws = active.value;
  const cnt = _activePaths(ws).length;
  const pathHint = cnt ? `（含 ${cnt} 个条目）` : "";
  const choice = await promptChoice({
    title: "删除工作集",
    defaultChoiceId: "cancel",
    message: `确定删除工作集「${ws.name}」${pathHint}？\n删除后不可恢复。`,
    choices: [
      { id: "cancel", label: "取消", variant: "default" },
      { id: "delete", label: "删除", variant: "danger" },
    ],
  });
  if (choice.choiceId !== "delete") return;
  store.deleteWorkset(ws.id);
}

function onRemovePath(path: string) {
  if (!active.value) return;
  store.removePath(active.value.id, path);
}

async function onPruneMissing() {
  if (!activeEntryCount.value) return;
  pruning.value = true;
  try {
    const removed = await store.pruneMissing(active.value.id);
    shell.setStatus(removed ? `已剔除 ${removed} 条缺失路径` : "当前工作集无缺失路径");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    pruning.value = false;
  }
}

function openFile(path: string) {
  void shell.openFileDetailForRel(path);
}

function pathDir(rel: string): string {
  const d = repoDirFromRel(rel);
  return d === "./" ? "" : d.replace(/\/$/, "");
}

function pathHasDir(rel: string): boolean {
  return pathDir(rel).length > 0;
}
</script>

<template>
  <div class="workset-panel">
    <div class="ws-head">
      <div class="ws-title-row">
        <span class="ws-title">文件工作集</span>
        <el-button size="small" link type="primary" title="新建工作集" @click="onCreate">+ 新建</el-button>
      </div>
      <el-select
        v-model="activeIdSelect"
        size="small"
        class="ws-select"
        :disabled="store.loading || !store.worksets.length"
        placeholder="（尚无工作集）"
      >
        <el-option v-for="opt in store.worksetOptions" :key="opt.id" :value="opt.id" :label="`${opt.label}（${opt.count}）`" />
      </el-select>
      <div v-if="active" class="rename-row">
        <el-input v-model="renameDraft" size="small" spellcheck="false" />
        <el-button size="small" @click="onRename">改名</el-button>
        <el-button size="small" type="danger" plain @click="onDelete">删</el-button>
      </div>
      <p v-if="store.saving" class="muted small">保存中…</p>
    </div>

    <div v-if="active" class="ws-body">
      <div class="summary-row">
        <span class="summary">{{ activeEntryCount }} 个条目 · 📁{{ dirCount }} 📄{{ fileCount }}</span>
        <el-button
          size="small"
          link
          type="primary"
          :loading="pruning"
          :disabled="!activeEntryCount || store.saving"
          title="移除磁盘上已不存在的路径"
          @click="onPruneMissing"
        >
          剔除缺失
        </el-button>
        <el-input
          v-model="pathFilter"
          size="small"
          class="filter-input"
          clearable
          spellcheck="false"
          placeholder="筛选路径…"
        />
      </div>
      <ul v-if="filteredEntries.length" class="path-list">
        <li v-for="e in filteredEntries" :key="e.path" class="path-item" :class="{ 'is-dir': e.type === 'dir' }">
          <span class="entry-type-icon">{{ e.type === 'dir' ? '📁' : '📄' }}</span>
          <button type="button" class="path-link" :title="e.path" @click="e.type === 'file' ? openFile(e.path) : undefined">
            <span class="path-file mono">{{ basenameFromRel(e.path) }}</span>
            <template v-if="e.type === 'file' && pathHasDir(e.path)">
              <span class="path-at">@</span>
              <span class="path-dir mono">{{ pathDir(e.path) }}</span>
            </template>
          </button>
          <el-button size="small" link type="danger" class="path-remove" title="移出工作集" @click="onRemovePath(e.path)">
            ×
          </el-button>
        </li>
      </ul>
      <el-empty v-else :image-size="48" :description="activeEntryCount ? '无匹配条目' : '从工作空间树 pick 目录或添加文件'" />
    </div>
    <el-empty
      v-else-if="!store.loading"
      :image-size="48"
      description="点击「+ 新建」或从索引/树加入文件"
    />
    <p v-else class="muted empty-hint">加载中…</p>
  </div>
</template>

<style scoped>
.workset-panel {
  flex: 1;
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

.ws-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.ws-title {
  font-weight: 600;
  font-size: 0.85rem;
}

.ws-select {
  width: 100%;
  margin-bottom: 6px;
}

.rename-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.rename-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.ws-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  overflow: hidden;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.summary {
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.filter-input {
  flex: 1;
  min-width: 0;
}

.path-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.path-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border-bottom: 1px solid var(--border);
}

.path-item.is-dir {
  background: #f8fafc;
}

.entry-type-icon {
  flex-shrink: 0;
  font-size: 0.72rem;
  width: 16px;
  text-align: center;
}

.path-link {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 3px;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-size: 0.72rem;
  color: var(--text);
  cursor: pointer;
  overflow: hidden;
}

.path-file {
  flex-shrink: 0;
  font-weight: 600;
  max-width: 52%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-at {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.65rem;
  line-height: 1.2;
}

.path-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--muted);
  font-size: 0.68rem;
}

.path-link:hover .path-file {
  color: var(--accent);
  text-decoration: underline;
}

.path-remove {
  flex-shrink: 0;
  padding: 0 4px;
}

.empty-hint {
  font-size: 0.75rem;
  padding: 8px 4px;
}

.ws-body :deep(.el-empty) {
  padding: 12px 0;
}
</style>
