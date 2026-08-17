import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import {
  pnwCodeIsIgnoredName,
  pnwCodeReplaceTextByRules,
  pnwCodeResolveReplacementRules,
  pnwApplyUuidReplacementPlan,
  pnwFindUuidOccurrences,
  pnwNormalizeUuid,
  pnwNormalizeWorkspacePath,
  pnwNormalizeWorkspacePaths,
  pnwPlanUuidReplacements,
  type PnwUuidKind,
  type PnwUuidReplacementPlanHit,
} from "@phoenix-wing/code-core";
import {
  chooseSourceWritePayload,
  encodeSourceText,
  readSourceText,
  sourceTextEncodingLabel,
  writeSourceText,
  type SourceTextPayload,
} from "./sourceTextCodec.js";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";
import { runtimeUserDataDir } from "./appRuntimePaths.js";

const SOURCE_EXTS = [".cpp", ".c", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx", ".m", ".mm"];
const CONFIG_EXTS = [".json", ".cmake", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".pro", ".pri", ".qss"];
const DOC_EXTS = [".md", ".markdown", ".rst", ".txt"];
const RESOURCE_EXTS = [
  ".qrc", ".ui", ".qml", ".catdlg", ".catnls", ".catrsc", ".bmp", ".xpm",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".icns", ".wav", ".mp3",
  ".ttf", ".otf", ".woff", ".woff2",
];

const EXT_KIND: Record<string, string> = {};
for (const e of SOURCE_EXTS) EXT_KIND[e] = "source";
for (const e of CONFIG_EXTS) EXT_KIND[e] = "config";
for (const e of DOC_EXTS) EXT_KIND[e] = "doc";
for (const e of RESOURCE_EXTS) EXT_KIND[e] = "resource";

const BASENAME_KIND: Record<string, string> = {
  "cmakelists.txt": "config",
  makefile: "config",
  "pyproject.toml": "config",
  "package.json": "config",
  "requirements.txt": "config",
};

export const CODE_ASSET_KINDS = ["source", "config", "doc", "resource"] as const;
export const KIND_LABELS: Record<string, string> = {
  source: "源文件",
  config: "配置",
  doc: "文档",
  resource: "资源",
};

export type CodeIndexEntry = {
  repo_rel_path: string;
  filename: string;
  asset_kind: string;
  file_ext: string;
  file_status: "present" | "missing";
  size_bytes: number;
  text_encoding: string;
  last_seen_at: string | null;
};

export type CodeIndexPayload = {
  workspace_path: string;
  workspace_path_display: string;
  last_scan_at: string | null;
  stats: Record<string, number>;
  file_count: number;
  present_count: number;
  kind_labels: Record<string, string>;
  kinds: string[];
  builtin_extensions: string[];
  extra_extensions: string[];
  summary?: string;
  scan_id?: number;
};

export type CodeIndexStore = {
  version: number;
  workspace_path: string;
  last_scan_at: string | null;
  entries: CodeIndexEntry[];
  extra_extensions: string[];
};

export type CodeIndexStorageOptions = {
  storageDir?: string;
};

export type CodeIndexQueryOptions = CodeIndexStorageOptions & {
  offset?: number;
  limit?: number;
  status?: "all" | "present" | "missing";
  kind?: string;
  q?: string;
  searchMode?: "contains" | "filename";
};

export type CodeIndexScanOptions = CodeIndexStorageOptions & {
  adoptExtensions?: string[];
  ignorePatterns?: string[];
};

export type CodeIndexDiscoveryOptions = CodeIndexStorageOptions & {
  ignorePatterns?: string[];
};

export function normalizeIndexExtension(ext: string): string | null {
  let raw = (ext || "").trim().toLowerCase();
  if (!raw) return null;
  if (!raw.startsWith(".")) raw = "." + raw;
  return raw.length >= 2 && raw.length <= 16 ? raw : null;
}

function normalizeExtensions(values: string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const ext = normalizeIndexExtension(value);
    if (ext) out.add(ext);
  }
  return [...out].sort();
}

function fileExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function looksLikeExactFilename(name: string): boolean {
  const base = name.trim();
  if (!base || base.includes("/") || base.includes("\\")) return false;
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1;
}

function codeIndexSearchClause(
  rawNeedle: string,
  mode: "contains" | "filename",
): { sql: string; params: string[] } {
  const text = rawNeedle.trim();
  if (!text) return { sql: "", params: [] };
  const needle = text.toLowerCase();
  if (mode === "filename") {
    if (text.includes("/") || text.includes("\\")) {
      const norm = text.replace(/\\/g, "/").toLowerCase();
      const tail = norm.split("/").pop() || "";
      if (looksLikeExactFilename(tail)) return { sql: "LOWER(repo_rel_path) = ?", params: [norm] };
      return { sql: "LOWER(repo_rel_path) LIKE ?", params: [`%${norm}%`] };
    }
    if (looksLikeExactFilename(text)) return { sql: "LOWER(filename) = ?", params: [needle] };
    return { sql: "LOWER(filename) LIKE ?", params: [`%${needle}%`] };
  }
  return {
    sql: "(LOWER(repo_rel_path) LIKE ? OR LOWER(filename) LIKE ?)",
    params: [`%${needle}%`, `%${needle}%`],
  };
}

export function builtinIndexExtensions(): string[] {
  return Object.keys(EXT_KIND).sort();
}

export function codeAssetKind(filename: string, extraExts: string[] = []): string | null {
  const name = filename.toLowerCase();
  const ext = fileExt(filename);
  if (name in BASENAME_KIND) return BASENAME_KIND[name];
  if (extraExts.includes(ext)) return "resource";
  if (ext in EXT_KIND) return EXT_KIND[ext];
  return null;
}

export function isCodeIndexFilename(filename: string, extraExts: string[] = []): boolean {
  return codeAssetKind(filename, extraExts) !== null;
}

export function isIgnoredName(name: string, patterns: string[]): boolean {
  return pnwCodeIsIgnoredName(name, patterns, { caseSensitive: false });
}

const PROCESS_DIR_NAMES = ["build", "debug", "release", "out", "bin", "obj", "dist", ".cache", "_build"];

export function isProcessDirName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.startsWith(".")) return true;
  return PROCESS_DIR_NAMES.includes(name.toLowerCase()) || /^(build-|cmake-build-)/i.test(name);
}

export function normalizeWorksetPaths(paths: string[]): string[] {
  return pnwNormalizeWorkspacePaths(paths);
}

export interface RenameScanOptions { levels: string[]; targetEncoding: string; }
export const DEFAULT_RENAME_LEVELS = ["file", "text"];
export const DEFAULT_TARGET_ENCODING = "utf-8";

const BINARY_EXTENSIONS = [
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".zip", ".png", ".jpg", ".gif",
  ".ico", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".ttf", ".otf",
  ".woff", ".woff2", ".mp3", ".mp4", ".avi", ".mov", ".mkv",
];

const SKIP_DISCOVER_EXTENSIONS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".a", ".lib", ".o", ".obj", ".pyc", ".pyo", ".class", ".wasm",
  ".bin", ".dat", ".sqlite", ".db", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".fcstd", ".step", ".stp", ".iges", ".igs", ".sldprt", ".sldasm", ".slddrw",
]);

export function isBinarySuffix(filename: string): boolean {
  return BINARY_EXTENSIONS.includes(fileExt(filename));
}

const SKIP_NAMES = new Set([".git", "node_modules", "__pycache__", ".phoenix", ".obsidian", ".cursor", "dist", "build", ".venv"]);

export function isScannableDir(name: string): boolean {
  return !name.startsWith(".") && !SKIP_NAMES.has(name);
}

function defaultStorageDir(): string {
  return runtimeUserDataDir();
}

function codeIndexPath(opts?: CodeIndexStorageOptions): string {
  return path.join(opts?.storageDir || defaultStorageDir(), "code-index.json");
}

