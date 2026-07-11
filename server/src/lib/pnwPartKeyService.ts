import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";
import { loadAssemblyTreeFromXrefs } from "./pnwBomXrefService.js";

const FILE_STATUS_PRESENT = "present";
const FILE_STATUS_MISSING = "missing";
const PART_KEY_STATUS_ACTIVE = "active";
const LINK_STATUS_ACTIVE = "active";

function dbPath(ws: string): string {
  return path.join(ws, ".phoenix", "phoenix-workspace.sqlite");
}

function workspaceOk(ws: string): boolean {
  try {
    return Boolean(ws) && fs.statSync(ws).isDirectory();
  } catch {
    return false;
  }
}

function openExistingDb(ws: string): PnwDbAdapter | null {
  if (!workspaceOk(ws) || !fs.existsSync(dbPath(ws))) return null;
  return pnwCreateDb(dbPath(ws));
}

function tableExists(db: PnwDbAdapter, name: string): boolean {
  try {
    return Boolean(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]));
  } catch {
    return false;
  }
}

function columns(db: PnwDbAdapter, table: string): Set<string> {
  try {
    return new Set((db.all<{ name: string }>(`PRAGMA table_info(${table})`) || []).map((r) => r.name));
  } catch {
    return new Set();
  }
}

function ensureColumn(db: PnwDbAdapter, table: string, name: string, ddl: string): void {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

function ensurePartKeySchema(db: PnwDbAdapter): void {
  db.exec(`
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
      part_key_id INTEGER NOT NULL,
      file_asset_id INTEGER NOT NULL UNIQUE,
      file_role TEXT NOT NULL DEFAULT 'part',
      notes TEXT,
      link_status TEXT NOT NULL DEFAULT 'active',
      linked_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_phoenix_cad_part_key_pn_pv
      ON phoenix_cad_part_key(part_number, part_version);
    CREATE INDEX IF NOT EXISTS idx_phoenix_cad_part_file_link_key
      ON phoenix_cad_part_file_link(part_key_id);
  `);

  ensureColumn(db, "phoenix_cad_part_key", "type_code", "TEXT");
  ensureColumn(db, "phoenix_cad_part_key", "model_series", "TEXT");
  ensureColumn(db, "phoenix_cad_part_key", "part_name", "TEXT");
  ensureColumn(db, "phoenix_cad_part_key", "label", "TEXT");
  ensureColumn(db, "phoenix_cad_part_key", "notes", "TEXT");
  ensureColumn(db, "phoenix_cad_part_key", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "phoenix_cad_part_key", "created_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "phoenix_cad_part_key", "updated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "phoenix_cad_part_file_link", "file_role", "TEXT NOT NULL DEFAULT 'part'");
  ensureColumn(db, "phoenix_cad_part_file_link", "notes", "TEXT");
  ensureColumn(db, "phoenix_cad_part_file_link", "link_status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "phoenix_cad_part_file_link", "linked_at", "TEXT NOT NULL DEFAULT ''");
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

function normKey(rel: string): string {
  const s = String(rel || "").replace(/\\/g, "/").trim().replace(/^\.\//, "");
  return s ? `./${s}` : "";
}

function basenameOf(rel: string): string {
  const normalized = String(rel || "").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || normalized;
}

function formatPartKey(partNumber: string, partVersion: string): string {
  const pn = String(partNumber || "").trim();
  const pv = String(partVersion || "").trim();
  return pn && pv ? `${pn}.${pv}` : "";
}

function inferPartFileRole(filename: string): string {
  const lower = String(filename || "").toLowerCase();
  if (lower.endsWith(".drawing.fcstd")) return "drawing";
  if (lower.endsWith(".assy.fcstd")) return "assembly";
  return "part";
}

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

function normalizePartVersion(partVersion: string): string {
  const raw = String(partVersion || "").trim();
  if (!raw) return "";
  return raw.length < 3 ? raw.padStart(3, "0") : raw;
}

function partKeyHintsFromBasename(input: string): { filename: string; part_number: string; part_version: string; part_key: string } {
  const filename = basenameOf(input);
  let stem = filename.replace(/\.fcstd$/i, "");
  stem = stem.replace(/\.drawing$/i, "").replace(/\.assy$/i, "");
  const label = stem.match(/^(\d+)\.(\d{1,3})(?=[\-_.]|$)/);
  const match = label || stem.match(/^(\d+(?:\.\d+)?)\.(\d{1,3})(?=[\-_.]|$)/);
  const partNumber = match?.[1] || "";
  const partVersion = normalizePartVersion(match?.[2] || "");
  return {
    filename,
    part_number: partNumber,
    part_version: partVersion,
    part_key: formatPartKey(partNumber, partVersion),
  };
}

function pickScanAttr(rows: any[], field: string): string {
  for (const preferPresent of [true, false]) {
    for (const row of rows) {
      if (preferPresent && row.file_status === FILE_STATUS_MISSING) continue;
      const value = String(row[field] || "").trim();
      if (value) return value;
    }
  }
  return "";
}

function syncPartKeysFromFileAssets(db: PnwDbAdapter): void {
  if (!tableExists(db, "phoenix_cad_file_asset")) return;
  ensurePartKeySchema(db);
  const now = utcNowIso();
  const rows = db.all<any>(
    `SELECT id, repo_rel_path, filename, asset_kind, part_number, part_version,
            type_code, model_series, part_name, label, file_status
     FROM phoenix_cad_file_asset
     WHERE part_number IS NOT NULL AND TRIM(part_number) != ''
       AND part_version IS NOT NULL AND TRIM(part_version) != ''
     ORDER BY CASE file_status WHEN 'present' THEN 0 ELSE 1 END, repo_rel_path`,
  );

  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const pn = String(row.part_number || "").trim();
    const pv = String(row.part_version || "").trim();
    if (!pn || !pv) continue;
    const key = `${pn}\u0000${pv}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const [key, files] of groups) {
    const [pn, pv] = key.split("\u0000");
    db.run(
      `INSERT INTO phoenix_cad_part_key (
         part_number, part_version, type_code, model_series, part_name, label,
         notes, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(part_number, part_version) DO UPDATE SET
         type_code = COALESCE(excluded.type_code, phoenix_cad_part_key.type_code),
         model_series = COALESCE(excluded.model_series, phoenix_cad_part_key.model_series),
         part_name = COALESCE(excluded.part_name, phoenix_cad_part_key.part_name),
         label = COALESCE(excluded.label, phoenix_cad_part_key.label),
         updated_at = excluded.updated_at`,
      [
        pn,
        pv,
        pickScanAttr(files, "type_code") || null,
        pickScanAttr(files, "model_series") || null,
        pickScanAttr(files, "part_name") || null,
        pickScanAttr(files, "label") || null,
        PART_KEY_STATUS_ACTIVE,
        now,
        now,
      ],
    );
  }

  const touchedIds: number[] = [];
  for (const [key, files] of groups) {
    const [pn, pv] = key.split("\u0000");
    const pk = db.get<{ id: number }>(
      "SELECT id FROM phoenix_cad_part_key WHERE part_number = ? AND part_version = ?",
      [pn, pv],
    );
    if (!pk) continue;
    touchedIds.push(Number(pk.id));
    for (const file of files) {
      db.run(
        `INSERT INTO phoenix_cad_part_file_link (
           part_key_id, file_asset_id, file_role, notes, link_status, linked_at
         ) VALUES (?, ?, ?, NULL, ?, ?)
         ON CONFLICT(file_asset_id) DO UPDATE SET
           part_key_id = excluded.part_key_id`,
        [pk.id, file.id, inferPartFileRole(file.filename || ""), LINK_STATUS_ACTIVE, now],
      );
    }
  }

  if (touchedIds.length) {
    const placeholders = touchedIds.map(() => "?").join(",");
    db.run(`DELETE FROM phoenix_cad_part_key WHERE id NOT IN (${placeholders})`, touchedIds);
  } else {
    db.run("DELETE FROM phoenix_cad_part_key");
  }
  db.run(
    `DELETE FROM phoenix_cad_part_file_link
     WHERE file_asset_id NOT IN (
       SELECT id FROM phoenix_cad_file_asset
       WHERE part_number IS NOT NULL AND TRIM(part_number) != ''
         AND part_version IS NOT NULL AND TRIM(part_version) != ''
     )`,
  );
}

function entryFromRow(row: any): any {
  const partNumber = String(row.part_number || "").trim();
  const partVersion = String(row.part_version || "").trim();
  return {
    id: Number(row.id || 0),
    part_number: partNumber,
    part_version: partVersion,
    part_key: formatPartKey(partNumber, partVersion),
    TypeCode: String(row.type_code || ""),
    ModelSeries: String(row.model_series || ""),
    PartName: String(row.part_name || ""),
    label: String(row.label || ""),
    notes: String(row.notes || ""),
    status: String(row.status || PART_KEY_STATUS_ACTIVE),
    file_count: Number(row.file_count || 0),
    present_count: Number(row.present_count || 0),
    missing_count: Number(row.missing_count || 0),
    primary_repo_rel: String(row.primary_repo_rel || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

function legacyItemFromEntry(entry: any): any {
  return {
    part_number: entry.part_number,
    part_version: entry.part_version,
    part_name: entry.PartName,
    type_code: entry.TypeCode,
    model_series: entry.ModelSeries,
    label: entry.label,
    status: entry.status,
    file_count: entry.file_count,
    present_count: entry.present_count,
    missing_count: entry.missing_count,
    primary_repo_rel: entry.primary_repo_rel,
  };
}

function fileFromRow(row: any): any {
  return {
    id: Number(row.id || 0),
    repo_rel_path: String(row.repo_rel_path || ""),
    filename: String(row.filename || ""),
    asset_kind: String(row.asset_kind || cadAssetKind(row.filename || "")),
    PartNumber: String(row.part_number || ""),
    PartVersion: String(row.part_version || ""),
    TypeCode: String(row.type_code || ""),
    ModelSeries: String(row.model_series || ""),
    PartName: String(row.part_name || ""),
    label: String(row.label || ""),
    file_status: String(row.file_status || FILE_STATUS_PRESENT),
    file_role: String(row.file_role || inferPartFileRole(row.filename || "")),
    link_notes: String(row.link_notes || ""),
    link_status: String(row.link_status || LINK_STATUS_ACTIVE),
    linked_at: String(row.linked_at || ""),
    last_seen_at: String(row.last_seen_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}

function emptyPayload(ws: string) {
  const db = dbPath(ws || "");
  return {
    database_path: db,
    database_path_display: db ? path.normalize(db) : "",
    exists: false,
    entries: [],
    items: [],
    part_keys: [],
    stats: { total_keys: 0, total_files: 0, obsolete_keys: 0 },
    _native: "node",
  };
}

export function loadPartKeysPayload(ws: string, opts: { search?: string } = {}): any {
  const db = openExistingDb(ws);
  if (!db) return emptyPayload(ws);
  try {
    if (!tableExists(db, "phoenix_cad_file_asset") && !tableExists(db, "phoenix_cad_part_key")) return emptyPayload(ws);
    syncPartKeysFromFileAssets(db);
    const q = String(opts.search || "").trim();
    const where = q
      ? `WHERE pk.part_number LIKE ? COLLATE NOCASE
          OR pk.part_version LIKE ? COLLATE NOCASE
          OR COALESCE(pk.type_code, '') LIKE ? COLLATE NOCASE
          OR COALESCE(pk.model_series, '') LIKE ? COLLATE NOCASE
          OR COALESCE(pk.part_name, '') LIKE ? COLLATE NOCASE
          OR COALESCE(pk.label, '') LIKE ? COLLATE NOCASE
          OR COALESCE(pk.notes, '') LIKE ? COLLATE NOCASE`
      : "";
    const params = q ? Array(7).fill(`%${q}%`) : [];
    const rows = db.all<any>(
      `SELECT pk.*,
              COUNT(pfl.id) AS file_count,
              SUM(CASE WHEN fa.file_status = ? THEN 1 ELSE 0 END) AS present_count,
              SUM(CASE WHEN fa.file_status = ? THEN 1 ELSE 0 END) AS missing_count,
              (
                SELECT fa2.repo_rel_path
                FROM phoenix_cad_part_file_link pfl2
                JOIN phoenix_cad_file_asset fa2 ON fa2.id = pfl2.file_asset_id
                WHERE pfl2.part_key_id = pk.id
                  AND fa2.file_status = ?
                ORDER BY fa2.repo_rel_path
                LIMIT 1
              ) AS primary_repo_rel
       FROM phoenix_cad_part_key pk
       LEFT JOIN phoenix_cad_part_file_link pfl ON pfl.part_key_id = pk.id
       LEFT JOIN phoenix_cad_file_asset fa ON fa.id = pfl.file_asset_id
       ${where}
       GROUP BY pk.id
       ORDER BY pk.part_number, pk.part_version`,
      [FILE_STATUS_PRESENT, FILE_STATUS_MISSING, FILE_STATUS_PRESENT, ...params],
    );
    const entries = rows.map(entryFromRow);
    const totalFiles = entries.reduce((sum, entry) => sum + Number(entry.file_count || 0), 0);
    const payload = {
      ...emptyPayload(ws),
      exists: entries.length > 0,
      entries,
      items: entries.map(legacyItemFromEntry),
      part_keys: entries.map(legacyItemFromEntry),
      stats: {
        total_keys: entries.length,
        total_files: totalFiles,
        obsolete_keys: entries.filter((entry) => entry.status === "obsolete").length,
      },
    };
    return payload;
  } finally {
    db.close();
  }
}

export function loadPartKeyDetailPayload(ws: string, partNumber: string, partVersion: string): any {
  const db = openExistingDb(ws);
  if (!db) throw new Error(`Part key not found: ${formatPartKey(partNumber, partVersion)}`);
  try {
    syncPartKeysFromFileAssets(db);
    const pn = String(partNumber || "").trim();
    const pv = String(partVersion || "").trim();
    const pk = db.get<any>("SELECT * FROM phoenix_cad_part_key WHERE part_number = ? AND part_version = ?", [pn, pv]);
    if (!pk) throw new Error(`Part key not found: ${formatPartKey(pn, pv)}`);
    const files = db.all<any>(
      `SELECT fa.*, pfl.file_role, pfl.notes AS link_notes, pfl.link_status, pfl.linked_at
       FROM phoenix_cad_part_file_link pfl
       JOIN phoenix_cad_file_asset fa ON fa.id = pfl.file_asset_id
       WHERE pfl.part_key_id = ?
       ORDER BY CASE fa.file_status WHEN 'present' THEN 0 ELSE 1 END, fa.repo_rel_path`,
      [pk.id],
    );
    const filePayload = files.map(fileFromRow);
    return {
      ...entryFromRow({
        ...pk,
        file_count: filePayload.length,
        present_count: filePayload.filter((file) => file.file_status !== FILE_STATUS_MISSING).length,
        missing_count: filePayload.filter((file) => file.file_status === FILE_STATUS_MISSING).length,
      }),
      files: filePayload,
      _native: "node",
    };
  } finally {
    db.close();
  }
}

function compactPatchValue(value: unknown): string | null {
  if (value == null) return null;
  return String(value).trim();
}

export function patchPartKey(ws: string, partNumber: string, partVersion: string, patch: any): any {
  const db = openExistingDb(ws);
  if (!db) throw new Error(`Part key not found: ${formatPartKey(partNumber, partVersion)}`);
  try {
    syncPartKeysFromFileAssets(db);
    const pn = String(partNumber || "").trim();
    const pv = String(partVersion || "").trim();
    const row = db.get<{ id: number }>("SELECT id FROM phoenix_cad_part_key WHERE part_number = ? AND part_version = ?", [pn, pv]);
    if (!row) throw new Error(`Part key not found: ${formatPartKey(pn, pv)}`);
    const fields: Record<string, string | null> = { updated_at: utcNowIso() };
    const mapping: Record<string, string> = {
      TypeCode: "type_code",
      type_code: "type_code",
      ModelSeries: "model_series",
      model_series: "model_series",
      PartName: "part_name",
      part_name: "part_name",
      label: "label",
      notes: "notes",
      status: "status",
    };
    for (const [input, column] of Object.entries(mapping)) {
      if (Object.prototype.hasOwnProperty.call(patch || {}, input)) fields[column] = compactPatchValue(patch[input]);
    }
    if (fields.status === "") fields.status = PART_KEY_STATUS_ACTIVE;
    const keys = Object.keys(fields);
    db.run(
      `UPDATE phoenix_cad_part_key SET ${keys.map((key) => `${key} = ?`).join(", ")}
       WHERE part_number = ? AND part_version = ?`,
      [...keys.map((key) => fields[key]), pn, pv],
    );
    const fileFields = Object.fromEntries(
      Object.entries(fields).filter(([key]) => ["type_code", "model_series", "part_name", "label"].includes(key)),
    );
    const fileKeys = Object.keys(fileFields);
    if (fileKeys.length) {
      db.run(
        `UPDATE phoenix_cad_file_asset SET ${fileKeys.map((key) => `${key} = ?`).join(", ")}, updated_at = ?
         WHERE part_number = ? AND part_version = ?`,
        [...fileKeys.map((key) => fileFields[key]), fields.updated_at, pn, pv],
      );
    }
  } finally {
    db.close();
  }
  return loadPartKeyDetailPayload(ws, partNumber, partVersion);
}

export function patchPartFileLink(ws: string, partNumber: string, partVersion: string, fileAssetId: number, patch: any): any {
  const db = openExistingDb(ws);
  if (!db) throw new Error("Part file link not found");
  try {
    syncPartKeysFromFileAssets(db);
    const pn = String(partNumber || "").trim();
    const pv = String(partVersion || "").trim();
    const pk = db.get<{ id: number }>("SELECT id FROM phoenix_cad_part_key WHERE part_number = ? AND part_version = ?", [pn, pv]);
    if (!pk) throw new Error(`Part key not found: ${formatPartKey(pn, pv)}`);
    const link = db.get<{ id: number }>(
      "SELECT id FROM phoenix_cad_part_file_link WHERE part_key_id = ? AND file_asset_id = ?",
      [pk.id, fileAssetId],
    );
    if (!link) throw new Error("Part file link not found");
    const fields: Record<string, string | null> = {};
    if (Object.prototype.hasOwnProperty.call(patch || {}, "file_role")) fields.file_role = compactPatchValue(patch.file_role) || "part";
    if (Object.prototype.hasOwnProperty.call(patch || {}, "link_notes")) fields.notes = compactPatchValue(patch.link_notes);
    if (Object.prototype.hasOwnProperty.call(patch || {}, "link_status")) fields.link_status = compactPatchValue(patch.link_status) || LINK_STATUS_ACTIVE;
    const keys = Object.keys(fields);
    if (keys.length) {
      db.run(
        `UPDATE phoenix_cad_part_file_link SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`,
        [...keys.map((key) => fields[key]), link.id],
      );
    }
  } finally {
    db.close();
  }
  return loadPartKeyDetailPayload(ws, partNumber, partVersion);
}

function lookupPartKeyInIndex(ws: string, rel: string, filename: string): any {
  const db = openExistingDb(ws);
  if (!db) return {};
  try {
    if (!tableExists(db, "phoenix_cad_file_asset")) return {};
    const clauses: string[] = [];
    const params: string[] = [];
    const key = normKey(rel);
    if (key) {
      clauses.push("LOWER(repo_rel_path) = LOWER(?)");
      params.push(key);
    }
    if (filename) {
      clauses.push("LOWER(filename) = LOWER(?)");
      params.push(filename);
    }
    if (!clauses.length) return {};
    const row = db.get<any>(
      `SELECT part_number, part_version, repo_rel_path
       FROM phoenix_cad_file_asset
       WHERE (${clauses.join(" OR ")})
         AND part_number IS NOT NULL AND TRIM(part_number) != ''
         AND part_version IS NOT NULL AND TRIM(part_version) != ''
       ORDER BY CASE file_status WHEN 'present' THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
      params,
    );
    if (!row) return {};
    const pn = String(row.part_number || "").trim();
    const pv = String(row.part_version || "").trim();
    if (!pn || !pv) return {};
    return {
      part_number: pn,
      part_version: pv,
      part_key: formatPartKey(pn, pv),
      repo_rel_path: normKey(row.repo_rel_path || ""),
    };
  } finally {
    db.close();
  }
}

export function inferPartKeyFromWorkspaceRel(ws: string, rel: string): any {
  const relKey = normKey(rel);
  if (!relKey) throw new Error("rel is required");
  const filename = basenameOf(relKey);
  if (!filename.toLowerCase().endsWith(".fcstd")) throw new Error("Only .FCStd files are supported");
  const hints = partKeyHintsFromBasename(filename);
  const index = lookupPartKeyInIndex(ws, relKey, filename);
  let pn = hints.part_number;
  let pv = hints.part_version;
  let source: "filename" | "index" | "filename+index" = "filename";
  if (index.part_number && index.part_version) {
    if (!pn || !pv || index.part_number !== pn || index.part_version !== pv) {
      source = "index";
      pn = index.part_number;
      pv = index.part_version;
    } else {
      source = "filename+index";
    }
  }
  if (!pn || !pv) throw new Error(`Unable to infer PartKey: ${filename}`);
  return {
    rel: relKey,
    filename,
    part_number: pn,
    part_version: pv,
    part_key: formatPartKey(pn, pv),
    source,
    in_catalog: Boolean(loadPartKeyDetailOrNull(ws, pn, pv)),
  };
}

function loadPartKeyDetailOrNull(ws: string, partNumber: string, partVersion: string): any | null {
  try {
    return loadPartKeyDetailPayload(ws, partNumber, partVersion);
  } catch {
    return null;
  }
}

export function loadPartAssemblyTreePayload(ws: string, partNumber: string, partVersion: string, hostRel: string, opts: { full?: boolean } = {}): any {
  const detail = loadPartKeyDetailPayload(ws, partNumber, partVersion);
  const hostKey = normKey(hostRel);
  const allowed = new Set((detail.files || []).map((file: any) => normKey(file.repo_rel_path)));
  if (!allowed.has(hostKey)) throw new Error("Selected assembly file does not belong to this PartKey");
  return loadAssemblyTreeFromXrefs(ws, hostKey, opts);
}
