import { defineStore } from "pinia";
import { fetchOnboardingStatus, type OnboardingStatus } from "../api";
import { SHELL_TOUR_VERSION } from "../utils/onboardingConstants";

const STORAGE_KEY = "phoenix-onboarding-v1";

type Persisted = {
  tourVersionSeen?: number;
  openedFileDetailByWorkspace?: Record<string, boolean>;
};

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

export const useOnboardingStore = defineStore("onboarding", {
  state: () => ({
    status: null as OnboardingStatus | null,
    statusLoading: false,
    tourVersionSeen: readPersisted().tourVersionSeen ?? 0,
    openedFileDetailByWorkspace: {
      ...(readPersisted().openedFileDetailByWorkspace ?? {}),
    },
  }),
  getters: {
    workspaceOk(state): boolean {
      return state.status?.workspace_ok ?? false;
    },
    freecadOk(state): boolean {
      return state.status?.freecad_ok ?? false;
    },
    indexScanned(state): boolean {
      return state.status?.index_scanned ?? false;
    },
    openedFileDetail(state): boolean {
      const ws = state.status?.workspace_path?.trim();
      if (!ws) return false;
      return !!state.openedFileDetailByWorkspace[ws];
    },
    shellTourDone(state): boolean {
      return state.tourVersionSeen >= SHELL_TOUR_VERSION;
    },
    canStartShellTour(state): boolean {
      return (state.status?.workspace_ok ?? false) && state.tourVersionSeen < SHELL_TOUR_VERSION;
    },
    readyToWork(state): boolean {
      return (
        (state.status?.workspace_ok ?? false) &&
        (state.status?.index_scanned ?? false) &&
        (state.openedFileDetailByWorkspace[state.status?.workspace_path?.trim() ?? ""] ?? false)
      );
    },
  },
  actions: {
    async refreshStatus() {
      this.statusLoading = true;
      try {
        this.status = await fetchOnboardingStatus();
      } catch {
        this.status = null;
      } finally {
        this.statusLoading = false;
      }
    },
    markFileDetailOpened(workspacePath: string) {
      const ws = workspacePath.trim();
      if (!ws) return;
      this.openedFileDetailByWorkspace = {
        ...this.openedFileDetailByWorkspace,
        [ws]: true,
      };
      const p = readPersisted();
      p.openedFileDetailByWorkspace = this.openedFileDetailByWorkspace;
      writePersisted(p);
    },
    syncFileDetailFromTabs(
      workspacePath: string,
      tabs: { pageId: string }[],
    ) {
      const ws = workspacePath.trim();
      if (!ws) return;
      const hit = tabs.some(
        (t) => t.pageId === "file_detail" || t.pageId === "bom_apply",
      );
      if (hit) this.markFileDetailOpened(ws);
    },
    markShellTourSeen(version = SHELL_TOUR_VERSION) {
      this.tourVersionSeen = version;
      const p = readPersisted();
      p.tourVersionSeen = version;
      writePersisted(p);
    },
    resetLocalState() {
      this.tourVersionSeen = 0;
      this.openedFileDetailByWorkspace = {};
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
  },
});
