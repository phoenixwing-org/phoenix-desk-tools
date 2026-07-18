<script setup lang="ts">
import type { PnwTableColumnDef } from "phoenix-wing";
import ResizableDataTable from "../ResizableDataTable.vue";
import { BOM_FIELD_LABELS as L } from "../../utils/bomFieldLabels";
import {
  FCSTD_MAP_KIND_OPTIONS as KIND_OPTIONS,
  FCSTD_MAP_PAGE_SIZE_OPTIONS as PAGE_SIZE_OPTIONS,
  fcstdMapAssetKindLabel as assetKindLabel,
  fcstdMapCanOpenFileDetail as canOpenFileDetail,
  fcstdMapMetaCell as metaCell,
  fcstdMapPartKeyLabel as partKeyLabel,
  fcstdMapRelativeDirectory as relDir,
  fcstdMapStatusLabel as statusLabel,
  type FcstdMapEntryViewInput,
  type FcstdMapKindFilter,
  type FcstdMapPageSize,
  type FcstdMapStatusFilter,
} from "../../models/fcstdMapViewModel";

defineProps<{
  exists: boolean;
  loading: boolean;
  entriesLoading: boolean;
  entries: readonly FcstdMapEntryViewInput[];
  entriesTotal: number;
  pageOffset: number;
  pageEnd: number;
  pageSize: FcstdMapPageSize;
  currentPage: number;
}>();

const searchQuery = defineModel<string>("searchQuery", { required: true });
const statusFilter = defineModel<FcstdMapStatusFilter>("statusFilter", { required: true });
const kindFilter = defineModel<FcstdMapKindFilter>("kindFilter", { required: true });

const emit = defineEmits<{
  pageChange: [page: number];
  pageSizeChange: [size: number];
  openFileDetail: [row: FcstdMapEntryViewInput];
  openPartKey: [row: FcstdMapEntryViewInput];
}>();

const cadColumns: PnwTableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "status", label: "状态", width: 52, minWidth: 44 },
  { key: "kind", label: "类型", width: 72, minWidth: 56 },
  { key: "file", label: "文件名", width: 200, minWidth: 100 },
  { key: "partKey", label: L.partKey, width: 108, minWidth: 80 },
  { key: "partVersion", label: L.partVersion, width: 88, minWidth: 72 },
  { key: "typeCode", label: L.typeCode, width: 72, minWidth: 56 },
  { key: "modelSeries", label: L.modelSeries, width: 96, minWidth: 72 },
  { key: "partName", label: L.partName, width: 120, minWidth: 80 },
  { key: "label", label: L.label, width: 120, minWidth: 80 },
  { key: "dir", label: "相对目录", width: 140, minWidth: 80 },
  { key: "meta", label: "属性摘要", width: 220, minWidth: 120 },
];
</script>

<template>
  <div class="fcstd-map-index-pane">
    <section class="index-toolbar">
      <el-input
        id="cad-index-search"
        v-model="searchQuery"
        size="small"
        clearable
        type="search"
        spellcheck="false"
        placeholder="搜索文件名、零件标识、路径…"
        class="search-field"
      />
    </section>

    <section class="filters">
      <el-radio-group v-model="statusFilter" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="present">存在</el-radio-button>
        <el-radio-button value="missing">缺失</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="kindFilter" size="small" class="kind-filter">
        <el-radio-button v-for="opt in KIND_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </el-radio-button>
      </el-radio-group>
      <span class="count">
        显示 <strong>{{ entriesTotal ? `${pageOffset + 1}–${pageEnd}` : 0 }}</strong>
        / {{ entriesTotal }} 条
      </span>
    </section>

    <div class="table-area">
      <ResizableDataTable
        v-if="entries.length"
        :columns="cadColumns"
        wrap-class="table-grow"
        data-tour-page-fcstd-table
      >
        <tbody>
          <tr
            v-for="(row, idx) in entries"
            :key="row.repo_rel_path + row.file_status"
            :class="row.file_status"
          >
            <td class="col-index">{{ pageOffset + idx + 1 }}</td>
            <td>
              <el-tag size="small" :type="row.file_status === 'present' ? 'success' : 'warning'" effect="plain">
                {{ statusLabel(row) }}
              </el-tag>
            </td>
            <td>
              <el-tag size="small" effect="plain">{{ assetKindLabel(row) }}</el-tag>
            </td>
            <td class="mono">
              <button
                v-if="canOpenFileDetail(row)"
                type="button"
                class="link-key"
                :title="row.repo_rel_path"
                @click="emit('openFileDetail', row)"
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
                @click="emit('openPartKey', row)"
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
          exists
            ? searchQuery.trim()
              ? '无匹配条目，请调整搜索或筛选'
              : '当前筛选无条目'
            : '尚无索引，点击「工程内搜索」开始扫描'
        "
        :image-size="72"
      />
    </div>

    <el-pagination
      v-if="exists && entriesTotal > 0"
      class="pager"
      size="small"
      layout="total, sizes, prev, pager, next"
      :total="entriesTotal"
      :page-size="pageSize"
      :current-page="currentPage"
      :page-sizes="[...PAGE_SIZE_OPTIONS]"
      :disabled="entriesLoading"
      @current-change="emit('pageChange', $event)"
      @size-change="emit('pageSizeChange', $event)"
    />
  </div>
</template>

<style scoped>
.fcstd-map-index-pane {
  display: flex;
  flex: 1;
  min-height: 0;
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

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.82rem;
  flex-shrink: 0;
}

.count {
  color: var(--muted);
  margin-left: auto;
}

.table-area {
  display: flex;
  flex: 1;
  min-height: 0;
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
  flex-shrink: 0;
  font-size: 0.82rem;
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
</style>
