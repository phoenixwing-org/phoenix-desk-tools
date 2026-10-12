import { effectScope, nextTick, ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { jsonFetch } from "../api";
import { useThumbnailGeneration } from "./useThumbnailGeneration";
vi.mock("../api", () => ({ jsonFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
function fixture() {
  const scope = effectScope(), ws = ref("/sample"), rel = ref("Demo.FCStd"), revision = ref(0);
  const host = { disabled: vi.fn(() => false), operation: vi.fn(), log: vi.fn() };
  const state = scope.run(() => useThumbnailGeneration(ws, rel, revision, host))!;
  return { scope, ws, rel, revision, state, host };
}
it("sends the selected render options and refreshes only the thumbnail", async () => {
  const f = fixture(); vi.mocked(jsonFetch).mockResolvedValue({ message: "已生成" });
  expect(f.state.value.options).toEqual({ color: "original", axonometric: true, fit: true });
  f.state.value.update({ color: "neutral", fit: false }); await f.state.value.run();
  expect(JSON.parse(vi.mocked(jsonFetch).mock.calls[0][1]!.body as string)).toEqual({ rel: "Demo.FCStd", options: { color: "neutral", axonometric: true, fit: false } });
  expect(f.revision.value).toBe(1); expect(f.state.value.busy).toBe(false); f.scope.stop();
});
it("disables duplicate generation and ignores late results after switching files", async () => {
  const f = fixture(); let finish!: (v: unknown) => void;
  vi.mocked(jsonFetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const run = f.state.value.run(); await f.state.value.run(); expect(jsonFetch).toHaveBeenCalledOnce();
  f.rel.value = "Other.FCStd"; await nextTick(); finish({ message: "late" }); await run;
  expect(f.revision.value).toBe(0); expect(f.state.value.message).toBe(""); f.scope.stop();
});
it("keeps the old thumbnail and reveals the error log when generation fails", async () => {
  const f = fixture(); vi.mocked(jsonFetch).mockRejectedValue(new Error("FreeCAD unavailable"));
  await f.state.value.run(); expect(f.revision.value).toBe(0); expect(f.state.value.error).toBe(true);
  expect(f.host.log).toHaveBeenCalledWith(expect.stringContaining("FreeCAD unavailable"), true);
  expect(f.host.operation).toHaveBeenLastCalledWith(false); f.scope.stop();
});
it("does not run while the page has another operation or unsaved changes", async () => {
  const f = fixture(); f.host.disabled.mockReturnValue(true); await f.state.value.run();
  expect(jsonFetch).not.toHaveBeenCalled(); f.scope.stop();
});
