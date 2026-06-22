import { defineStore } from "pinia";
import type { ReorderMembersPrefs } from "../api";

const STORAGE_KEY = "phoenix-reorder-members-page-v1";
const DEFAULT_WORKSPACE_KEY = "__default__";

export type KevinSystemCodeMode = "merge_strip" | "keep_markers" | "off";

export type ReorderMembersFormPrefs = {
  includeCpp: boolean;
  includeHeader: boolean;
  verbose: boolean;
  kevinSystemCodeMode: KevinSystemCodeMode;
  lastSelected: string[];
  entriesExpanded: boolean;
};

type Persisted = {
  byWorkspace?: Record<string, ReorderMembersFormPrefs>;
};

function defaultForm(): ReorderMembersFormPrefs {
  return {
    includeCpp: true,
    includeHeader: true,
    verbose: false,
    kevinSystemCodeMode: "merge_strip",
    lastSelected: [],
    entriesExpanded: true,
  };
}

function normalizeKevinSystemCodeMode(raw: unknown): KevinSystemCodeMode {
  if (raw === "keep_markers" || raw === "off" || raw === "merge_strip") return raw;
  return "merge_strip";
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

function normalizeForm(raw: Partial<ReorderMembersFormPrefs> | undefined): ReorderMembersFormPrefs {
  const base = defaultForm();
  if (!raw) return base;
  const includeCpp = raw.includeCpp ?? base.includeCpp;
  const includeHeader = raw.includeHeader ?? base.includeHeader;
  return {
    includeCpp: includeCpp || includeHeader ? includeCpp : true,
    includeHeader: includeCpp || includeHeader ? includeHeader : true,
    verbose: raw.verbose ?? base.verbose,
    kevinSystemCodeMode: normalizeKevinSystemCodeMode(raw.kevinSystemCodeMode),
    lastSelected: Array.isArray(raw.lastSelected)
      ? raw.lastSelected.filter((name) => typeof name === "string" && name.trim())
      : base.lastSelected,
    entriesExpanded: raw.entriesExpanded ?? base.entriesExpanded,
  };
}

function hasLocalEntry(key: string): boolean {
  return !!readPersisted().byWorkspace?.[key];
}

export const useReorderMembersPageStore = defineStore("reorderMembersPage", {
  state: () => ({
    hydrated: false,
    activeWorkspaceKey: DEFAULT_WORKSPACE_KEY,
    ignoreFileDisplay: "",
    ...defaultForm(),
  }),
  getters: {
    selectedSet(state): Set<string> {
      return new Set(state.lastSelected);
    },
    selectedCount(state): number {
      return state.lastSelected.length;
    },
    prefsPayload(state): Partial<ReorderMembersPrefs> {
      return {
        include_cpp: state.includeCpp,
        include_header: state.includeHeader,
        sort_members: false,
        verbose: state.verbose,
        kevin_system_code_mode: state.kevinSystemCodeMode,
        last_selected: [...state.lastSelected],
      };
    },
  },
  actions: {
    applyForm(form: Partial<ReorderMembersFormPrefs>) {
      const next = normalizeForm({
        includeCpp: form.includeCpp ?? this.includeCpp,
        includeHeader: form.includeHeader ?? this.includeHeader,
        verbose: form.verbose ?? this.verbose,
        kevinSystemCodeMode: form.kevinSystemCodeMode ?? this.kevinSystemCodeMode,
        lastSelected: form.lastSelected ?? this.lastSelected,
        entriesExpanded: form.entriesExpanded ?? this.entriesExpanded,
      });
      this.includeCpp = next.includeCpp;
      this.includeHeader = next.includeHeader;
      this.verbose = next.verbose;
      this.kevinSystemCodeMode = next.kevinSystemCodeMode;
      this.lastSelected = next.lastSelected;
      this.entriesExpanded = next.entriesExpanded;
    },
    hydrate(workspacePath: string) {
      const key = workspaceKey(workspacePath);
      this.activeWorkspaceKey = key;
      const saved = readPersisted().byWorkspace?.[key];
      this.applyForm(saved ?? defaultForm());
      this.hydrated = true;
    },
    persist() {
      const data = readPersisted();
      const byWorkspace = { ...(data.byWorkspace ?? {}) };
      byWorkspace[this.activeWorkspaceKey] = normalizeForm({
        includeCpp: this.includeCpp,
        includeHeader: this.includeHeader,
        verbose: this.verbose,
        kevinSystemCodeMode: this.kevinSystemCodeMode,
        lastSelected: this.lastSelected,
        entriesExpanded: this.entriesExpanded,
      });
      writePersisted({ byWorkspace });
    },
    setIgnoreFileDisplay(display: string) {
      this.ignoreFileDisplay = display.trim();
    },
    applyFromApi(prefs: ReorderMembersPrefs) {
      if (hasLocalEntry(this.activeWorkspaceKey)) return;
      this.applyForm({
        includeCpp: prefs.include_cpp ?? true,
        includeHeader: prefs.include_header ?? true,
        verbose: prefs.verbose ?? false,
        kevinSystemCodeMode: normalizeKevinSystemCodeMode(prefs.kevin_system_code_mode),
        lastSelected: prefs.last_selected ?? [],
      });
      this.persist();
    },
    syncFromServer(prefs: ReorderMembersPrefs) {
      this.applyForm({
        includeCpp: prefs.include_cpp ?? true,
        includeHeader: prefs.include_header ?? true,
        verbose: prefs.verbose ?? false,
        kevinSystemCodeMode: normalizeKevinSystemCodeMode(prefs.kevin_system_code_mode),
        lastSelected: prefs.last_selected ?? [],
      });
      this.persist();
    },
    setIncludeCpp(checked: boolean) {
      if (!checked && !this.includeHeader) return false;
      this.includeCpp = checked;
      this.persist();
      return true;
    },
    setIncludeHeader(checked: boolean) {
      if (!checked && !this.includeCpp) return false;
      this.includeHeader = checked;
      this.persist();
      return true;
    },
    setVerbose(checked: boolean) {
      this.verbose = checked;
      this.persist();
    },
    setKevinSystemCodeMode(mode: KevinSystemCodeMode) {
      const next = normalizeKevinSystemCodeMode(mode);
      if (this.kevinSystemCodeMode === next) return;
      this.kevinSystemCodeMode = next;
      this.persist();
    },
    setEntriesExpanded(expanded: boolean) {
      this.entriesExpanded = expanded;
      this.persist();
    },
    toggleSelected(name: string, checked: boolean) {
      const next = new Set(this.lastSelected);
      if (checked) next.add(name);
      else next.delete(name);
      this.lastSelected = [...next];
      this.persist();
    },
    toggleAll(names: string[], checked: boolean) {
      this.lastSelected = checked ? [...names] : [];
      this.persist();
    },
    filterSelected(validNames: Set<string>) {
      const filtered = this.lastSelected.filter((name) => validNames.has(name));
      if (filtered.length !== this.lastSelected.length) {
        this.lastSelected = filtered;
        this.persist();
      }
    },
  },
});
