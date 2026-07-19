import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../../pages/FcstdMapPage.vue", import.meta.url),
  "utf8",
);
const pane = readFileSync(new URL("./FcstdMapSettingsPane.vue", import.meta.url), "utf8");

describe("FCStd map settings pane characterization", () => {
  it("冻结扫描说明、工作空间路径和强制更新提示", () => {
    expect(pane).toContain("从<strong>当前工作空间根</strong>递归扫描");
    expect(pane).toContain(".phoenix/phoenix-workspace.sqlite");
    expect(pane).toContain("再次扫描时磁盘上已不存在的条目标记为缺失");
    expect(pane).toContain('v-if="workspacePath"');
    expect(pane).toContain("工作空间：{{ workspacePath }}");
    expect(pane).toContain("强制更新零件名");
    expect(pane).toContain("不写回 FCStd");
  });

  it("冻结导出文案、禁用条件和无 payload 语义事件", () => {
    expect(pane).toContain("导出 <code>fcstd_map.json</code> 仅含 FCStd 条目");
    expect(pane).toContain(':loading="exporting"');
    expect(pane).toContain(':disabled="!hasIndex"');
    expect(pane).toContain('@click="emit(\'exportJson\')"');
    expect(pane).toContain("exportJson: []");
  });

  it("冻结按需调试 SQL，不把空查询渲染为调试块", () => {
    expect(pane).toContain('v-if="debugSql"');
    expect(pane).toContain("最近一次列表查询（可复制到 SQLite 客户端执行）");
    expect(pane).toContain("{{ debugSql }}");
  });

  it("冻结 Page 作为 API、Host、session 与扫描 Controller 唯一所有者", () => {
    expect(page).toContain("async function onExportJson()");
    expect(page).toContain("exportFcstdMapJson()");
    expect(page).toContain("startFcstdMapScan(forceUpdatePartName.value");
    expect(page).toContain("purgeMissingFcstdMap()");
    expect(page).toContain("saveFcstdMapPrefs(forceUpdatePartName.value)");
    expect(page).toContain("usePageSession(props.workbenchTabId");
    expect(page).toContain('shell.registerPageMessages("fcstd_map"');
    expect(pane).not.toMatch(
      /from ["'][^"']*api["']|useAppShell|useAsyncProgress|useFileWorksetsStore|useOnboardingStore|usePageSession|localStorage|sessionStorage|pnwPromptChoice/,
    );
  });
});
