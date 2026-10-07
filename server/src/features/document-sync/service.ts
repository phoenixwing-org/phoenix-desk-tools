import { readRenameHistory } from "../../lib/pnwRenameService.js";
import { applyFileChanges, directory, previewFileChanges } from "../batch-rename/fileOperations.js";
import { resolveRenameChains } from "./rules.js";
export type { SyncPreview, SyncRow, SyncResult } from "../batch-rename/fileOperations.js";

export function documentSyncHistory(workspace: string) {
  const history = readRenameHistory(directory(workspace));
  return { entries: history.slice(0, 2000), total: history.length };
}
export async function previewDocumentSync(workspace: string, body: { log_ids?: number[]; roots?: string[]; filenames?: boolean; contents?: boolean; include_stem?: boolean }) {
  const ws = directory(workspace);
  if (!Array.isArray(body.log_ids) || !body.log_ids.every(Number.isSafeInteger)) throw new Error("无效的改名记录选择");
  return previewFileChanges(ws, body, resolveRenameChains(readRenameHistory(ws), body.log_ids, body.include_stem === true));
}
export const applyDocumentSync = applyFileChanges;

/** Read-only history adapter: no directory scan, executable plan or file writes. */
export function resolveDocumentSync(workspace: string, body: { log_ids?: number[]; include_stem?: boolean }) {
  const ws = directory(workspace);
  if (!Array.isArray(body.log_ids) || !body.log_ids.every(Number.isSafeInteger)) throw new Error("无效的改名记录选择");
  const resolved = resolveRenameChains(readRenameHistory(ws), body.log_ids, body.include_stem === true);
  const pairs = resolved.rules.filter(rule => rule.search !== rule.replace).map(rule => ({ old: rule.search, target: rule.replace, enabled: true }));
  if (pairs.length > 2000) resolved.conflicts.push("最终规则超过 2000 条，请减少选择的记录");
  return { version: 1 as const, mappings: resolved.mappings, conflicts: resolved.conflicts, pairs };
}