function extraExtensionsPath(opts?: CodeIndexStorageOptions): string {
  return path.join(opts?.storageDir || defaultStorageDir(), "code-index-extra-extensions.json");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function pathDisplay(p: string): string {
  return p ? path.normalize(p) : "";
}

function writeCodeOperationReport(
  workspaceRoot: string,
  basename: string,
  payload: Record<string, unknown>,
): { report_path: string; report_path_display: string } | null {
  const root = path.resolve(workspaceRoot);
  const outDir = path.join(root, ".phoenix", "reports");
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const outPath = path.join(outDir, `${basename}-${stamp}-${randomUUID().slice(0, 8)}.json`);
  const tempPath = `${outPath}.tmp`;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, outPath);
    return {
      report_path: outPath,
      report_path_display: path.relative(root, outPath).replace(/\\/g, "/"),
    };
  } catch {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Best effort cleanup; the main write operation has already succeeded.
    }
    return null;
  }
}

function normalizeRelPath(rel: string): string {
  return rel.replace(/\\/g, "/");
}

function readEncoding(absPath: string): string {
  try {
    const raw = fs.readFileSync(absPath);
    if (!raw.length) return "utf-8";
    if (raw.includes(0)) return "binary";
    const decoded = readSourceText(absPath);
    if (!decoded) return "unknown";
    if (decoded.hadBom) return "utf-8-bom";
    if (decoded.encoding === "gbk") return "gbk";
    return raw.every((byte) => byte < 0x80) ? "ascii" : "utf-8";
  } catch {
    return "unknown";
  }
}

export function detectTextEncodingLabel(filePath: string): string {
  return readEncoding(filePath);
}

export interface TextPayload {
  path: string;
  content: string;
  encoding: string;
  hadBom: boolean;
  source: SourceTextPayload;
}
export function detectAndRead(p: string): TextPayload {
  const source = readSourceText(p);
  if (!source) throw new Error(`Cannot decode source text: ${p}`);
  return {
    path: p,
    content: source.text,
    encoding: sourceTextEncodingLabel(source),
    hadBom: source.hadBom,
    source,
  };
}

function emptyCodeIndexPayload(workspaceRoot: string, extraExtensions: string[] = []): CodeIndexPayload {
  return {
    workspace_path: workspaceRoot,
    workspace_path_display: pathDisplay(workspaceRoot),
    last_scan_at: null,
    stats: { total: 0, source: 0, config: 0, doc: 0, resource: 0 },
    file_count: 0,
    present_count: 0,
    kind_labels: KIND_LABELS,
    kinds: [...CODE_ASSET_KINDS],
    builtin_extensions: builtinIndexExtensions(),
    extra_extensions: extraExtensions,
  };
}

function readLegacyCodeIndexStore(opts?: CodeIndexStorageOptions): CodeIndexStore | null {
  try {
    const raw = JSON.parse(fs.readFileSync(codeIndexPath(opts), "utf8"));
    if (!raw || !Array.isArray(raw.entries)) return null;
    return {
      version: Number(raw.version || 1),
      workspace_path: String(raw.workspace_path || ""),
      last_scan_at: raw.last_scan_at ? String(raw.last_scan_at) : null,
      entries: raw.entries,
      extra_extensions: Array.isArray(raw.extra_extensions) ? raw.extra_extensions : [],
    };
  } catch {
    return null;
  }
}

function readLegacyCodeIndexExtraExtensions(opts?: CodeIndexStorageOptions): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(extraExtensionsPath(opts), "utf8"));
    const values = Array.isArray(raw) ? raw : raw.extensions;
    return Array.isArray(values) ? normalizeExtensions(values.map(String)) : [];
  } catch {
    return [];
  }
}

const CODE_INDEX_EXTRA_EXTS_KEY = "code_index_extra_exts";
const CODE_INDEX_LAST_SCAN_AT_KEY = "code_last_scan_at";
const CODE_INDEX_LAST_SCAN_STATS_KEY = "code_last_scan_stats";
const CODE_INDEX_JSON_IMPORT_KEY = "node_code_index_json_imported";

