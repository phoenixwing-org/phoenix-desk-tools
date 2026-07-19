import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../pages/UnitTestsPage.vue", import.meta.url), "utf8");
const controller = readFileSync(new URL("./useUnitTestRunController.ts", import.meta.url), "utf8");

describe("Unit Tests stream controller boundary", () => {
  it("Page 只消费 Controller，不再直接拥有 stream、cancel 或 AsyncProgress", () => {
    expect(page).toContain('from "../composables/useUnitTestRunController"');
    expect(page).toContain("const runController = useUnitTestRunController({");
    expect(page).toContain("onCaseDone: syncWatchlistFromCase");
    expect(page).toContain("onCompleted: syncCompletedRun");
    expect(page).not.toContain("runUnitTestsStream");
    expect(page).not.toContain("cancelUnitTestRun");
    expect(page).not.toContain("useAsyncProgress");
  });

  it("Controller 独占流式 Host 编排，但不吸收 Pinia、范围、watchlist 或 history", () => {
    expect(controller).toContain("runStream: runUnitTestsStream");
    expect(controller).toContain("cancelRun: cancelUnitTestRun");
    expect(controller).toContain('useAsyncProgress("unit-test")');
    expect(controller).toContain("formatUnitTestRunSummary");
    expect(controller).toContain("if (running.value) return null");
    expect(controller).toContain("if (!running.value || cancelling.value) return");
    expect(controller).not.toMatch(/useUnitTestsPageStore|unitTestWatchlist|unitTestModuleHistory|localStorage|sessionStorage|fetchUnitTestPlan/);
  });

  it("Page 保留运行模式门禁、request 组装与结果展示/session 同步", () => {
    expect(page).toContain("function syncCompletedRun(");
    expect(page).toContain("recordRunHistoryFromResult(completed)");
    expect(page).toContain('if (request.runMode === "watchlist")');
    expect(page).toContain('async function onRun(mode: RunMode = "full")');
    expect(page).toContain('shell.setStatus("请至少勾选一个要运行的套件")');
    expect(page).toContain('shell.setStatus("请至少勾选一个要运行的模块")');
    expect(page).toContain('shell.setStatus("失败关注列表为空")');
    expect(page).toContain("runOptions = mergeRunOptions()");
    expect(page).toContain("await runController.execute(request)");
    expect(page).toContain("runController.cancel()");
  });
});
