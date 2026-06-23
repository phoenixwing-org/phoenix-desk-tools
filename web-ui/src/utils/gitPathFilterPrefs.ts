const ACTIVE_KEY = "phoenix-git-path-filters-active-v1";
const HISTORY_KEY = "phoenix-git-path-filter-history-v1";
const TAGS_KEY = "phoenix-git-path-filter-tags-v1";
const MAX_HISTORY_SETS = 12;
const MAX_TAG_SUGGESTIONS = 24;

function wsScope(workspacePath: string): string {
  const ws = workspacePath.trim();
  return ws || "_none_";
}

function readJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

function activeMap(): Record<string, string[]> {
  return readJson(sessionStorage, ACTIVE_KEY, {});
}

function historyMap(): Record<string, string[][]> {
  return readJson(localStorage, HISTORY_KEY, {});
}

function tagsMap(): Record<string, string[]> {
  return readJson(localStorage, TAGS_KEY, {});
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function readGitPathFilterTags(workspacePath: string): string[] {
  const scope = wsScope(workspacePath);
  return normalizeTags(activeMap()[scope]);
}

export function persistGitPathFilterTags(workspacePath: string, tags: string[]) {
  const scope = wsScope(workspacePath);
  const next = normalizeTags(tags);
  const map = activeMap();
  if (next.length) map[scope] = next;
  else delete map[scope];
  writeJson(sessionStorage, ACTIVE_KEY, map);
}

export function readGitPathFilterHistory(workspacePath: string): string[][] {
  const scope = wsScope(workspacePath);
  const rows = historyMap()[scope];
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => normalizeTags(row)).filter((row) => row.length > 0);
}

export function pushGitPathFilterHistory(workspacePath: string, tags: string[]) {
  const normalized = normalizeTags(tags);
  if (!normalized.length) return;
  const scope = wsScope(workspacePath);
  const map = historyMap();
  const prev = readGitPathFilterHistory(workspacePath);
  const key = normalized.map((t) => t.toLowerCase()).join("\0");
  const filtered = prev.filter(
    (row) => row.map((t) => t.toLowerCase()).join("\0") !== key,
  );
  map[scope] = [normalized, ...filtered].slice(0, MAX_HISTORY_SETS);
  writeJson(localStorage, HISTORY_KEY, map);
  for (const tag of normalized) {
    pushGitPathFilterTagSuggestion(workspacePath, tag);
  }
}

export function readGitPathFilterTagSuggestions(workspacePath: string): string[] {
  const scope = wsScope(workspacePath);
  return normalizeTags(tagsMap()[scope]);
}

export function pushGitPathFilterTagSuggestion(workspacePath: string, tag: string) {
  const text = tag.trim();
  if (!text) return;
  const scope = wsScope(workspacePath);
  const map = tagsMap();
  const prev = readGitPathFilterTagSuggestions(workspacePath);
  const key = text.toLowerCase();
  const next = [text, ...prev.filter((t) => t.toLowerCase() !== key)].slice(0, MAX_TAG_SUGGESTIONS);
  map[scope] = next;
  writeJson(localStorage, TAGS_KEY, map);
}
