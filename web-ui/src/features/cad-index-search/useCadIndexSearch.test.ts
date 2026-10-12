import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { useCadIndexSearch } from "./useCadIndexSearch";
import { ApiError } from "../../api";

vi.mock("./api", () => ({ fetchCadIndexSearch: vi.fn() }));
const scopes: EffectScope[] = [];
const empty: api.CadIndexSearchResult = { source: "sqlite", query: "", rows: [], limit: 200, limitReached: false,
  diagnostics: { state: "ready", message: "readable", schemaVersion: 13, expectedSchemaVersion: 13, totalEntries: 1, missingEntries: 0, lastScanAt: "2026-01-01", latestScan: null, scanSupported: true } };
function setup(initialWorkspace = "/synthetic-workspace", initialRevision?: string) {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref(initialWorkspace);
  const refreshToken = ref<string | undefined>(initialRevision);
  return { scope, workspace, refreshToken, state: scope.run(() => useCadIndexSearch(workspace, refreshToken))! };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.fetchCadIndexSearch).mockResolvedValue(empty); });
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });

it("runs one six-field search request on submit, preserving the complete term and wildcard characters", async () => {
  const { state } = setup(); expect(api.fetchCadIndexSearch).not.toHaveBeenCalled();
  state.query.value = "alpha beta_%"; await state.search();
  expect(api.fetchCadIndexSearch).toHaveBeenCalledExactlyOnceWith("/synthetic-workspace", "alpha beta_%");
  expect(state.result.value).toEqual(empty); expect(state.busy.value).toBe(false);
});
it("clears old results synchronously on workspace change and rejects late old-workspace success", async () => {
  let finish!: (result: api.CadIndexSearchResult) => void;
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { state, workspace } = setup(); state.query.value = "old";
  const pending = state.search(); workspace.value = "/another-synthetic-workspace";
  expect(state.query.value).toBe(""); expect(state.busy.value).toBe(false); expect(state.result.value).toBeNull();
  finish({ ...empty, query: "old" }); await pending;
  expect(state.result.value).toBeNull(); expect(state.canOpenResults.value).toBe(false);
});
it("rejects late errors when workspace or query changes", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const { state } = setup(); const pending = state.search(); state.query.value = "new";
  fail(new Error("old missing index")); await pending;
  expect(state.error.value).toBe(""); expect(state.busy.value).toBe(false);
});
it("keeps only the newest submitted query when requests complete out of order", async () => {
  let finish!: (result: api.CadIndexSearchResult) => void;
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { state } = setup(); const old = state.search();
  state.query.value = "recent"; vi.mocked(api.fetchCadIndexSearch).mockResolvedValue({ ...empty, query: "recent" });
  await state.search(); finish({ ...empty, query: "old" }); await old;
  expect(state.result.value?.query).toBe("recent"); expect(state.canOpenResults.value).toBe(true);
});
it("shows index errors without empty-success results or retry/scanning side effects", async () => {
  vi.mocked(api.fetchCadIndexSearch).mockRejectedValue(new Error("Schema 不兼容，不自动升级数据库"));
  const { state } = setup(); await state.search();
  expect(state.error.value).toContain("Schema 不兼容"); expect(state.result.value).toBeNull();
  expect(state.canOpenResults.value).toBe(false); expect(api.fetchCadIndexSearch).toHaveBeenCalledTimes(1);
});
it("preserves the failure code for distinct missing-index and incompatible-index recovery actions", async () => {
  const { state } = setup();
  vi.mocked(api.fetchCadIndexSearch).mockRejectedValueOnce(new ApiError("no index", 409, { code: "index_missing" }));
  await state.search(); expect(state.errorCode.value).toBe("index_missing");
  state.query.value = "another"; expect(state.errorCode.value).toBe("");
  vi.mocked(api.fetchCadIndexSearch).mockRejectedValueOnce(new ApiError("schema mismatch", 409, { code: "schema_incompatible" }));
  await state.search(); expect(state.errorCode.value).toBe("schema_incompatible");
});
it("accepts empty queries and prevents calls without a workspace", async () => {
  const { state, workspace } = setup(""); await state.search();
  expect(api.fetchCadIndexSearch).not.toHaveBeenCalled(); expect(state.error.value).toContain("工作空间");
  workspace.value = "/synthetic-workspace"; await state.search();
  expect(api.fetchCadIndexSearch).toHaveBeenCalledExactlyOnceWith("/synthetic-workspace", "");
  expect(state.result.value?.rows).toEqual([]);
});
it("does not refill disposed pages", async () => {
  let finish!: (result: api.CadIndexSearchResult) => void;
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { state, scope } = setup(); const pending = state.search(); scope.stop();
  finish(empty); await pending; await state.search();
  expect(state.result.value).toBeNull(); expect(state.busy.value).toBe(false); expect(api.fetchCadIndexSearch).toHaveBeenCalledTimes(1);
});

it("keeps a completed search when the first diagnostics arrive late", async () => {
  const { state, refreshToken } = setup(); state.query.value = "saved"; await state.search();
  refreshToken.value = "2026-01-01";
  expect(state.result.value).toEqual(empty); expect(state.query.value).toBe("saved"); expect(state.canOpenResults.value).toBe(true);
});

it("does not discard a pending search when the first diagnostics establish the revision", async () => {
  let finish!: (result: api.CadIndexSearchResult) => void;
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { state, refreshToken } = setup(); const pending = state.search();
  refreshToken.value = "2026-01-01"; expect(state.busy.value).toBe(true);
  finish(empty); await pending; expect(state.result.value).toEqual(empty); expect(state.busy.value).toBe(false);
});

it("preserves results and errors across diagnostic loading and unchanged scan revisions", async () => {
  const { state, refreshToken } = setup("/synthetic-workspace", "2026-01-01"); await state.search();
  refreshToken.value = undefined; refreshToken.value = "2026-01-01";
  expect(state.result.value).toEqual(empty); expect(state.canOpenResults.value).toBe(true);
  vi.mocked(api.fetchCadIndexSearch).mockRejectedValueOnce(new Error("synthetic index failure")); await state.search();
  refreshToken.value = undefined; refreshToken.value = "2026-01-01";
  expect(state.error.value).toBe("synthetic index failure");
});

it("invalidates only when a confirmed scan revision changes and rejects its late search response", async () => {
  let finish!: (result: api.CadIndexSearchResult) => void;
  const { state, refreshToken } = setup("/synthetic-workspace", "2026-01-01"); await state.search();
  refreshToken.value = undefined; refreshToken.value = "2026-01-02";
  expect(state.result.value).toBeNull(); expect(state.canOpenResults.value).toBe(false);
  vi.mocked(api.fetchCadIndexSearch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = state.search(); refreshToken.value = undefined; refreshToken.value = "2026-01-03";
  expect(state.busy.value).toBe(false); finish(empty); await pending; expect(state.result.value).toBeNull();
});

it("resets the revision baseline when the workspace changes", async () => {
  const { state, workspace, refreshToken } = setup("/synthetic-workspace", "2026-01-01");
  workspace.value = "/another-synthetic-workspace"; refreshToken.value = undefined; await state.search();
  refreshToken.value = "2026-02-01"; expect(state.result.value).toEqual(empty);
  refreshToken.value = "2026-02-02"; expect(state.result.value).toBeNull();
});
