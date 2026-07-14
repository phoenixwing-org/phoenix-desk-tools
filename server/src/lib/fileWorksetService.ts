import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";

export type WorksetEntry = {
  path: string;
  type: "file" | "dir";
};

export type FileWorkset = {
  id: string;
  name: string;
  entries: WorksetEntry[];
  source: string;
  updated_at: string;
};

export type FileWorksetPayload = {
  version: number;
  worksets: FileWorkset[];
  workspace_path: string;
  workspace_path_display: string;
  path: string;
  path_display: string;
  storage: string;
  legacy_json_path?: string;
  prune_removed?: number;
};

export type ResolvedFileWorksetScope = {
  id: string;
  name: string;
  dirs: string[];
  files: string[];
};

const SCHEMA_VERSION = 1;
const FILE_WORKSETS_BASENAME = "file-worksets.json";
const DATABASE_BASENAME = "phoenix-workspace.sqlite";
const IMPORT_META_KEY = "node_file_worksets_json_imported";

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pathDisplay(p: string): string {
  return p ? path.normalize(p) : "";
}

function workspaceOk(root: string): boolean {
  try {
    return Boolean(root) && fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function legacyStoragePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".phoenix", FILE_WORKSETS_BASENAME);
}

function emptyPayload(workspaceRoot: string): FileWorksetPayload {
  const file = workspaceRoot ? path.join(workspaceRoot, ".phoenix", DATABASE_BASENAME) : "";
  return {
    version: SCHEMA_VERSION,
    worksets: [],
    workspace_path: workspaceRoot,
    workspace_path_display: pathDisplay(workspaceRoot),
    path: file,
    path_display: pathDisplay(file),
    storage: "sqlite",
    legacy_json_path: workspaceRoot ? legacyStoragePath(workspaceRoot) : "",
  };
}

function normalizeRelPath(raw: unknown): string | null {
  let s = String(raw || "").trim().replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!s || s.split("/").includes("..") || path.isAbsolute(s)) return null;
  return s;
}

