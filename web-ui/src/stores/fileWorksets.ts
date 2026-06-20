import { defineStore } from "pinia";
import {
  fetchFileWorksets,
  saveFileWorksets,
  type FileWorkset,
  type FileWorksetPayload,
} from "../api";

const UI_STORAGE_KEY = "phoenix-file-worksets-ui-v1";
const DEFAULT_WORKSPACE_KEY = "__default__";

export type WorksetScopeMode = "all" | "scope" | "index" | "workset";

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
  if (raw === "scope" || raw === "index" || raw === "workset") return raw;
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
      pageScopes[k] = normalizePageScope(v as Partial<PageWorksetScopePrefs>);
    }
  }
  // 迁移旧版 codeUuid 字段
  const legacy = raw as FileWorksetUiPrefs & {
    codeUuid?: Partial<PageWorksetScopePrefs>;
  };
  if (legacy.codeUuid) {
    pageScopes.code_uuid = normalizePageScope(legacy.codeUuid);
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

function mergePaths(existing: string[], incoming: string[]): { merged: string[]; added: number } {
  const set = new Set(existing.map((p) => p.replace(/\\/g, "/")));
  let added = 0;
  for (const raw of incoming) {
    const p = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!p || p.includes("..") || set.has(p)) continue;
    set.add(p);
    added += 1;
  }
  return { merged: [...set].sort(), added };
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
        count: w.paths.length,
      }));
    },
  },
  actions: {
    worksetById(id: string | null | undefined): FileWorkset | null {
      if (!id) return null;
      return this.worksets.find((w) => w.id === id) ?? null;
    },

    getPageScope(pageId: string): PageWorksetScopePrefs {
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
      byWorkspace[key] = this.uiPrefsSnapshot();
      writeUiPersisted({ byWorkspace });
    },

    applyUiPrefs(prefs: FileWorksetUiPrefs) {
      this.activeId = prefs.activeId;
      this.pageScopes = { ...prefs.pageScopes };
    },

    patchPageScope(pageId: string, patch: Partial<PageWorksetScopePrefs>) {
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
        paths: [],
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
        paths: [],
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
              paths: w.paths.filter((p) => p !== norm),
              updated_at: new Date().toISOString(),
            }
          : w,
      );
      this.scheduleSave();
    },

    addPathsToWorkset(
      worksetId: string | null,
      paths: string[],
      source?: string,
    ): { workset: FileWorkset; added: number } {
      const targetId = worksetId ?? this.activeId;
      let ws = targetId ? this.worksetById(targetId) : null;
      if (!ws) {
        ws = this.ensureActiveWorkset();
      }
      const { merged, added } = mergePaths(ws.paths, paths);
      this.worksets = this.worksets.map((w) =>
        w.id === ws!.id
          ? {
              ...w,
              paths: merged,
              source: source ?? w.source,
              updated_at: new Date().toISOString(),
            }
          : w,
      );
      this.activeId = ws.id;
      this.persistUiPrefs();
      this.scheduleSave();
      const updated = this.worksetById(ws.id)!;
      this.lastMessage = added
        ? `已加入「${updated.name}」+${added}（共 ${updated.paths.length}）`
        : `「${updated.name}」无新增（共 ${updated.paths.length}）`;
      return { workset: updated, added };
    },

    addPathsToActive(paths: string[], source?: string) {
      return this.addPathsToWorkset(this.activeId, paths, source);
    },
  },
});
