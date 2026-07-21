import ElementPlus, { ID_INJECTION_KEY } from "element-plus";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import UnitTestResultPane from "./UnitTestResultPane.vue";

const cases = [
  { id: "code.pass", module: "tests.test_code", suite_id: "code", class_name: "CodeTests", method: "works", status: "passed", duration_ms: 12, message: "", traceback: "" },
  { id: "cad.fail", module: "tests.test_cad", suite_id: "cad", class_name: "CadTests", method: "fails", status: "failed", duration_ms: 8, message: "expected true", traceback: "line 1" },
] as const;

const result = {
  ok: false,
  suite_id: "all",
  suite_label: "Code + CAD",
  duration_ms: 20,
  summary: { tests_run: 2, passed: 1, failed: 1, errors: 0, skipped: 0, modules: 2, ignored: 1 },
  modules: [
    { module: "tests.test_code", tests_run: 1, passed: 1, failed: 0, errors: 0, skipped: 0 },
    { module: "tests.test_cad", tests_run: 1, passed: 0, failed: 1, errors: 0, skipped: 0 },
  ],
  cases: [...cases],
  failures: [cases[1]],
};

function props(overrides: Record<string, unknown> = {}) {
  return {
    result,
    passRate: 50,
    lastRunSuites: ["code", "cad"],
    suiteLabelById: new Map([["code", "Code"], ["cad", "CAD"]]),
    resultSuiteChecked: new Set(["code", "cad"]),
    resultStatusChecked: new Set(["passed", "failed", "error", "skipped"]),
    filteredCases: [...cases],
    filteredModuleSummaries: result.modules,
    moduleCatalog: {
      "tests.test_code": { module_name: "tests.test_code", file_stem: "test_code", suite_id: "code", title: "Code", description_zh: "代码工具测试", doc_path: null, case_count: 1 },
      "tests.test_cad": { module_name: "tests.test_cad", file_stem: "test_cad", suite_id: "cad", title: "CAD", description_zh: "CAD 工具测试", doc_path: null, case_count: 1 },
    },
    watchlistCount: 1,
    reTestedCount: 1,
    filterWatchlistOnly: false,
    filterReTestedOnly: false,
    lastIgnoredCount: 1,
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(UnitTestResultPane, props(overrides));
  app.use(ElementPlus);
  app.provide(ID_INJECTION_KEY, { prefix: 4096, current: 0 });
  return renderToString(app);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("UnitTestResultPane", () => {
  it("真实 SSR 渲染摘要、筛选、模块与用例空态边界", async () => {
    const html = await render();
    const text = visibleText(html);
    expect(html).toContain('data-testid="unit-test-result-pane"');
    expect(text).toContain("未通过");
    expect(text).toContain("50%");
    expect(text).toContain("显示 2 / 2 条用例 · 本次忽略 1 条");
    expect(text).toContain("代码工具测试");
    expect(text).toContain("CadTests.fails");
    expect(text).toContain("仅关注项");
    expect(text).toContain("仅复测项");

    expect(visibleText(await render({ filteredCases: [], filteredModuleSummaries: [] })))
      .toContain("当前筛选无匹配用例，请调整上方勾选。");
  });

  it("公开受控结果输入和语义事件，不接收 Host callback", () => {
    const component = UnitTestResultPane as unknown as { props?: Record<string, unknown>; emits?: string[] };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "result", "passRate", "resultSuiteChecked", "resultStatusChecked", "filteredCases", "moduleCatalog",
    ]));
    expect(component.emits).toEqual(expect.arrayContaining([
      "suiteChange", "statusChange", "selectAllSuites", "selectOnlyFailed", "filterWatchlist", "filterReTested",
    ]));
  });
});
