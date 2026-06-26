<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import CaaDialogNodeView from "./CaaDialogNodeView.vue";
import CaaGridSettingsPopover from "./CaaGridSettingsPopover.vue";
import { CAA_CONTROL_KEY, type CaaContextMenuItem } from "../../composables/useCaaControlContext";
import { caaGridEditRowTrackTemplate, caaGridFillTrackTemplate, caaGridTrackTemplate } from "../../utils/caaControlMetrics";
import { findCaaNode, renumberGrid, generateNodeId, createControlNode, removeChildNode } from "../../utils/caaDialogTree";
import { resolveDropEdgeFromRect, applyDropTransform, findOverlaps, buildBuilderRecord } from "../../utils/caaDropZone";
import { resolveSpanResize, type SpanGrid } from "../../utils/caaSpanResize";
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

/** 空格子列表：grid 中未被任何控件占据的 (row, col) 位置，用于渲染占位 div 以支持拖放检测 */
const emptyCells = computed(() => {
  const m = gridMetrics.value;
  const cells: { row: number; col: number }[] = [];
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      if (!cellOccupied(r, c)) {
        cells.push({ row: r, col: c });
      }
    }
  }
  return cells;
});

const gridStyle = computed(() => {
  const hasResize = props.resize != null;
  const e = editMode.value;
  const m = gridMetrics.value;
  const baseCols = hasResize
    ? props.resize!.columnTemplate
    : props.fillParent
      ? caaGridFillTrackTemplate(m.cols, m.colResizable)
      : caaGridTrackTemplate(m.cols);
  const baseRows = hasResize
    ? props.resize!.rowTemplate
    : props.fillParent
      ? caaGridFillTrackTemplate(m.rows, m.rowResizable)
      : caaGridTrackTemplate(m.rows);
  const editRows = caaGridEditRowTrackTemplate(m.rows, m.rowResizable, props.fillParent || hasResize);
  return {
    display: "grid",
    gridTemplateRows: e ? `14px ${editRows}` : baseRows,
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

// ── drag-and-drop ──

const dragOverCell = ref<{ row: number; col: number; edge: "inside" | "right" | "bottom" | "left" | "top" } | null>(null);
const dragOverGrid = ref(false);

/** 判断 (row,col) 是否被已存在控件占据（含 rowSpan/colSpan） */
function cellOccupied(row: number, col: number): boolean {
  return props.node.children.some((c) => {
    if (!c.grid) return false;
    return (
      row >= c.grid.row && row < c.grid.row + c.grid.rowSpan &&
      col >= c.grid.col && col < c.grid.col + c.grid.colSpan
    );
  });
}

/** 根据实际渲染的 cell DOM 元素计算鼠标所在位置（使用纯函数规则）；返回 cell 矩形供 overlay 定位 */
function cellFromPoint(gridEl: HTMLElement, clientX: number, clientY: number): { row: number; col: number; edge: "inside" | "right" | "bottom" | "left" | "top"; rect: DOMRect } | null {
  const gridId = gridEl.getAttribute("data-grid-host") ?? props.node.id;
  const hasChildren = props.node.children.length > 0 || gridId !== props.node.id;

  // 先尝试精确 hit-test
  const cells = gridEl.querySelectorAll(".caa-grid-cell");
  let bestCell: HTMLElement | null = null;
  let bestRect: DOMRect | null = null;
  let bestDist = Infinity;

  for (const cell of cells) {
    const r = cell.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const row = parseInt((cell as HTMLElement).dataset.gridRow ?? "0");
      const col = parseInt((cell as HTMLElement).dataset.gridCol ?? "0");
      const occupied = cellOccupied(row, col);
      const edge = resolveDropEdgeFromRect(occupied, r, clientX, clientY);
      return { row, col, edge, rect: r };
    }
    // 同时记录最近 cell（兜底用）
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
    if (dist < bestDist) { bestDist = dist; bestCell = cell as HTMLElement; bestRect = r; }
  }

  // 兜底：鼠标在 grid 内但不在任何 cell 上 → 找最近 cell 的最近边
  const gr = gridEl.getBoundingClientRect();
  const inGrid = clientX >= gr.left && clientX <= gr.right && clientY >= gr.top && clientY <= gr.bottom;
  if (inGrid && bestCell && bestRect) {
    const row = parseInt(bestCell.dataset.gridRow ?? "0");
    const col = parseInt(bestCell.dataset.gridCol ?? "0");
    const occupied = cellOccupied(row, col);
    // 判断鼠标在 bestCell 的哪一侧，用对应 edge
    const edge = resolveDropEdgeFromRect(occupied, bestRect, clientX, clientY);
    return { row, col, edge, rect: bestRect };
  }

  return null;
}

let dragEnterCount = 0;

function writeDropIndicator(cell: ReturnType<typeof cellFromPoint>, gridEl: HTMLElement, clientX: number, clientY: number) {
  if (!ctx) return;
  if (cell) {
    ctx.dropIndicator.value = { rect: { left: cell.rect.left, top: cell.rect.top, width: cell.rect.width, height: cell.rect.height }, edge: cell.edge };
    return;
  }
  // 兜底：空容器（无 cell DOM）→ 鼠标在 grid host 上 → 整格 inside
  if (!props.node.children.length) {
    const gr = gridEl.getBoundingClientRect();
    if (clientX >= gr.left && clientX <= gr.right && clientY >= gr.top && clientY <= gr.bottom) {
      ctx.dropIndicator.value = { rect: { left: gr.left, top: gr.top, width: gr.width, height: gr.height }, edge: "inside" };
      return;
    }
  }
}

function onGridDragOver(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  dragOverGrid.value = true;

  const gridEl = e.currentTarget as HTMLElement;
  const cell = cellFromPoint(gridEl, e.clientX, e.clientY);
  dragOverCell.value = cell;
  writeDropIndicator(cell, gridEl, e.clientX, e.clientY);
}

function onGridDragEnter(e: DragEvent) {
  e.stopPropagation();
  dragEnterCount++;
}

function onGridDragLeave(e: DragEvent) {
  e.stopPropagation();
  dragEnterCount--;
  if (dragEnterCount <= 0) {
    dragEnterCount = 0;
    dragOverGrid.value = false;
    dragOverCell.value = null;
    if (ctx) ctx.dropIndicator.value.rect = null;
  }
}

function doDrop(row: number, col: number, edge: string, payload: string, targetIdOverride?: string) {
  const targetId = targetIdOverride || props.node.id;
  const root = ctx!.dialogRoot;
  if (!root) return;

  const targetContainer = findCaaNode(root, targetId);
  if (!targetContainer) return;

  console.log("[CAA drop] ═══ doDrop ═══ row=%d col=%d edge=%s payload=%s target=%s isCross=%s children=%d",
    row, col, edge, payload, targetId, isCross, targetContainer.children.length);
  console.log("[CAA drop] 现有控件：", targetContainer.children.map(c => ({ id: c.id, grid: c.grid })));

  // ── ① 快照（用于回退）──
  const snapChildren = targetContainer.children.map((c) => ({
    ...c,
    grid: c.grid ? { ...c.grid } : undefined,
    children: c.children,
  }));

  // For MOVE: also snapshot source container
  let sourceNodeId = "";
  let sourceContainerId = "";
  let sourceSnapChildren: CaaDialogNode[] | null = null;
  let sourceNode: CaaDialogNode | null = null;

  if (payload.startsWith("MOVE:")) {
    const rest = payload.slice(5);
    const sep = rest.lastIndexOf(":");
    sourceNodeId = rest.slice(0, sep);
    sourceContainerId = rest.slice(sep + 1);
    sourceNode = findCaaNode(root, sourceNodeId);
    if (!sourceNode) return;

    if (sourceContainerId !== targetId) {
      const srcCtr = findCaaNode(root, sourceContainerId);
      if (srcCtr) {
        sourceSnapChildren = srcCtr.children.map((c) => ({
          ...c,
          grid: c.grid ? { ...c.grid } : undefined,
          children: c.children,
        }));
      }
    }
  }

  // ── ② 纯函数计算完整变换（不修改树，只计算位置）──
  //    对于 MOVE：先从目标容器的 children 中排除源节点（如果同容器）
  const computeInput = payload.startsWith("MOVE:") && sourceContainerId === targetId
    ? targetContainer.children.filter((c) => c.id !== sourceNodeId)
    : targetContainer.children;

  const result = applyDropTransform({
    children: computeInput,
    targetRow: row,
    targetCol: col,
    edge: edge as "inside" | "right" | "bottom" | "left" | "top",
  });

  if (!result.success) {
    return;
  }

  ctx!.recordHistory();

  // ── ③ 构建最终子节点列表 ──
  const newChildren: CaaDialogNode[] = result.children as CaaDialogNode[];

  if (payload.startsWith("COPY:")) {
    const type = payload.slice(5);
    const newId = generateNodeId(targetContainer, type);
    const newNode = createControlNode(type, newId, { row: result.placedRow, col: result.placedCol });
    newNode.father = targetId;
    newChildren.push(newNode);
  } else if (payload.startsWith("MOVE:") && sourceNode) {
    sourceNode.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    sourceNode.father = targetId;
    newChildren.push(sourceNode);
  }

  // ── ④ 验证：无重叠 ──
  const overlaps = findOverlaps(newChildren as any);
  if (overlaps.length > 0) {
    targetContainer.children = snapChildren;
    renumberGrid(targetContainer);
    if (sourceSnapChildren) {
      const srcCtr = findCaaNode(root, sourceContainerId);
      if (srcCtr) {
        srcCtr.children = sourceSnapChildren;
        renumberGrid(srcCtr);
      }
    }
    return;
  }

  // ── ⑤ 原子替换目标容器 + 跨容器 MOVE ──
  ctx!.setChildren(targetId, newChildren, sourceNodeId || undefined);

  // 跨容器 MOVE：更新源容器（使用纯函数移除）
  if (sourceNodeId && sourceContainerId !== targetId) {
    const srcCtr = findCaaNode(root, sourceContainerId);
    if (srcCtr) {
      const { newChildren } = removeChildNode(srcCtr.children, sourceNodeId);
      srcCtr.children = newChildren;
      renumberGrid(srcCtr);
    }
  }

  // ── ⑥ 记录 Builder 操作 ──
  if (ctx) {
    const isCopy = payload.startsWith("COPY:");
    const affectedId = isCopy ? (newChildren.find(c => !snapChildren.find(s => s.id === c.id))?.id ?? "") : sourceNodeId;
    const affectedType = isCopy ? payload.slice(5) : (sourceNode?.type ?? "");
    const record = buildBuilderRecord({
      operation: isCopy ? "COPY" : "MOVE",
      sourceContainerId: sourceContainerId || null,
      targetContainerId: targetId,
      sourceChildrenBefore: sourceSnapChildren,
      targetChildrenBefore: snapChildren,
      targetChildrenAfter: newChildren,
      sourceChildrenAfter: sourceNodeId && sourceContainerId !== targetId
        ? (findCaaNode(root, sourceContainerId)?.children.map(c => ({...c, grid: c.grid ? {...c.grid} : undefined, children: c.children})) ?? null)
        : null,
      affectedNodeId: affectedId,
      affectedNodeType: affectedType,
    });
    console.log("[CAA drop] Record: op=%s affected=%s type=%s",
      record.operation, record.affectedNodeId, record.affectedNodeType);
    ctx.lastBuilderRecord.value = record;
  }

function onGridDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  const raw = e.dataTransfer?.getData("text/plain") ?? "";
  dragEnterCount = 0;
  if (!raw.startsWith("caa:") || !ctx) {
    clearDragState();
    return;
  }
  if (dragOverCell.value) {
    const { row, col, edge } = dragOverCell.value;
    doDrop(row, col, edge, raw.slice(4));
  } else if (!props.node.children.length) {
    // 空容器兜底
    const gr = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX >= gr.left && e.clientX <= gr.right && e.clientY >= gr.top && e.clientY <= gr.bottom) {
      doDrop(0, 0, "inside", raw.slice(4));
    }
  }
  clearDragState();
}

function clearDragState() {
  dragOverCell.value = null;
  dragOverGrid.value = false;
  if (ctx) ctx.dropIndicator.value.rect = null;
}

// ── 内部拖动（mousedown/mousemove/mouseup 手动实现，绕过 HTML5 子元素拦截）──
//
// 设计要点：
//   1. mousedown 记录起点，但不立即激活（等移动 > 5px 才算真正拖拽）
//   2. 激活后绑定 window mouseup / mousemove 作为安全网，确保鼠标在 grid 外松开也能清理
//   3. 所有 mousemove 入口必须检查 e.buttons & 1 —— 防止 mouseup 事件被吞掉时
//      状态泄漏（指示器残留跟随鼠标）
//   4. Escape 键取消拖拽
//   5. finishInternalDrag 中关闭状态 + 解绑全局事件 + 清除指示器
//   6. 跨容器拖动：onWindowMouseMove 用 elementsFromPoint 搜索所有 grid host

const internalDrag = ref<{ sourceNodeId: string; sourceContainerId: string; startX: number; startY: number; active: boolean; dragOverGridId: string | null } | null>(null);
const spanResize = ref<{
  childId: string;
  startX: number;
  startY: number;
  startGrid: SpanGrid;
  cellWidth: number;
  cellHeight: number;
  lastRowSpan: number;
  lastColSpan: number;
  historyRecorded: boolean;
} | null>(null);
const resizeFlagDrag = ref<{ axis: "row" | "col"; enabled: boolean; touched: Set<number> } | null>(null);

function onCellMouseDown(e: MouseEvent, child: CaaDialogNode) {
  // 仅记录拖拽起点。
  // stopPropagation 防止嵌套容器场景下事件冒泡到父 grid cell，
  // 导致父容器 hijack 拖拽（把整个容器移动而非目标控件）。
  if (e.button !== 0) return;
  e.stopPropagation();
  console.log("[CAA drag] mousedown: node=%s container=%s type=%s", child.id, props.node.id, child.type);
  internalDrag.value = {
    sourceNodeId: child.id,
    sourceContainerId: props.node.id,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    dragOverGridId: null,
  };
}

function onSpanResizePointerDown(e: PointerEvent, child: CaaDialogNode) {
  if (e.button !== 0 || !child.grid || !ctx) return;
  e.preventDefault();
  e.stopPropagation();
  cancelInternalDrag();
  ctx.select(child.id);

  const cellEl = (e.currentTarget as HTMLElement).closest(".caa-grid-cell") as HTMLElement | null;
  const rect = cellEl?.getBoundingClientRect();
  const cellWidth = rect ? rect.width / Math.max(1, child.grid.colSpan) : 32;
  const cellHeight = rect ? rect.height / Math.max(1, child.grid.rowSpan) : 24;
  spanResize.value = {
    childId: child.id,
    startX: e.clientX,
    startY: e.clientY,
    startGrid: { ...child.grid },
    cellWidth,
    cellHeight,
    lastRowSpan: child.grid.rowSpan,
    lastColSpan: child.grid.colSpan,
    historyRecorded: false,
  };
  document.body.classList.add("caa-span-resize-active");
  window.addEventListener("pointermove", onWindowSpanResizeMove);
  window.addEventListener("pointerup", onWindowSpanResizeUp);
  window.addEventListener("keydown", onWindowSpanResizeKeyDown);
}

function cancelSpanResize() {
  spanResize.value = null;
  document.body.classList.remove("caa-span-resize-active");
  window.removeEventListener("pointermove", onWindowSpanResizeMove);
  window.removeEventListener("pointerup", onWindowSpanResizeUp);
  window.removeEventListener("keydown", onWindowSpanResizeKeyDown);
}

function onWindowSpanResizeMove(e: PointerEvent) {
  if (!(e.buttons & 1)) { cancelSpanResize(); return; }
  const d = spanResize.value;
  if (!d || !ctx) return;
  e.preventDefault();
  const result = resolveSpanResize({
    children: props.node.children,
    nodeId: d.childId,
    startGrid: d.startGrid,
    deltaX: e.clientX - d.startX,
    deltaY: e.clientY - d.startY,
    cellWidth: d.cellWidth,
    cellHeight: d.cellHeight,
  });
  if (!result.success) return;
  if (result.rowSpan === d.lastRowSpan && result.colSpan === d.lastColSpan) return;
  if (!d.historyRecorded) {
    ctx.recordHistory();
    d.historyRecorded = true;
  }
  d.lastRowSpan = result.rowSpan;
  d.lastColSpan = result.colSpan;
  const children = props.node.children.map((candidate) => {
    if (candidate.id !== d.childId || !candidate.grid) return candidate;
    return {
      ...candidate,
      grid: {
        ...candidate.grid,
        rowSpan: result.rowSpan,
        colSpan: result.colSpan,
      },
    };
  });
  ctx.setChildren(props.node.id, children, d.childId);
}

function onWindowSpanResizeUp() {
  cancelSpanResize();
}

function onWindowSpanResizeKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") cancelSpanResize();
}

