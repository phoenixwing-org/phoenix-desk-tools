import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ribbonFixture from "phoenix-wing/fixtures/ribbon-contribution-v1.json";
import { pnwCheckRibbonContributionCompatibility } from "phoenix-wing";
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
    expect(tabs.map((tab) => tab.id)).toEqual(["system", "cad", "code"]);

    const pages = Object.fromEntries(tabs.map((tab) => [
      tab.id,
      tab.groups.flatMap((group) => group.items.map((item) => item.pageId)),
    ]));
    expect(pages.system).toEqual([
      "home",
      "audio_extract",
      "config",
      "git",
      "test_fixtures",
      "unit_tests",
    ]);
    expect(pages.cad).toEqual([
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
      "kt_codegen",
      "caa_dialog_home",
    ]);
    expect(
      tabs.find((tab) => tab.id === "code")
        ?.groups.flatMap((group) => group.items)
        .find((item) => item.pageId === "kt_codegen")?.label,
    ).toBe("自动代码");
    expect(Object.values(pages).flat()).not.toEqual(expect.arrayContaining([
      "welcome",
      "file_detail",
      "part_key_detail",
      "caa_dialog",
    ]));
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
