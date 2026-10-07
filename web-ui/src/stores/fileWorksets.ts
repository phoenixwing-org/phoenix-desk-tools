import { defineStore } from "pinia";
import { RETIRED_CODE_PAGE_IDS } from "../constants/retiredCodePages";
import {
  fetchFileWorksets,
  pruneMissingFileWorksetPaths,
  saveFileWorksets,
  type FileWorkset,
  type FileWorksetPayload,
  type WorksetEntry,
} from "../api";

const UI_STORAGE_KEY = "phoenix-file-worksets-ui-v1";
const DEFAULT_WORKSPACE_KEY = "__default__";

export type WorksetScopeMode = "all" | "scope" | "workset";

export type PageWorksetScopePrefs = {
  scopeMode: WorksetScopeMode;
  worksetId: string | null;
  scope: string;
};

export type FileWorksetUiPrefs = {
  activeId: string | null;
  pageScopes: Record<string, PageWorksetScopePrefs>;
};

type PersistedUi = {
  byWorkspace?: Record<string, FileWorksetUiPrefs>;
};

function defaultPageScope(): PageWorksetScopePrefs {
  return {
    scopeMode: "all",
    worksetId: null,
    scope: "",
  };
}

function defaultUiPrefs(): FileWorksetUiPrefs {
  return {
    activeId: null,
    pageScopes: {},
  };
}

function readUiPersisted(): PersistedUi {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedUi) : {};
  } catch {
    return {};
  }
}

function writeUiPersisted(data: PersistedUi) {
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(data));
}

function workspaceKey(path: string): string {
  const ws = path.trim();
  return ws || DEFAULT_WORKSPACE_KEY;
}

function normalizeScopeMode(raw: unknown): WorksetScopeMode {
  if (raw === "scope" || raw === "workset") return raw;
  return "all";
}

function normalizePageScope(raw: Partial<PageWorksetScopePrefs> | undefined): PageWorksetScopePrefs {
  const base = defaultPageScope();
  if (!raw) return base;
  return {
    scopeMode: normalizeScopeMode(raw.scopeMode),
    worksetId: typeof raw.worksetId === "string" ? raw.worksetId : base.worksetId,
    scope: typeof raw.scope === "string" ? raw.scope : base.scope,
  };
}

function normalizeUiPrefs(raw: Partial<FileWorksetUiPrefs> | undefined): FileWorksetUiPrefs {
  const base = defaultUiPrefs();
  if (!raw) return base;
  const pageScopes: Record<string, PageWorksetScopePrefs> = {};
  if (raw.pageScopes && typeof raw.pageScopes === "object") {
    for (const [k, v] of Object.entries(raw.pageScopes)) {
      if (RETIRED_CODE_PAGE_IDS.has(k)) continue;
      pageScopes[k] = normalizePageScope(v as Partial<PageWorksetScopePrefs>);
    }
  }
  return {
    activeId: typeof raw.activeId === "string" ? raw.activeId : base.activeId,
    pageScopes,
  };
}

function newWorksetId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function worksetEntries(ws: FileWorkset): WorksetEntry[] {
  if (ws.entries?.length) return ws.entries;
  // 旧格式兼容：paths → entries(type="file")
  return (ws.paths || []).map((p) => ({ path: p, type: "file" as const }));
}

