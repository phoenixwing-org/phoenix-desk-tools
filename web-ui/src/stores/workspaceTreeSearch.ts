import { defineStore } from "pinia";

const STORAGE_KEY = "phoenix-workspace-tree-search-v1";
type SearchState = { workspace: string; query: string; recent: string[] };
const validQuery = (value: unknown): value is string => typeof value === "string" && value.length <= 300;
const historyQuery = (value: string) => value.trim().replace(/\s+/g, " ");
function load(): { searches: SearchState[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(raw)) return { searches: raw.filter(item => typeof item?.workspace === "string" && item.workspace && validQuery(item.query)).slice(0, 20).map(item => ({
      workspace: item.workspace, query: item.query,
      recent: [...new Set<string>((Array.isArray(item.recent) ? item.recent : []).filter(validQuery).map(historyQuery).filter(Boolean))].slice(0, 5),
    })) };
  } catch { /* Local preferences remain usable when storage is unavailable. */ }
  return { searches: [] };
}

/** Browser-local search preferences only; never uploaded or saved into workspace files. */
export const useWorkspaceTreeSearchStore = defineStore("workspaceTreeSearch", {
  state: load,
  actions: {
    queryFor(workspace: string) { return this.searches.find(item => item.workspace === workspace)?.query ?? ""; },
    recentFor(workspace: string) { return this.searches.find(item => item.workspace === workspace)?.recent ?? []; },
    setQuery(workspace: string, query: string) {
      if (!workspace || !validQuery(query)) return;
      const previous = this.searches.find(item => item.workspace === workspace);
      this.searches = [{ workspace, query, recent: previous?.recent ?? [] }, ...this.searches.filter(item => item.workspace !== workspace)].slice(0, 20);
      this.persist();
    },
    remember(workspace: string) {
      const item = this.searches.find(entry => entry.workspace === workspace);
      if (!item) return;
      const query = historyQuery(item.query);
      if (!query) return;
      item.recent = [query, ...item.recent.filter(value => value.toLowerCase() !== query.toLowerCase())].slice(0, 5);
      this.persist();
    },
    persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.searches)); } catch { /* Pinia still remembers within this session. */ }
    },
  },
});
