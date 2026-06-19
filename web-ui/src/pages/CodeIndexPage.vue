<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchCodeIndex,
  fetchCodeIndexEntries,
  scanCodeIndex,
  type CodeIndexEntry,
  type CodeIndexPayload,
  type CodeIndexSearchMode,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { TableColumnDef } from "../composables/useResizableTable";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const SESSION_V = 1;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "present", label: "存在" },
  { value: "missing", label: "缺失" },
] as const;

const KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "source", label: "源文件" },
  { value: "config", label: "配置" },
  { value: "doc", label: "文档" },
  { value: "resource", label: "资源" },
] as const;

const SEARCH_MODE_OPTIONS = [
  { value: "contains", label: "模糊" },
  { value: "filename", label: "文件名" },
] as const;

type KindFilter = (typeof KIND_OPTIONS)[number]["value"];
type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

const columns: TableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "status", label: "状态", width: 64, minWidth: 52 },
  { key: "kind", label: "类型", width: 80, minWidth: 64 },
  { key: "file", label: "文件名", width: 220, minWidth: 120 },
  { key: "ext", label: "扩展名", width: 72, minWidth: 56 },
  { key: "encoding", label: "编码", width: 88, minWidth: 72 },
  { key: "size", label: "大小", width: 80, minWidth: 64 },
  { key: "dir", label: "相对目录", width: 200, minWidth: 100 },
];

const loading = ref(false);
const scanning = ref(false);
const data = ref<CodeIndexPayload | null>(null);
const statusFilter = ref<StatusFilter>("all");
const kindFilter = ref<KindFilter>("all");
const searchQuery = ref("");
const searchMode = ref<CodeIndexSearchMode>("contains");
const entries = ref<CodeIndexEntry[]>([]);
const entriesTotal = ref(0);
const pageOffset = ref(0);
const pageSize = ref(50);
const entriesLoading = ref(false);

const stats = computed(() => data.value?.stats);
const kindLabels = computed(() => data.value?.kind_labels ?? {});
const missingCount = computed(() => {
  const total = data.value?.file_count ?? 0;
  const present = data.value?.present_count ?? 0;
  return Math.max(0, total - present);
});

const pageEnd = computed(() => Math.min(pageOffset.value + entries.value.length, entriesTotal.value));
const hasPrevPage = computed(() => pageOffset.value > 0);
const hasNextPage = computed(() => pageOffset.value + pageSize.value < entriesTotal.value);
const currentPage = computed(() => Math.floor(pageOffset.value / pageSize.value) + 1);
const totalPages = computed(() => Math.max(1, Math.ceil(entriesTotal.value / pageSize.value)));
const hasScan = computed(() => Boolean(data.value?.last_scan_at));
const searchPlaceholder = computed(() =>
  searchMode.value === "filename"
    ? "文件名或相对路径（含扩展名时精确匹配，如 KtAlarmClockCmd.cpp）"
    : "搜索文件名或相对路径…",
);

const statCards = computed(() => {
  const s = stats.value;
  const total = s?.total ?? data.value?.file_count ?? 0;
  return [
    { key: "total", label: "总计", value: total, tone: "neutral" as const },
    { key: "source", label: "源文件", value: s?.source ?? 0, tone: "source" as const },
    { key: "config", label: "配置", value: s?.config ?? 0, tone: "config" as const },
    { key: "doc", label: "文档", value: s?.doc ?? 0, tone: "doc" as const },
    { key: "resource", label: "资源", value: s?.resource ?? 0, tone: "resource" as const },
    ...(missingCount.value
      ? [{ key: "missing", label: "缺失", value: missingCount.value, tone: "warn" as const }]
      : []),
  ];
});

function setStatus(msg: string) {
  shell.setStatus(msg);
}

function kindLabel(row: CodeIndexEntry) {
  return kindLabels.value[row.asset_kind] ?? row.asset_kind ?? "—";
}

function statusLabel(row: CodeIndexEntry) {
  return row.file_status === "missing" ? "缺失" : "存在";
}

function relDir(row: CodeIndexEntry): string {
  const p = row.repo_rel_path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  const dir = p.slice(0, i);
  return dir || ".";
}