function workspaceDirectory(workspaceRoot: string): string | null {
  const raw = String(workspaceRoot || "").trim();
  if (!raw) return null;
  const root = path.resolve(raw);
  try {
    return fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function ensureCodeIndexSchema(db: PnwDbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS phoenix_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
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
  `);
  const columns = db.all<{ name: string }>("PRAGMA table_info(phoenix_code_file_asset)");
  if (!columns.some((column) => column.name === "text_encoding")) {
    db.exec("ALTER TABLE phoenix_code_file_asset ADD COLUMN text_encoding TEXT NOT NULL DEFAULT ''");
  }
}

function codeIndexMetaGet(db: PnwDbAdapter, key: string): string | null {
  const row = db.get<{ value: string }>("SELECT value FROM phoenix_meta WHERE key = ?", [key]);
  return row ? String(row.value) : null;
}

function codeIndexMetaSet(db: PnwDbAdapter, key: string, value: string): void {
  db.run(
    `INSERT INTO phoenix_meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

function emptyCodeIndexStats(): Record<string, number> {
  return { total: 0, source: 0, config: 0, doc: 0, resource: 0 };
}

function statsForEntries(entries: CodeIndexEntry[]): Record<string, number> {
  const stats = emptyCodeIndexStats();
  for (const entry of entries) {
    if (entry.file_status !== "present") continue;
    stats.total += 1;
    stats[entry.asset_kind] = (stats[entry.asset_kind] || 0) + 1;
  }
  return stats;
}

function parseCodeIndexStats(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const stats = emptyCodeIndexStats();
    for (const [key, value] of Object.entries(parsed)) {
      const number = Number(value);
      if (Number.isFinite(number)) stats[key] = number;
    }
    return stats;
  } catch {
    return null;
  }
}

function normalizeLegacyCodeIndexEntry(raw: unknown): CodeIndexEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  let rel = normalizeRelPath(String(item.repo_rel_path || "")).trim();
  while (rel.startsWith("./")) rel = rel.slice(2);
  if (!rel || path.posix.isAbsolute(rel) || rel.split("/").includes("..")) return null;
  const filename = String(item.filename || path.posix.basename(rel));
  const kind = String(item.asset_kind || codeAssetKind(filename) || "resource");
  return {
    repo_rel_path: rel,
    filename,
    asset_kind: CODE_ASSET_KINDS.includes(kind as (typeof CODE_ASSET_KINDS)[number]) ? kind : "resource",
    file_ext: String(item.file_ext || fileExt(filename)).toLowerCase(),
    file_status: item.file_status === "missing" ? "missing" : "present",
    size_bytes: Math.max(0, Number(item.size_bytes || 0)),
    text_encoding: String(item.text_encoding || ""),
    last_seen_at: item.last_seen_at ? String(item.last_seen_at) : null,
  };
}

function upsertCodeIndexEntry(db: PnwDbAdapter, entry: CodeIndexEntry, updatedAt: string): void {
  db.run(
    `INSERT INTO phoenix_code_file_asset(
       repo_rel_path, filename, asset_kind, file_ext, file_status,
       size_bytes, text_encoding, last_seen_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_rel_path) DO UPDATE SET
       filename = excluded.filename,
       asset_kind = excluded.asset_kind,
       file_ext = excluded.file_ext,
       file_status = excluded.file_status,
       size_bytes = excluded.size_bytes,
       text_encoding = excluded.text_encoding,
       last_seen_at = excluded.last_seen_at,
       updated_at = excluded.updated_at`,
    [
      entry.repo_rel_path,
      entry.filename,
      entry.asset_kind,
      entry.file_ext,
      entry.file_status,
      entry.size_bytes,
      entry.text_encoding,
      entry.last_seen_at,
      updatedAt,
    ],
  );
}

function importLegacyCodeIndexOnce(
  db: PnwDbAdapter,
  workspaceRoot: string,
  opts?: CodeIndexStorageOptions,
): void {
  if (codeIndexMetaGet(db, CODE_INDEX_JSON_IMPORT_KEY)) return;
  const legacy = readLegacyCodeIndexStore(opts);
  const matchesWorkspace = Boolean(
    legacy?.workspace_path &&
    path.resolve(legacy.workspace_path).toLowerCase() === workspaceRoot.toLowerCase(),
  );
  const entries = matchesWorkspace
    ? legacy!.entries.map(normalizeLegacyCodeIndexEntry).filter(Boolean) as CodeIndexEntry[]
    : [];
  const existing = Number(db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM phoenix_code_file_asset",
  )?.count || 0);
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION");
  try {
    if (existing === 0 && entries.length) {
      for (const entry of entries) upsertCodeIndexEntry(db, entry, now);
      const stats = statsForEntries(entries);
      const scannedAt = legacy?.last_scan_at || now;
      const statsJson = JSON.stringify(stats);
      db.run(
        "INSERT INTO phoenix_code_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
        [scannedAt, "legacy-json", statsJson],
      );
      codeIndexMetaSet(db, CODE_INDEX_LAST_SCAN_AT_KEY, scannedAt);
      codeIndexMetaSet(db, CODE_INDEX_LAST_SCAN_STATS_KEY, statsJson);
    }
    if (matchesWorkspace && !codeIndexMetaGet(db, CODE_INDEX_EXTRA_EXTS_KEY)) {
      const extensions = normalizeExtensions([
        ...(legacy?.extra_extensions || []),
        ...readLegacyCodeIndexExtraExtensions(opts),
      ]);
      if (extensions.length) codeIndexMetaSet(db, CODE_INDEX_EXTRA_EXTS_KEY, JSON.stringify(extensions));
    }
    codeIndexMetaSet(db, CODE_INDEX_JSON_IMPORT_KEY, JSON.stringify({ imported_at: now, matched: matchesWorkspace }));
    db.exec("COMMIT");
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function openCodeIndexDb(workspaceRoot: string, opts?: CodeIndexStorageOptions): { root: string; db: PnwDbAdapter } {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) throw new Error("Workspace is not configured");
  const db = pnwCreateDb(ensurePhoenixDatabase(root));
  try {
    ensureCodeIndexSchema(db);
    importLegacyCodeIndexOnce(db, root, opts);
    return { root, db };
  } catch (error) {
    db.close();
    throw error;
  }
}

function codeIndexExtraExtensionsFromDb(db: PnwDbAdapter): string[] {
  const raw = codeIndexMetaGet(db, CODE_INDEX_EXTRA_EXTS_KEY);
  if (!raw) return [];
  try {
    const values = JSON.parse(raw);
    return Array.isArray(values) ? normalizeExtensions(values.map(String)) : [];
  } catch {
    return [];
  }
}

function codeIndexStatsFromDb(db: PnwDbAdapter): Record<string, number> {
  const stats = emptyCodeIndexStats();
  const rows = db.all<{ asset_kind: string; count: number }>(
    `SELECT asset_kind, COUNT(*) AS count
     FROM phoenix_code_file_asset
     WHERE file_status = 'present'
     GROUP BY asset_kind`,
  );
  for (const row of rows) {
    const count = Number(row.count || 0);
    stats[row.asset_kind] = count;
    stats.total += count;
  }
  return stats;
}

function codeIndexEntryFromRow(row: Record<string, unknown>): CodeIndexEntry {
  return {
    repo_rel_path: String(row.repo_rel_path || ""),
    filename: String(row.filename || ""),
    asset_kind: String(row.asset_kind || "resource"),
    file_ext: String(row.file_ext || ""),
    file_status: row.file_status === "missing" ? "missing" : "present",
    size_bytes: Number(row.size_bytes || 0),
    text_encoding: String(row.text_encoding || ""),
    last_seen_at: row.last_seen_at ? String(row.last_seen_at) : null,
  };
}

function buildCodeIndexPayload(
  db: PnwDbAdapter,
  workspaceRoot: string,
  summary?: string,
  scanId?: number,
): CodeIndexPayload {
  const counts = db.get<{ file_count: number; present_count: number }>(
    `SELECT COUNT(*) AS file_count,
            SUM(CASE WHEN file_status = 'present' THEN 1 ELSE 0 END) AS present_count
     FROM phoenix_code_file_asset`,
  );
  const stats = parseCodeIndexStats(codeIndexMetaGet(db, CODE_INDEX_LAST_SCAN_STATS_KEY))
    || codeIndexStatsFromDb(db);
  return {
    workspace_path: workspaceRoot,
    workspace_path_display: pathDisplay(workspaceRoot),
    last_scan_at: codeIndexMetaGet(db, CODE_INDEX_LAST_SCAN_AT_KEY),
    stats,
    file_count: Number(counts?.file_count || 0),
    present_count: Number(counts?.present_count || 0),
    kind_labels: KIND_LABELS,
    kinds: [...CODE_ASSET_KINDS],
    builtin_extensions: builtinIndexExtensions(),
    extra_extensions: codeIndexExtraExtensionsFromDb(db),
    summary,
    scan_id: scanId,
  };
}

function walkCodeIndexWorkspace(
  workspaceRoot: string,
  ignorePatterns: string[],
  onFile: (absolutePath: string, filename: string, sizeBytes: number) => void,
): void {
  const walk = (dir: string) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => Number(!a.isDirectory()) - Number(!b.isDirectory()) || a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const item of items) {
      if (item.isSymbolicLink() || isIgnoredName(item.name, ignorePatterns)) continue;
      const absolutePath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (isScannableDir(item.name) && !isProcessDirName(item.name)) walk(absolutePath);
        continue;
      }
      if (!item.isFile()) continue;
      try {
        onFile(absolutePath, item.name, fs.statSync(absolutePath).size);
      } catch {
        // Ignore files that disappear or become unreadable during the scan.
      }
    }
  };
  walk(workspaceRoot);
}

export function loadCodeIndexExtraExtensions(
  workspaceRoot: string,
  opts?: CodeIndexStorageOptions,
): string[] {
  if (!workspaceDirectory(workspaceRoot)) return [];
  const { db } = openCodeIndexDb(workspaceRoot, opts);
  try {
    return codeIndexExtraExtensionsFromDb(db);
  } finally {
    db.close();
  }
}

export function saveCodeIndexExtraExtensions(
  workspaceRoot: string,
  extensions: string[],
  opts?: CodeIndexStorageOptions,
): string[] {
  const normalized = normalizeExtensions(extensions);
  const { db } = openCodeIndexDb(workspaceRoot, opts);
  try {
    codeIndexMetaSet(db, CODE_INDEX_EXTRA_EXTS_KEY, JSON.stringify(normalized));
    return normalized;
  } finally {
    db.close();
  }
}

export function loadCodeIndex(workspaceRoot: string, opts?: CodeIndexStorageOptions): CodeIndexPayload {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) return emptyCodeIndexPayload(String(workspaceRoot || "").trim());
  const opened = openCodeIndexDb(root, opts);
  try {
    return buildCodeIndexPayload(opened.db, opened.root);
  } finally {
    opened.db.close();
  }
}

