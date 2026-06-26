import { describe, expect, it } from "vitest";
import { useCaaContainerResize, type ContainerResizeResult } from "./useCaaContainerResize";
import type { CaaDialogNode } from "../../../types/caaDialogIr";

function makeNode(overrides: Partial<CaaDialogNode> = {}): CaaDialogNode {
  return { id: "test", type: "CATDlgFrame", children: [], ...overrides };
}

function makeChild(id: string, col: number, overrides: Partial<CaaDialogNode> = {}): CaaDialogNode {
  return {
    id,
    type: "CATDlgEditor",
    grid: { row: 0, col, rowSpan: 1, colSpan: 1 },
    children: [],
    ...overrides,
  };
}

describe("useCaaContainerResize", () => {
  it("returns width:100% for controls in stretch columns", () => {
    const node = makeNode({
      gridLayout: { colResizable: [0], rowResizable: [] },
      children: [makeChild("e1", 0)],
    });
    const result: ContainerResizeResult = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toEqual({
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
    });
  });

  it("does not force width:100% for fixed columns", () => {
    const node = makeNode({
      gridLayout: { colResizable: [], rowResizable: [] },
      children: [makeChild("e1", 0)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toBeUndefined();
  });

  it("handles mixed stretch and fixed columns", () => {
    const node = makeNode({
      gridLayout: { colResizable: [1], rowResizable: [] },
      children: [makeChild("e1", 0), makeChild("e2", 1)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toBeUndefined();
    expect(result.getChildWidth(node.children[1])).toEqual({
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
    });
  });

  it("returns ch width for TW controls in fixed columns", () => {
    const node = makeNode({
      gridLayout: { colResizable: [], rowResizable: [] },
      children: [makeChild("e1", 0, { size: { textWidth: 20 } })],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toEqual({
      width: "20ch",
      maxWidth: "100%",
      boxSizing: "border-box",
    });
  });

  it("does not crash for empty containers", () => {
    const node = makeNode({ children: [] });
    const result = useCaaContainerResize(() => node).value;
    expect(result.columnTemplate).toBe("auto");
    expect(result.rowTemplate).toBe("auto");
    expect(result.gridWidth).toBe("100%");
  });

  it("maps all stretch columns to 1fr", () => {
    const node = makeNode({
      gridLayout: { colResizable: [0, 1, 2], rowResizable: [] },
      children: [makeChild("e1", 0), makeChild("e2", 1), makeChild("e3", 2)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.columnTemplate).toBe("1fr 1fr 1fr");
  });

  it("maps mixed columns to auto/1fr", () => {
    const node = makeNode({
      gridLayout: { colResizable: [1], rowResizable: [] },
      children: [makeChild("e1", 0), makeChild("e2", 1), makeChild("e3", 2)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.columnTemplate).toBe("auto 1fr auto");
  });

  it("maps ROWRES rows to 1fr/auto", () => {
    const node = makeNode({
      gridLayout: { colResizable: [], rowResizable: [1] },
      children: [
        makeChild("e1", 0, { grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 } }),
        makeChild("e2", 0, { grid: { row: 1, col: 0, rowSpan: 1, colSpan: 1 } }),
        makeChild("e3", 0, { grid: { row: 2, col: 0, rowSpan: 1, colSpan: 1 } }),
      ],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.rowTemplate).toBe("auto 1fr auto");
  });

  it("returns height:100% for controls that touch stretch rows", () => {
    const node = makeNode({
      gridLayout: { colResizable: [], rowResizable: [1] },
      children: [makeChild("e1", 0, { grid: { row: 0, col: 0, rowSpan: 2, colSpan: 1 } })],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toEqual({
      height: "100%",
      boxSizing: "border-box",
    });
  });
});
