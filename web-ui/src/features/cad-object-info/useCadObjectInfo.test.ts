import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import * as api from "./api";
import { useCadObjectInfo } from "./useCadObjectInfo";
import type { CadObjectInfoResult } from "./types";
vi.mock("./api", () => ({ fetchCadObjectInfo: vi.fn() }));
const scopes: EffectScope[] = [];
const empty: CadObjectInfoResult = { document: { objects: [], xlinks: [], root_names: [] }, source: { file_size: 100, mtime_ms: 1, document_xml_bytes: 11 }, warnings: [] };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup(enabled = true) {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/synthetic-workspace"), file = ref("parts/document.FCStd"), active = ref(enabled);
  return { scope, workspace, file, active, state: scope.run(() => useCadObjectInfo(workspace, file, active))! };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.fetchCadObjectInfo).mockResolvedValue(empty); });
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });
it("reads the saved document once when active, and supports explicit reread", async () => {
  const { state } = setup(); await settle();
  expect(api.fetchCadObjectInfo).toHaveBeenCalledTimes(1); expect(state.result.value).toEqual(empty);
  expect(vi.mocked(api.fetchCadObjectInfo).mock.calls[0]?.slice(0, 2)).toEqual(["/synthetic-workspace", "parts/document.FCStd"]);
  await state.load(); expect(api.fetchCadObjectInfo).toHaveBeenCalledTimes(2); expect(state.busy.value).toBe(false);
});
it("does not read inactive tabs, activates once, and aborts on deactivation", async () => {
  const { active, state } = setup(false); expect(api.fetchCadObjectInfo).not.toHaveBeenCalled();
  let finish!: (value: CadObjectInfoResult) => void;
  vi.mocked(api.fetchCadObjectInfo).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  active.value = true; const signal = vi.mocked(api.fetchCadObjectInfo).mock.calls[0]?.[2]!;
  expect(state.busy.value).toBe(true); active.value = false;
  expect(signal.aborted).toBe(true); expect(state.busy.value).toBe(false);
  finish(empty); await settle(); expect(state.result.value).toBeNull();
});
it("cancels immediately and ignores late success even when fetch ignores its abort signal", async () => {
  let finish!: (value: CadObjectInfoResult) => void;
  vi.mocked(api.fetchCadObjectInfo).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { state } = setup(); const signal = vi.mocked(api.fetchCadObjectInfo).mock.calls[0]?.[2]!;
  state.cancel(); expect(signal.aborted).toBe(true); expect(state.busy.value).toBe(false); expect(state.message.value).toContain("已取消");
  finish(empty); await settle(); expect(state.result.value).toBeNull(); expect(state.error.value).toBe("");
});
it.each(["workspace", "file"])("rejects an old %s snapshot after context changes", async field => {
  let finish!: (value: CadObjectInfoResult) => void;
  vi.mocked(api.fetchCadObjectInfo).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const context = setup(); const signal = vi.mocked(api.fetchCadObjectInfo).mock.calls[0]?.[2]!;
  const recent = { ...empty, source: { file_size: 200, mtime_ms: 2, document_xml_bytes: 22 } };
  vi.mocked(api.fetchCadObjectInfo).mockResolvedValue(recent);
  if (field === "workspace") context.workspace.value = "/another-synthetic-workspace";
  else context.file.value = "parts/another-document.FCStd";
  expect(signal.aborted).toBe(true); await settle();
  finish(empty); await settle(); expect(context.state.result.value).toEqual(recent);
});
it("does not show a late old-file error in the new file panel", async () => {
  let fail!: (reason: Error) => void;
  vi.mocked(api.fetchCadObjectInfo).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const { state, file } = setup(); file.value = "parts/new-document.FCStd"; await settle();
  fail(new Error("old bad ZIP")); await settle(); expect(state.error.value).toBe(""); expect(state.result.value).toEqual(empty);
});
it.each(["invalid_document_xml", "invalid_fcstd_archive", "resource_limit"])("shows %s without a partial document", async code => {
  vi.mocked(api.fetchCadObjectInfo).mockRejectedValueOnce(new ApiError("synthetic parse error", code === "resource_limit" ? 413 : 400, { code }));
  const { state } = setup(); await settle();
  expect(state.error.value).toBe("synthetic parse error"); expect(state.errorCode.value).toBe(code); expect(state.result.value).toBeNull(); expect(state.busy.value).toBe(false);
});
it("clears a prior snapshot on reread failure and disposal prevents any refill", async () => {
  const { state, scope } = setup(); await settle();
  vi.mocked(api.fetchCadObjectInfo).mockRejectedValueOnce(new Error("model changed")); await state.load();
  expect(state.result.value).toBeNull(); expect(state.error.value).toContain("model changed");
  let finish!: (value: CadObjectInfoResult) => void;
  vi.mocked(api.fetchCadObjectInfo).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = state.load(); const signal = vi.mocked(api.fetchCadObjectInfo).mock.calls.at(-1)?.[2]!;
  scope.stop(); expect(signal.aborted).toBe(true); finish(empty); await pending;
  expect(state.result.value).toBeNull(); expect(state.busy.value).toBe(false);
});
it("shows a selection prompt without sending an empty file request", async () => {
  const { state, file, active } = setup(false); file.value = "";
  // Activating is normally driven by FileDetail's objects tab.
  active.value = true; await state.load(); expect(api.fetchCadObjectInfo).not.toHaveBeenCalled();
  expect(state.message.value).toContain("请选择");
});