function cancelInternalDrag() {
  internalDrag.value = null;
  clearDragState();
  if (ctx) ctx.dragJustEnded.value = true;
  window.removeEventListener("mouseup", onWindowMouseUp);
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("keydown", onWindowKeyDown);
}

function finishInternalDrag() {
  const d = internalDrag.value;
  if (d && d.active && dragOverCell.value && ctx) {
    const { row, col, edge } = dragOverCell.value;
    const targetId = d.dragOverGridId || props.node.id;
    const srcNode = ctx.dialogRoot ? findCaaNode(ctx.dialogRoot, d.sourceNodeId) : null;
    console.log("[CAA drag] finishInternalDrag: sourceNode=%s grid=(%d,%d) srcCtr=%s -> target=%s cell=(%d,%d) edge=%s%s",
      d.sourceNodeId,
      srcNode?.grid?.row ?? -1, srcNode?.grid?.col ?? -1,
      d.sourceContainerId,
      targetId, row, col, edge,
      targetId !== d.sourceContainerId ? " ★跨容器" : "");
    doDrop(row, col, edge, `MOVE:${d.sourceNodeId}:${d.sourceContainerId}`, targetId);
  }
  // 无论是否完成拖放，都抑制后续 click（防止拖拽后误触发选中）
  if (ctx) ctx.dragJustEnded.value = true;
  internalDrag.value = null;
  clearDragState();
  window.removeEventListener("mouseup", onWindowMouseUp);
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("keydown", onWindowKeyDown);
}

