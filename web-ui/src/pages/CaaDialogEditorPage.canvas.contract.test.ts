import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const page = source("./CaaDialogEditorPage.vue");
const controller = source("../composables/useCaaDialogCanvasController.ts");
const grid = source("../components/caa/CaaDialogGrid.vue");
const tree = source("../components/caa/CaaDialogTreePanel.vue");

function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing section end: ${end}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("CAA dialog canvas controller page contract", () => {
  it("Page 只注入 local refs/ports，并提供 Controller 组装的 CAA_CONTROL_KEY", () => {
    expect(page).toContain('from "../composables/useCaaDialogCanvasController"');
    const wiring = section(
      page,
      "const { controlContext, deleteSelectedControl }",
      "const nlsEditCtx",
    );
    expect(wiring).toContain("useCaaDialogCanvasController({");
    for (const stateName of [
      "ir: localIr",
      "selectedId: localSelectedId",
      "canEditNls",
      "activeLocale: nlsEditorLocale",
      "editMode",
    ]) {
      expect(wiring).toContain(stateName);
    }
    for (const port of [
      "recordHistory: recordHistorySnapshot",
      "markDirty: markIrDirty",
      "syncSidebar: syncToSidebar",
      "syncNls: syncNlsFromModel",
      "commitNls: commitNlsEdit",
    ]) {
      expect(wiring).toContain(port);
    }
    expect(wiring).toContain("store.setSelectedId(nodeId, caaEditorStoreId.value)");
    expect(wiring).toContain("provide(CAA_CONTROL_KEY, controlContext)");

    expect(page).not.toContain("function toggleGridRowResize(");
    expect(page).not.toContain("function removeControlFromContainer(");
    expect(page).not.toContain("function removeControlImpl(");
    expect(page).not.toContain("const dropIndicator = ref");
  });

  it("双向选择仍由 Controller local mutation、Page Pinia port 与 Primary watch 组成", () => {
    expect(controller).toContain("state.selectedId.value = nodeId");
    expect(controller).toContain("ports.mirrorSelection(nodeId)");

    const treeSelect = section(tree, "function onNodeClick(", "const ICON_FALLBACK");
    expect(treeSelect).toContain("store.setSelectedId(data.id)");
    const selectionMirror = section(
      page,
      "watch(\n  () => store.selectedId",
      "function isEditableEventTarget(",
    );
    expect(selectionMirror).toContain("if (isActiveTab() && id !== localSelectedId.value)");
    expect(selectionMirror).toContain("localSelectedId.value = id");
  });

  it("Grid 继续拥有 DOM 手势，并通过稳定 Context 命令写入 Controller", () => {
    for (const command of [
      "toggleGridRowResize",
      "toggleGridColResize",
      "setGridRowResize",
      "setGridColResize",
      "addControl",
      "removeControl",
      "insertRow",
      "insertCol",
      "setChildren",
      "recordHistory",
    ]) {
      expect(controller).toContain(command);
    }
    const drop = section(grid, "function doDrop(", "function onGridDrop(");
    expect(drop).toContain("ctx!.recordHistory()");
    expect(drop).toContain("ctx!.setChildren(");
    expect(drop.indexOf("ctx!.recordHistory()"))
      .toBeLessThan(drop.indexOf("ctx!.setChildren("));

    const resizeBatch = section(
      grid,
      "function startResizeFlagDrag(",
      "function finishResizeFlagDrag(",
    );
    expect(resizeBatch.match(/ctx\.recordHistory\(\)/g)).toHaveLength(1);
    expect(resizeBatch).toContain("{ recordHistory: false }");
  });

  it("Page 保留 active Tab 与 Delete/Backspace 输入避让", () => {
    const editableGuard = section(
      page,
      "function isEditableEventTarget(",
      "function onWindowKeydown(",
    );
    expect(editableGuard).toContain("if (!(target instanceof HTMLElement)) return false");
    expect(editableGuard).toContain('tag === "input"');
    expect(editableGuard).toContain('tag === "textarea"');
    expect(editableGuard).toContain("target.isContentEditable");

    const keydown = section(page, "function onWindowKeydown(", "onMounted(() => {");
    expect(keydown).toContain("if (!isActiveTab() || isEditableEventTarget(e.target)) return");
    expect(keydown).toContain('(key === "delete" || key === "backspace")');
    expect(keydown).toContain("if (deleteSelectedControl()) e.preventDefault()");
  });

  it("Controller 不吸收 Pinia/PageSession/Shell/API/消息，Host 调用继续留在 Page", () => {
    expect(controller).not.toMatch(
      /useCaaDialogPageStore|usePageSession|useAppShell|ElMessage|from ["']\.\.\/api\//,
    );
    expect(controller).not.toMatch(/fetchCaa|parseCaaDialog|saveCaa|writeCaa|createCaa|deleteCaa/);
    expect(controller).not.toContain("provide(");

    for (const hostCall of [
      "usePageSession(",
      "parseCaaDialog(",
      "saveCaaDraft(",
      "saveCaaDialogNls(",
      "saveCaaDialog(",
      "writeCaaDialogFromIr(",
      "createCaaDialogLocaleNls(",
      "createCaaDialogFromIr(",
      "shell.appendLog(",
      "ElMessage.",
    ]) {
      expect(page).toContain(hostCall);
    }
  });
});
