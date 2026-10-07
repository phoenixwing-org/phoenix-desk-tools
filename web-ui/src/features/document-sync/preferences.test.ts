import { createPinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDocumentSyncPreferencesStore } from "./preferences";
import type { SyncOptions, SyncPreview, SyncRow } from "./api";

const options: SyncOptions = { log_ids: [71], roots: ["/docs"], filenames: true, contents: true, include_stem: false };
const row = (id: string, overrides: Partial<SyncRow> = {}): SyncRow => ({ id, root: "/docs", rel: "Old.md", target: "New.md", occurrences: 1, binary: false, eligible: true, message: "ready", diffs: [{ line: 1, before: "Old", after: "New" }], truncated: false, ...overrides });
const plan = (rows: SyncRow[], overrides: Partial<SyncPreview> = {}): SyncPreview => ({ plan_id: "transient-plan", expires_at: "", roots: ["/docs"], mappings: [{ old: "Old", target: "New", chain: ["Old", "New"] }], conflicts: [], rows, scanned: rows.length, skipped: 0, warnings: [], ...overrides });

let saved: string | null;
beforeEach(() => {
  saved = null;
  vi.stubGlobal("localStorage", { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
});
afterEach(() => vi.unstubAllGlobals());
it("restores workspace settings and history selection but never executable plans or results", () => {
  const store = useDocumentSyncPreferencesStore(createPinia());
  const options = { roots: ["/fixture-docs", "/fixture-parts"], filenames: false, contents: false, include_stem: true, log_ids: [71], plan_id: "obsolete", results: ["done"] };
  store.saveOptions("/fixture", options);
  options.roots.push("/not-saved");
  const restored = useDocumentSyncPreferencesStore(createPinia());
  expect(restored.optionsFor("/fixture")).toEqual({ roots: ["/fixture-docs", "/fixture-parts"], filenames: false, contents: false, include_stem: true, log_ids: [71] });
  for (const key of ["plan_id", "results"]) expect(saved).not.toContain(key);
  const copy = restored.optionsFor("/fixture"); copy.roots.length = 0;
  expect(restored.optionsFor("/fixture").roots).toHaveLength(2);
});
it("isolates workspaces, remembers directory removal, and bounds the cache", () => {
  const store = useDocumentSyncPreferencesStore(createPinia());
  store.saveOptions("/first", { roots: ["/docs"], filenames: true, contents: false, include_stem: true, log_ids: [71] });
  expect(store.optionsFor("/second")).toEqual({ roots: [], filenames: true, contents: true, include_stem: false, log_ids: [] });
  store.saveOptions("/first", { ...store.optionsFor("/first"), roots: [] });
  expect(useDocumentSyncPreferencesStore(createPinia()).optionsFor("/first").roots).toEqual([]);
  for (let i = 0; i < 24; i++) store.saveOptions(`/fixture-${i}`, store.optionsFor(""));
  expect(store.workspaces).toHaveLength(20);
});
it("validates persisted data and tolerates unavailable storage", () => {
  saved = "broken"; expect(useDocumentSyncPreferencesStore(createPinia()).workspaces).toEqual([]);
  saved = JSON.stringify([null, { workspace: "/fixture", options: { roots: ["/docs", "/docs", null, 17, "", " /parts "], filenames: "false", include_stem: true, log_ids: [8, 8, -1, 0, "4", null, 0.3] }, fileSelection: { scope: 7, files: [] } }]);
  const loaded = useDocumentSyncPreferencesStore(createPinia());
  expect(loaded.optionsFor("/fixture")).toEqual({ roots: ["/docs", "/parts"], filenames: true, contents: true, include_stem: true, log_ids: [8] });
  expect(loaded.workspaces[0]?.fileSelection).toBeUndefined();
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("disabled"); }, setItem: () => { throw Error("disabled"); } });
  const store = useDocumentSyncPreferencesStore(createPinia());
  expect(() => store.saveOptions("/fixture", options)).not.toThrow();
  expect(store.optionsFor("/fixture").roots).toEqual(["/docs"]);
});
it("restores stable file identities with fresh row IDs, not stale plans, diffs or duplicate basenames", () => {
  const store = useDocumentSyncPreferencesStore(createPinia());
  store.saveFileSelection("/fixture", options, plan([row("old-id"), row("blocked", { eligible: false })]), ["old-id", "blocked"]);
  const restored = useDocumentSyncPreferencesStore(createPinia());
  const fresh = plan([row("fresh-id"), row("another-root", { root: "/elsewhere" }), row("another-path", { rel: "sub/Old.md" })]);
  expect(restored.restoreFileSelection("/fixture", options, fresh)).toEqual(["fresh-id"]);
  expect(restored.restoreFileSelection("/other-workspace", options, fresh)).toEqual([]);
  for (const key of ["plan_id", "transient-plan", "old-id", "diffs", "before", "results"]) expect(saved).not.toContain(key);
  restored.saveOptions("/fixture", options);
  expect(restored.restoreFileSelection("/fixture", options, fresh)).toEqual(["fresh-id"]);
});
it("restores only eligible matching targets in an unchanged replacement scope", () => {
  const store = useDocumentSyncPreferencesStore(createPinia());
  store.saveFileSelection("/fixture", options, plan([row("chosen")]), ["chosen"]);
  expect(store.restoreFileSelection("/fixture", options, plan([row("new", { eligible: false })]))).toEqual([]);
  expect(store.restoreFileSelection("/fixture", options, plan([row("new", { target: "Else.md" })]))).toEqual([]);
  for (const changed of [{ ...options, include_stem: true }, { ...options, filenames: false }, { ...options, contents: false }, { ...options, log_ids: [72] }]) {
    expect(store.restoreFileSelection("/fixture", changed, plan([row("new")]))).toEqual([]);
  }
  expect(store.restoreFileSelection("/fixture", options, plan([row("new")], { roots: ["/different"] }))).toEqual([]);
  expect(store.restoreFileSelection("/fixture", options, plan([row("new")], { mappings: [{ old: "Old", target: "Else", chain: [] }] }))).toEqual([]);
  expect(store.restoreFileSelection("/fixture", options, plan([row("new")], { conflicts: ["ambiguous mapping"] }))).toEqual([]);
});
it("persists explicit deselection and treats equivalent directory and record order as the same scope", () => {
  const store = useDocumentSyncPreferencesStore(createPinia());
  const original = { ...options, log_ids: [71, 72] };
  store.saveFileSelection("/fixture", original, plan([row("chosen")], { roots: ["/docs", "/parts"] }), ["chosen"]);
  const fresh = plan([row("fresh")], { roots: ["/parts", "/docs"] });
  expect(store.restoreFileSelection("/fixture", { ...options, log_ids: [72, 71] }, fresh)).toEqual(["fresh"]);
  store.saveFileSelection("/fixture", original, fresh, []);
  expect(useDocumentSyncPreferencesStore(createPinia()).restoreFileSelection("/fixture", original, fresh)).toEqual([]);
});
