import ElementPlus, { ID_INJECTION_KEY } from "element-plus";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { UnitTestWatchlistRowView } from "../../models/unitTestsViewModel";
import UnitTestWatchlistPane from "./UnitTestWatchlistPane.vue";

const rows: UnitTestWatchlistRowView[] = [
  {
    id: "case.failed",
    module: "tests.test_code",
    moduleLabel: "test_code",
    method: "fails_once",
    message: "expected true",
    status: "failed",
    statusClass: "status-failed",
    description: "代码工具失败路径",
    descriptionBrief: "代码工具失败路径",
    suiteId: "code",
    suiteLabel: "Code",
    failCount: 3,
    lastSeenAt: "2026-07-18T06:00:00.000Z",
    lastSeenLabel: "07/18 14:00",
    runOnFull: false,
    selected: true,
  },
  {
    id: "case.error",
    module: "tests.test_cad",
    moduleLabel: "test_cad",
    method: "raises_error",
    message: "offline",
    status: "error",
    statusClass: "status-error",
    description: "CAD 错误路径",
    descriptionBrief: "CAD 错误路径",
    suiteId: "cad",
    suiteLabel: "CAD",
    failCount: 2,
    lastSeenAt: "2026-07-18T05:00:00.000Z",
    lastSeenLabel: "07/18 13:00",
    runOnFull: true,
    selected: false,
  },
];

function props(overrides: Record<string, unknown> = {}) {
  return {
    rows,
    running: false,
    sortBy: "last_seen_at",
    defaultRunOnFull: true,
    rerunningId: null,
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(UnitTestWatchlistPane, props(overrides));
  app.use(ElementPlus);
  app.provide(ID_INJECTION_KEY, { prefix: 2048, current: 0 });
  return renderToString(app);
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("UnitTestWatchlistPane", () => {
  it("真实 SSR 渲染统计、排序、说明与两条受控关注行", async () => {
    const html = await render();
    const text = visibleText(html);

    expect(text).toContain("2 条 · 累计失败 5 次 · 已勾选 1");
    expect(text).toContain("最近失败");
    expect(text).toContain("失败次数");
    expect(text).toContain("代码工具失败路径");
    expect(text).toContain("CAD 错误路径");
    expect(text).toContain("复测勾选（1）");
    expect(html).toContain('data-testid="unit-test-watchlist-pane"');
    expect(html).toContain('data-testid="unit-test-watchlist-scroll"');
    expect(html).toContain("status-failed");
    expect(html).toContain("status-error");
  });

  it("真实 SSR 保留空态与单条运行禁用状态", async () => {
    expect(visibleText(await render({ rows: [] }))).toContain(
      "暂无失败关注；运行测试后失败项会自动出现。",
    );
    const runningHtml = await render({ running: true, rerunningId: "case.failed" });
    expect(runningHtml).toContain("watchlist-row-running");
    expect(runningHtml).toContain("watchlist-row-disabled");
    expect(runningHtml.match(/disabled/gu)?.length ?? 0).toBeGreaterThan(5);
  });

  it("公开五个受控输入和十个语义事件，不接收 Host callback", () => {
    const component = UnitTestWatchlistPane as unknown as {
      props?: Record<string, unknown>;
      emits?: string[];
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "rows",
      "running",
      "sortBy",
      "defaultRunOnFull",
      "rerunningId",
    ]));
    expect(component.emits).toEqual(expect.arrayContaining([
      "sort",
      "defaultRunOnFull",
      "allChecked",
      "checked",
      "runOnFull",
      "runSelected",
      "runWatchlist",
      "rerun",
      "removeRequest",
      "clearRequest",
    ]));
  });
});
