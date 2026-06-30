<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  exportCodeIndexJson,
  fetchCodeIndex,
  fetchCodeIndexEntries,
  fetchCodeIndexExtensionDiscovery,
  purgeMissingCodeIndex,
  scanCodeIndex,
  type CodeIndexEntry,
  type CodeIndexPayload,
  type CodeIndexSearchMode,
} from "../api";
import { promptChoice } from "../composables/choiceDialog";
import PageHeader from "../components/PageHeader.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { TableColumnDef } from "../composables/useResizableTable";
import { useAppShell } from "../composables/useAppShell";
import { useCodeIndexPropertySheet } from "../composables/useCodeIndexPropertySheet";
import { usePageSession } from "../composables/usePageSession";
import { usePageSummary } from "../composables/usePageSummary";
import { useFileWorksetsStore } from "../stores/fileWorksets";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const worksetStore = useFileWorksetsStore();

// --- 工作集过滤 ---
const filterWorksetId = ref("");
const filterWorksetPaths = computed(() => {
  if (!filterWorksetId.value) return null as Set<string> | null;
  const ws = worksetStore.worksetById(filterWorksetId.value);
  if (!ws) return null;
  const entries = ws.entries ?? ws.paths;
  return new Set(
    (entries ?? []).map((e: any) =>
      (typeof e === "string" ? e : e.path).replace(/\\/g, "/"),
    ),
  );
});

const filteredEntries = computed(() => {
  const paths = filterWorksetPaths.value;
  if (!paths) return entries.value;
  return entries.value.filter((r) => paths.has(r.repo_rel_path.replace(/\\/g, "/")));
});

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
  { key: "check", label: "", width: 36, minWidth: 36 },
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
const purging = ref(false);
const exporting = ref(false);
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
const selectedPaths = ref<Set<string>>(new Set());

const kindLabels = computed(() => data.value?.kind_labels ?? {});
const missingCount = computed(() => {
  const total = data.value?.file_count ?? 0;
  const present = data.value?.present_count ?? 0;
  return Math.max(0, total - present);
});

useCodeIndexPropertySheet("code_index", { data, missingCount });

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

const headSummary = computed(() => {
  if (!hasScan.value || !data.value) return "";
  const total = data.value.stats?.total ?? data.value.file_count ?? 0;
  const present = data.value.present_count ?? 0;
  if (missingCount.value > 0) {
    return `共 ${total} 条 · 存在 ${present} · 缺失 ${missingCount.value}`;
  }
  return `共 ${total} 条 · 全部存在`;
});

usePageSummary(headSummary);

const allPageChecked = computed(
  () => entries.value.length > 0 && entries.value.every((r) => selectedPaths.value.has(r.repo_rel_path)),
);
const selectedCount = computed(() => selectedPaths.value.size);

function toggleRow(path: string, checked: boolean) {
  const next = new Set(selectedPaths.value);
  if (checked) next.add(path);
  else next.delete(path);
  selectedPaths.value = next;
}

function toggleAllPage(checked: boolean) {
  selectedPaths.value = checked
    ? new Set(entries.value.map((r) => r.repo_rel_path))
    : new Set();
}

function addSelectedToWorkset() {
  const paths = [...selectedPaths.value];
  if (!paths.length) {
    setStatus("请先勾选条目");
    return;
  }
  worksetStore.addPathsToActive(paths, "code_index:selected");
  setStatus(worksetStore.lastMessage);
  void shell.openWorksetSidebar();
}

