import { afterEach, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useFcstdPropertyRepair } from "./useFcstdPropertyRepair";
import { analyzeFcstdProperties, applyFcstdPropertyRepairs } from "../api";
vi.mock("../api", () => ({ analyzeFcstdProperties: vi.fn(), applyFcstdPropertyRepairs: vi.fn() }));
const scopes: ReturnType<typeof effectScope>[] = [];
function controller() {
  const scope = effectScope(); scopes.push(scope);
  const key = ref("ws1/parts"); const dir = ref("parts");
  return { key, ...scope.run(() => useFcstdPropertyRepair(key, dir))! };
}
const plan = { plan_id: "plan1", batch_dir: "parts", scanned: 2, files: [
  { rel: "parts/a.FCStd", issues: [{ object_name: "Body", declared_count: "0", actual_count: 5 }] },
  { rel: "parts/b.FCStd", issues: [{ object_name: "Body", declared_count: null, actual_count: 5 }] },
], errors: [] };
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); vi.resetAllMocks(); });

it("only applies selected analyzed files and cannot accidentally repeat a consumed plan", async () => {
  vi.mocked(analyzeFcstdProperties).mockResolvedValue(plan);
  vi.mocked(applyFcstdPropertyRepairs).mockResolvedValue({ results: [{ rel: "parts/a.FCStd", status: "fixed", message: "ok" }] });
  const state = controller();
  await state.apply(); expect(applyFcstdPropertyRepairs).not.toHaveBeenCalled();
  await state.analyze(); expect(state.selected.value).toHaveLength(2);
  state.selected.value = ["parts/a.FCStd"];
  await state.apply(); expect(applyFcstdPropertyRepairs).toHaveBeenCalledExactlyOnceWith("plan1", ["parts/a.FCStd"]);
  expect(state.canApply.value).toBe(false);
  await state.apply(); expect(applyFcstdPropertyRepairs).toHaveBeenCalledTimes(1);
});
it("invalidates results immediately on scope change", async () => {
  vi.mocked(analyzeFcstdProperties).mockResolvedValue(plan);
  const state = controller(); await state.analyze(); state.key.value = "ws2/other";
  expect(state.analysis.value).toBeNull(); expect(state.selected.value).toEqual([]); expect(state.canApply.value).toBe(false);
});
it("ignores a late analysis response for the previous scope", async () => {
  let resolve!: (value: typeof plan) => void;
  vi.mocked(analyzeFcstdProperties).mockImplementation(() => new Promise(done => { resolve = done; }));
  const state = controller(); const pending = state.analyze(); state.key.value = "new";
  resolve(plan); await pending; expect(state.analysis.value).toBeNull();
});
it("shows failed analysis without a false clean result", async () => {
  vi.mocked(analyzeFcstdProperties).mockRejectedValue(new Error("invalid ZIP"));
  const state = controller(); await state.analyze();
  expect(state.error.value).toContain("invalid ZIP"); expect(state.analysis.value).toBeNull(); expect(state.canApply.value).toBe(false);
});
it("retains per-file partial failures for review", async () => {
  vi.mocked(analyzeFcstdProperties).mockResolvedValue(plan);
  vi.mocked(applyFcstdPropertyRepairs).mockResolvedValue({ results: [
    { rel: "parts/a.FCStd", status: "failed", message: "文件已变化" },
    { rel: "parts/b.FCStd", status: "fixed", message: "ok" },
  ] });
  const state = controller(); await state.analyze(); await state.apply();
  expect(state.result.value?.results.map(row => row.status)).toEqual(["failed", "fixed"]);
  expect(state.canApply.value).toBe(false);
});
