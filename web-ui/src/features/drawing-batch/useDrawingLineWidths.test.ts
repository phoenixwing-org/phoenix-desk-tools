import { effectScope, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ fetchDrawingLineWidths: vi.fn(), saveDrawingLineWidths: vi.fn() }));
import { fetchDrawingLineWidths, saveDrawingLineWidths } from "./api";
import { useDrawingLineWidths } from "./useDrawingLineWidths";
import type { DrawingLineWidths } from "./types";
const scopes: Array<{ stop(): void }> = [];
const values = { contour_line_width_mm: 0.7, dimension_line_width_mm: 0.3 };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(fetchDrawingLineWidths).mockResolvedValue({ ...values }); vi.mocked(saveDrawingLineWidths).mockImplementation(async (_ws, input) => ({ ...input })); });
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));
function setup() {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/independent"), active = ref(true), blocked = ref(false), host = { invalidatePreviews: vi.fn(), reportError: vi.fn() };
  return { scope, workspace, active, blocked, host, state: scope.run(() => useDrawingLineWidths(workspace, active, blocked, host))! };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
it("starts with explicitly unverified defaults and makes no request on mount or activation", () => {
  const { state, active } = setup(); expect(state.contour.value).toBe(0.5); expect(state.dimension.value).toBe(0.25); expect(state.saved.value).toBeNull(); expect(state.dirty.value).toBe(true);
  active.value = false; active.value = true; expect(fetchDrawingLineWidths).not.toHaveBeenCalled(); expect(saveDrawingLineWidths).not.toHaveBeenCalled();
});
it("loads only on demand and saves a detached numeric snapshot, invalidating old previews on success", async () => {
  const { state, host } = setup(); await state.load(); expect(state.saved.value).toEqual(values); expect(state.dirty.value).toBe(false); expect(host.invalidatePreviews).not.toHaveBeenCalled();
  state.contour.value = 0.8; await state.save(); expect(saveDrawingLineWidths).toHaveBeenCalledExactlyOnceWith("/independent", { contour_line_width_mm: 0.8, dimension_line_width_mm: 0.3 }, expect.any(AbortSignal));
  expect(host.invalidatePreviews).toHaveBeenCalledOnce(); expect(state.notice.value).toContain("重新预览"); expect(state.dirty.value).toBe(false);
});
it.each([undefined, 0, -0.1, 5.1, NaN, Infinity])("does not submit invalid numeric input [case %#]", async value => {
  const { state } = setup(); state.dimension.value = value; expect(state.canSave.value).toBe(false); await state.save(); expect(saveDrawingLineWidths).not.toHaveBeenCalled(); expect(state.validation.value).toContain("线宽");
});
it("rejects equal/reversed hierarchy and blocks settings calls while a drawing operation owns the page", async () => {
  const { state, blocked } = setup(); state.dimension.value = 0.5; expect(state.canSave.value).toBe(false); state.dimension.value = 0.6; expect(state.validation.value).toContain("大于");
  state.dimension.value = 0.25; blocked.value = true; await state.load(); await state.save(); expect(fetchDrawingLineWidths).not.toHaveBeenCalled(); expect(saveDrawingLineWidths).not.toHaveBeenCalled();
});
it("is single-flight and retains edits made while a load was pending", async () => {
  const { state } = setup(), pending = deferred<DrawingLineWidths>(); vi.mocked(fetchDrawingLineWidths).mockReturnValue(pending.promise);
  const load = state.load(); await state.load(); await state.save(); state.contour.value = 0.9; pending.resolve(values); await load;
  expect(fetchDrawingLineWidths).toHaveBeenCalledOnce(); expect(saveDrawingLineWidths).not.toHaveBeenCalled(); expect(state.saved.value).toEqual(values); expect(state.contour.value).toBe(0.9); expect(state.dirty.value).toBe(true); expect(state.notice.value).toContain("保留读取期间的新输入");
});
it("does not overwrite newer editor input when the previous save succeeds", async () => {
  const { state, host } = setup(), pending = deferred<DrawingLineWidths>(); vi.mocked(saveDrawingLineWidths).mockReturnValue(pending.promise);
  const save = state.save(); state.contour.value = 0.9; pending.resolve({ contour_line_width_mm: 0.5, dimension_line_width_mm: 0.25 }); await save;
  expect(state.contour.value).toBe(0.9); expect(state.saved.value?.contour_line_width_mm).toBe(0.5); expect(state.dirty.value).toBe(true); expect(host.invalidatePreviews).toHaveBeenCalledOnce();
});
it("shows load failure without claiming saved values or modifying previews", async () => {
  const { state, host } = setup(); vi.mocked(fetchDrawingLineWidths).mockRejectedValue(new Error("Independent read error")); await state.load();
  expect(state.error.value).toContain("读取线宽失败"); expect(state.saved.value).toBeNull(); expect(state.pending.value).toBeNull(); expect(host.invalidatePreviews).not.toHaveBeenCalled(); expect(host.reportError).toHaveBeenCalledOnce();
});
it("treats a lost save response as unconfirmed, invalidates plans and never retries automatically", async () => {
  const { state, host } = setup(); vi.mocked(saveDrawingLineWidths).mockRejectedValue(new Error("Independent connection lost")); await state.save();
  expect(state.error.value).toContain("保存结果未确认"); expect(state.error.value).toContain("不要假定未写入"); expect(state.saved.value).toBeNull(); expect(host.invalidatePreviews).toHaveBeenCalledOnce(); expect(host.reportError).toHaveBeenCalledOnce(); expect(saveDrawingLineWidths).toHaveBeenCalledOnce();
});
it.each(["load-resolve", "load-reject", "save-resolve", "save-reject"])("aborts and ignores an old-workspace %s without clearing the new request or values", async kind => {
  const { state, workspace, host } = setup(), pending = deferred<DrawingLineWidths>();
  const save = kind.startsWith("save"); if (save) vi.mocked(saveDrawingLineWidths).mockReturnValueOnce(pending.promise); else vi.mocked(fetchDrawingLineWidths).mockReturnValueOnce(pending.promise);
  const old = save ? state.save() : state.load(); const signal = save ? vi.mocked(saveDrawingLineWidths).mock.calls[0][2]! : vi.mocked(fetchDrawingLineWidths).mock.calls[0][1]!;
  workspace.value = "/other-independent"; expect(signal.aborted).toBe(true); vi.mocked(fetchDrawingLineWidths).mockResolvedValue({ contour_line_width_mm: 0.9, dimension_line_width_mm: 0.4 }); await state.load();
  if (kind.endsWith("reject")) pending.reject(new Error("old context")); else pending.resolve(values); await old;
  expect(state.saved.value).toEqual({ contour_line_width_mm: 0.9, dimension_line_width_mm: 0.4 }); expect(state.error.value).toBe(""); expect(state.pending.value).toBeNull(); expect(host.invalidatePreviews).not.toHaveBeenCalled(); expect(host.reportError).not.toHaveBeenCalled();
});
it.each(["inactive", "disposed"])("ignores late save completion after the page is %s", async reason => {
  const { state, active, scope, host } = setup(), pending = deferred<DrawingLineWidths>(); vi.mocked(saveDrawingLineWidths).mockReturnValue(pending.promise); const save = state.save(); const signal = vi.mocked(saveDrawingLineWidths).mock.calls[0][2]!;
  if (reason === "inactive") active.value = false; else scope.stop(); expect(signal.aborted).toBe(true); pending.resolve(values); await save;
  expect(state.saved.value).toBeNull(); expect(state.error.value).toContain("不能据此判断未写入"); expect(host.invalidatePreviews).not.toHaveBeenCalled(); expect(host.reportError).not.toHaveBeenCalled(); expect(state.pending.value).toBeNull();
});
