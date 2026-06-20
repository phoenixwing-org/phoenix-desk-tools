import { computed } from "vue";
import {
  useFileWorksetsStore,
  type PageWorksetScopePrefs,
  type WorksetScopeMode,
} from "../stores/fileWorksets";

export type PathScopeBody = {
  scope?: string;
  use_index_scope?: boolean;
  repo_rel_paths?: string[];
};

export function buildPathScopeBody(
  prefs: PageWorksetScopePrefs,
  worksetPaths: string[] | undefined,
): PathScopeBody {
  switch (prefs.scopeMode) {
    case "scope": {
      const s = prefs.scope.trim();
      return s ? { scope: s } : {};
    }
    case "index":
      return { use_index_scope: true };
    case "workset": {
      const paths = worksetPaths ?? [];
      if (!paths.length) {
        throw new Error("所选工作集为空，请先在侧栏添加文件");
      }
      return { repo_rel_paths: paths };
    }
    default:
      return {};
  }
}

/** 工具页接入工作集范围（系统模块 → 各业务页） */
export function useWorksetPageScope(pageId: string) {
  const store = useFileWorksetsStore();

  const prefs = computed(() => store.getPageScope(pageId));

  const scopeMode = computed({
    get: () => prefs.value.scopeMode,
    set: (mode: WorksetScopeMode) => store.patchPageScope(pageId, { scopeMode: mode }),
  });

  const worksetId = computed({
    get: () => prefs.value.worksetId,
    set: (id: string | null) => store.patchPageScope(pageId, { worksetId: id }),
  });

  const scope = computed({
    get: () => prefs.value.scope,
    set: (s: string) => store.patchPageScope(pageId, { scope: s }),
  });

  function buildScanBody(): PathScopeBody {
    const ws = store.worksetById(prefs.value.worksetId);
    return buildPathScopeBody(prefs.value, ws?.paths);
  }

  return {
    scopeMode,
    worksetId,
    scope,
    buildScanBody,
  };
}
