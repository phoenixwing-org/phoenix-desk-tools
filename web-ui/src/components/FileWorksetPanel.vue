<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useAppShell } from "../composables/useAppShell";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { basenameFromRel, repoDirFromRel } from "../utils/workspaceFileQuery";

const shell = useAppShell();
const store = useFileWorksetsStore();

const pathFilter = ref("");
const renameDraft = ref("");

const active = computed(() => store.activeWorkset);
const filteredPaths = computed(() => {
  const paths = active.value?.paths ?? [];
  const q = pathFilter.value.trim().toLowerCase();
  if (!q) return paths;
  return paths.filter((p) => p.toLowerCase().includes(q));
});

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

onMounted(() => {
  const ws = shell.workspacePath.value;
  if (ws) void store.hydrate(ws);
});

function onSelectWorkset(id: string) {
  store.setActiveId(id);
}

function onCreate() {
  store.createWorkset();
}

function onRename() {
  if (!active.value) return;
  store.renameWorkset(active.value.id, renameDraft.value);
}

function onDelete() {
  if (!active.value) return;
  if (!window.confirm(`删除工作集「${active.value.name}」？`)) return;
  store.deleteWorkset(active.value.id);
}

function onRemovePath(path: string) {
  if (!active.value) return;
  store.removePath(active.value.id, path);
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
        <button type="button" class="mini" title="新建工作集" @click="onCreate">+ 新建</button>
      </div>
      <select
        class="ws-select"
        :value="store.activeId ?? ''"
        :disabled="store.loading"
        @change="onSelectWorkset(($event.target as HTMLSelectElement).value)"
      >
        <option v-if="!store.worksets.length" value="">（尚无工作集）</option>
        <option v-for="opt in store.worksetOptions" :key="opt.id" :value="opt.id">
          {{ opt.label }}（{{ opt.count }}）
        </option>
      </select>
      <div v-if="active" class="rename-row">
        <input v-model="renameDraft" class="rename-input" type="text" spellcheck="false" />
        <button type="button" class="mini" @click="onRename">改名</button>
        <button type="button" class="mini danger" @click="onDelete">删</button>
      </div>
      <p v-if="store.pathDisplay" class="muted small path-hint" :title="store.pathDisplay">
        存于 phoenix-workspace.sqlite
      </p>
      <p v-if="store.saving" class="muted small">保存中…</p>
    </div>

    <div v-if="active" class="ws-body">
      <div class="summary-row">
        <span class="summary">{{ active.paths.length }} 个文件</span>
        <input
          v-model="pathFilter"
          class="filter-input"
          type="search"
          spellcheck="false"
          placeholder="筛选路径…"
        />
      </div>
      <ul v-if="filteredPaths.length" class="path-list">
        <li v-for="p in filteredPaths" :key="p" class="path-item">
          <button type="button" class="path-link" :title="p" @click="openFile(p)">
            <span class="path-file mono">{{ basenameFromRel(p) }}</span>
            <template v-if="pathHasDir(p)">
              <span class="path-at">@</span>
              <span class="path-dir mono">{{ pathDir(p) }}</span>
            </template>
          </button>
          <button type="button" class="mini path-remove" title="移出工作集" @click="onRemovePath(p)">×</button>
        </li>
      </ul>
      <p v-else class="muted empty-hint">
        {{ active.paths.length ? "无匹配路径" : "从 Code 索引或工作空间树加入文件" }}
      </p>
    </div>
    <p v-else-if="!store.loading" class="muted empty-hint">点击「+ 新建」或从索引/树加入文件</p>
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
  padding: 4px 6px;
  font-size: 0.78rem;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--btn-bg);
}

.rename-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.rename-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  font-size: 0.78rem;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
}

.mini {
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--btn-bg);
  font-size: 0.72rem;
  flex-shrink: 0;
  cursor: pointer;
}

.mini.danger {
  color: #b91c1c;
}

.path-hint {
  margin: 4px 0 0;
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
  padding: 3px 6px;
  font-size: 0.75rem;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
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
  padding: 0 5px;
  line-height: 1.2;
}

.empty-hint {
  font-size: 0.75rem;
  padding: 8px 4px;
}
</style>
