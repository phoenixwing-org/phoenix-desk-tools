import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { jsonFetch } from "../api";
import type { ThumbnailGeneration, ThumbnailOptions } from "../types/thumbnail";

export function useThumbnailGeneration(workspace: Ref<string>, rel: Ref<string>, revision: Ref<number>, host: {
  disabled: () => boolean;
  operation: (busy: boolean) => void;
  log: (message: string, error: boolean) => void;
}) {
  const options = ref<ThumbnailOptions>({ color: "original", axonometric: true, fit: true });
  const busy = ref(false), message = ref(""), error = ref(false);
  let epoch = 0, controller: AbortController | undefined;
  function reset() { epoch++; controller?.abort(); busy.value = false; message.value = ""; error.value = false; host.operation(false); }
  watch([workspace, rel], reset, { flush: "sync" });
  onScopeDispose(reset);
  async function run() {
    if (busy.value || host.disabled() || !workspace.value || !/\.fcstd$/i.test(rel.value)) return;
    const token = ++epoch, ws = workspace.value, file = rel.value;
    controller = new AbortController(); busy.value = true; error.value = false;
    message.value = "FreeCAD 正在生成…"; host.operation(true);
    host.log(`正在生成缩略图：${file}`, false);
    try {
      const result = await jsonFetch<{ message: string }>(`/api/cad/file-thumbnail/regenerate?workspace=${encodeURIComponent(ws)}`, {
        method: "POST", signal: controller.signal, body: JSON.stringify({ rel: file, options: { ...options.value } }),
      });
      if (token !== epoch) return;
      revision.value++; message.value = result.message; host.log(`${file}：${result.message}`, false);
    } catch (e) {
      if (token !== epoch) return;
      error.value = true; message.value = e instanceof Error ? e.message : String(e);
      host.log(`缩略图生成失败：${file} · ${message.value}`, true);
    } finally { if (token === epoch) { busy.value = false; host.operation(false); } }
  }
  return computed<ThumbnailGeneration>(() => ({
    options: options.value, busy: busy.value, disabled: busy.value || host.disabled(), message: message.value, error: error.value,
    update: value => { if (!busy.value) options.value = { ...options.value, ...value }; }, run,
  }));
}