const ENCODING_DISPLAY: Record<string, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 BOM",
  ascii: "ASCII",
  gbk: "GBK",
  binary: "二进制",
  unknown: "未知",
};

function encodingLabel(row: CodeIndexEntry): string {
  const enc = (row.text_encoding || "").trim();
  if (!enc) return "—";
  return ENCODING_DISPLAY[enc] ?? enc;
}

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatScanTime(iso: string | null | undefined) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function refresh(logSummary = false) {
  loading.value = true;
  try {
    data.value = await fetchCodeIndex();
    if (logSummary && data.value.last_scan_at) {
      setStatus(`Code 索引：${data.value.present_count} 个存在 · 上次 ${data.value.last_scan_at}`);
    }
    await loadEntries();
  } catch (e) {
    setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function onScan() {
  scanning.value = true;
  shell.appendLog("[Code 索引] 扫描工作空间…", { source: "code_index", open: true });
  try {
    const out = await scanCodeIndex();
    data.value = out;
    if (out.summary) {
      shell.appendLog(out.summary, { source: "code_index" });
      setStatus(out.summary);
    }
    pageOffset.value = 0;
    await loadEntries();
  } catch (e) {
    const msg = String(e);
    shell.appendLog(msg, { source: "code_index" });
    setStatus(msg);
  } finally {
    scanning.value = false;
  }
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined;

async function loadEntries() {
  if (!data.value?.last_scan_at) {
    entries.value = [];
    entriesTotal.value = 0;
    return;
  }
  entriesLoading.value = true;
  try {
    const out = await fetchCodeIndexEntries({
      offset: pageOffset.value,
      limit: pageSize.value,
      status: statusFilter.value,
      kind: kindFilter.value,
      q: searchQuery.value,
      searchMode: searchMode.value,
    });
    entries.value = out.entries;
    entriesTotal.value = out.total;
  } catch (e) {
    entries.value = [];
    entriesTotal.value = 0;
    setStatus(String(e));
  } finally {
    entriesLoading.value = false;
  }
}

function goPrevPage() {
  if (!hasPrevPage.value) return;
  pageOffset.value = Math.max(0, pageOffset.value - pageSize.value);
  void loadEntries();
}

function goNextPage() {
  if (!hasNextPage.value) return;
  pageOffset.value += pageSize.value;
  void loadEntries();
}

function onPageSizeChange(ev: Event) {
  const n = Number((ev.target as HTMLSelectElement).value);
  if (!PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) return;
  pageSize.value = n;
  pageOffset.value = 0;
  void loadEntries();
}

function scheduleEntriesReload(resetPage = true) {
  if (resetPage) pageOffset.value = 0;
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    void loadEntries();
  }, 280);
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V) return false;
  const sf = snap.statusFilter;
  if (sf === "all" || sf === "present" || sf === "missing") {
    statusFilter.value = sf;
  }
  const kf = snap.kindFilter;
  if (KIND_OPTIONS.some((o) => o.value === kf)) {
    kindFilter.value = kf as KindFilter;
  }
  if (snap.searchQuery != null) {
    searchQuery.value = String(snap.searchQuery);
  }
  const sm = snap.searchMode;
  if (sm === "contains" || sm === "filename") {
    searchMode.value = sm;
  }
  if (typeof snap.pageOffset === "number") {
    pageOffset.value = Math.max(0, snap.pageOffset);
  }
  if (typeof snap.pageSize === "number" && PAGE_SIZE_OPTIONS.includes(snap.pageSize as 20 | 50 | 100)) {
    pageSize.value = snap.pageSize;
  }
  await refresh(false);
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) {
    void refresh();
    return;
  }
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  void refresh();
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    statusFilter: statusFilter.value,
    kindFilter: kindFilter.value,
    searchQuery: searchQuery.value,
    searchMode: searchMode.value,
    pageOffset: pageOffset.value,
    pageSize: pageSize.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch([statusFilter, kindFilter, searchQuery, searchMode, pageOffset, pageSize], () =>
  shell.scheduleWorkbenchSave(),
);
watch([statusFilter, kindFilter, searchMode], () => scheduleEntriesReload(true));
watch(searchQuery, () => scheduleEntriesReload(true));