export function scanCodeIndex(workspaceRoot: string, opts?: CodeIndexScanOptions): CodeIndexPayload {
  const root = workspaceDirectory(workspaceRoot);
  const adopted = normalizeExtensions(opts?.adoptExtensions || []);
  if (!root) return emptyCodeIndexPayload(String(workspaceRoot || "").trim(), adopted);

  const opened = openCodeIndexDb(root, opts);
  const db = opened.db;
  try {
    const extraExtensions = normalizeExtensions([
      ...codeIndexExtraExtensionsFromDb(db),
      ...adopted,
    ]);
    const now = new Date().toISOString();
    const entries: CodeIndexEntry[] = [];
    walkCodeIndexWorkspace(root, opts?.ignorePatterns || [], (absolutePath, filename, sizeBytes) => {
      if (!isCodeIndexFilename(filename, extraExtensions)) return;
      entries.push({
        repo_rel_path: normalizeRelPath(path.relative(root, absolutePath)),
        filename,
        asset_kind: codeAssetKind(filename, extraExtensions) || "resource",
        file_ext: fileExt(filename),
        file_status: "present",
        size_bytes: sizeBytes,
        text_encoding: isBinarySuffix(filename) ? "binary" : readEncoding(absolutePath),
        last_seen_at: now,
      });
    });
    entries.sort((a, b) => a.repo_rel_path.localeCompare(b.repo_rel_path, undefined, { sensitivity: "base" }));
    const stats = statsForEntries(entries);
    const statsJson = JSON.stringify(stats);

    db.exec("BEGIN TRANSACTION");
    let scanId = 0;
    try {
      db.run(
        `UPDATE phoenix_code_file_asset
         SET file_status = 'missing', updated_at = ?
         WHERE file_status != 'missing'`,
        [now],
      );
      for (const entry of entries) upsertCodeIndexEntry(db, entry, now);
      db.run(
        "INSERT INTO phoenix_code_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
        [now, ".", statsJson],
      );
      scanId = Number(db.get<{ id: number }>("SELECT last_insert_rowid() AS id")?.id || 0);
      codeIndexMetaSet(db, CODE_INDEX_EXTRA_EXTS_KEY, JSON.stringify(extraExtensions));
      codeIndexMetaSet(db, CODE_INDEX_LAST_SCAN_AT_KEY, now);
      codeIndexMetaSet(db, CODE_INDEX_LAST_SCAN_STATS_KEY, statsJson);
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }

    const extraNote = extraExtensions.length ? ` · 自定义后缀 ${extraExtensions.length}` : "";
    const summary =
      `Code 索引完成：${stats.total} 个文件（源 ${stats.source} · 配置 ${stats.config} · ` +
      `文档 ${stats.doc} · 资源 ${stats.resource}${extraNote}）`;
    return buildCodeIndexPayload(db, root, summary, scanId || undefined);
  } finally {
    db.close();
  }
}

export function queryCodeIndexEntries(workspaceRoot: string, query?: CodeIndexQueryOptions) {
  const offset = Math.max(0, Number(query?.offset || 0));
  const limit = Math.max(1, Math.min(500, Number(query?.limit || 100)));
  const root = workspaceDirectory(workspaceRoot);
  if (!root) return { entries: [] as CodeIndexEntry[], total: 0, offset, limit };

  const { db } = openCodeIndexDb(root, query);
  try {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query?.status === "present" || query?.status === "missing") {
      clauses.push("file_status = ?");
      params.push(query.status);
    }
    const kind = String(query?.kind || "all");
    if (kind !== "all") {
      clauses.push("asset_kind = ?");
      params.push(kind);
    }
    const search = codeIndexSearchClause(
      String(query?.q || ""),
      query?.searchMode === "filename" ? "filename" : "contains",
    );
    if (search.sql) {
      clauses.push(search.sql);
      params.push(...search.params);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = Number(db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM phoenix_code_file_asset ${where}`,
      params,
    )?.count || 0);
    const rows = db.all<Record<string, unknown>>(
      `SELECT repo_rel_path, filename, asset_kind, file_ext, file_status,
              size_bytes, text_encoding, last_seen_at
       FROM phoenix_code_file_asset
       ${where}
       ORDER BY repo_rel_path COLLATE NOCASE
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { entries: rows.map(codeIndexEntryFromRow), total, offset, limit };
  } finally {
    db.close();
  }
}

export function discoverCodeIndexExtensions(workspaceRoot: string, opts?: CodeIndexDiscoveryOptions) {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) {
    return { builtin_extensions: builtinIndexExtensions(), extra_extensions: [], candidates: [] };
  }
  const extraExtensions = loadCodeIndexExtraExtensions(root, opts);
  const known = new Set([...builtinIndexExtensions(), ...extraExtensions]);
  const counts = new Map<string, number>();
  walkCodeIndexWorkspace(root, opts?.ignorePatterns || [], (_absolutePath, filename) => {
    const ext = fileExt(filename);
    if (!ext || known.has(ext) || SKIP_DISCOVER_EXTENSIONS.has(ext) || isBinarySuffix(filename)) return;
    counts.set(ext, (counts.get(ext) || 0) + 1);
  });
  const candidates = [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
  return { builtin_extensions: builtinIndexExtensions(), extra_extensions: extraExtensions, candidates };
}

export function purgeMissingCodeIndex(workspaceRoot: string, opts?: CodeIndexStorageOptions) {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) return { ...emptyCodeIndexPayload(String(workspaceRoot || "").trim()), purge_deleted: 0 };
  const { db } = openCodeIndexDb(root, opts);
  try {
    const deleted = Number(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM phoenix_code_file_asset WHERE file_status = 'missing'",
    )?.count || 0);
    if (deleted) db.run("DELETE FROM phoenix_code_file_asset WHERE file_status = 'missing'");
    return { ...buildCodeIndexPayload(db, root), purge_deleted: deleted };
  } finally {
    db.close();
  }
}

export function exportCodeIndexJson(workspaceRoot: string, opts?: CodeIndexStorageOptions) {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) throw new Error("Workspace is not configured");
  const { db } = openCodeIndexDb(root, opts);
  try {
    const payload = buildCodeIndexPayload(db, root);
    if (!payload.file_count) throw new Error("Code 索引为空，请先执行工程内搜索");
    const entries = db.all<Record<string, unknown>>(
      `SELECT repo_rel_path, filename, asset_kind, file_ext, file_status,
              size_bytes, text_encoding, last_seen_at
       FROM phoenix_code_file_asset
       ORDER BY repo_rel_path COLLATE NOCASE`,
    ).map(codeIndexEntryFromRow);
    const outDir = path.join(root, ".phoenix", "exports");
    ensureDir(outDir);
    const outPath = path.join(outDir, "code_index.json");
    fs.writeFileSync(outPath, `${JSON.stringify({
      schema_version: 1,
      exported_at: new Date().toISOString(),
      last_scan_at: payload.last_scan_at,
      stats: payload.stats,
      file_count: payload.file_count,
      present_count: payload.present_count,
      entries,
    }, null, 2)}\n`, "utf8");
    return {
      path: outPath,
      path_display: normalizeRelPath(path.relative(root, outPath)),
    };
  } finally {
    db.close();
  }
}

export function codeIndexCatDlg(workspaceRoot: string, opts?: CodeIndexStorageOptions) {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) {
    const raw = String(workspaceRoot || "").trim();
    return {
      workspace_path: raw,
      workspace_path_display: pathDisplay(raw),
      last_scan_at: null,
      indexed: false,
      count: 0,
      entries: [],
    };
  }
  const { db } = openCodeIndexDb(root, opts);
  try {
    const rows = db.all<Record<string, unknown>>(
      `SELECT repo_rel_path, filename, size_bytes, last_seen_at
       FROM phoenix_code_file_asset
       WHERE file_status = 'present' AND file_ext = '.catdlg'
       ORDER BY repo_rel_path COLLATE NOCASE`,
    );
    const entries = rows.map((row) => ({
      repo_rel_path: String(row.repo_rel_path || ""),
      filename: String(row.filename || ""),
      size_bytes: Number(row.size_bytes || 0),
      last_seen_at: row.last_seen_at ? String(row.last_seen_at) : null,
    }));
    const lastScanAt = codeIndexMetaGet(db, CODE_INDEX_LAST_SCAN_AT_KEY);
    return {
      workspace_path: root,
      workspace_path_display: pathDisplay(root),
      last_scan_at: lastScanAt,
      indexed: Boolean(lastScanAt),
      count: entries.length,
      entries,
    };
  } finally {
    db.close();
  }
}

