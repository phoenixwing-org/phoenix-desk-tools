<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import CaaDialogNodeView from "./CaaDialogNodeView.vue";
import CaaGridSettingsPopover from "./CaaGridSettingsPopover.vue";
import { CAA_CONTROL_KEY, type CaaContextMenuItem } from "../../composables/useCaaControlContext";
import { caaGridFillTrackTemplate, caaGridTrackTemplate } from "../../utils/caaControlMetrics";
import type { ContainerResizeResult } from "./controls/useCaaContainerResize";

const props = withDefaults(
  defineProps<{
    node: CaaDialogNode;
    fillParent?: boolean;
    dialogRoot?: CaaDialogNode;
    resize?: ContainerResizeResult;
  }>(),
  { fillParent: false },
);

const ctx = inject(CAA_CONTROL_KEY, null);

const editMode = computed(() => ctx?.editMode.value ?? true);

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

const colSet = computed(() => new Set(gridMetrics.value.colResizable));
const rowSet = computed(() => new Set(gridMetrics.value.rowResizable));

const gridStyle = computed(() => {
  const hasResize = props.resize != null;
  const e = editMode.value;
  const m = gridMetrics.value;
  const baseCols = hasResize
    ? props.resize!.columnTemplate
    : props.fillParent
      ? caaGridFillTrackTemplate(m.cols, m.colResizable)
      : caaGridTrackTemplate(m.cols);
  return {
    display: "grid",
    gridTemplateRows: e
      ? `14px ${caaGridTrackTemplate(m.rows)}`
      : caaGridTrackTemplate(m.rows),
    gridTemplateColumns: e
      ? `14px ${baseCols}`
      : baseCols,
    gap: e ? "1px" : "6px",
    width: hasResize ? props.resize!.gridWidth : props.fillParent ? "100%" : "fit-content",
    maxWidth: "100%",
  };
});

function childResizeStyle(child: CaaDialogNode): Record<string, string> | undefined {
  if (!props.resize) return undefined;
  return props.resize.getChildWidth(child);
}

function itemStyle(child: CaaDialogNode, isEdit: boolean): Record<string, string> {
  const g = child.grid;
  if (!g) return {};
  const r = g.row + (isEdit ? 2 : 1); // +1 for 0-based → 1-based; +1 more if header row
  const c = g.col + (isEdit ? 2 : 1); // +1 for indicator column
  return {
    gridRow: `${r} / span ${g.rowSpan}`,
    gridColumn: `${c} / span ${g.colSpan}`,
    minWidth: "0",
  };
}

// ── drag-and-drop from palette ──

const dragOverCell = ref<{ row: number; col: number; edge: "inside" | "right" | "bottom" } | null>(null);
const dragOverGrid = ref(false);

/** 获取某 cell 已有的子节点 */
function cellChild(row: number, col: number): CaaDialogNode | undefined {
  return props.node.children.find(
    (c) => c.grid?.row === row && c.grid?.col === col,
  );
}

let dragEnterCount = 0;

function onGridDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  dragOverGrid.value = true;

  const host = e.currentTarget as HTMLElement;
  const grid = host.querySelector(".caa-grid") as HTMLElement | null;
  const rect = grid ? grid.getBoundingClientRect() : host.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const m = props.node.children.length ? gridMetrics.value : { rows: 1, cols: 1 };
  const hasChildren = props.node.children.length > 0;

  const eOffset = (editMode.value && hasChildren) ? 14 : 0;
  const totalCols = Math.max(1, m.cols);
  const totalRows = Math.max(1, m.rows);

  const cellW = Math.max(40, (rect.width - eOffset) / totalCols);
  const cellH = Math.max(20, (rect.height - eOffset) / totalRows);

  const col = Math.max(0, Math.min(totalCols - 1, Math.floor((mx - eOffset) / cellW)));
  const row = Math.max(0, Math.min(totalRows - 1, Math.floor((my - eOffset) / cellH)));

  let edge: "inside" | "right" | "bottom" = "inside";
  if (hasChildren) {
    const xInCell = (mx - eOffset) - col * cellW;
    const yInCell = (my - eOffset) - row * cellH;
    const xPct = Math.max(0, xInCell) / cellW;
    const yPct = Math.max(0, yInCell) / cellH;
    if (cellChild(row, col) && xPct > 0.7) edge = "right";
    else if (cellChild(row, col) && yPct > 0.7) edge = "bottom";
  }

  dragOverCell.value = { row, col, edge };
}

function onGridDragEnter() {
  dragEnterCount++;
}

function onGridDragLeave() {
  dragEnterCount--;
  if (dragEnterCount <= 0) {
    dragEnterCount = 0;
    dragOverGrid.value = false;
    dragOverCell.value = null;
  }
}

