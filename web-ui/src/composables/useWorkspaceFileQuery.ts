import { ref } from "vue";
import { useAppShell } from "./useAppShell";
import { basenameFromRel, normalizeRepoRel } from "../utils/workspaceFileQuery";

/** 搜索框 + 右侧树选择的共用状态与注册逻辑 */
export function useWorkspaceFileQuery(workbenchTabId?: string) {
  const shell = useAppShell();
  const queryText = ref("");
  const pickedRel = ref("");

  function clearPickedOnInput() {
    pickedRel.value = "";
  }

  function applyTreeSelection(repoRel: string) {
    const norm = normalizeRepoRel(repoRel);
    pickedRel.value = norm;
    queryText.value = basenameFromRel(norm);
  }

  function registerTreeSelectHandler(
    handler: (rel: string) => void | boolean | Promise<void | boolean>,
  ) {
    if (!workbenchTabId) return;
    shell.registerTreeSelect(workbenchTabId, (rel) => handler(rel));
  }

  function unregisterTreeSelectHandler() {
    if (!workbenchTabId) return;
    shell.registerTreeSelect(workbenchTabId, null);
  }

  return {
    queryText,
    pickedRel,
    clearPickedOnInput,
    applyTreeSelection,
    registerTreeSelectHandler,
    unregisterTreeSelectHandler,
  };
}