function loadPresentCodeIndexScope(workspaceRoot: string, opts?: CodeIndexStorageOptions) {
  const root = workspaceDirectory(workspaceRoot);
  if (!root) return { indexed: false, paths: [] as string[] };
  const { db } = openCodeIndexDb(root, opts);
  try {
    const indexed = Boolean(codeIndexMetaGet(db, CODE_INDEX_LAST_SCAN_AT_KEY));
    const paths = db.all<{ repo_rel_path: string }>(
      `SELECT repo_rel_path FROM phoenix_code_file_asset
       WHERE file_status = 'present'
       ORDER BY repo_rel_path COLLATE NOCASE`,
    ).map((row) => String(row.repo_rel_path));
    return { indexed, paths };
  } finally {
    db.close();
  }
}

export type RenameLevel = "dir" | "file" | "text";

export type CodeRenameOptions = CodeIndexStorageOptions & {
  old?: string;
  new?: string;
  levels?: RenameLevel[];
  scope?: string;
  target_encoding?: string;
  include_ignored?: boolean;
  rescan_index?: boolean;
  use_index_scope?: boolean;
  repo_rel_paths?: string[];
  ignorePatterns?: string[];
};

export type CodeRenameHit = {
  hit_id: string;
  repo_rel_path: string;
  level: RenameLevel;
  hits: number;
  lines?: number[];
  encoding_in?: string;
  encoding_out?: string;
  status?: string;
  detail?: string;
  new_path?: string;
};

export type CodeRenameResult = {
  ok: boolean;
  implemented: true;
  dry_run: boolean;
  old: string;
  new: string;
  levels: RenameLevel[];
  scope: string;
  target_encoding: "utf-8" | "gbk";
  include_ignored: boolean;
  rescan_index: boolean;
  hits: CodeRenameHit[];
  summary: { dirs: number; files: number; text_files: number; total_hits: number; skipped: number };
  lines: string[];
  workspace_path: string;
  message?: string;
  log?: string;
};

export type CodeRenamePrefs = {
  workspace_path: string;
  workspace_path_display: string;
  old: string;
  new: string;
  levels: RenameLevel[];
  scope: string;
  target_encoding: "utf-8" | "gbk";
  include_ignored: boolean;
  rescan_index: boolean;
  implemented: true;
};

const CODE_RENAME_PREFS_SECTION = "code_rename";
const CODE_RENAME_LEVELS: RenameLevel[] = ["dir", "file", "text"];

function normalizeRenameLevels(raw: unknown, strict = false): RenameLevel[] {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return ["text"];
  if (!Array.isArray(raw)) {
    if (strict) throw new Error("levels must be an array");
    return ["text"];
  }
  const levels: RenameLevel[] = [];
  for (const item of raw) {
    const level = String(item || "").trim().toLowerCase() as RenameLevel;
    if (!CODE_RENAME_LEVELS.includes(level)) {
      if (strict) throw new Error(`Unknown rename level: ${item}`);
      continue;
    }
    if (!levels.includes(level)) levels.push(level);
  }
  return levels.length ? levels : ["text"];
}

function normalizeTargetEncoding(raw: unknown, strict = false): "utf-8" | "gbk" {
  const value = String(raw || "utf-8").trim().toLowerCase();
  if (value === "utf-8" || value === "gbk") return value;
  if (strict) throw new Error("target_encoding must be utf-8 or gbk");
  return "utf-8";
}

function normalizedCodeRenamePrefs(workspaceRoot: string, raw: any = {}): CodeRenamePrefs {
  return {
    workspace_path: workspaceRoot,
    workspace_path_display: pathDisplay(workspaceRoot),
    old: String(raw.old || ""),
    new: String(raw.new || ""),
    levels: normalizeRenameLevels(raw.levels),
    scope: String(raw.scope || ""),
    target_encoding: normalizeTargetEncoding(raw.target_encoding),
    include_ignored: Boolean(raw.include_ignored),
    rescan_index: Boolean(raw.rescan_index),
    implemented: true,
  };
}

export function getCodeRenamePrefs(workspaceRoot: string): CodeRenamePrefs {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return normalizedCodeRenamePrefs(root);
  }
  return normalizedCodeRenamePrefs(
    root,
    loadWorkspaceSection(root, CODE_RENAME_PREFS_SECTION, {}),
  );
}

export function saveCodeRenamePrefs(workspaceRoot: string, patch: Partial<CodeRenameOptions> = {}): CodeRenamePrefs {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("Workspace is not configured");
  }
  const current: Record<string, unknown> = {
    ...loadWorkspaceSection(root, CODE_RENAME_PREFS_SECTION, {}),
  };
  if (Object.prototype.hasOwnProperty.call(patch, "old")) current.old = String(patch.old || "");
  if (Object.prototype.hasOwnProperty.call(patch, "new")) current.new = String(patch.new || "");
  if (Object.prototype.hasOwnProperty.call(patch, "levels")) current.levels = normalizeRenameLevels(patch.levels, true);
  if (Object.prototype.hasOwnProperty.call(patch, "scope")) current.scope = String(patch.scope || "").trim();
  if (Object.prototype.hasOwnProperty.call(patch, "target_encoding")) current.target_encoding = normalizeTargetEncoding(patch.target_encoding, true);
  if (Object.prototype.hasOwnProperty.call(patch, "include_ignored")) current.include_ignored = Boolean(patch.include_ignored);
  if (Object.prototype.hasOwnProperty.call(patch, "rescan_index")) current.rescan_index = Boolean(patch.rescan_index);
  replaceWorkspaceSection(root, CODE_RENAME_PREFS_SECTION, current);
  return getCodeRenamePrefs(root);
}

type RenameTarget = {
  oldAbs: string;
  newAbs: string;
  oldRel: string;
  newRel: string;
  level: "dir" | "file";
};

function safeRepoRel(rel: string): string {
  const normalized = pnwNormalizeWorkspacePath(rel);
  if (!normalized || normalized === ".") {
    throw new Error(`Invalid repo relative path: ${rel}`);
  }
  return normalized;
}

function resolveUnderWorkspace(root: string, rel: string): string {
  const full = path.resolve(root, safeRepoRel(rel));
  const back = path.relative(root, full);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return full;
}

function codeRenameRules(oldText: string, newText: string) {
  return pnwCodeResolveReplacementRules([{ id: "primary", search: oldText, replace: newText }]);
}

function listAllFiles(root: string, ignorePatterns: string[], includeIgnored: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!includeIgnored && isIgnoredName(item.name, ignorePatterns)) continue;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (includeIgnored || (isScannableDir(item.name) && !isProcessDirName(item.name))) walk(abs);
      } else if (item.isFile()) {
        out.push(normalizeRelPath(path.relative(root, abs)));
      }
    }
  };
  if (root && fs.existsSync(root) && fs.statSync(root).isDirectory()) walk(root);
  return out;
}

function scopeFiles(root: string, opts: CodeRenameOptions): string[] {
  if (opts.use_index_scope) {
    const scope = loadPresentCodeIndexScope(root, opts);
    if (scope.indexed) return scope.paths;
  }
  const explicit = Array.isArray(opts.repo_rel_paths) ? opts.repo_rel_paths.map(String).filter(Boolean) : [];
  if (explicit.length) {
    const files: string[] = [];
    for (const rel of explicit) {
      const safe = safeRepoRel(rel);
      const abs = resolveUnderWorkspace(root, safe);
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      if (stat.isFile()) {
        files.push(safe);
      } else if (stat.isDirectory()) {
        for (const file of listAllFiles(abs, opts.ignorePatterns || [], Boolean(opts.include_ignored))) {
          files.push(normalizeRelPath(path.join(safe, file)));
        }
      }
    }
    return [...new Set(files)].sort();
  }
  const scope = String(opts.scope || "").trim();
  const base = scope ? resolveUnderWorkspace(root, scope) : root;
  if (!fs.existsSync(base)) return [];
  const stat = fs.statSync(base);
  if (stat.isFile()) return [normalizeRelPath(path.relative(root, base))];
  return listAllFiles(base, opts.ignorePatterns || [], Boolean(opts.include_ignored))
    .map((rel) => normalizeRelPath(path.relative(root, path.resolve(base, rel))))
    .sort();
}

