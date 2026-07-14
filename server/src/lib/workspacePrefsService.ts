import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";

export type WorkspacePrefs = Record<string, unknown>;

const PREFS_TABLE = "phoenix_workspace_pref";
const META_SECTION = "__meta__";
const LEGACY_JSON_BASENAME = "phoenix-workspace-prefs.json";

function assertWorkspace(workspace: string): string {
  const resolved = path.resolve(String(workspace || "").trim());
  try {
    if (!workspace || !fs.statSync(resolved).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Not a valid workspace directory: ${resolved}`);
  }
  return resolved;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validSection(section: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(section) && section !== META_SECTION;
}

function parseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function legacyJsonPath(workspace: string): string {
  return path.join(workspace, ".phoenix", LEGACY_JSON_BASENAME);
}

function readLegacyJson(workspace: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(legacyJsonPath(workspace), "utf8"));
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ensureSchema(db: PnwDbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS phoenix_workspace_pref (
      section TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function upsertSection(
  db: PnwDbAdapter,
  section: string,
  payload: Record<string, unknown>,
  updatedAt: string,
): void {
  db.run(
    `INSERT INTO phoenix_workspace_pref(section, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(section) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    [section, JSON.stringify(payload), updatedAt],
  );
}

function importLegacyJsonOnce(db: PnwDbAdapter, workspace: string): boolean {
  const row = db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${PREFS_TABLE}`);
  if (Number(row?.count || 0) > 0) return false;

  const legacy = readLegacyJson(workspace);
  const now = new Date().toISOString();
  const meta: Record<string, unknown> = {
    storage_version: 1,
    initialized_at: now,
  };
  if (Number.isInteger(legacy.version)) meta.version = legacy.version;
  if (Object.prototype.hasOwnProperty.call(legacy, "PartVersion")) {
    meta.PartVersion = legacy.PartVersion;
  }
  if (Object.keys(legacy).length) {
    meta.imported_from = LEGACY_JSON_BASENAME;
    meta.imported_at = now;
  }

  db.exec("BEGIN TRANSACTION");
  try {
    upsertSection(db, META_SECTION, meta, now);
    for (const [section, value] of Object.entries(legacy)) {
      if (!validSection(section) || !isObject(value)) continue;
      upsertSection(db, section, value, now);
    }
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
  return Object.keys(legacy).length > 0;
}

function openWorkspacePrefs(workspace: string): {
  workspace: string;
  databasePath: string;
  db: PnwDbAdapter;
} {
  const resolved = assertWorkspace(workspace);
  const databasePath = ensurePhoenixDatabase(resolved);
  const db = pnwCreateDb(databasePath);
  try {
    ensureSchema(db);
    importLegacyJsonOnce(db, resolved);
  } catch (error) {
    db.close();
    throw error;
  }
  return { workspace: resolved, databasePath, db };
}

export function loadWorkspacePrefs(workspace: string): WorkspacePrefs {
  const { db } = openWorkspacePrefs(workspace);
  try {
    const out: WorkspacePrefs = {};
    const rows = db.all<{ section: string; value_json: string }>(
      `SELECT section, value_json FROM ${PREFS_TABLE} ORDER BY section`,
    );
    for (const row of rows) {
      const payload = parseObject(row.value_json);
      if (row.section === META_SECTION) {
        if (Number.isInteger(payload.version)) out.version = payload.version;
        if (Object.prototype.hasOwnProperty.call(payload, "PartVersion")) {
          out.PartVersion = payload.PartVersion;
        }
      } else if (validSection(row.section)) {
        out[row.section] = payload;
      }
    }
    return out;
  } finally {
    db.close();
  }
}

export function loadWorkspaceSection<T extends Record<string, unknown>>(
  workspace: string,
  section: string,
  defaults: T,
): T {
  if (!validSection(section)) throw new Error(`Invalid workspace preference section: ${section}`);
  const loaded = loadWorkspacePrefs(workspace)[section];
  return {
    ...defaults,
    ...(isObject(loaded) ? loaded : {}),
  } as T;
}

export function saveWorkspaceSection<T extends Record<string, unknown>>(
  workspace: string,
  section: string,
  patch: Record<string, unknown>,
  defaults: T,
): T {
  if (!validSection(section)) throw new Error(`Invalid workspace preference section: ${section}`);
  if (!isObject(patch)) throw new Error("Workspace preference patch must be an object");
  const { db } = openWorkspacePrefs(workspace);
  try {
    const row = db.get<{ value_json: string }>(
      `SELECT value_json FROM ${PREFS_TABLE} WHERE section = ?`,
      [section],
    );
    const payload: Record<string, unknown> = {
      ...defaults,
      ...parseObject(row?.value_json),
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) delete payload[key];
      else payload[key] = value;
    }
    upsertSection(db, section, payload, new Date().toISOString());
    return payload as T;
  } finally {
    db.close();
  }
}

export function replaceWorkspaceSection<T extends Record<string, unknown>>(
  workspace: string,
  section: string,
  value: T,
): T {
  if (!validSection(section)) throw new Error(`Invalid workspace preference section: ${section}`);
  if (!isObject(value)) throw new Error("Workspace preference value must be an object");
  const { db } = openWorkspacePrefs(workspace);
  try {
    upsertSection(db, section, value, new Date().toISOString());
    return value;
  } finally {
    db.close();
  }
}

export function workspacePrefsStorageInfo(workspace: string) {
  const resolved = assertWorkspace(workspace);
  return {
    database_path: ensurePhoenixDatabase(resolved),
    legacy_json_path: legacyJsonPath(resolved),
    storage: "sqlite" as const,
  };
}
