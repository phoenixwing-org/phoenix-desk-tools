import { onScopeDispose, ref, watch, type Ref } from "vue";
import { fetchTree, type TreeNode } from "../api";

/** A late pre-rename scan must never replace a newer post-rename tree. */
export function useWorkspaceTreeScan(workspace: Ref<string>, onError: (message: string) => void) {
  const tree = ref<TreeNode | null>(null), fileCount = ref(0), loading = ref(false);
  let revision = 0;
  function clear() {
    revision++; tree.value = null; fileCount.value = 0; loading.value = false;
  }
  watch(workspace, clear, { flush: "sync" });
  onScopeDispose(() => { revision++; });
  async function scan(options: Parameters<typeof fetchTree>[0]): Promise<boolean> {
    const id = ++revision;
    loading.value = true;
    try {
      const data = await fetchTree(options);
      if (id !== revision) return false;
      tree.value = data.tree; fileCount.value = data.file_count;
      return true;
    } catch (error) {
      if (id === revision) onError(String(error));
      return false;
    } finally { if (id === revision) loading.value = false; }
  }
  return { tree, fileCount, loading, scan, clear };
}
