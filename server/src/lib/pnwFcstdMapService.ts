/** pnwFcstdMapService — 对应 Python fcstd_map_service.py (966行)
 *  函数逐行移植，保持命名和逻辑一致。
 *
 *  接口规则：所有返回给前端的对象必须经过 pnwApiAdapter 转换，
 *  确保字段名与 Python 接口 100% 一致。
 */

import { toFcstdMapEntry } from "./pnwApiAdapter.js";

import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";
import { rebuildBomXrefs, rebuildBomXrefsAsync } from "./pnwBomXrefService.js";
import {
  loadWorkspacePrefs,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import { resolveNativeTool } from "./nativeToolService.js";

// ── 对应 Python: 常量 ──────────────────────────────────
const FILE_STATUS_PRESENT = "present";
const FILE_STATUS_MISSING = "missing";
const ASSET_KIND_FCSTD = "fcstd";

const CAD_EXTS = new Set([".fcstd", ".FCStd", ".step", ".stp", ".STEP", ".STP", ".dxf", ".DXF", ".dwg", ".DWG", ".md", ".MD", ".pdf", ".PDF", ".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG", ".gif", ".GIF", ".svg", ".SVG"]);
const SKIP_DIRS = new Set([".git", "__pycache__", ".obsidian", ".phoenix", "node_modules", ".cursor", "temp", ".venv", ".venv-desktop", "web-ui", "dist", "build"]);

type FcstdDbRow = {
  repo_rel_path: string;
  filename: string;
  asset_kind?: string | null;
  part_number?: string | null;
  part_version?: string | null;
  type_code?: string | null;
  model_series?: string | null;
  part_name?: string | null;
  label?: string | null;
  file_status?: string | null;
  last_seen_at?: string | null;
};

export type FcstdMapScanScope = {
  worksetId: string;
  worksetName: string;
  dirs: string[];
  files: string[];
};

export type FcstdMapScanOptions = {
  scope?: FcstdMapScanScope;
  isCancelled?: () => boolean;
};

const EMPTY_STATS = {
  total_entries: 0,
  present: 0,
  missing: 0,
  unique_filenames: 0,
  duplicate_filename_kinds: 0,
  cad_file_count: 0,
  fcstd_file_count: 0,
  markdown_file_count: 0,
  pdf_file_count: 0,
  cad_exchange_file_count: 0,
  image_file_count: 0,
};

// 对应 Python: cad_asset_kind
function cadAssetKind(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".fcstd") return "fcstd";
  if (ext === ".step" || ext === ".stp") return "step";
  if (ext === ".dxf" || ext === ".dwg") return "cad_exchange";
  if (ext === ".md") return "markdown";
  if (ext === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg"].includes(ext)) return "image";
  return "other";
}

function isFcstdFilename(name: string): boolean { return /\.fcstd$/i.test(name); }

// ── 对应 Python: _utc_now_iso ─────────────────────────
function utcNowIso(): string { return new Date().toISOString().replace(/\.\d{3}Z$/, ""); }

// ── 对应 Python: _norm_path_key ──────────────────────
function normPathKey(rel: string): string {
  return rel.replace(/\\/g, "/").trim().replace(/^\.\//, "");
}

function pathKeyCandidates(rel: string): string[] {
  const plain = normPathKey(rel);
  return plain ? [plain, `./${plain}`] : [];
}

function dbPath(ws: string): string {
  return path.join(ws, ".phoenix", "phoenix-workspace.sqlite");
}

function mapPath(ws: string): string {
  return path.join(ws, ".phoenix", "fcstd_map.json");
}

function legacyPrefsPath(ws: string): string {
  return path.join(ws, ".phoenix", "fcstd-map-prefs.json");
}

function pathDisplay(p: string): string {
  return p ? path.normalize(p) : "";
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function relToDiskPath(ws: string, rel: string): string {
  return path.join(ws, normPathKey(rel));
}

function openDb(ws: string): PnwDbAdapter {
  const db = pnwCreateDb(ensurePhoenixDatabase(ws));
  ensureSchema(db);
  return db;
}

function ensureSchema(db: PnwDbAdapter): void {
  db.exec(`
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
      updated_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS phoenix_cad_scan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_uuid TEXT,
      scanned_at TEXT,
      scan_root TEXT NOT NULL DEFAULT '.',
      started_at TEXT,
      finished_at TEXT,
      status TEXT,
      phase TEXT,
      progress_json TEXT,
      stats_json TEXT
    )
  `);

  const columns = new Set((db.all<{ name: string }>("PRAGMA table_info(phoenix_cad_file_asset)") || []).map((r) => r.name));
  const required: Array<[string, string]> = [
    ["asset_kind", "TEXT"],
    ["part_number", "TEXT"],
    ["part_version", "TEXT"],
    ["type_code", "TEXT"],
    ["model_series", "TEXT"],
    ["part_name", "TEXT"],
    ["label", "TEXT"],
    ["file_status", "TEXT NOT NULL DEFAULT 'present'"],
    ["last_seen_at", "TEXT"],
    ["updated_at", "TEXT"],
  ];
  for (const [name, ddl] of required) {
    if (!columns.has(name)) db.exec(`ALTER TABLE phoenix_cad_file_asset ADD COLUMN ${name} ${ddl}`);
  }

  const scanColumns = new Set((db.all<{ name: string }>("PRAGMA table_info(phoenix_cad_scan)") || []).map((r) => r.name));
  const requiredScanColumns: Array<[string, string]> = [
    ["scan_uuid", "TEXT"],
    ["scanned_at", "TEXT"],
    ["scan_root", "TEXT NOT NULL DEFAULT '.'"],
    ["started_at", "TEXT"],
    ["finished_at", "TEXT"],
    ["status", "TEXT"],
    ["phase", "TEXT"],
    ["progress_json", "TEXT"],
    ["stats_json", "TEXT"],
  ];
  for (const [name, ddl] of requiredScanColumns) {
    if (!scanColumns.has(name)) db.exec(`ALTER TABLE phoenix_cad_scan ADD COLUMN ${name} ${ddl}`);
  }
}

export function loadFcstdMapPrefs(ws: string): { force_update_part_name: boolean } {
  const store = loadWorkspacePrefs(ws);
  const section = store.fcstd_map;
  if (section && typeof section === "object" && !Array.isArray(section)) {
    return { force_update_part_name: Boolean((section as any).force_update_part_name) };
  }
  let legacy: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(legacyPrefsPath(ws), "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) legacy = raw;
  } catch {
    legacy = {};
  }
  const prefs = { force_update_part_name: Boolean(legacy.force_update_part_name) };
  if (Object.keys(legacy).length) replaceWorkspaceSection(ws, "fcstd_map", prefs);
  return prefs;
}

export function saveFcstdMapPrefs(ws: string, body: any = {}): { force_update_part_name: boolean } {
  const prefs = { force_update_part_name: Boolean(body.force_update_part_name) };
  replaceWorkspaceSection(ws, "fcstd_map", prefs);
  return prefs;
}

// ── 对应 Python: _opt / _opt_upper ──────────────────
function opt(v: any): string | null { if (v == null) return null; const s = String(v).trim(); return s || null; }
function optUpper(v: any): string | null { const s = opt(v); return s ? s.toUpperCase() : null; }

// ── 对应 Python: _compute_stats ──────────────────────
function computeStats(entries: any[], basenameMap?: Map<string, string[]>): Record<string, number> {
  const names = basenameMap || new Map<string, string[]>();
  if (!basenameMap) {
    for (const entry of entries) {
      const name = entry.filename || path.basename(entry.repo_rel_path || "");
      if (!name) continue;
      const arr = names.get(name) || [];
      arr.push(entry.repo_rel_path || name);
      names.set(name, arr);
    }
  }
  const present = entries.filter(e => e.file_status !== FILE_STATUS_MISSING).length;
  const missing = entries.filter(e => e.file_status === FILE_STATUS_MISSING).length;
  let dupKinds = 0; for (const v of names.values()) { if (v.length > 1) dupKinds++; }
  const presentEntries = entries.filter(e => e.file_status !== FILE_STATUS_MISSING);
  const cadCount = presentEntries.length;
  const fcstdCount = presentEntries.filter(e => isFcstdFilename(e.filename || e.repo_rel_path || "")).length;
  const kindCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.file_status === FILE_STATUS_MISSING) continue;
    const k = e.asset_kind || cadAssetKind(e.filename);
    kindCounts[k] = (kindCounts[k] || 0) + 1;
  }
  return {
    total_entries: entries.length, present, missing,
    unique_filenames: names.size, duplicate_filename_kinds: dupKinds,
    cad_file_count: cadCount, fcstd_file_count: fcstdCount,
    markdown_file_count: kindCounts.markdown || 0,
    pdf_file_count: kindCounts.pdf || 0,
    cad_exchange_file_count: kindCounts.cad_exchange || 0,
    image_file_count: kindCounts.image || 0,
  };
}

// ── 对应 Python: _entry_to_api_dict ──────────────────
function entryToApiDict(e: any): any {
  const entry = toFcstdMapEntry(e);
  return {
    ...entry,
    asset_kind: entry.asset_kind || cadAssetKind(entry.filename),
    file_status: entry.file_status || FILE_STATUS_PRESENT,
  };
}

// ── 对应 Python: scan_cad_basename_map ───────────────
function scanBasenameMap(ws: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  function walk(dir: string) {
    let items: fs.Dirent[];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
      else if (e.isFile() && CAD_EXTS.has(path.extname(e.name))) {
        const abs = path.join(dir, e.name);
        let rel = path.relative(ws, abs).replace(/\\/g, "/");
        if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
        const arr = out.get(e.name) || [];
        arr.push(rel);
        out.set(e.name, arr);
      }
    }
  }
  walk(ws);
  return out;
}

