import { ref } from "vue";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../types/config";
import { createWorkbench } from "./useWorkbench";

const appConfig = ref<AppConfig | null>({
  title: "Desk",
  navigation: [{ id: "part_catalog", label: "零件目录", page: "part_catalog" }],
  toolbar: { items: [] },
  workspace_dotfile: ".phoenix-workspace",
  launcher_config_path: "",
  workbench: { pages: { part_catalog: { max_tabs: 1 } } },
});

describe("useWorkbench CAD page retirement migration", () => {
  it("maps retired CAD tabs to one current part catalog tab", () => {
    const workbench = createWorkbench(appConfig);

    expect(workbench.restoreSession({
      version: 1,
      activeTabId: "old-bom",
      tabs: [
        { id: "old-index", pageId: "fcstd_map", title: "CAD 索引", pageState: { q: "A" } },
        { id: "old-bom", pageId: "bom_export", title: "BOM 列表", pageState: { q: "B" } },
      ],
    })).toBe(true);

    expect(workbench.tabs.value).toHaveLength(1);
    expect(workbench.tabs.value[0]).toMatchObject({
      id: "old-index",
      pageId: "part_catalog",
      title: "零件目录",
      pageState: undefined,
    });
    expect(workbench.activeTabId.value).toBe("old-index");
  });

  it("keeps an existing current tab instead of a retired duplicate", () => {
    const workbench = createWorkbench(appConfig);

    expect(workbench.restoreSession({
      version: 1,
      activeTabId: "current",
      tabs: [
        { id: "old-index", pageId: "fcstd_map", title: "CAD 索引" },
        { id: "current", pageId: "part_catalog", title: "我的零件目录", pageState: { q: "A" } },
      ],
    })).toBe(true);

    expect(workbench.tabs.value).toEqual([
      expect.objectContaining({ id: "current", pageId: "part_catalog", title: "我的零件目录", pageState: { q: "A" } }),
    ]);
    expect(workbench.activeTabId.value).toBe("current");
  });
});