function scopeDirs(root: string, fileRels: string[]): string[] {
  const dirs = new Set<string>();
  for (const rel of fileRels) {
    let dir = path.posix.dirname(normalizeRelPath(rel));
    while (dir && dir !== ".") {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  return [...dirs].sort((a, b) => b.length - a.length);
}

function renameTargetForRel(root: string, rel: string, oldText: string, newText: string, level: "dir" | "file"): RenameTarget | null {
  const normalized = safeRepoRel(rel);
  const base = path.posix.basename(normalized);
  if (base !== oldText) return null;
  const parent = path.posix.dirname(normalized);
  const newBase = newText;
  if (!newBase || newBase.includes("/") || newBase.includes("\\")) return null;
  const newRel = parent === "." ? newBase : `${parent}/${newBase}`;
  return {
    oldAbs: resolveUnderWorkspace(root, normalized),
    newAbs: resolveUnderWorkspace(root, newRel),
    oldRel: normalized,
    newRel,
    level,
  };
}

function pathsReferToSameEntry(source: string, target: string): boolean {
  if (!fs.existsSync(source) || !fs.existsSync(target)) return false;
  try {
    const left = fs.realpathSync.native(source);
    const right = fs.realpathSync.native(target);
    return process.platform === "win32"
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  } catch {
    return false;
  }
}

function renamePathSafely(source: string, target: string): void {
  if (source === target) return;
  const caseOnly = process.platform === "win32"
    && source.toLowerCase() === target.toLowerCase();
  if (!caseOnly) {
    fs.renameSync(source, target);
    return;
  }

  const temporary = `${source}.__phoenix_rename_tmp__`;
  if (fs.existsSync(temporary)) throw new Error(`Temporary rename path exists: ${temporary}`);
  fs.renameSync(source, temporary);
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      fs.renameSync(temporary, source);
    } catch {
      // Preserve the original error; the temporary path remains recoverable on disk.
    }
    throw error;
  }
}

function collectRenameTargets(root: string, fileRels: string[], oldText: string, newText: string, levels: RenameLevel[]): RenameTarget[] {
  const targets: RenameTarget[] = [];
  if (levels.includes("file")) {
    for (const rel of fileRels) {
      const target = renameTargetForRel(root, rel, oldText, newText, "file");
      if (target) targets.push(target);
    }
  }
  if (levels.includes("dir")) {
    for (const rel of scopeDirs(root, fileRels)) {
      const target = renameTargetForRel(root, rel, oldText, newText, "dir");
      if (target) targets.push(target);
    }
  }
  return targets.sort((a, b) => b.oldRel.length - a.oldRel.length);
}

function renameResultBase(root: string, opts: CodeRenameOptions, dryRun: boolean): CodeRenameResult {
  const oldText = String(opts.old || "");
  const newText = String(opts.new || "");
  const levels = (Array.isArray(opts.levels) && opts.levels.length ? opts.levels : ["text"]) as RenameLevel[];
  return {
    ok: true,
    implemented: true,
    dry_run: dryRun,
    old: oldText,
    new: newText,
    levels,
    scope: String(opts.scope || ""),
    target_encoding: normalizeTargetEncoding(opts.target_encoding),
    include_ignored: Boolean(opts.include_ignored),
    rescan_index: Boolean(opts.rescan_index),
    hits: [] as CodeRenameHit[],
    summary: { dirs: 0, files: 0, text_files: 0, total_hits: 0, skipped: 0 },
    lines: [] as string[],
    workspace_path: root,
  };
}

function computeRenamePreview(workspaceRoot: string, opts: CodeRenameOptions, dryRun: boolean): CodeRenameResult {
  const root = workspaceRoot.trim();
  const out = renameResultBase(root, opts, dryRun);
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ...out, ok: false, message: "Workspace is not configured" };
  }
  const oldText = out.old;
  const newText = out.new;
  if (!oldText || !newText) return { ...out, ok: false, message: "Both old and new names are required" };
  if (oldText === newText) return { ...out, ok: false, message: "Old and new values are identical" };
  const replacementRules = codeRenameRules(oldText, newText);

  const fileRels = scopeFiles(root, opts);
  let seq = 0;
  for (const rel of fileRels) {
    const abs = resolveUnderWorkspace(root, rel);
    if (!fs.existsSync(abs) || isBinarySuffix(rel)) {
      out.summary.skipped += 1;
      continue;
    }
    if (!out.levels.includes("text")) continue;
    const payload = readSourceText(abs);
    if (!payload) {
      out.summary.skipped += 1;
      continue;
    }
    const text = payload.text;
    const replacement = pnwCodeReplaceTextByRules(text, replacementRules);
    const hits = replacement.occurrences;
    if (!hits) continue;
    const nextText = replacement.output;
    const outputPayload = chooseSourceWritePayload(payload, nextText, out.target_encoding);
    let encodingError = "";
    try {
      encodeSourceText(outputPayload, nextText);
    } catch (error: any) {
      encodingError = error?.message || String(error);
      out.summary.skipped += 1;
    }
    out.summary.text_files += 1;
    out.summary.total_hits += hits;
    out.hits.push({
      hit_id: `text:${++seq}`,
      repo_rel_path: rel,
      level: "text",
      hits,
      lines: [...replacement.lines],
      encoding_in: sourceTextEncodingLabel(payload),
      encoding_out: sourceTextEncodingLabel(outputPayload),
      status: encodingError ? "encoding-error" : dryRun ? "preview" : "pending",
      detail: encodingError || undefined,
    });
  }

  for (const target of collectRenameTargets(root, fileRels, oldText, newText, out.levels)) {
    const exists = fs.existsSync(target.oldAbs);
    const targetExists = fs.existsSync(target.newAbs);
    const conflict = targetExists && !pathsReferToSameEntry(target.oldAbs, target.newAbs);
    if (!exists || conflict) {
      out.summary.skipped += 1;
      out.hits.push({
        hit_id: `${target.level}:${++seq}`,
        repo_rel_path: target.oldRel,
        level: target.level,
        hits: 1,
        new_path: target.newRel,
        status: conflict ? "conflict" : "missing",
        detail: conflict ? `Target exists: ${target.newRel}` : "Source is missing",
      });
      continue;
    }
    if (target.level === "dir") out.summary.dirs += 1;
    else out.summary.files += 1;
    out.summary.total_hits += 1;
    out.hits.push({
      hit_id: `${target.level}:${++seq}`,
      repo_rel_path: target.oldRel,
      level: target.level,
      hits: 1,
      new_path: target.newRel,
      status: dryRun ? "preview" : "pending",
    });
  }

  out.message = `Found ${out.summary.total_hits} rename hits`;
  out.lines = [
    out.message,
    `Text files: ${out.summary.text_files}`,
    `Files: ${out.summary.files}`,
    `Directories: ${out.summary.dirs}`,
    `Skipped: ${out.summary.skipped}`,
  ];
  return out;
}

export type UuidKind = "uuid" | "guid32" | "suspicious";
export type UuidApplyStrategy = "map_per_value" | "fresh_per_hit";

export type CodeUuidHit = {
  hit_id: string;
  repo_rel_path: string;
  line: number;
  col: number;
  matched_text: string;
  uuid_normalized: string;
  kind: UuidKind;
  file_hits: number;
};

export type CodeUuidScanOptions = CodeIndexStorageOptions & {
  scope?: string;
  kinds?: UuidKind[];
  use_index_scope?: boolean;
  repo_rel_paths?: string[];
  include_ignored?: boolean;
  ignorePatterns?: string[];
};

export type CodeUuidApplyOptions = {
  hit_ids?: string[];
  strategy?: UuidApplyStrategy;
  dry_run?: boolean;
  target_encoding?: string;
};