function onGridDrop(e: DragEvent) {
  e.preventDefault();
  const raw = e.dataTransfer?.getData("text/plain") ?? "";
  const type = raw.startsWith("caa:") ? raw.slice(4) : "";
  dragEnterCount = 0;
  if (!type || !dragOverCell.value || !ctx) {
    dragOverCell.value = null;
    dragOverGrid.value = false;
    return;
  }

  const { row, col, edge } = dragOverCell.value;
  const id = props.node.id;

  if (edge === "right") {
    ctx.insertCol(id, col + 1);
    ctx.addControl(id, type, row, col + 1);
  } else if (edge === "bottom") {
    ctx.insertRow(id, row + 1);
    ctx.addControl(id, type, row + 1, col);
  } else {
    ctx.addControl(id, type, row, col);
  }

  dragOverCell.value = null;
  dragOverGrid.value = false;
}

// ── toggle resize from indicator click ──

function toggleColResize(col: number) {
  ctx?.toggleGridColResize(props.node.id, col);
}
function toggleRowResize(row: number) {
  ctx?.toggleGridRowResize(props.node.id, row);
}

// ── grid settings popover ──

const settingsOpen = ref(false);

function openGridSettings() {
  ctx?.select(props.node.id);
  settingsOpen.value = true;
}

// ── right-click context menu ──

function onGridContextmenu(e: MouseEvent) {
  if (!ctx) return;
  e.preventDefault();
  e.stopPropagation();
  ctx.select(props.node.id);
  const items: CaaContextMenuItem[] = [
    { label: "Grid 设置…", action: () => { settingsOpen.value = true; } },
    { divider: true, label: "", action: () => {} },
  ];
  const m = gridMetrics.value;
  for (let r = 0; r < m.rows; r++) {
    const isRes = m.rowResizable.includes(r);
    items.push({
      label: `${isRes ? "取消" : "设为"}行 ${r} 伸缩`,
      action: () => ctx.toggleGridRowResize(props.node.id, r),
    });
  }
  items.push({ divider: true, label: "", action: () => {} });
  for (let c = 0; c < m.cols; c++) {
    const isRes = m.colResizable.includes(c);
    items.push({
      label: `${isRes ? "取消" : "设为"}列 ${c} 伸缩`,
      action: () => ctx.toggleGridColResize(props.node.id, c),
    });
  }
  ctx.showContextMenu(props.node.id, items, { x: e.clientX, y: e.clientY });
}
</script>

<template>
  <div
    v-if="true"
    class="caa-grid-host"
    :class="{ 'caa-grid-host--drop-target': dragOverGrid, 'caa-grid-host--empty': !node.children.length }"
    @dragenter="onGridDragEnter"
    @dragover="onGridDragOver"
    @dragleave="onGridDragLeave"
    @drop="onGridDrop"
  >
    <!-- 空容器占位提示 -->
    <div v-if="!node.children.length && editMode" class="caa-grid-empty-hint">
      拖放控件到此处
    </div>
    <!-- ════ 编辑模式：行列伸缩指示器 + 1px 网格线 ════ -->
    <div
      v-if="node.children.length"
      class="caa-grid"
      :class="{ 'caa-grid--fill': fillParent, 'caa-grid--edit': editMode }"
      :style="gridStyle"
      @contextmenu="onGridContextmenu"
    >
      <!-- 列伸缩指示器 (edit mode) -->
      <template v-if="editMode">
        <div class="caa-corner-spacer"></div>
        <button
          v-for="c in gridMetrics.cols"
          :key="'col-hdr-' + c"
          class="caa-col-indicator"
          :class="{ 'caa-col-indicator--resizable': colSet.has(c - 1) }"
          :title="`列 ${c - 1}：${colSet.has(c - 1) ? '伸缩' : '固定'}`"
          @click="toggleColResize(c - 1)"
        >
          <span v-if="colSet.has(c - 1)" class="spr spr-col-resize"></span>
          <span v-else class="spr spr-col-fixed"></span>
        </button>
      </template>

      <!-- 行伸缩指示器 (edit mode)：每个 grid row 一个 -->
      <template v-if="editMode">
        <div
          v-for="r in gridMetrics.rows"
          :key="'row-ind-' + r"
          class="caa-row-indicator"
          :class="{ 'caa-row-indicator--resizable': rowSet.has(r - 1) }"
          :style="{ gridRow: `${r + 1}`, gridColumn: '1' }"
          :title="`行 ${r - 1}：${rowSet.has(r - 1) ? '伸缩' : '固定'}`"
          @click="toggleRowResize(r - 1)"
        >
          <span v-if="rowSet.has(r - 1)" class="spr spr-row-resize"></span>
          <span v-else class="spr spr-row-fixed"></span>
        </div>
      </template>

      <!-- 内容单元格 -->
      <div
        v-for="child in node.children"
        :key="child.id"
        class="caa-grid-cell"
        :class="{ 'caa-grid-cell--edit': editMode }"
        :style="itemStyle(child, editMode)"
      >
        <CaaDialogNodeView
          :node="child"
          :fill-parent="fillParent"
          :dialog-root="dialogRoot"
          :width-style="childResizeStyle(child)"
        />
      </div>

      <!-- drop 高亮指示器（在 grid 内部，CSS Grid 定位） -->
      <div
        v-if="dragOverCell && editMode"
        class="caa-drop-indicator"
        :class="{
          'caa-drop-indicator--right': dragOverCell.edge === 'right',
          'caa-drop-indicator--bottom': dragOverCell.edge === 'bottom',
        }"
        :style="{
          gridRow: `${dragOverCell.row + 2} / span 1`,
          gridColumn: `${dragOverCell.col + 2} / span 1`,
        }"
      />
    </div>

    <!-- grid settings popover -->
    <CaaGridSettingsPopover
      :open="settingsOpen"
      :container-id="node.id"
      :container-type="node.type"
      :rows="gridMetrics.rows"
      :cols="gridMetrics.cols"
      :row-resizable="gridMetrics.rowResizable"
      :col-resizable="gridMetrics.colResizable"
      @close="settingsOpen = false"
    />
  </div>
