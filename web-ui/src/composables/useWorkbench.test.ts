import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { AppConfig } from "../types/config";
import { createWorkbench } from "./useWorkbench";
import { registerPageSession, unregisterPageSession } from "./usePageSession";

const appConfig = ref<AppConfig | null>({
  title: "Desk",
  navigation: [{ id: "part_catalog", label: "零件目录", page: "part_catalog" }],
  toolbar: { items: [] },
  workspace_dotfile: ".phoenix-workspace",
  launcher_config_path: "",
  workbench: { pages: { part_catalog: { max_tabs: 1 } } },
});

describe("page-owned close flow compatibility", () => {
  const sessions: string[] = [];
  afterEach(() => { sessions.splice(0).forEach(unregisterPageSession); vi.unstubAllGlobals(); });

  it("uses the page close handler without invoking a second generic prompt or flush", async () => {
    const workbench = createWorkbench(appConfig), id = workbench.openTab({ pageId: "batch_tasks" });
    const confirm = vi.fn(), flush = vi.fn(async () => true), requestClose = vi.fn(async () => false);
    sessions.push(id); vi.stubGlobal("window", { confirm });
    registerPageSession(id, { isDirty: () => true, serialize: () => ({}), hydrate: () => true, flush, requestClose });
    expect(await workbench.closeTab(id)).toBe(false); expect(workbench.getTab(id)).toBeDefined();
    requestClose.mockResolvedValueOnce(true);
    expect(await workbench.closeTab(id)).toBe(true);
    expect(confirm).not.toHaveBeenCalled(); expect(flush).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves legacy editor save-before-close semantics when flush returns %s", async saved => {
    const workbench = createWorkbench(appConfig), id = workbench.openTab({ pageId: "file_detail" });
    const confirm = vi.fn(() => true), flush = vi.fn(async () => saved);
    sessions.push(id); vi.stubGlobal("window", { confirm });
    registerPageSession(id, { isDirty: () => true, serialize: () => ({}), hydrate: () => true, flush });
    expect(await workbench.closeTab(id)).toBe(saved);
    expect(flush).toHaveBeenCalledOnce(); expect(confirm).toHaveBeenCalledOnce();
    expect(Boolean(workbench.getTab(id))).toBe(!saved);
  });

  it("rechecks the requested tab identity after another tab closes during its modal", async () => {
    const workbench = createWorkbench(appConfig);
    const first = workbench.openTab({ pageId: "first" }), target = workbench.openTab({ pageId: "batch_tasks" }), last = workbench.openTab({ pageId: "last" });
    let resolve!: (close: boolean) => void;
    sessions.push(target);
    registerPageSession(target, { isDirty: () => true, serialize: () => ({}), hydrate: () => true,
      requestClose: () => new Promise<boolean>(done => { resolve = done; }) });
    const closing = workbench.closeTab(target);
    expect(await workbench.closeTab(first)).toBe(true); resolve(true);
    expect(await closing).toBe(true); expect(workbench.tabs.value.map(tab => tab.id)).toEqual([last]);
  });

  it("does not close a different editor registered while a close prompt was pending", async () => {
    const workbench = createWorkbench(appConfig), id = workbench.openTab({ pageId: "batch_tasks" });
    let resolve!: (close: boolean) => void;
    sessions.push(id);
    registerPageSession(id, { isDirty: () => true, serialize: () => ({}), hydrate: () => true,
      requestClose: () => new Promise<boolean>(done => { resolve = done; }) });
    const closing = workbench.closeTab(id);
    registerPageSession(id, { isDirty: () => true, serialize: () => ({}), hydrate: () => true });
    resolve(true); expect(await closing).toBe(false); expect(workbench.getTab(id)).toBeDefined();
  });
});

describe("file detail view capacity", () => {
  function configuredWorkbench(onTabLimit = vi.fn()) {
    const config = JSON.parse(readFileSync(new URL("../../../phoenix/config/app_config.json", import.meta.url), "utf8")) as AppConfig;
    return { workbench: createWorkbench(ref(config), { onTabLimit }), onTabLimit };
  }

  it("allows 32 file views and visibly reports overflow without changing open drafts", () => {
    const { workbench, onTabLimit } = configuredWorkbench();
    expect(workbench.pagePolicy("file_detail").maxTabs).toBe(32);
    for (let i = 0; i < 32; i++) {
      const id = workbench.openTab({ pageId: "file_detail", contextKey: `demo/${i}.FCStd`, forceNew: true });
      workbench.setTabDirty(id, true);
    }
    const active = workbench.activeTabId.value;
    expect(() => workbench.openTab({ pageId: "file_detail", forceNew: true }))
      .toThrow("已打开 32 / 32 个视图");
    expect(onTabLimit).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("请先关闭部分视图后重试"));
    expect(workbench.tabs.value).toHaveLength(32);
    expect(workbench.tabs.value.every(tab => tab.dirty)).toBe(true);
    expect(workbench.activeTabId.value).toBe(active);
    workbench.activateTab(workbench.tabs.value[0].id);
    expect(workbench.activeTabId.value).toBe(workbench.tabs.value[0].id);
    expect(onTabLimit).toHaveBeenCalledTimes(1);
  });

  it("allows another file after a clean view is closed, without warning", async () => {
    const { workbench, onTabLimit } = configuredWorkbench();
    for (let i = 0; i < 32; i++) workbench.openTab({ pageId: "file_detail", forceNew: true });
    await workbench.closeTab(workbench.tabs.value[0].id);
    expect(() => workbench.openTab({ pageId: "file_detail", forceNew: true })).not.toThrow();
    expect(workbench.tabs.value).toHaveLength(32);
    expect(onTabLimit).not.toHaveBeenCalled();
  });
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