export function normalizeWorksetEntries(rawEntries: unknown): WorksetEntry[] {
  const items = Array.isArray(rawEntries) ? rawEntries : [];
  const seen = new Set<string>();
  const out: WorksetEntry[] = [];
  for (const item of items) {
    const rel = normalizeRelPath(typeof item === "string" ? item : (item as any)?.path);
    if (!rel || seen.has(rel)) continue;
    const rawType = typeof item === "string" ? "file" : String((item as any)?.type || "file");
    const type = rawType === "dir" ? "dir" : "file";
    seen.add(rel);
    out.push({ path: rel, type });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

export function normalizeWorksetPaths(paths: unknown): string[] {
  return normalizeWorksetEntries(paths).map((entry) => entry.path);
}

function normalizeWorkset(raw: unknown): FileWorkset | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as any;
  const id = String(item.id || "").trim() || randomUUID();
  const name = String(item.name || "").trim() || "Untitled";
  const entries = Array.isArray(item.entries)
    ? normalizeWorksetEntries(item.entries)
    : normalizeWorksetEntries(Array.isArray(item.paths) ? item.paths : []);
  const source = String(item.source || "").trim();
  const updatedAt = String(item.updated_at || "").trim() || utcNowIso();
  return { id, name, entries, source, updated_at: updatedAt };
}

function ensureWorksetSchema(db: PnwDbAdapter): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS phoenix_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phoenix_workset (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phoenix_workset_path (
      workset_id TEXT NOT NULL REFERENCES phoenix_workset(id) ON DELETE CASCADE,
      repo_rel_path TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      entry_type TEXT NOT NULL DEFAULT 'file',
      PRIMARY KEY (workset_id, repo_rel_path)
    );
    CREATE INDEX IF NOT EXISTS idx_phoenix_workset_path_rel
      ON phoenix_workset_path(repo_rel_path);
  `);
  const columns = db.all<{ name: string }>("PRAGMA table_info(phoenix_workset_path)");
  if (!columns.some((column) => column.name === "entry_type")) {
    db.exec("ALTER TABLE phoenix_workset_path ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'file'");
  }
}

function readLegacyJson(workspaceRoot: string): FileWorkset[] {
  try {
    const raw = JSON.parse(fs.readFileSync(legacyStoragePath(workspaceRoot), "utf8"));
    const list = Array.isArray(raw?.worksets) ? raw.worksets : [];
    return list.map(normalizeWorkset).filter(Boolean) as FileWorkset[];
  } catch {
    return [];
  }
}

function replaceDbWorksets(db: PnwDbAdapter, worksets: FileWorkset[]): void {
  db.exec("BEGIN TRANSACTION");
  try {
    db.run("DELETE FROM phoenix_workset_path");
    db.run("DELETE FROM phoenix_workset");
    for (const workset of worksets) {
      db.run(
        `INSERT INTO phoenix_workset(id, name, source, updated_at)
         VALUES (?, ?, ?, ?)`,
        [workset.id, workset.name, workset.source, workset.updated_at],
      );
      workset.entries.forEach((entry, index) => {
        db.run(
          `INSERT INTO phoenix_workset_path(workset_id, repo_rel_path, sort_order, entry_type)
           VALUES (?, ?, ?, ?)`,
          [workset.id, entry.path, index, entry.type],
        );
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function importLegacyJsonOnce(db: PnwDbAdapter, workspaceRoot: string): void {
  const marker = db.get<{ value: string }>(
    "SELECT value FROM phoenix_meta WHERE key = ?",
    [IMPORT_META_KEY],
  );
  if (marker) return;
  const count = Number(db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM phoenix_workset",
  )?.count || 0);
  if (count === 0) {
    const legacy = readLegacyJson(workspaceRoot);
    if (legacy.length) replaceDbWorksets(db, legacy);
  }
  db.run(
    `INSERT INTO phoenix_meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [IMPORT_META_KEY, "1"],
  );
}

