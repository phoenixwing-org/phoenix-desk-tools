import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import * as api from "./api";
export function usePartGallery(workspace: Ref<string>, product: Ref<string>) {
  const result = ref<api.GalleryResult | null>(null), job = ref<api.GalleryJob | null>(null), options = ref<string[]>([]);
  const error = ref(""), requesting = ref(false);
  const busy = computed(() => requesting.value || job.value?.state === "running");
  let epoch = 0, timer: ReturnType<typeof setTimeout> | undefined;
  function reset() { epoch++; clearTimeout(timer); result.value = null; job.value = null; error.value = ""; requesting.value = false; }
  async function load() {
    if (!workspace.value) return;
    const seq = ++epoch, ws = workspace.value, scope = product.value; error.value = ""; requesting.value = true;
    try {
      const [data, choices] = await Promise.all([api.loadGallery(ws, scope), api.galleryOptions(ws)]);
      if (epoch === seq) { result.value = data; options.value = choices.products; }
    } catch (cause) { if (epoch === seq) error.value = String(cause); }
    finally { if (epoch === seq) requesting.value = false; }
  }
  async function update() {
    if (busy.value || !workspace.value) return;
    const seq = ++epoch, ws = workspace.value, scope = product.value; requesting.value = true; error.value = "";
    function follow(data: api.GalleryJob) {
      if (seq !== epoch) return;
      job.value = data;
      if (data.state !== "running") { void load(); return; }
      timer = setTimeout(async () => {
        try { follow(await api.galleryJob(ws, data.id)); }
        catch (cause) { if (seq === epoch) { job.value = { ...data, state: "failed" }; error.value = `进度读取失败；可加载缓存核对，不会修改 CAD：${String(cause)}`; } }
      }, 350);
    }
    try { follow(await api.startGalleryJob(ws, scope)); }
    catch (cause) { if (seq === epoch) error.value = String(cause); }
    finally { if (seq === epoch) requesting.value = false; }
  }
  watch([workspace, product], () => { reset(); options.value = []; void load(); }, { immediate: true, flush: "sync" });
  onScopeDispose(reset);
  return { result, job, options, busy, requesting, error, load, update };
}
