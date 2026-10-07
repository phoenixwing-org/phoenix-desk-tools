import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { usePartGallery } from "./usePartGallery";

vi.mock("./api", () => ({ loadGallery: vi.fn(), galleryOptions: vi.fn(), startGalleryJob: vi.fn(), galleryJob: vi.fn() }));
const scopes: EffectScope[] = [];
const empty: api.GalleryResult = { product: "A.ASSY.FCStd", updated_at: "", rows: [], issues: [] };
const running: api.GalleryJob = { id: "job", product: empty.product, state: "running", completed: 0, total: 1, reused: 0, current_rel: "", message: "reading" };
function setup() {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/fixture"), product = ref(empty.product);
  return { scope, workspace, product, state: scope.run(() => usePartGallery(workspace, product))! };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  vi.mocked(api.loadGallery).mockResolvedValue(empty);
  vi.mocked(api.galleryOptions).mockResolvedValue({ products: [empty.product], indexed_files: 1 });
  vi.mocked(api.startGalleryJob).mockResolvedValue(running);
  vi.mocked(api.galleryJob).mockResolvedValue({ ...running, state: "done", completed: 1 });
});
afterEach(() => { scopes.splice(0).forEach(s => s.stop()); vi.useRealTimers(); });
it("loads cached metadata on entry without extracting CAD and refreshes once after completion", async () => {
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0);
  expect(api.startGalleryJob).not.toHaveBeenCalled(); expect(state.result.value).toEqual(empty);
  await state.update(); await state.update(); expect(api.startGalleryJob).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(350);
  expect(state.job.value?.state).toBe("done"); expect(state.busy.value).toBe(false);
  expect(api.loadGallery).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1000); expect(api.galleryJob).toHaveBeenCalledTimes(1);
});
it("ignores old responses when the product changes", async () => {
  let resolve!: (data: api.GalleryResult) => void;
  vi.mocked(api.loadGallery).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, product } = setup(); product.value = "B.ASSY.FCStd";
  const other = { ...empty, product: product.value, updated_at: "new" };
  vi.mocked(api.loadGallery).mockResolvedValue(other);
  await state.load(); resolve({ ...empty, updated_at: "old" }); await vi.advanceTimersByTimeAsync(0);
  expect(state.result.value).toEqual(other); expect(state.busy.value).toBe(false);
});
it("does not replay a job after polling fails, and clears tracking on workspace change", async () => {
  const { state, workspace } = setup(); await vi.advanceTimersByTimeAsync(0); await state.update();
  vi.mocked(api.galleryJob).mockRejectedValueOnce(new Error("offline"));
  await vi.advanceTimersByTimeAsync(350);
  expect(state.error.value).toContain("进度读取失败"); expect(state.job.value?.state).toBe("failed");
  await vi.advanceTimersByTimeAsync(1500); expect(api.startGalleryJob).toHaveBeenCalledTimes(1);
  workspace.value = "/other"; expect(state.job.value).toBeNull(); expect(state.result.value).toBeNull();
});
it("stops tracking on disposal without accepting a late cache response", async () => {
  let resolve!: (data: api.GalleryResult) => void;
  vi.mocked(api.loadGallery).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, scope } = setup(); scope.stop(); resolve(empty); await vi.advanceTimersByTimeAsync(0);
  expect(state.result.value).toBeNull(); expect(state.busy.value).toBe(false);
});
