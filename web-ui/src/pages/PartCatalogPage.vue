<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchPartKeys, type PartKeyEntry, type PartKeysPayload } from "../api";
import { BOM_FIELD_LABELS as L } from "../utils/bomFieldLabels";
import { useAppShell } from "../composables/useAppShell";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { PnwTableColumnDef } from "phoenix-wing";
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

const emptyDescription = computed(() => {
  if (loading.value) return "加载中…";
  if (listData.value?.exists) return "当前筛选无条目";
  return "尚无数据，请先在 CAD 索引页执行工程内搜索";
});

function setStatus(msg: string) {
  shell.setStatus(msg);
}

async function refreshList() {
  loading.value = true;
  shell.appendLog("[零件目录] 刷新列表…", { source: "part_catalog", open: true });
  try {
    const data = await fetchPartKeys();
    const items: PartKeyEntry[] = data.entries || [];
    listData.value = data;
    const engine = data._native === "rust" ? "Rust" : data._native === "node" ? "Node" : "本地服务";
    const msg = `零件目录 ${items.length} 键 (${engine})`;
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

onMounted(() => refreshList());
</script>

<template>
  <div class="page part-catalog-page">
    <PageHeader title="零件目录" page-id="part_catalog">
      <template #actions>
        <el-button size="small" :loading="loading" @click="refreshList">刷新</el-button>
      </template>
    </PageHeader>

    <section class="controls" data-tour-page-partcat-search>
      <el-input
        v-model="search"
        size="small"
        clearable
        placeholder="搜索零件号、名称、备注…"
        spellcheck="false"
        class="search-input"
      />
    </section>

    <section class="filters">
      <el-radio-group v-model="statusFilter" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="active">有效</el-radio-button>
        <el-radio-button value="obsolete">失效</el-radio-button>
      </el-radio-group>
      <span class="count">{{ filteredEntries.length }} 键</span>
    </section>

    <div v-if="filteredEntries.length" data-tour-page-partcat-table>
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
  align-items: center;
}

.search-input {
  flex: 1;
  min-width: 180px;
}

.filters {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.count {
  color: var(--muted);
  margin-left: auto;
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
