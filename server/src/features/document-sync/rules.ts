import path from "node:path";
import { pnwCodeResolveReplacementRules } from "@phoenix-wing/code-core";
import type { RenameLog } from "../../lib/pnwRenameService.js";

export type SyncMapping = { old: string; target: string; chain: string[] };

/** Identity follows full workspace-relative paths, never just a coincident basename. */
export function resolveRenameChains(history: RenameLog[], selected: number[], includeStem: boolean) {
  if (!selected.length || selected.length > 2000) throw new Error("请选择 1–2000 条改名记录");
  const byId = new Map(history.map(row => [row.id, row]));
  const edges = new Map<string, Set<string>>();
  for (const row of history) {
    const old = row.old_repo_rel_path, target = row.new_repo_rel_path;
    if (!old || !target || old === target) continue;
    const values = edges.get(old) || new Set<string>();
    values.add(target); edges.set(old, values);
  }
  const mappings: SyncMapping[] = [], conflicts: string[] = [];
  for (const id of new Set(selected)) {
    const row = byId.get(id);
    if (!row) throw new Error(`改名记录不存在：${id}`);
    const chain = [row.old_repo_rel_path];
    let current = row.old_repo_rel_path, problem = "";
    while (edges.has(current)) {
      const next = [...edges.get(current)!];
      if (next.length !== 1) { problem = `同一旧路径存在多个去向：${current}`; break; }
      if (chain.includes(next[0])) { problem = `改名记录形成循环或旧名被复用：${chain.concat(next[0]).join(" → ")}`; break; }
      current = next[0]; chain.push(current);
    }
    if (problem) { conflicts.push(problem); continue; }
    // A → B → C: selecting A also covers the intermediate historical name B.
    for (const old of chain.slice(0, -1)) {
      if (!mappings.some(item => item.old === old && item.target === current)) mappings.push({ old, target: current, chain });
    }
  }
  const raw = mappings.flatMap(mapping => {
    const old = path.posix.basename(mapping.old), target = path.posix.basename(mapping.target);
    const candidates = [{ search: old, replace: target }];
    if (includeStem) candidates.push({ search: old.slice(0, old.length - path.posix.extname(old).length), replace: target.slice(0, target.length - path.posix.extname(target).length) });
    return candidates.filter(rule => rule.search && rule.search !== rule.replace);
  });
  // Wing uses longest-match, one-pass literal replacement: generated text is not re-replaced.
  let rules: ReturnType<typeof pnwCodeResolveReplacementRules> = [];
  try { if (raw.length) rules = pnwCodeResolveReplacementRules(raw); }
  catch (error) { conflicts.push(error instanceof Error ? error.message : String(error)); }
  for (const target of new Set(raw.map(rule => rule.replace))) {
    if (rules.some(rule => rule.search === target)) {
      conflicts.push(`最终名称也是另一文件的旧名，无法按文字区分：${target}`);
    } else {
      // Protect final names containing an old token (A -> AA); repeat previews stay idempotent.
      rules = [...rules, { id: `final-${rules.length}`, search: target, replace: target, sourceIndex: -1, derived: false }];
    }
  }
  return { mappings, conflicts: [...new Set(conflicts)], rules };
}
