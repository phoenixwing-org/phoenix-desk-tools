import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import {
  PNW_WORKSPACE_DATABASE_FILENAME,
  PNW_WORKSPACE_LEGACY_DATABASE_FILENAMES,
  PNW_WORKSPACE_LEGACY_TABLE_NAMES,
  PNW_WORKSPACE_SCHEMA_V13_DDL,
  PNW_WORKSPACE_SCHEMA_VERSION,
  PNW_WORKSPACE_SCHEMA_VERSION_UPSERT_SQL,
  pnwClassifyWorkspaceSchemaVersion,
} from "@phoenix-wing/workspace-schema";

export const PHOENIX_SCHEMA_VERSION = PNW_WORKSPACE_SCHEMA_VERSION;

const DATABASE_FILENAME = PNW_WORKSPACE_DATABASE_FILENAME;
const LEGACY_DATABASE_FILENAMES = [...PNW_WORKSPACE_LEGACY_DATABASE_FILENAMES];
const require = createRequire(import.meta.url);
const OLD_TABLE_NAMES = [...PNW_WORKSPACE_LEGACY_TABLE_NAMES];
const CREATE_SCHEMA_DDL = PNW_WORKSPACE_SCHEMA_V13_DDL;

export type PhoenixDatabaseStatus = {
  legacy_detected: boolean;
  needs_recreate: boolean;
  reasons: string[];
  old_tables_found: string[];
  legacy_file_exists: boolean;
  database_exists: boolean;
  database_path: string;
  legacy_database_path: string;
  legacy_database_paths: string[];
  database_filename: string;
  legacy_database_filename: string;
  legacy_database_filenames: string[];
  expected_schema_version: number;
  schema_version: number | null;
  database_path_display: string;
};

function assertWorkspace(workspace: string): string {
  const resolved = path.resolve(String(workspace || "").trim());
  try {
    if (fs.statSync(resolved).isDirectory()) return resolved;
  } catch {
    // Use a stable route-level error below.
  }
  throw new Error("Workspace is not configured");
}

function phoenixDir(workspace: string): string {
  return path.join(workspace, ".phoenix");
}

/**
 * node-sqlite3-wasm does not implement SQLite's WAL VFS. A workspace created
 * by a native SQLite client can retain WAL mode in its database header even
 * after its `-wal` file has been checkpointed, so normalize that case before
 * handing the file to the WASM adapter.
 */
function migrateWalJournalForWasm(filename: string): void {
  let header: Buffer;
  try {
    header = fs.readFileSync(filename);
  } catch {
    return;
  }
  // SQLite header bytes 18 and 19 are the file-format write/read versions.
  // Both are 2 when the database uses WAL journaling.
  if (header.length < 20 || header[18] !== 2 || header[19] !== 2) return;

  try {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(filename);
    try {
      db.exec("PRAGMA journal_mode = DELETE");
    } finally {
      db.close();
    }
    return;
  } catch (error: any) {
    // node:sqlite was added after the Node versions used by some Electron
    // shells. macOS ships sqlite3, which is sufficient for this one-time
    // compatibility migration without adding a native npm dependency.
    if (error?.code === "ERR_UNKNOWN_BUILTIN_MODULE" || /No such built-in module/.test(String(error?.message))) {
      const sqlite3 = process.platform === "darwin" ? "/usr/bin/sqlite3" : "sqlite3";
      const result = spawnSync(sqlite3, [filename, "PRAGMA journal_mode = DELETE;"], {
        encoding: "utf8",
      });
      if (!result.error && result.status === 0) return;
      const detail = result.error?.message || result.stderr?.trim() || `exit code ${result.status}`;
      throw new Error(
        `Cannot migrate WAL SQLite database for the WASM adapter (${filename}): sqlite3 ${detail}`,
      );
    }
    throw new Error(
      `Cannot migrate WAL SQLite database for the WASM adapter (${filename}): ${error?.message || String(error)}`,
    );
  }
}

export function phoenixDatabasePath(workspace: string): string {
  return path.join(path.resolve(workspace), ".phoenix", DATABASE_FILENAME);
}

function legacyPaths(workspace: string): string[] {
  return LEGACY_DATABASE_FILENAMES.map((name) => path.join(phoenixDir(workspace), name));
}