function mergeEntries(
  existing: WorksetEntry[],
  incoming: (string | WorksetEntry)[],
): { merged: WorksetEntry[]; added: number } {
  const seen = new Set(existing.map((e) => e.path));
  let added = 0;
  for (const raw of incoming) {
    const p = (typeof raw === "string" ? raw : raw.path).trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const t = (typeof raw === "string" ? "file" : raw.type || "file") as WorksetEntry["type"];
    if (!p || p.includes("..") || seen.has(p)) continue;
    seen.add(p);
    existing.push({ path: p, type: t });
    added += 1;
  }
  existing.sort((a, b) => a.path.localeCompare(b.path));
  return { merged: existing, added };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useFileWorksetsStore = defineStore("fileWorksets", {
  state: () => ({
    hydrated: false,
    loading: false,
    saving: false,
    activeWorkspaceKey: DEFAULT_WORKSPACE_KEY,
    workspacePath: "",
    worksets: [] as FileWorkset[],
    pathDisplay: "",
    activeId: null as string | null,
    pageScopes: {} as Record<string, PageWorksetScopePrefs>,
    lastMessage: "",
  }),
  getters: {
    activeWorkset(state): FileWorkset | null {
      if (!state.activeId) return null;
      return state.worksets.find((w) => w.id === state.activeId) ?? null;
    },
    worksetOptions(state): { id: string; label: string; count: number }[] {
      return state.worksets.map((w) => ({
        id: w.id,
        label: w.name,
        count: worksetEntries(w).length,
      }));
    },
  },
  actions: {
    worksetById(id: string | null | undefined): FileWorkset | null {
      if (!id) return null;
      return this.worksets.find((w) => w.id === id) ?? null;
    },

    getPageScope(pageId: string): PageWorksetScopePrefs {
      if (RETIRED_CODE_PAGE_IDS.has(pageId)) return defaultPageScope();
      return this.pageScopes[pageId] ?? defaultPageScope();
    },

    uiPrefsSnapshot(): FileWorksetUiPrefs {
      return {
        activeId: this.activeId,
        pageScopes: { ...this.pageScopes },
      };
    },

    persistUiPrefs() {
      const key = this.activeWorkspaceKey;
      const data = readUiPersisted();
      const byWorkspace = { ...(data.byWorkspace ?? {}) };
      const stored = byWorkspace[key];
      const current = this.uiPrefsSnapshot();
      // Runtime excludes retired tools; saving current preferences must not erase
      // their stored scopes, legacy fields, or preferences belonging to other versions.
      byWorkspace[key] = {
        ...stored,
        ...current,
        pageScopes: { ...stored?.pageScopes, ...current.pageScopes },
      };
      writeUiPersisted({ ...data, byWorkspace });
    },

    applyUiPrefs(prefs: FileWorksetUiPrefs) {
      this.activeId = prefs.activeId;
      this.pageScopes = { ...prefs.pageScopes };
    },

    patchPageScope(pageId: string, patch: Partial<PageWorksetScopePrefs>) {
      if (RETIRED_CODE_PAGE_IDS.has(pageId)) return;
      const cur = this.getPageScope(pageId);
      this.pageScopes = {
        ...this.pageScopes,
        [pageId]: { ...cur, ...patch },
      };
      this.persistUiPrefs();
    },

    setActiveId(id: string | null) {
      this.activeId = id;
      this.persistUiPrefs();
    },

    applyPayload(payload: FileWorksetPayload) {
      this.worksets = payload.worksets ?? [];
      this.pathDisplay = payload.path_display ?? "";
      if (this.activeId && !this.worksets.some((w) => w.id === this.activeId)) {
        this.activeId = this.worksets[0]?.id ?? null;
        this.persistUiPrefs();
      }
      for (const [pageId, prefs] of Object.entries(this.pageScopes)) {
        if (prefs.worksetId && !this.worksets.some((w) => w.id === prefs.worksetId)) {
          this.patchPageScope(pageId, { worksetId: this.activeId });
        }
      }
    },

    scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void this.flushSave();
      }, 400);
    },

    async flushSave(): Promise<boolean> {
      if (!this.hydrated) return false;
      this.saving = true;
      try {
        const out = await saveFileWorksets({ worksets: this.worksets });
        this.applyPayload(out);
        return true;
      } catch {
        return false;
      } finally {
        this.saving = false;
      }
    },

    async pruneMissing(worksetId?: string): Promise<number> {
      this.saving = true;
      try {
        const out = await pruneMissingFileWorksetPaths(
          worksetId ? { workset_id: worksetId } : undefined,
        );
        this.applyPayload(out);
        const removed = out.prune_removed ?? 0;
        if (removed) {
          this.lastMessage = `已剔除 ${removed} 条缺失路径`;
        } else {
          this.lastMessage = "无缺失路径";
        }
        return removed;
      } finally {
        this.saving = false;
      }
    },

    async hydrate(workspacePath: string, force = false): Promise<void> {
      const key = workspaceKey(workspacePath);
      if (this.hydrated && !force && this.activeWorkspaceKey === key && this.workspacePath === workspacePath) {
        return;
      }
      this.loading = true;
      this.activeWorkspaceKey = key;
      this.workspacePath = workspacePath;
      const ui = normalizeUiPrefs(readUiPersisted().byWorkspace?.[key]);
      this.applyUiPrefs(ui);
      try {
        const payload = await fetchFileWorksets();
        this.applyPayload(payload);
        if (!this.activeId && this.worksets.length) {
          this.activeId = this.worksets[0].id;
          this.persistUiPrefs();
        }
      } catch {
        this.worksets = [];
        this.pathDisplay = "";
      } finally {
        this.loading = false;
        this.hydrated = true;
      }
    },

    ensureActiveWorkset(name = "未命名 1"): FileWorkset {
      if (this.activeId) {
        const existing = this.worksetById(this.activeId);
        if (existing) return existing;
      }
      const ws: FileWorkset = {
        id: newWorksetId(),
        name,
        entries: [],
        source: "",
        updated_at: new Date().toISOString(),
      };
      this.worksets = [...this.worksets, ws];
      this.activeId = ws.id;
      this.persistUiPrefs();
      this.scheduleSave();
      return ws;
    },

    createWorkset(name?: string): FileWorkset {
      const n = (name ?? "").trim() || `未命名 ${this.worksets.length + 1}`;
      const ws: FileWorkset = {
        id: newWorksetId(),
        name: n,
        entries: [],
        source: "",
        updated_at: new Date().toISOString(),
      };
      this.worksets = [...this.worksets, ws];
      this.activeId = ws.id;
      this.persistUiPrefs();
      this.scheduleSave();
      return ws;
    },

    renameWorkset(id: string, name: string) {
      const n = name.trim();
      if (!n) return;
      this.worksets = this.worksets.map((w) =>
        w.id === id ? { ...w, name: n, updated_at: new Date().toISOString() } : w,
      );
      this.scheduleSave();
    },

    deleteWorkset(id: string) {
      this.worksets = this.worksets.filter((w) => w.id !== id);
      if (this.activeId === id) {
        this.activeId = this.worksets[0]?.id ?? null;
      }
      for (const pageId of Object.keys(this.pageScopes)) {
        if (this.pageScopes[pageId]?.worksetId === id) {
          this.patchPageScope(pageId, { worksetId: this.activeId });
        }
      }
      this.persistUiPrefs();
      this.scheduleSave();
    },

    removePath(worksetId: string, path: string) {
      const norm = path.trim().replace(/\\/g, "/");
      this.worksets = this.worksets.map((w) =>
        w.id === worksetId
          ? {
              ...w,
              entries: worksetEntries(w).filter((e) => e.path !== norm),
              updated_at: new Date().toISOString(),
            }
          : w,
      );
      this.scheduleSave();
    },

    addEntriesToWorkset(
      worksetId: string | null,
      entries: (string | WorksetEntry)[],
      source?: string,
    ): { workset: FileWorkset; added: number } {
      const targetId = worksetId ?? this.activeId;
      let ws = targetId ? this.worksetById(targetId) : null;
      if (!ws) {
        ws = this.ensureActiveWorkset();
      }
      const { merged, added } = mergeEntries([...worksetEntries(ws)], entries);
      this.worksets = this.worksets.map((w) =>
        w.id === ws!.id
          ? {
              ...w,
              entries: merged,
              source: source ?? w.source,
              updated_at: new Date().toISOString(),
            }
          : w,
      );
      this.activeId = ws.id;
      this.persistUiPrefs();
      this.scheduleSave();
      const updated = this.worksetById(ws.id)!;
      const entryCount = worksetEntries(updated).length;
      this.lastMessage = added
        ? `已加入「${updated.name}」+${added}（共 ${entryCount}）`
        : `「${updated.name}」无新增（共 ${entryCount}）`;
      return { workset: updated, added };
    },

    addPathsToActive(paths: string[], source?: string) {
      return this.addEntriesToWorkset(this.activeId, paths, source);
    },
  },
});
