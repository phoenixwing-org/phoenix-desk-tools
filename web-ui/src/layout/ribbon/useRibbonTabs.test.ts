import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import type { NavItem } from "../../types/config";
import type { ModuleScope } from "../../constants/moduleScope";
import { WORKBENCH_IDLE_PAGE } from "../../constants/workbench";
import { useRibbonTabs } from "./useRibbonTabs";

const scopes: EffectScope[] = [];
afterEach(() => { scopes.splice(0).forEach((scope) => scope.stop()); });

function setup(page: string, enabled: string[] = ["cad", "code"], focus: ModuleScope = "all") {
  const scope = effectScope();
  scopes.push(scope);
  const navigation = ref<NavItem[]>(JSON.parse(fs.readFileSync(
    new URL("../../../../phoenix/config/app_config.json", import.meta.url), "utf8",
  )).navigation);
  const currentPage = ref(page);
  const enabledModules = ref(enabled);
  const workbenchFocusScope = ref(focus);
  const ribbon = scope.run(() => useRibbonTabs({ navigation, currentPage, enabledModules, workbenchFocusScope }))!;
  return { ...ribbon, navigation, currentPage, enabledModules, workbenchFocusScope };
}

describe("tools Ribbon presentation", () => {
  it.each(["code_ignore", "caa_dialog_home", "caa_dialog", "audio_extract"])(
    "selects tools for %s in a code-only workspace", (page) => {
      const ribbon = setup(page, ["code"]);
      expect(ribbon.visibleTabs.value.map((tab) => tab.id)).toEqual(["system", "cad"]);
      expect(ribbon.activeTab.value).toBe("cad");
      expect(ribbon.activeTabDef.value?.label).toBe("工具");
    },
  );

  it.each(["cad_index", "part_catalog", "bom_delivery", "file_detail", "part_key_detail"])(
    "keeps existing CAD page %s in tools", (page) => {
      expect(setup(page, ["cad"]).activeTab.value).toBe("cad");
    },
  );

  it.each(["home", "config", "git", "unit_tests", "test_fixtures"])(
    "keeps %s in system", (page) => {
      expect(setup(page).activeTab.value).toBe("system");
    },
  );

  it("switches between system and shared audio tools without changing module preferences", async () => {
    const ribbon = setup("home", []);
    ribbon.currentPage.value = "audio_extract";
    await nextTick();
    expect(ribbon.activeTab.value).toBe("cad");
    expect(ribbon.activeTabDef.value?.groups.flatMap((group) => group.items.map((item) => item.pageId))).toEqual(["rename_tasks", "audio_extract"]);
    expect(ribbon.enabledModules.value).toEqual([]);
    ribbon.currentPage.value = "git";
    await nextTick();
    expect(ribbon.activeTab.value).toBe("system");
  });

  it("maps idle CAD and Code scope to one tools tab while retaining the stored scope", async () => {
    const ribbon = setup(WORKBENCH_IDLE_PAGE, ["code"], "code");
    expect(ribbon.activeTab.value).toBe("cad");
    expect(ribbon.workbenchFocusScope.value).toBe("code");
    ribbon.enabledModules.value = ["cad"];
    ribbon.workbenchFocusScope.value = "cad";
    await nextTick();
    expect(ribbon.activeTab.value).toBe("cad");
    expect(ribbon.workbenchFocusScope.value).toBe("cad");
    expect(ribbon.activeTabDef.value?.groups.flatMap((group) => group.items.map((item) => item.pageId))).not.toContain("caa_dialog_home");
  });
});
