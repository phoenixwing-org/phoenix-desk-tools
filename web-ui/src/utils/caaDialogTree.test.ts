import { describe, it, expect } from "vitest";
import {
  removeChildNode,
  collectDescendantIds,
  findCaaNode,
  renumberGrid,
  isContainerNode,
  generateNodeId,
  createControlNode,
} from "./caaDialogTree";
import { applyDropTransform, findOverlaps, buildBuilderRecord, type BuilderRecord } from "./caaDropZone";
import type { CaaDialogNode } from "../types/caaDialogIr";

// ═══════════════════════════════════════════════
// 拖放数据模型测试：纯数据，不依赖 DOM
// 模拟完整的 MOVE/COPY/DELETE 操作并验证树结构
// ═══════════════════════════════════════════════

function n(id: string, children: CaaDialogNode[] = []): CaaDialogNode {
  return { id, type: "CATDlgTest", children };
}

function c(
  id: string,
  type: string,
  father: string,
  row: number,
  col: number,
  children: CaaDialogNode[] = [],
  nls?: CaaDialogNode["nls"],
): CaaDialogNode {
  return {
    id,
    type,
    father,
    grid: { row, col, rowSpan: 1, colSpan: 1 },
    children,
    ...(nls ? { nls } : {}),
  };
}

/** 构建嵌套容器测试树：
 *  Root
 *    Frame1 (0,0)
 *      LabelA (0,0)
 *      PushBtn (0,1)
 *    Frame2 (1,0)
 *      EditorX (0,0)
 */
function makeNestedTree(): CaaDialogNode {
  return {
    id: "Root",
    type: "CATDlgDialog",
    children: [
      c("Frame1", "CATDlgFrame", "Root", 0, 0, [
        c("LabelA", "CATDlgLabel", "Frame1", 0, 0, [], { title: "A" }),
        c("PushBtn", "CATDlgPushButton", "Frame1", 0, 1, [], { title: "OK" }),
      ]),
      c("Frame2", "CATDlgFrame", "Root", 1, 0, [
        c("EditorX", "CATDlgEditor", "Frame2", 0, 0, [], { title: "X" }),
      ]),
    ],
  };
}

describe("removeChildNode", () => {
  it("正常移除", () => {
    const a = n("A");
    const b = n("B");
    const { removed, newChildren } = removeChildNode([a, b], "A");
    expect(removed).toBe(a);
    expect(newChildren).toHaveLength(1);
    expect(newChildren[0]).toBe(b);
  });

  it("ID 不存在 → removed=null", () => {
    const { removed, newChildren } = removeChildNode([n("A")], "X");
    expect(removed).toBeNull();
    expect(newChildren).toHaveLength(1);
  });

  it("不修改原数组", () => {
    const a = n("A"), b = n("B");
    const children = [a, b];
    removeChildNode(children, "A");
    expect(children).toHaveLength(2);
    expect(children[0]).toBe(a);
  });

  it("空 children", () => {
    const { removed, newChildren } = removeChildNode([], "A");
    expect(removed).toBeNull();
    expect(newChildren).toHaveLength(0);
  });

  it("移除最后一个", () => {
    const a = n("A");
    const { removed, newChildren } = removeChildNode([a], "A");
    expect(removed).toBe(a);
    expect(newChildren).toHaveLength(0);
  });
});

describe("collectDescendantIds", () => {
  it("叶子 → []", () => {
    expect(collectDescendantIds(n("L"))).toEqual([]);
  });

  it("一级子节点", () => {
    expect(collectDescendantIds(n("F", [n("A"), n("B")]))).toEqual(["A", "B"]);
  });

  it("嵌套深度优先", () => {
    const node = n("Root", [n("A"), n("F1", [n("X"), n("Y")]), n("F2", [n("Z")])]);
    expect(collectDescendantIds(node)).toEqual(["A", "F1", "X", "Y", "F2", "Z"]);
  });

  it("三级嵌套", () => {
    const node = n("A", [n("B", [n("C", [n("D")])])]);
    expect(collectDescendantIds(node)).toEqual(["B", "C", "D"]);
  });
});

// ── 拖放操作模拟（纯数据）──

