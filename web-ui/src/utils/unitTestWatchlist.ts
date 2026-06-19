import type { UnitTestCaseResult } from "../api";

const STORAGE_KEY = "phoenix.unitTests.watchlist";
const PREFS_KEY = "phoenix.unitTests.watchlistPrefs";

export type UnitTestWatchlistEntry = {
  id: string;
  module: string;
  suite_id: string;
  class_name: string;
  method: string;
  status: "failed" | "error";
  message: string;
  duration_ms: number;
  first_seen_at: string;
  last_seen_at: string;
  /** 累计失败/错误次数（不因单次通过而清零） */
  fail_count: number;
  /** 全量套件运行时是否执行（false = 忽略） */
  run_on_full: boolean;
};

export type WatchlistSortBy = "fail_count" | "last_seen_at";

export type UnitTestWatchlistPrefs = {
  /** 新失败用例加入关注时的默认「全量时运行」 */
  default_run_on_full: boolean;
  /** 失败关注列表默认排序 */
  sort_by: WatchlistSortBy;
};

const DEFAULT_PREFS: UnitTestWatchlistPrefs = {
  default_run_on_full: true,
  sort_by: "last_seen_at",
};

function normalizeEntry(raw: unknown): UnitTestWatchlistEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Partial<UnitTestWatchlistEntry>;
  if (typeof e.id !== "string" || typeof e.method !== "string") return null;
  const last = typeof e.last_seen_at === "string" ? e.last_seen_at : new Date().toISOString();
  const first = typeof e.first_seen_at === "string" ? e.first_seen_at : last;
  const failCount =
    typeof e.fail_count === "number" && e.fail_count > 0 ? Math.floor(e.fail_count) : 1;
  return {
    id: e.id,
    module: e.module ?? "",
    suite_id: e.suite_id ?? "",
    class_name: e.class_name ?? "",
    method: e.method,
    status: e.status === "error" ? "error" : "failed",
    message: e.message ?? "",
    duration_ms: typeof e.duration_ms === "number" ? e.duration_ms : 0,
    first_seen_at: first,
    last_seen_at: last,
    fail_count: failCount,
    run_on_full: e.run_on_full !== false,
  };
}

function readRaw(): UnitTestWatchlistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeEntry)
      .filter((e): e is UnitTestWatchlistEntry => e !== null);
  } catch {
    return [];
  }
}

function writeRaw(entries: UnitTestWatchlistEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function loadWatchlistPrefs(): UnitTestWatchlistPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<UnitTestWatchlistPrefs>;
    return {
      default_run_on_full:
        typeof parsed.default_run_on_full === "boolean"
          ? parsed.default_run_on_full
          : DEFAULT_PREFS.default_run_on_full,
      sort_by:
        parsed.sort_by === "fail_count" || parsed.sort_by === "last_seen_at"
          ? parsed.sort_by
          : DEFAULT_PREFS.sort_by,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveWatchlistPrefs(prefs: UnitTestWatchlistPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function sortWatchlistEntries(
  entries: UnitTestWatchlistEntry[],
  sortBy: WatchlistSortBy,
): UnitTestWatchlistEntry[] {
  const list = [...entries];
  if (sortBy === "fail_count") {
    return list.sort((a, b) => {
      const byCount = b.fail_count - a.fail_count;
      if (byCount !== 0) return byCount;
      return b.last_seen_at.localeCompare(a.last_seen_at);
    });
  }
  return list.sort((a, b) => {
    const byTime = b.last_seen_at.localeCompare(a.last_seen_at);
    if (byTime !== 0) return byTime;
    return b.fail_count - a.fail_count;
  });
}

export function loadWatchlist(): UnitTestWatchlistEntry[] {
  return readRaw();
}

export function watchlistTotalFailCount(entries: UnitTestWatchlistEntry[]): number {
  return entries.reduce((sum, e) => sum + e.fail_count, 0);
}

export function recordWatchlistFailure(
  caseResult: UnitTestCaseResult,
  prefs: UnitTestWatchlistPrefs,
): UnitTestWatchlistEntry[] {
  if (caseResult.status !== "failed" && caseResult.status !== "error") {
    return loadWatchlist();
  }
  const list = readRaw();
  const idx = list.findIndex((e) => e.id === caseResult.id);
  const now = new Date().toISOString();
  const prev = idx >= 0 ? list[idx] : null;
  const next: UnitTestWatchlistEntry = {
    id: caseResult.id,
    module: caseResult.module,
    suite_id: caseResult.suite_id,
    class_name: caseResult.class_name,
    method: caseResult.method,
    status: caseResult.status === "error" ? "error" : "failed",
    message: caseResult.message,
    duration_ms: caseResult.duration_ms,
    first_seen_at: prev?.first_seen_at ?? now,
    last_seen_at: now,
    fail_count: (prev?.fail_count ?? 0) + 1,
    run_on_full: prev?.run_on_full ?? prefs.default_run_on_full,
  };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  writeRaw(list);
  return loadWatchlist();
}

export function removeWatchlistEntry(caseId: string): UnitTestWatchlistEntry[] {
  const list = readRaw().filter((e) => e.id !== caseId);
  writeRaw(list);
  return loadWatchlist();
}

export function setWatchlistRunOnFull(caseId: string, runOnFull: boolean): UnitTestWatchlistEntry[] {
  const list = readRaw();
  const idx = list.findIndex((e) => e.id === caseId);
  if (idx < 0) return loadWatchlist();
  list[idx] = { ...list[idx], run_on_full: runOnFull };
  writeRaw(list);
  return loadWatchlist();
}

export function clearWatchlist(): UnitTestWatchlistEntry[] {
  writeRaw([]);
  return [];
}

export function excludeCaseIdsForFullRun(entries: UnitTestWatchlistEntry[]): string[] {
  return entries.filter((e) => !e.run_on_full).map((e) => e.id);
}

export function includeCaseIdsForWatchlistRun(entries: UnitTestWatchlistEntry[]): string[] {
  return entries.map((e) => e.id);
}