function createSchema(db: PnwDbAdapter): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(CREATE_SCHEMA_DDL);
  db.run(
    PNW_WORKSPACE_SCHEMA_VERSION_UPSERT_SQL,
    [String(PHOENIX_SCHEMA_VERSION)],
  );
}

export function ensurePhoenixDatabase(workspace: string): string {
  const resolved = assertWorkspace(workspace);
  const filename = phoenixDatabasePath(resolved);
  if (fs.existsSync(filename)) {
    migrateWalJournalForWasm(filename);
    return filename;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = pnwCreateDb(filename);
  try {
    createSchema(db);
  } catch (error) {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(`${filename}${suffix}`); } catch { /* best effort for a new partial database */ }
    }
    throw error;
  }
  db.close();
  return filename;
}

function inspectDatabase(filename: string): { tables: string[]; schemaVersion: number | null } {
  const db = pnwCreateDb(filename);
  try {
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).map((row) => String(row.name));
    let schemaVersion: number | null = null;
    const metaTable = tables.includes("phoenix_meta") ? "phoenix_meta" : tables.includes("meta") ? "meta" : "";
    if (metaTable) {
      const raw = db.get<{ value: string }>(`SELECT value FROM ${metaTable} WHERE key = ?`, ["schema_version"]);
      const parsed = Number(raw?.value);
      if (Number.isInteger(parsed)) schemaVersion = parsed;
    }
    return { tables, schemaVersion };
  } finally {
    db.close();
  }
}

export function getPhoenixDatabaseStatus(workspace: string): PhoenixDatabaseStatus {
  const resolved = assertWorkspace(workspace);
  const databasePath = phoenixDatabasePath(resolved);
  const oldPaths = legacyPaths(resolved);
  const legacyFileExists = oldPaths.some((filename) => fs.existsSync(filename));
  const inspectedPath = fs.existsSync(databasePath)
    ? databasePath
    : oldPaths.find((filename) => fs.existsSync(filename));
  const reasons: string[] = [];
  for (const filename of oldPaths) {
    if (fs.existsSync(filename)) reasons.push(`legacy_file:${path.basename(filename)}`);
  }
  let schemaVersion: number | null = null;
  let oldTablesFound: string[] = [];
  if (inspectedPath) {
    try {
      const inspected = inspectDatabase(inspectedPath);
      schemaVersion = inspected.schemaVersion;
      oldTablesFound = OLD_TABLE_NAMES.filter((name) => inspected.tables.includes(name));
      for (const name of oldTablesFound) reasons.push(`old_table:${name}`);
      if (fs.existsSync(databasePath)
          && pnwClassifyWorkspaceSchemaVersion(schemaVersion) === "recreate") {
        reasons.push("schema_version_mismatch");
      }
    } catch {
      reasons.push("database_unreadable");
    }
  }
  const legacyDetected = legacyFileExists || oldTablesFound.length > 0;
  return {
    legacy_detected: legacyDetected,
    needs_recreate: reasons.length > 0,
    reasons,
    old_tables_found: oldTablesFound,
    legacy_file_exists: legacyFileExists,
    database_exists: Boolean(inspectedPath),
    database_path: databasePath,
    legacy_database_path: oldPaths[0],
    legacy_database_paths: oldPaths,
    database_filename: DATABASE_FILENAME,
    legacy_database_filename: LEGACY_DATABASE_FILENAMES[0],
    legacy_database_filenames: [...LEGACY_DATABASE_FILENAMES],
    expected_schema_version: PHOENIX_SCHEMA_VERSION,
    schema_version: schemaVersion,
    database_path_display: fs.existsSync(databasePath)
      ? path.relative(resolved, databasePath).replace(/\\/g, "/")
      : "",
  };
}

export const PHOENIX_DATABASE_RECREATE_DISABLED = "PHOENIX_DATABASE_RECREATE_DISABLED";

/** Kept as a refusing compatibility entry point; client confirmation is not recovery proof. */
export function recreatePhoenixDatabase(_workspace: string): never {
  throw Object.assign(new Error(
    "原位重建已禁用：请先备份数据库与 outbox，并在新目录恢复验证。原数据保持不变；备份包不授予覆盖或删除权限。",
  ), { code: PHOENIX_DATABASE_RECREATE_DISABLED });
}