</template>

<style scoped>
.caa-grid-host {
  position: relative;
  min-width: 0;
  max-width: 100%;
}

.caa-grid-host--drop-target {
  outline: 2px dashed #3b82f6;
  outline-offset: 2px;
  border-radius: 4px;
}

.caa-grid-host--empty {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.caa-grid-empty-hint {
  font-size: 0.75rem;
  color: #94a3b8;
  font-style: italic;
  pointer-events: none;
}

/* drop target cell indicator */
.caa-drop-indicator {
  background: rgba(59, 130, 246, 0.12);
  border: 2px dashed #3b82f6;
  border-radius: 3px;
  min-height: 20px;
  min-width: 40px;
  pointer-events: none;
  z-index: 10;
}

.caa-drop-indicator--right {
  border-left-width: 4px;
  border-left-style: solid;
}

.caa-drop-indicator--bottom {
  border-top-width: 4px;
  border-top-style: solid;
}

/* ── grid ── */

.caa-grid {
  align-items: start;
  justify-items: start;
}

/* 编辑模式：1px 网格线 */
.caa-grid--edit {
  background: var(--border, #cbd5e1); /* gap = 1px → 实色 = 1px 线 */
}

.caa-grid--fill {
  align-items: stretch;
  justify-items: stretch;
}

/* ── corner spacer ── */
.caa-corner-spacer { min-width: 0; min-height: 0; }

/* ── spring indicator base (col & row shared) ── */

.spr {
  display: block;
  border-radius: 1px;
  background: var(--muted, #94a3b8);
  transition: background 0.15s;
}

/* 列伸缩弹簧（宽扁，绿色区分选中蓝） */
.spr-col-resize {
  width: 100%;
  height: 2px;
  background: #10b981;
}
/* 列固定（短点） */
.spr-col-fixed {
  width: 3px;
  height: 3px;
  border-radius: 50%;
}

/* 行伸缩弹簧（高窄） */
.spr-row-resize {
  width: 2px;
  height: 100%;
  background: #10b981;
}
/* 行固定（短点） */
.spr-row-fixed {
  width: 3px;
  height: 3px;
  border-radius: 50%;
}

/* ── 列指示器 ── */
.caa-col-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 3px;
  background: #f8fafc;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  min-width: 0;
}

.caa-col-indicator:hover .spr { background: #059669; }
.caa-col-indicator:hover { background: #ecfdf5; }

/* ── 行指示器 ── */
.caa-row-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3px 2px;
  background: #f8fafc;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  min-height: 0;
}

.caa-row-indicator:hover .spr { background: #059669; }
.caa-row-indicator:hover { background: #ecfdf5; }

/* ── 单元格 ── */
.caa-grid-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: 0;
  min-width: 0;
  background: var(--page-bg, transparent);
  padding: 1px;
}

/* 编辑模式：单元格白底覆盖灰色 gap 线 */
.caa-grid-cell--edit {
  background: #fff;
}

.caa-grid--fill .caa-grid-cell {
  align-items: stretch;
  width: 100%;
}
</style>