onMounted(() => applyInitialTabState());
</script>

<template>
  <div class="page code-index-page">
    <header class="page-head">
      <div class="head-row">
        <div class="head-left">
          <h1 class="page-title">Code 索引</h1>
          <p v-if="!hasScan" class="page-desc">扫描源文件、配置、文档与资源，写入 phoenix_code_* 索引表</p>
        </div>
        <div class="head-trailing">
          <div class="head-actions" data-tour-page-code-scan>
            <button type="button" class="btn primary" :disabled="scanning" @click="onScan">
              {{ scanning ? "扫描中…" : "工程内搜索" }}
            </button>
            <button type="button" class="btn" :disabled="loading" @click="refresh()">刷新</button>
          </div>
          <div class="head-help">
            <PageHelpButton page-id="code_index" />
          </div>
        </div>
      </div>
      <p v-if="data?.last_scan_at" class="scan-meta mono">
        上次扫描 {{ formatScanTime(data.last_scan_at) }} · {{ data.workspace_path_display }}
      </p>
    </header>

    <div class="index-panel">
      <section v-if="hasScan && statCards.length" class="stat-cards">
        <div
          v-for="card in statCards"
          :key="card.key"
          class="stat-card"
          :class="`tone-${card.tone}`"
        >
          <span class="stat-value">{{ card.value }}</span>
          <span class="stat-label">{{ card.label }}</span>
        </div>
      </section>

      <section class="index-toolbar">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          id="code-index-search"
          v-model="searchQuery"
          class="search-input"
          type="search"
          spellcheck="false"
          :placeholder="searchPlaceholder"
        />
        <div class="search-mode-group" role="group" aria-label="搜索模式">
          <button
            v-for="opt in SEARCH_MODE_OPTIONS"
            :key="opt.value"
            type="button"
            class="chip search-mode-chip"
            :class="{ active: searchMode === opt.value }"
            :title="
              opt.value === 'filename'
                ? '仅匹配文件名；含扩展名时精确匹配，可输入相对路径'
                : '在文件名与相对路径中模糊匹配'
            "
            @click="searchMode = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <button v-if="searchQuery.trim()" type="button" class="btn mini" @click="searchQuery = ''">
          清除
        </button>
      </section>

      <section class="filter-bar">
        <div class="filter-group">
          <span class="filter-label">状态</span>
          <div class="chip-group" role="group" aria-label="状态筛选">
            <button
              v-for="opt in STATUS_OPTIONS"
              :key="opt.value"
              type="button"
              class="chip"
              :class="{ active: statusFilter === opt.value }"
              @click="statusFilter = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">类型</span>
          <div class="chip-group" role="group" aria-label="类型筛选">
            <button
              v-for="opt in KIND_OPTIONS"
              :key="opt.value"
              type="button"
              class="chip"
              :class="{ active: kindFilter === opt.value }"
              @click="kindFilter = opt.value"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <span v-if="entriesTotal > 0" class="count">
          显示 <strong>{{ pageOffset + 1 }}–{{ pageEnd }}</strong> / {{ entriesTotal }} 条
        </span>
      </section>

      <div class="table-area" data-tour-page-code-table>
        <ResizableDataTable v-if="entries.length" :columns="columns" wrap-class="table-grow">
          <tbody>
            <tr
              v-for="(row, idx) in entries"
              :key="row.repo_rel_path + row.file_status"
              :class="row.file_status"
            >
              <td class="col-index">{{ pageOffset + idx + 1 }}</td>
              <td>
                <span class="status-badge" :class="row.file_status">{{ statusLabel(row) }}</span>
              </td>
              <td>
                <span class="kind-badge" :data-kind="row.asset_kind">{{ kindLabel(row) }}</span>
              </td>
              <td class="mono file-cell" :title="row.repo_rel_path">{{ row.filename }}</td>
              <td class="mono">{{ row.file_ext || "—" }}</td>
              <td class="mono encoding-cell" :title="row.text_encoding || ''">{{ encodingLabel(row) }}</td>
              <td class="mono">{{ formatSize(row.size_bytes) }}</td>
              <td class="mono dir-cell">{{ relDir(row) }}</td>
            </tr>
          </tbody>
        </ResizableDataTable>
        <div v-else-if="entriesLoading || loading" class="empty-wrap table-grow">
          <p class="empty">加载索引列表…</p>
        </div>
        <div v-else class="empty-wrap table-grow">
          <p class="empty">
            {{
              hasScan
                ? searchQuery.trim()
                  ? "无匹配条目，请调整搜索或筛选"
                  : "当前筛选无条目"
                : "尚未扫描；点击「工程内搜索」建立 Code 索引"
            }}
          </p>
        </div>
      </div>

      <nav v-if="hasScan && entriesTotal > 0" class="pager">
        <button type="button" class="btn mini" :disabled="!hasPrevPage || entriesLoading" @click="goPrevPage">
          上一页
        </button>
        <span class="pager-info">
          第 {{ currentPage }} / {{ totalPages }} 页
        </span>
        <button type="button" class="btn mini" :disabled="!hasNextPage || entriesLoading" @click="goNextPage">
          下一页
        </button>
        <label class="pager-size">
          每页
          <select :value="pageSize" @change="onPageSizeChange">
            <option v-for="n in PAGE_SIZE_OPTIONS" :key="n" :value="n">{{ n }}</option>
          </select>
          条
        </label>
      </nav>
    </div>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.code-index-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
  height: 100%;
}

