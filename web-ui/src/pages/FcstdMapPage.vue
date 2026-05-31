<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  exportFcstdMapJson,
  fetchFcstdMap,
  saveFcstdMapPrefs,
  scanFcstdMap,
  type FcstdMapEntry,
  type FcstdMapPayload,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { TableColumnDef } from "../composables/useResizableTable";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const SESSION_V = 2;

const cadColumns: TableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "status", label: "状态", width: 52, minWidth: 44 },
  { key: "kind", label: "类型", width: 72, minWidth: 56 },
  { key: "file", label: "文件名", width: 200, minWidth: 100 },
  { key: "partKey", label: "PartKey", width: 108, minWidth: 80 },
  { key: "partVersion", label: "PartVersion", width: 88, minWidth: 72 },
  { key: "typeCode", label: "TypeCode", width: 72, minWidth: 56 },
  { key: "modelSeries", label: "ModelSeries", width: 96, minWidth: 72 },
  { key: "partName", label: "PartName", width: 120, minWidth: 80 },
  { key: "label", label: "label", width: 120, minWidth: 80 },
  { key: "meta", label: "属性摘要", width: 220, minWidth: 120 },
  { key: "dir", label: "相对目录", width: 140, minWidth: 80 },
];

const KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "fcstd", label: "FCStd" },
  { value: "markdown", label: "MD" },
  { value: "pdf", label: "PDF" },
  { value: "cad_exchange", label: "DXF/DWG" },
  { value: "image", label: "图片" },
] as const;

type KindFilter = (typeof KIND_OPTIONS)[number]["value"];

const scanRoot = ref(".");
const forceUpdatePartName = ref(false);
const loading = ref(false);
const scanning = ref(false);
const saving = ref(false);
const exporting = ref(false);
const data = ref<FcstdMapPayload | null>(null);
const statusFilter = ref<"all" | "present" | "missing">("all");
const kindFilter = ref<KindFilter>("all");
const searchQuery = ref("");

const stats = computed(() => data.value?.stats);

const baseEntries = computed(() => {
  let rows = data.value?.entries ?? [];
  if (statusFilter.value !== "all") {
    rows = rows.filter((r) => r.file_status === statusFilter.value);
  }
  if (kindFilter.value !== "all") {
    rows = rows.filter((r) => (r.asset_kind || "fcstd") === kindFilter.value);
  }
  return rows;
});

function setStatus(msg: string) {
  shell.setStatus(msg);
}

function assetKindLabel(row: FcstdMapEntry) {
  const map: Record<string, string> = {
    fcstd: "FCStd",
    markdown: "MD",
    pdf: "PDF",
    cad_exchange: "DXF/DWG",
    image: "图片",
    other: "其他",
  };
  return map[row.asset_kind] ?? row.asset_kind ?? "—";
}

