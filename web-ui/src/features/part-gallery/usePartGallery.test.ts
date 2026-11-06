import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { usePartGallery } from "./usePartGallery";

vi.mock("./api", () => ({ loadGallery: vi.fn(), galleryOptions: vi.fn(), startGalleryJob: vi.fn(), startGeometryJob: vi.fn(), galleryJob: vi.fn(), cancelGalleryJob: vi.fn() }));
const scopes: EffectScope[] = [];
const empty: api.GalleryResult = { product: "A.ASSY.FCStd", updated_at: "", rows: [], issues: [] };
const running: api.GalleryJob = { id: "job", product: empty.product, state: "running", completed: 0, total: 1, reused: 0, current_rel: "", message: "reading" };
function setup(appendLog?: Parameters<typeof usePartGallery>[2]) {
  const scope = effectScope(); scopes.push(scope);
  const workspace = ref("/fixture"), product = ref(empty.product);
  return { scope, workspace, product, state: scope.run(() => usePartGallery(workspace, product, appendLog))! };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  vi.mocked(api.loadGallery).mockResolvedValue(empty);
  vi.mocked(api.galleryOptions).mockResolvedValue({ products: [empty.product], indexed_files: 1 });
  vi.mocked(api.startGalleryJob).mockResolvedValue(running);
  vi.mocked(api.startGeometryJob).mockResolvedValue({ ...running, id: "geometry-job", message: "measuring" });
  vi.mocked(api.galleryJob).mockResolvedValue({ ...running, state: "done", completed: 1 });
  vi.mocked(api.cancelGalleryJob).mockResolvedValue({ ...running, state: "cancelled", message: "已取消图片缓存更新" });
});
afterEach(() => { scopes.splice(0).forEach(s => s.stop()); vi.useRealTimers(); });
it("loads cached metadata on entry without extracting CAD and refreshes once after completion", async () => {
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0);
  expect(api.startGalleryJob).not.toHaveBeenCalled(); expect(api.startGeometryJob).not.toHaveBeenCalled(); expect(state.result.value).toEqual(empty);
  await state.update(); await state.update(); expect(api.startGalleryJob).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(350);
  expect(state.job.value?.state).toBe("done"); expect(state.busy.value).toBe(false);
  expect(api.loadGallery).toHaveBeenCalledTimes(2);
  expect(api.startGeometryJob).not.toHaveBeenCalled();
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
it.each(["catalog", "options"] as const)("clears previously actionable cached rows when current %s reload fails", async endpoint => {
  const cached: api.GalleryResult = { ...empty, updated_at: "cached", rows: [{ rel: "fixtures/Plate.FCStd", part_number: "EXAMPLE", part_version: "1", part_name: "Plate", type_code: "H", role: "part", status: "ready", width: 128, height: 128, image_hash: "synthetic", message: "" }] };
  vi.mocked(api.loadGallery).mockResolvedValue(cached);
  const appendLog = vi.fn(), { state } = setup(appendLog); await vi.advanceTimersByTimeAsync(0);
  expect(state.result.value?.rows).toHaveLength(1);
  if (endpoint === "catalog") vi.mocked(api.loadGallery).mockRejectedValueOnce(new Error("catalog unavailable"));
  else vi.mocked(api.galleryOptions).mockRejectedValueOnce(new Error("options unavailable"));
  await state.load();
  expect(state.result.value).toBeNull(); expect(state.result.value?.rows || []).toEqual([]);
  expect(state.busy.value).toBe(false); expect(state.error.value).toContain(`${endpoint} unavailable`);
  expect(appendLog).toHaveBeenCalledWith(expect.stringContaining(`${endpoint} unavailable`), { source: "part_gallery", open: true });
  expect(api.startGalleryJob).not.toHaveBeenCalled(); expect(api.startGeometryJob).not.toHaveBeenCalled();
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
it("starts dimensions only explicitly and shares the thumbnail busy guard and completion refresh", async () => {
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0);
  await state.updateDimensions();
  expect(api.startGeometryJob).toHaveBeenCalledWith("/fixture", empty.product);
  expect(api.startGalleryJob).not.toHaveBeenCalled();
  expect(state.jobKind.value).toBe("dimensions"); expect(state.busy.value).toBe(true);
  await state.update(); await state.updateDimensions(); await state.load();
  expect(api.startGeometryJob).toHaveBeenCalledTimes(1); expect(api.loadGallery).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(350);
  expect(api.galleryJob).toHaveBeenCalledWith("/fixture", "geometry-job");
  expect(api.loadGallery).toHaveBeenCalledTimes(2); expect(state.busy.value).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); expect(api.galleryJob).toHaveBeenCalledTimes(1);
});
it("does not lose a starting dimensions job when a cache reload is requested before its response", async () => {
  let resolve!: (data: api.GalleryJob) => void;
  vi.mocked(api.startGeometryJob).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0);
  const pending = state.updateDimensions(); await state.load(); await state.update();
  expect(api.loadGallery).toHaveBeenCalledTimes(1); expect(api.startGalleryJob).not.toHaveBeenCalled();
  resolve({ ...running, id: "geometry-job" }); await pending;
  expect(state.job.value?.id).toBe("geometry-job"); expect(state.busy.value).toBe(true);
  await vi.advanceTimersByTimeAsync(350); expect(state.busy.value).toBe(false); expect(api.loadGallery).toHaveBeenCalledTimes(2);
});
it("ignores a dimensions start response from an old product and does not begin its poll", async () => {
  let resolve!: (data: api.GalleryJob) => void;
  vi.mocked(api.startGeometryJob).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, product } = setup(); await vi.advanceTimersByTimeAsync(0);
  const pending = state.updateDimensions(); expect(state.busy.value).toBe(true);
  const next = { ...empty, product: "Other.ASSY.FCStd", updated_at: "current" };
  vi.mocked(api.loadGallery).mockResolvedValue(next); product.value = next.product;
  resolve({ ...running, id: "old-geometry" }); await pending; await vi.advanceTimersByTimeAsync(1000);
  expect(state.result.value).toEqual(next); expect(state.job.value).toBeNull(); expect(state.jobKind.value).toBeNull();
  expect(state.busy.value).toBe(false); expect(api.galleryJob).not.toHaveBeenCalled();
});
it("ignores a late dimensions poll after a workspace change", async () => {
  let resolve!: (data: api.GalleryJob) => void;
  vi.mocked(api.galleryJob).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, workspace } = setup(); await vi.advanceTimersByTimeAsync(0); await state.updateDimensions();
  vi.advanceTimersByTime(350); expect(api.galleryJob).toHaveBeenCalledTimes(1);
  workspace.value = "/other";
  resolve({ ...running, state: "done", completed: 1 }); await vi.advanceTimersByTimeAsync(1000);
  expect(state.job.value).toBeNull(); expect(state.jobKind.value).toBeNull(); expect(state.busy.value).toBe(false);
  expect(api.loadGallery).toHaveBeenCalledTimes(2); expect(api.startGeometryJob).toHaveBeenCalledTimes(1);
});
it("releases busy after a dimensions request fails and never automatically replays it", async () => {
  vi.mocked(api.startGeometryJob).mockRejectedValueOnce(new Error("geometry unavailable"));
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0); await state.updateDimensions();
  expect(state.error.value).toContain("geometry unavailable"); expect(state.busy.value).toBe(false);
  await vi.advanceTimersByTimeAsync(1000); expect(api.startGeometryJob).toHaveBeenCalledTimes(1);
  await state.update(); expect(api.startGalleryJob).toHaveBeenCalledTimes(1); expect(state.jobKind.value).toBe("thumbnails");
});
it("discards a late dimensions response after disposal", async () => {
  let resolve!: (data: api.GalleryJob) => void;
  vi.mocked(api.startGeometryJob).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, scope } = setup(); await vi.advanceTimersByTimeAsync(0);
  const pending = state.updateDimensions(); scope.stop(); resolve(running); await pending; await vi.advanceTimersByTimeAsync(1000);
  expect(state.job.value).toBeNull(); expect(state.jobKind.value).toBeNull(); expect(state.busy.value).toBe(false);
  expect(api.galleryJob).not.toHaveBeenCalled();
});
it("reveals the bottom output with per-file reasons after dimensions finish with warnings", async () => {
  const appendLog = vi.fn();
  const { state } = setup(appendLog); await vi.advanceTimersByTimeAsync(0);
  vi.mocked(api.loadGallery).mockResolvedValue({ ...empty, rows: [{ rel: "Blank.FCStd", part_number: "", part_version: "", part_name: "Blank", type_code: "H", role: "part", status: "ready", width: 1, height: 1, image_hash: "png", message: "", bounding_box: null, dimension_message: "主零件节点的 Shape 为空" }] });
  vi.mocked(api.galleryJob).mockResolvedValue({ ...running, id: "geometry-job", state: "attention", message: "未获取 1", completed: 1 });
  await state.updateDimensions(); await vi.advanceTimersByTimeAsync(350);
  expect(appendLog).toHaveBeenCalledWith(expect.stringContaining("Blank.FCStd：主零件节点的 Shape 为空"), { source: "part_gallery", open: true });
  expect(api.startGeometryJob).toHaveBeenCalledTimes(1);
});
it("opens the bottom output for a failed dimensions request", async () => {
  const appendLog = vi.fn(); vi.mocked(api.startGeometryJob).mockRejectedValueOnce(new Error("未找到 FreeCADCmd"));
  const { state } = setup(appendLog); await vi.advanceTimersByTimeAsync(0); await state.updateDimensions();
  expect(appendLog).toHaveBeenCalledWith(expect.stringContaining("未找到 FreeCADCmd"), { source: "part_gallery", open: true });
});
it("logs a successful measurement without forcing the bottom output open", async () => {
  const appendLog = vi.fn(); const { state } = setup(appendLog); await vi.advanceTimersByTimeAsync(0);
  await state.updateDimensions(); await vi.advanceTimersByTimeAsync(350);
  expect(appendLog).toHaveBeenCalledWith(expect.stringContaining("reading"), { source: "part_gallery", open: false });
});
it("cancels the current cache job, reloads cache metadata and never starts Native work", async () => {
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0);
  expect(state.canCancel.value).toBe(false); await state.update(); expect(state.canCancel.value).toBe(true);
  await state.cancel(); await vi.advanceTimersByTimeAsync(0);
  expect(api.cancelGalleryJob).toHaveBeenCalledExactlyOnceWith("/fixture", "job");
  expect(state.job.value?.state).toBe("cancelled"); expect(state.busy.value).toBe(false); expect(state.canCancel.value).toBe(false);
  expect(api.loadGallery).toHaveBeenCalledTimes(2); expect(api.startGeometryJob).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000); expect(api.galleryJob).not.toHaveBeenCalled(); expect(api.startGalleryJob).toHaveBeenCalledTimes(1);
});
it("does not offer or send cancellation for dimensions jobs", async () => {
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0); await state.updateDimensions();
  expect(state.canCancel.value).toBe(false); await state.cancel(); expect(api.cancelGalleryJob).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(350); expect(state.job.value?.state).toBe("done");
});
it("joins UI cancellation pending state and ignores its late response after workspace change", async () => {
  let resolve!: (value: api.GalleryJob) => void;
  vi.mocked(api.cancelGalleryJob).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { state, workspace } = setup(); await vi.advanceTimersByTimeAsync(0); await state.update();
  const pending = state.cancel(); expect(state.cancelling.value).toBe(true); await state.cancel();
  expect(api.cancelGalleryJob).toHaveBeenCalledTimes(1); workspace.value = "/other";
  resolve({ ...running, state: "cancelled" }); await pending; await vi.advanceTimersByTimeAsync(1000);
  expect(state.job.value).toBeNull(); expect(state.cancelling.value).toBe(false); expect(api.galleryJob).not.toHaveBeenCalled();
});
it("queries the original cache job after cancellation is uncertain, without replaying or claiming cancellation", async () => {
  vi.mocked(api.cancelGalleryJob).mockRejectedValueOnce(new Error("offline"));
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0); await state.update(); await state.cancel();
  expect(state.error.value).toContain("取消结果未确认"); expect(state.job.value?.state).toBe("running"); expect(state.cancelling.value).toBe(false);
  await vi.advanceTimersByTimeAsync(350); expect(api.galleryJob).toHaveBeenCalledExactlyOnceWith("/fixture", "job");
  expect(api.startGalleryJob).toHaveBeenCalledTimes(1); expect(api.startGeometryJob).not.toHaveBeenCalled();
});
it("does not accept a different job as the cancellation result", async () => {
  vi.mocked(api.cancelGalleryJob).mockResolvedValueOnce({ ...running, id: "other-job", state: "cancelled" });
  const { state } = setup(); await vi.advanceTimersByTimeAsync(0); await state.update(); await state.cancel();
  expect(state.job.value?.id).toBe("job"); expect(state.job.value?.state).toBe("running"); expect(state.error.value).toContain("不属于当前图片缓存任务");
  await vi.advanceTimersByTimeAsync(350); expect(api.galleryJob).toHaveBeenCalledWith("/fixture", "job");
});