function onWindowMouseUp() { finishInternalDrag(); }
function onWindowMouseMove(e: MouseEvent) {
  // 安全网：鼠标松开（buttons=0）则强制取消
  if (!(e.buttons & 1)) { cancelInternalDrag(); return; }
  const d = internalDrag.value;
  if (!d) return;
  // 跨容器 hit-test：搜索鼠标下所有元素，找到第一个 grid host（不限于源容器）
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  const gridEl = els.find((el) => el.hasAttribute("data-grid-host")) as HTMLElement | null;
  if (!gridEl) {
    dragOverCell.value = null;
    if (ctx) ctx.dropIndicator.value.rect = null;
    d.dragOverGridId = null;
    return;
  }
  const foundId = gridEl.getAttribute("data-grid-host") || "";
  const prevGridId = d.dragOverGridId;
  d.dragOverGridId = foundId;
  const cell = cellFromPoint(gridEl, e.clientX, e.clientY);
  // 只在进入新 grid 时打一次（减少刷屏）
  if (foundId !== prevGridId) {
    const srcNode = ctx?.dialogRoot ? findCaaNode(ctx.dialogRoot, d.sourceNodeId) : null;
    console.log("[CAA drag] 切换目标: %s -> %s  cell=(%d,%d) edge=%s",
      prevGridId || "(none)", foundId,
      cell?.row ?? -1, cell?.col ?? -1, cell?.edge ?? "?");
  }
  dragOverCell.value = cell;
  writeDropIndicator(cell, gridEl, e.clientX, e.clientY);
  dragOverCell.value = cell;
  writeDropIndicator(cell, gridEl, e.clientX, e.clientY);
}
function onWindowKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") cancelInternalDrag();
}