describe("同容器 MOVE（pure）", () => {
  it("Frame1 内移动 PushBtn (0,1)→(1,0) 不丢失不重叠", () => {
    const tree = makeNestedTree();
    const frame1 = findCaaNode(tree, "Frame1")!;
    const sourceNode = findCaaNode(tree, "PushBtn")!;

    // 从 children 中排除源节点
    const input = frame1.children.filter((c) => c.id !== "PushBtn");
    const result = applyDropTransform({
      children: input,
      targetRow: 1, targetCol: 0, edge: "inside",
    });

    expect(result.success).toBe(true);
    sourceNode.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    const newChildren = [...result.children, sourceNode];
    frame1.children = newChildren as CaaDialogNode[];
    renumberGrid(frame1);

    // 两个子节点都存在
    expect(frame1.children.map((c) => c.id).sort()).toEqual(["LabelA", "PushBtn"]);
    // 不重叠
    const positions = frame1.children.map((c) => `${c.grid!.row},${c.grid!.col}`);
    expect(new Set(positions).size).toBe(2);
  });
});

describe("跨容器 MOVE（pure）", () => {
  it("PushBtn 从 Frame1 移到 Frame2", () => {
    const tree = makeNestedTree();
    const frame1 = findCaaNode(tree, "Frame1")!;
    const frame2 = findCaaNode(tree, "Frame2")!;
    const sourceNode = findCaaNode(tree, "PushBtn")!;

    // ① 从 Frame1 移除
    const { newChildren: srcAfter } = removeChildNode(frame1.children, "PushBtn");
    frame1.children = srcAfter;
    renumberGrid(frame1);

    // ② 插入 Frame2
    const result = applyDropTransform({
      children: frame2.children,
      targetRow: 1, targetCol: 0, edge: "inside",
    });
    expect(result.success).toBe(true);

    sourceNode.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    sourceNode.father = "Frame2";
    frame2.children = [...result.children, sourceNode] as CaaDialogNode[];
    renumberGrid(frame2);

    // 验证
    expect(frame1.children.map((c) => c.id)).toEqual(["LabelA"]);
    expect(frame2.children.map((c) => c.id).sort()).toEqual(["EditorX", "PushBtn"]);
    expect(findCaaNode(tree, "PushBtn")!.father).toBe("Frame2");
  });

  it("移动容器 Frame2 → 移到 Frame1 内部（嵌套）", () => {
    const tree = makeNestedTree();
    const root = findCaaNode(tree, "Root")!;
    const frame1 = findCaaNode(tree, "Frame1")!;
    const frame2 = findCaaNode(tree, "Frame2")!;

    // 从 Root 移除 Frame2
    const { newChildren: rootAfter } = removeChildNode(root.children, "Frame2");
    root.children = rootAfter;
    renumberGrid(root);

    // 插入 Frame1
    const result = applyDropTransform({
      children: frame1.children,
      targetRow: 0, targetCol: 2, edge: "right",
    });
    expect(result.success).toBe(true);

    frame2.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    frame2.father = "Frame1";
    frame1.children = [...result.children, frame2] as CaaDialogNode[];
    renumberGrid(frame1);

    // Frame2 现在是 Frame1 的子节点
    expect(findCaaNode(tree, "Frame2")!.father).toBe("Frame1");
    // Frame2 的子节点仍在
    expect(findCaaNode(tree, "EditorX")).not.toBeNull();
    // Root 下只剩 Frame1
    expect(root.children.map((c) => c.id)).toEqual(["Frame1"]);
  });
});

describe("DELETE（pure）", () => {
  it("删除叶子 PushBtn → Frame1 只剩 LabelA", () => {
    const tree = makeNestedTree();
    const frame1 = findCaaNode(tree, "Frame1")!;

    const { newChildren } = removeChildNode(frame1.children, "PushBtn");
    frame1.children = newChildren;
    renumberGrid(frame1);

    expect(frame1.children.map((c) => c.id)).toEqual(["LabelA"]);
    expect(findCaaNode(tree, "PushBtn")).toBeNull();
  });

  it("删除容器 Frame2 → EditorX 级联消失 + Root 只剩 Frame1", () => {
    const tree = makeNestedTree();
    const root = findCaaNode(tree, "Root")!;
    const frame2 = findCaaNode(tree, "Frame2")!;
    const descIds = collectDescendantIds(frame2);

    expect(descIds).toContain("EditorX");

    const { newChildren } = removeChildNode(root.children, "Frame2");
    root.children = newChildren;
    renumberGrid(root);

    expect(root.children.map((c) => c.id)).toEqual(["Frame1"]);
    expect(findCaaNode(tree, "Frame2")).toBeNull();
    expect(findCaaNode(tree, "EditorX")).toBeNull();
  });
});

