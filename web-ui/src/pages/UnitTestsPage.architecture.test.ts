import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function functionSource(page: string, name: string, nextName: string): string {
  const body = page.match(new RegExp(`async function ${name}\\(\\)[\\s\\S]*?(?=\\nfunction ${nextName})`, "u"))?.[0];
  if (!body) throw new Error(`${name} source not found`);
  return body;
}

describe("UnitTestsPage boundary", () => {
  it("页面消费纯模型与 run/plan Controller，不再内联 stream、cancel 或 plan transport", () => {
    const page = source("./UnitTestsPage.vue");
    expect(page).toContain('from "../models/unitTestsViewModel"');
    expect(page).toContain('from "../composables/useUnitTestRunController"');
    expect(page).toContain('from "../composables/useUnitTestPlanController"');
    expect(page).toContain("filterUnitTestCases");
    expect(page).toContain("mergeUnitTestRunOptions");
    expect(page).not.toContain("fetchUnitTestPlan");
    expect(page).not.toContain("runUnitTestsStream");
    expect(page).not.toContain("cancelUnitTestRun");
    expect(page).not.toContain("useAsyncProgress");
    expect(page).not.toContain("function caseMatchesStatus(");
    expect(page).not.toContain("function formatRunSummary(");
  });

  it("流式 Controller 可注入 Host/Progress/Transport，且不吸收 Pinia、范围或持久状态", () => {
    const controller = source("../composables/useUnitTestRunController.ts");
    expect(controller).toContain("UseUnitTestRunControllerOptions");
    expect(controller).toContain("UnitTestRunTransport");
    expect(controller).toContain("runStream: runUnitTestsStream");
    expect(controller).toContain("cancelRun: cancelUnitTestRun");
    expect(controller).not.toMatch(/useUnitTestsPageStore|unitTestWatchlist|unitTestModuleHistory|localStorage|sessionStorage|fetchUnitTestPlan/);
  });

  it("计划 Controller 独占 latest-request-wins 与计划参数，不吸收模块选择或 Page 状态", () => {
    const controller = source("../composables/useUnitTestPlanController.ts");
    expect(controller).toContain("UnitTestPlanTransport");
    expect(controller).toContain("fetchPlan: fetchUnitTestPlan");
    expect(controller).toContain("const epoch = ++requestEpoch");
    expect(controller).toContain("if (epoch !== requestEpoch) return null");
    expect(controller).toContain("excludeCaseIds");
    expect(controller).not.toMatch(/include_modules|include_cases|useUnitTestsPageStore|syncUnitTestCheckedModules|loadModuleCatalog|loadCaseCatalog|useAppShell|localStorage|sessionStorage/);
  });

  it("Page 计划刷新只传发现参数，并在计划加载期间禁止正式运行", () => {
    const page = source("./UnitTestsPage.vue");
    const pane = source("../components/unit-tests/UnitTestRunScopePane.vue");
    const loadRunPlan = functionSource(page, "loadRunPlan", "syncAcceptedPlan");
    expect(loadRunPlan).toContain("planController.load({");
    expect(loadRunPlan).toContain("excludeCaseIds: excludeCaseIdsForFullRun(watchlist.value)");
    expect(loadRunPlan).toContain("includeCaseDetails: showRunScopeCases.value");
    expect(loadRunPlan).not.toContain("mergeRunOptions");
    expect(page).toContain("fullRunExcludedCaseSignature.value");
    expect(page).toContain('if (mode === "full" && showRunScopeList.value)');
    expect(page).toContain("if (runPlanLoading.value)");
    expect(page).toContain('shell.setStatus("运行计划仍在加载，请稍候")');
    expect(page).toContain('shell.setStatus("运行计划加载失败，请切换范围重试或关闭模块范围")');
    expect(page).toContain('shell.setStatus("运行计划尚未就绪，请稍候或关闭模块范围")');
    expect(page).toContain('shell.setStatus("当前运行计划没有可执行模块")');
    expect(page).toContain("if (running.value || runPlanLoading.value) return");
    expect(pane).toContain(':disabled="running || planLoading"');
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