function onGridMouseMove(e: MouseEvent) {
  // 安全检查：按钮已松开则强制退出拖拽（防止 mouseup 事件被吞导致指示器残留）
  if (!(e.buttons & 1)) {
    if (internalDrag.value) cancelInternalDrag();
    return;
  }
  const d = internalDrag.value;
  if (!d) return;

  const dx = Math.abs(e.clientX - d.startX);
  const dy = Math.abs(e.clientY - d.startY);

  // 阈值前不阻止冒泡（区分点击和拖拽）
  if (dx < 5 && dy < 5) return;

  // 跨容器：检查鼠标是否实际落在另一个 grid host 内（嵌套容器场景）
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  const firstGrid = els.find((el) => el.hasAttribute("data-grid-host")) as HTMLElement | null;
  if (firstGrid) {
    const hitId = firstGrid.getAttribute("data-grid-host") || "";
    if (hitId !== props.node.id) {
      console.log("[CAA drag] onGridMouseMove 检测到跨容器: source=%s target=%s (放行)", props.node.id, hitId);
      // 鼠标在子容器内 → 不放行 stopPropagation，让事件冒泡到 onWindowMouseMove
      return;
    }
  }

  e.stopPropagation();

  // 首次跨越阈值：激活拖拽 + 绑定全局事件
  if (!d.active) {
    d.active = true;
    dragOverGrid.value = true;
    console.log("[CAA drag] 激活: sourceNode=%s sourceContainer=%s", d.sourceNodeId, d.sourceContainerId);
    window.addEventListener("mouseup", onWindowMouseUp);
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("keydown", onWindowKeyDown);
  }

  const gridEl = e.currentTarget as HTMLElement;
  const cell = cellFromPoint(gridEl, e.clientX, e.clientY);
  dragOverCell.value = cell;
  writeDropIndicator(cell, gridEl, e.clientX, e.clientY);
}

