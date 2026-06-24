/**
 * useCaaContainerResize 单元测试
 * 验证：COLRES → width:100%，非 COLRES → 内容宽（无 width:100%）
 */
import { describe, it, expect } from "vitest";
import { useCaaContainerResize, type ContainerResizeResult } from "./useCaaContainerResize";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import { computed } from "vue";

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
  it("伸缩列控件应返回 width:100%", () => {
    const node = makeNode({
      gridLayout: { colResizable: [0], rowResizable: [] },
      children: [makeChild("e1", 0)],
    });
    const result: ContainerResizeResult = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toEqual({
      width: "100%", maxWidth: "100%", boxSizing: "border-box",
    });
  });

  it("非伸缩列控件不返回 width:100%", () => {
    const node = makeNode({
      gridLayout: { colResizable: [], rowResizable: [] },
      children: [makeChild("e1", 0)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toBeUndefined();
  });

  it("混合伸缩+固定列", () => {
    const node = makeNode({
      gridLayout: { colResizable: [1], rowResizable: [] },
      children: [makeChild("e1", 0), makeChild("e2", 1)],
    });
    const result = useCaaContainerResize(() => node).value;
    // col 0 (fixed): no width
    expect(result.getChildWidth(node.children[0])).toBeUndefined();
    // col 1 (COLRES): width:100%
    expect(result.getChildWidth(node.children[1])).toEqual({
      width: "100%", maxWidth: "100%", boxSizing: "border-box",
    });
  });

  it("有 TW 的固定列控件返回 ch 宽度", () => {
    const node = makeNode({
      gridLayout: { colResizable: [], rowResizable: [] },
      children: [makeChild("e1", 0, { size: { textWidth: 20 } })],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.getChildWidth(node.children[0])).toEqual({
      width: "20ch", maxWidth: "100%", boxSizing: "border-box",
    });
  });

  it("无子控件的容器不崩溃", () => {
    const node = makeNode({ children: [] });
    const result = useCaaContainerResize(() => node).value;
    expect(result.columnTemplate).toBe("auto");
    expect(result.gridWidth).toBe("100%");
  });

  it("三列全伸缩 → 1fr 1fr 1fr", () => {
    const node = makeNode({
      gridLayout: { colResizable: [0, 1, 2], rowResizable: [] },
      children: [makeChild("e1", 0), makeChild("e2", 1), makeChild("e3", 2)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.columnTemplate).toBe("1fr 1fr 1fr");
  });

  it("列模板混合", () => {
    const node = makeNode({
      gridLayout: { colResizable: [1], rowResizable: [] },
      children: [makeChild("e1", 0), makeChild("e2", 1), makeChild("e3", 2)],
    });
    const result = useCaaContainerResize(() => node).value;
    expect(result.columnTemplate).toBe("auto 1fr auto");
  });
});
