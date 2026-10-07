import { randomUUID } from "node:crypto";
import { loadWorkspacePrefsSnapshot, replaceWorkspaceSection } from "../../lib/workspacePrefsService.js";
import { directory } from "./fileOperations.js";

export type RenamePair = { old: string; target: string; enabled: boolean };
export type RenameTaskDraft = { name: string; mappings: RenamePair[]; roots: string[]; directories?: boolean; filenames: boolean; contents: boolean; include_stem: boolean };
export type RenameAttempt = { id: string; revision: number; at: string; kind: "preview" | "apply"; state: "done" | "failed" | "running"; matched?: number; applied?: number; failed?: number; message?: string };
export type RenameTask = RenameTaskDraft & { id: string; revision: number; updated_at: string; attempts: RenameAttempt[] };
const SECTION = "batch_rename_tasks_v1";
const active = new Set<string>();
const key = (workspace: string, id: string) => JSON.stringify([workspace, id]);
function string(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit || /[\x00-\x1f]/.test(value)) throw new Error("任务字段无效或过长");
  return value;
}
export function taskDraft(value: unknown): RenameTaskDraft {
  if (!value || typeof value !== "object") throw new Error("无效的改名任务");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.mappings) || input.mappings.length > 2000 || !Array.isArray(input.roots) || input.roots.length > 12) throw new Error("任务最多 2000 条规则、12 个目录");
  return {
    name: string(input.name, 120).trim() || "未命名任务",
    mappings: input.mappings.map(row => ({ old: string(row?.old, 4096), target: string(row?.target, 4096), enabled: row?.enabled !== false })),
    roots: [...new Set(input.roots.map(root => string(root, 4096).trim()).filter(Boolean))],
    directories: input.directories === true, filenames: input.filenames !== false, contents: input.contents !== false, include_stem: input.include_stem === true,
  };
}
export function listRenameTasks(workspace: string): RenameTask[] {
  const ws = directory(workspace);
  const stored = loadWorkspacePrefsSnapshot(ws)[SECTION] as { tasks?: RenameTask[] } | undefined;
  return Array.isArray(stored?.tasks) ? stored.tasks : [];
}
export function getRenameTask(workspace: string, id: string, revision?: number): RenameTask {
  const task = listRenameTasks(workspace).find(item => item.id === id);
  if (!task) throw new Error("改名任务不存在，请刷新任务列表");
  if (revision !== undefined && task.revision !== revision) throw new Error("任务已被修改，请重新载入并预览");
  return task;
}
function persist(workspace: string, tasks: RenameTask[]) { replaceWorkspaceSection(workspace, SECTION, { tasks }); }
export function saveRenameTask(workspace: string, input: { id?: string; revision?: number; draft: unknown }): RenameTask {
  const ws = directory(workspace), tasks = listRenameTasks(ws), draft = taskDraft(input.draft);
  const previous = input.id ? getRenameTask(ws, input.id, input.revision) : undefined;
  if (previous && (!Number.isSafeInteger(input.revision) || active.has(key(ws, previous.id)))) throw new Error("任务运行中或版本不匹配，请稍后刷新");
  if (!previous && tasks.length >= 100) throw new Error("当前工作空间最多保留 100 个任务");
  const task = { ...draft, id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1, updated_at: new Date().toISOString(), attempts: previous?.attempts || [] };
  persist(ws, [task, ...tasks.filter(item => item.id !== task.id)]);
  return task;
}
export function recordAttempt(workspace: string, id: string, attempt: RenameAttempt) {
  const tasks = listRenameTasks(workspace), task = getRenameTask(workspace, id);
  const updated = { ...task, attempts: [attempt, ...task.attempts.filter(item => item.id !== attempt.id)].slice(0, 30) };
  persist(workspace, tasks.map(item => item.id === id ? updated : item));
}
export function lockTask(workspace: string, id: string) {
  const identity = key(workspace, id);
  if (active.has(identity)) throw new Error("该任务正在运行，请稍后重试");
  active.add(identity);
  return () => active.delete(identity);
}
