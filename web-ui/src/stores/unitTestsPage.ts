import { defineStore } from "pinia";
import {
  loadWatchlistPrefs,
  saveWatchlistPrefs,
  type UnitTestWatchlistPrefs,
  type WatchlistSortBy,
} from "../utils/unitTestWatchlist";

export const UNIT_TEST_RUNNABLE_SUITE_IDS = ["code", "cad", "platform"] as const;

export type UnitTestsPageTab = "results" | "watchlist";

const STORAGE_KEY = "phoenix-unit-tests-page-v1";

type Persisted = {
  runCheckedSuiteIds?: string[];
  activeTab?: UnitTestsPageTab;
  watchlistPrefs?: UnitTestWatchlistPrefs;
  watchlistCheckedIds?: string[];
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

function normalizeRunChecked(ids: string[] | undefined): Set<string> {
  if (!ids?.length) {
    return new Set(UNIT_TEST_RUNNABLE_SUITE_IDS);
  }
  const valid = ids.filter((id) =>
    UNIT_TEST_RUNNABLE_SUITE_IDS.includes(id as (typeof UNIT_TEST_RUNNABLE_SUITE_IDS)[number]),
  );
  return valid.length ? new Set(valid) : new Set(UNIT_TEST_RUNNABLE_SUITE_IDS);
}

function normalizeActiveTab(tab: string | undefined): UnitTestsPageTab {
  return tab === "watchlist" ? "watchlist" : "results";
}

function initialWatchlistPrefs(persisted: Persisted): UnitTestWatchlistPrefs {
  if (persisted.watchlistPrefs) return persisted.watchlistPrefs;
  return loadWatchlistPrefs();
}

function normalizeWatchlistCheckedIds(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids.filter((id) => id.trim()))];
}

export const useUnitTestsPageStore = defineStore("unitTestsPage", {
  state: () => {
    const persisted = readPersisted();
    return {
      hydrated: false,
      runCheckedSuiteIds: normalizeRunChecked(persisted.runCheckedSuiteIds),
      activeTab: normalizeActiveTab(persisted.activeTab),
      watchlistPrefs: initialWatchlistPrefs(persisted),
      watchlistCheckedIds: normalizeWatchlistCheckedIds(persisted.watchlistCheckedIds),
    };
  },
  getters: {
    runCheckedCount(state): number {
      return state.runCheckedSuiteIds.size;
    },
    watchlistCheckedSet(state): Set<string> {
      return new Set(state.watchlistCheckedIds);
    },
    watchlistCheckedCount(state): number {
      return state.watchlistCheckedIds.length;
    },
  },
  actions: {
    hydrate() {
      if (this.hydrated) return;
      const persisted = readPersisted();
      this.runCheckedSuiteIds = normalizeRunChecked(persisted.runCheckedSuiteIds);
      this.activeTab = normalizeActiveTab(persisted.activeTab);
      this.watchlistPrefs = initialWatchlistPrefs(persisted);
      this.watchlistCheckedIds = normalizeWatchlistCheckedIds(persisted.watchlistCheckedIds);
      this.hydrated = true;
    },
    persist() {
      writePersisted({
        runCheckedSuiteIds: [...this.runCheckedSuiteIds],
        activeTab: this.activeTab,
        watchlistPrefs: this.watchlistPrefs,
        watchlistCheckedIds: this.watchlistCheckedIds,
      });
      saveWatchlistPrefs(this.watchlistPrefs);
    },
    toggleRunSuite(id: string, checked: boolean) {
      const next = new Set(this.runCheckedSuiteIds);
      if (checked) next.add(id);
      else next.delete(id);
      this.runCheckedSuiteIds = next;
      this.persist();
    },
    selectAllRun() {
      this.runCheckedSuiteIds = new Set(UNIT_TEST_RUNNABLE_SUITE_IDS);
      this.persist();
    },
    clearAllRun() {
      this.runCheckedSuiteIds = new Set();
      this.persist();
    },
    setActiveTab(tab: UnitTestsPageTab) {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      this.persist();
    },
    setWatchlistSortBy(sortBy: WatchlistSortBy) {
      if (this.watchlistPrefs.sort_by === sortBy) return;
      this.watchlistPrefs = { ...this.watchlistPrefs, sort_by: sortBy };
      this.persist();
    },
    setWatchlistDefaultRunOnFull(checked: boolean) {
      if (this.watchlistPrefs.default_run_on_full === checked) return;
      this.watchlistPrefs = { ...this.watchlistPrefs, default_run_on_full: checked };
      this.persist();
    },
    toggleWatchlistChecked(id: string, checked: boolean) {
      const next = new Set(this.watchlistCheckedIds);
      if (checked) next.add(id);
      else next.delete(id);
      this.watchlistCheckedIds = [...next];
      this.persist();
    },
    toggleAllWatchlistChecked(ids: string[], checked: boolean) {
      this.watchlistCheckedIds = checked ? normalizeWatchlistCheckedIds(ids) : [];
      this.persist();
    },
    pruneWatchlistChecked(validIds: Set<string>) {
      const next = this.watchlistCheckedIds.filter((id) => validIds.has(id));
      if (next.length === this.watchlistCheckedIds.length) return;
      this.watchlistCheckedIds = next;
      this.persist();
    },
  },
});
