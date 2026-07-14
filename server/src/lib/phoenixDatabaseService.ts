import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";

export const PHOENIX_SCHEMA_VERSION = 13;

const DATABASE_FILENAME = "phoenix-workspace.sqlite";
const LEGACY_DATABASE_FILENAMES = ["cad-database.sqlite", "phoenix-cad.sqlite"];
const OLD_TABLE_NAMES = [
  "meta",
  "fcstd_scan",
  "file_asset",
  "part_key",
  "part_file_link",
  "bom_xref",
  "bom_assembly_cache",
  "bom_tree_occurrence",
  "change_event",
  "rename_log",
  "ref_hit",
  "ref_patch_log",
  "ui_session",
];

const CREATE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS phoenix_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_cad_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_uuid TEXT UNIQUE,
  scanned_at TEXT NOT NULL,
  scan_root TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  phase TEXT DEFAULT '',
  progress_json TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS phoenix_cad_file_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_rel_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  asset_kind TEXT,
  part_number TEXT,
  part_version TEXT,
  type_code TEXT,
  model_series TEXT,
  part_name TEXT,
  label TEXT,
  file_status TEXT NOT NULL DEFAULT 'present',
  last_seen_at TEXT,
  bom_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_file_asset_filename
  ON phoenix_cad_file_asset(filename);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_file_asset_status
  ON phoenix_cad_file_asset(file_status);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_file_asset_part
  ON phoenix_cad_file_asset(part_number, part_version);

CREATE TABLE IF NOT EXISTS phoenix_cad_part_key (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number TEXT NOT NULL,
  part_version TEXT NOT NULL,
  type_code TEXT,
  model_series TEXT,
  part_name TEXT,
  label TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(part_number, part_version)
);

CREATE TABLE IF NOT EXISTS phoenix_cad_part_file_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_key_id INTEGER NOT NULL REFERENCES phoenix_cad_part_key(id) ON DELETE CASCADE,
  file_asset_id INTEGER NOT NULL UNIQUE REFERENCES phoenix_cad_file_asset(id) ON DELETE CASCADE,
  file_role TEXT NOT NULL DEFAULT 'part',
  notes TEXT,
  link_status TEXT NOT NULL DEFAULT 'active',
  linked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_part_key_pn_pv
  ON phoenix_cad_part_key(part_number, part_version);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_part_file_link_key
  ON phoenix_cad_part_file_link(part_key_id);

CREATE TABLE IF NOT EXISTS phoenix_audit_change_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT,
  source TEXT,
  note TEXT,
  stats_json TEXT
);

CREATE TABLE IF NOT EXISTS phoenix_audit_rename_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES phoenix_audit_change_event(id) ON DELETE CASCADE,
  file_asset_id INTEGER REFERENCES phoenix_cad_file_asset(id) ON DELETE SET NULL,
  old_repo_rel_path TEXT NOT NULL,
  new_repo_rel_path TEXT NOT NULL,
  old_filename TEXT NOT NULL,
  new_filename TEXT NOT NULL,
  old_basename TEXT NOT NULL,
  new_basename TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_audit_ref_hit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES phoenix_audit_change_event(id) ON DELETE CASCADE,
  rename_log_id INTEGER REFERENCES phoenix_audit_rename_log(id) ON DELETE SET NULL,
  host_repo_rel_path TEXT NOT NULL,
  host_asset_kind TEXT,
  ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
  locator TEXT NOT NULL DEFAULT 'Document.xml',
  matched_text TEXT NOT NULL,
  proposed_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS phoenix_audit_ref_patch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES phoenix_audit_change_event(id) ON DELETE CASCADE,
  ref_hit_id INTEGER REFERENCES phoenix_audit_ref_hit(id) ON DELETE SET NULL,
  host_repo_rel_path TEXT NOT NULL,
  old_text TEXT NOT NULL,
  new_text TEXT NOT NULL,
  applied_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_phoenix_audit_rename_log_old_basename
  ON phoenix_audit_rename_log(old_basename);
