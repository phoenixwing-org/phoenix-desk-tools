import ElementPlus, { ID_INJECTION_KEY } from "element-plus";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { UnitTestRunScopeRowView } from "../../models/unitTestsViewModel";
import UnitTestRunScopePane from "./UnitTestRunScopePane.vue";

const rows: UnitTestRunScopeRowView[] = [
  {
    module: "tests.test_code",
    moduleLabel: "test_code",
    description: "代码工具测试",
    suiteId: "code",
    suiteLabel: "Code",
    backend: "vitest",
    caseCount: 2,
    selected: true,
    cases: [{ id: "code-1", label: "CodeTests.works", summary: "正常路径" }],
    runCount: 3,
    lastRunAt: "2026-07-18T06:00:00.000Z",
    lastRunLabel: "07/18 14:00",
  },
  {
    module: "tests.test_cad",
    moduleLabel: "test_cad",
    description: "CAD 工具测试",
    suiteId: "cad",
    suiteLabel: "CAD",
    backend: "runtime",
    caseCount: 4,
    selected: false,
    cases: [],
    runCount: 0,
    lastRunAt: null,
    lastRunLabel: "—",
  },
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    runnableSuites: [
      { id: "code", label: "Code", description: "", module_count: 1, modules: [], backend: "vitest" },
      { id: "cad", label: "CAD", description: "", module_count: 1, modules: [], backend: "runtime" },
    ],
    checkedSuiteIds: new Set(["code", "cad"]),
    running: false,
    moduleCountLabel: "1/2",
    plan: {
      suite_label: "Code + CAD",
      total_modules: 2,
      total_cases: 6,
      ignored_cases: 1,
      modules: [{}, {}],
    },
    planLoading: false,
    planError: "",
    rows,
    rerunningModule: null,
    showModuleList: true,
    showCaseDetails: false,
    moduleSortBy: "plan",
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(UnitTestRunScopePane, props(overrides));
  app.use(ElementPlus);
  app.provide(ID_INJECTION_KEY, { prefix: 1024, current: 0 });
  return renderToString(app);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("UnitTestRunScopePane", () => {
  it("真实 SSR 渲染套件控制与部分选择摘要", async () => {
    const html = await render();
    const text = visibleText(html);

    expect(text).toContain("运行范围");
    expect(text).toContain("Code + CAD · 已选 1/2 模块 · 2 用例 · 将忽略 1");
    expect(text).toContain("默认");
    expect(text).toContain("最近运行");
    expect(html).toContain('data-testid="unit-test-run-scope-pane"');
    expect(html).toContain('class="run-toolbar-toggle"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/aria-controls="v-[^"]+"/u);
  });

  it("真实 SSR 保留 loading、error 与空计划状态", async () => {
    expect(visibleText(await render({ planLoading: true }))).toContain("加载计划…");
    expect(visibleText(await render({
      plan: null,
      rows: [],
      planError: "Error: offline",
    }))).toContain("Error: offline");
    expect(visibleText(await render({
      plan: { suite_label: "Code", total_modules: 0, total_cases: 0, ignored_cases: 0, modules: [] },
      rows: [],
    }))).toContain("当前计划没有可执行模块");
  });

  it("公开三组受控 model、四个语义事件且不接收 Host callback", () => {
    const component = UnitTestRunScopePane as unknown as {
      props?: Record<string, unknown>;
      emits?: string[];
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "showModuleList",
      "showCaseDetails",
      "moduleSortBy",
      "runnableSuites",
      "checkedSuiteIds",
      "plan",
      "rows",
      "running",
    ]));
    expect(component.emits).toEqual(expect.arrayContaining([
      "update:showModuleList",
      "update:showCaseDetails",
      "update:moduleSortBy",
      "suiteChange",
      "allModulesChange",
      "moduleChange",
      "runModule",
    ]));
  });
});