type ParsedUuidHitId = {
  hit_id: string;
  repo_rel_path: string;
  line: number;
  col: number;
  matched_text: string;
};

const UUID_KINDS: UuidKind[] = ["uuid", "guid32", "suspicious"];
const DEFAULT_UUID_KINDS: UuidKind[] = ["uuid"];

function emptyUuidSummary() {
  return { files_scanned: 0, total_hits: 0, unique_uuids: 0 };
}

function normalizeUuidKinds(raw: unknown): UuidKind[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_UUID_KINDS];
  const out: UuidKind[] = [];
  for (const item of raw) {
    const kind = String(item || "").trim().toLowerCase() as UuidKind;
    if (UUID_KINDS.includes(kind) && !out.includes(kind)) out.push(kind);
  }
  return out.length ? out : [...DEFAULT_UUID_KINDS];
}

function normalizeUuidStrategy(raw: unknown): UuidApplyStrategy {
  return raw === "fresh_per_hit" ? "fresh_per_hit" : "map_per_value";
}

export function classifyUuidMatch(matched: string): UuidKind {
  const occurrence = pnwFindUuidOccurrences(matched)
    .find((item) => item.offset === 0 && item.value.length === matched.length);
  if (occurrence) return occurrence.kind === "guid32" ? "guid32" : "uuid";
  return "suspicious";
}

function makeUuidHitId(repoRelPath: string, line: number, col: number, matchedText: string): string {
  const raw = JSON.stringify({ p: repoRelPath, l: line, c: col, t: matchedText });
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseUuidHitId(hitId: string): ParsedUuidHitId {
  const padded = hitId.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (hitId.length % 4)) % 4);
  const data = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  return {
    hit_id: hitId,
    repo_rel_path: safeRepoRel(String(data.p || "")),
    line: Number(data.l),
    col: Number(data.c),
    matched_text: String(data.t || ""),
  };
}

function readUuidText(absPath: string): TextPayload | null {
  if (isBinarySuffix(absPath)) return null;
  try {
    const payload = detectAndRead(absPath);
    if (payload.content.includes("\u0000")) return null;
    return payload;
  } catch {
    return null;
  }
}

function scanUuidTextHits(text: string, rel: string, kinds: Set<UuidKind>): CodeUuidHit[] {
  const hits = pnwFindUuidOccurrences(text)
    .map((occurrence) => ({ occurrence, kind: occurrence.kind === "guid32" ? "guid32" as const : "uuid" as const }))
    .filter(({ kind }) => kinds.has(kind))
    .map(({ occurrence, kind }) => ({
      hit_id: makeUuidHitId(rel, occurrence.line, occurrence.column, occurrence.value),
      repo_rel_path: rel,
      line: occurrence.line,
      col: occurrence.column,
      matched_text: occurrence.value,
      uuid_normalized: occurrence.normalized,
      kind,
      file_hits: 0,
    }));
  for (const hit of hits) hit.file_hits = hits.length;
  return hits;
}

function uuidScanFailure(root: string, opts: CodeUuidScanOptions, message: string) {
  return {
    ok: false,
    implemented: true,
    message,
    scan_id: null,
    scope: String(opts.scope || ""),
    kinds: normalizeUuidKinds(opts.kinds),
    hits: [] as CodeUuidHit[],
    summary: emptyUuidSummary(),
  };
}

export function scanUuidsInWorkspace(workspaceRoot: string, opts: CodeUuidScanOptions = {}) {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return uuidScanFailure(root, opts, "Workspace is not configured");
  }

  const kinds = normalizeUuidKinds(opts.kinds);
  const kindSet = new Set(kinds);
  let fileRels: string[] = [];
  try {
    fileRels = scopeFiles(root, opts as CodeRenameOptions);
  } catch (e: any) {
    return uuidScanFailure(root, opts, e.message || String(e));
  }

  const hits: CodeUuidHit[] = [];
  let filesScanned = 0;
  for (const rel of fileRels) {
    const abs = resolveUnderWorkspace(root, rel);
    const payload = readUuidText(abs);
    if (!payload) continue;
    filesScanned += 1;
    hits.push(...scanUuidTextHits(payload.content, normalizeRelPath(rel), kindSet));
  }

  const unique = new Set(hits.map((hit) => hit.uuid_normalized)).size;
  const scanId = `${Date.now()}`;
  const message = `UUID scan: ${filesScanned} text files, ${hits.length} hits, ${unique} unique values`;
  const lines = [
    message,
    ...hits.slice(0, 30).map((hit) => `  - ${hit.repo_rel_path}:${hit.line} ${hit.matched_text}`),
  ];
  if (hits.length > 30) lines.push(`  - ${hits.length - 30} more hits`);
  return {
    ok: true,
    implemented: true,
    message,
    scan_id: scanId,
    scope: String(opts.scope || ""),
    kinds,
    hits,
    summary: { files_scanned: filesScanned, total_hits: hits.length, unique_uuids: unique },
    use_index_scope: Boolean(opts.use_index_scope),
    repo_rel_paths: Array.isArray(opts.repo_rel_paths) ? normalizeWorksetPaths(opts.repo_rel_paths.map(String)) : [],
    lines,
    log: lines.join("\n"),
  };
}

function uuidApplyFailure(root: string, opts: CodeUuidApplyOptions, message: string) {
  return {
    ok: false,
    implemented: true,
    dry_run: Boolean(opts.dry_run),
    message,
    hit_ids: Array.isArray(opts.hit_ids) ? opts.hit_ids.map(String) : [],
    strategy: normalizeUuidStrategy(opts.strategy),
    mappings: [] as Array<{ old: string; new: string; hit_id: string }>,
    summary: { ...emptyUuidSummary(), unique_new_uuids: 0 },
    report_path: undefined as string | undefined,
    report_path_display: undefined as string | undefined,
    lines: [message],
    log: message,
  };
}