function onGridMouseUp(e: MouseEvent) {
  // 只有本组件有活跃拖拽时才处理；否则放行冒泡给 window → 源组件的 finishInternalDrag
  if (!internalDrag.value) return;
  e.stopPropagation();
  finishInternalDrag();
}

// ── HTML5 外部拖入 ──

function onCellDragStart(e: DragEvent, child: CaaDialogNode) {
  e.stopPropagation();
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", `caa:MOVE:${child.id}:${props.node.id}`);
}

// ── toggle resize from indicator click ──

function toggleColResize(col: number) {
  ctx?.toggleGridColResize(props.node.id, col);
}
function toggleRowResize(row: number) {
  ctx?.toggleGridRowResize(props.node.id, row);
}

// ── grid settings popover ──

function startResizeFlagDrag(axis: "row" | "col", index: number, enabled: boolean) {
  if (!ctx) return;
  ctx.recordHistory();
  resizeFlagDrag.value = { axis, enabled, touched: new Set<number>() };
  applyResizeFlagDrag(axis, index);
  window.addEventListener("pointerup", finishResizeFlagDrag);
  window.addEventListener("keydown", onResizeFlagDragKeyDown);
}

function applyResizeFlagDrag(axis: "row" | "col", index: number) {
  const d = resizeFlagDrag.value;
  if (!ctx || !d || d.axis !== axis || d.touched.has(index)) return;
  d.touched.add(index);
  if (axis === "row") {
    ctx.setGridRowResize(props.node.id, index, d.enabled, { recordHistory: false });
  } else {
    ctx.setGridColResize(props.node.id, index, d.enabled, { recordHistory: false });
  }
}

