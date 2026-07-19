import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../pages/CaaDialogEditorPage.vue", import.meta.url), "utf8");
const controller = readFileSync(new URL("./useCaaDialogHistoryController.ts", import.meta.url), "utf8");
const canvasController = readFileSync(new URL("./useCaaDialogCanvasController.ts", import.meta.url), "utf8");

describe("CAA dialog history page contract", () => {
  it("保留撤销/重做按钮、禁用态与既有快捷键", () => {
    expect(page).toContain(':disabled="!canUndo"');
    expect(page).toContain('@click="undoIrChange"');
    expect(page).toContain(':disabled="!canRedo"');
    expect(page).toContain('@click="redoIrChange"');
    expect(page).toContain('title="撤销 (Ctrl+Z)"');
    expect(page).toContain('title="重做 (Ctrl+Y / Ctrl+Shift+Z)"');
    expect(page).toContain('if ((e.ctrlKey || e.metaKey) && key === "z")');
    expect(page).toContain("if (e.shiftKey) redoIrChange();");
    expect(page).toContain('if ((e.ctrlKey || e.metaKey) && key === "y")');
  });

  it("所有既有编辑入口继续复用同一条历史记录命令", () => {
    // 两个 NLS 编辑入口留在 Page；八个 Canvas 命令入口迁入 Controller。
    expect(page.match(/recordHistorySnapshot\(\)/g)).toHaveLength(2);
    expect(canvasController.match(/ports\.recordHistory\(\)/g)).toHaveLength(8);
    expect(page).toContain("recordHistory: recordHistorySnapshot");
    expect(canvasController).toContain("if (opts?.recordHistory !== false) ports.recordHistory();");
    expect(canvasController).toContain("recordHistory: ports.recordHistory");
  });

  it("PageSession 继续负责历史栈的序列化与恢复", () => {
    expect(page).toContain("buildCaaDialogPageSnapshot({");
    expect(page).toContain("undoStack: toRaw(undoStack.value)");
    expect(page).toContain("redoStack: toRaw(redoStack.value)");
    expect(page).toContain("restoreHistoryFromSnapshot(state)");
    expect(page).toContain("restoreHistoryFromSnapshot(restoredState)");
  });

  it("Controller 独占栈迁移，Page 继续持有本地状态和 Host/API 边界", () => {
    expect(page).toContain('from "../composables/useCaaDialogHistoryController"');
    expect(page).toContain("useCaaDialogHistoryController({");
    expect(page).not.toContain("const undoStack = ref<CaaIrHistoryEntry[]>");
    expect(page).not.toContain("function snapshotHistoryEntry(");
    expect(page).not.toContain("function restoreHistoryEntry(");
    expect(page).not.toContain("undoStack.value =");
    expect(page).not.toContain("redoStack.value =");
    expect(page).toContain("const localIr = ref<CaaDialogIr | null>(null)");
    expect(page).toContain("function markIrDirty(");
    expect(page).toContain("function markIrClean()");
    expect(page).toContain("usePageSession(");
    expect(page).toContain("parseCaaDialog(");
    expect(page).toContain("writeCaaDialogFromIr(");
    expect(page).toContain("saveCaaDraft(");
    expect(page).toContain("useCaaDialogCanvasController({");

    expect(controller).toContain("const undoStack = ref<CaaIrHistoryEntry[]>([])");
    expect(controller).toContain("function snapshotHistoryEntry(");
    expect(controller).toContain("function restoreHistoryEntry(");
    expect(controller).toContain("caaHistoryStackFromSession(");
    expect(controller).not.toMatch(/useAppShell|usePageSession|useCaaDialogPageStore|localStorage|sessionStorage|from ["']\.\.\/api/);
    expect(canvasController).not.toMatch(/useAppShell|usePageSession|useCaaDialogPageStore|localStorage|sessionStorage|from ["']\.\.\/api/);
  });
});
