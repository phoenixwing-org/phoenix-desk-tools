import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NavItem } from "../../types/config";
import { buildRibbonTabs } from "./ribbonConfig";

function navigationConfig(): NavItem[] {
  const filename = path.resolve(process.cwd(), "../phoenix/config/app_config.json");
  return JSON.parse(fs.readFileSync(filename, "utf8")).navigation;
}

describe("Ribbon navigation contract", () => {
  it("builds shell and module groups from app_config without exposing context-only pages", () => {
    const tabs = buildRibbonTabs(navigationConfig());
    expect(tabs.map((tab) => tab.id)).toEqual(["system", "cad", "code"]);

    const pages = Object.fromEntries(tabs.map((tab) => [
      tab.id,
      tab.groups.flatMap((group) => group.items.map((item) => item.pageId)),
    ]));
    expect(pages.system).toEqual(["home", "config", "git", "test_fixtures", "unit_tests"]);
    expect(pages.cad).toEqual([
      "fcstd_map",
      "bom_export",
      "part_catalog",
      "file_rename",
      "xlink_fix",
      "part_dedup",
      "step_batch",
      "sw_step_export",
    ]);
    expect(pages.code).toEqual([
      "code_index",
      "code_ignore",
      "reorder_members",
      "code_rename",
      "code_uuid",
      "caa_dialog_home",
    ]);
    expect(Object.values(pages).flat()).not.toEqual(expect.arrayContaining([
      "welcome",
      "file_detail",
      "part_key_detail",
      "caa_dialog",
    ]));
  });

  it("deduplicates repeated page definitions inside a module group", () => {
    const navigation: NavItem[] = [
      { id: "one", page: "same", label: "One", module: "code", ribbonGroup: "编辑" },
      { id: "two", page: "same", label: "Two", module: "code", ribbonGroup: "编辑" },
    ];
    expect(buildRibbonTabs(navigation)[1]?.groups[0]?.items).toEqual([{ pageId: "same" }]);
  });
});
