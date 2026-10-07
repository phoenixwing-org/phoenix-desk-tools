import type { TaskDraft } from "./api";

/** Configuration only. A source cannot send a plan or authorize execution. */
export type RenameHandoff = { version: 1; workspace: string; source: string; draft: TaskDraft };
export function handoffDraft(value: RenameHandoff, workspace: string): TaskDraft {
  if (value.version !== 1 || value.workspace !== workspace) throw new Error("改名任务来源工作空间已变化，请重新转入");
  const { name, mappings, roots, directories, filenames, contents, include_stem } = value.draft;
  return { name, mappings: mappings.map(({ old, target, enabled }) => ({ old, target, enabled })), roots: [...roots], ...(directories !== undefined ? { directories } : {}), filenames, contents, include_stem };
}
export type QuickRenameMode = "files" | "folders" | "contents";
export function quickRenameDraft(old: string, target: string, workspace: string, current?: TaskDraft, mode?: QuickRenameMode): TaskDraft {
  if (!old.trim() || !target.trim() || old === target) throw new Error("请填写不同的 A 和 B");
  const scopes = mode ? { directories: mode === "folders", filenames: mode === "files", contents: mode === "contents" } : { directories: current?.directories === true, filenames: current?.filenames ?? true, contents: current?.contents ?? false };
  if (!scopes.directories && !scopes.filenames && !scopes.contents) throw new Error("至少勾选一个修改范围");
  return { name: `${old} → ${target}`.slice(0, 120), mappings: [{ old, target, enabled: true }], roots: current?.roots.length ? [...current.roots] : [workspace], ...scopes, include_stem: false };
}
