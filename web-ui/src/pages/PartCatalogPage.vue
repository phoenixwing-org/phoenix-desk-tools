<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { fetchPartKeys, type PartKeyEntry, type PartKeysPayload } from "../api";
import { BOM_FIELD_LABELS as L } from "../utils/bomFieldLabels";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import { PnwSelect, type PnwTableColumnDef } from "phoenix-wing";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const catalogColumns = computed<PnwTableColumnDef[]>(() => [
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
const statusOptions = [
  { value: "all", label: "全部" },
  { value: "active", label: "有效" },
  { value: "obsolete", label: "失效" },
];
const search = ref("");
const loadError = ref("");
let requestId = 0;

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

const emptyDescription = computed(() => {
  if (loading.value) return "加载中…";
  if (listData.value?.exists) return "当前筛选无条目";
  return "尚无数据，请先在 CAD 索引中更新工作空间索引";
});

function setStatus(msg: string) {
  shell.setStatus(msg);
}

async function refreshList() {
  const request = ++requestId;
  listData.value = null;
  loadError.value = "";
  loading.value = true;
  shell.appendLog("[零件目录] 刷新列表…", { source: "part_catalog", open: true });
  try {
    if (!shell.workspacePath.value) throw new Error("请先打开工作空间");
    const data = await fetchPartKeys(shell.workspacePath.value);
    if (request !== requestId) return;
    const items: PartKeyEntry[] = data.entries || [];
    listData.value = data;
    const engine = data._native === "node" ? "Node / SQLite" : "本地服务";
    const msg = `零件目录 ${items.length} 键 (${engine})`;
    shell.appendLog(msg, { source: "part_catalog" });
    setStatus(msg);
  } catch (e) {
    if (request !== requestId) return;
    loadError.value = String(e);
    shell.appendLog(String(e), { source: "part_catalog" });
    setStatus(String(e));
  } finally {
    if (request === requestId) loading.value = false;
  }
}

function openDetail(row: PartKeyEntry) {
  shell.openPartKeyDetail(row.part_number, row.part_version, {
    partName: row.PartName,
    label: row.label,
  });
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({}), hydrate: () => false, isDirty: () => false,
  isBusy: () => loading.value, refresh: refreshList,
});

usePagePrimaryContribution("part_catalog", props.workbenchTabId, {
  summary: computed(() => listData.value?.exists
    ? `显示 ${filteredEntries.value.length} / ${listData.value.entries.length} 个零件键`
    : "尚无零件目录数据"),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "filter",
      title: "目录筛选",
      controls: [
        {
          id: "search",
          kind: "text",
          label: "搜索",
          modelValue: search,
          placeholder: "零件号、名称、型号或备注",
          onUpdate: (value) => { search.value = value; },
        },
        {
          id: "status",
          kind: "choice",
          label: "状态",
          modelValue: statusFilter,
          options: [
            { value: "all", label: "全部" },
            { value: "active", label: "有效" },
            { value: "obsolete", label: "失效" },
          ],
          onUpdate: (value) => {
            statusFilter.value = value === "active" || value === "obsolete" ? value : "all";
          },
        },
        { id: "total", kind: "readonly", label: "目录总数", value: computed(() => listData.value?.entries.length ?? 0) },
        { id: "visible", kind: "readonly", label: "当前显示", value: computed(() => filteredEntries.value.length) },
        {
          id: "missing",
          kind: "readonly",
          label: "含缺失文件",
          value: computed(() => (listData.value?.entries ?? []).filter((entry) => entry.missing_count > 0).length),
        },
      ],
      actions: [
        { id: "refresh", label: "刷新目录", tone: "primary", loading, run: refreshList },
        {
          id: "clear",
          label: "清空筛选",
          disabled: computed(() => !search.value && statusFilter.value === "all"),
          run: () => {
            search.value = "";
            statusFilter.value = "all";
          },
        },
      ],
    },
  ]),
});

watch(shell.workspacePath, refreshList, { immediate: true });
onUnmounted(() => { requestId++; });
</script>

<template>
  <PageLayout title="零件目录" class="desk-page-layout" :body-inset="false" :body-scroll="false">
    <template #header>
      <PageHeader title="零件目录">
        <template #center>
          <div class="catalog-filter-container" data-tour-page-partcat-search>
          <div class="catalog-filters">
            <el-input
              v-model="search"
              size="small"
              clearable
              aria-label="搜索零件目录"
              placeholder="搜索零件号、名称、备注…"
              spellcheck="false"
              class="search-input"
            />
            <el-radio-group v-model="statusFilter" size="small" aria-label="零件状态" class="catalog-status-full">
              <el-radio-button v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
            </el-radio-group>
            <PnwSelect v-model="statusFilter" :options="statusOptions" size="compact" aria-label="零件状态" class="catalog-status-compact" />
            <span class="count">{{ filteredEntries.length }} 键</span>
          </div>
          </div>
        </template>
        <template #right>
          <el-button size="small" @click="shell.openTab({ pageId: 'cad_index' })">CAD 索引</el-button>
          <el-button size="small" :loading="loading" @click="refreshList">刷新</el-button>
        </template>
      </PageHeader>
    </template>
    <PageMainBlock class="part-catalog-page desk-page-body--fill">
      <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" />
      <div v-if="filteredEntries.length" class="catalog-table" data-tour-page-partcat-table>
        <ResizableDataTable :columns="catalogColumns" wrap-class="table-grow">
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
              <td>
                <el-tag size="small" :type="row.status === 'obsolete' ? 'info' : 'success'" effect="plain">
                  {{ row.status === "obsolete" ? "失效" : "有效" }}
                </el-tag>
              </td>
              <td>{{ row.file_count }}</td>
              <td>{{ row.present_count }}/{{ row.missing_count }}</td>
            </tr>
          </tbody>
        </ResizableDataTable>
      </div>
      <el-empty v-else class="empty-wrap table-grow" :description="emptyDescription" :image-size="72" />
    </PageMainBlock>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";

.catalog-table {
  display: flex;
  flex: 1;
  min-height: 0;
}

.catalog-filter-container { container: pdt-catalog-filters / inline-size; width: 100%; min-width: 0; }
.catalog-filters { display: flex; align-items: center; gap: var(--pnw-page-header-gap, 8px); min-width: 0; }
.catalog-filters .search-input { flex: 1 1 240px; width: 240px; min-width: 96px; }
.catalog-status-full, .catalog-filters .count { flex: none; white-space: nowrap; }
.catalog-status-compact { display: none; }
@container pdt-catalog-filters (max-width: 400px) {
  .catalog-status-full { display: none; }
  .catalog-status-compact { display: inline-flex; flex: 0 0 76px; width: 76px; }
  .catalog-filters .count { display: none; }
}
@container pdt-catalog-filters (max-width: 190px) {
  .catalog-status-compact { display: none; }
  /* The full status filter stays available in Primary at very narrow widths. */
  .catalog-filters .search-input { min-width: 0; }
}

.count {
  color: var(--muted);
  font-size: 0.85rem;
}

.table-grow {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
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

.muted {
  color: var(--muted);
}

code {
  font-size: 0.9em;
}
</style>
