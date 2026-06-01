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

const SESSION_V = 3;

type PageSubTab = "index" | "settings";

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
  { key: "dir", label: "相对目录", width: 140, minWidth: 80 },
  { key: "meta", label: "属性摘要", width: 220, minWidth: 120 },
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

const activeSubTab = ref<PageSubTab>("index");
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
  shell.appendLog(`工程内搜索：${scanRoot.value.trim()}`, { source: "fcstd_map", open: true });
  try {
    data.value = await scanFcstdMap(scanRoot.value.trim(), forceUpdatePartName.value);
    scanRoot.value = data.value.prefs.scan_root || ".";
    shell.appendLog(data.value.scan_log ?? "", { source: "fcstd_map" });
    setStatus(
      `扫描完成：存在 ${data.value.stats.present} · CAD ${data.value.stats.cad_file_count}`,
    );
    activeSubTab.value = "index";
  } catch (e) {
    shell.appendLog(String(e), { source: "fcstd_map" });
    setStatus(String(e));
  } finally {
    scanning.value = false;
  }
}

async function onExportJson() {
  exporting.value = true;
  shell.appendLog("[CAD索引] 导出 fcstd_map.json…", { source: "fcstd_map", open: true });
  try {
    const out = await exportFcstdMapJson();
    shell.appendLog(`已导出 → ${out.path_display}`, { source: "fcstd_map" });
    setStatus(`已导出 fcstd_map.json（仅 FCStd）→ ${out.path_display}`);
    await refresh();
  } catch (e) {
    shell.appendLog(String(e), { source: "fcstd_map" });
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

function canOpenFileDetail(row: FcstdMapEntry) {
  return (
    row.file_status === "present" &&
    (row.asset_kind === "fcstd" || /\.fcstd$/i.test(row.filename))
  );
}

function openFileDetail(row: FcstdMapEntry) {
  const rel = row.repo_rel_path?.trim();
  if (!rel || !canOpenFileDetail(row)) return;
  shell.openFileDetailForRel(rel);
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
  if (snap.v !== SESSION_V && snap.v !== 2) return false;
  if (snap.subTab === "index" || snap.subTab === "settings") {
    activeSubTab.value = snap.subTab;
  }
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
    subTab: activeSubTab.value,
    scanRoot: scanRoot.value,
    forceUpdatePartName: forceUpdatePartName.value,
    statusFilter: statusFilter.value,
    kindFilter: kindFilter.value,
    searchQuery: searchQuery.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch([scanRoot, forceUpdatePartName, statusFilter, kindFilter, searchQuery, activeSubTab], () =>
  shell.scheduleWorkbenchSave(),
);

onMounted(() => applyInitialTabState());
</script>

<template>
  <div class="page fcstd-map-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">CAD 索引</h1>
        <p v-if="stats" class="head-stats">
          条目 {{ stats.total_entries }} ·
          <span class="ok">存在 {{ stats.present }}</span> ·
          <span class="warn">缺失 {{ stats.missing }}</span>
        </p>
      </div>
    </header>

    <nav class="sub-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'index' }"
        @click="activeSubTab = 'index'"
      >
        索引列表
      </button>
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'settings' }"
        @click="activeSubTab = 'settings'"
      >
        扫描设置
      </button>
    </nav>

    <div v-show="activeSubTab === 'index'" class="sub-panel">
      <section class="index-toolbar">
        <div class="search-row">
          <input
            id="cad-index-search"
            v-model="searchQuery"
            class="search-input"
            type="search"
            spellcheck="false"
            placeholder="搜索文件名、PartKey、路径…"
          />
          <button v-if="searchQuery.trim()" type="button" class="btn mini" @click="searchQuery = ''">
            清除
          </button>
        </div>
        <div class="action-row">
          <button type="button" class="btn primary" :disabled="scanning" @click="onScan">
            {{ scanning ? "扫描中…" : "工程内搜索" }}
          </button>
          <button type="button" class="btn" :disabled="loading" @click="refresh">刷新</button>
        </div>
      </section>

      <section class="filters">
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
            <td class="mono">
              <button
                v-if="canOpenFileDetail(row)"
                type="button"
                class="link-key"
                :title="row.repo_rel_path"
                @click="openFileDetail(row)"
              >
                {{ row.filename }}
              </button>
              <span v-else>{{ row.filename }}</span>
            </td>
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
            <td class="mono">{{ relDir(row) }}</td>
            <td class="meta">{{ metaCell(row) }}</td>
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

    <div v-show="activeSubTab === 'settings'" class="sub-panel settings-panel">
      <section class="settings-block">
        <h2 class="block-title">扫描</h2>
        <p class="block-desc">
          扫描工程内 FCStd、Markdown、PDF、图片、DXF/DWG 等，写入
          <code>.phoenix/cad-database.sqlite</code>。再次扫描时磁盘上已不存在的条目标记为缺失。
        </p>
        <label class="field-label" for="scan-root">扫描根目录</label>
        <div class="row">
          <input id="scan-root" v-model="scanRoot" class="path-input" spellcheck="false" placeholder="." />
          <button type="button" class="btn" :disabled="saving" @click="onSavePrefs">
            {{ saving ? "…" : "保存偏好" }}
          </button>
          <button type="button" class="btn primary" :disabled="scanning" @click="onScan">
            {{ scanning ? "扫描中…" : "工程内搜索" }}
          </button>
        </div>
        <label class="force-opt">
          <input v-model="forceUpdatePartName" type="checkbox" />
          强制更新 PartName
        </label>
        <p class="hint">
          PartName 默认仅在为空时从 label/文件名推断；勾选后重新扫描会覆盖索引中已有 PartName（不写回 FCStd）。
        </p>
      </section>

      <section class="settings-block">
        <h2 class="block-title">导出</h2>
        <p class="block-desc">
          导出 <code>fcstd_map.json</code> 仅含 FCStd 条目，供 xlink 脚本等外部工具使用。
        </p>
        <button
          type="button"
          class="btn"
          :disabled="exporting || !data?.exists"
          @click="onExportJson"
        >
          {{ exporting ? "导出中…" : "导出 fcstd_map.json" }}
        </button>
      </section>

      <section v-if="stats" class="settings-block">
        <h2 class="block-title">统计</h2>
        <dl class="stats-grid">
          <dt>条目</dt><dd>{{ stats.total_entries }}</dd>
          <dt>存在</dt><dd class="ok">{{ stats.present }}</dd>
          <dt>缺失</dt><dd class="warn">{{ stats.missing }}</dd>
          <dt>CAD 文件</dt><dd>{{ stats.cad_file_count }}</dd>
          <dt>FCStd</dt><dd>{{ stats.fcstd_file_count }}</dd>
          <dt>MD</dt><dd>{{ stats.markdown_file_count }}</dd>
          <dt>PDF</dt><dd>{{ stats.pdf_file_count }}</dd>
          <dt>DXF/DWG</dt><dd>{{ stats.cad_exchange_file_count }}</dd>
          <dt>图片</dt><dd>{{ stats.image_file_count }}</dd>
          <dt>重名</dt><dd>{{ stats.duplicate_filename_kinds }}</dd>
        </dl>
      </section>

      <section v-if="data" class="settings-block meta-block">
        <h2 class="block-title">路径</h2>
        <p v-if="data.database_path_display" class="meta-line">数据库：{{ data.database_path_display }}</p>
        <p v-if="data.map_path_display" class="meta-line">JSON：{{ data.map_path_display }}</p>
        <p v-if="data.last_scan_at" class="meta-line">上次扫描：{{ data.last_scan_at }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.fcstd-map-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
  height: 100%;
}

.page-head {
  flex-shrink: 0;
  margin-bottom: 10px;
}

.head-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.page-title {
  margin: 0;
  font-size: 1.1rem;
}

.head-stats {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.head-stats .ok {
  color: #15803d;
}

.head-stats .warn {
  color: #b45309;
}

.sub-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.sub-tab {
  padding: 8px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--muted);
  margin-bottom: -1px;
}

.sub-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.sub-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.index-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 220px;
}

.search-input {
  flex: 1;
  min-width: 160px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.action-row {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.82rem;
  flex-shrink: 0;
}

.filter {
  display: flex;
  align-items: center;
  gap: 4px;
}

.filter-sep {
  color: var(--muted);
}

.count {
  color: var(--muted);
  margin-left: auto;
}

.settings-panel {
  overflow: auto;
  gap: 16px;
  padding-bottom: 8px;
}

.settings-block {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.block-title {
  margin: 0 0 8px;
  font-size: 0.92rem;
}

.block-desc {
  margin: 0 0 12px;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
  max-width: 720px;
}

.field-label {
  display: block;
  font-size: 0.78rem;
  color: var(--muted);
  margin-bottom: 6px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.path-input {
  flex: 1;
  min-width: 180px;
  max-width: 420px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.force-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text);
}

.hint {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.45;
  max-width: 720px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 100px 1fr 100px 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 0.85rem;
}

.stats-grid dt {
  margin: 0;
  color: var(--muted);
}

.stats-grid dd {
  margin: 0;
}

.stats-grid .ok {
  color: #15803d;
}

.stats-grid .warn {
  color: #b45309;
}

.meta-block .meta-line {
  margin: 0 0 6px;
  font-size: 0.78rem;
  color: var(--muted);
  word-break: break-all;
}

.meta-block .meta-line:last-child {
  margin-bottom: 0;
}

.btn {
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.btn.mini {
  padding: 6px 10px;
  font-size: 0.78rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.55;
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
