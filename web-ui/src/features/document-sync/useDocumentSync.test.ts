import { effectScope, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ loadSyncHistory: vi.fn() }));
import { loadSyncHistory } from "./api";
import { useDocumentSync } from "./useDocumentSync";
import { useDocumentSyncPreferencesStore } from "./preferences";
const history = { entries: [{ id: 1, old_repo_rel_path: "Old.md", new_repo_rel_path: "New.md", old_filename: "Old.md", new_filename: "New.md", old_basename: "Old", new_basename: "New", created_at: "" }], total: 1 };
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  setActivePinia(createPinia()); vi.mocked(loadSyncHistory).mockResolvedValue(history);
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("loads history only and preserves prior directories/options for handoff", async () => {
  useDocumentSyncPreferencesStore().saveOptions("/sample", { log_ids: [1, 99], roots: ["/docs"], filenames: false, contents: true, include_stem: true });
  const scope = effectScope(); const sync = scope.run(() => useDocumentSync(ref("/sample"), vi.fn()))!;
  await nextTick();
  expect(sync.options.value).toEqual({ log_ids: [1], roots: ["/docs"], filenames: false, contents: true, include_stem: true });
  expect(sync).not.toHaveProperty("applySelected"); expect(sync).not.toHaveProperty("searchPreview");
  scope.stop();
});
it("ignores a late history response after workspace change", async () => {
  let finish!: (value: typeof history) => void;
  vi.mocked(loadSyncHistory).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const scope = effectScope(), workspace = ref("/first"); const sync = scope.run(() => useDocumentSync(workspace, vi.fn()))!;
  vi.mocked(loadSyncHistory).mockResolvedValue({ entries: [], total: 0 }); workspace.value = "/second";
  await nextTick(); finish(history); await nextTick();
  expect(sync.logs.value).toEqual([]); expect(sync.options.value.log_ids).toEqual([]); expect(sync.busy.value).toBe(false);
  scope.stop();
});
it("reports read errors and permits retry without losing saved scope", async () => {
  const report = vi.fn(), scope = effectScope(); const sync = scope.run(() => useDocumentSync(ref("/sample"), report))!;
  await nextTick(); sync.options.value.roots = ["/docs"];
  vi.mocked(loadSyncHistory).mockRejectedValueOnce(new Error("read failed")); await sync.refreshHistory();
  expect(report).toHaveBeenCalledWith("read failed", true); expect(sync.options.value.roots).toEqual(["/docs"]);
  await sync.refreshHistory(); expect(sync.error.value).toBe(""); expect(sync.logs.value).toEqual(history.entries);
  scope.stop();
});
