import { describe, expect, it } from "vitest";
import { gridRectsOverlap, resolveSpanResize, spanFromDragDelta } from "./caaSpanResize";

const child = (id: string, row: number, col: number, rowSpan = 1, colSpan = 1) => ({
  id,
  grid: { row, col, rowSpan, colSpan },
});

describe("spanFromDragDelta", () => {
  it("grows by rounded cell deltas", () => {
    expect(
      spanFromDragDelta({
        startGrid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        deltaX: 33,
        deltaY: 50,
        cellWidth: 32,
        cellHeight: 24,
      }),
    ).toEqual({ rowSpan: 3, colSpan: 2 });
  });

  it("never shrinks below 1x1", () => {
    expect(
      spanFromDragDelta({
        startGrid: { row: 0, col: 0, rowSpan: 2, colSpan: 3 },
        deltaX: -999,
        deltaY: -999,
        cellWidth: 32,
        cellHeight: 24,
      }),
    ).toEqual({ rowSpan: 1, colSpan: 1 });
  });
});

describe("resolveSpanResize", () => {
  it("allows expanding into empty grid area", () => {
    const result = resolveSpanResize({
      children: [child("A", 0, 0)],
      nodeId: "A",
      startGrid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      deltaX: 70,
      deltaY: 30,
      cellWidth: 32,
      cellHeight: 24,
    });
    expect(result).toEqual({ success: true, rowSpan: 2, colSpan: 3 });
  });

  it("rejects spans that overlap siblings", () => {
    const result = resolveSpanResize({
      children: [child("A", 0, 0), child("B", 0, 2)],
      nodeId: "A",
      startGrid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      deltaX: 70,
      deltaY: 0,
      cellWidth: 32,
      cellHeight: 24,
    });
    expect(result.success).toBe(false);
  });
});

describe("gridRectsOverlap", () => {
  it("treats touching edges as non-overlap", () => {
    expect(
      gridRectsOverlap(
        { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
        { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
      ),
    ).toBe(false);
  });
});