.head-stats .ok {
  color: #15803d;
}

.head-stats .warn {
  color: #b45309;
}

.scan-meta {
  margin: 4px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.index-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.stat-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 72px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.stat-value {
  font-size: 1.15rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.stat-label {
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--muted);
}

.stat-card.tone-source .stat-value {
  color: #1d4ed8;
}

.stat-card.tone-config .stat-value {
  color: #7c3aed;
}

.stat-card.tone-doc .stat-value {
  color: #0d9488;
}

.stat-card.tone-resource .stat-value {
  color: #c2410c;
}

.stat-card.tone-warn {
  border-color: #fed7aa;
  background: #fff7ed;
}

.stat-card.tone-warn .stat-value {
  color: #c2410c;
}

.index-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.search-icon {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  color: var(--muted);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.index-toolbar .search-input {
  flex: 1;
  min-width: 160px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
  background: #fff;
}

.search-mode-group {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.search-mode-chip {
  padding: 5px 10px;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 0.78rem;
  color: var(--muted);
  flex-shrink: 0;
}

.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 0.78rem;
  color: var(--muted);
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.chip:hover:not(.active) {
  background: #f8fafc;
  border-color: var(--border-strong);
  color: var(--text);
}

.chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 500;
}

.count {
  color: var(--muted);
  margin-left: auto;
  font-size: 0.82rem;
}

.table-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.table-grow {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 0.82rem;
}

.pager-info {
  color: var(--muted);
}

.pager-size {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--muted);
}

.pager-size select {
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.82rem;
  background: #fff;
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 500;
}

.status-badge.present {
  background: #dcfce7;
  color: #15803d;
}

.status-badge.missing {
  background: #ffedd5;
  color: #c2410c;
}

.kind-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 500;
  background: #f1f5f9;
  color: #475569;
}

.kind-badge[data-kind="source"] {
  background: #dbeafe;
  color: #1d4ed8;
}

.kind-badge[data-kind="config"] {
  background: #ede9fe;
  color: #6d28d9;
}

.kind-badge[data-kind="doc"] {
  background: #ccfbf1;
  color: #0f766e;
}

.kind-badge[data-kind="resource"] {
  background: #ffedd5;
  color: #c2410c;
}

:deep(.resizable-data-table tr.missing) {
  background: #fff7ed;
}

:deep(.resizable-data-table .col-index),
:deep(.resizable-data-table td.col-index) {
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
}

.file-cell {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-cell {
  color: #64748b;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
}

.btn.mini {
  padding: 5px 10px;
  font-size: 0.78rem;
}
</style>
