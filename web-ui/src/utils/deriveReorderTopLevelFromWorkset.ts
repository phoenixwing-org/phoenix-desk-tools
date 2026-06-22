/** 从工作集 repo_rel_path 推导一级条目名（与工作空间根下 `list_reorder_top_level_entries` 对齐） */
export function deriveReorderTopLevelFromWorkset(
  worksetPaths: readonly string[],
  validTopLevelNames: readonly string[],
): string[] {
  const valid = new Set(validTopLevelNames);
  const derived = new Set<string>();
  for (const raw of worksetPaths) {
    const p = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!p || p.includes("..")) continue;
    const top = p.split("/").filter(Boolean)[0];
    if (top && valid.has(top)) derived.add(top);
  }
  return [...derived].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
