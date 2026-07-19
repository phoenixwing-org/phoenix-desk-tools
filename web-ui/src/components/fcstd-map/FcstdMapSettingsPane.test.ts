import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import FcstdMapSettingsPane from "./FcstdMapSettingsPane.vue";

function props(overrides: Record<string, unknown> = {}) {
  return {
    workspacePath: "/workspace/Phoenix Demo",
    hasIndex: true,
    exporting: false,
    debugSql: "SELECT * FROM file_asset LIMIT 20",
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  return renderToString(createSSRApp(FcstdMapSettingsPane, props(overrides)));
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("FcstdMapSettingsPane", () => {
  it("真实 SSR 渲染扫描、导出和调试信息", async () => {
    const html = await render();
    const text = visibleText(html);

    expect(text).toContain("工作空间：/workspace/Phoenix Demo");
    expect(text).toContain("导出 fcstd_map.json");
    expect(text).toContain("SELECT * FROM file_asset LIMIT 20");
    expect(html).toContain("settings-block");
  });

  it("空工作空间与空 SQL 不渲染对应信息", async () => {
    const text = visibleText(await render({ workspacePath: "", debugSql: "" }));
    expect(text).not.toContain("工作空间：");
    expect(text).not.toContain("调试 SQL");
    expect(text).not.toContain("最近一次列表查询");
  });

  it("公开四项受控状态和单一语义事件", () => {
    const component = FcstdMapSettingsPane as unknown as {
      props?: Record<string, unknown>;
      emits?: string[];
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "workspacePath",
      "hasIndex",
      "exporting",
      "debugSql",
    ]));
    expect(component.emits).toEqual(["exportJson"]);
  });
});
