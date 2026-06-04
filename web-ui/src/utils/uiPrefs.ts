/** 浏览器 localStorage 中的 UI 偏好（跨会话，与工作区无关） */

const STORAGE_KEY = "phoenix.web-ui.prefs.v1";

type UiPrefsV1 = {
  assemblyTreeDepth?: "first" | "full";
};

function readPrefs(): UiPrefsV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as UiPrefsV1;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writePrefs(patch: Partial<UiPrefsV1>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* quota / private mode */
  }
}

/** 装配树展开深度；未保存过时默认为「全部层级」 */
export function getAssemblyTreeDepth(): "first" | "full" {
  const d = readPrefs().assemblyTreeDepth;
  return d === "first" || d === "full" ? d : "full";
}

export function setAssemblyTreeDepth(depth: "first" | "full"): void {
  writePrefs({ assemblyTreeDepth: depth });
}
