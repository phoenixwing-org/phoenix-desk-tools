import { defineStore } from "pinia";

const STORAGE_KEY = "phoenix-workspace-tree-expansion-v1";
type DirectoryState = { path: string; expanded: boolean };
type WorkspaceState = { workspace: string; directories: DirectoryState[] };
const validPath = (value: unknown): value is string => typeof value === "string" && value.length <= 4096;
function load(): { workspaces: WorkspaceState[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(raw)) return { workspaces: raw
      .filter(item => validPath(item?.workspace) && item.workspace && Array.isArray(item.directories))
      .slice(0, 20).map(item => ({ workspace: item.workspace, directories: item.directories
        .filter((entry: DirectoryState) => validPath(entry?.path) && typeof entry.expanded === "boolean")
        .slice(0, 5000).map((entry: DirectoryState) => ({ path: entry.path, expanded: entry.expanded })) })) };
  } catch { /* Browser-local preferences are optional. */ }
  return { workspaces: [] };
}

/** UI preferences only: never written into a user's workspace or CAD files. */
export const useWorkspaceTreeExpansionStore = defineStore("workspaceTreeExpansion", {
  state: load,
  actions: {
    statesFor(workspace: string): DirectoryState[] {
      return this.workspaces.find(item => item.workspace === workspace)?.directories ?? [];
    },
    setExpanded(workspace: string, path: string, expanded: boolean) {
      if (!workspace || !validPath(workspace) || !validPath(path)) return;
      const directories = [{ path, expanded }, ...this.statesFor(workspace).filter(item => item.path !== path)].slice(0, 5000);
      this.workspaces = [{ workspace, directories }, ...this.workspaces.filter(item => item.workspace !== workspace)].slice(0, 20);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.workspaces)); } catch { /* Keep the Pinia session state. */ }
    },
  },
});
