/** CAA 主页表格 · 路径/模块短显示 */

function normalizeCatDlgRel(catDlgRel: string): string {
  return catDlgRel.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 按 `*UI.m` 模块目录分组；否则取父目录名。 */
export function caaDialogGroupKey(catDlgRel: string): string {
  const norm = normalizeCatDlgRel(catDlgRel);
  const uiMatch = norm.match(/\/([^/]+UI\.m)\//i);
  if (uiMatch) return uiMatch[1];
  const parts = norm.split("/");
  if (parts.length >= 2) return parts[parts.length - 2];
  return "(根目录)";
}

export function caaDialogGroupLabel(groupKey: string): string {
  return groupKey;
}

/** 无解析结果时用文件名 stem 作为对话框名 */
export function dialogNameFromCatDlgRel(catDlgRel: string): string {
  const norm = normalizeCatDlgRel(catDlgRel);
  const base = norm.split("/").pop() ?? norm;
  return base.replace(/\.catdlg$/i, "");
}

/** `.CATDlg` 所在目录（相对工作空间，不含文件名） */
export function catDlgDirRel(catDlgRel: string): string {
  const norm = normalizeCatDlgRel(catDlgRel);
  const lastSlash = norm.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return norm.slice(0, lastSlash);
}

export function shortCatDlgPath(catDlgRel: string): string {
  const norm = normalizeCatDlgRel(catDlgRel);
  const localIdx = norm.indexOf("/LocalInterfaces/");
  if (localIdx >= 0) {
    return norm.slice(localIdx + 1);
  }
  const parts = norm.split("/");
  if (parts.length <= 2) return norm;
  return `…/${parts.slice(-2).join("/")}`;
}

/** 主页「目录」列：短路径且不含 `.CATDlg` 文件名 */
export function shortCatDlgDir(catDlgRel: string): string {
  const dir = catDlgDirRel(catDlgRel);
  if (!dir) return "";
  const localIdx = dir.indexOf("/LocalInterfaces");
  if (localIdx >= 0) {
    return dir.slice(localIdx + 1);
  }
  const parts = dir.split("/");
  if (parts.length <= 2) return dir;
  return `…/${parts.slice(-2).join("/")}`;
}