async function scanBasenameMapAsync(
  ws: string,
  isCancelled: () => boolean,
): Promise<{ basenameMap: Map<string, string[]>; cancelled: boolean }> {
  const out = new Map<string, string[]>();
  const pending = [ws];
  while (pending.length) {
    if (isCancelled()) return { basenameMap: out, cancelled: true };
    const dir = pending.pop()!;
    let items: fs.Dirent[];
    try {
      items = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of items) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) pending.push(path.join(dir, entry.name));
      } else if (entry.isFile() && CAD_EXTS.has(path.extname(entry.name))) {
        const abs = path.join(dir, entry.name);
        let rel = path.relative(ws, abs).replace(/\\/g, "/");
        if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
        const paths = out.get(entry.name) || [];
        paths.push(rel);
        out.set(entry.name, paths);
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { basenameMap: out, cancelled: false };
}

function normalizeScopeRel(raw: string): string {
  return normPathKey(String(raw || "")).replace(/\/+$/, "");
}

function filterBasenameMapByScope(
  basenameMap: Map<string, string[]>,
  scope?: FcstdMapScanScope,
): Map<string, string[]> {
  if (!scope || (!scope.dirs.length && !scope.files.length)) return basenameMap;
  const files = new Set(scope.files.map(normalizeScopeRel).filter(Boolean).map((item) => item.toLowerCase()));
  const dirs = scope.dirs.map(normalizeScopeRel).filter(Boolean).map((item) => item.toLowerCase());
  const filtered = new Map<string, string[]>();
  for (const [filename, paths] of basenameMap) {
    const kept = paths.filter((rel) => {
      const normalized = normalizeScopeRel(rel).toLowerCase();
      if (files.has(normalized)) return true;
      return dirs.some((dir) => normalized === dir || normalized.startsWith(`${dir}/`));
    });
    if (kept.length) filtered.set(filename, kept);
  }
  return filtered;
}

