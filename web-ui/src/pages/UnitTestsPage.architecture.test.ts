import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("UnitTestsPage boundary", () => {
  it("页面消费纯运行范围/结果模型，同时保留 Host API 与流式执行责任", () => {
    const page = source("./UnitTestsPage.vue");
    expect(page).toContain('from "../models/unitTestsViewModel"');
    expect(page).toContain("filterUnitTestCases");
    expect(page).toContain("mergeUnitTestRunOptions");
    expect(page).toContain("fetchUnitTestPlan");
    expect(page).toContain("runUnitTestsStream");
    expect(page).toContain("cancelUnitTestRun");
    expect(page).not.toContain("function caseMatchesStatus(");
    expect(page).not.toContain("function formatRunSummary(");
  });

  it("现有 Pinia store 仍是 session 真源，纯模型不访问 Vue、存储、API 或 Shell", () => {
    const page = source("./UnitTestsPage.vue");
    const store = source("../stores/unitTestsPage.ts");
    const model = source("../models/unitTestsViewModel.ts");
    expect(page).toContain("pageStore.hydrate()");
    expect(store).toContain('const STORAGE_KEY = "phoenix-unit-tests-page-v1"');
    expect(model).not.toMatch(/from ["']vue["']|from ["']\.\.\/api["']|useAppShell|localStorage|window\.|document\.|fetch\(/);
  });
});