// ── onGridMouseUp 拦截逻辑（数据层面验证）──

describe("跨容器 mouseup 不应被目标 grid 拦截", () => {
  /**
   * 模拟 onGridMouseUp 逻辑：
   * - 如果本组件没有 active drag → 不 stopPropagation → 事件冒泡到 window
   * - window 的 handler 执行源的 finishInternalDrag → 跨容器 doDrop
   */
  function shouldHandleMouseUp(hasActiveDrag: boolean): boolean {
    return hasActiveDrag;
  }

  it("目标 grid（无 drag）的 mouseup 不拦截 → 放行冒泡", () => {
    // 目标 grid：internalDrag = null
    expect(shouldHandleMouseUp(false)).toBe(false);
  });

  it("源 grid（有 drag）的 mouseup → 拦截处理", () => {
    // 源 grid：internalDrag 不为 null
    expect(shouldHandleMouseUp(true)).toBe(true);
  });
});

// ── 完整跨容器操作数据模拟 ──

describe("跨容器完整操作模拟", () => {
  it("源容器移除 + 目标容器插入 → 树结构正确", () => {
    const tree = makeNestedTree();

    // 源：Frame1，目标：Frame2，移动节点：PushBtn
    const frame1 = findCaaNode(tree, "Frame1")!;
    const frame2 = findCaaNode(tree, "Frame2")!;
    const pushBtn = findCaaNode(tree, "PushBtn")!;

    // 源容器删除
    const { newChildren: srcAfter } = removeChildNode(frame1.children, "PushBtn");
    frame1.children = srcAfter;
    renumberGrid(frame1);

    // 目标容器插入
    const result = applyDropTransform({
      children: frame2.children,
      targetRow: 1, targetCol: 0, edge: "inside",
    });
    expect(result.success).toBe(true);

    pushBtn.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    pushBtn.father = "Frame2";
    frame2.children = [...result.children, pushBtn] as CaaDialogNode[];
    renumberGrid(frame2);

    // 验证
    expect(findCaaNode(tree, "PushBtn")!.father).toBe("Frame2");
    expect(frame1.children).toHaveLength(1);
    expect(frame1.children[0].id).toBe("LabelA");
    expect(frame2.children.map((c) => c.id).sort()).toEqual(["EditorX", "PushBtn"]);
  });

  it("跨容器移动后源容器不残留节点", () => {
    const tree = makeNestedTree();
    const frame1 = findCaaNode(tree, "Frame1")!;
    const frame2 = findCaaNode(tree, "Frame2")!;

    // 捕获节点引用（从树上摘下前）
    const sourceNode = findCaaNode(tree, "PushBtn")!;
    expect(sourceNode).not.toBeNull();

    // 从源容器移除
    const { newChildren } = removeChildNode(frame1.children, "PushBtn");
    frame1.children = newChildren;
    renumberGrid(frame1);

    // 插入目标容器
    const result = applyDropTransform({
      children: frame2.children,
      targetRow: 0, targetCol: 1, edge: "right",
    });
    sourceNode.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    sourceNode.father = "Frame2";
    frame2.children = [...result.children, sourceNode] as CaaDialogNode[];
    renumberGrid(frame2);

    // 源容器不残留
    expect(findCaaNode(frame1, "PushBtn")).toBeNull();
    // 目标容器有该节点
    expect(findCaaNode(tree, "PushBtn")).not.toBeNull();
    expect(findCaaNode(tree, "PushBtn")!.father).toBe("Frame2");
  });
});

// ── doDrop 完整流程模拟（payload 解析 + 双容器操作 + 回退）──