// ── 对应 Python: hints_from_fcstd_location ────────────
function hintsFromFilename(filename: string): Record<string, string | null> {
  const m = filename.match(/^(\d{6})\.(\d{3})[-.]/);
  if (m) return { PartNumber: m[1], PartVersion: m[2], TypeCode: null, ModelSeries: null, PartName: null, label: null };
  return { PartNumber: null, PartVersion: null, TypeCode: null, ModelSeries: null, PartName: null, label: null };
}

// ── 对应 Python: _read_fcstd_bom ──────────────────────
function readFcstdBom(absPath: string): Record<string, string> {
  const cliRead = resolveNativeTool("fcstd-read");
  if (!cliRead) return {};
  try {
    const stdout = execFileSync(cliRead, [absPath], { timeout: 15000, encoding: "utf8" });
    const doc = JSON.parse(stdout);
    const mount = doc.objects?.find((o: any) => o.isValidBomItem);
    if (!mount?.properties) return {};
    const p = mount.properties;
    const get = (k: string) => typeof p[k] === "string" ? p[k] : (p[k]?.String || p[k]?.value || "");
    return { PartNumber: get("PartNumber"), PartVersion: get("PartVersion"), TypeCode: get("TypeCode").toUpperCase(), ModelSeries: get("ModelSeries").toUpperCase(), PartName: get("PartName"), label: get("Label") || mount.label || "" };
  } catch { return {}; }
}

function readFcstdBomAsync(absPath: string, isCancelled: () => boolean): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    const cliRead = resolveNativeTool("fcstd-read");
    if (!cliRead) {
      resolve({});
      return;
    }
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (isCancelled()) controller.abort();
    }, 25);
    timer.unref?.();
    execFile(
      cliRead,
      [absPath],
      { timeout: 15_000, encoding: "utf8", windowsHide: true, signal: controller.signal },
      (error, stdout) => {
        clearInterval(timer);
        if (error) return resolve({});
        try {
          const doc = JSON.parse(stdout);
          const mount = doc.objects?.find((item: any) => item.isValidBomItem);
          if (!mount?.properties) return resolve({});
          const properties = mount.properties;
          const get = (key: string) => typeof properties[key] === "string"
            ? properties[key]
            : (properties[key]?.String || properties[key]?.value || "");
          resolve({
            PartNumber: get("PartNumber"),
            PartVersion: get("PartVersion"),
            TypeCode: get("TypeCode").toUpperCase(),
            ModelSeries: get("ModelSeries").toUpperCase(),
            PartName: get("PartName"),
            label: get("Label") || mount.label || "",
          });
        } catch {
          resolve({});
        }
      },
    );
  });
}

