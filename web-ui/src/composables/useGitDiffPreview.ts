import { ref } from "vue";
import { fetchGitDiff } from "../api";
import { useAppShell } from "./useAppShell";
import type { GitFileDiff } from "../types/gitWorkspace";

/** 全局单例：业务页表内 👁 预览 diff（过渡弹层，Tab 落地前共用） */
const open = ref(false);
const loading = ref(false);
const path = ref("");
const diff = ref<GitFileDiff | null>(null);
const scope = ref<"worktree" | "staged">("worktree");

export function useGitDiffPreview() {
  const shell = useAppShell();

  async function preview(repoPath: string, diffScope: "worktree" | "staged" = "worktree") {
    const rel = repoPath.trim();
    if (!rel) return;
    path.value = rel;
    scope.value = diffScope;
    diff.value = null;
    open.value = true;
    loading.value = true;
    try {
      diff.value = await fetchGitDiff(rel, diffScope);
    } catch (e) {
      shell.setStatus(String(e));
      close();
    } finally {
      loading.value = false;
    }
  }

  function close() {
    open.value = false;
    path.value = "";
    diff.value = null;
  }

  return {
    open,
    loading,
    path,
    diff,
    scope,
    preview,
    close,
  };
}
