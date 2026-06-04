<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchPartKeys, type PartKeyEntry, type PartKeysPayload } from "../api";
import { BOM_FIELD_LABELS as L } from "../utils/bomFieldLabels";
import { useAppShell } from "../composables/useAppShell";
import { basenameFromRel, normalizeRepoRelForApi } from "../utils/workspaceFileQuery";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { TableColumnDef } from "../composables/useResizableTable";

const shell = useAppShell();

const catalogColumns = computed<TableColumnDef[]>(() => [
  { key: "label", label: L.label, width: 160, minWidth: 100 },
  { key: "partKey", label: L.partKey, width: 108, minWidth: 80 },
  { key: "typeCode", label: L.typeCode, width: 56, minWidth: 48 },
  { key: "modelSeries", label: L.modelSeries, width: 96, minWidth: 72 },
  { key: "partName", label: L.partName, width: 140, minWidth: 80 },
  { key: "status", label: "状态", width: 56, minWidth: 48 },
  { key: "files", label: "文件", width: 56, minWidth: 48 },
  { key: "counts", label: "存在/缺失", width: 88, minWidth: 72 },
]);

const loading = ref(false);
const listData = ref<PartKeysPayload | null>(null);
const statusFilter = ref<"all" | "active" | "obsolete">("all");
const search = ref("");

const filteredEntries = computed(() => {
  const rows = listData.value?.entries ?? [];
  const q = search.value.trim().toLowerCase();
  return rows.filter((row) => {
    if (statusFilter.value !== "all" && row.status !== statusFilter.value) return false;
    if (!q) return true;
    const hay = [
      row.part_key,
      row.PartName,
      row.label,
      row.TypeCode,
      row.ModelSeries,
      row.notes,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

function setStatus(msg: string) {
  shell.setStatus(msg);
}

async function refreshList() {
  loading.value = true;
  shell.appendLog("[零件目录] 刷新列表…", { source: "part_catalog", open: true });
  try {
    listData.value = await fetchPartKeys();
    const msg = listData.value.exists
      ? `零件目录 ${listData.value.stats.total_keys} 键 · ${listData.value.stats.total_files} 文件`
      : "尚无零件目录，请先执行 CAD 索引扫描";
    shell.appendLog(msg, { source: "part_catalog" });
    setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "part_catalog" });
    setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

function openDetail(row: PartKeyEntry) {
  shell.openPartKeyDetail(row.part_number, row.part_version, {
    partName: row.PartName,
    label: row.label,
  });
}

onMounted(() => refreshList());
</script>

<template>
  <div class="page part-catalog-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">零件目录</h1>
        <p class="page-desc">
          以 <code>零件号.版本</code> 为唯一键聚合关联文件。点击<strong>标签</strong>或<strong>零件标识</strong>打开零件详情（同键复用 Tab，不重复开）。
        </p>
      </div>
    </header>

    <section class="controls">
      <input v-model="search" class="path-input" placeholder="搜索零件号、名称、备注…" spellcheck="false" />
      <button type="button" class="btn" :disabled="loading" @click="refreshList">刷新</button>
    </section>

    <section class="filters">
      <label class="filter"><input v-model="statusFilter" type="radio" value="all" /> 全部</label>
      <label class="filter"><input v-model="statusFilter" type="radio" value="active" /> 有效</label>
      <label class="filter"><input v-model="statusFilter" type="radio" value="obsolete" /> 失效</label>
      <span class="count">{{ filteredEntries.length }} 键</span>
    </section>

    <ResizableDataTable
      v-if="filteredEntries.length"
      :columns="catalogColumns"
      wrap-class="table-grow"
    >
      <tbody>
        <tr v-for="row in filteredEntries" :key="row.part_key">
          <td>
            <button
              v-if="row.label?.trim()"
              type="button"
              class="link-key"
              @click="openDetail(row)"
            >
              {{ row.label }}
            </button>
            <span v-else class="muted">—</span>
          </td>
          <td class="mono">
            <button type="button" class="link-key" @click="openDetail(row)">{{ row.part_key }}</button>
          </td>
          <td>{{ row.TypeCode }}</td>
          <td>{{ row.ModelSeries }}</td>
          <td>{{ row.PartName }}</td>
          <td>{{ row.status === "obsolete" ? "失效" : "有效" }}</td>
          <td>{{ row.file_count }}</td>
          <td>{{ row.present_count }}/{{ row.missing_count }}</td>
        </tr>
      </tbody>
    </ResizableDataTable>
    <div v-else-if="!loading" class="table-wrap table-grow empty-wrap">
      <p class="empty">
        {{ listData?.exists ? "当前筛选无条目" : "尚无数据，请先在 CAD 索引页执行工程内搜索" }}
      </p>
    </div>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.part-catalog-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 22px 16px;
}

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
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

.filters {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.85rem;
  flex-shrink: 0;
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

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
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
