import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  CAA_CONTROL_CATALOG,
  caaDialogGroupKey,
  caaDialogGroupLabel,
  extractCatDlgDialogName,
  isKnownCaaControlType,
} from "@desk-tools/catdlg-core";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";
import {
  ensurePhoenixDatabase,
  phoenixDatabasePath,
} from "./phoenixDatabaseService.js";

type CaaIndexRecord = {
  repoRelCatDlg: string;
  dialogName: string;
  title: string;
  filename: string;
  groupKey: string;
  groupLabel: string;
  sizeBytes: number;
  mtimeMs: number;
  typeCounts: Record<string, number>;
};

type ExistingRecord = CaaIndexRecord & {
  fileStatus: string;
};

const PRESENT = "present";
const MISSING = "missing";
const SKIP_DIRS = new Set([".git", ".phoenix", "node_modules"]);
const activeScans = new Map<string, Promise<any>>();

function validWorkspace(workspace: string): string | null {
  const raw = String(workspace || "").trim();
  if (!raw) return null;
  const resolved = path.resolve(raw);
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function assertWorkspace(workspace: string): string {
  const resolved = validWorkspace(workspace);
  if (!resolved) throw new Error("CAA index workspace is not a valid directory");
  return resolved;
}

function tableExists(db: PnwDbAdapter, table: string): boolean {
  return Boolean(db.get(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
    [table],
  ));
}

function ensureColumn(db: PnwDbAdapter, table: string, column: string, ddl: string): void {
  const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function ensureCaaIndexSchema(db: PnwDbAdapter): boolean {
  db.exec(`
    PRAGMA foreign_keys = ON;
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
  `);
  ensureColumn(db, "phoenix_caa_dialog", "mtime_ms", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "phoenix_caa_dialog", "type_counts_json", "TEXT NOT NULL DEFAULT '{}'");
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS phoenix_caa_dialog_fts USING fts5(
        repo_rel_catdlg UNINDEXED,
        dialog_name,
        title,
        filename,
        group_key,
        group_label,
        body,
        tokenize='unicode61 remove_diacritics 0'
      )
    `);
    return true;
  } catch {
    return false;
  }
}

function parseTypeCounts(raw: unknown): Record<string, number> {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const count = Number(value);
      if (key && Number.isFinite(count) && count > 0) out[key] = Math.trunc(count);
    }
    return out;
  } catch {
    return {};
  }
}

function collectTypeCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of text.matchAll(/\b(CATDlg[A-Za-z0-9_]+)\s+[A-Za-z_][A-Za-z0-9_]*/g)) {
    const type = match[1];
    counts[type] = (counts[type] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function buildCoverage(records: CaaIndexRecord[]) {
  const byType = new Map<string, { count: number; dialogs: Set<string> }>();
  for (const record of records) {
    for (const [type, count] of Object.entries(record.typeCounts)) {
      const item = byType.get(type) || { count: 0, dialogs: new Set<string>() };
      item.count += count;
      item.dialogs.add(record.repoRelCatDlg);
      byType.set(type, item);
    }
  }
  const types = [...byType.entries()]
    .map(([type, item]) => ({
      type,
      count: item.count,
      dialog_count: item.dialogs.size,
      known: isKnownCaaControlType(type),
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const unknown = types.filter((row) => !row.known);
  return {
    catalog_type_count: CAA_CONTROL_CATALOG.length,
    total_types: types.length,
    known_types: types.length - unknown.length,
    unknown_types: unknown.length,
    total_controls: types.reduce((sum, row) => sum + row.count, 0),
    unknown_controls: unknown.reduce((sum, row) => sum + row.count, 0),
    types,
    unknown,
  };
}

async function discoverCatDlgFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".catdlg")) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function existingRecords(db: PnwDbAdapter): Map<string, ExistingRecord> {
  if (!tableExists(db, "phoenix_caa_dialog")) return new Map();
  const rows = db.all<any>(`
    SELECT repo_rel_catdlg, dialog_name, title, filename, group_key, group_label,
           file_status, size_bytes, mtime_ms, type_counts_json
    FROM phoenix_caa_dialog
  `);
  return new Map(rows.map((row) => {
    const rel = String(row.repo_rel_catdlg);
    return [rel, {
      repoRelCatDlg: rel,
      dialogName: String(row.dialog_name || path.posix.basename(rel, ".CATDlg")),
      title: String(row.title || row.dialog_name || ""),
      filename: String(row.filename || path.posix.basename(rel)),
      groupKey: String(row.group_key || caaDialogGroupKey(rel)),
      groupLabel: String(row.group_label || caaDialogGroupLabel(caaDialogGroupKey(rel))),
      fileStatus: String(row.file_status || PRESENT),
      sizeBytes: Number(row.size_bytes || 0),
      mtimeMs: Number(row.mtime_ms || 0),
      typeCounts: parseTypeCounts(row.type_counts_json),
    } satisfies ExistingRecord];
  }));
}

async function buildRecords(root: string, db: PnwDbAdapter) {
  const existing = existingRecords(db);
  const files = await discoverCatDlgFiles(root);
  const records: CaaIndexRecord[] = [];
  let changed = 0;
  let reused = 0;
  for (const filename of files) {
    const stat = await fsp.stat(filename);
    const rel = path.relative(root, filename).replace(/\\/g, "/");
    const cached = existing.get(rel);
    if (
      cached
      && cached.sizeBytes === stat.size
      && Math.trunc(cached.mtimeMs) === Math.trunc(stat.mtimeMs)
    ) {
      records.push({
        ...cached,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      reused += 1;
      continue;
    }
    let text = "";
    try {
      text = await fsp.readFile(filename, "utf8");
    } catch {
      text = "";
    }
    const fallback = path.posix.basename(rel, ".CATDlg");
    const dialogName = extractCatDlgDialogName(text) || fallback;
    const groupKey = caaDialogGroupKey(rel);
    records.push({
      repoRelCatDlg: rel,
      dialogName,
      title: dialogName,
      filename: path.posix.basename(rel),
      groupKey,
      groupLabel: caaDialogGroupLabel(groupKey),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      typeCounts: collectTypeCounts(text),
    });
    changed += 1;
  }
  const seen = new Set(records.map((record) => record.repoRelCatDlg));
  const missing = [...existing.values()].filter(
    (record) => record.fileStatus === PRESENT && !seen.has(record.repoRelCatDlg),
  ).length;
  return { records, changed, reused, missing };
}

function saveRecords(
  db: PnwDbAdapter,
  records: CaaIndexRecord[],
  stats: Record<string, unknown>,
  scannedAt: string,
  ftsAvailable: boolean,
): number {
  db.exec("BEGIN TRANSACTION");
  try {
    db.run(
      "UPDATE phoenix_caa_dialog SET file_status = ?, updated_at = ? WHERE file_status != ?",
      [MISSING, scannedAt, MISSING],
    );
    if (ftsAvailable) db.run("DELETE FROM phoenix_caa_dialog_fts");
    for (const record of records) {
      db.run(
        `INSERT INTO phoenix_caa_dialog(
           repo_rel_catdlg, dialog_name, title, filename, group_key, group_label,
           file_status, size_bytes, mtime_ms, type_counts_json, last_seen_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_rel_catdlg) DO UPDATE SET
           dialog_name = excluded.dialog_name,
           title = excluded.title,
           filename = excluded.filename,
           group_key = excluded.group_key,
           group_label = excluded.group_label,
           file_status = excluded.file_status,
           size_bytes = excluded.size_bytes,
           mtime_ms = excluded.mtime_ms,
           type_counts_json = excluded.type_counts_json,
           last_seen_at = excluded.last_seen_at,
           updated_at = excluded.updated_at`,
        [
          record.repoRelCatDlg,
          record.dialogName,
          record.title,
          record.filename,
          record.groupKey,
          record.groupLabel,
          PRESENT,
          record.sizeBytes,
          record.mtimeMs,
          JSON.stringify(record.typeCounts),
          scannedAt,
          scannedAt,
        ],
      );
      db.run(
        `INSERT INTO phoenix_caa_dialog_group(group_key, group_label, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(group_key) DO UPDATE SET
           group_label = excluded.group_label,
           updated_at = excluded.updated_at`,
        [record.groupKey, record.groupLabel, scannedAt],
      );
      const dialogId = Number(db.get<{ id: number }>(
        "SELECT id FROM phoenix_caa_dialog WHERE repo_rel_catdlg = ?",
        [record.repoRelCatDlg],
      )?.id || 0);
      db.run("DELETE FROM phoenix_caa_dialog_group_member WHERE dialog_id = ?", [dialogId]);
      db.run(
        "INSERT OR IGNORE INTO phoenix_caa_dialog_group_member(group_key, dialog_id) VALUES (?, ?)",
        [record.groupKey, dialogId],
      );
      if (ftsAvailable) {
        db.run(
          `INSERT INTO phoenix_caa_dialog_fts(
             repo_rel_catdlg, dialog_name, title, filename, group_key, group_label, body
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            record.repoRelCatDlg,
            record.dialogName,
            record.title,
            record.filename,
            record.groupKey,
            record.groupLabel,
            [
              record.repoRelCatDlg,
              record.dialogName,
              record.title,
              record.filename,
              record.groupKey,
              record.groupLabel,
              ...Object.keys(record.typeCounts),
            ].join(" "),
          ],
        );
      }
    }
    db.run(`
      DELETE FROM phoenix_caa_dialog_group_member
      WHERE dialog_id IN (
        SELECT id FROM phoenix_caa_dialog WHERE file_status = ?
      )
    `, [MISSING]);
    db.run(`
      DELETE FROM phoenix_caa_dialog_group
      WHERE NOT EXISTS (
        SELECT 1 FROM phoenix_caa_dialog_group_member m
        WHERE m.group_key = phoenix_caa_dialog_group.group_key
      )
    `);
    db.run(
      "INSERT INTO phoenix_caa_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
      [scannedAt, ".", JSON.stringify(stats)],
    );
    const scanId = Number(db.get<{ id: number }>("SELECT last_insert_rowid() AS id")?.id || 0);
    db.run(
      `INSERT INTO phoenix_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ["caa_last_scan_at", scannedAt],
    );
    db.run(
      `INSERT INTO phoenix_meta(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ["caa_last_scan_stats", JSON.stringify(stats)],
    );
    db.exec("COMMIT");
    return scanId;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

async function performScan(workspace: string) {
  const root = assertWorkspace(workspace);
  const db = pnwCreateDb(ensurePhoenixDatabase(root));
  try {
    const ftsAvailable = ensureCaaIndexSchema(db);
    const built = await buildRecords(root, db);
    const scannedAt = new Date().toISOString();
    const stats = {
      dialogs: built.records.length,
      total: built.records.length,
      changed: built.changed,
      reused: built.reused,
      missing: built.missing,
      control_type_coverage: buildCoverage(built.records),
    };
    const scanId = saveRecords(db, built.records, stats, scannedAt, ftsAvailable);
    return {
      ...(loadCaaDialogIndex(root)),
      scan_id: scanId,
      summary: `Indexed ${built.records.length} CAA dialogs (${built.changed} changed, ${built.reused} reused, ${built.missing} missing).`,
    };
  } finally {
    db.close();
  }
}

export function scanCaaDialogIndex(workspace: string): Promise<any> {
  const root = assertWorkspace(workspace);
  const key = process.platform === "win32" ? root.toLowerCase() : root;
  const active = activeScans.get(key);
  if (active) return active;
  const promise = performScan(root).finally(() => {
    if (activeScans.get(key) === promise) activeScans.delete(key);
  });
  activeScans.set(key, promise);
  return promise;
}

function parseStats(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (match) => `\${match}`)}%`;
}

export function loadCaaDialogIndex(workspace: string, query = "") {
  const root = validWorkspace(workspace) || String(workspace || "").trim();
  const empty = {
    workspaceRoot: root,
    count: 0,
    groups: [] as Array<{
      groupKey: string;
      label: string;
      items: Array<Record<string, string>>;
    }>,
    indexed: false,
    last_scan_at: null as string | null,
    stats: {
      dialogs: 0,
      total: 0,
      control_type_coverage: buildCoverage([]),
    } as Record<string, unknown>,
  };
  if (!validWorkspace(root)) return empty;
  const databasePath = phoenixDatabasePath(root);
  if (!fs.existsSync(databasePath)) return empty;
  const db = pnwCreateDb(databasePath);
  try {
    if (!tableExists(db, "phoenix_caa_dialog") || !tableExists(db, "phoenix_caa_scan")) return empty;
    const last = db.get<{ value: string }>(
      "SELECT value FROM phoenix_meta WHERE key = 'caa_last_scan_at'",
    )?.value || null;
    const statsRaw = db.get<{ value: string }>(
      "SELECT value FROM phoenix_meta WHERE key = 'caa_last_scan_stats'",
    )?.value;
    const needle = String(query || "").trim();
    const params: unknown[] = [PRESENT];
    let filter = "";
    if (needle) {
      const pattern = likePattern(needle);
      filter = `
        AND (
          repo_rel_catdlg LIKE ? ESCAPE '\\'
          OR dialog_name LIKE ? ESCAPE '\\'
          OR filename LIKE ? ESCAPE '\\'
          OR group_key LIKE ? ESCAPE '\\'
          OR group_label LIKE ? ESCAPE '\\'
        )
      `;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
    const rows = db.all<any>(
      `SELECT repo_rel_catdlg, dialog_name, title, filename, group_key, group_label
       FROM phoenix_caa_dialog
       WHERE file_status = ? ${filter}
       ORDER BY group_key COLLATE NOCASE, dialog_name COLLATE NOCASE, filename COLLATE NOCASE`,
      params,
    );
    const groups = new Map<string, {
      groupKey: string;
      label: string;
      items: Array<Record<string, string>>;
    }>();
    for (const row of rows) {
      const groupKey = String(row.group_key);
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          groupKey,
          label: String(row.group_label || caaDialogGroupLabel(groupKey)),
          items: [],
        };
        groups.set(groupKey, group);
      }
      group.items.push({
        catDlgRel: String(row.repo_rel_catdlg),
        dialogName: String(row.dialog_name),
        title: String(row.title || row.dialog_name),
        fileName: String(row.filename),
        groupKey,
        groupLabel: String(row.group_label || caaDialogGroupLabel(groupKey)),
      });
    }
    return {
      workspaceRoot: root,
      count: rows.length,
      groups: [...groups.values()],
      indexed: Boolean(last),
      last_scan_at: last,
      stats: Object.keys(parseStats(statsRaw)).length ? parseStats(statsRaw) : empty.stats,
    };
  } finally {
    db.close();
  }
}
