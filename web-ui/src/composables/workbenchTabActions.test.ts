import { describe, expect, it, vi } from "vitest";
import type { PnwWorkbenchTabAction } from "phoenix-wing";
import type { WorkbenchTab } from "../types/workbench";
import type { PageSessionApi } from "./usePageSession";
import { createWorkbenchTabActions } from "./workbenchTabActions";

function fixture() {
  let tabs: WorkbenchTab[] = ["a", "b", "c"].map(id => ({
    id, pageId: "file_detail", title: `Example ${id}`, dirty: false, payloadConsumed: true,
  }));
  const sessions = new Map<string, PageSessionApi>(tabs.map(tab => [tab.id, {
    serialize: () => ({}), hydrate: () => true, isDirty: () => false,
    isBusy: () => false, refresh: vi.fn(async () => true),
  }]));
  const close = vi.fn(async (id: string) => {
    tabs = tabs.filter(tab => tab.id !== id);
    return true;
  });
  const confirmRefresh = vi.fn(async () => true);
  const status = vi.fn();
  const actions = createWorkbenchTabActions({
    tabs: () => tabs, session: id => sessions.get(id), close, confirmRefresh, status,
  });
  return { actions, tabs: () => tabs, sessions, close, confirmRefresh, status };
}

describe("Wing tab actions in the Desk host", () => {
  it.each<[PnwWorkbenchTabAction, string[]]>([
    ["close", ["b"]], ["close-others", ["a", "c"]],
    ["close-right", ["c"]], ["close-all", ["a", "b", "c"]],
  ])("%s uses the requested tab and the published Wing target ordering", async (action, expected) => {
    const f = fixture();
    expect(await f.actions.run({ action, tabId: "b" })).toBe(true);
    expect(f.close.mock.calls.map(([id]) => id)).toEqual(expected);
  });

  it("refreshes only the explicit target, never another active page", async () => {
    const f = fixture();
    expect(await f.actions.run({ action: "refresh", tabId: "b" })).toBe(true);
    expect(f.sessions.get("b")!.refresh).toHaveBeenCalledOnce();
    expect(f.sessions.get("a")!.refresh).not.toHaveBeenCalled();
    expect(f.close).not.toHaveBeenCalled();
  });

  it("preserves dirty data when refresh confirmation is cancelled", async () => {
    const f = fixture();
    f.tabs()[1].dirty = true;
    f.confirmRefresh.mockResolvedValue(false);
    expect(await f.actions.run({ action: "refresh", tabId: "b" })).toBe(false);
    expect(f.confirmRefresh).toHaveBeenCalledWith("Example b");
    expect(f.sessions.get("b")!.refresh).not.toHaveBeenCalled();
    expect(f.tabs()[1].dirty).toBe(true);
  });

  it("rechecks busy state after the dirty refresh prompt", async () => {
    const f = fixture();
    f.tabs()[1].dirty = true;
    f.confirmRefresh.mockImplementation(async () => {
      f.sessions.get("b")!.isBusy = () => true;
      return true;
    });
    expect(await f.actions.run({ action: "refresh", tabId: "b" })).toBe(false);
    expect(f.sessions.get("b")!.refresh).not.toHaveBeenCalled();
  });

  it("rejects a removed or newly busy target at execution time", async () => {
    const f = fixture();
    expect(f.actions.disabled({ action: "close", tabId: "b" })).toBe(false);
    f.sessions.get("b")!.isBusy = () => true;
    expect(await f.actions.run({ action: "close", tabId: "b" })).toBe(false);
    expect(await f.actions.run({ action: "close-all", tabId: "missing" })).toBe(false);
    expect(f.close).not.toHaveBeenCalled();
  });

  it("stops a batch when the host refuses a close, keeping remaining pages", async () => {
    const f = fixture();
    f.close.mockResolvedValue(false);
    expect(await f.actions.run({ action: "close-all", tabId: "b" })).toBe(false);
    expect(f.close.mock.calls.map(([id]) => id)).toEqual(["a"]);
    expect(f.tabs().map(tab => tab.id)).toEqual(["a", "b", "c"]);
  });

  it("does not extend an in-flight batch to a newly opened tab", async () => {
    const f = fixture();
    const close = f.close.getMockImplementation()!;
    f.close.mockImplementation(async id => {
      if (id === "a") f.tabs().push({
        id: "new", pageId: "file_detail", title: "New", dirty: false, payloadConsumed: true,
      });
      return close(id);
    });
    expect(await f.actions.run({ action: "close-all", tabId: "b" })).toBe(true);
    expect(f.tabs().map(tab => tab.id)).toEqual(["new"]);
  });

  it("reports host failures and releases the pending guard", async () => {
    const f = fixture();
    f.close.mockRejectedValue(new Error("close refused"));
    expect(await f.actions.run({ action: "close", tabId: "b" })).toBe(false);
    expect(f.status).toHaveBeenCalledWith(expect.stringContaining("close refused"));
    expect(f.actions.pending.value).toBe(false);
  });
});