function finishResizeFlagDrag() {
  resizeFlagDrag.value = null;
  window.removeEventListener("pointerup", finishResizeFlagDrag);
  window.removeEventListener("keydown", onResizeFlagDragKeyDown);
}

function onResizeFlagDragKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") finishResizeFlagDrag();
}

function onColResizePointerDown(e: PointerEvent, col: number) {
  if (e.button !== 0 || !ctx) return;
  e.preventDefault();
  e.stopPropagation();
  startResizeFlagDrag("col", col, !colSet.value.has(col));
}

function onRowResizePointerDown(e: PointerEvent, row: number) {
  if (e.button !== 0 || !ctx) return;
  e.preventDefault();
  e.stopPropagation();
  startResizeFlagDrag("row", row, !rowSet.value.has(row));
}

function onColResizePointerEnter(e: PointerEvent, col: number) {
  if (!(e.buttons & 1)) return;
  applyResizeFlagDrag("col", col);
}

function onRowResizePointerEnter(e: PointerEvent, row: number) {
  if (!(e.buttons & 1)) return;
  applyResizeFlagDrag("row", row);
}

const settingsOpen = ref(false);

// ── right-click context menu ──

function onGridContextmenu(e: MouseEvent) {
  // 拖动中右键 → 取消拖动
  if (internalDrag.value?.active) { cancelInternalDrag(); return; }
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
    :data-grid-host="node.id"
    :class="{ 'caa-grid-host--drop-target': dragOverGrid, 'caa-grid-host--empty': !node.children.length }"
    @dragenter="onGridDragEnter"
    @dragover="onGridDragOver"
    @dragleave="onGridDragLeave"
    @drop="onGridDrop"
    @mousemove="onGridMouseMove"
    @mouseup="onGridMouseUp"
  >
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
          @pointerdown="onColResizePointerDown($event, c - 1)"
          @pointerenter="onColResizePointerEnter($event, c - 1)"
          @click.stop.prevent
          @keydown.enter.prevent="toggleColResize(c - 1)"
          @keydown.space.prevent="toggleColResize(c - 1)"
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
          role="button"
          tabindex="0"
          @pointerdown="onRowResizePointerDown($event, r - 1)"
          @pointerenter="onRowResizePointerEnter($event, r - 1)"
          @click.stop.prevent
          @keydown.enter.prevent="toggleRowResize(r - 1)"
          @keydown.space.prevent="toggleRowResize(r - 1)"
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
        :data-grid-row="child.grid?.row"
        :data-grid-col="child.grid?.col"
        :class="{ 'caa-grid-cell--edit': editMode, 'caa-grid-cell--dragging': dragOverGrid, 'caa-grid-cell--span-resizing': spanResize?.childId === child.id }"
        :style="itemStyle(child, editMode)"
        @dragstart.stop="onCellDragStart($event, child)"
        @mousedown="onCellMouseDown($event, child)"
      >
        <CaaDialogNodeView
          :node="child"
          :fill-parent="fillParent"
          :dialog-root="dialogRoot"
          :width-style="childResizeStyle(child)"
        />
        <button
          v-if="editMode && child.grid"
          type="button"
          class="caa-span-resize-handle"
          title="拖拽调整控件跨行/跨列"
          aria-label="拖拽调整控件跨行/跨列"
          @pointerdown="onSpanResizePointerDown($event, child)"
          @mousedown.stop.prevent
          @click.stop.prevent
        />
      </div>

      <!-- 空格子占位（仅编辑模式）：无控件占据的 cell，提供拖放检测区域 -->
      <div
        v-for="ec in emptyCells"
        :key="'empty-' + ec.row + '-' + ec.col"
        class="caa-grid-cell caa-grid-cell--empty"
        :class="{ 'caa-grid-cell--edit': editMode }"
        :data-grid-row="ec.row"
        :data-grid-col="ec.col"
        :style="{
          gridRow: `${ec.row + (editMode ? 2 : 1)} / span 1`,
          gridColumn: `${ec.col + (editMode ? 2 : 1)} / span 1`,
          minWidth: '0',
        }"
      />

    <!-- drop 指示器已移至顶层 CaaDropOverlay（position:absolute + 像素定位细条） -->
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

