import { describe, it, expect } from "vitest";
import {
  resolveDropEdge, resolveDropEdgeFromRect, isCellOccupied,
  getSpanningChild, computeDropPlacement, applyDropTransform, findOverlaps,
} from "./caaDropZone";

// ── helpers ──

const c = (r: number, col: number, rs = 1, cs = 1) => ({ grid: { row: r, col, rowSpan: rs, colSpan: cs } });

// ═══════════════════════════════
// isCellOccupied
// ═══════════════════════════════

describe("isCellOccupied", () => {
  it("exact match", () => {
    expect(isCellOccupied([c(0, 0)], 0, 0)).toBe(true);
    expect(isCellOccupied([c(0, 0)], 0, 1)).toBe(false);
    expect(isCellOccupied([c(0, 0)], 1, 0)).toBe(false);
  });

  it("colSpan covers adjacent columns", () => {
    const children = [c(0, 0, 1, 2)];
    expect(isCellOccupied(children, 0, 0)).toBe(true);
    expect(isCellOccupied(children, 0, 1)).toBe(true);
    expect(isCellOccupied(children, 0, 2)).toBe(false);
  });

  it("rowSpan covers adjacent rows", () => {
    const children = [c(0, 0, 2, 1)];
    expect(isCellOccupied(children, 0, 0)).toBe(true);
    expect(isCellOccupied(children, 1, 0)).toBe(true);
    expect(isCellOccupied(children, 2, 0)).toBe(false);
  });

  it("rowSpan+colSpan covers a block", () => {
    const children = [c(1, 1, 2, 3)];
    expect(isCellOccupied(children, 1, 1)).toBe(true);
    expect(isCellOccupied(children, 1, 3)).toBe(true);
    expect(isCellOccupied(children, 2, 2)).toBe(true);
    expect(isCellOccupied(children, 3, 1)).toBe(false);
    expect(isCellOccupied(children, 1, 4)).toBe(false);
  });

  it("child without grid is not occupied", () => {
    expect(isCellOccupied([{ id: "X" }] as any, 0, 0)).toBe(false);
  });
});

// ═══════════════════════════════
// getSpanningChild
// ═══════════════════════════════

describe("getSpanningChild", () => {
  it("返回占据精确 cell 的控件", () => {
    const child = c(0, 0);
    expect(getSpanningChild([child], 0, 0)).toBe(child);
  });

  it("返回 colSpan 覆盖的控件", () => {
    const child = c(0, 0, 1, 3);
    expect(getSpanningChild([child], 0, 2)).toBe(child);
  });

  it("返回 rowSpan 覆盖的控件", () => {
    const child = c(1, 0, 2, 1);
    expect(getSpanningChild([child], 2, 0)).toBe(child); // row 2 is covered by rowSpan 2 starting at 1
  });

  it("空 cell 返回 undefined", () => {
    expect(getSpanningChild([c(0, 0)], 0, 1)).toBeUndefined();
  });

  it("空 children 返回 undefined", () => {
    expect(getSpanningChild([], 0, 0)).toBeUndefined();
  });
});

// ═══════════════════════════════
// resolveDropEdge
// ═══════════════════════════════

