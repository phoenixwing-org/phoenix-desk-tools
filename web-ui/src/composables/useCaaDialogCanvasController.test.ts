import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { CaaDialogIr, CaaDialogNode } from "../types/caaDialogIr";
import { useCaaDialogCanvasController } from "./useCaaDialogCanvasController";

function child(
  id: string,
  father: string,
  row: number,
  col: number,
): CaaDialogNode {
  return {
    id,
    type: "CATDlgLabel",
    father,
    grid: { row, col, rowSpan: 1, colSpan: 1 },
    children: [],
  };
}

function makeIr(): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName: "Root",
    root: {
      id: "Root",
      type: "CATDlgDialog",
      children: [
        {
          id: "Frame",
          type: "CATDlgFrame",
          father: "Root",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          gridLayout: { rowResizable: [2], colResizable: [3] },
          children: [child("ChildA", "Frame", 0, 0), child("ChildB", "Frame", 0, 1)],
        },
      ],
    },
    sources: { catDlg: "Root.CATDlg", catNls: "Root.CATNls" },
  };
}

function setup(ir: CaaDialogIr | null = makeIr(), selected = "ChildA") {
  const state = {
    ir: ref<CaaDialogIr | null>(ir),
    selectedId: ref<string | null>(selected),
    canEditNls: computed(() => true),
    activeLocale: ref("default"),
    editMode: ref(false),
  };
  const ports = {
    recordHistory: vi.fn(),
    markDirty: vi.fn(),
    syncSidebar: vi.fn(),
    mirrorSelection: vi.fn(),
    syncNls: vi.fn(),
    commitNls: vi.fn(),
  };
  return {
    state,
    ports,
    ...useCaaDialogCanvasController({ state, ports }),
  };
}

function frameOf(ir: CaaDialogIr): CaaDialogNode {
  return ir.root.children[0]!;
}

