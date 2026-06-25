<script setup lang="ts">
import { computed, ref } from "vue";
import type { CaaControlTypeCoverage } from "../../api/caaDialog";
import type { CaaDialogListGroup, CaaDialogListItem } from "../../types/caaDialogList";
type TableRow = CaaDialogListItem;

const props = defineProps<{
  groups: CaaDialogListGroup[];
  count: number;
  loading?: boolean;
  errorText?: string;
  workspaceReady?: boolean;
  hasScan?: boolean;
  indexed?: boolean;
  typeCoverage?: CaaControlTypeCoverage;
}>();

const emit = defineEmits<{
  open: [item: CaaDialogListItem];
}>();

const query = ref("");

const allRows = computed((): TableRow[] => {
  const rows: TableRow[] = [];
  for (const g of props.groups) {
    for (const item of g.items) rows.push(item);
  }
  return rows.sort(
    (a, b) =>
      a.groupKey.localeCompare(b.groupKey, undefined, { sensitivity: "base" }) ||
      a.fileName.localeCompare(b.fileName, undefined, { sensitivity: "base" }),
  );
});

const tableRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return allRows.value;
  return allRows.value.filter(
    (row) =>
      row.dialogName.toLowerCase().includes(q) ||
      row.fileName.toLowerCase().includes(q) ||
      row.groupKey.toLowerCase().includes(q) ||
      row.catDlgRel.toLowerCase().includes(q),
  );
});

const filteredCount = computed(() => tableRows.value.length);
const topUnknownTypes = computed(() => props.typeCoverage?.unknown.slice(0, 6) ?? []);

function onRowClick(row: TableRow) {
  emit("open", row);
}
</script>

<template>
  <div class="index-panel">
    <section class="index-toolbar">
      <el-input
        v-model="query"
        class="search-field"
        type="search"
        clearable
        size="small"
        placeholder="搜索文件名、模块或路径…"
        spellcheck="false"
        :disabled="!hasScan"
      />
    </section>

    <p v-if="!workspaceReady" class="banner banner-warn">
      请先在壳层选择<strong>工作空间</strong>；进入本页将自动从 CAA 索引 SQL 加载表格。
    </p>
    <p v-if="errorText" class="banner banner-err">{{ errorText }}</p>

    <p v-if="hasScan" class="list-summary muted small">
      <template v-if="loading">正在加载…</template>
      <template v-else-if="query.trim()">
        匹配 <strong>{{ filteredCount }}</strong> / {{ count }} 个对话框
      </template>
      <template v-else>
        共 <strong>{{ count }}</strong> 个对话框可编辑
      </template>
    </p>

    <section v-if="hasScan && typeCoverage" class="coverage-strip">
      <span>
        catalog 覆盖
        <strong>{{ typeCoverage.known_types }}</strong> / {{ typeCoverage.total_types }} 种类型
      </span>
      <span>
        控件块 <strong>{{ typeCoverage.total_controls }}</strong> 个
      </span>
      <span v-if="typeCoverage.unknown_types === 0" class="coverage-ok">无未登记类型</span>
      <span v-else class="coverage-warn">
        未登记 {{ typeCoverage.unknown_types }} 种 / {{ typeCoverage.unknown_controls }} 个
      </span>
      <span v-if="topUnknownTypes.length" class="coverage-tags">
        <el-tag
          v-for="row in topUnknownTypes"
          :key="row.type"
          size="small"
          type="warning"
          effect="plain"
        >
          {{ row.type }} ×{{ row.count }}
        </el-tag>
      </span>
    </section>

    <div class="table-area">
      <el-table
        v-if="hasScan && (tableRows.length || loading)"
        v-loading="loading"
        class="caa-home-table"
        :data="tableRows"
        size="small"
        stripe
        empty-text="当前筛选无对话框"
        highlight-current-row
        @row-click="onRowClick"
      >
        <el-table-column label="#" width="52" align="center">
          <template #default="{ $index }">
            <span class="caa-row-index">{{ $index + 1 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="文件名" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span
              class="caa-cell-file-link"
              :title="row.dialogName !== row.fileName ? row.dialogName : row.fileName"
              @click.stop="onRowClick(row)"
            >
              {{ row.fileName }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="groupKey" label="模块" width="148" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="caa-cell-module">{{ row.groupKey }}</span>
          </template>
        </el-table-column>
        <el-table-column label="" width="56" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.isDemo" size="small" type="success">样例</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-else-if="loading"
        class="empty-wrap"
        description="检索 .CATDlg…"
        :image-size="72"
      />
      <el-empty
        v-else
        class="empty-wrap"
        :description="
          !workspaceReady
            ? '请先选择工作空间'
            : hasScan && !indexed
              ? 'CAA 索引尚未建立；请点击「重新检索」扫描 .CATDlg'
              : hasScan && count === 0
                ? '索引中暂无 .CATDlg；确认工程含对话框资源'
                : '正在加载…'
        "
        :image-size="72"
      />
    </div>
  </div>
</template>

<style scoped>
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

.search-field {
  flex: 1;
  min-width: 160px;
  max-width: 420px;
}

.list-summary {
  margin: 0 0 8px;
  flex-shrink: 0;
}

.coverage-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin: 0 0 8px;
  padding: 6px 8px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: #f8fafc;
  font-size: 0.75rem;
  color: #475569;
  flex-shrink: 0;
}

.coverage-ok {
  color: #15803d;
  font-weight: 600;
}

.coverage-warn {
  color: #b45309;
  font-weight: 600;
}

.coverage-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.table-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--page-bg, #fff);
  display: flex;
  flex-direction: column;
}

.caa-home-table {
  width: 100%;
  height: 100%;
  font-size: 0.78rem;
}

.caa-home-table :deep(.el-table__row) {
  cursor: pointer;
}

.empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.caa-row-index {
  color: #94a3b8;
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
}

.caa-cell-file-link {
  color: #2563eb;
  font-size: 0.78rem;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.15s, text-decoration 0.15s;
}

.caa-cell-file-link:hover {
  color: #1d4ed8;
  text-decoration: underline;
}

.caa-row-active .caa-cell-file-link,
.el-table__row:hover .caa-cell-file-link {
  color: #1d4ed8;
  text-decoration: underline;
}

.caa-cell-module {
  font-size: 0.74rem;
  color: var(--text);
}

.caa-cell-file,
.caa-cell-path {
  font-size: 0.72rem;
  color: var(--muted, #64748b);
}

.caa-cell-file {
  color: var(--text);
  font-size: 0.78rem;
}

.banner {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.banner-warn {
  background: #fffbeb;
  border: 1px solid #fcd34d;
}

.banner-err {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}
</style>
