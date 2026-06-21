const STORAGE_KEY = "phoenix.unitTests.moduleHistory";

export type UnitTestModuleHistoryEntry = {
  module: string;
  /** 累计运行次数（含批量与单模块） */
  run_count: number;
  last_run_at: string;
};

export type ModuleSortBy = "plan" | "last_run_at" | "run_count";

export type ModuleHistoryMap = Record<string, UnitTestModuleHistoryEntry>;

function normalizeEntry(raw: unknown): UnitTestModuleHistoryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Partial<UnitTestModuleHistoryEntry>;
  if (typeof e.module !== "string" || !e.module.trim()) return null;
  const last =
    typeof e.last_run_at === "string" && e.last_run_at.trim()
      ? e.last_run_at
      : new Date(0).toISOString();
  const runCount =
    typeof e.run_count === "number" && e.run_count > 0 ? Math.floor(e.run_count) : 0;
  return {
    module: e.module,
    run_count: runCount,
    last_run_at: last,
  };
}

function readRaw(): ModuleHistoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const map: ModuleHistoryMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const entry = normalizeEntry(typeof value === "object" ? { ...(value as object), module: key } : null);
      if (entry && entry.run_count > 0) map[key] = entry;
    }
    return map;
  } catch {
    return {};
  }
}

function writeRaw(map: ModuleHistoryMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function loadModuleHistory(): ModuleHistoryMap {
  return readRaw();
}

export function recordModuleRuns(
  modules: string[],
  history: ModuleHistoryMap = readRaw(),
): ModuleHistoryMap {
  if (!modules.length) return history;
  const now = new Date().toISOString();
  const next = { ...history };
  for (const moduleName of modules) {
    if (!moduleName.trim()) continue;
    const prev = next[moduleName];
    next[moduleName] = {
      module: moduleName,
      run_count: (prev?.run_count ?? 0) + 1,
      last_run_at: now,
    };
  }
  writeRaw(next);
  return next;
}

export function moduleRunCount(module: string, history: ModuleHistoryMap): number {
  return history[module]?.run_count ?? 0;
}

export function moduleLastRunAt(module: string, history: ModuleHistoryMap): string | null {
  const at = history[module]?.last_run_at;
  if (!at || at === new Date(0).toISOString()) return null;
  return at;
}

export function sortPlanModules<T extends { module: string }>(
  modules: T[],
  sortBy: ModuleSortBy,
  history: ModuleHistoryMap,
): T[] {
  if (sortBy === "plan") return [...modules];
  const list = [...modules];
  if (sortBy === "run_count") {
    return list.sort((a, b) => {
      const byCount = moduleRunCount(b.module, history) - moduleRunCount(a.module, history);
      if (byCount !== 0) return byCount;
      const tb = moduleLastRunAt(b.module, history) ?? "";
      const ta = moduleLastRunAt(a.module, history) ?? "";
      const byTime = tb.localeCompare(ta);
      if (byTime !== 0) return byTime;
      return a.module.localeCompare(b.module);
    });
  }
  return list.sort((a, b) => {
    const tb = moduleLastRunAt(b.module, history) ?? "";
    const ta = moduleLastRunAt(a.module, history) ?? "";
    if (tb !== ta) return tb.localeCompare(ta);
    const byCount = moduleRunCount(b.module, history) - moduleRunCount(a.module, history);
    if (byCount !== 0) return byCount;
    return a.module.localeCompare(b.module);
  });
}

export function hasModuleHistory(history: ModuleHistoryMap): boolean {
  return Object.keys(history).length > 0;
}
