<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from "vue";
import {
  fetchBomXrefMeta,
  fetchBomXrefOutgoing,
  fetchFcstdMap,
  rebuildBomXrefs,
  type BomXrefEdge,
  type BomXrefMeta,
  type FcstdMapEntry,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import { useWorkspaceFileQuery } from "../composables/useWorkspaceFileQuery";
import { basenameFromRel, normalizeRepoRel, resolveOutgoingHostQuery } from "../utils/workspaceFileQuery";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const {
  queryText,
  pickedRel,
  clearPickedOnInput,
  applyTreeSelection,
  registerTreeSelectHandler,
  unregisterTreeSelectHandler,
} = useWorkspaceFileQuery(props.workbenchTabId);

type BomRow = {
  index: number;
  PartNumber: string;
  PartVersion: string;
  TypeCode: string;
  PartName: string;
  filename: string;
  repoRel: string;
  resolveStatus: string;
};

const meta = ref<BomXrefMeta | null>(null);
const hostRel = ref("");
const refs = ref<BomXrefEdge[]>([]);
const mapEntries = ref<FcstdMapEntry[]>([]);
const loading = ref(false);
const rebuilding = ref(false);
const pageError = ref("");
const listSummary = ref("");

const hasIndex = computed(() => (meta.value?.edge_count ?? 0) > 0);

const mapByRel = computed(() => {
  const m = new Map<string, FcstdMapEntry>();
  for (const e of mapEntries.value) {
    m.set(normalizeRepoRel(e.repo_rel_path), e);
  }
  return m;
});

const bomRows = computed((): BomRow[] => {
  return refs.value.map((row, i) => {
    const rel = row.target_repo_rel_path ? normalizeRepoRel(row.target_repo_rel_path) : "";
    const entry = rel ? mapByRel.value.get(rel) : undefined;
    return {
      index: i + 1,
      PartNumber: entry?.PartNumber || "—",
      PartVersion: entry?.PartVersion || "—",
      TypeCode: entry?.TypeCode || "—",
      PartName: entry?.PartName || "—",
      filename: row.target_basename,
      repoRel: row.target_repo_rel_path || "—",
      resolveStatus: row.resolve_status,
    };
  });
});

async function loadMeta() {
  meta.value = await fetchBomXrefMeta();
}

async function loadMapIndex() {
  try {
    const data = await fetchFcstdMap();
    mapEntries.value = data.entries ?? [];
  } catch {
    mapEntries.value = [];
  }
}

function resolveHostQuery() {
  return resolveOutgoingHostQuery(queryText.value, pickedRel.value);
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    resolved: "已解析",
    ambiguous: "歧义",
    missing: "未找到",
    self: "自引用",
    non_fcstd: "非 FCStd",
  };
  return map[status] ?? status;
}

