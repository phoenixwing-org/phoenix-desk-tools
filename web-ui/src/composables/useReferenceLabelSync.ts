import { ref } from "vue";
import { applyReferenceLabelCorrections } from "../api";
import { basenameFromRel } from "../utils/workspaceFileQuery";

/** 将装配/图纸内引用实例 Label 同步为被引用 FCStd 的规则显示名（与改名写回第二步同 API）。 */
export function useReferenceLabelSync(getTargetRepoRel: () => string) {
  const syncing = ref(false);

  function targetBasename() {
    const rel = getTargetRepoRel().trim();
    if (!rel) return "";
    return basenameFromRel(rel);
  }

  async function syncIncomingLabels(hostRepoRelPaths: string[], transitive = true) {
    const rel = getTargetRepoRel().trim();
    const base = targetBasename();
    if (!rel || !base) throw new Error("未指定目标文件");
    if (!hostRepoRelPaths.length) throw new Error("请至少选择一个宿主装配");
    syncing.value = true;
    try {
      return await applyReferenceLabelCorrections(hostRepoRelPaths, {
        oldBasename: base,
        newBasename: base,
        targetRepoRel: rel,
        transitive,
        labelScope: "incoming",
      });
    } finally {
      syncing.value = false;
    }
  }

  async function syncHostAllLabels(hostRepoRel?: string) {
    const rel = (hostRepoRel ?? getTargetRepoRel()).trim();
    const base = basenameFromRel(rel);
    if (!rel || !base) throw new Error("未指定宿主文件");
    syncing.value = true;
    try {
      return await applyReferenceLabelCorrections([rel], {
        oldBasename: base,
        newBasename: base,
        targetRepoRel: rel,
        labelScope: "host_all",
        transitive: true,
      });
    } finally {
      syncing.value = false;
    }
  }

  return { syncing, syncIncomingLabels, syncHostAllLabels };
}
