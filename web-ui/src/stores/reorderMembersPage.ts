import { defineStore } from "pinia";
import type { ReorderMembersPrefs } from "../api";

const STORAGE_KEY = "phoenix-reorder-members-page-v2";
const DEFAULT_WORKSPACE_KEY = "__default__";

export type KevinSystemCodeMode = "merge_strip" | "keep_markers" | "off";

export type ReorderMembersFormPrefs = {
  includeCpp: boolean;
  includeHeader: boolean;
  verbose: boolean;
  kevinSystemCodeMode: KevinSystemCodeMode;
  selectedWorksetId: string | null;
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
    selectedWorksetId: null,
  };
}

function normalizeKevinSystemCodeMode(raw: unknown): KevinSystemCodeMode {
  if (raw === "keep_markers" || raw === "off" || raw === "merge_strip")
    return raw;
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

function normalizeForm(
  raw: Partial<ReorderMembersFormPrefs> | undefined,
): ReorderMembersFormPrefs {
  const base = defaultForm();
  if (!raw) return base;
  return {
    includeCpp: raw.includeCpp ?? base.includeCpp,
    includeHeader: raw.includeHeader ?? base.includeHeader,
    verbose: raw.verbose ?? base.verbose,
    kevinSystemCodeMode: normalizeKevinSystemCodeMode(raw.kevinSystemCodeMode),
    selectedWorksetId: raw.selectedWorksetId ?? base.selectedWorksetId,
  };
}

function hasLocalEntry(key: string): boolean {
  return !!readPersisted().byWorkspace?.[key];
}

export const useReorderMembersPageStore = defineStore(
  "reorderMembersPage",
  {
    state: () => ({
      hydrated: false,
      activeWorkspaceKey: DEFAULT_WORKSPACE_KEY,
      ignoreFileDisplay: "",
      ...defaultForm(),
    }),
    getters: {
      prefsPayload(state): Partial<ReorderMembersPrefs> {
        return {
          include_cpp: state.includeCpp,
          include_header: state.includeHeader,
          sort_members: false,
          verbose: state.verbose,
          kevin_system_code_mode: state.kevinSystemCodeMode,
        };
      },
    },
    actions: {
      applyForm(form: Partial<ReorderMembersFormPrefs>) {
        const next = normalizeForm({
          includeCpp: form.includeCpp ?? this.includeCpp,
          includeHeader: form.includeHeader ?? this.includeHeader,
          verbose: form.verbose ?? this.verbose,
          kevinSystemCodeMode:
            form.kevinSystemCodeMode ?? this.kevinSystemCodeMode,
          selectedWorksetId:
            form.selectedWorksetId ?? this.selectedWorksetId,
        });
        this.includeCpp = next.includeCpp;
        this.includeHeader = next.includeHeader;
        this.verbose = next.verbose;
        this.kevinSystemCodeMode = next.kevinSystemCodeMode;
        this.selectedWorksetId = next.selectedWorksetId;
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
          selectedWorksetId: this.selectedWorksetId,
        });
        writePersisted({ byWorkspace });
      },
      applyFromApi(prefs: ReorderMembersPrefs) {
        this.ignoreFileDisplay = prefs.ignore_file_display || "";
        if (hasLocalEntry(this.activeWorkspaceKey)) return;
        this.applyForm({
          includeCpp: prefs.include_cpp ?? true,
          includeHeader: prefs.include_header ?? true,
          verbose: prefs.verbose ?? false,
          kevinSystemCodeMode: normalizeKevinSystemCodeMode(
            prefs.kevin_system_code_mode,
          ),
        });
        this.persist();
      },
      syncFromServer(prefs: ReorderMembersPrefs) {
        this.ignoreFileDisplay = prefs.ignore_file_display || "";
        this.applyForm({
          includeCpp: prefs.include_cpp ?? true,
          includeHeader: prefs.include_header ?? true,
          verbose: prefs.verbose ?? false,
          kevinSystemCodeMode: normalizeKevinSystemCodeMode(
            prefs.kevin_system_code_mode,
          ),
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
      setSelectedWorksetId(id: string | null) {
        this.selectedWorksetId = id;
        this.persist();
      },
    },
  },
);
