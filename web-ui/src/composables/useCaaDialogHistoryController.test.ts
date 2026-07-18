import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { CAA_IR_HISTORY_LIMIT, type CaaIrHistoryEntry } from "../models/caaDialogSessionViewModel";
import type { CaaDialogIr } from "../types/caaDialogIr";
import { useCaaDialogHistoryController } from "./useCaaDialogHistoryController";

function createIr(id: string): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName: id,
    root: { id, type: "CATDlg", children: [] },
    sources: { catDlg: `${id}.CATDlg`, catNls: `${id}.CATNls` },
  };
}

function createHarness() {
  const state = {
    ir: ref<CaaDialogIr | null>(createIr("Current")),
    selectedId: ref<string | null>("Current"),
    dirty: ref(false),
    writeMode: ref<"none" | "patch" | "full">("none"),
    nlsFlat: ref<Record<string, string>>({ Title: "Current title" }),
    localeNlsFlats: ref<Record<string, Record<string, string>>>({
      Simplified_Chinese: { Title: "当前" },
    }),
  };
  let restored = 0;
  const controller = useCaaDialogHistoryController({
    state,
    onRestored: () => { restored += 1; },
  });
  return { state, controller, restoredCount: () => restored };
}

function historyEntry(id: string, mode: "none" | "patch" | "full" = "full"): CaaIrHistoryEntry {
  return {
    ir: createIr(id),
    selectedId: `${id}-selected`,
    irWriteMode: mode,
    nlsFlat: { Title: `${id} title` },
    localeNlsFlats: { Simplified_Chinese: { Title: `${id} 中文` } },
  };
}

describe("useCaaDialogHistoryController", () => {
  it("创建包含 IR、选择、写回模式和多语言 map 的独立快照", () => {
    const { state, controller } = createHarness();
    state.writeMode.value = "patch";
    const snapshot = controller.snapshotHistoryEntry();
    expect(snapshot).toMatchObject({
      ir: { dialogName: "Current" },
      selectedId: "Current",
      irWriteMode: "patch",
      nlsFlat: { Title: "Current title" },
      localeNlsFlats: { Simplified_Chinese: { Title: "当前" } },
    });

    state.ir.value!.dialogName = "Changed";
    state.nlsFlat.value.Title = "Changed";
    state.localeNlsFlats.value.Simplified_Chinese.Title = "已变更";
    expect(snapshot?.ir.dialogName).toBe("Current");
    expect(snapshot?.nlsFlat?.Title).toBe("Current title");
    expect(snapshot?.localeNlsFlats?.Simplified_Chinese.Title).toBe("当前");
  });

  it("记录新快照清空 redo，并把 undo 栈裁剪为 50 条", () => {
    const { state, controller } = createHarness();
    controller.redoStack.value = [historyEntry("Future")];
    for (let index = 0; index < CAA_IR_HISTORY_LIMIT + 2; index += 1) {
      state.ir.value = createIr(`Dlg${index}`);
      controller.recordHistorySnapshot();
    }
    expect(controller.undoStack.value).toHaveLength(CAA_IR_HISTORY_LIMIT);
    expect(controller.undoStack.value[0].ir.dialogName).toBe("Dlg2");
    expect(controller.undoStack.value.at(-1)?.ir.dialogName).toBe("Dlg51");
    expect(controller.redoStack.value).toEqual([]);
    expect(controller.canUndo.value).toBe(true);
    expect(controller.canRedo.value).toBe(false);
  });

  it("undo/redo 往返完整状态，并只在实际恢复时通知 Page Host", () => {
    const { state, controller, restoredCount } = createHarness();
    controller.undoIrChange();
    expect(restoredCount()).toBe(0);

    controller.restoreHistoryEntry(historyEntry("Base", "patch"));
    expect(state.ir.value?.dialogName).toBe("Base");
    expect(state.selectedId.value).toBe("Base-selected");
    expect(state.writeMode.value).toBe("patch");
    expect(state.dirty.value).toBe(true);
    expect(state.nlsFlat.value.Title).toBe("Base title");
    expect(restoredCount()).toBe(1);

    controller.recordHistorySnapshot();
    state.ir.value = createIr("Edited");
    state.selectedId.value = "Edited-selected";
    state.writeMode.value = "full";
    state.dirty.value = true;
    state.nlsFlat.value = { Title: "Edited title" };
    controller.undoIrChange();
    expect(state.ir.value?.dialogName).toBe("Base");
    expect(controller.canRedo.value).toBe(true);
    expect(restoredCount()).toBe(2);

    controller.redoIrChange();
    expect(state.ir.value?.dialogName).toBe("Edited");
    expect(state.selectedId.value).toBe("Edited-selected");
    expect(state.writeMode.value).toBe("full");
    expect(state.nlsFlat.value.Title).toBe("Edited title");
    expect(restoredCount()).toBe(3);
  });

  it("恢复时缺失选择回退根节点，none 写回模式清除 dirty", () => {
    const { state, controller } = createHarness();
    state.dirty.value = true;
    controller.restoreHistoryEntry({
      ...historyEntry("Clean", "none"),
      selectedId: null,
    });
    expect(state.selectedId.value).toBe("Clean");
    expect(state.writeMode.value).toBe("none");
    expect(state.dirty.value).toBe(false);
  });

  it("旧历史项缺少 NLS maps 时保留 Page 当前 maps", () => {
    const { state, controller } = createHarness();
    const currentFlat = state.nlsFlat.value;
    const currentLocales = state.localeNlsFlats.value;
    controller.restoreHistoryEntry({
      ir: createIr("Legacy"),
      selectedId: "Legacy",
      irWriteMode: "full",
    });
    expect(state.nlsFlat.value).toBe(currentFlat);
    expect(state.localeNlsFlats.value).toBe(currentLocales);
    expect(state.nlsFlat.value).toEqual({ Title: "Current title" });
  });

  it("从 Page snapshot 恢复时复用 session 校验，并可显式清空", () => {
    const { controller } = createHarness();
    controller.restoreHistoryFromSnapshot({
      undoStack: [historyEntry("Undo"), { ir: { invalid: true } } as unknown as CaaIrHistoryEntry],
      redoStack: [historyEntry("Redo", "none")],
    });
    expect(controller.undoStack.value.map((entry) => entry.ir.dialogName)).toEqual(["Undo"]);
    expect(controller.redoStack.value.map((entry) => entry.ir.dialogName)).toEqual(["Redo"]);
    expect(controller.canUndo.value).toBe(true);
    expect(controller.canRedo.value).toBe(true);

    controller.resetHistory();
    expect(controller.undoStack.value).toEqual([]);
    expect(controller.redoStack.value).toEqual([]);
    expect(controller.canUndo.value).toBe(false);
    expect(controller.canRedo.value).toBe(false);
  });

  it("没有 IR 时不生成或记录历史", () => {
    const { state, controller } = createHarness();
    controller.undoStack.value = [historyEntry("Undo")];
    controller.redoStack.value = [historyEntry("Redo")];
    state.ir.value = null;
    expect(controller.snapshotHistoryEntry()).toBeNull();
    controller.recordHistorySnapshot();
    controller.undoIrChange();
    controller.redoIrChange();
    expect(controller.undoStack.value.map((entry) => entry.ir.dialogName)).toEqual(["Undo"]);
    expect(controller.redoStack.value.map((entry) => entry.ir.dialogName)).toEqual(["Redo"]);
  });
});
