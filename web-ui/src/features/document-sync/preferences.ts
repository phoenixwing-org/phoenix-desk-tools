import { defineStore } from "pinia";
import type { SyncOptions, SyncPreview, SyncRow } from "./api";

type FileSelection = { scope: string; files: string[] };
type WorkspaceOptions = { workspace: string; options: SyncOptions; fileSelection?: FileSelection };
const STORAGE_KEY = "phoenix-document-sync-options-v1";
const validString = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 && !value.includes("\0");

function scopeOptions(value: unknown): SyncOptions {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    log_ids: [...new Set((Array.isArray(input.log_ids) ? input.log_ids : []).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))].slice(0, 2000),
    roots: [...new Set((Array.isArray(input.roots) ? input.roots : []).filter(validString).map(path => path.trim()).filter(Boolean))].slice(0, 12),
    filenames: typeof input.filenames === "boolean" ? input.filenames : true,
    contents: typeof input.contents === "boolean" ? input.contents : true,
    include_stem: typeof input.include_stem === "boolean" ? input.include_stem : false,
  };
}
function fileSelection(value: unknown): FileSelection | undefined {
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  if (typeof input.scope !== "string" || input.scope.length > 1_000_000 || !Array.isArray(input.files)) return;
  return { scope: input.scope, files: [...new Set(input.files.filter((key): key is string => typeof key === "string" && key.length <= 16384))].slice(0, 2000) };
}
function selectionScope(options: SyncOptions, preview: SyncPreview): string {
  return JSON.stringify({
    ...scopeOptions(options), log_ids: [...options.log_ids].sort((a, b) => a - b),
    roots: [...preview.roots].sort(),
    mappings: preview.mappings.map(mapping => [mapping.old, mapping.target]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
}
const fileKey = (row: SyncRow) => JSON.stringify([row.root, row.rel, row.target]);
function load(): { workspaces: WorkspaceOptions[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(raw)) return { workspaces: raw
      .filter(item => validString(item?.workspace) && item.workspace)
      .slice(0, 20).map(item => ({ workspace: item.workspace, options: scopeOptions(item.options), fileSelection: fileSelection(item.fileSelection) })) };
  } catch { /* Local UI preferences are optional; no operation is restored. */ }
  return { workspaces: [] };
}

/** Remember selection identities, never executable plan IDs, diffs or execution results. */
export const useDocumentSyncPreferencesStore = defineStore("documentSyncPreferences", {
  state: load,
  actions: {
    optionsFor(workspace: string): SyncOptions {
      return scopeOptions(this.workspaces.find(item => item.workspace === workspace)?.options);
    },
    saveOptions(workspace: string, options: SyncOptions) {
      if (!workspace || !validString(workspace)) return;
      const previous = this.workspaces.find(item => item.workspace === workspace);
      this.workspaces = [{ workspace, options: scopeOptions(options), fileSelection: previous?.fileSelection }, ...this.workspaces.filter(item => item.workspace !== workspace)].slice(0, 20);
      this.persist();
    },
    restoreFileSelection(workspace: string, options: SyncOptions, preview: SyncPreview): string[] {
      const saved = this.workspaces.find(item => item.workspace === workspace)?.fileSelection;
      if (!saved || preview.conflicts.length || saved.scope !== selectionScope(options, preview)) return [];
      const keys = new Set(saved.files);
      return preview.rows.filter(row => row.eligible && keys.has(fileKey(row))).map(row => row.id);
    },
    saveFileSelection(workspace: string, options: SyncOptions, preview: SyncPreview, selected: string[]) {
      if (!workspace || !validString(workspace) || preview.conflicts.length) return;
      const ids = new Set(selected);
      const selection = fileSelection({ scope: selectionScope(options, preview), files: preview.rows.filter(row => row.eligible && ids.has(row.id)).map(fileKey) });
      this.workspaces = [{ workspace, options: scopeOptions(options), fileSelection: selection }, ...this.workspaces.filter(item => item.workspace !== workspace)].slice(0, 20);
      this.persist();
    },
    persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspaces)); } catch { /* Pinia retains this session's settings. */ }
    },
  },
});