describe("resolveDropEdge", () => {
  describe("空 cell（无控件）", () => {
    it("始终返回 inside", () => {
      expect(resolveDropEdge({ occupied: false, xPct: 0, yPct: 0 })).toBe("inside");
      expect(resolveDropEdge({ occupied: false, xPct: 0.9, yPct: 0.9 })).toBe("inside");
      expect(resolveDropEdge({ occupied: false, xPct: 0.5, yPct: 0.5 })).toBe("inside");
    });
  });

  describe("有控件的 cell", () => {
    it("鼠标偏右 x>0.5 → right", () => {
      expect(resolveDropEdge({ occupied: true, xPct: 0.8, yPct: 0.3 })).toBe("right");
    });

    it("鼠标右下 x>=y 且 x>0.5 → right", () => {
      expect(resolveDropEdge({ occupied: true, xPct: 0.7, yPct: 0.7 })).toBe("right");
    });

    it("鼠标偏左 x>=y 且 x<=0.5 → left", () => {
      expect(resolveDropEdge({ occupied: true, xPct: 0.2, yPct: 0.1 })).toBe("left");
    });

    it("鼠标左上角 x=y 且 x<=0.5 → left", () => {
      expect(resolveDropEdge({ occupied: true, xPct: 0.1, yPct: 0.1 })).toBe("left");
    });

    it("鼠标偏下 y>x 且 y>0.5 → bottom", () => {
      expect(resolveDropEdge({ occupied: true, xPct: 0.3, yPct: 0.8 })).toBe("bottom");
    });

    it("鼠标偏上 y>x 且 y<=0.5 → top", () => {
      expect(resolveDropEdge({ occupied: true, xPct: 0.1, yPct: 0.2 })).toBe("top");
    });

    it("4 象限全覆盖（100 随机点暴力测试）", () => {
      let sawRight = false, sawLeft = false, sawBottom = false, sawTop = false;
      for (let i = 0; i < 200; i++) {
        const r = resolveDropEdge({ occupied: true, xPct: Math.random(), yPct: Math.random() });
        expect(r).not.toBe("inside");
        if (r === "right") sawRight = true;
        if (r === "left") sawLeft = true;
        if (r === "bottom") sawBottom = true;
        if (r === "top") sawTop = true;
      }
      expect(sawRight && sawLeft && sawBottom && sawTop).toBe(true);
    });
  });
});

// ═══════════════════════════════
// resolveDropEdgeFromRect
// ═══════════════════════════════

describe("resolveDropEdgeFromRect", () => {
  it("空 cell 返回 inside", () => {
    expect(resolveDropEdgeFromRect(false, { left: 100, top: 200, width: 80, height: 60 }, 140, 230)).toBe("inside");
  });

  it("有控件 + 鼠标在右侧 → right", () => {
    expect(resolveDropEdgeFromRect(true, { left: 100, top: 200, width: 80, height: 60 }, 170, 220)).toBe("right");
  });

  it("有控件 + 鼠标在下侧 → bottom", () => {
    expect(resolveDropEdgeFromRect(true, { left: 100, top: 200, width: 80, height: 60 }, 120, 250)).toBe("bottom");
  });

  it("有控件 + 鼠标在左上角 → top（非 inside）", () => {
    expect(resolveDropEdgeFromRect(true, { left: 100, top: 200, width: 80, height: 60 }, 105, 205)).toBe("top");
  });

  it("有控件 + 鼠标在左侧 → left", () => {
    // xPct=0.25, yPct=0.17 → x>=y 且 x<=0.5 → left
    expect(resolveDropEdgeFromRect(true, { left: 100, top: 200, width: 80, height: 60 }, 120, 210)).toBe("left");
  });
});

// ═══════════════════════════════
// computeDropPlacement
// ═══════════════════════════════

