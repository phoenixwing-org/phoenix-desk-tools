import { computed, effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CadIndexDiagnostics } from "../../api";
import * as api from "./api";
import { cadIndexSearchRefreshToken } from "./diagnosticRevision";
import { useCadIndexSearch } from "./useCadIndexSearch";

vi.mock("./api", () => ({ fetchCadIndexSearch: vi.fn() }));
const at = "2026-01-01T00:00:00.000Z";
const ready: CadIndexDiagnostics = { state: "ready", message: "Synthetic readable index", schemaVersion: 13,
  expectedSchemaVersion: 13, totalEntries: 1, missingEntries: 0, lastScanAt: at,
  latestScan: { id: 11, status: "done", root: "workspace", at }, scanSupported: true };
const searchResult: api.CadIndexSearchResult = { source: "sqlite", query: "", rows: [], limit: 200,
  limitReached: false, diagnostics: ready };
const scopes: EffectScope[] = [];
function setup(initial: CadIndexDiagnostics | null = ready) {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/synthetic-workspace"), diagnostics = ref<CadIndexDiagnostics | null>(initial);
  const token = computed(() => cadIndexSearchRefreshToken(diagnostics.value));
  return { diagnostics, token, state: scope.run(() => useCadIndexSearch(workspace, token))! };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.fetchCadIndexSearch).mockResolvedValue(searchResult); });
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });

it("preserves completed search through initial diagnostics and same-revision page refresh loading", async () => {
  const { diagnostics, state } = setup(null);
  await state.search();
  diagnostics.value = ready;
  expect(state.result.value).toEqual(searchResult);
  diagnostics.value = null;
  diagnostics.value = { ...ready, message: "Updated presentation only" };
  expect(state.result.value).toEqual(searchResult);
  expect(state.canOpenResults.value).toBe(true);
});

it("invalidates a displayed result when actual stale diagnostics keep the last successful scan time", async () => {
  const { diagnostics, state } = setup();
  await state.search();
  diagnostics.value = null;
  expect(state.result.value).toEqual(searchResult);
  diagnostics.value = { ...ready, state: "attention", latestScan: { ...ready.latestScan!, id: 12, status: "stale" } };
  expect(diagnostics.value.lastScanAt).toBe(ready.lastScanAt);
  expect(state.result.value).toBeNull();
  expect(state.canOpenResults.value).toBe(false);
});

it.each([
  ["complete scan", { ...ready, latestScan: { ...ready.latestScan!, id: 12 } }],
  ["explicit reset", { ...ready, state: "empty", totalEntries: 0, lastScanAt: "", latestScan: { ...ready.latestScan!, id: 12, status: "cleared" } }],
] as const)("ignores a late search after a %s revision even when its timestamp is unchanged", async (_operation, next) => {
  let finish!: (result: api.CadIndexSearchResult) => void;
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { diagnostics, state } = setup();
  const pending = state.search();
  diagnostics.value = null;
  expect(state.busy.value).toBe(true);
  diagnostics.value = next;
  expect(next.latestScan.at).toBe(ready.latestScan!.at);
  expect(state.busy.value).toBe(false);
  finish(searchResult); await pending;
  expect(state.result.value).toBeNull();
});

it("detects confirmed schema/read-state changes without a successful scan timestamp", async () => {
  const { diagnostics, state } = setup();
  await state.search();
  diagnostics.value = { ...ready, state: "incompatible", schemaVersion: 12, latestScan: null };
  expect(state.result.value).toBeNull();
  expect(cadIndexSearchRefreshToken({ ...ready, state: "unreadable", latestScan: null }))
    .not.toBe(cadIndexSearchRefreshToken(ready));
});

it("uses stable optional-ID legacy metadata and excludes display messages from the revision", () => {
  const legacy = { ...ready, latestScan: { status: "done", root: "workspace", at } };
  expect(cadIndexSearchRefreshToken(legacy)).toBe(cadIndexSearchRefreshToken({ ...legacy, message: "Other words" }));
  expect(cadIndexSearchRefreshToken({ ...legacy, latestScan: { ...legacy.latestScan, status: "stale" } }))
    .not.toBe(cadIndexSearchRefreshToken(legacy));
  expect(cadIndexSearchRefreshToken(null)).toBeUndefined();
});
