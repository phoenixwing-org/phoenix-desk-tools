import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ribbonFixture from "phoenix-wing/fixtures/ribbon-contribution-v1.json";
import { pnwCheckRibbonContributionCompatibility, pnwNavigationFromRibbonTabs } from "phoenix-wing";
import type { NavItem } from "../../types/config";
import { buildRibbonTabs } from "./ribbonConfig";

function navigationConfig(): NavItem[] {
  const filename = path.resolve(process.cwd(), "../phoenix/config/app_config.json");
  return JSON.parse(fs.readFileSync(filename, "utf8")).navigation;
}

describe("Ribbon navigation contract", () => {
  it("直接消费 Registry v1 fixture 并对未知版本 fail-closed", () => {
    expect(pnwCheckRibbonContributionCompatibility(ribbonFixture)).toMatchObject({
      compatible: true,
      document: ribbonFixture,
    });
    expect(pnwCheckRibbonContributionCompatibility({ ...ribbonFixture, schemaVersion: 2 })).toMatchObject({
      compatible: false,
      code: "contribution.unsupported-schema-version",
      actualSchemaVersion: 2,
    });
  });

  it("builds shell and module groups from app_config without exposing context-only pages", () => {
    const tabs = buildRibbonTabs(navigationConfig());
    expect(tabs.map((tab) => ({ id: tab.id, label: tab.label }))).toEqual([
      { id: "system", label: "系统" },
      { id: "cad", label: "工具" },
    ]);

    const pages = Object.fromEntries(tabs.map((tab) => [
      tab.id,
      tab.groups.flatMap((group) => group.items.map((item) => item.pageId)),
    ]));
    expect(pages.system).toEqual([
      "home",
      "config",
      "git",
      "test_fixtures",
      "unit_tests",
      "config.freecad-mcp.manage",
    ]);
    expect(pages.cad).toEqual([
      "batch_tasks",
      "cad_index",
      "workspace_recovery",
      "part_catalog",
      "bom_delivery",
      "file_rename",
      "cad_batch_tools",
      "rename_tasks",
      "code_ignore",
      "caa_dialog_home",
      "audio_extract",
    ]);
    expect(Object.values(pages).flat()).not.toEqual(expect.arrayContaining([
      "welcome",
      "file_detail",
      "part_key_detail",
      "caa_dialog",
      "name_normalize",
    ]));
  });

  it.each([
    { enabled: ["code"], tools: ["batch_tasks", "rename_tasks", "code_ignore", "caa_dialog_home", "audio_extract"] },
    { enabled: ["cad"], tools: ["batch_tasks", "cad_index", "workspace_recovery", "part_catalog", "bom_delivery", "file_rename", "cad_batch_tools", "rename_tasks", "audio_extract"] },
    { enabled: [], tools: ["batch_tasks", "rename_tasks", "audio_extract"] },
  ])("keeps the tools entry for $enabled preferences without exposing disabled domains", ({ enabled, tools }) => {
    // The production AppShell filters each original module before grouping.
    const navigation = navigationConfig();
    const original = JSON.stringify(navigation);
    const tabs = buildRibbonTabs(navigation.filter((nav) => !nav.module || enabled.includes(nav.module)));
    expect(tabs.map((tab) => tab.id)).toEqual(["system", "cad"]);
    expect(tabs[1]?.groups.flatMap((group) => group.items.map((item) => item.pageId))).toEqual(tools);
    expect(tabs[1]?.module).toBeUndefined();
    expect(pnwNavigationFromRibbonTabs(tabs).map((node) => ({ id: node.id, label: node.label }))).toEqual([
      { id: "system", label: "系统" }, { id: "cad", label: "工具" },
    ]);
    expect(JSON.stringify(navigation)).toBe(original);
  });

  it("preserves domain ownership and module-independent audio access", () => {
    const byPage = new Map(navigationConfig().map((nav) => [nav.page, nav]));
    expect(byPage.get("part_catalog")?.module).toBe("cad");
    expect(byPage.get("cad_index")?.module).toBe("cad");
    expect(byPage.get("workspace_recovery")?.module).toBe("cad");
    expect(byPage.get("workspace_recovery")?.ribbonGroup).toBe("索引");
    expect(byPage.get("bom_delivery")?.module).toBe("cad");
    expect(byPage.get("bom_delivery")?.ribbonGroup).toBe("交付");
    expect(byPage.get("bom_delivery")?.label).toBe("BOM 离线导出");
    expect(byPage.get("name_normalize")?.module).toBe("cad");
    expect(byPage.get("name_normalize")?.ribbonGroup).toBeUndefined();
    expect(byPage.get("code_ignore")?.module).toBe("code");
    expect(byPage.get("caa_dialog_home")?.module).toBe("code");
    expect(byPage.get("audio_extract")?.module).toBeUndefined();
    expect(byPage.get("audio_extract")?.ribbonGroup).toBe("媒体");
    expect(byPage.get("rename_tasks")?.module).toBeUndefined();
  });

  it("deduplicates repeated page definitions while preserving the first navigation label", () => {
    const navigation: NavItem[] = [
      { id: "one", page: "same", label: "One", module: "code", ribbonGroup: "编辑" },
      { id: "two", page: "same", label: "Two", module: "code", ribbonGroup: "编辑" },
    ];
    const items = buildRibbonTabs(navigation)[1]?.groups[0]?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ pageId: "same", label: "One" });
  });
});
