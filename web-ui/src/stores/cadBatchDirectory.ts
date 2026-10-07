import { defineStore } from "pinia";
import { fetchCadBatchDirectories, pickWorkspaceDirectory, validateCadBatchDirectory } from "../api";

type DirectoryState = {
  directory: string;
  directories: { name: string; path: string }[];
  error: string;
  discoveryError: string;
  loaded: boolean;
  loading: boolean;
  pending: boolean;
  revision: number;
  locks: string[];
};

const STORAGE_PREFIX = "phoenix-cad-batch-directory-v1:";
function loadDirectory(workspace: string): string {
  if (!workspace) return ".";
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + encodeURIComponent(workspace)) || "null");
    if (typeof saved?.directory === "string") return saved.directory;
  } catch { /* Unavailable or corrupt storage uses the initial scope; nothing auto-runs. */ }
  return ".";
}
function saveDirectory(workspace: string, directory: string) {
  if (!workspace) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + encodeURIComponent(workspace), JSON.stringify({ directory }));
  } catch { /* Pinia still shares the selection in-session when storage is unavailable. */ }
}

/** Persist only the workspace-scoped selection, never previews, locks or execution state. */
export const useCadBatchDirectoryStore = defineStore("cadBatchDirectory", {
  state: () => ({ workspaces: {} as Record<string, DirectoryState> }),
  actions: {
    entry(workspace: string): DirectoryState {
      this.workspaces[workspace] ??= {
        directory: loadDirectory(workspace), directories: [], error: "", discoveryError: "", loaded: false,
        loading: false, pending: false, revision: 0, locks: [],
      };
      // Read back through Pinia: the first ??= expression returns the raw object,
      // leaving consumers of the initial "." outside Vue's change tracking.
      return this.workspaces[workspace];
    },
    setDirectory(workspace: string, value: string) {
      const state = this.entry(workspace);
      if (state.locks.length || state.pending || !workspace) return;
      if (state.directory !== value) { state.directory = value; state.revision++; }
      state.error = "";
      saveDirectory(workspace, state.directory);
    },
    lock(workspace: string, owner: string, busy: boolean) {
      const state = this.entry(workspace);
      state.locks = state.locks.filter(value => value !== owner);
      if (busy) state.locks.push(owner);
    },
    async refresh(workspace: string, force = false) {
      if (!workspace) return;
      const state = this.entry(workspace);
      if (state.loading || (state.loaded && !force)) return;
      state.loading = true;
      try {
        const result = await fetchCadBatchDirectories(workspace);
        if (result.workspace !== workspace) throw new Error("工作空间已改变，请重新选择目录");
        state.directories = result.directories;
        state.loaded = true;
        state.discoveryError = "";
      } catch (error) { state.discoveryError = String(error); }
      finally { state.loading = false; }
    },
    async validate(workspace: string, isCurrent: () => boolean = () => true): Promise<boolean> {
      const state = this.entry(workspace);
      if (state.pending || state.locks.length) return false;
      if (!workspace || !state.directory.trim()) {
        state.error = "请选择搜索目录；工作空间根目录请明确填写 .";
        return false;
      }
      const revision = state.revision;
      state.pending = true;
      try {
        const result = await validateCadBatchDirectory(workspace, state.directory);
        if (!isCurrent() || revision !== state.revision || result.workspace !== workspace) return false;
        if (result.directory !== state.directory) { state.directory = result.directory; state.revision++; }
        state.error = "";
        saveDirectory(workspace, state.directory);
        return true;
      } catch (error) { if (isCurrent()) state.error = String(error); return false; }
      finally { state.pending = false; }
    },
    async pick(workspace: string, isCurrent: () => boolean): Promise<void> {
      const state = this.entry(workspace);
      if (!workspace || state.pending || state.locks.length) return;
      state.pending = true;
      const revision = state.revision;
      try {
        let hint = workspace;
        if (state.directory.trim() && state.directory.trim() !== ".") {
          try {
            const checked = await validateCadBatchDirectory(workspace, state.directory);
            if (checked.workspace === workspace && checked.directory !== ".") {
              hint = `${workspace.replace(/[\\/]+$/, "")}/${checked.directory}`;
            }
          } catch { /* Invalid/unavailable input starts at the workspace instead. */ }
        }
        if (!isCurrent() || revision !== state.revision) return;
        const result = await pickWorkspaceDirectory(hint);
        if (result.cancelled || !isCurrent() || revision !== state.revision) return;
        const checked = await validateCadBatchDirectory(workspace, result.path);
        if (!isCurrent() || revision !== state.revision || checked.workspace !== workspace) return;
        state.directory = checked.directory;
        state.revision++;
        state.error = "";
        saveDirectory(workspace, state.directory);
      } catch (error) { if (isCurrent()) state.error = String(error); }
      finally { state.pending = false; }
    },
  },
});