export function applyUuidsInWorkspace(workspaceRoot: string, opts: CodeUuidApplyOptions = {}) {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return uuidApplyFailure(root, opts, "Workspace is not configured");
  }

  const hitIds = [...new Set((Array.isArray(opts.hit_ids) ? opts.hit_ids : []).map(String).map((id) => id.trim()).filter(Boolean))];
  if (!hitIds.length) return uuidApplyFailure(root, opts, "No UUID hits selected");

  let parsed: ParsedUuidHitId[];
  try {
    parsed = hitIds.map(parseUuidHitId);
  } catch (e: any) {
    return uuidApplyFailure(root, opts, `Invalid UUID hit id: ${e.message || String(e)}`);
  }

  const strategy = normalizeUuidStrategy(opts.strategy);
  const dryRun = Boolean(opts.dry_run);
  const byFile = new Map<string, ParsedUuidHitId[]>();
  for (const item of parsed) byFile.set(item.repo_rel_path, [...(byFile.get(item.repo_rel_path) || []), item]);
  const mappings: Array<{ old: string; new: string; hit_id: string }> = [];
  const lines: string[] = [];
  let touchedFiles = 0;
  const payloadByFile = new Map<string, TextPayload>();
  for (const [rel] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let abs: string;
    try {
      abs = resolveUnderWorkspace(root, rel);
    } catch (e: any) {
      lines.push(`  [skip] ${rel}: ${e.message || String(e)}`);
      continue;
    }
    const payload = fs.existsSync(abs) ? readUuidText(abs) : null;
    if (!payload) {
      lines.push(`  [skip] ${rel}: cannot read text file`);
      continue;
    }
    payloadByFile.set(rel, payload);
  }

  const plan = pnwPlanUuidReplacements(
    [...payloadByFile].map(([id, payload]) => ({ id, text: payload.content })),
    { strategy, createUuid: randomUUID },
  );
  if (!plan.valid) return uuidApplyFailure(root, opts, plan.diagnostics.join("; ") || "Cannot plan UUID replacements");

  const selectedWingIds = new Set<string>();
  const deskByWingId = new Map<string, ParsedUuidHitId>();
  for (const item of parsed) {
    const candidates = plan.hits.filter((hit) => hit.fileId === item.repo_rel_path && hit.from === item.matched_text);
    const exact = candidates.find((hit) => hit.line === item.line && hit.column === item.col);
    const hit = exact || (candidates.length === 1 ? candidates[0] : undefined);
    if (!hit || deskByWingId.has(hit.id)) {
      lines.push(`  [skip] ${item.repo_rel_path}:${item.line} ${item.matched_text}`);
      continue;
    }
    selectedWingIds.add(hit.id);
    deskByWingId.set(hit.id, item);
  }

  const hitById = new Map<string, PnwUuidReplacementPlanHit>(plan.hits.map((hit) => [hit.id, hit]));
  for (const [rel, payload] of payloadByFile) {
    const selectedForFile = new Set([...selectedWingIds].filter((id) => hitById.get(id)?.fileId === rel));
    if (!selectedForFile.size) continue;
    const projected = pnwApplyUuidReplacementPlan(payload.content, rel, plan, selectedForFile);
    for (const diagnostic of projected.diagnostics) lines.push(`  [skip] ${diagnostic}`);
    for (const appliedId of projected.appliedHitIds) {
      const hit = hitById.get(appliedId)!;
      const desk = deskByWingId.get(appliedId)!;
      mappings.push({ old: hit.from, new: hit.formattedTo, hit_id: desk.hit_id });
      lines.push(`  ${dryRun ? "[preview]" : "[write]"} ${rel}:${hit.line} ${hit.from} -> ${hit.formattedTo}`);
    }
    if (projected.text !== payload.content) {
      touchedFiles += 1;
      if (!dryRun) {
        const abs = resolveUnderWorkspace(root, rel);
        const outputPayload = chooseSourceWritePayload(payload.source, projected.text, opts.target_encoding);
        writeSourceText(abs, outputPayload, projected.text);
      }
    }
  }

  const unique = new Set(mappings.map((m) => pnwNormalizeUuid(m.old))).size;
  const uniqueNew = new Set(mappings.map((m) => pnwNormalizeUuid(m.new))).size;
  const message = `${dryRun ? "Previewed" : "Applied"} ${mappings.length} UUID replacements in ${touchedFiles} files`;
  lines.unshift(message);
  const result: Record<string, any> = {
    ok: true,
    implemented: true,
    dry_run: dryRun,
    message,
    hit_ids: hitIds,
    strategy,
    mappings,
    summary: {
      files_scanned: touchedFiles,
      total_hits: mappings.length,
      unique_uuids: unique,
      unique_new_uuids: uniqueNew,
    },
    lines,
    log: lines.join("\n"),
  };
  if (!dryRun && mappings.length) {
    const report = writeCodeOperationReport(root, "code-uuid-report", {
      exported_at: new Date().toISOString(),
      strategy,
      ...result,
    });
    if (report) {
      Object.assign(result, report);
      result.lines.push(`[report] ${report.report_path_display}`);
      result.log = result.lines.join("\n");
    }
  }
  return result;
}

function workspaceRootFromUuidOpts(opts: any): string {
  if (typeof opts === "string") return opts;
  return String(opts?.workspaceRoot || opts?.workspace_root || opts?.workspace_path || opts?.repoRoot || opts?.repo_root || "");
}

export function scanUuidHits(opts: any): any {
  return scanUuidsInWorkspace(workspaceRootFromUuidOpts(opts), opts || {});
}

export function applyUuidHits(opts: any): any {
  return applyUuidsInWorkspace(workspaceRootFromUuidOpts(opts), opts || {});
}
export function previewRename(opts: CodeRenameOptions): any {
  return computeRenamePreview(String((opts as any).workspaceRoot || (opts as any).workspace_path || ""), opts, true);
}

export function previewRenameInWorkspace(workspaceRoot: string, opts: CodeRenameOptions): any {
  const result = computeRenamePreview(workspaceRoot, opts, true);
  if (result.ok) saveCodeRenamePrefs(workspaceRoot, opts);
  return result;
}

export function applyRenameInWorkspace(workspaceRoot: string, opts: CodeRenameOptions): any {
  const preview = computeRenamePreview(workspaceRoot, opts, false);
  if (!preview.ok) return preview;
  saveCodeRenamePrefs(workspaceRoot, opts);
  const root = workspaceRoot.trim();
  const oldText = preview.old;
  const newText = preview.new;
  const replacementRules = codeRenameRules(oldText, newText);
  const appliedLines: string[] = [];

  for (const hit of preview.hits.filter((h: CodeRenameHit) => h.level === "text" && h.status === "pending")) {
    const abs = resolveUnderWorkspace(root, hit.repo_rel_path);
    const payload = readSourceText(abs);
    if (!payload) {
      hit.status = "unreadable";
      hit.detail = "Cannot decode source text as UTF-8 or GBK";
      preview.summary.skipped += 1;
      continue;
    }
    const after = pnwCodeReplaceTextByRules(payload.text, replacementRules).output;
    if (after === payload.text) continue;
    try {
      const outputPayload = chooseSourceWritePayload(payload, after, preview.target_encoding);
      writeSourceText(abs, outputPayload, after);
      hit.encoding_in = sourceTextEncodingLabel(payload);
      hit.encoding_out = sourceTextEncodingLabel(outputPayload);
      hit.status = "written";
      appliedLines.push(`text ${hit.repo_rel_path}: ${hit.hits} (${hit.encoding_in}->${hit.encoding_out})`);
    } catch (error: any) {
      hit.status = "encoding-error";
      hit.detail = error?.message || String(error);
      preview.summary.skipped += 1;
    }
  }

  const pathHits = preview.hits
    .filter((h: CodeRenameHit) => (h.level === "file" || h.level === "dir") && h.status === "pending" && h.new_path)
    .sort((a: CodeRenameHit, b: CodeRenameHit) => b.repo_rel_path.length - a.repo_rel_path.length);
  for (const hit of pathHits) {
    const oldAbs = resolveUnderWorkspace(root, hit.repo_rel_path);
    const newAbs = resolveUnderWorkspace(root, hit.new_path!);
    const sourceExists = fs.existsSync(oldAbs);
    const targetExists = fs.existsSync(newAbs);
    const conflict = targetExists && !pathsReferToSameEntry(oldAbs, newAbs);
    if (!sourceExists || conflict) {
      hit.status = conflict ? "conflict" : "missing";
      preview.summary.skipped += 1;
      continue;
    }
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    renamePathSafely(oldAbs, newAbs);
    hit.status = "written";
    appliedLines.push(`${hit.level} ${hit.repo_rel_path} -> ${hit.new_path}`);
  }

  if (preview.rescan_index) {
    scanCodeIndex(root, opts);
  }
  preview.dry_run = false;
  preview.message = `Applied ${preview.summary.total_hits} rename hits`;
  preview.lines = [preview.message, ...appliedLines];
  preview.log = preview.lines.join("\n");
  if (appliedLines.length) {
    const report = writeCodeOperationReport(root, "code-rename-report", {
      ...preview,
      exported_at: new Date().toISOString(),
      old: oldText,
      new: newText,
      levels: preview.levels,
    });
    if (report) {
      Object.assign(preview, report);
      preview.lines.push(`[report] ${report.report_path_display}`);
      preview.log = preview.lines.join("\n");
    }
  }
  return preview;
}

export function applyRename(opts: any): any {
  return applyRenameInWorkspace(String(opts.workspaceRoot || opts.workspace_path || ""), opts);
}
export function scanUuids(opts: any): any {
  return scanUuidsInWorkspace(workspaceRootFromUuidOpts(opts), opts || {});
}
export function applyUuids(opts: any): any {
  return applyUuidsInWorkspace(workspaceRootFromUuidOpts(opts), opts || {});
}