async function refresh() {
  loading.value = true;
  try {
    data.value = await fetchFcstdMap();
    scanRoot.value = data.value.prefs.scan_root || ".";
    forceUpdatePartName.value = Boolean(data.value.prefs.force_update_part_name);
    setStatus(data.value.exists ? `索引 ${data.value.stats.total_entries} 条` : "尚无索引库");
  } catch (e) {
    setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function onSavePrefs() {
  saving.value = true;
  try {
    const prefs = await saveFcstdMapPrefs(scanRoot.value.trim(), forceUpdatePartName.value);
    scanRoot.value = prefs.scan_root;
    forceUpdatePartName.value = Boolean(prefs.force_update_part_name);
    setStatus("已保存扫描根偏好");
  } catch (e) {
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onScan() {
  scanning.value = true;
  shell.appendLog(`工程内搜索：${scanRoot.value.trim()}`, { source: "fcstd_map" });
  try {
    data.value = await scanFcstdMap(scanRoot.value.trim(), forceUpdatePartName.value);
    scanRoot.value = data.value.prefs.scan_root || ".";
    shell.appendLog(data.value.scan_log ?? "", { source: "fcstd_map" });
    setStatus(
      `扫描完成：存在 ${data.value.stats.present} · CAD ${data.value.stats.cad_file_count}`,
    );
  } catch (e) {
    shell.appendLog(String(e), { source: "fcstd_map" });
    setStatus(String(e));
  } finally {
    scanning.value = false;
  }
}

async function onExportJson() {
  exporting.value = true;
  try {
    const out = await exportFcstdMapJson();
    setStatus(`已导出 fcstd_map.json（仅 FCStd）→ ${out.path_display}`);
    await refresh();
  } catch (e) {
    setStatus(String(e));
  } finally {
    exporting.value = false;
  }
}

function statusLabel(row: FcstdMapEntry) {
  return row.file_status === "missing" ? "缺失" : "存在";
}

function partKeyLabel(row: FcstdMapEntry) {
  if (!row.PartNumber || !row.PartVersion) return "";
  return `${row.PartNumber}.${row.PartVersion}`;
}

function openPartKey(row: FcstdMapEntry) {
  if (!row.PartNumber || !row.PartVersion) return;
  shell.openPartKeyDetail(row.PartNumber, row.PartVersion);
}

function metaCell(row: FcstdMapEntry) {
  if (row.asset_kind && row.asset_kind !== "fcstd") return "—";
  return [row.PartNumber, row.PartVersion, row.TypeCode, row.ModelSeries, row.PartName, row.label]
    .filter(Boolean)
    .join(" · ");
}

function relDir(row: FcstdMapEntry): string {
  const p = row.repo_rel_path.replace(/\\/g, "/").replace(/^\.\//, "");
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  const dir = p.slice(0, i);
  return dir || ".";
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[^\w.\-+]/g, " ");
}

function entrySearchHaystack(row: FcstdMapEntry): string {
  return normalizeSearchText(
    [
      row.filename,
      row.repo_rel_path,
      row.PartNumber,
      row.PartVersion,
      row.TypeCode,
      row.ModelSeries,
      row.PartName,
      row.label,
      row.asset_kind,
      assetKindLabel(row),
      statusLabel(row),
      partKeyLabel(row),
      relDir(row),
      metaCell(row),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function entryMatchesSearch(row: FcstdMapEntry, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const hay = entrySearchHaystack(row);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => {
    if (hay.includes(token)) return true;
    const norm = normalizeSearchText(token).trim();
    return norm.length > 0 && hay.includes(norm);
  });
}

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) return baseEntries.value;
  return baseEntries.value.filter((r) => entryMatchesSearch(r, q));
});

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V) return false;
  if (snap.scanRoot != null) scanRoot.value = String(snap.scanRoot);
  if (typeof snap.forceUpdatePartName === "boolean") {
    forceUpdatePartName.value = snap.forceUpdatePartName;
  }
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
  await refresh();
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
    scanRoot: scanRoot.value,
    forceUpdatePartName: forceUpdatePartName.value,
    statusFilter: statusFilter.value,
    kindFilter: kindFilter.value,
    searchQuery: searchQuery.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch([scanRoot, forceUpdatePartName, statusFilter, kindFilter, searchQuery], () =>
  shell.scheduleWorkbenchSave(),
);

onMounted(() => applyInitialTabState());
</script>

<template>
  <div class="page fcstd-map-page">
    <header class="page-head">
      <h1 class="page-title">CAD 索引</h1>
      <p class="page-desc">
        扫描工程内 <strong>FCStd、Markdown、PDF、图片、DXF/DWG</strong> 等，写入
        <code>.phoenix/cad-database.sqlite</code>。FCStd 会采集 BOM 属性；再次扫描时磁盘上已不存在的条目标记为
        <strong>缺失</strong>。导出 <code>fcstd_map.json</code> 仍<strong>仅含 FCStd</strong>（供 xlink 脚本）。
      </p>
    </header>

    <section class="controls">
      <label class="field-label" for="scan-root">扫描根目录</label>
      <div class="row">
        <input id="scan-root" v-model="scanRoot" class="path-input" spellcheck="false" placeholder="." />
        <button type="button" class="btn" :disabled="saving" @click="onSavePrefs">
          {{ saving ? "…" : "保存偏好" }}
        </button>
        <button type="button" class="btn primary" :disabled="scanning" @click="onScan">
          {{ scanning ? "扫描中…" : "工程内搜索" }}
        </button>
        <label class="force-opt">
          <input v-model="forceUpdatePartName" type="checkbox" />
          强制更新 PartName
        </label>
        <button type="button" class="btn" :disabled="loading" @click="refresh">刷新表格</button>
        <button
          type="button"
          class="btn"
          :disabled="exporting || !data?.exists"
          @click="onExportJson"
        >
          {{ exporting ? "导出中…" : "导出 fcstd_map.json" }}
        </button>
      </div>
      <p class="meta-line hint-line">
        PartName：默认仅在为空时从 label/文件名智能去前缀；勾选「强制更新」后重新扫描会覆盖索引中已有 PartName（不写回 FCStd 文件）。
      </p>
      <p v-if="data?.database_path_display" class="meta-line">数据库：{{ data.database_path_display }}</p>
      <p v-if="data?.map_path_display" class="meta-line">JSON 导出路径：{{ data.map_path_display }}</p>
      <p v-if="data?.last_scan_at" class="meta-line">上次扫描：{{ data.last_scan_at }}</p>
    </section>

    <section v-if="stats" class="stats">
      <span>条目 {{ stats.total_entries }}</span>
      <span class="ok">存在 {{ stats.present }}</span>
      <span class="warn">缺失 {{ stats.missing }}</span>
      <span>CAD {{ stats.cad_file_count }}</span>
      <span>FCStd {{ stats.fcstd_file_count }}</span>
      <span>MD {{ stats.markdown_file_count }}</span>
      <span>PDF {{ stats.pdf_file_count }}</span>
      <span>DXF/DWG {{ stats.cad_exchange_file_count }}</span>
      <span>图片 {{ stats.image_file_count }}</span>
      <span>重名 {{ stats.duplicate_filename_kinds }}</span>
    </section>

    <section class="filters">
      <div class="search-row">
        <label class="search-label" for="cad-index-search">搜索</label>
        <input
          id="cad-index-search"
          v-model="searchQuery"
          class="search-input"
          type="search"
          spellcheck="false"
          placeholder="文件名、PartKey、路径、PartName… 空格分隔多关键词"
        />
        <button v-if="searchQuery.trim()" type="button" class="btn-clear" @click="searchQuery = ''">
          清除
        </button>
      </div>
      <div class="filter-row">
      <label class="filter">
        <input v-model="statusFilter" type="radio" value="all" /> 全部
      </label>
      <label class="filter">
        <input v-model="statusFilter" type="radio" value="present" /> 存在
      </label>
      <label class="filter">
        <input v-model="statusFilter" type="radio" value="missing" /> 缺失
      </label>
      <span class="filter-sep">|</span>
      <label v-for="opt in KIND_OPTIONS" :key="opt.value" class="filter">
        <input v-model="kindFilter" type="radio" :value="opt.value" /> {{ opt.label }}
      </label>
      <span class="count">
        显示 <strong>{{ filteredEntries.length }}</strong>
        <template v-if="searchQuery.trim()"> / {{ baseEntries.length }}</template>
        条
      </span>
      </div>
    </section>

    <ResizableDataTable v-if="filteredEntries.length" :columns="cadColumns" wrap-class="table-grow">
      <tbody>
        <tr
          v-for="(row, idx) in filteredEntries"
          :key="row.repo_rel_path + row.file_status"
          :class="row.file_status"
        >
          <td class="col-index">{{ idx + 1 }}</td>
          <td>{{ statusLabel(row) }}</td>
          <td>{{ assetKindLabel(row) }}</td>
          <td class="mono">{{ row.filename }}</td>
          <td class="mono">
            <button
              v-if="partKeyLabel(row)"
              type="button"
              class="link-key"
              @click="openPartKey(row)"
            >
              {{ partKeyLabel(row) }}
            </button>
            <span v-else>{{ row.PartNumber }}</span>
          </td>
          <td class="mono">{{ row.PartVersion }}</td>
          <td>{{ row.TypeCode }}</td>
          <td>{{ row.ModelSeries }}</td>
          <td>{{ row.PartName }}</td>
          <td>{{ row.label }}</td>
          <td class="meta">{{ metaCell(row) }}</td>
          <td class="mono">{{ relDir(row) }}</td>
        </tr>
      </tbody>
    </ResizableDataTable>
    <div v-else-if="!loading" class="table-wrap table-grow empty-wrap">
      <p class="empty">
        {{
          data?.exists
            ? searchQuery.trim()
              ? "无匹配条目，请调整搜索或筛选"
              : "当前筛选无条目"
            : "尚无索引，点击「工程内搜索」开始扫描"
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.fcstd-map-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 22px 16px;
}

.page-head {
  flex-shrink: 0;
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
  line-height: 1.55;
  max-width: 880px;
}

.controls {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.field-label {
  display: block;
  font-size: 0.82rem;
  color: var(--muted);
  margin-bottom: 6px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.path-input {
  flex: 1;
  min-width: 180px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.btn {
  padding: 8px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.85rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.55;
}

.meta-line {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.hint-line {
  max-width: 880px;
  line-height: 1.45;
}

.force-opt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--muted);
  user-select: none;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 0.85rem;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.stats .ok {
  color: #15803d;
}

.stats .warn {
  color: #b45309;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-label {
  font-size: 0.82rem;
  color: var(--muted);
  white-space: nowrap;
}

.search-input {
  flex: 1;
  min-width: 200px;
  max-width: 560px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.btn-clear {
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.78rem;
  color: var(--muted);
  cursor: pointer;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.filter {
  display: flex;
  align-items: center;
  gap: 4px;
}

.filter-sep {
  color: var(--muted);
  margin: 0 4px;
}

.count {
  color: var(--muted);
  margin-left: auto;
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

:deep(.resizable-data-table tr.missing) {
  background: #fff7ed;
}

:deep(.resizable-data-table tr.missing td:nth-child(2)) {
  color: #c2410c;
  font-weight: 600;
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

.meta {
  color: #64748b;
}

.link-key {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  text-decoration: underline;
}

.link-key:hover {
  color: #1d4ed8;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
}

code {
  font-size: 0.9em;
}
</style>