function openWorksetDb(workspaceRoot: string): PnwDbAdapter {
  const db = pnwCreateDb(ensurePhoenixDatabase(workspaceRoot));
  try {
    ensureWorksetSchema(db);
    importLegacyJsonOnce(db, workspaceRoot);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function readDb(workspaceRoot: string): { version: number; worksets: FileWorkset[] } {
  const db = openWorksetDb(workspaceRoot);
  try {
    const rows = db.all<{
      id: string;
      name: string;
      source: string;
      updated_at: string;
      repo_rel_path: string | null;
      entry_type: string | null;
    }>(`
      SELECT w.id, w.name, w.source, w.updated_at,
             p.repo_rel_path, p.entry_type
      FROM phoenix_workset w
      LEFT JOIN phoenix_workset_path p ON p.workset_id = w.id
      ORDER BY lower(w.name), w.id, p.sort_order, p.repo_rel_path
    `);
    const byId = new Map<string, FileWorkset>();
    for (const row of rows) {
      let workset = byId.get(String(row.id));
      if (!workset) {
        workset = {
          id: String(row.id),
          name: String(row.name),
          source: String(row.source || ""),
          updated_at: String(row.updated_at || ""),
          entries: [],
        };
        byId.set(workset.id, workset);
      }
      if (row.repo_rel_path != null) {
        workset.entries.push({
          path: String(row.repo_rel_path),
          type: row.entry_type === "dir" ? "dir" : "file",
        });
      }
    }
    return { version: SCHEMA_VERSION, worksets: [...byId.values()] };
  } finally {
    db.close();
  }
}

function writeDb(workspaceRoot: string, worksets: FileWorkset[]): void {
  const db = openWorksetDb(workspaceRoot);
  try {
    replaceDbWorksets(db, worksets);
  } finally {
    db.close();
  }
}

function payload(workspaceRoot: string, worksets: FileWorkset[], extra: Partial<FileWorksetPayload> = {}): FileWorksetPayload {
  const file = path.join(workspaceRoot, ".phoenix", DATABASE_BASENAME);
  return {
    version: SCHEMA_VERSION,
    worksets,
    workspace_path: workspaceRoot,
    workspace_path_display: pathDisplay(workspaceRoot),
    path: file,
    path_display: pathDisplay(file),
    storage: "sqlite",
    legacy_json_path: legacyStoragePath(workspaceRoot),
    ...extra,
  };
}

export function loadFileWorksets(workspaceRoot: string): FileWorksetPayload {
  const root = workspaceRoot.trim();
  if (!workspaceOk(root)) return emptyPayload(root);
  return payload(root, readDb(root).worksets);
}

function pathInside(candidate: string, parent: string): boolean {
  const childKey = candidate.toLowerCase();
  const parentKey = parent.toLowerCase();
  return childKey === parentKey || childKey.startsWith(`${parentKey}/`);
}

export function resolveFileWorksetScope(workspaceRoot: string, worksetId: string): ResolvedFileWorksetScope {
  const root = workspaceRoot.trim();
  const id = String(worksetId || "").trim();
  if (!workspaceOk(root)) throw new Error("Workspace is not configured");
  const workset = readDb(root).worksets.find((item) => item.id === id);
  if (!workset) throw new Error(`File workset not found: ${id}`);

  const rawDirs = workset.entries.filter((entry) => entry.type === "dir").map((entry) => entry.path);
  const dirs: string[] = [];
  for (const dir of rawDirs.sort((a, b) => a.length - b.length || a.localeCompare(b))) {
    if (!dirs.some((parent) => pathInside(dir, parent))) dirs.push(dir);
  }
  const files = workset.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path)
    .filter((file) => !dirs.some((dir) => pathInside(file, dir)));
  if (!dirs.length && !files.length) throw new Error(`File workset is empty: ${workset.name}`);
  return { id: workset.id, name: workset.name, dirs, files };
}

export function saveFileWorksets(workspaceRoot: string, body: any): FileWorksetPayload {
  const root = workspaceRoot.trim();
  if (!workspaceOk(root)) return emptyPayload(root);
  const rawList = Array.isArray(body?.worksets) ? body.worksets : [];
  const seenIds = new Set<string>();
  const worksets: FileWorkset[] = [];
  for (const raw of rawList) {
    const ws = normalizeWorkset(raw);
    if (!ws || seenIds.has(ws.id)) continue;
    seenIds.add(ws.id);
    worksets.push(ws);
  }
  writeDb(root, worksets);
  return payload(root, worksets);
}

function entryExists(workspaceRoot: string, entry: WorksetEntry): boolean {
  try {
    const abs = path.resolve(workspaceRoot, entry.path);
    const back = path.relative(workspaceRoot, abs);
    if (back.startsWith("..") || path.isAbsolute(back)) return false;
    const stat = fs.statSync(abs);
    return entry.type === "dir" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

export function pruneMissingFileWorksetPaths(workspaceRoot: string, body: any = {}): FileWorksetPayload {
  const root = workspaceRoot.trim();
  if (!workspaceOk(root)) return { ...emptyPayload(root), prune_removed: 0 };
  const worksetId = String(body?.workset_id || "").trim();
  const data = readDb(root);
  let removed = 0;
  let changed = false;
  const worksets = data.worksets.map((ws) => {
    if (worksetId && ws.id !== worksetId) return ws;
    const kept = ws.entries.filter((entry) => entryExists(root, entry));
    removed += ws.entries.length - kept.length;
    if (kept.length !== ws.entries.length) {
      changed = true;
      return { ...ws, entries: kept, updated_at: utcNowIso() };
    }
    return ws;
  });
  if (changed) writeDb(root, worksets);
  return payload(root, worksets, { prune_removed: removed });
}