function addPageToWorkset() {
  const paths = entries.value.map((r) => r.repo_rel_path);
  if (!paths.length) {
    setStatus("当前页无条目");
    return;
  }
  worksetStore.addPathsToActive(paths, "code_index:page");
  setStatus(worksetStore.lastMessage);
  void shell.openWorksetSidebar();
}

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
  let adoptExtensions: string[] | undefined;

  try {
    const discovery = await fetchCodeIndexExtensionDiscovery();
    const candidates = discovery.candidates ?? [];
    if (candidates.length > 0) {
      const choice = await promptChoice({
        title: "发现未纳入索引的后缀",
        message:
          "工作空间内发现以下后缀尚未纳入 Code 索引。勾选要纳入的后缀并扫描；纳入的后缀会保存到本工作空间数据库。",
        checkboxes: {
          items: candidates.map((c) => ({
            id: c.ext,
            label: `${c.ext}（${c.count} 个文件）`,
          })),
          defaultSelectedIds: candidates.map((c) => c.ext),
        },
        choices: [
          { id: "adopt-selected", label: "纳入所选并扫描", variant: "primary" },
          { id: "builtin-only", label: "仅扫描已知类型", variant: "default" },
          { id: "cancel", label: "取消", variant: "default" },
        ],
        defaultChoiceId: "adopt-selected",
      });
      if (choice.choiceId === null || choice.choiceId === "cancel") {
        setStatus("已取消扫描");
        return;
      }
      if (choice.choiceId === "adopt-selected" && choice.checkedIds.length > 0) {
        adoptExtensions = choice.checkedIds;
      }
    }
  } catch (e) {
    shell.appendLog(`[Code 索引] 后缀发现失败：${String(e)}`, { source: "code_index" });
  }

  scanning.value = true;
  shell.appendLog("[Code 索引] 扫描工作空间…", { source: "code_index", open: true });
  try {
    const out = await scanCodeIndex({ adoptExtensions });
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

async function onPurgeMissing() {
  const n = missingCount.value;
  if (n <= 0) {
    setStatus("当前没有缺失条目");
    return;
  }
  const choice = await promptChoice({
    title: "删除缺失记录",
    defaultChoiceId: "cancel",
    message:
      `将从 Code 索引库永久删除 ${n} 条「缺失」记录（磁盘上已不存在的文件）。\n\n此操作不可撤销。`,
    choices: [
      { id: "cancel", label: "取消", variant: "default" },
      { id: "confirm", label: `删除 ${n} 条`, variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;
  purging.value = true;
  shell.appendLog(`[Code 索引] 删除缺失记录 ${n} 条…`, { source: "code_index", open: true });
  try {
    const out = await purgeMissingCodeIndex();
    data.value = out;
    const deleted = out.purge_deleted ?? 0;
    const msg = deleted ? `已删除 ${deleted} 条缺失记录` : "没有缺失记录可删除";
    shell.appendLog(`[Code 索引] ${msg}`, { source: "code_index" });
    setStatus(msg);
    if (deleted && statusFilter.value === "missing") {
      statusFilter.value = "all";
    }
    pageOffset.value = 0;
    await loadEntries();
  } catch (e) {
    shell.appendLog(String(e), { source: "code_index" });
    setStatus(String(e));
  } finally {
    purging.value = false;
  }
}

async function onExportJson() {
  if (!hasScan.value) {
    setStatus("请先执行工程内搜索");
    return;
  }
  exporting.value = true;
  shell.appendLog("[Code 索引] 导出 code_index.json…", { source: "code_index", open: true });
  try {
    const out = await exportCodeIndexJson();
    shell.appendLog(`已导出 → ${out.path_display}`, { source: "code_index" });
    setStatus(`已导出 code_index.json → ${out.path_display}`);
  } catch (e) {
    shell.appendLog(String(e), { source: "code_index" });
    setStatus(String(e));
  } finally {
    exporting.value = false;
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

function onPagerCurrentChange(page: number) {
  pageOffset.value = (page - 1) * pageSize.value;
  void loadEntries();
}

function onPagerSizeChange(size: number) {
  if (!PAGE_SIZE_OPTIONS.includes(size as (typeof PAGE_SIZE_OPTIONS)[number])) return;
  pageSize.value = size;
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
    <PageHeader title="Code 索引" page-id="code_index">
      <template #actions>
        <div data-tour-page-code-scan class="head-actions-inner">
          <el-select
            v-model="filterWorksetId"
            size="small"
            placeholder="全工作空间"
            clearable
            style="width: 150px"
          >
            <el-option label="全部" value="" />
            <el-option
              v-for="w in worksetStore.worksetOptions"
              :key="w.id"
              :label="`${w.label}（${w.count}）`"
              :value="w.id"
            />
          </el-select>
          <el-button type="primary" size="small" :loading="scanning" @click="onScan">工程内搜索</el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :loading="purging"
            :disabled="!missingCount"
            @click="onPurgeMissing"
          >
            删除缺失{{ missingCount ? `（${missingCount}）` : "" }}
          </el-button>
          <el-button size="small" :loading="exporting" :disabled="!hasScan" @click="onExportJson">
            导出 JSON
          </el-button>
          <el-button size="small" :loading="loading" @click="refresh()">刷新</el-button>
        </div>
      </template>
    </PageHeader>

    <div class="index-panel">
      <section class="index-toolbar">
        <el-input
          id="code-index-search"
          v-model="searchQuery"
          size="small"
          clearable
          type="search"
          spellcheck="false"
          :placeholder="searchPlaceholder"
          class="search-field"
        />
        <el-radio-group v-model="searchMode" size="small" class="search-mode-group">
          <el-radio-button v-for="opt in SEARCH_MODE_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
      </section>

      <section class="filter-bar">
        <div class="filter-group">
          <span class="filter-label">状态</span>
          <el-radio-group v-model="statusFilter" size="small">
            <el-radio-button v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-group">
          <span class="filter-label">类型</span>
          <el-radio-group v-model="kindFilter" size="small">
            <el-radio-button v-for="opt in KIND_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <span v-if="entriesTotal > 0" class="count">
          显示 <strong>{{ pageOffset + 1 }}–{{ pageEnd }}</strong> / {{ entriesTotal }} 条
        </span>
        <div v-if="filteredEntries.length" class="workset-actions">
          <el-button size="small" @click="toggleAllPage(!allPageChecked)">
            {{ allPageChecked ? "取消全选" : "全选本页" }}
          </el-button>
          <el-button size="small" :disabled="!selectedCount" @click="addSelectedToWorkset">
            勾选加入工作集{{ selectedCount ? `（${selectedCount}）` : "" }}
          </el-button>
          <el-button size="small" @click="addPageToWorkset">本页全部加入</el-button>
        </div>
      </section>

      <div class="table-area" data-tour-page-code-table>
        <ResizableDataTable v-if="filteredEntries.length" :columns="columns" wrap-class="table-grow">
          <tbody>
            <tr
              v-for="(row, idx) in filteredEntries"
              :key="row.repo_rel_path + row.file_status"
              :class="row.file_status"
            >
              <td class="col-check">
                <el-checkbox
                  :model-value="selectedPaths.has(row.repo_rel_path)"
                  @change="toggleRow(row.repo_rel_path, Boolean($event))"
                />
              </td>
              <td class="col-index">{{ pageOffset + idx + 1 }}</td>
              <td>
                <el-tag size="small" :type="row.file_status === 'present' ? 'success' : 'warning'" effect="plain">
                  {{ statusLabel(row) }}
                </el-tag>
              </td>
              <td>
                <el-tag size="small" effect="plain">{{ kindLabel(row) }}</el-tag>
              </td>
              <td class="mono file-cell" :title="row.repo_rel_path">{{ row.filename }}</td>
              <td class="mono">{{ row.file_ext || "—" }}</td>
              <td class="mono encoding-cell" :title="row.text_encoding || ''">{{ encodingLabel(row) }}</td>
              <td class="mono">{{ formatSize(row.size_bytes) }}</td>
              <td class="mono dir-cell">{{ relDir(row) }}</td>
            </tr>
          </tbody>
        </ResizableDataTable>
        <el-empty
          v-else-if="entriesLoading || loading"
          class="empty-wrap table-grow"
          description="加载索引列表…"
          :image-size="72"
        />
        <el-empty
          v-else
          class="empty-wrap table-grow"
          :description="
            hasScan
              ? searchQuery.trim()
                ? '无匹配条目，请调整搜索或筛选'
                : '当前筛选无条目'
              : '尚未扫描；点击「工程内搜索」建立 Code 索引'
          "
          :image-size="72"
        />
      </div>

      <el-pagination
        v-if="hasScan && entriesTotal > 0"
        class="pager"
        size="small"
        layout="total, sizes, prev, pager, next"
        :total="entriesTotal"
        :page-size="pageSize"
        :current-page="currentPage"
        :page-sizes="[...PAGE_SIZE_OPTIONS]"
        :disabled="entriesLoading"
        @current-change="onPagerCurrentChange"
        @size-change="onPagerSizeChange"
      />
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

.index-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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

.workset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.col-check {
  text-align: center;
  width: 36px;
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
