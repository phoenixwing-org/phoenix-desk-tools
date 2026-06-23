<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import CaaDialogNodeView from "./CaaDialogNodeView.vue";
import { caaGridFillTrackTemplate, caaGridTrackTemplate } from "../../utils/caaControlMetrics";

const props = withDefaults(
  defineProps<{
    node: CaaDialogNode;
    /** 铺满对话框固定宽度；COLRES/ROWRES 列行用 fr */
    fillParent?: boolean;
  }>(),
  { fillParent: false },
);

const gridMetrics = computed(() => {
  let maxRow = 0;
  let maxCol = 0;
  for (const child of props.node.children) {
    const g = child.grid;
    if (!g) continue;
    maxRow = Math.max(maxRow, g.row + g.rowSpan);
    maxCol = Math.max(maxCol, g.col + g.colSpan);
  }
  return {
    rows: Math.max(1, maxRow),
    cols: Math.max(1, maxCol),
    rowResizable: props.node.gridLayout?.rowResizable ?? [],
    colResizable: props.node.gridLayout?.colResizable ?? [],
  };
});

const gridStyle = computed(() => ({
  display: "grid",
  gridTemplateRows: props.fillParent
    ? caaGridFillTrackTemplate(gridMetrics.value.rows, gridMetrics.value.rowResizable)
    : caaGridTrackTemplate(gridMetrics.value.rows),
  gridTemplateColumns: props.fillParent
    ? caaGridFillTrackTemplate(gridMetrics.value.cols, gridMetrics.value.colResizable)
    : caaGridTrackTemplate(gridMetrics.value.cols),
  gap: "6px",
  width: props.fillParent ? "100%" : "fit-content",
  maxWidth: "100%",
}));

function itemStyle(child: CaaDialogNode): Record<string, string> {
  const g = child.grid;
  if (!g) return {};
  return {
    gridRow: `${g.row + 1} / span ${g.rowSpan}`,
    gridColumn: `${g.col + 1} / span ${g.colSpan}`,
    minWidth: "0",
  };
}
</script>

<template>
  <div
    v-if="node.children.length"
    class="caa-grid"
    :class="{ 'caa-grid--fill': fillParent }"
    :style="gridStyle"
  >
    <div
      v-for="child in node.children"
      :key="child.id"
      class="caa-grid-cell"
      :style="itemStyle(child)"
    >
      <CaaDialogNodeView :node="child" :fill-parent="fillParent" />
    </div>
  </div>
</template>

<style scoped>
.caa-grid {
  align-items: start;
  justify-items: start;
}

.caa-grid--fill {
  align-items: stretch;
  justify-items: stretch;
}

.caa-grid-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 0;
  min-width: 0;
}

.caa-grid--fill .caa-grid-cell {
  align-items: stretch;
  width: 100%;
}
</style>