describe("useCaaDialogCanvasController", () => {
  it("拥有 Canvas 临时状态，并通过 selection port 镜像选择", () => {
    const { state, ports, controlContext } = setup();
    expect(controlContext.dialogRoot?.id).toBe("Root");
    expect(controlContext.selectedId).toBe(state.selectedId);
    expect(controlContext.activeLocale).toBe(state.activeLocale);
    expect(controlContext.editMode).toBe(state.editMode);

    controlContext.select("ChildB");
    expect(state.selectedId.value).toBe("ChildB");
    expect(ports.mirrorSelection).toHaveBeenCalledOnce();
    expect(ports.mirrorSelection).toHaveBeenCalledWith("ChildB");

    const items = [{ label: "设置", action: vi.fn() }];
    controlContext.showContextMenu("Frame", items, { x: 12, y: 34 });
    expect(controlContext.contextMenuVisible.value).toBe(true);
    expect(controlContext.contextMenuItems.value).toEqual(items);
    expect(controlContext.contextMenuPosition.value).toEqual({ x: 12, y: 34 });
    expect(controlContext.contextMenuTargetId.value).toBe("Frame");
    controlContext.hideContextMenu();
    expect(controlContext.contextMenuVisible.value).toBe(false);
    expect(controlContext.contextMenuTargetId.value).toBeNull();
  });

  it("row/col toggle 各记录一次 history、排序并标记 patch", () => {
    const { state, ports, controlContext } = setup();
    const frame = frameOf(state.ir.value!);

    controlContext.toggleGridRowResize("Frame", 1);
    controlContext.toggleGridColResize("Frame", 2);

    expect(frame.gridLayout?.rowResizable).toEqual([1, 2]);
    expect(frame.gridLayout?.colResizable).toEqual([2, 3]);
    expect(ports.recordHistory).toHaveBeenCalledTimes(2);
    expect(ports.markDirty).toHaveBeenNthCalledWith(1, "patch");
    expect(ports.markDirty).toHaveBeenNthCalledWith(2, "patch");
    expect(ports.syncSidebar).toHaveBeenCalledTimes(2);

    controlContext.toggleGridRowResize("Frame", 2);
    controlContext.toggleGridColResize("Frame", 3);
    expect(frame.gridLayout?.rowResizable).toEqual([1]);
    expect(frame.gridLayout?.colResizable).toEqual([2]);
  });

  it("resize setter 对同值 no-op，并允许批处理跳过 history", () => {
    const { state, ports, controlContext } = setup();
    const frame = frameOf(state.ir.value!);

    controlContext.setGridRowResize("Frame", 2, true);
    controlContext.setGridColResize("Frame", 3, true);
    expect(ports.recordHistory).not.toHaveBeenCalled();
    expect(ports.markDirty).not.toHaveBeenCalled();
    expect(ports.syncSidebar).not.toHaveBeenCalled();

    controlContext.setGridRowResize("Frame", 1, true);
    controlContext.setGridColResize("Frame", 2, true, { recordHistory: false });
    expect(frame.gridLayout?.rowResizable).toEqual([1, 2]);
    expect(frame.gridLayout?.colResizable).toEqual([2, 3]);
    expect(ports.recordHistory).toHaveBeenCalledOnce();
    expect(ports.markDirty).toHaveBeenCalledTimes(2);
    expect(ports.markDirty).toHaveBeenNthCalledWith(1, "patch");
    expect(ports.markDirty).toHaveBeenNthCalledWith(2, "patch");
  });

  it("direct delete 记录 history、回选父容器，但保持不清理 NLS 的现有差异", () => {
    const { state, ports, controlContext, deleteSelectedControl } = setup();
    const frame = frameOf(state.ir.value!);

    expect(deleteSelectedControl()).toBe(true);
    expect(frame.children.map((node) => node.id)).toEqual(["ChildB"]);
    expect(state.selectedId.value).toBe("Frame");
    expect(ports.recordHistory).toHaveBeenCalledOnce();
    expect(ports.mirrorSelection).toHaveBeenCalledWith("Frame");
    expect(ports.markDirty).toHaveBeenCalledWith("full");
    expect(ports.syncSidebar).toHaveBeenCalledOnce();
    expect(ports.syncNls).not.toHaveBeenCalled();
    expect(controlContext.lastBuilderRecord.value).toBeNull();
  });

  it("direct delete 对空选择、根节点、无父节点和不存在节点均 no-op", () => {
    const { state, ports, deleteSelectedControl } = setup();
    for (const selected of [null, "Root", "Missing"] as const) {
      state.selectedId.value = selected;
      expect(deleteSelectedControl()).toBe(false);
    }
    state.ir.value!.root.children.push({
      id: "Orphan",
      type: "CATDlgLabel",
      children: [],
    });
    state.selectedId.value = "Orphan";
    expect(deleteSelectedControl()).toBe(false);
    expect(ports.recordHistory).not.toHaveBeenCalled();
    expect(ports.markDirty).not.toHaveBeenCalled();
    expect(ports.syncSidebar).not.toHaveBeenCalled();
    expect(ports.syncNls).not.toHaveBeenCalled();
  });

  it("Builder add 记录 history、标记 full 并清理 NLS", () => {
    const { state, ports, controlContext } = setup();
    const frame = frameOf(state.ir.value!);

    expect(controlContext.addControl("Frame", "CATDlgPushButton", 1, 0))
      .toBe("CATDlgPushButton");
    expect(frame.children).toHaveLength(3);
    expect(frame.children.some((node) => node.type === "CATDlgPushButton")).toBe(true);
    expect(ports.recordHistory).toHaveBeenCalledOnce();
    expect(ports.markDirty).toHaveBeenCalledWith("full");
    expect(ports.syncSidebar).toHaveBeenCalledOnce();
    expect(ports.syncNls).toHaveBeenCalledOnce();
  });

  it("Builder remove 保留无额外 history、BuilderRecord 与 NLS 清理语义", () => {
    const { state, ports, controlContext } = setup();
    const frame = frameOf(state.ir.value!);

    controlContext.removeControl("Frame", "ChildA");
    expect(frame.children.map((node) => node.id)).toEqual(["ChildB"]);
    expect(ports.recordHistory).not.toHaveBeenCalled();
    expect(ports.markDirty).toHaveBeenCalledWith();
    expect(ports.syncSidebar).toHaveBeenCalledOnce();
    expect(ports.syncNls).toHaveBeenCalledOnce();
    expect(controlContext.lastBuilderRecord.value?.operation).toBe("DELETE");
    expect(controlContext.lastBuilderRecord.value?.affectedNodeId).toBe("ChildA");
  });

  it("insert row/col 与 setChildren 保持 full dirty，setChildren 不额外镜像 selection", () => {
    const { state, ports, controlContext } = setup();
    const frame = frameOf(state.ir.value!);

    controlContext.insertRow("Frame", 0);
    controlContext.insertCol("Frame", 0);
    expect(ports.recordHistory).toHaveBeenCalledTimes(2);
    expect(ports.markDirty).toHaveBeenNthCalledWith(1, "full");
    expect(ports.markDirty).toHaveBeenNthCalledWith(2, "full");

    const replacement = [child("Replacement", "Frame", 0, 0)];
    controlContext.setChildren("Frame", replacement, "Replacement");
    expect(frame.children).toEqual(replacement);
    expect(state.selectedId.value).toBe("Replacement");
    expect(ports.mirrorSelection).not.toHaveBeenCalled();
    expect(ports.markDirty).toHaveBeenNthCalledWith(3, "full");
    expect(ports.syncSidebar).toHaveBeenCalledTimes(3);
  });

  it("无 IR 或无目标容器时所有 IR 命令 no-op，Host ports 不被调用", () => {
    const { ports, controlContext, deleteSelectedControl } = setup(null);
    expect(deleteSelectedControl()).toBe(false);
    expect(controlContext.addControl("Frame", "CATDlgLabel", 0, 0)).toBe("");
    controlContext.removeControl("Frame", "ChildA");
    controlContext.insertRow("Frame", 0);
    controlContext.insertCol("Frame", 0);
    controlContext.toggleGridRowResize("Frame", 0);
    controlContext.toggleGridColResize("Frame", 0);
    controlContext.setGridRowResize("Frame", 0, true);
    controlContext.setGridColResize("Frame", 0, true);
    controlContext.setChildren("Frame", []);
    expect(ports.recordHistory).not.toHaveBeenCalled();
    expect(ports.markDirty).not.toHaveBeenCalled();
    expect(ports.syncSidebar).not.toHaveBeenCalled();
    expect(ports.mirrorSelection).not.toHaveBeenCalled();
    expect(ports.syncNls).not.toHaveBeenCalled();
  });

  it("NLS 提交与 Grid 手势 history 直接复用注入 ports", () => {
    const { ports, controlContext } = setup();
    const target = { nodeId: "ChildA", prop: "title" as const };
    controlContext.commitNls("ChildA.Title", "标题", target);
    controlContext.recordHistory();
    expect(ports.commitNls).toHaveBeenCalledWith("ChildA.Title", "标题", target);
    expect(ports.recordHistory).toHaveBeenCalledOnce();
  });
});
