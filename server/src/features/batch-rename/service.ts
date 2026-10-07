import { previewDirectoryChanges, applyDirectoryChanges } from "./directoryOperations.js";
import { randomUUID } from "node:crypto";
import { applyFileChanges, directory, previewFileChanges } from "./fileOperations.js";
import { getRenameTask, lockTask, recordAttempt, type RenameAttempt } from "./tasks.js";
import { resolveTaskRules } from "./rules.js";

export async function previewRenameTask(workspace: string, body: { task_id: string; revision: number }) {
  const ws = directory(workspace), task = getRenameTask(ws, body.task_id, body.revision);
  const unlock = lockTask(ws, task.id);
  const attempt: RenameAttempt = { id: randomUUID(), revision: task.revision, at: new Date().toISOString(), kind: "preview", state: "running" };
  try {
    const preview = await (task.directories ? previewDirectoryChanges : previewFileChanges)(ws, task, resolveTaskRules(task), `task:${task.id}:${task.revision}`);
    recordAttempt(ws, task.id, { ...attempt, state: preview.conflicts.length ? "failed" : "done", matched: preview.rows.length, message: preview.conflicts.join("\n") });
    return preview;
  } catch (error) {
    recordAttempt(ws, task.id, { ...attempt, state: "failed", message: String(error) }); throw error;
  } finally { unlock(); }
}
export async function applyRenameTask(workspace: string, body: { task_id: string; revision: number; plan_id: string; ids: string[]; confirmed: boolean }) {
  const ws = directory(workspace), task = getRenameTask(ws, body.task_id, body.revision);
  const unlock = lockTask(ws, task.id);
  const attempt: RenameAttempt = { id: randomUUID(), revision: task.revision, at: new Date().toISOString(), kind: "apply", state: "running" };
  try {
    // Persist the start before any file write; a crash leaves a visible, non-replayable attempt.
    recordAttempt(ws, task.id, attempt);
    const result = await (task.directories ? applyDirectoryChanges : applyFileChanges)(ws, body, `task:${task.id}:${task.revision}`);
    recordAttempt(ws, task.id, { ...attempt, state: result.failed ? "failed" : "done", applied: result.applied, failed: result.failed, message: result.results.filter(row => row.status === "failed").map(row => `${row.rel}：${row.message}`).join("\n").slice(0, 8000) });
    return result;
  } catch (error) {
    recordAttempt(ws, task.id, { ...attempt, state: "failed", message: String(error) }); throw error;
  } finally { unlock(); }
}
