import { defineStore } from "pinia";
import type { CodeRenamePrefs, RenameLevel } from "../api";

export const CODE_RENAME_LEVEL_OPTIONS: { id: RenameLevel; label: string }[] = [
  { id: "dir", label: "文件夹" },
  { id: "file", label: "文件" },
  { id: "text", label: "文本内容" },
];

const VALID_LEVELS = new Set<RenameLevel>(["dir", "file", "text"]);
const DEFAULT_LEVELS: RenameLevel[] = ["text"];
const STORAGE_KEY = "phoenix-code-rename-page-v1";
const DEFAULT_WORKSPACE_KEY = "__default__";

export type CodeRenameFormPrefs = {
  old: string;
  new: string;
  levels: RenameLevel[];
  scope: string;
  targetEncoding: "utf-8" | "gbk";
  includeIgnored: boolean;
  rescanIndex: boolean;
};

type Persisted = {
  byWorkspace?: Record<string, CodeRenameFormPrefs>;
};

function defaultForm(): CodeRenameFormPrefs {
  return {
    old: "",
    new: "",
    levels: [...DEFAULT_LEVELS],
    scope: "",
    targetEncoding: "utf-8",
    includeIgnored: false,
    rescanIndex: false,
  };
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function writePersisted(data: Persisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function workspaceKey(path: string): string {
  const ws = path.trim();
  return ws || DEFAULT_WORKSPACE_KEY;
}

function normalizeLevels(raw: RenameLevel[] | undefined): RenameLevel[] {
  if (!raw?.length) return [...DEFAULT_LEVELS];
  const out = raw.filter((level) => VALID_LEVELS.has(level));
  return out.length ? out : [...DEFAULT_LEVELS];
}

function normalizeEncoding(raw: string | undefined): "utf-8" | "gbk" {
  return raw === "gbk" ? "gbk" : "utf-8";
}

function normalizeForm(raw: Partial<CodeRenameFormPrefs> | undefined): CodeRenameFormPrefs {
  const base = defaultForm();
  if (!raw) return base;
  return {
    old: raw.old ?? base.old,
    new: raw.new ?? base.new,
    levels: normalizeLevels(raw.levels),
    scope: raw.scope ?? base.scope,
    targetEncoding: normalizeEncoding(raw.targetEncoding),
    includeIgnored: raw.includeIgnored ?? base.includeIgnored,
    rescanIndex: raw.rescanIndex ?? base.rescanIndex,
  };
}

function hasLocalEntry(key: string): boolean {
  return !!readPersisted().byWorkspace?.[key];
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useCodeRenamePageStore = defineStore("codeRenamePage", {
  state: () => ({
    hydrated: false,
    activeWorkspaceKey: DEFAULT_WORKSPACE_KEY,
    ...defaultForm(),
  }),
  getters: {
    levelSet(state): Set<RenameLevel> {
      return new Set(state.levels);
    },
    canRun(state): boolean {
      return !!(state.old.trim() && state.new.trim() && state.levels.length > 0);
    },
    prefsPayload(state): Partial<CodeRenamePrefs> {
      return {
        old: state.old.trim(),
        new: state.new.trim(),
        levels: [...state.levels],
        scope: state.scope.trim(),
        target_encoding: state.targetEncoding,
        include_ignored: state.includeIgnored,
        rescan_index: state.rescanIndex,
      };
    },
  },
  actions: {
    applyForm(form: Partial<CodeRenameFormPrefs>) {
      const next = normalizeForm({
        old: form.old ?? this.old,
        new: form.new ?? this.new,
        levels: form.levels ?? this.levels,
        scope: form.scope ?? this.scope,
        targetEncoding: form.targetEncoding ?? this.targetEncoding,
        includeIgnored: form.includeIgnored ?? this.includeIgnored,
        rescanIndex: form.rescanIndex ?? this.rescanIndex,
      });
      this.old = next.old;
      this.new = next.new;
      this.levels = next.levels;
      this.scope = next.scope;
      this.targetEncoding = next.targetEncoding;
      this.includeIgnored = next.includeIgnored;
      this.rescanIndex = next.rescanIndex;
    },
    hydrate(workspacePath: string) {
      const key = workspaceKey(workspacePath);
      this.activeWorkspaceKey = key;
      const saved = readPersisted().byWorkspace?.[key];
      this.applyForm(saved ?? defaultForm());
      this.hydrated = true;
    },
    schedulePersist() {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => this.persist(), 300);
    },
    persist() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      const data = readPersisted();
      const byWorkspace = { ...(data.byWorkspace ?? {}) };
      byWorkspace[this.activeWorkspaceKey] = normalizeForm({
        old: this.old,
        new: this.new,
        levels: this.levels,
        scope: this.scope,
        targetEncoding: this.targetEncoding,
        includeIgnored: this.includeIgnored,
        rescanIndex: this.rescanIndex,
      });
      writePersisted({ byWorkspace });
    },
    applyFromApi(prefs: CodeRenamePrefs) {
      if (hasLocalEntry(this.activeWorkspaceKey)) return;
      this.applyForm({
        old: prefs.old || "",
        new: prefs.new || "",
        levels: normalizeLevels(prefs.levels),
        scope: prefs.scope || "",
        targetEncoding: normalizeEncoding(prefs.target_encoding),
        includeIgnored: prefs.include_ignored ?? false,
        rescanIndex: prefs.rescan_index ?? false,
      });
      this.persist();
    },
    setOld(value: string) {
      this.old = value;
      this.schedulePersist();
    },
    setNew(value: string) {
      this.new = value;
      this.schedulePersist();
    },
    setScope(value: string) {
      this.scope = value;
      this.schedulePersist();
    },
    setTargetEncoding(value: "utf-8" | "gbk") {
      this.targetEncoding = normalizeEncoding(value);
      this.persist();
    },
    setIncludeIgnored(value: boolean) {
      this.includeIgnored = value;
      this.persist();
    },
    setRescanIndex(value: boolean) {
      this.rescanIndex = value;
      this.persist();
    },
    toggleLevel(id: RenameLevel, checked: boolean) {
      const next = new Set(this.levels);
      if (checked) next.add(id);
      else next.delete(id);
      this.levels = [...next];
      this.persist();
    },
    syncFromServer(prefs: CodeRenamePrefs) {
      this.applyForm({
        old: prefs.old || "",
        new: prefs.new || "",
        levels: normalizeLevels(prefs.levels),
        scope: prefs.scope || "",
        targetEncoding: normalizeEncoding(prefs.target_encoding),
        includeIgnored: prefs.include_ignored ?? false,
        rescanIndex: prefs.rescan_index ?? false,
      });
      this.persist();
    },
  },
});
