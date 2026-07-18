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
});