async function onLoadBom() {
  pageError.value = "";
  listSummary.value = "";
  refs.value = [];
  hostRel.value = "";

  const q = resolveHostQuery();
  if (!q) {
    const msg = "请填写装配路径，或在右侧树中点击总成/装配文件";
    pageError.value = msg;
    shell.setStatus(msg);
    return;
  }

  if (!hasIndex.value) {
    shell.appendLog("[BOM列表] 提示：引用表为空，请先「重建引用表」", { source: "bom_xref", open: true });
  }

  loading.value = true;
  try {
    const data = await fetchBomXrefOutgoing(q.rel);
    hostRel.value = data.host_repo_rel_path;
    refs.value = data.refs;
    const text = `BOM 列表：${basenameFromRel(hostRel.value)} · ${data.count} 个子件引用`;
    listSummary.value = text;
    shell.setStatus(text);
    shell.appendLog(`[BOM列表] ${text}`, { source: "bom_xref", open: true });
  } catch (e) {
    pageError.value = String(e);
    shell.setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function onTreeSelect(repoRel: string) {
  applyTreeSelection(repoRel);
  pageError.value = "";
  await onLoadBom();
}

function registerTreeHandler() {
  registerTreeSelectHandler(onTreeSelect);
}

function unregisterTreeHandler() {
  unregisterTreeSelectHandler();
}

async function onRebuild() {
  rebuilding.value = true;
  pageError.value = "";
  try {
    const out = await rebuildBomXrefs();
    await loadMeta();
    shell.setStatus(`BOM 引用已重建：${out.edge_count} 条 · ${out.host_count} 个宿主`);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    rebuilding.value = false;
  }
}

onMounted(() => {
  void loadMeta().catch((e) => {
    pageError.value = String(e);
  });
  void loadMapIndex();
  registerTreeHandler();
});

onActivated(() => {
  registerTreeHandler();
});

onDeactivated(() => {
  /* handler 保留在 Tab map 中 */
});

onUnmounted(() => {
  unregisterTreeHandler();
});
</script>

<template>
  <div class="page bom-list-page">
    <header class="page-head">
      <h1 class="page-title">BOM 列表</h1>
      <p class="page-desc">
        选择<strong>装配/总成 FCStd</strong>，列出其 XLink 引用的子件；属性列来自 CAD 索引。引用关系需先构建引用表。
      </p>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <section class="meta-block">
      <p v-if="meta" class="meta-line">
        引用边 {{ meta.edge_count }} · 宿主 {{ meta.host_count }}
        <span v-if="meta.last_bom_xref_at"> · 更新 {{ meta.last_bom_xref_at }}</span>
      </p>
      <p v-if="!hasIndex" class="meta-line warn">
        引用表为空。请先在「CAD 索引」执行工程内搜索，或点击下方「重建引用表」。
      </p>
      <button type="button" class="btn" :disabled="rebuilding" @click="onRebuild">
        {{ rebuilding ? "…" : "重建引用表" }}
      </button>
    </section>

    <section class="search-block">
      <div class="fields">
        <label class="field">
          <span class="label">装配文件</span>
          <input
            v-model="queryText"
            class="mono"
            spellcheck="false"
            placeholder="相对路径或文件名；或右侧树点击装配"
            @input="clearPickedOnInput"
            @keydown.enter.prevent="onLoadBom"
          />
        </label>
        <p v-if="pickedRel" class="picked-hint mono">已从树选择：{{ pickedRel }}</p>
      </div>
      <button type="button" class="btn primary" :disabled="loading" @click="onLoadBom">
        {{ loading ? "加载中…" : "加载 BOM" }}
      </button>
    </section>

    <p v-if="listSummary" class="summary">{{ listSummary }}</p>

    <section v-if="hostRel && !loading && !bomRows.length" class="empty-block">
      <p class="empty">该装配暂无出向 XLink 引用（0 行）。</p>
    </section>

    <section v-if="bomRows.length" class="results">
      <h2 class="section-title mono">{{ hostRel }}</h2>
      <div class="table-wrap">
        <table class="bom-table">
          <thead>
            <tr>
              <th class="col-no">#</th>
              <th>PartNumber</th>
              <th>PartVersion</th>
              <th>TypeCode</th>
              <th>PartName</th>
              <th>文件名</th>
              <th>相对路径</th>
              <th>解析</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in bomRows" :key="`${row.index}-${row.filename}`">
              <td class="col-no">{{ row.index }}</td>
              <td>{{ row.PartNumber }}</td>
              <td>{{ row.PartVersion }}</td>
              <td>{{ row.TypeCode }}</td>
              <td>{{ row.PartName }}</td>
              <td class="mono">{{ row.filename }}</td>
              <td class="mono muted">{{ row.repoRel }}</td>
              <td>
                <span class="tag" :class="row.resolveStatus">{{ statusLabel(row.resolveStatus) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.bom-list-page {
  padding: 20px 24px 24px;
  max-width: 1100px;
  height: 100%;
  overflow: auto;
}

.page-head {
  margin-bottom: 16px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.page-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.5;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
  padding: 10px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.meta-block {
  margin-bottom: 16px;
}

.meta-line {
  margin: 0 0 8px;
  font-size: 0.85rem;
  color: var(--muted);
}

.meta-line.warn {
  color: #b45309;
}

.search-block {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg, #fafafa);
}

.fields {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
  max-width: 560px;
}

.field {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 8px;
}

.field .label {
  font-size: 0.82rem;
  color: var(--muted);
  text-align: right;
}

.field input {
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.picked-hint {
  margin: 0 0 0 80px;
  font-size: 0.78rem;
  color: #1d4ed8;
}

.summary {
  margin: 0 0 12px;
  font-size: 0.85rem;
  color: #047857;
}

.empty-block {
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.empty-block .empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.section-title {
  margin: 0 0 8px;
  font-size: 0.88rem;
  font-weight: 600;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.bom-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
  min-width: 720px;
}

.bom-table th,
.bom-table td {
  border-bottom: 1px solid var(--border);
  padding: 7px 10px;
  text-align: left;
  vertical-align: top;
}

.bom-table th {
  background: var(--panel-bg, #f3f4f6);
  font-weight: 600;
  position: sticky;
  top: 0;
}

.bom-table tbody tr:last-child td {
  border-bottom: none;
}

.col-no {
  width: 40px;
  text-align: center;
  color: var(--muted);
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}

.muted {
  color: var(--muted);
}

.tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  background: #e5e7eb;
}

.tag.resolved {
  background: #d1fae5;
  color: #047857;
}

.tag.ambiguous {
  background: #fef3c7;
  color: #b45309;
}
</style>