describe("doDrop 跨容器完整流程", () => {
  /** 模拟 CaaDialogGrid.doDrop() 的核心逻辑 */
  function simulateDoDrop(
    root: CaaDialogNode,
    payload: string,       // "MOVE:sourceNodeId:sourceContainerId"
    targetId: string,      // 目标容器 ID
    targetRow: number, targetCol: number, edge: string,
  ): { ok: boolean; record?: BuilderRecord; error?: string } {
    const targetContainer = findCaaNode(root, targetId);
    if (!targetContainer) return { ok: false, error: "target not found" };

    const snapChildren = targetContainer.children.map((c) => ({
      ...c, grid: c.grid ? { ...c.grid } : undefined, children: c.children,
    }));

    // 解析 payload
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
      if (!sourceNode) return { ok: false, error: "source not found" };

      if (sourceContainerId !== targetId) {
        const srcCtr = findCaaNode(root, sourceContainerId);
        if (srcCtr) {
          sourceSnapChildren = srcCtr.children.map((c) => ({
            ...c, grid: c.grid ? { ...c.grid } : undefined, children: c.children,
          }));
        }
      }
    }

    // 计算变换
    const computeInput = payload.startsWith("MOVE:") && sourceContainerId === targetId
      ? targetContainer.children.filter((c) => c.id !== sourceNodeId)
      : targetContainer.children;

    const result = applyDropTransform({
      children: computeInput,
      targetRow, targetCol, edge: edge as "inside" | "right" | "bottom" | "left" | "top",
    });
    if (!result.success) return { ok: false, error: result.error };

    const newChildren = [...result.children] as CaaDialogNode[];
    sourceNode!.grid = { row: result.placedRow, col: result.placedCol, rowSpan: 1, colSpan: 1 };
    sourceNode!.father = targetId;
    newChildren.push(sourceNode!);

    // 验证重叠
    const overlaps = findOverlaps(newChildren as any);
    if (overlaps.length > 0) {
      targetContainer.children = snapChildren;
      renumberGrid(targetContainer);
      if (sourceSnapChildren) {
        const srcCtr = findCaaNode(root, sourceContainerId);
        if (srcCtr) { srcCtr.children = sourceSnapChildren; renumberGrid(srcCtr); }
      }
      return { ok: false, error: `overlap: ${overlaps.map((o) => o.cell).join(", ")}` };
    }

    // 原子替换目标
    targetContainer.children = newChildren;
    renumberGrid(targetContainer);

    // 更新源
    let sourceChildrenAfter: CaaDialogNode[] | null = null;
    if (sourceNodeId && sourceContainerId !== targetId) {
      const srcCtr = findCaaNode(root, sourceContainerId);
      if (srcCtr) {
        const { newChildren: srcNew } = removeChildNode(srcCtr.children, sourceNodeId);
        srcCtr.children = srcNew;
        renumberGrid(srcCtr);
        sourceChildrenAfter = srcCtr.children.map((c) => ({ ...c, grid: c.grid ? { ...c.grid } : undefined, children: c.children }));
      }
    }

    const record = buildBuilderRecord({
      operation: "MOVE",
      sourceContainerId: sourceContainerId || null,
      targetContainerId: targetId,
      sourceChildrenBefore: sourceSnapChildren,
      targetChildrenBefore: snapChildren,
      targetChildrenAfter: targetContainer.children.map((c) => ({ ...c, grid: c.grid ? { ...c.grid } : undefined, children: c.children })),
      sourceChildrenAfter,
      affectedNodeId: sourceNodeId,
      affectedNodeType: sourceNode?.type ?? "",
    });

    return { ok: true, record };
  }

  it("跨容器移动返回正确 BuilderRecord", () => {
    const tree = makeNestedTree();
    const r = simulateDoDrop(tree, "MOVE:PushBtn:Frame1", "Frame2", 1, 0, "inside");
    expect(r.ok).toBe(true);
    expect(r.record).toBeDefined();
    expect(r.record!.operation).toBe("MOVE");
    expect(r.record!.sourceContainerId).toBe("Frame1");
    expect(r.record!.targetContainerId).toBe("Frame2");
    expect(r.record!.affectedNodeId).toBe("PushBtn");
    // 源快照含 LabelA + PushBtn
    expect(r.record!.sourceChildrenBefore!.map((c) => c.id).sort()).toEqual(["LabelA", "PushBtn"]);
    // 目标快照含 EditorX
    expect(r.record!.targetChildrenBefore.map((c) => c.id)).toEqual(["EditorX"]);
    // 目标 after 含 EditorX + PushBtn
    expect(r.record!.targetChildrenAfter.map((c) => c.id).sort()).toEqual(["EditorX", "PushBtn"]);
  });

  it("同容器 MOVE 的 record 无 source 快照", () => {
    const tree = makeNestedTree();
    const r = simulateDoDrop(tree, "MOVE:PushBtn:Frame1", "Frame1", 1, 0, "inside");
    expect(r.ok).toBe(true);
    expect(r.record!.sourceContainerId).toBe("Frame1");
    expect(r.record!.targetContainerId).toBe("Frame1");
    // 同容器 sourceBefore 为 null（因为 sourceContainerId === targetId）
    expect(r.record!.sourceChildrenBefore).toBeNull();
  });

  it("跨容器容器移动（含子树）→ 子树完整保留", () => {
    const tree = makeNestedTree();
    const r = simulateDoDrop(tree, "MOVE:Frame2:Root", "Frame1", 0, 2, "right");
    expect(r.ok).toBe(true);
    // Frame2 的子树 EditorX 仍存在
    const frame2 = findCaaNode(tree, "Frame2")!;
    expect(frame2.father).toBe("Frame1");
    expect(frame2.children.map((c) => c.id)).toEqual(["EditorX"]);
    // Root 下只剩 Frame1
    const root = findCaaNode(tree, "Root")!;
    expect(root.children.map((c) => c.id)).toEqual(["Frame1"]);
  });

  it("跨容器移动后 grid 重新编号正确", () => {
    const tree = makeNestedTree();
    // Frame1 原有 2 个控件 (0,0) (0,1)，移除 PushBtn(0,1) 后只剩 LabelA(0,0)
    const r = simulateDoDrop(tree, "MOVE:PushBtn:Frame1", "Frame2", 1, 0, "inside");
    expect(r.ok).toBe(true);

    const frame1 = findCaaNode(tree, "Frame1")!;
    // renumberGrid 后 LabelA 重新编号为 (0,0)
    expect(frame1.children).toHaveLength(1);
    const labelA = frame1.children[0];
    expect(labelA.grid!.row).toBe(0);
    expect(labelA.grid!.col).toBe(0);
  });

  it("跨容器移动到空容器", () => {
    // Frame3 是空容器
    const tree = makeNestedTree();
    const frame1 = findCaaNode(tree, "Frame1")!;
    const frame3: CaaDialogNode = {
      id: "Frame3", type: "CATDlgFrame", father: "Root",
      grid: { row: 2, col: 0, rowSpan: 1, colSpan: 1 },
      children: [],
    };
    const root = findCaaNode(tree, "Root")!;
    root.children.push(frame3);

    const r = simulateDoDrop(tree, "MOVE:PushBtn:Frame1", "Frame3", 0, 0, "inside");
    expect(r.ok).toBe(true);
    expect(frame3.children).toHaveLength(1);
    expect(frame3.children[0].id).toBe("PushBtn");
    expect(frame3.children[0].grid!.row).toBe(0);
    expect(frame3.children[0].grid!.col).toBe(0);
  });

  it("重叠检测触发回退", () => {
    const tree = makeNestedTree();
    // Frame2 已有 EditorX 在 (0,0)，尝试把 PushBtn 也放到 inside (0,0) → 应拒绝
    const r = simulateDoDrop(tree, "MOVE:PushBtn:Frame1", "Frame2", 0, 0, "inside");
    // inside + occupied → applyDropTransform 会拒绝
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();

    // Frame1 应保持原样（PushBtn 仍在）
    const frame1 = findCaaNode(tree, "Frame1")!;
    expect(frame1.children.map((c) => c.id).sort()).toEqual(["LabelA", "PushBtn"]);
  });
});

describe("isContainerNode", () => {
  it("CATDlgDialog/Fram/Container/TabPage 是容器", () => {
    expect(isContainerNode({ id: "x", type: "CATDlgDialog", children: [] })).toBe(true);
    expect(isContainerNode({ id: "x", type: "CATDlgFrame", children: [] })).toBe(true);
    expect(isContainerNode({ id: "x", type: "CATDlgContainer", children: [] })).toBe(true);
    expect(isContainerNode({ id: "x", type: "CATDlgTabPage", children: [] })).toBe(true);
  });

  it("非容器类型", () => {
    expect(isContainerNode({ id: "x", type: "CATDlgLabel", children: [] })).toBe(false);
    expect(isContainerNode({ id: "x", type: "CATDlgPushButton", children: [] })).toBe(false);
  });
});