function mergeProps(entry: any, embedded: Record<string, string>): any {
  const hints = hintsFromFilename(entry.filename);
  let pn = opt(hints.PartNumber) || entry.PartNumber;
  let pv = opt(hints.PartVersion) || entry.PartVersion;
  let tc = optUpper(hints.TypeCode) || entry.TypeCode;
  let ms = optUpper(hints.ModelSeries) || entry.ModelSeries;
  let pname = entry.PartName;
  let label = entry.label;

  if (embedded.PartNumber) pn = embedded.PartNumber;
  if (embedded.PartVersion) pv = embedded.PartVersion;
  if (embedded.TypeCode) tc = embedded.TypeCode;
  if (embedded.ModelSeries) ms = embedded.ModelSeries;
  if (embedded.PartName) pname = embedded.PartName;
  if (embedded.label) label = embedded.label;

  if (!pname) pname = label || entry.filename;

  return {
    ...entry,
    PartNumber: pn, PartVersion: pv, TypeCode: tc, ModelSeries: ms,
    PartName: pname, label: label,
    asset_kind: entry.asset_kind || cadAssetKind(entry.filename),
  };
}

// ── 对应 Python: _entry_from_scan_path ────────────────
function entryFromScanPath(ws: string, rel: string, now: string, readEmbedded = true): any {
  const rp = rel.replace(/\\/g, "/").trim();
  const name = path.basename(rp);
  const kind = cadAssetKind(name);
  const hints = hintsFromFilename(name);

  const entry: any = {
    repo_rel_path: rp, filename: name, asset_kind: kind,
    file_status: FILE_STATUS_PRESENT, last_seen_at: now,
    PartNumber: opt(hints.PartNumber), PartVersion: opt(hints.PartVersion),
    TypeCode: optUpper(hints.TypeCode), ModelSeries: optUpper(hints.ModelSeries),
    PartName: opt(hints.PartName), label: opt(hints.label),
  };

  if (kind === ASSET_KIND_FCSTD && readEmbedded) {
    return mergePropsFromDisk(entry, ws);
  }
  return entry;
}

// ── 对应 Python: upsert file to DB ────────────────────

// ── 对应 Python: load_fcstd_map_payload ──────────────
function entryWithLiveStatus(ws: string, row: FcstdDbRow): any {
  const api = entryToApiDict(row);
  return {
    ...api,
    file_status: fs.existsSync(relToDiskPath(ws, api.repo_rel_path)) ? FILE_STATUS_PRESENT : FILE_STATUS_MISSING,
  };
}