describe("computeDropPlacement", () => {
  // ── inside ──

  describe("edge=inside 空 cell → 允许", () => {
    it("空白容器", () => {
      const r = computeDropPlacement([], 0, 0, "inside");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(0);
      expect(r.insertRowBefore).toBeUndefined();
      expect(r.insertColBefore).toBeUndefined();
    });

    it("有其他控件但不在此 cell", () => {
      const r = computeDropPlacement([c(1, 1)], 0, 0, "inside");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(0);
    });
  });

  describe("edge=inside 有控件 → 拒绝", () => {
    it("精确匹配拒绝", () => {
      const r = computeDropPlacement([c(0, 0)], 0, 0, "inside");
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain("占据");
    });

    it("colSpan 覆盖拒绝", () => {
      const r = computeDropPlacement([c(0, 0, 1, 2)], 0, 1, "inside");
      expect(r.allowed).toBe(false);
    });

    it("rowSpan 覆盖拒绝", () => {
      const r = computeDropPlacement([c(0, 0, 2, 1)], 1, 0, "inside");
      expect(r.allowed).toBe(false);
    });

    it("rowSpan+colSpan 块覆盖拒绝", () => {
      const r = computeDropPlacement([c(1, 1, 2, 3)], 2, 2, "inside");
      expect(r.allowed).toBe(false);
    });
  });

  // ── right ──

  describe("edge=right 无 span", () => {
    it("空白容器 → 在 (0,1) 插入 col 1", () => {
      const r = computeDropPlacement([], 0, 0, "right");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(1);
      expect(r.insertColBefore).toBe(1);
    });

    it("有空 cell 的右侧 → 插入 col", () => {
      const r = computeDropPlacement([c(0, 0)], 0, 1, "right");
      expect(r.allowed).toBe(true);
      expect(r.placeCol).toBe(2);
      expect(r.insertColBefore).toBe(2);
    });
  });

  describe("edge=right 有 spanning 控件 → 跳到 span 结束之后", () => {
    it("colSpan=2 控件占据 (0,0)-(0,1) → insertColBefore=2", () => {
      const r = computeDropPlacement([c(0, 0, 1, 2)], 0, 1, "right");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(2);
      expect(r.placeCol).toBe(2);
      expect(r.placeRow).toBe(0);
    });

    it("colSpan=3 控件占据 (0,0)-(0,2) → insertColBefore=3", () => {
      const r = computeDropPlacement([c(0, 0, 1, 3)], 0, 1, "right");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(3);
      expect(r.placeCol).toBe(3);
    });

    it("spanning 控件在原点 → 右边界 = span 结束", () => {
      const r = computeDropPlacement([c(0, 0, 1, 4)], 0, 0, "right");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(4); // 0+4
      expect(r.placeCol).toBe(4);
    });

    it("插入点正确取 max(targetCol+1, endCol)", () => {
      // 控件 X 在 (0,1) colSpan=1, Y 在 (0,2) colSpan=1
      // 拖到 (0,3) edge="right" → targetCol+1=4 > endCol(3+1=4) → insertColBefore=4
      const children = [c(0, 1), c(0, 2)];
      const r = computeDropPlacement(children, 0, 3, "right");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(4);
    });
  });

  // ── left ──

  describe("edge=left 无 span", () => {
    it("空白容器 → 在 (0,0) 插入 col 0（当前列左侧）", () => {
      const r = computeDropPlacement([], 0, 0, "left");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(0);
      expect(r.insertColBefore).toBe(0);
    });

    it("有控件在 (0,0)，拖到 (0,1) left → 在 col 1 前插入", () => {
      const r = computeDropPlacement([c(0, 0)], 0, 1, "left");
      expect(r.allowed).toBe(true);
      expect(r.placeCol).toBe(1);
      expect(r.insertColBefore).toBe(1);
    });
  });

  describe("edge=left 有 spanning 控件 → 跳到 span 起始", () => {
    it("colSpan=2 控件占据 (0,0)-(0,1)，拖 (0,1) left → insertColBefore=0", () => {
      const r = computeDropPlacement([c(0, 0, 1, 2)], 0, 1, "left");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(0);
      expect(r.placeCol).toBe(0);
      expect(r.placeRow).toBe(0);
    });

    it("colSpan=3 控件占据 (0,0)-(0,2)，拖 (0,2) left → insertColBefore=0", () => {
      const r = computeDropPlacement([c(0, 0, 1, 3)], 0, 2, "left");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(0);
      expect(r.placeCol).toBe(0);
    });

    it("spanning 控件不在原点 → 左边界 = span 起始", () => {
      const r = computeDropPlacement([c(0, 2, 1, 3)], 0, 3, "left");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(2);
      expect(r.placeCol).toBe(2);
    });
  });

  // ── bottom ──

  describe("edge=bottom 无 span", () => {
    it("空白容器 → 在 (1,0) 插入 row 1", () => {
      const r = computeDropPlacement([], 0, 0, "bottom");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(1);
      expect(r.placeCol).toBe(0);
      expect(r.insertRowBefore).toBe(1);
    });

    it("有空 cell 的下方 → 插入 row", () => {
      const r = computeDropPlacement([c(0, 0)], 0, 0, "bottom");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(1);
      expect(r.insertRowBefore).toBe(1);
    });
  });

  describe("edge=bottom 有 spanning 控件 → 跳到 span 结束之后", () => {
    it("rowSpan=2 控件占据 (0,0)-(1,0) → insertRowBefore=2", () => {
      const r = computeDropPlacement([c(0, 0, 2, 1)], 1, 0, "bottom");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(2);
      expect(r.placeRow).toBe(2);
      expect(r.placeCol).toBe(0);
    });

    it("rowSpan=3 控件占据 (0,0)-(2,0) → insertRowBefore=3", () => {
      const r = computeDropPlacement([c(0, 0, 3, 1)], 1, 0, "bottom");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(3);
      expect(r.placeRow).toBe(3);
    });

    it("spanning 控件在原点 → 下边界 = span 结束", () => {
      const r = computeDropPlacement([c(0, 0, 2, 1)], 0, 0, "bottom");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(2);
      expect(r.placeRow).toBe(2);
    });
  });

  // ── top ──

  describe("edge=top 无 span", () => {
    it("空白容器 → 在 (0,0) 插入 row 0（当前行上方）", () => {
      const r = computeDropPlacement([], 0, 0, "top");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(0);
      expect(r.insertRowBefore).toBe(0);
    });

    it("有控件在 (0,0)，拖到 (1,0) top → 在 row 1 上方插入", () => {
      const r = computeDropPlacement([c(0, 0)], 1, 0, "top");
      expect(r.allowed).toBe(true);
      expect(r.placeRow).toBe(1);
      expect(r.insertRowBefore).toBe(1);
    });
  });

  describe("edge=top 有 spanning 控件 → 跳到 span 起始", () => {
    it("rowSpan=2 控件占据 (0,0)-(1,0)，拖 (1,0) top → insertRowBefore=0", () => {
      const r = computeDropPlacement([c(0, 0, 2, 1)], 1, 0, "top");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(0);
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(0);
    });

    it("rowSpan=3 控件占据 (1,0)-(3,0)，拖 (2,0) top → insertRowBefore=1", () => {
      const r = computeDropPlacement([c(1, 0, 3, 1)], 2, 0, "top");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(1);
      expect(r.placeRow).toBe(1);
    });

    it("spanning 控件在原点 → 上边界 = span 起始", () => {
      const r = computeDropPlacement([c(0, 0, 2, 1)], 0, 0, "top");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(0);
      expect(r.placeRow).toBe(0);
    });
  });

  // ── 放置后不冲突验证 ──

  describe("放置后不与已有控件重叠", () => {
    it("right: 新控件放在 span 结束列，不重叠", () => {
      // X 在 (0,0) colSpan=2 → 覆盖 [0,1]
      // right edge → insertColBefore=2, placeCol=2
      // 插入 col 2: X col=0 < 2 不位移，colSpan=2 也不跨越 col 2
      // 新控件在 (0,2) — 不在 X 的范围内
      const r = computeDropPlacement([c(0, 0, 1, 2)], 0, 1, "right");
      const placed = { row: r.placeRow, col: r.placeCol, rowSpan: 1, colSpan: 1 };
      expect(isCellOccupied([c(0, 0, 1, 2)], placed.row, placed.col)).toBe(false);
    });

    it("bottom: 新控件放在 span 结束行，不重叠", () => {
      const r = computeDropPlacement([c(0, 0, 2, 1)], 1, 0, "bottom");
      const placed = { row: r.placeRow, col: r.placeCol, rowSpan: 1, colSpan: 1 };
      expect(isCellOccupied([c(0, 0, 2, 1)], placed.row, placed.col)).toBe(false);
    });

    it("复杂场景：多个 span 控件，right edge 不重叠", () => {
      // X 在 (0,0) colSpan=2, Y 在 (1,1) colSpan=2
      // 拖到 (0,1) right → spanning=X, endCol=2, insertColBefore=2
      const children = [c(0, 0, 1, 2), c(1, 1, 1, 2)];
      const r = computeDropPlacement(children, 0, 1, "right");
      // 新控件在 (0,2)；X 覆盖 [0,1]，Y 覆盖 row 1 col [1,2]
      // (0,2) 不在 X 范围（X row=0, cols [0,1]），也不在 Y 范围（Y row=1）
      expect(r.placeRow).toBe(0);
      expect(r.placeCol).toBe(2);
      expect(isCellOccupied(children, r.placeRow, r.placeCol)).toBe(false);
    });

    it("复杂场景：多个 span 控件，bottom edge 不重叠", () => {
      const children = [c(0, 0, 2, 1), c(0, 1, 1, 2)];
      const r = computeDropPlacement(children, 1, 0, "bottom");
      expect(r.placeRow).toBe(2);
      expect(r.placeCol).toBe(0);
      expect(isCellOccupied(children, r.placeRow, r.placeCol)).toBe(false);
    });

    it("left: spanning 控件 → 插入点跳到 span 起始，保证 shift 后不重叠", () => {
      // X 在 (0,2) colSpan=2 → 覆盖 [2,3]
      // left edge at (0,3) → insertColBefore=min(3,2)=2, placeCol=2
      const r = computeDropPlacement([c(0, 2, 1, 2)], 0, 3, "left");
      expect(r.allowed).toBe(true);
      expect(r.insertColBefore).toBe(2);
      expect(r.placeCol).toBe(2);
      expect(r.placeRow).toBe(0);
    });

    it("top: spanning 控件 → 插入点跳到 span 起始，保证 shift 后不重叠", () => {
      // X 在 (2,0) rowSpan=2 → 覆盖 [2,3]
      // top edge at (3,0) → insertRowBefore=min(3,2)=2, placeRow=2
      const r = computeDropPlacement([c(2, 0, 2, 1)], 3, 0, "top");
      expect(r.allowed).toBe(true);
      expect(r.insertRowBefore).toBe(2);
      expect(r.placeRow).toBe(2);
      expect(r.placeCol).toBe(0);
    });
  });

  // ── 边界情况 ──

  describe("边界情况", () => {
    it("children 为空不报错", () => {
      const r = computeDropPlacement([], 5, 5, "inside");
      expect(r.allowed).toBe(true);
    });

    it("child 没有 grid 属性不报错", () => {
      const r = computeDropPlacement([{ id: "X" }] as any, 0, 0, "inside");
      expect(r.allowed).toBe(true);
    });

    it("inside 拒绝 reason 包含行列和控件描述", () => {
      const r = computeDropPlacement([c(3, 7)], 3, 7, "inside");
      expect(r.reason).toContain("(3,7)");
      expect(r.reason).toContain("占据");
    });
  });
});

