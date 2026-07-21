import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("FCStd map page boundary", () => {
  it("页面消费纯 ViewModel，不再内联行投影、分页和 session 版本判断", () => {
    const page = source("./FcstdMapPage.vue");
    expect(page).toContain('from "../components/fcstd-map/FcstdMapIndexPane.vue"');
    expect(page).toContain('from "../models/fcstdMapViewModel"');
    expect(page).toContain('from "../composables/useFcstdMapEntries"');
    expect(page).toContain('from "../composables/useFcstdMapScanController"');
    expect(page).toContain("hydrateFcstdMapPageSession");
    expect(page).toContain("serializeFcstdMapPageSession");
    expect(page).not.toContain("fetchFcstdMapEntries");
    expect(page).not.toContain("searchDebounce");
    expect(page).not.toContain('const SESSION_V = 4');
    expect(page).not.toContain('row.file_status === "missing" ? "缺失" : "存在"');
    expect(page).not.toContain('row.repo_rel_path.replace(/\\\\/g');
    expect(page).not.toContain('id="cad-index-search"');
    expect(page).not.toContain("const cadColumns:");
  });

  it("纯 ViewModel 不访问 Vue、宿主、浏览器存储或 API", () => {
    const model = source("../models/fcstdMapViewModel.ts");
    expect(model).not.toMatch(/from ["']vue["']|from ["']\.\.\/api["']|localStorage|window\.|document\.|fetch\(/);
    expect(model).toContain("hydrateFcstdMapPageSession");
    expect(model).toContain("deriveFcstdMapEntryQuery");
  });

  it("列表 composable 只管理查询与分页，不吸收扫描、日志或文件动作", () => {
    const entries = source("../composables/useFcstdMapEntries.ts");
    expect(entries).toContain("fetchEntries?:");
    expect(entries).toContain("scheduleReload");
    expect(entries).toContain("onPagerCurrentChange");
    expect(entries).not.toMatch(/useAppShell|useAsyncProgress|startFcstdMapScan|purgeMissingFcstdMap|exportFcstdMapJson|localStorage/);
  });

  it("扫描启动、冲突、终态和恢复进入可注入 controller", () => {
    const page = source("./FcstdMapPage.vue");
    const controller = source("../composables/useFcstdMapScanController.ts");
    expect(page).toContain("const scanController = useFcstdMapScanController(");
    expect(page).toContain("onCompleted: async (result)");
    expect(page).not.toMatch(/useAsyncProgress|startFcstdMapScan|fetchFcstdMapScanProgress|cancelFcstdMapScan/);
    expect(controller).toContain("progress?: ScanProgress");
    expect(controller).toContain("transport?:");
    expect(controller).toContain("() => progress.state.value?.status");
    expect(controller).toContain('if (status === "done")');
    expect(controller).toContain('if (status === "error")');
    expect(controller).toContain('if (status === "cancelled")');
  });

  it("索引 Pane 只装配显示与上行事件，不吸收 API、Host、Controller 或 session", () => {
    const pane = source("../components/fcstd-map/FcstdMapIndexPane.vue");
    expect(pane).toContain('defineModel<string>("searchQuery"');
    expect(pane).toContain("openFileDetail: [row: FcstdMapEntryViewInput]");
    expect(pane).toContain("pageChange: [page: number]");
    expect(pane).not.toMatch(/from ["'][^"']*api["']|useAppShell|useFcstdMapEntries|localStorage|sessionStorage|usePageSession/);
  });

  it("设置 Pane 只展示受控状态并上抛导出意图，Page 继续独占副作用", () => {
    const page = source("./FcstdMapPage.vue");
    const pane = source("../components/fcstd-map/FcstdMapSettingsPane.vue");

    expect(page).toContain('from "../components/fcstd-map/FcstdMapSettingsPane.vue"');
    expect(page).toContain(':workspace-path="shell.workspacePath.value"');
    expect(page).toContain(':has-index="Boolean(data?.exists)"');
    expect(page).toContain(':exporting="exporting"');
    expect(page).toContain(':debug-sql="debugSql"');
    expect(page).toContain('@export-json="onExportJson"');
    expect(page).toContain("async function onExportJson()");
    expect(page).toContain("exportFcstdMapJson()");
    expect(page).toContain("saveFcstdMapPrefs(forceUpdatePartName.value)");
    expect(page).toContain("useFcstdMapScanController({");
    expect(page).toContain("purgeMissingFcstdMap()");

    expect(pane).toContain("exportJson: []");
    expect(pane).not.toMatch(
      /from ["'][^"']*api["']|useAppShell|useAsyncProgress|useFileWorksetsStore|useOnboardingStore|usePageSession|localStorage|sessionStorage|pnwPromptChoice/,
    );
  });

  it("Page scoped CSS 只保留页面壳，不回流旧设置表单样式", () => {
    const page = source("./FcstdMapPage.vue");
    for (const staleSelector of [
      ".sub-tab {",
      ".field-label {",
      ".row {",
      ".path-input {",
      ".force-opt {",
      ".stats-grid {",
      ".meta-block .meta-line {",
      ".btn {",
    ]) {
      expect(page).not.toContain(staleSelector);
    }
    expect(page).toContain(".fcstd-map-page {");
    expect(page).toContain(".sub-panel {");
    expect(page).toContain(".settings-panel {");
  });
});
