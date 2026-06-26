import { computed, type ComputedRef } from "vue";
import type { CaaDialogNode, GridPlacement } from "../../../types/caaDialogIr";

export interface ContainerResizeResult {
  /** grid-template-columns */
  columnTemplate: string;
  /** grid-template-rows */
  rowTemplate: string;
  /** Explicit child size styles derived from ROWRES/COLRES and TW. */
  getChildWidth: (child: CaaDialogNode) => Record<string, string> | undefined;
  /** Grid total width. */
  gridWidth: string;
}

/**
 * Shared base-container resize logic.
 *
 * COLRES/ROWRES are CAA stretch flags. In the preview we map stretch tracks to
 * `1fr` and fixed tracks to `auto`; child controls in stretch tracks receive a
 * 100% size hint so local TW/default sizing does not override the container.
 */
export function useCaaContainerResize(
  node: () => CaaDialogNode,
): ComputedRef<ContainerResizeResult> {
  return computed((): ContainerResizeResult => {
    const n = node();
    const children = n.children;

    let maxRow = 0;
    let maxCol = 0;
    for (const child of children) {
      const g = child.grid;
      if (!g) continue;
      maxRow = Math.max(maxRow, g.row + (g.rowSpan ?? 1));
      maxCol = Math.max(maxCol, g.col + (g.colSpan ?? 1));
    }

    const rows = Math.max(1, maxRow);
    const cols = Math.max(1, maxCol);
    const rowSet = new Set(n.gridLayout?.rowResizable ?? []);
    const colSet = new Set(n.gridLayout?.colResizable ?? []);

    const rowTemplate = Array.from({ length: rows }, (_, i) =>
      rowSet.has(i) ? "1fr" : "auto",
    ).join(" ");
    const columnTemplate = Array.from({ length: cols }, (_, i) =>
      colSet.has(i) ? "1fr" : "auto",
    ).join(" ");

    const sizeMap = new Map<string, Record<string, string>>();
    for (const child of children) {
      const g = child.grid;
      if (!g) continue;
      const style: Record<string, string> = {};

      if (childTouchesResizableCol(g, colSet)) {
        style.width = "100%";
        style.maxWidth = "100%";
        style.boxSizing = "border-box";
      } else if (child.size?.textWidth && child.size.textWidth > 0) {
        style.width = `${child.size.textWidth}ch`;
        style.maxWidth = "100%";
        style.boxSizing = "border-box";
      }

      if (childTouchesResizableRow(g, rowSet)) {
        style.height = "100%";
        style.boxSizing = "border-box";
      }

      if (Object.keys(style).length > 0) {
        sizeMap.set(child.id, style);
      }
    }

    return {
      columnTemplate,
      rowTemplate,
      getChildWidth: (child) => sizeMap.get(child.id),
      gridWidth: "100%",
    };
  });
}

function childTouchesResizableCol(grid: GridPlacement, colSet: Set<number>): boolean {
  const span = Math.max(1, grid.colSpan ?? 1);
  for (let col = grid.col; col < grid.col + span; col++) {
    if (colSet.has(col)) return true;
  }
  return false;
}

function childTouchesResizableRow(grid: GridPlacement, rowSet: Set<number>): boolean {
  const span = Math.max(1, grid.rowSpan ?? 1);
  for (let row = grid.row; row < grid.row + span; row++) {
    if (rowSet.has(row)) return true;
  }
  return false;
}
