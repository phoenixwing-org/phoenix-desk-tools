import { jsonFetch, type RenameLog } from "../../api";
export type { RenameRow as SyncRow, RenamePreview as SyncPreview, RenameResult as SyncResult, RenameResults as SyncResults } from "../batch-rename/api";
export type SyncOptions = { log_ids: number[]; roots: string[]; filenames: boolean; contents: boolean; include_stem: boolean };
function request<T>(workspace: string, action: string, body?: unknown) {
  return jsonFetch<T>(`/api/document-sync/${action}?workspace=${encodeURIComponent(workspace)}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
}
export const loadSyncHistory = (workspace: string) => request<{ entries: RenameLog[]; total: number }>(workspace, "history");

export type SyncResolution = { version: 1; mappings: Array<{ old: string; target: string; chain: string[] }>; conflicts: string[]; pairs: Array<{ old: string; target: string; enabled: boolean }> };
export const resolveSync = (workspace: string, body: Pick<SyncOptions, "log_ids" | "include_stem">) => request<SyncResolution>(workspace, "resolve", body);
