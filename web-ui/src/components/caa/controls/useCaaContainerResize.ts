import { computed, type ComputedRef } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";

export interface ContainerResizeResult {
  /** grid-template-columns */
  columnTemplate: string;
  /** 按子控件获取显式宽度样式 */
  getChildWidth: (child: CaaDialogNode) => Record<string, string> | undefined;
  /** 网格总宽 */
  gridWidth: string;
}

/**
 * 容器控件统一 resize 逻辑 —— baseContainer 共享 composable。
 *
 * **只控制宽度**。高度由内容自底向上驱动：
 *   控件固有高 → 行高 → Grid 高 → 容器高 → … → Dialog 高。
 * 不向子控件推高度——避免循环依赖。
 *
 * 列宽：COLRES → `1fr` + `width:100%`；非 COLRES → `auto` + `TWch` 或无。
 */
export function useCaaContainerResize(
  node: () => CaaDialogNode,
): ComputedRef<ContainerResizeResult> {
  return computed((): ContainerResizeResult => {
    const n = node();
    const children = n.children;

    // ── 列计数 ──
    let maxCol = 0;
    for (const c of children) {
      const g = c.grid;
      if (!g) continue;
      maxCol = Math.max(maxCol, g.col + (g.colSpan ?? 1));
    }
    const cols = Math.max(1, maxCol);
    const colResizable = n.gridLayout?.colResizable ?? [];
    const colSet = new Set(colResizable);

    // ── 列模板：COLRES → 1fr，其余 → auto ──
    const colParts: string[] = [];
    for (let i = 0; i < cols; i++) colParts.push(colSet.has(i) ? "1fr" : "auto");

    // ── 子控件宽度 ──
    const widthMap = new Map<string, Record<string, string>>();
    for (const c of children) {
      const g = c.grid;
      if (!g) continue;
      if (colSet.has(g.col)) {
        widthMap.set(c.id, { width: "100%", maxWidth: "100%", boxSizing: "border-box" });
      } else if (c.size?.textWidth && c.size.textWidth > 0) {
        widthMap.set(c.id, { width: `${c.size.textWidth}ch`, maxWidth: "100%", boxSizing: "border-box" });
      }
    }

    return {
      columnTemplate: colParts.join(" "),
      getChildWidth: (child) => widthMap.get(child.id),
      gridWidth: "100%",
    };
  });
}