// ── 对应 Python: _merge_props_from_disk ──────────────
function mergePropsFromDisk(entry: any, ws: string): any {
  const rel = (entry.repo_rel_path || "").replace(/^\.\//, "");
  const full = path.join(ws, rel);
  return mergeProps(entry, fs.existsSync(full) ? readFcstdBom(full) : {});
}

function readDbEntries(ws: string): any[] {
  if (!fs.existsSync(dbPath(ws))) return [];
  const db = openDb(ws);
  try {
    const rows = db.all<FcstdDbRow>(
      `SELECT repo_rel_path, filename, asset_kind, part_number, part_version, type_code,
              model_series, part_name, label, file_status, last_seen_at
       FROM phoenix_cad_file_asset
       ORDER BY repo_rel_path`,
    );
    return rows.map((row) => entryWithLiveStatus(ws, row));
  } finally {
    db.close();
  }
}

export function updateFcstdMapEntryRename(ws: string, oldRel: string, newRel: string): boolean {
  if (!ws || !fs.existsSync(dbPath(ws))) return false;
  const oldKeys = pathKeyCandidates(oldRel);
  const newKeys = pathKeyCandidates(newRel);
  if (!oldKeys.length || !newKeys.length) return false;
  const db = openDb(ws);
  try {
    const oldPlaceholders = oldKeys.map(() => "?").join(", ");
    const row = db.get<{ id: number; repo_rel_path: string }>(
      `SELECT id, repo_rel_path FROM phoenix_cad_file_asset WHERE repo_rel_path IN (${oldPlaceholders}) LIMIT 1`,
      oldKeys,
    );
    if (!row) return false;

    const newPlaceholders = newKeys.map(() => "?").join(", ");
    const conflict = db.get<{ id: number; repo_rel_path: string }>(
      `SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path IN (${newPlaceholders}) AND id != ? LIMIT 1`,
      [...newKeys, row.id],
    );
    const oldHadDotPrefix = row.repo_rel_path.startsWith("./");
    const newKey = oldHadDotPrefix ? `./${normPathKey(newRel)}` : normPathKey(newRel);
    const newFilename = path.posix.basename(normPathKey(newRel));
    const oldDiskPath = relToDiskPath(ws, oldRel);
    const newDiskPath = relToDiskPath(ws, newRel);
    if (conflict && (!fs.existsSync(newDiskPath) || fs.existsSync(oldDiskPath))) return false;

    const tableExists = (name: string) => Boolean(db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      [name],
    ));

    db.exec("BEGIN TRANSACTION");
    try {
      if (conflict) {
        if (tableExists("phoenix_cad_part_file_link")) {
          const currentLink = db.get<{ id: number }>(
            "SELECT id FROM phoenix_cad_part_file_link WHERE file_asset_id = ? LIMIT 1",
            [row.id],
          );
          if (currentLink) {
            db.run("DELETE FROM phoenix_cad_part_file_link WHERE file_asset_id = ?", [conflict.id]);
          } else {
            db.run(
              "UPDATE phoenix_cad_part_file_link SET file_asset_id = ? WHERE file_asset_id = ?",
              [row.id, conflict.id],
            );
          }
        }
        if (tableExists("phoenix_cad_bom_xref")) {
          db.run("DELETE FROM phoenix_cad_bom_xref WHERE host_file_asset_id = ?", [conflict.id]);
          db.run(
            "UPDATE phoenix_cad_bom_xref SET target_file_asset_id = ? WHERE target_file_asset_id = ?",
            [row.id, conflict.id],
          );
        }
        if (tableExists("phoenix_audit_rename_log")) {
          db.run("UPDATE phoenix_audit_rename_log SET file_asset_id = NULL WHERE file_asset_id = ?", [conflict.id]);
        }
        db.run("DELETE FROM phoenix_cad_file_asset WHERE id = ?", [conflict.id]);
      }

      db.run(
        `UPDATE phoenix_cad_file_asset
         SET repo_rel_path = ?, filename = ?, file_status = 'present', updated_at = datetime('now')
         WHERE id = ?`,
        [newKey, newFilename, row.id],
      );
      if (tableExists("phoenix_cad_bom_xref")) {
        db.run(
          "UPDATE phoenix_cad_bom_xref SET host_repo_rel_path = ? WHERE host_file_asset_id = ?",
          [newKey, row.id],
        );
        db.run(
          `UPDATE phoenix_cad_bom_xref
           SET target_repo_rel_path = ?, target_basename = ?, resolve_status = 'missing'
           WHERE target_file_asset_id = ?`,
          [newKey, newFilename, row.id],
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return true;
  } finally {
    db.close();
  }
}

function upsertEntry(db: PnwDbAdapter, entry: any): void {
  db.run(
    `INSERT INTO phoenix_cad_file_asset (
       repo_rel_path, filename, asset_kind, part_number, part_version, type_code,
       model_series, part_name, label, file_status, last_seen_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?, datetime('now'))
     ON CONFLICT(repo_rel_path) DO UPDATE SET
       filename=excluded.filename,
       asset_kind=excluded.asset_kind,
       part_number=excluded.part_number,
       part_version=excluded.part_version,
       type_code=excluded.type_code,
       model_series=excluded.model_series,
       part_name=excluded.part_name,
       label=excluded.label,
       file_status='present',
       last_seen_at=excluded.last_seen_at,
       updated_at=datetime('now')`,
    [
      entry.repo_rel_path,
      entry.filename,
      entry.asset_kind || cadAssetKind(entry.filename),
      entry.PartNumber || null,
      entry.PartVersion || null,
      entry.TypeCode || null,
      entry.ModelSeries || null,
      entry.PartName || null,
      entry.label || null,
      entry.last_seen_at || utcNowIso(),
    ],
  );
}

function markUnseenRowsMissing(db: PnwDbAdapter, seen: string[], now: string): void {
  if (seen.length === 0) {
    db.run("UPDATE phoenix_cad_file_asset SET file_status = 'missing', updated_at = ? WHERE file_status != 'missing'", [now]);
    return;
  }
  const placeholders = seen.map(() => "?").join(", ");
  db.run(
    `UPDATE phoenix_cad_file_asset
     SET file_status = 'missing', updated_at = ?
     WHERE repo_rel_path NOT IN (${placeholders}) AND file_status != 'missing'`,
    [now, ...seen],
  );
}

function buildPayload(ws: string, entries: any[], extra: Record<string, any> = {}): any {
  const db = dbPath(ws);
  const outMap = mapPath(ws);
  const lastScanAt = entries
    .map((entry) => entry.last_seen_at || "")
    .filter(Boolean)
    .sort();
  const latestScanAt = lastScanAt.length ? lastScanAt[lastScanAt.length - 1] : "";
  return {
    database_path: db,
    database_path_display: pathDisplay(db),
    map_path: outMap,
    map_path_display: fs.existsSync(outMap) ? pathDisplay(outMap) : "",
    exists: fs.existsSync(db),
    prefs: loadFcstdMapPrefs(ws),
    last_scan_at: latestScanAt,
    scan_root: ".",
    stats: computeStats(entries),
    entries,
    ...extra,
  };
}

function emptyPayload(ws: string): any {
  const db = dbPath(ws);
  return {
    database_path: db,
    database_path_display: pathDisplay(db),
    map_path: mapPath(ws),
    map_path_display: "",
    exists: false,
    prefs: loadFcstdMapPrefs(ws),
    last_scan_at: "",
    scan_root: ".",
    stats: { ...EMPTY_STATS },
    entries: [],
  };
}

export function loadFcstdMapPayload(ws: string): any {
  if (!ws || !fs.existsSync(dbPath(ws))) return emptyPayload(ws);
  return buildPayload(ws, readDbEntries(ws));
}

// ── 对应 Python: _batch_read_fcstd_bom ─────────────────
export function batchReadFcstdBom(
  repoRelPaths: string[], ws: string,
  onProgress?: (rel: string, ok: boolean) => void,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const rel of repoRelPaths) {
    const full = path.join(ws, rel.replace(/^\.\//, ""));
    if (!fs.existsSync(full)) { onProgress?.(rel, false); continue; }
    const data = readFcstdBom(full);
    if (Object.keys(data).length > 0 || /\.fcstd$/i.test(rel)) {
      const json = JSON.stringify(data);
      cache.set(rel, json);
      onProgress?.(rel, true);
    } else { onProgress?.(rel, false); }
  }
  return cache;
}

// ── 对应 Python: search_fcstd_map_entries ──────────────
export function searchFcstdMapEntries(
  ws: string,
  opts: { offset?: number; limit?: number; kind?: string; search?: string; status?: string },
): any {
  const offset = Math.max(0, Number(opts.offset || 0));
  const limit = Math.max(1, Math.min(500, Number(opts.limit || 100)));
  if (!ws || !fs.existsSync(dbPath(ws))) {
    return { offset, limit, total: 0, count: 0, entries: [], debug_sql: "" };
  }
  const kind = opts.kind && opts.kind !== "all" ? opts.kind : "";
  const status = opts.status && opts.status !== "all" ? opts.status : "";
  const needle = (opts.search || "").trim().toLowerCase();
  const filtered = readDbEntries(ws)
    .filter((entry) => !kind || entry.asset_kind === kind)
    .filter((entry) => !status || entry.file_status === status)
    .filter((entry) => {
      if (!needle) return true;
      const haystack = [
        entry.repo_rel_path,
        entry.filename,
        entry.PartNumber,
        entry.PartVersion,
        entry.TypeCode,
        entry.ModelSeries,
        entry.PartName,
        entry.label,
      ].join("\n").toLowerCase();
      return haystack.includes(needle);
    });
  const entries = filtered.slice(offset, offset + limit);
  return { offset, limit, total: filtered.length, count: entries.length, entries, debug_sql: "" };
}

// ── 对应 Python: purge_missing_fcstd_map_entries ───────
export function purgeMissingFcstdMapEntries(_ws: string): any {
  const ws = _ws;
  if (!ws || !fs.existsSync(dbPath(ws))) return { ...emptyPayload(ws), purge_deleted: 0 };
  const missing = readDbEntries(ws).filter((entry) => entry.file_status === FILE_STATUS_MISSING);
  if (missing.length) {
    const db = openDb(ws);
    try {
      db.exec("BEGIN TRANSACTION");
      for (const entry of missing) {
        db.run("DELETE FROM phoenix_cad_file_asset WHERE repo_rel_path = ?", entry.repo_rel_path);
      }
      db.exec("COMMIT");
    } catch (err) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw err;
    } finally {
      db.close();
    }
  }
  return { ...buildPayload(ws, readDbEntries(ws)), purge_deleted: missing.length };
}

// ── 对应 Python: export_fcstd_map_to_json ──────────────
export function exportFcstdMapToJson(_ws: string): any {
  const ws = _ws;
  if (!ws) return { path: "", path_display: "" };
  const entries = readDbEntries(ws);
  const payload = buildPayload(ws, entries, { entries: entries.filter((entry) => entry.asset_kind === ASSET_KIND_FCSTD) });
  const outPath = mapPath(ws);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return { path: outPath, path_display: pathDisplay(outPath) };
}

// ── 对应 Python: run_fcstd_map_scan_async (sync简化版) ─
export function listFcstdMapScanHistory(ws: string, limit = 20): any[] {
  if (!ws || !fs.existsSync(dbPath(ws))) return [];
  const db = openDb(ws);
  try {
    const rows = db.all<any>(
      `SELECT scan_uuid, scanned_at, started_at, finished_at, status, phase, stats_json
       FROM phoenix_cad_scan
       ORDER BY scanned_at DESC, id DESC
       LIMIT ?`,
      Math.max(1, Math.min(50, Number(limit || 20))),
    );
    return rows.map((row) => {
      let stats: Record<string, unknown> = {};
      try { stats = row.stats_json ? JSON.parse(row.stats_json) : {}; } catch { stats = {}; }
      return {
        scan_uuid: row.scan_uuid || "",
        status: row.status || "done",
        phase: row.phase || row.status || "done",
        scanned_at: row.scanned_at || row.finished_at || "",
        started_at: row.started_at || row.scanned_at || "",
        finished_at: row.finished_at || row.scanned_at || "",
        stats,
      };
    });
  } finally {
    db.close();
  }
}

function statsWithScope(stats: Record<string, any>, scope?: FcstdMapScanScope): Record<string, any> {
  return scope
    ? { ...stats, scope_workset_id: scope.worksetId, scope_workset_name: scope.worksetName }
    : stats;
}

function persistAsyncScanState(
  ws: string,
  scanUuid: string,
  startedAt: string,
  status: "running" | "done" | "cancelled" | "error",
  phase: string,
  stats: Record<string, any>,
  scope?: FcstdMapScanScope,
): void {
  const db = openDb(ws);
  try {
    const payload = JSON.stringify(statsWithScope(stats, scope));
    const finishedAt = status === "running" ? null : utcNowIso();
    const existing = db.get<{ id: number }>("SELECT id FROM phoenix_cad_scan WHERE scan_uuid = ? ORDER BY id DESC LIMIT 1", scanUuid);
    if (existing) {
      db.run(
        `UPDATE phoenix_cad_scan
         SET scanned_at = ?, started_at = ?, finished_at = ?, status = ?, phase = ?, stats_json = ?
         WHERE id = ?`,
        [finishedAt || startedAt, startedAt, finishedAt, status, phase, payload, existing.id],
      );
    } else {
      db.run(
        `INSERT INTO phoenix_cad_scan (scan_uuid, scanned_at, scan_root, started_at, finished_at, status, phase, stats_json)
         VALUES (?, ?, '.', ?, ?, ?, ?, ?)`,
        [scanUuid, startedAt, startedAt, finishedAt, status, phase, payload],
      );
    }
  } finally {
    db.close();
  }
}

export function runFcstdMapScanWithProgress(
  ws: string,
  onPhase: (phase: string, current: number, total: number, currentFile?: string) => void,
  options: FcstdMapScanOptions = {},
): any {
  const now = utcNowIso();
  const scanUuid = randomUUID();
  const basenameMap = filterBasenameMapByScope(scanBasenameMap(ws), options.scope);
  const scoped = Boolean(options.scope && (options.scope.dirs.length || options.scope.files.length));

  // Step A: walk
  onPhase("walk", 0, basenameMap.size);
  const entries: any[] = [];
  for (const [filename, paths] of basenameMap) {
    for (const rp of paths) entries.push(entryFromScanPath(ws, rp, now));
  }
  onPhase("walk", entries.length, entries.length);

  // Step B: BOM
  const fcstdFiles = entries.filter(e => e.asset_kind === "fcstd").map(e => e.repo_rel_path);
  onPhase("bom", 0, fcstdFiles.length);
  let bomDone = 0;
  batchReadFcstdBom(fcstdFiles, ws, (_rel, ok) => {
    bomDone++;
    onPhase("bom", bomDone, fcstdFiles.length, _rel);
  });

  // Write to DB
  const stats = computeStats(entries, basenameMap);
  const db = openDb(ws);
  try {
    db.exec("BEGIN TRANSACTION");
    for (const e of entries) upsertEntry(db, e);
    if (!scoped) markUnseenRowsMissing(db, entries.map((entry) => entry.repo_rel_path), now);
    const historyStats = options.scope
      ? { ...stats, scope_workset_id: options.scope.worksetId, scope_workset_name: options.scope.worksetName }
      : stats;
    db.run(
      `INSERT INTO phoenix_cad_scan (scan_uuid, scanned_at, scan_root, started_at, finished_at, status, phase, stats_json)
       VALUES (?, ?, '.', ?, ?, 'done', 'done', ?)`,
      [scanUuid, now, now, now, JSON.stringify(historyStats)],
    );
    db.exec("COMMIT");
  } catch (err) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw err;
  } finally {
    db.close();
  }

  // Step C: rebuild XLink edges from the indexed FCStd files.
  const xref = rebuildBomXrefs(ws, undefined, {
    onProgress: (_phase, current, total, currentFile) => onPhase("xref", current, total, currentFile),
  });
  onPhase("done", entries.length, entries.length);

  return buildPayload(ws, readDbEntries(ws), {
    scan_log: `${options.scope ? `扫描范围: 工作集「${options.scope.worksetName}」\n` : ""}扫描完成: ${stats.present} 文件`,
    _native: "node",
    scan_uuid: scanUuid,
    scan_stats: stats,
    xref_stats: xref,
    scan_scope: options.scope
      ? {
          scope_workset_id: options.scope.worksetId,
          scope_workset_name: options.scope.worksetName,
          dirs: options.scope.dirs,
          files: options.scope.files,
        }
      : null,
  });
}

export async function runFcstdMapScanAsyncWithProgress(
  ws: string,
  onPhase: (phase: string, current: number, total: number, currentFile?: string) => void,
  options: FcstdMapScanOptions = {},
): Promise<any> {
  const startedAt = utcNowIso();
  const scanUuid = randomUUID();
  const isCancelled = options.isCancelled || (() => false);
  const scoped = Boolean(options.scope && (options.scope.dirs.length || options.scope.files.length));
  persistAsyncScanState(ws, scanUuid, startedAt, "running", "walk", { ...EMPTY_STATS }, options.scope);

  let basenameMap = new Map<string, string[]>();
  let entries: any[] = [];
  const cancelledPayload = (phase: string) => {
    const stats = computeStats(entries, basenameMap);
    persistAsyncScanState(ws, scanUuid, startedAt, "cancelled", phase, stats, options.scope);
    return buildPayload(ws, readDbEntries(ws), {
      scan_log: `扫描已取消: ${phase}`,
      _native: "node",
      scan_uuid: scanUuid,
      scan_stats: stats,
      cancelled: true,
      scan_scope: options.scope
        ? {
            scope_workset_id: options.scope.worksetId,
            scope_workset_name: options.scope.worksetName,
            dirs: options.scope.dirs,
            files: options.scope.files,
          }
        : null,
    });
  };

  onPhase("walk", 0, 0);
  const walked = await scanBasenameMapAsync(ws, isCancelled);
  basenameMap = filterBasenameMapByScope(walked.basenameMap, options.scope);
  if (walked.cancelled || isCancelled()) return cancelledPayload("walk");

  const totalFiles = [...basenameMap.values()].reduce((total, paths) => total + paths.length, 0);
  let processed = 0;
  for (const paths of basenameMap.values()) {
    for (const rel of paths) {
      if (isCancelled()) return cancelledPayload("walk");
      entries.push(entryFromScanPath(ws, rel, startedAt, false));
      processed += 1;
      onPhase("walk", processed, totalFiles, rel);
      if (processed % 50 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  const fcstdEntries = entries.filter((entry) => entry.asset_kind === ASSET_KIND_FCSTD);
  onPhase("bom", 0, fcstdEntries.length);
  for (let index = 0; index < fcstdEntries.length; index += 1) {
    if (isCancelled()) return cancelledPayload("bom");
    const entry = fcstdEntries[index];
    const abs = relToDiskPath(ws, entry.repo_rel_path);
    const embedded = fs.existsSync(abs) ? await readFcstdBomAsync(abs, isCancelled) : {};
    const merged = mergeProps(entry, embedded);
    const entryIndex = entries.indexOf(entry);
    if (entryIndex >= 0) entries[entryIndex] = merged;
    onPhase("bom", index + 1, fcstdEntries.length, entry.repo_rel_path);
  }
  if (isCancelled()) return cancelledPayload("bom");

  const stats = computeStats(entries, basenameMap);
  const db = openDb(ws);
  try {
    db.exec("BEGIN TRANSACTION");
    for (const entry of entries) upsertEntry(db, entry);
    if (!scoped) markUnseenRowsMissing(db, entries.map((entry) => entry.repo_rel_path), startedAt);
    db.run("DELETE FROM phoenix_cad_scan WHERE scan_uuid = ?", scanUuid);
    db.run(
      `INSERT INTO phoenix_cad_scan (scan_uuid, scanned_at, scan_root, started_at, finished_at, status, phase, stats_json)
       VALUES (?, ?, '.', ?, ?, 'done', 'done', ?)`,
      [scanUuid, startedAt, startedAt, utcNowIso(), JSON.stringify(statsWithScope(stats, options.scope))],
    );
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    db.run(
      `UPDATE phoenix_cad_scan
       SET scanned_at = ?, finished_at = ?, status = 'error', phase = 'error', stats_json = ?
       WHERE scan_uuid = ?`,
      [utcNowIso(), utcNowIso(), JSON.stringify(statsWithScope(stats, options.scope)), scanUuid],
    );
    throw error;
  } finally {
    db.close();
  }

  const xref = await rebuildBomXrefsAsync(ws, {
    isCancelled,
    onProgress: (_phase, current, total, currentFile) => onPhase("xref", current, total, currentFile),
  });
  if (xref.cancelled) return cancelledPayload("xref");
  if (isCancelled()) return cancelledPayload("xref");
  onPhase("done", entries.length, entries.length);
  return buildPayload(ws, readDbEntries(ws), {
    scan_log: `${options.scope ? `扫描范围: 工作集「${options.scope.worksetName}」\n` : ""}扫描完成: ${stats.present} 文件`,
    _native: "node",
    scan_uuid: scanUuid,
    scan_stats: stats,
    xref_stats: xref,
    scan_scope: options.scope
      ? {
          scope_workset_id: options.scope.worksetId,
          scope_workset_name: options.scope.worksetName,
          dirs: options.scope.dirs,
          files: options.scope.files,
        }
      : null,
  });
}

// 对应 Python: run_fcstd_map_scan (同步版)
export function runFcstdMapScan(ws: string, options: FcstdMapScanOptions = {}): any {
  return runFcstdMapScanWithProgress(ws, () => {}, options);
}
