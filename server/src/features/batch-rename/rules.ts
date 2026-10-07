import path from "node:path";
import { pnwCodeResolveReplacementRules } from "@phoenix-wing/code-core";
import type { RenameTaskDraft } from "./tasks.js";
import type { RenameRules } from "./fileOperations.js";

/** Explicit mappings win over optional stem derivation. Invalid rows never block unrelated rows. */
export function resolveTaskRules(draft: RenameTaskDraft): RenameRules {
  const selected = draft.mappings.flatMap((pair, index) => pair.enabled ? [{ ...pair, row: index + 1 }] : []);
  if (!selected.length) throw new Error("请至少启用一条改名规则");
  const excluded = new Map<number, string>();
  for (const item of selected) if (!item.old.trim() || !item.target.trim() || item.old === item.target) excluded.set(item.row, "须填写不同的旧名、新名");
  const explicit = new Set(selected.map(item => item.old));
  const raw = selected.filter(item => !excluded.has(item.row)).flatMap(item => {
    const values = [{ search: item.old, replace: item.target, row: item.row, derived: false }];
    const oldExtension = path.extname(item.old), targetExtension = path.extname(item.target);
    const realExtension = (extension: string) => /^\.[a-z][a-z0-9]{0,15}$/i.test(extension) && !/^\.(?:assy|drawing|part)$/i.test(extension);
    if (draft.include_stem && realExtension(oldExtension) && realExtension(targetExtension)) {
      const old = item.old.slice(0, item.old.length - path.extname(item.old).length);
      const target = item.target.slice(0, item.target.length - path.extname(item.target).length);
      if (old && target && old !== target && !explicit.has(old)) values.push({ search: old, replace: target, row: item.row, derived: true });
    }
    return values;
  });
  const groups = new Map<string, typeof raw>();
  for (const rule of raw) groups.set(rule.search, [...(groups.get(rule.search) || []), rule]);
  for (const [old, group] of groups) if (new Set(group.map(rule => rule.replace)).size > 1) {
    const reason = `旧名「${old}」的目标冲突：${group.map(rule => `第 ${rule.row} 行${rule.derived ? "（去扩展名）" : ""} →「${rule.replace}」`).join("；")}`;
    for (const rule of group) excluded.set(rule.row, reason);
  }
  // Do not guess how to fold chains or swaps supplied as ordinary direct rules.
  for (const rule of raw) for (const next of groups.get(rule.replace) || []) {
    const reason = `连续改名或交换：第 ${rule.row} 行 → 第 ${next.row} 行，请先合并到最终名称`;
    if (!excluded.has(rule.row)) excluded.set(rule.row, reason);
    if (!excluded.has(next.row)) excluded.set(next.row, reason);
  }
  const accepted = raw.filter(rule => !excluded.has(rule.row));
  let rules = accepted.length ? pnwCodeResolveReplacementRules(accepted) : [];
  if (rules.length) {
    // Protect final names and excluded tokens from accidental substring rewrites.
    const protectedNames = new Set([...accepted.map(rule => rule.replace), ...raw.filter(rule => excluded.has(rule.row)).map(rule => rule.search), ...selected.filter(item => excluded.has(item.row)).map(item => item.old).filter(Boolean)]);
    for (const target of protectedNames) if (!rules.some(rule => rule.search === target)) rules = [...rules, { id: `protected-${rules.length}`, search: target, replace: target, sourceIndex: -1, derived: false }];
  }
  return {
    mappings: selected.filter(item => !excluded.has(item.row)).map(item => ({ old: item.old, target: item.target, chain: [item.old, item.target] })),
    conflicts: [], rules,
    excluded_rules: selected.filter(item => excluded.has(item.row)).map(item => ({ row: item.row, old: item.old, target: item.target, reason: excluded.get(item.row)! })),
  };
}
