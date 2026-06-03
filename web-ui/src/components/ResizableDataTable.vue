<script setup lang="ts">
import { useResizableTable, type TableColumnDef } from "../composables/useResizableTable";

const props = withDefaults(
  defineProps<{
    columns: TableColumnDef[];
    tableClass?: string;
    wrapClass?: string;
  }>(),
  {
    tableClass: "",
    wrapClass: "",
  },
);

const { widths, totalWidth, onResizeStart } = useResizableTable(() => props.columns);
</script>

<template>
  <div class="resizable-table-wrap" :class="wrapClass">
    <table
      class="data-table resizable-data-table"
      :class="tableClass"
      :style="{ width: `${totalWidth}px`, minWidth: '100%' }"
    >
      <colgroup>
        <col v-for="col in columns" :key="col.key" :style="{ width: `${widths[col.key]}px` }" />
      </colgroup>
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" :class="col.headerClass">
            <span class="th-label">{{ col.label }}</span>
            <span
              class="col-resizer"
              title="拖拽调节列宽"
              @mousedown="onResizeStart(col.key, $event)"
            />
          </th>
        </tr>
      </thead>
      <slot />
    </table>
  </div>
</template>

<style scoped>
.resizable-table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.resizable-data-table {
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.78rem;
}

.resizable-data-table :deep(tr) {
  background: #fff;
}

.resizable-data-table :deep(th) {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  white-space: nowrap;
  text-align: left;
  vertical-align: middle;
  height: 28px;
  line-height: 28px;
  padding: 0;
  border-bottom: 1px solid #e2e8f0;
  overflow: hidden;
  isolation: isolate;
}

.resizable-data-table :deep(td) {
  position: relative;
  padding: 0 10px;
  border-bottom: 1px solid #eee;
  text-align: left;
  vertical-align: middle;
  height: 22px;
  line-height: 22px;
  white-space: nowrap;
  overflow: hidden;
  background: inherit;
  isolation: isolate;
}

/* 操作列含按钮时放宽行高，避免裁切 */
.resizable-data-table :deep(td.actions) {
  height: auto;
  min-height: 22px;
  line-height: normal;
  overflow: visible;
  padding: 4px 8px;
  white-space: normal;
}

/* 越靠右的列 z-index 越高，溢出文字被右侧列遮住 */
.resizable-data-table :deep(td:nth-child(1)) { z-index: 1; }
.resizable-data-table :deep(td:nth-child(2)) { z-index: 2; }
.resizable-data-table :deep(td:nth-child(3)) { z-index: 3; }
.resizable-data-table :deep(td:nth-child(4)) { z-index: 4; }
.resizable-data-table :deep(td:nth-child(5)) { z-index: 5; }
.resizable-data-table :deep(td:nth-child(6)) { z-index: 6; }
.resizable-data-table :deep(td:nth-child(7)) { z-index: 7; }
.resizable-data-table :deep(td:nth-child(8)) { z-index: 8; }
.resizable-data-table :deep(td:nth-child(9)) { z-index: 9; }
.resizable-data-table :deep(td:nth-child(10)) { z-index: 10; }
.resizable-data-table :deep(td:nth-child(11)) { z-index: 11; }
.resizable-data-table :deep(td:nth-child(12)) { z-index: 12; }

.resizable-data-table :deep(th:nth-child(1)) { z-index: 21; }
.resizable-data-table :deep(th:nth-child(2)) { z-index: 22; }
.resizable-data-table :deep(th:nth-child(3)) { z-index: 23; }
.resizable-data-table :deep(th:nth-child(4)) { z-index: 24; }
.resizable-data-table :deep(th:nth-child(5)) { z-index: 25; }
.resizable-data-table :deep(th:nth-child(6)) { z-index: 26; }
.resizable-data-table :deep(th:nth-child(7)) { z-index: 27; }
.resizable-data-table :deep(th:nth-child(8)) { z-index: 28; }
.resizable-data-table :deep(th:nth-child(9)) { z-index: 29; }
.resizable-data-table :deep(th:nth-child(10)) { z-index: 30; }
.resizable-data-table :deep(th:nth-child(11)) { z-index: 31; }
.resizable-data-table :deep(th:nth-child(12)) { z-index: 32; }

.th-label {
  display: block;
  padding: 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
  transform: translateX(50%);
}

.col-resizer:hover,
.col-resizer:active {
  background: rgba(37, 99, 235, 0.22);
}
</style>
