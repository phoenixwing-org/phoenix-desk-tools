<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  exportFcstdMapJson,
  fetchFcstdMap,
  saveFcstdMapPrefs,
  scanFcstdMap,
  type FcstdMapEntry,
  type FcstdMapPayload,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const scanRoot = ref(".");
const loading = ref(false);
const scanning = ref(false);
const saving = ref(false);
const exporting = ref(false);
const data = ref<FcstdMapPayload | null>(null);
const statusFilter = ref<"all" | "present" | "missing">("all");
const logText = ref("");

const stats = computed(() => data.value?.stats);
const entries = computed(() => {
  const rows = data.value?.entries ?? [];
  if (statusFilter.value === "all") return rows;
  return rows.filter((r) => r.file_status === statusFilter.value);
});

function setStatus(msg: string) {
  shell.setStatus(msg);
}

async function refresh() {
  loading.value = true;
  try {
    data.value = await fetchFcstdMap();
    scanRoot.value = data.value.prefs.scan_root || ".";
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
    const prefs = await saveFcstdMapPrefs(scanRoot.value.trim());
    scanRoot.value = prefs.scan_root;
    setStatus("已保存扫描根偏好");
  } catch (e) {
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onScan() {
  scanning.value = true;
  logText.value = "";
  try {
    data.value = await scanFcstdMap(scanRoot.value.trim());
    scanRoot.value = data.value.prefs.scan_root || ".";
    logText.value = data.value.scan_log ?? "";
    setStatus(
      `扫描完成：存在 ${data.value.stats.present} · 缺失 ${data.value.stats.missing}`,
    );
  } catch (e) {
    setStatus(String(e));
  } finally {
    scanning.value = false;
  }
}

async function onExportJson() {
  exporting.value = true;
  try {
    const out = await exportFcstdMapJson();
    setStatus(`已导出 fcstd_map.json → ${out.path_display}`);
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

function metaCell(row: FcstdMapEntry) {
  return [row.PartNumber, row.PartVersion, row.TypeCode, row.ModelSeries, row.PartName, row.label]
    .filter(Boolean)
    .join(" · ");
}

onMounted(() => refresh());
</script>

<template>
  <div class="page fcstd-map-page">
    <header class="page-head">
      <h1 class="page-title">FCStd 索引</h1>
      <p class="page-desc">
        扫描工程内 *.FCStd，写入
        <code>.phoenix/cad-database.sqlite</code>（数据库为真源）；采集 BOM 属性字段。再次扫描时磁盘上已不存在的条目标记为
        <strong>缺失</strong>。需要与 xlink 脚本或外部工具对接时，按需导出 <code>fcstd_map.json</code>。
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
      <p v-if="data?.database_path_display" class="meta-line">数据库：{{ data.database_path_display }}</p>
      <p v-if="data?.map_path_display" class="meta-line">JSON 导出路径：{{ data.map_path_display }}</p>
      <p v-if="data?.last_scan_at" class="meta-line">上次扫描：{{ data.last_scan_at }}</p>
    </section>

    <section v-if="stats" class="stats">
      <span>条目 {{ stats.total_entries }}</span>
      <span class="ok">存在 {{ stats.present }}</span>
      <span class="warn">缺失 {{ stats.missing }}</span>
      <span>FCStd {{ stats.fcstd_file_count }}</span>
      <span>重名种类 {{ stats.duplicate_filename_kinds }}</span>
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
      <span class="count">{{ entries.length }} 行</span>
    </section>

    <div class="table-wrap">
      <table v-if="entries.length" class="data-table">
        <thead>
          <tr>
            <th>状态</th>
            <th>相对路径</th>
            <th>文件名</th>
            <th>PartNumber</th>
            <th>PartVersion</th>
            <th>TypeCode</th>
            <th>ModelSeries</th>
            <th>PartName</th>
            <th>label</th>
            <th>属性摘要</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in entries" :key="row.repo_rel_path + row.file_status" :class="row.file_status">
            <td>{{ statusLabel(row) }}</td>
            <td class="mono">{{ row.repo_rel_path }}</td>
            <td>{{ row.filename }}</td>
            <td>{{ row.PartNumber }}</td>
            <td>{{ row.PartVersion }}</td>
            <td>{{ row.TypeCode }}</td>
            <td>{{ row.ModelSeries }}</td>
            <td>{{ row.PartName }}</td>
            <td>{{ row.label }}</td>
            <td class="meta">{{ metaCell(row) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading" class="empty">
        {{ data?.exists ? "当前筛选无条目" : "尚无索引，点击「工程内搜索」开始扫描" }}
      </p>
    </div>

    <pre v-if="logText" class="log">{{ logText }}</pre>
  </div>
</template>

<style scoped>
.fcstd-map-page {
  padding: 20px 22px 32px;
  min-height: 100%;
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
  line-height: 1.55;
  max-width: 880px;
}

.controls {
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
}

.stats .ok {
  color: #15803d;
}

.stats .warn {
  color: #b45309;
}

.filters {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.85rem;
}

.filter {
  display: flex;
  align-items: center;
  gap: 4px;
}

.count {
  color: var(--muted);
  margin-left: auto;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  max-height: calc(100vh - 320px);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.data-table th,
.data-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #eee;
  text-align: left;
  vertical-align: top;
}

.data-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  white-space: nowrap;
}

.data-table tr.missing {
  background: #fff7ed;
}

.data-table tr.missing td:first-child {
  color: #c2410c;
  font-weight: 600;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.meta {
  color: #64748b;
  max-width: 220px;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
}

.log {
  margin-top: 12px;
  padding: 10px 12px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 8px;
  font-size: 0.78rem;
  white-space: pre-wrap;
}

code {
  font-size: 0.9em;
}
</style>
