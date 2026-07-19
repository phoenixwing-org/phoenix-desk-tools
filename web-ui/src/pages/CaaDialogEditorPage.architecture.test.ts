import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("CAA dialog editor session boundary", () => {
  it("页面消费纯 session codec，同时保留 PageSession、草稿、解析与写回 Host 责任", () => {
    const page = source("./CaaDialogEditorPage.vue");
    expect(page).toContain('from "../models/caaDialogSessionViewModel"');
    expect(page).toContain("buildCaaDialogPageSnapshot");
    expect(page).toContain("usePageSession(");
    expect(page).toContain("parseCaaDialog(");
    expect(page).toContain("saveCaaDraft(");
    expect(page).toContain("writeCaaDialogFromIr(");
    expect(page).not.toContain("function historyStackFromSession(");
    expect(page).not.toContain("function stringMapFromSession(");
  });

  it("纯 session codec 不访问 Vue、Shell、浏览器、API 或组件", () => {
    const model = source("../models/caaDialogSessionViewModel.ts");
    expect(model).not.toMatch(/from ["']vue["']|useAppShell|localStorage|window\.|document\.|\.vue["']|from ["']\.\.\/api/);
    expect(model).toContain("CAA_SESSION_HISTORY_LIMIT = 12");
    expect(model).toContain("caaDialogIrForSession");
  });

  it("NLS 六项 session 投影进入纯 ViewModel，Page 保留 refs、locale UI 与 Host", () => {
    const page = source("./CaaDialogEditorPage.vue");
    const model = source("../models/caaDialogNlsSessionViewModel.ts");
    expect(page).toContain('from "../models/caaDialogNlsSessionViewModel"');
    expect(page).toContain("buildCaaDialogNlsSessionFromIr");
    expect(page).toContain("buildCaaDialogNlsSessionFromDraft");
    expect(page).toContain("overlayCaaDialogNlsSnapshot");
    expect(page).toContain("projectCaaNlsKeyCountMismatch");
    for (const refName of [
      "baselineNlsFlat",
      "currentNlsFlat",
      "nlsSourceText",
      "localeNlsFlats",
      "localeBaselineFlats",
      "localeSourceTexts",
    ]) {
      expect(page).toContain(`const ${refName} = ref`);
    }
    expect(page).toContain("createCaaDialogLocaleNls(");
    expect(page).toContain("saveCaaDialogNls(");
    expect(page).toContain("setNlsEditorLocale(");
    expect(model).not.toMatch(/from ["']vue["']|useAppShell|localStorage|window\.|document\.|\.vue["']|from ["']\.\.\/api/);
  });

  it("Canvas Controller 只消费 Page-local refs/ports，Page 保留 Pinia、键盘与 Host API", () => {
    const page = source("./CaaDialogEditorPage.vue");
    const controller = source("../composables/useCaaDialogCanvasController.ts");
    expect(page).toContain('from "../composables/useCaaDialogCanvasController"');
    expect(page).toContain("useCaaDialogCanvasController({");
    expect(page).toContain("provide(CAA_CONTROL_KEY, controlContext)");
    expect(page).toContain("store.setSelectedId(nodeId, caaEditorStoreId.value)");
    expect(page).toContain("function onWindowKeydown(");
    expect(page).toContain("usePageSession(");
    expect(page).toContain("parseCaaDialog(");
    expect(page).toContain("writeCaaDialogFromIr(");

    expect(controller).toContain("export function useCaaDialogCanvasController(");
    expect(controller).toContain("readonly mirrorSelection:");
    expect(controller).toContain("readonly syncNls:");
    expect(controller).toContain("const controlContext: CaaControlContext");
    expect(controller).not.toMatch(
      /useAppShell|usePageSession|useCaaDialogPageStore|ElMessage|\.vue["']|from ["']\.\.\/api/,
    );
  });

});