/* drop 指示器已移至顶层 CaaDropOverlay */

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
  position: relative;
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
  user-select: none;
  -webkit-user-select: none;
}

/* 空格子占位：编辑模式下显示虚线边界，让用户看到 grid 结构 */
.caa-grid-cell--span-resizing {
  outline: 1px solid #2563eb;
  outline-offset: -1px;
}

.caa-span-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 11px;
  height: 11px;
  padding: 0;
  border: 1px solid #64748b;
  border-radius: 2px;
  background:
    linear-gradient(135deg, transparent 50%, #64748b 50%) right bottom / 7px 7px no-repeat,
    #f8fafc;
  cursor: nwse-resize;
  opacity: 0;
  transition: opacity 0.12s, border-color 0.12s, background-color 0.12s;
}

.caa-grid-cell--edit:hover > .caa-span-resize-handle,
.caa-grid-cell--span-resizing > .caa-span-resize-handle,
.caa-span-resize-handle:focus-visible {
  opacity: 1;
}

.caa-span-resize-handle:hover,
.caa-span-resize-handle:focus-visible {
  border-color: #2563eb;
  background-color: #eff6ff;
}

:global(body.caa-span-resize-active) {
  cursor: nwse-resize;
}

.caa-grid-cell--empty {
  background: transparent;
  min-height: 24px;
  min-width: 24px;
}

.caa-grid-cell--empty.caa-grid-cell--edit {
  background: #fafbfc;
  outline: 1px dashed #e2e8f0;
  outline-offset: -1px;
}

.caa-grid--fill .caa-grid-cell {
  align-items: stretch;
  width: 100%;
}
</style>
