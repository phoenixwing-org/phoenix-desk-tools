export type SpanGrid = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
};

export type SpanGridChild = {
  id?: string;
  grid?: SpanGrid;
};

export type SpanResizeResult =
  | { success: true; rowSpan: number; colSpan: number }
  | { success: false; reason: string };

export interface ResolveSpanResizeInput {
  children: readonly SpanGridChild[];
  nodeId: string;
  startGrid: SpanGrid;
  deltaX: number;
  deltaY: number;
  cellWidth: number;
  cellHeight: number;
  maxExtraRows?: number;
  maxExtraCols?: number;
}

export function resolveSpanResize(input: ResolveSpanResizeInput): SpanResizeResult {
  const child = input.children.find((c) => c.id === input.nodeId);
  if (!child?.grid) {
    return { success: false, reason: "node has no grid placement" };
  }

  const next = spanFromDragDelta(input);
  const proposed: SpanGrid = {
    row: input.startGrid.row,
    col: input.startGrid.col,
    rowSpan: next.rowSpan,
    colSpan: next.colSpan,
  };
  const blocker = input.children.find((candidate) => {
    if (candidate.id === input.nodeId || !candidate.grid) return false;
    return gridRectsOverlap(proposed, candidate.grid);
  });
  if (blocker) {
    return { success: false, reason: `span overlaps ${blocker.id ?? "sibling"}` };
  }
  return { success: true, rowSpan: next.rowSpan, colSpan: next.colSpan };
}

export function spanFromDragDelta(input: {
  startGrid: SpanGrid;
  deltaX: number;
  deltaY: number;
  cellWidth: number;
  cellHeight: number;
  maxExtraRows?: number;
  maxExtraCols?: number;
}): { rowSpan: number; colSpan: number } {
  const safeCellWidth = Math.max(1, input.cellWidth);
  const safeCellHeight = Math.max(1, input.cellHeight);
  const maxCols = input.startGrid.colSpan + Math.max(0, input.maxExtraCols ?? 8);
  const maxRows = input.startGrid.rowSpan + Math.max(0, input.maxExtraRows ?? 8);
  return {
    colSpan: clamp(input.startGrid.colSpan + Math.round(input.deltaX / safeCellWidth), 1, maxCols),
    rowSpan: clamp(input.startGrid.rowSpan + Math.round(input.deltaY / safeCellHeight), 1, maxRows),
  };
}

export function gridRectsOverlap(a: SpanGrid, b: SpanGrid): boolean {
  return (
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan &&
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