describe("applyDropTransform", () => {
  it("拒绝 inside 覆盖已有控件，并且不修改输入 children", () => {
    const child = c(0, 0);
    const result = applyDropTransform({
      children: [child],
      targetRow: 0,
      targetCol: 0,
      edge: "inside",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("占据");
    expect(child.grid).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 1 });
  });

  it("right 放到 spanning 控件后方，并移动右侧列避免重叠", () => {
    const children = [c(0, 0, 1, 2), c(0, 2)];
    const result = applyDropTransform({
      children,
      targetRow: 0,
      targetCol: 1,
      edge: "right",
    });

    expect(result.success).toBe(true);
    expect(result.placedRow).toBe(0);
    expect(result.placedCol).toBe(2);
    expect(result.children[0].grid).toEqual({ row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    expect(result.children[1].grid).toEqual({ row: 0, col: 3, rowSpan: 1, colSpan: 1 });
    expect(
      findOverlaps([
        ...result.children,
        { grid: { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 } },
      ]),
    ).toEqual([]);
  });

  it("bottom 放到 spanning 控件下方，并移动下方行避免重叠", () => {
    const children = [c(0, 0, 2, 1), c(2, 0)];
    const result = applyDropTransform({
      children,
      targetRow: 1,
      targetCol: 0,
      edge: "bottom",
    });

    expect(result.success).toBe(true);
    expect(result.placedRow).toBe(2);
    expect(result.placedCol).toBe(0);
    expect(result.children[0].grid).toEqual({ row: 0, col: 0, rowSpan: 2, colSpan: 1 });
    expect(result.children[1].grid).toEqual({ row: 3, col: 0, rowSpan: 1, colSpan: 1 });
    expect(
      findOverlaps([
        ...result.children,
        { grid: { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 } },
      ]),
    ).toEqual([]);
  });
});