CREATE INDEX IF NOT EXISTS idx_phoenix_audit_ref_hit_rename
  ON phoenix_audit_ref_hit(rename_log_id);
CREATE INDEX IF NOT EXISTS idx_phoenix_audit_ref_hit_host
  ON phoenix_audit_ref_hit(host_repo_rel_path);

CREATE TABLE IF NOT EXISTS phoenix_ui_session (
  scope TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_cad_bom_xref (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES phoenix_cad_scan(id) ON DELETE CASCADE,
  host_file_asset_id INTEGER NOT NULL REFERENCES phoenix_cad_file_asset(id) ON DELETE CASCADE,
  host_repo_rel_path TEXT NOT NULL,
  ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
  locator TEXT NOT NULL DEFAULT 'Document.xml',
  xlink_file_attr TEXT NOT NULL,
  link_label TEXT NOT NULL DEFAULT '',
  rule_label TEXT NOT NULL DEFAULT '',
  target_basename TEXT NOT NULL,
  target_file_asset_id INTEGER REFERENCES phoenix_cad_file_asset(id) ON DELETE SET NULL,
  target_repo_rel_path TEXT,
  target_part_number TEXT NOT NULL DEFAULT '',
  target_part_version TEXT NOT NULL DEFAULT '',
  target_type_code TEXT NOT NULL DEFAULT '',
  target_model_series TEXT NOT NULL DEFAULT '',
  target_part_name TEXT NOT NULL DEFAULT '',
  target_asset_label TEXT NOT NULL DEFAULT '',
  resolve_status TEXT NOT NULL DEFAULT 'missing',
  detail_json TEXT,
  last_seen_at TEXT NOT NULL,
  UNIQUE(host_file_asset_id, xlink_file_attr)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_host
  ON phoenix_cad_bom_xref(host_file_asset_id);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_host_path
  ON phoenix_cad_bom_xref(host_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_asset
  ON phoenix_cad_bom_xref(target_file_asset_id);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_basename
  ON phoenix_cad_bom_xref(target_basename);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_path
  ON phoenix_cad_bom_xref(target_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_scan
  ON phoenix_cad_bom_xref(scan_id);

CREATE TABLE IF NOT EXISTS phoenix_cad_bom_assembly_cache (
  host_repo_rel_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  tree_json TEXT NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0,
  bom_xref_at TEXT NOT NULL DEFAULT '',
  built_at TEXT NOT NULL,
  PRIMARY KEY (host_repo_rel_path, mode)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_asm_cache_built
  ON phoenix_cad_bom_assembly_cache(bom_xref_at);

CREATE TABLE IF NOT EXISTS phoenix_cad_bom_tree_occurrence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_host_repo_rel_path TEXT NOT NULL,
  tree_path TEXT NOT NULL,
  depth INTEGER NOT NULL,
  host_repo_rel_path TEXT NOT NULL,
  target_repo_rel_path TEXT,
  xlink_file_attr TEXT NOT NULL,
  link_label TEXT,
  built_at TEXT NOT NULL,
  UNIQUE(root_host_repo_rel_path, tree_path)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_occ_target
  ON phoenix_cad_bom_tree_occurrence(target_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_occ_root
  ON phoenix_cad_bom_tree_occurrence(root_host_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_occ_host_target
  ON phoenix_cad_bom_tree_occurrence(host_repo_rel_path, target_repo_rel_path);

CREATE TABLE IF NOT EXISTS phoenix_cad_bom_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES phoenix_cad_scan(id) ON DELETE CASCADE,
  assembly_rel TEXT NOT NULL,
  part_rel TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  bom_path TEXT NOT NULL,
  part_key TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  cycle_detected INTEGER NOT NULL DEFAULT 0,
  built_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_line_assembly
  ON phoenix_cad_bom_line(assembly_rel);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_line_part
  ON phoenix_cad_bom_line(part_rel);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_line_scan
  ON phoenix_cad_bom_line(scan_id);

CREATE TABLE IF NOT EXISTS phoenix_cad_xref_flat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES phoenix_cad_scan(id) ON DELETE CASCADE,
  host_rel TEXT NOT NULL,
  target_rel TEXT NOT NULL,
  link_label TEXT NOT NULL DEFAULT '',
  is_direct INTEGER NOT NULL DEFAULT 1,
  built_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_xref_flat_host
  ON phoenix_cad_xref_flat(host_rel);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_xref_flat_target
  ON phoenix_cad_xref_flat(target_rel);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_xref_flat_scan
  ON phoenix_cad_xref_flat(scan_id);

CREATE TABLE IF NOT EXISTS phoenix_code_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT NOT NULL,
  scan_root TEXT NOT NULL,
  stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_code_file_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_rel_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  asset_kind TEXT NOT NULL,
  file_ext TEXT NOT NULL DEFAULT '',
  file_status TEXT NOT NULL DEFAULT 'present',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  text_encoding TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_kind
  ON phoenix_code_file_asset(asset_kind);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_filename
  ON phoenix_code_file_asset(filename);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_status
  ON phoenix_code_file_asset(file_status);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_ext
  ON phoenix_code_file_asset(file_ext);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_encoding
  ON phoenix_code_file_asset(text_encoding);

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

CREATE TABLE IF NOT EXISTS phoenix_caa_scan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT NOT NULL,
  scan_root TEXT NOT NULL,
  stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_caa_dialog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_rel_catdlg TEXT NOT NULL UNIQUE,
  dialog_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  group_key TEXT NOT NULL,
  group_label TEXT NOT NULL,
  file_status TEXT NOT NULL DEFAULT 'present',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mtime_ms REAL NOT NULL DEFAULT 0,
  type_counts_json TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_caa_dialog_group (
  group_key TEXT PRIMARY KEY,
  group_label TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phoenix_caa_dialog_group_member (
  group_key TEXT NOT NULL,
  dialog_id INTEGER NOT NULL,
  PRIMARY KEY(group_key, dialog_id),
  FOREIGN KEY(dialog_id) REFERENCES phoenix_caa_dialog(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_phoenix_caa_dialog_status
  ON phoenix_caa_dialog(file_status);
CREATE INDEX IF NOT EXISTS idx_phoenix_caa_dialog_group
  ON phoenix_caa_dialog(group_key);
CREATE INDEX IF NOT EXISTS idx_phoenix_caa_dialog_name
  ON phoenix_caa_dialog(dialog_name);

CREATE TABLE IF NOT EXISTS phoenix_workspace_pref (
  section TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

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
    `INSERT INTO phoenix_meta(key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(PHOENIX_SCHEMA_VERSION)],
  );
}

export function ensurePhoenixDatabase(workspace: string): string {
  const resolved = assertWorkspace(workspace);
  const filename = phoenixDatabasePath(resolved);
  if (fs.existsSync(filename)) return filename;
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
      if (fs.existsSync(databasePath) && schemaVersion !== PHOENIX_SCHEMA_VERSION) {
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

function removeDatabaseFamily(filename: string): boolean {
  const existed = fs.existsSync(filename);
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${filename}${suffix}`;
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  return existed;
}

export function recreatePhoenixDatabase(workspace: string) {
  const resolved = assertWorkspace(workspace);
  const databasePath = phoenixDatabasePath(resolved);
  const removedFiles: string[] = [];
  for (const filename of [...legacyPaths(resolved), databasePath]) {
    if (removeDatabaseFamily(filename)) removedFiles.push(path.basename(filename));
  }
  ensurePhoenixDatabase(resolved);
  return {
    status: "recreated",
    removed_files: removedFiles,
    database_path: databasePath,
    schema_version: PHOENIX_SCHEMA_VERSION,
    recreated_at: new Date().toISOString(),
  };
}
