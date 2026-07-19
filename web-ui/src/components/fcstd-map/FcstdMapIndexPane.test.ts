import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import FcstdMapIndexPane from "./FcstdMapIndexPane.vue";

const presentEntry = {
  repo_rel_path: "parts/Demo.FCStd",
  filename: "Demo.FCStd",
  asset_kind: "fcstd",
  PartNumber: "PN-01",
  PartVersion: "A",
  TypeCode: "Part",
  ModelSeries: "M1",
  PartName: "Demo Part",
  label: "Demo Label",
  file_status: "present" as const,
};

function props(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    loading: false,
    entriesLoading: false,
    entries: [presentEntry],
    entriesTotal: 41,
    pageOffset: 20,
    pageEnd: 21,
    pageSize: 20,
    currentPage: 2,
    searchQuery: "",
    statusFilter: "all",
    kindFilter: "all",
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  return renderToString(createSSRApp(FcstdMapIndexPane, props(overrides)));
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("FcstdMapIndexPane", () => {
  it("真实 SSR 渲染十二列、行投影、显示范围与分页", async () => {
    const html = await render();
    const text = visibleText(html);

    expect((html.match(/<td(?:\s|>)/gu) ?? [])).toHaveLength(12);
    expect(text).toContain("存在");
    expect(text).toContain("FCStd");
    expect(text).toContain("Demo.FCStd");
    expect(text).toContain("PN-01.A");
    expect(text).toContain("PN-01 · A · Part · M1 · Demo Part · Demo Label");
    expect(text).toContain("显示 21–21 / 41 条");
    expect(html).toContain('data-tour-page-fcstd-table');
  });

  it("真实 SSR 保留 loading 与三类空结果文案", async () => {
    expect(visibleText(await render({ entries: [], entriesLoading: true }))).toContain("加载索引列表…");
    expect(visibleText(await render({ entries: [], searchQuery: "pump" }))).toContain("无匹配条目，请调整搜索或筛选");
    expect(visibleText(await render({ entries: [] }))).toContain("当前筛选无条目");
    expect(visibleText(await render({ entries: [], exists: false }))).toContain("尚无索引，点击「工程内搜索」开始扫描");
  });

  it("公开受控状态与七个上行事件，不拥有第二份 Host 状态", () => {
    const component = FcstdMapIndexPane as unknown as {
      props?: Record<string, unknown>;
      emits?: string[];
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "searchQuery",
      "statusFilter",
      "kindFilter",
      "entries",
      "entriesTotal",
      "pageOffset",
      "pageEnd",
      "pageSize",
      "currentPage",
      "exists",
      "entriesLoading",
      "loading",
    ]));
    expect(component.emits).toEqual(expect.arrayContaining([
      "update:searchQuery",
      "update:statusFilter",
      "update:kindFilter",
      "pageChange",
      "pageSizeChange",
      "openFileDetail",
      "openPartKey",
    ]));
  });
});
