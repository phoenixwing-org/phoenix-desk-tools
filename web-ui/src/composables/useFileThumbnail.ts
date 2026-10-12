import { onScopeDispose, ref, watch, type Ref } from "vue";
import { jsonFetch } from "../api";

export function useFileThumbnail(workspace: Ref<string>, rel: Ref<string>, revision: Ref<number>) {
  const thumbnail = ref<{ src: string; alt: string } | null>(null);
  let epoch = 0;
  let controller: AbortController | undefined;
  watch([workspace, rel, revision], async ([ws, file]) => {
    const current = ++epoch;
    controller?.abort(); thumbnail.value = null;
    if (!ws || !/\.fcstd$/i.test(file)) return;
    controller = new AbortController();
    try {
      const result = await jsonFetch<{ thumbnail: { data_url: string } | null }>(`/api/cad/file-thumbnail?workspace=${encodeURIComponent(ws)}&rel=${encodeURIComponent(file)}`, { signal: controller.signal });
      if (current === epoch) thumbnail.value = { src: result.thumbnail?.data_url.startsWith("data:image/png;base64,") ? result.thumbnail.data_url : "", alt: `${file.split(/[\\/]/).pop()} 的缩略图` };
    } catch { if (current === epoch && !controller.signal.aborted) thumbnail.value = { src: "", alt: "无缩略图" }; }
  }, { immediate: true });
  onScopeDispose(() => { ++epoch; controller?.abort(); });
  return thumbnail;
}
