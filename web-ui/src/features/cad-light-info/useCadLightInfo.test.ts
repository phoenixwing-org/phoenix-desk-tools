import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import * as api from "./api";
import { useCadLightInfo } from "./useCadLightInfo";
import { syntheticLightInfo } from "./fixtures.test-support";
import type { CadLightInfoResult } from "./types";
vi.mock("./api", () => ({ fetchCadLightInfo: vi.fn() }));
const scopes: EffectScope[] = [];
function setup(enabled = true) {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/synthetic-workspace"), file = ref("components/model.FCStd"), active = ref(enabled), appendLog = vi.fn();
  return { scope, workspace, file, active, appendLog, state: scope.run(() => useCadLightInfo(workspace, file, active, { appendLog }))! };
}
function deferred() {
  let resolve!: (result: CadLightInfoResult) => void, reject!: (error: Error) => void;
  const promise = new Promise<CadLightInfoResult>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.fetchCadLightInfo).mockResolvedValue(syntheticLightInfo()); });
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });
it("never reads automatically on creation, activation or workspace/file changes", async () => {
  const context = setup(false); context.active.value = true; context.file.value = "another.FCStd"; context.workspace.value = "/another-synthetic-workspace";
  await Promise.resolve(); expect(api.fetchCadLightInfo).not.toHaveBeenCalled();
  await context.state.load(); expect(api.fetchCadLightInfo).toHaveBeenCalledExactlyOnceWith("/another-synthetic-workspace", "another.FCStd", expect.any(AbortSignal));
  expect(context.state.result.value).toEqual(syntheticLightInfo()); expect(context.state.busy.value).toBe(false);
});
it.each(["cancel", "workspace", "file", "inactive", "dispose"])("aborts %s and ignores success from an abort-insensitive transport", async change => {
  const pending = deferred(); vi.mocked(api.fetchCadLightInfo).mockReturnValueOnce(pending.promise);
  const context = setup(), loaded = context.state.load(), signal = vi.mocked(api.fetchCadLightInfo).mock.calls[0][2]!;
  if (change === "cancel") context.state.cancel();
  if (change === "workspace") context.workspace.value = "/another-synthetic-workspace";
  if (change === "file") context.file.value = "another.FCStd";
  if (change === "inactive") context.active.value = false;
  if (change === "dispose") context.scope.stop();
  expect(signal.aborted).toBe(true); expect(context.state.busy.value).toBe(false);
  pending.resolve(syntheticLightInfo()); await loaded;
  expect(context.state.result.value).toBeNull(); expect(context.state.error.value).toBe(""); expect(context.appendLog).not.toHaveBeenCalled(); expect(api.fetchCadLightInfo).toHaveBeenCalledTimes(1);
});
it("does not apply a late error to a new file or clear the newer busy state", async () => {
  const first = deferred(), second = deferred();
  vi.mocked(api.fetchCadLightInfo).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const context = setup(), initial = context.state.load(); context.file.value = "new.FCStd"; const recent = context.state.load();
  first.reject(new Error("old failure")); await initial;
  expect(context.state.busy.value).toBe(true); expect(context.state.error.value).toBe(""); expect(context.appendLog).not.toHaveBeenCalled();
  second.resolve(syntheticLightInfo()); await recent; expect(context.state.result.value).toEqual(syntheticLightInfo());
});
it("clears a successful snapshot before retrying and only logs a safe known error code", async () => {
  const context = setup(); await context.state.load();
  vi.mocked(api.fetchCadLightInfo).mockRejectedValueOnce(new ApiError("synthetic/private.FCStd changed", 400, { code: "source_changed", detail: "synthetic/private.FCStd" }));
  await context.state.load();
  expect(context.state.result.value).toBeNull(); expect(context.state.errorCode.value).toBe("source_changed"); expect(context.state.busy.value).toBe(false);
  expect(context.appendLog).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("source_changed"), { source: "file_detail", open: true });
  expect(context.appendLog.mock.calls[0][0]).not.toContain("private.FCStd");
});
it("does not copy unknown codes or payloads into shared error logs", async () => {
  vi.mocked(api.fetchCadLightInfo).mockRejectedValueOnce(new ApiError("opaque private detail", 400, { code: "opaque/private-code" }));
  const context = setup(); await context.state.load();
  expect(context.state.errorCode.value).toBe(""); expect(context.appendLog.mock.calls[0][0]).toContain("response_error"); expect(context.appendLog.mock.calls[0][0]).not.toContain("opaque");
});
it("opens Bottom once with counts only for warnings or unresolved source diagnostics", async () => {
  const data = syntheticLightInfo(); data.warnings = ["opaque private parse warning"];
  data.diagnostics.items[0].status = "missing"; data.diagnostics.items[0].targetRelativePath = null; data.diagnostics.counts.resolved = 0; data.diagnostics.counts.missing = 1;
  vi.mocked(api.fetchCadLightInfo).mockResolvedValue(data);
  const context = setup(); await context.state.load();
  expect(context.appendLog).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 项源 XLink"), { source: "file_detail", open: true });
  expect(context.appendLog.mock.calls[0][0]).not.toContain("opaque"); expect(context.appendLog.mock.calls[0][0]).not.toContain("child.FCStd");
});
it("refuses manual loading while inactive or after scope disposal", async () => {
  const context = setup(false); await context.state.load(); expect(api.fetchCadLightInfo).not.toHaveBeenCalled();
  context.scope.stop(); context.active.value = true; await context.state.load(); expect(api.fetchCadLightInfo).not.toHaveBeenCalled();
});
it("shows a selection prompt without sending empty context", async () => {
  const context = setup(); context.file.value = ""; await context.state.load(); expect(api.fetchCadLightInfo).not.toHaveBeenCalled(); expect(context.state.message.value).toContain("请选择");
});
