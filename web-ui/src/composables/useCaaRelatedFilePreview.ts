import { ref } from "vue";
import { fetchCaaDialogFilePreview } from "../api/caaDialog";
import type { CaaFilePreviewPayload } from "../utils/caaRelatedFilePreview";

const open = ref(false);
const loading = ref(false);
const path = ref("");
const kindLabel = ref("");
const preview = ref<CaaFilePreviewPayload | null>(null);
const errorText = ref("");

export function useCaaRelatedFilePreview() {
  async function previewFile(
    workspaceRoot: string,
    repoRelPath: string,
    label = "",
  ): Promise<void> {
    const ws = workspaceRoot.trim();
    const rel = repoRelPath.replace(/\\/g, "/").trim();
    if (!ws || !rel) return;

    path.value = rel;
    kindLabel.value = label;
    preview.value = null;
    errorText.value = "";
    open.value = true;
    loading.value = true;

    try {
      preview.value = await fetchCaaDialogFilePreview({ workspaceRoot: ws, repoRelPath: rel });
    } catch (e) {
      errorText.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function close() {
    open.value = false;
    path.value = "";
    kindLabel.value = "";
    preview.value = null;
    errorText.value = "";
  }

  return {
    open,
    loading,
    path,
    kindLabel,
    preview,
    errorText,
    previewFile,
    close,
  };
}
