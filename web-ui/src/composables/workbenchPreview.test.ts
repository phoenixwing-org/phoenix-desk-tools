import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../types/config";
import { createWorkbench } from "./useWorkbench";
import { registerPageSession, unregisterPageSession } from "./usePageSession";

const sessions: string[] = [];
afterEach(() => { sessions.splice(0).forEach(unregisterPageSession); });
function setup(limit = 8) {
  const onTabLimit = vi.fn();
  const wb = createWorkbench(ref({ navigation: [], workbench: { default_max_tabs: limit } } as unknown as AppConfig), { onTabLimit });
  const open = (key: string, pageId = "file_detail") => wb.openTab({ pageId, contextKey: key, title: key, preview: true, forceNew: true });
  return { wb, open, onTabLimit };
}

describe("detail preview tabs", () => {
  it("replaces a clean preview with a fresh identity in the same tab position", () => {
    const { wb, open } = setup();
    wb.openTab({ pageId: "part_catalog" });
    const old = open("examples/bracket.FCStd");
    const next = open("examples/plate.FCStd");
    expect(next).not.toBe(old);
    expect(wb.getTab(old)).toBeUndefined();
    expect(wb.tabs.value.map(t => t.pageId)).toEqual(["part_catalog", "file_detail"]);
    expect(wb.getTab(next)?.preview).toBe(true);
    expect(wb.activeTabId.value).toBe(next);
  });
  it("shares one preview slot across file and part details, not batch tools", () => {
    const { wb, open } = setup();
    const batch = wb.openTab({ pageId: "batch_attributes", preview: true });
    open("examples/a.FCStd");
    const part = open("D42.003", "part_key_detail");
    expect(wb.tabs.value.map(t => t.id)).toEqual([batch, part]);
    expect(wb.getTab(batch)?.preview).toBe(false);
  });
  it("keeps explicitly pinned, edited and subsequently saved tabs", () => {
    const { wb, open } = setup();
    const pinned = open("one"); wb.keepTab(pinned);
    const edited = open("two"); wb.setTabDirty(edited, true); wb.setTabDirty(edited, false);
    open("three");
    expect(wb.tabs.value).toHaveLength(3);
    expect(wb.getTab(pinned)?.preview).toBe(false);
    expect(wb.getTab(edited)?.preview).toBe(false);
  });
  it.each(["dirty", "busy"])("checks live session %s even before a dirty watcher runs", kind => {
    const { wb, open } = setup();
    const id = open("one");
    sessions.push(id);
    registerPageSession(id, { isDirty: () => kind === "dirty", isBusy: () => kind === "busy", serialize: () => ({}), hydrate: () => true });
    open("two");
    expect(wb.tabs.value).toHaveLength(2);
    expect(wb.getTab(id)?.preview).toBe(false);
  });
  it("reuses a matching permanent tab without changing its drafts or demoting it", () => {
    const { wb, open } = setup();
    const id = open("one"); wb.setTabDirty(id, true);
    const preview = open("two");
    expect(open("one")).toBe(id);
    expect(wb.getTab(id)).toMatchObject({ dirty: true, preview: false });
    expect(wb.getTab(preview)?.preview).toBe(true);
    expect(wb.tabs.value).toHaveLength(2);
  });
  it("can replace at capacity, but fails atomically when all target slots are fixed", () => {
    const { wb, open, onTabLimit } = setup(1);
    const id = open("one");
    expect(() => open("two")).not.toThrow();
    expect(wb.getTab(id)).toBeUndefined();
    wb.keepTab(wb.activeTabId.value);
    const elsewhere = open("D42.003", "part_key_detail");
    expect(() => open("three")).toThrow("已打开 1 / 1");
    expect(wb.getTab(elsewhere)?.preview).toBe(true);
    expect(wb.activeTabId.value).toBe(elsewhere);
    expect(onTabLimit).toHaveBeenCalledOnce();
  });
  it("explicit new view keeps its own tab and does not reuse a preview", () => {
    const { wb, open } = setup();
    const preview = open("one");
    const fixed = wb.openNewTabForPage("file_detail");
    open("two");
    expect(wb.getTab(preview)).toBeUndefined();
    expect(wb.getTab(fixed)?.preview).toBe(false);
  });
  it("restores older saved tabs conservatively without dropping an unhydrated draft", () => {
    const { wb, open } = setup();
    wb.restoreSession({ version: 1, activeTabId: "saved", tabs: [{ id: "saved", pageId: "file_detail", title: "Saved", contextKey: "one", pageState: { draft: "unsaved" } }] });
    open("two");
    expect(wb.getTab("saved")?.pageState).toEqual({ draft: "unsaved" });
    expect(wb.exportSession({}).tabs.find(t => t.id === "saved")?.pageState).toEqual({ draft: "unsaved" });
  });
});
