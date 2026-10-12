import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import * as api from "./api";
type GalleryLog = (message: string, options: { source: string; open: boolean }) => void;
export function usePartGallery(workspace: Ref<string>, product: Ref<string>, appendLog?: GalleryLog) {
  const result = ref<api.GalleryResult | null>(null), job = ref<api.GalleryJob | null>(null), options = ref<string[]>([]);
  const jobKind = ref<"thumbnails" | "dimensions" | null>(null);
  const error = ref(""), requesting = ref(false);
  const busy = computed(() => requesting.value || job.value?.state === "running");
  let epoch = 0, startingJob = false, timer: ReturnType<typeof setTimeout> | undefined;
  const logFailure = (message: string) => appendLog?.(`[零件图册] ${message}`, { source: "part_gallery", open: true });
  function reset() { epoch++; clearTimeout(timer); startingJob = false; result.value = null; job.value = null; jobKind.value = null; error.value = ""; requesting.value = false; }
  async function load() {
    if (!workspace.value || startingJob || job.value?.state === "running") return;
    const seq = ++epoch, ws = workspace.value, scope = product.value; error.value = ""; requesting.value = true;
    try {
      const [data, choices] = await Promise.all([api.loadGallery(ws, scope), api.galleryOptions(ws)]);
      if (epoch === seq) { result.value = data; options.value = choices.products; }
    } catch (cause) { if (epoch === seq) { error.value = String(cause); logFailure(error.value); } }
    finally { if (epoch === seq) requesting.value = false; }
  }
  async function start(kind: "thumbnails" | "dimensions") {
    if (busy.value || !workspace.value) return;
    const seq = ++epoch, ws = workspace.value, scope = product.value; clearTimeout(timer); startingJob = true; job.value = null; requesting.value = true; error.value = ""; jobKind.value = kind;
    function follow(data: api.GalleryJob) {
      if (seq !== epoch) return;
      startingJob = false;
      job.value = data;
      if (data.state !== "running") {
        const finishedKind = kind;
        void load().then(() => {
          // load advances the response epoch; scope identity is still checked
          // so a late result never reveals another workspace's log.
          if (ws !== workspace.value || scope !== product.value || job.value?.id !== data.id) return;
          const warnings = finishedKind === "dimensions"
            ? (result.value?.rows || []).filter(row => !row.bounding_box && row.dimension_message).map(row => `${row.rel}：${row.dimension_message}`)
            : (result.value?.issues || []).map(issue => `${issue.rel}：${issue.message}`);
          if (warnings.length || data.state === "failed" || data.state === "attention") {
            logFailure([data.message, ...warnings].join("\n"));
          } else appendLog?.(`[零件图册] ${data.message}`, { source: "part_gallery", open: false });
        });
        return;
      }
      timer = setTimeout(async () => {
        try { follow(await api.galleryJob(ws, data.id)); }
        catch (cause) { if (seq === epoch) { job.value = { ...data, state: "failed" }; error.value = `进度读取失败；可加载缓存核对，不会修改 CAD：${String(cause)}`; logFailure(error.value); } }
      }, 350);
    }
    try { follow(await (kind === "dimensions" ? api.startGeometryJob : api.startGalleryJob)(ws, scope)); }
    catch (cause) { if (seq === epoch) { error.value = String(cause); logFailure(error.value); } }
    finally { if (seq === epoch) { startingJob = false; requesting.value = false; } }
  }
  watch([workspace, product], () => { reset(); options.value = []; void load(); }, { immediate: true, flush: "sync" });
  onScopeDispose(reset);
  return { result, job, jobKind, options, busy, requesting, error, load, update: () => start("thumbnails"), updateDimensions: () => start("dimensions") };
}
