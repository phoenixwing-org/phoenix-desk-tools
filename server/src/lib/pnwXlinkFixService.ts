import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import { refreshBomXrefsForHosts } from "./pnwBomXrefService.js";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import { patchFcstdXlinkAttributes } from "./fcstdReferenceLabelService.js";

export type XlinkFixPrefs = {
  batch_dir: string;
  dry_run: boolean;
  all_in_dir: boolean;
};

export type XlinkFixCandidateFile = {
  id: number;
  repo_rel_path: string;
  filename: string;
  part_number: string;
  part_version: string;
  part_key: string;
  file_status: string;
};

export type XlinkFixIssueRow = {
  host_repo_rel: string;
  host_filename: string;
  host_display: string;
  old_path: string;
  new_path: string;
  target_file: string;
  target_display: string;
  verdict: string;
  note: string;
  count: number;
  status: "fixable" | "not_found" | "fixed_manual";
  basename?: string;
  part_number?: string;
  part_version?: string;
  part_key?: string;
};

export type XlinkFixResult = {
  exit_code: number;
  log: string;
  prefs: XlinkFixPrefs;
  batch_dir_display: string;
  map_path_display: string;
  schema: 1;
  dry_run: boolean;
  total_changes: number;
  skipped: string[];
  files: Array<{
    path: string;
    host_repo_rel: string;
    changes: number;
    records: Array<{
      old_path: string;
      new_path: string;
      target_file: string;
      verdict: string;
      note: string;
      count: number;
    }>;
  }>;
  issue_rows: XlinkFixIssueRow[];
  stats: {
    host_count: number;
    hosts_with_issues: number;
    issue_count: number;
    fixable_count: number;
    not_found_count: number;
    skipped_count: number;
    total_changes: number;
  };
  index_pending?: boolean;
  _native?: "node";
  bom_xref_refresh?: unknown;
};

type PartHints = {
  basename: string;
  part_number: string;
  part_version: string;
  part_key: string;
};

type XrefRow = {
  id: number;
  host_repo_rel_path: string;
  xlink_file_attr: string;
  target_basename: string;
  target_file_asset_id: number | null;
  target_repo_rel_path: string | null;
  target_part_number: string;
  target_part_version: string;
  target_type_code: string;
  target_model_series: string;
  target_part_name: string;
  target_asset_label: string;
  resolve_status: string;
  asset_repo_rel_path: string | null;
  asset_filename: string | null;
  asset_part_number: string | null;
  asset_part_version: string | null;
  asset_file_status: string | null;
};


const DEFAULT_PREFS: XlinkFixPrefs = {
  batch_dir: ".",
  dry_run: true,
  all_in_dir: true,
};

const PRESENT = "present";
const DB_NAME = "phoenix-workspace.sqlite";

function workspaceRootOrEmpty(workspaceRoot: string): string {
  const raw = String(workspaceRoot || "").trim();
  return raw ? path.resolve(raw) : "";
}

function dbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".phoenix", DB_NAME);
}

function workspaceOk(workspaceRoot: string): boolean {
  try {
    return Boolean(workspaceRoot) && fs.statSync(workspaceRoot).isDirectory();
  } catch {
    return false;
  }
}

function stripDot(rel: unknown): string {
  let s = String(rel || "").replace(/\\/g, "/").trim();
  while (s.startsWith("./")) s = s.slice(2);
  return s.replace(/^\/+/, "");
}

function normRel(rel: unknown): string {
  const s = stripDot(rel);
  return s ? `./${s}` : "";
}

function displayPath(absPath: string, workspaceRoot: string): string {
  if (!workspaceRoot) return path.normalize(absPath);
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (!rel || rel === ".") return ".";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return `./${rel}`;
  return path.normalize(abs);
}

function resolveUnderWorkspace(workspaceRoot: string, rawValue: unknown): string {
  const root = path.resolve(workspaceRoot);
  const raw = String(rawValue || "").trim();
  const candidate = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(root, stripDot(raw || "."));
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${rawValue}`);
  }
  return candidate;
}

function relUnderWorkspace(workspaceRoot: string, rawValue: unknown): string {
  const abs = resolveUnderWorkspace(workspaceRoot, rawValue);
  const rel = path.relative(path.resolve(workspaceRoot), abs).replace(/\\/g, "/");
  return rel && rel !== "." ? rel : "";
}

function normalizeStoredBatchDir(rawValue: unknown): string | null {
  const raw = String(rawValue || "").trim().replace(/\\/g, "/");
  if (!raw || raw === ".") return null;
  return raw;
}

function resolveBatchDir(workspaceRoot: string, input?: unknown): string {
  if (input != null) {
    const s = String(input || "").trim();
    return resolveUnderWorkspace(workspaceRoot, !s || s === "." ? "." : s);
  }
  const raw = loadWorkspaceSection<Record<string, any>>(workspaceRoot, "fc_linkfix", {});
  return resolveUnderWorkspace(workspaceRoot, normalizeStoredBatchDir(raw.freecad_batch_dir) || ".");
}

function storeBatchDir(workspaceRoot: string, rawValue: unknown): string | null {
  const rel = relUnderWorkspace(workspaceRoot, rawValue || ".");
  return rel ? rel : null;
}

function prefsFromRaw(raw: any, workspaceRoot: string): XlinkFixPrefs {
  const stored = normalizeStoredBatchDir(raw?.freecad_batch_dir);
  const batchAbs = resolveUnderWorkspace(workspaceRoot, stored || ".");
  return {
    batch_dir: displayPath(batchAbs, workspaceRoot),
    dry_run: raw?.dry_run == null ? DEFAULT_PREFS.dry_run : Boolean(raw.dry_run),
    all_in_dir: raw?.all_in_dir == null ? DEFAULT_PREFS.all_in_dir : Boolean(raw.all_in_dir),
  };
}

function openDb(workspaceRoot: string): PnwDbAdapter | null {
  const file = dbPath(workspaceRoot);
  if (!workspaceOk(workspaceRoot) || !fs.existsSync(file)) return null;
  return pnwCreateDb(file);
}

function tableExists(db: PnwDbAdapter, name: string): boolean {
  try {
    return Boolean(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]));
  } catch {
    return false;
  }
}

function hasXlinkTables(db: PnwDbAdapter): boolean {
  return tableExists(db, "phoenix_cad_file_asset") && tableExists(db, "phoenix_cad_bom_xref");
}

function hasFileAssetTable(db: PnwDbAdapter): boolean {
  return tableExists(db, "phoenix_cad_file_asset");
}

function xlinkIndexReady(db: PnwDbAdapter): boolean {
  if (!hasXlinkTables(db)) return false;
  const assets = Number(db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM phoenix_cad_file_asset",
  )?.count || 0);
  const xrefs = Number(db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM phoenix_cad_bom_xref",
  )?.count || 0);
  if (assets > 0 || xrefs > 0) return true;
  if (!tableExists(db, "phoenix_cad_scan")) return false;
  return Number(db.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM phoenix_cad_scan WHERE status IN ('done', 'completed')",
  )?.count || 0) > 0;
}

function basenamePosix(value: unknown): string {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  return raw ? path.posix.basename(raw) : "";
}

function partKey(partNumber: string, partVersion: string): string {
  return partNumber && partVersion ? `${partNumber}.${partVersion}` : "";
}

function candidateFromRow(row: any): XlinkFixCandidateFile {
  const partNumber = String(row.part_number || "");
  const partVersion = String(row.part_version || "");
  return {
    id: Number(row.id || 0),
    repo_rel_path: normRel(row.repo_rel_path),
    filename: String(row.filename || basenamePosix(row.repo_rel_path)),
    part_number: partNumber,
    part_version: partVersion,
    part_key: partKey(partNumber, partVersion),
    file_status: String(row.file_status || PRESENT),
  };
}

function fcstdStem(filename: string): string {
  return filename.replace(/\.fcstd$/i, "");
}

function queryCandidatesByPart(db: PnwDbAdapter, partNumber: string, partVersion: string): XlinkFixCandidateFile[] {
  if (!partNumber || !partVersion) return [];
  const rows = db.all<any>(
    `SELECT id, repo_rel_path, filename, part_number, part_version, file_status
     FROM phoenix_cad_file_asset
     WHERE COALESCE(file_status, ?) = ?
       AND lower(filename) LIKE '%.fcstd'
       AND part_number = ?
       AND part_version = ?
     ORDER BY filename, repo_rel_path
     LIMIT 80`,
    [PRESENT, PRESENT, partNumber, partVersion],
  );
  return rows.map(candidateFromRow);
}

function queryCandidatesByBasename(db: PnwDbAdapter, basename: string): XlinkFixCandidateFile[] {
  const name = basenamePosix(basename);
  if (!name) return [];
  const likePrefix = `${fcstdStem(name)}%`;
  const rows = db.all<any>(
    `SELECT id, repo_rel_path, filename, part_number, part_version, file_status
     FROM phoenix_cad_file_asset
     WHERE COALESCE(file_status, ?) = ?
       AND lower(filename) LIKE '%.fcstd'
       AND (
         lower(filename) = lower(?)
         OR lower(filename) LIKE lower(?)
       )
     ORDER BY filename, repo_rel_path
     LIMIT 80`,
    [PRESENT, PRESENT, name, likePrefix],
  );
  return rows.map(candidateFromRow);
}

function addUniqueCandidates(
  out: XlinkFixCandidateFile[],
  seen: Set<string>,
  rows: XlinkFixCandidateFile[],
  excludeRepoRel: string,
): void {
  for (const row of rows) {
    if (excludeRepoRel && row.repo_rel_path === excludeRepoRel) continue;
    if (seen.has(row.repo_rel_path)) continue;
    seen.add(row.repo_rel_path);
    out.push(row);
  }
}

function parsePartHintsFromBasename(basename: string): PartHints {
  const base = basenamePosix(basename);
  const match = base.match(/([A-Za-z0-9]+)\.(\d{3})(?:[-.]|$)/);
  const partNumber = match?.[1] || "";
  const partVersion = match?.[2] || "";
  return {
    basename: base,
    part_number: partNumber,
    part_version: partVersion,
    part_key: partKey(partNumber, partVersion),
  };
}

function mergeHints(rawBasename: string, partNumber?: string, partVersion?: string): PartHints {
  const hints = parsePartHintsFromBasename(rawBasename);
  const pn = String(partNumber || "").trim() || hints.part_number;
  const pv = String(partVersion || "").trim() || hints.part_version;
  return {
    basename: hints.basename,
    part_number: pn,
    part_version: pv,
    part_key: partKey(pn, pv),
  };
}

export function partHintsFromXlinkPath(value: string): Record<string, string> {
  return parsePartHintsFromBasename(value);
}

export function getXlinkPrefs(workspaceRoot: string): XlinkFixPrefs {
  const root = workspaceRootOrEmpty(workspaceRoot);
  if (!workspaceOk(root)) return { ...DEFAULT_PREFS };
  return prefsFromRaw(loadWorkspaceSection<Record<string, any>>(root, "fc_linkfix", {}), root);
}

export function saveXlinkPrefs(workspaceRoot: string, patch: any = {}): XlinkFixPrefs {
  const root = workspaceRootOrEmpty(workspaceRoot);
  if (!workspaceOk(root)) return { ...DEFAULT_PREFS };
  const current = loadWorkspaceSection<Record<string, any>>(root, "fc_linkfix", {});
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "dry_run")) next.dry_run = Boolean(patch.dry_run);
  if (Object.prototype.hasOwnProperty.call(patch, "all_in_dir")) next.all_in_dir = Boolean(patch.all_in_dir);
  if (Object.prototype.hasOwnProperty.call(patch, "batch_dir")) {
    const stored = storeBatchDir(root, patch.batch_dir);
    if (stored == null) delete next.freecad_batch_dir;
    else next.freecad_batch_dir = stored;
  }
  next.cad_search_root = null;
  replaceWorkspaceSection(root, "fc_linkfix", next);
  return getXlinkPrefs(root);
}

export function listXlinkFixCandidates(workspaceRoot: string, opts: any = {}): any {
  const root = workspaceRootOrEmpty(workspaceRoot);
  const base = basenamePosix(typeof opts === "string" ? opts : opts?.basename);
  const hints = mergeHints(base, opts?.part_number, opts?.part_version);
  const out: XlinkFixCandidateFile[] = [];
  const seen = new Set<string>();
  const exclude = normRel(opts?.exclude_repo_rel || opts?.excludeRepoRel || "");
  const db = openDb(root);
  if (db) {
    try {
      if (hasXlinkTables(db)) {
        addUniqueCandidates(out, seen, queryCandidatesByPart(db, hints.part_number, hints.part_version), exclude);
        addUniqueCandidates(out, seen, queryCandidatesByBasename(db, base), exclude);
      }
    } finally {
      db.close();
    }
  }
  return {
    basename: base,
    part_number: hints.part_number,
    part_version: hints.part_version,
    part_key: hints.part_key,
    files: out,
    candidates: out,
    _native: "node",
  };
}

function preferredXlinkAttrForTarget(hostRepoRel: string, targetRepoRel: string): string {
  const host = stripDot(hostRepoRel);
  const target = stripDot(targetRepoRel);
  const hostDir = path.posix.dirname(host);
  if (!host || !target) return "";
  const fromDir = hostDir === "." ? "" : hostDir;
  const rel = path.posix.relative(fromDir, target);
  return rel || path.posix.basename(target);
}

function targetRelFromRow(row: XrefRow): string {
  const rel = row.asset_file_status === PRESENT && row.asset_repo_rel_path
    ? row.asset_repo_rel_path
    : row.target_repo_rel_path || "";
  return normRel(rel);
}

function repoFileExists(workspaceRoot: string, repoRel: string): boolean {
  try {
    return fs.statSync(resolveUnderWorkspace(workspaceRoot, repoRel)).isFile();
  } catch {
    return false;
  }
}

function xlinkAttrResolves(workspaceRoot: string, hostRepoRel: string, xlinkAttr: string): boolean {
  const attr = String(xlinkAttr || "").trim().replace(/\\/g, "/");
  if (!attr || !/\.fcstd$/i.test(attr)) return false;
  try {
    const hostPath = resolveUnderWorkspace(workspaceRoot, hostRepoRel);
    return fs.statSync(path.resolve(path.dirname(hostPath), attr)).isFile();
  } catch {
    return false;
  }
}

function lookupCandidateForRow(
  db: PnwDbAdapter,
  row: XrefRow,
  workspaceRoot: string,
): XlinkFixCandidateFile | null {
  const base = row.target_basename || basenamePosix(row.xlink_file_attr);
  const foldedBase = base.toLowerCase();
  const candidates = queryCandidatesByBasename(db, base)
    .filter((candidate) => candidate.repo_rel_path !== normRel(row.host_repo_rel_path))
    .filter((candidate) => candidate.filename.toLowerCase() === foldedBase)
    .filter((candidate) => repoFileExists(workspaceRoot, candidate.repo_rel_path));
  const hostDir = path.dirname(resolveUnderWorkspace(workspaceRoot, row.host_repo_rel_path));
  candidates.sort((left, right) => {
    const leftPath = resolveUnderWorkspace(workspaceRoot, left.repo_rel_path);
    const rightPath = resolveUnderWorkspace(workspaceRoot, right.repo_rel_path);
    const leftDistance = path.relative(hostDir, leftPath).length;
    const rightDistance = path.relative(hostDir, rightPath).length;
    return leftDistance - rightDistance || left.repo_rel_path.localeCompare(right.repo_rel_path);
  });
  return candidates[0] || null;
}

function standaloneXrefRow(hostRel: string, oldAttr: string): XrefRow {
  const hints = parsePartHintsFromBasename(oldAttr);
  return {
    id: 0,
    host_repo_rel_path: hostRel,
    xlink_file_attr: oldAttr,
    target_basename: hints.basename,
    target_file_asset_id: null,
    target_repo_rel_path: null,
    target_part_number: hints.part_number,
    target_part_version: hints.part_version,
    target_type_code: "",
    target_model_series: "",
    target_part_name: "",
    target_asset_label: "",
    resolve_status: "missing",
    asset_repo_rel_path: null,
    asset_filename: null,
    asset_part_number: null,
    asset_part_version: null,
    asset_file_status: null,
  };
}

function xlinkAttrsFromXml(xml: string): string[] {
  const attrs: string[] = [];
  const regex = /<XLink\b[^>]*\bfile="([^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) attrs.push(match[1]);
  return attrs;
}

function analyzeStandaloneDocumentXml(
  workspaceRoot: string,
  prefs: XlinkFixPrefs,
  batchDir: string,
  db: PnwDbAdapter,
): XlinkFixResult {
  const documentPath = path.join(batchDir, "Document.xml");
  if (!fs.existsSync(documentPath) || !fs.statSync(documentPath).isFile()) {
    throw new Error("Document.xml was not found; select its directory or enable all_in_dir");
  }
  const hostRel = normRel(path.relative(workspaceRoot, documentPath));
  const xml = fs.readFileSync(documentPath, "utf8");
  const rows: XlinkFixIssueRow[] = [];
  for (const oldAttr of xlinkAttrsFromXml(xml)) {
    if (!oldAttr || xlinkAttrResolves(workspaceRoot, hostRel, oldAttr)) continue;
    const sourceRow = standaloneXrefRow(hostRel, oldAttr);
    const candidate = lookupCandidateForRow(db, sourceRow, workspaceRoot);
    const targetRel = candidate?.repo_rel_path || "";
    if (!targetRel) {
      rows.push(makeIssueRow(workspaceRoot, sourceRow, "", "", "not_found"));
      continue;
    }
    const newPath = preferredXlinkAttrForTarget(hostRel, targetRel);
    if (!newPath || newPath === oldAttr.replace(/\\/g, "/")) continue;
    rows.push(makeIssueRow(workspaceRoot, sourceRow, targetRel, newPath, "fixable"));
  }

  const issueRows = groupIssueRows(rows);
  const stats = statsFromRows(1, issueRows);
  return {
    exit_code: 0,
    log: issueRows.length
      ? `Document.xml analysis found ${stats.fixable_count} fixable and ${stats.not_found_count} unresolved references.`
      : "Document.xml analysis found no broken references.",
    prefs,
    batch_dir_display: displayPath(batchDir, workspaceRoot),
    map_path_display: displayPath(dbPath(workspaceRoot), workspaceRoot),
    schema: 1,
    dry_run: true,
    total_changes: stats.total_changes,
    skipped: [],
    files: filesFromIssueRows(workspaceRoot, issueRows),
    issue_rows: issueRows,
    stats,
    index_pending: false,
    _native: "node",
  };
}

function listXlinkFixCandidatesFromDb(db: PnwDbAdapter, opts: any): any {
  const base = basenamePosix(opts?.basename);
  const hints = mergeHints(base, opts?.part_number, opts?.part_version);
  const out: XlinkFixCandidateFile[] = [];
  const seen = new Set<string>();
  const exclude = normRel(opts?.exclude_repo_rel || "");
  addUniqueCandidates(out, seen, queryCandidatesByPart(db, hints.part_number, hints.part_version), exclude);
  addUniqueCandidates(out, seen, queryCandidatesByBasename(db, base), exclude);
  return {
    basename: base,
    part_number: hints.part_number,
    part_version: hints.part_version,
    part_key: hints.part_key,
    files: out,
  };
}

function xrefRows(db: PnwDbAdapter): XrefRow[] {
  return db.all<XrefRow>(
    `SELECT
       x.id,
       x.host_repo_rel_path,
       x.xlink_file_attr,
       x.target_basename,
       x.target_file_asset_id,
       x.target_repo_rel_path,
       x.target_part_number,
       x.target_part_version,
       x.target_type_code,
       x.target_model_series,
       x.target_part_name,
       x.target_asset_label,
       x.resolve_status,
       a.repo_rel_path AS asset_repo_rel_path,
       a.filename AS asset_filename,
       a.part_number AS asset_part_number,
       a.part_version AS asset_part_version,
       a.file_status AS asset_file_status
     FROM phoenix_cad_bom_xref x
     LEFT JOIN phoenix_cad_file_asset a ON a.id = x.target_file_asset_id
     ORDER BY x.host_repo_rel_path, x.xlink_file_attr`,
  );
}

function relIsUnderDir(workspaceRoot: string, repoRel: string, batchDir: string): boolean {
  try {
    const abs = resolveUnderWorkspace(workspaceRoot, repoRel);
    const diff = path.relative(path.resolve(batchDir), abs);
    return !diff.startsWith("..") && !path.isAbsolute(diff);
  } catch {
    return false;
  }
}

function emptyResult(
  workspaceRoot: string,
  prefs: XlinkFixPrefs,
  batchDir: string,
  message: string,
  indexPending = false,
): XlinkFixResult {
  const stats = {
    host_count: 0,
    hosts_with_issues: 0,
    issue_count: 0,
    fixable_count: 0,
    not_found_count: 0,
    skipped_count: 0,
    total_changes: 0,
  };
  return {
    exit_code: 0,
    log: message,
    prefs,
    batch_dir_display: workspaceRoot ? displayPath(batchDir, workspaceRoot) : ".",
    map_path_display: workspaceRoot ? displayPath(dbPath(workspaceRoot), workspaceRoot) : "",
    schema: 1,
    dry_run: prefs.dry_run,
    total_changes: 0,
    skipped: [],
    files: [],
    issue_rows: [],
    stats,
    index_pending: indexPending,
    _native: "node",
  };
}

function issueHints(row: XrefRow): PartHints {
  const hints = parsePartHintsFromBasename(row.target_basename || row.xlink_file_attr);
  const pn = row.target_part_number || row.asset_part_number || hints.part_number;
  const pv = row.target_part_version || row.asset_part_version || hints.part_version;
  return {
    basename: hints.basename,
    part_number: pn,
    part_version: pv,
    part_key: partKey(pn, pv),
  };
}

function targetDisplay(workspaceRoot: string, repoRel: string): string {
  if (!repoRel) return "";
  return displayPath(resolveUnderWorkspace(workspaceRoot, repoRel), workspaceRoot);
}

function makeIssueRow(
  workspaceRoot: string,
  row: XrefRow,
  targetRel: string,
  newPath: string,
  status: "fixable" | "not_found",
): XlinkFixIssueRow {
  const hostRel = normRel(row.host_repo_rel_path);
  const hints = issueHints(row);
  const oldPath = String(row.xlink_file_attr || "");
  return {
    host_repo_rel: hostRel,
    host_filename: basenamePosix(hostRel),
    host_display: hostRel,
    old_path: oldPath,
    new_path: newPath,
    target_file: targetRel,
    target_display: targetRel ? targetDisplay(workspaceRoot, targetRel) : "",
    verdict: status === "not_found" ? "not found" : "fixable",
    note: status === "not_found"
      ? `No present FCStd candidate found for ${hints.basename || basenamePosix(oldPath)}`
      : targetRel ? `Target ${targetRel}` : "",
    count: 1,
    status,
    basename: hints.basename,
    part_number: hints.part_number,
    part_version: hints.part_version,
    part_key: hints.part_key,
  };
}

function groupIssueRows(rows: XlinkFixIssueRow[]): XlinkFixIssueRow[] {
  const grouped = new Map<string, XlinkFixIssueRow>();
  for (const row of rows) {
    const key = [
      row.host_repo_rel,
      row.old_path,
      row.new_path,
      row.target_file,
      row.status,
      row.verdict,
    ].join("\0");
    const existing = grouped.get(key);
    if (existing) {
      existing.count += row.count || 1;
    } else {
      grouped.set(key, { ...row });
    }
  }
  return [...grouped.values()];
}

function filesFromIssueRows(workspaceRoot: string, rows: XlinkFixIssueRow[]): XlinkFixResult["files"] {
  const byHost = new Map<string, XlinkFixResult["files"][number]>();
  for (const row of rows) {
    let file = byHost.get(row.host_repo_rel);
    if (!file) {
      file = {
        path: resolveUnderWorkspace(workspaceRoot, row.host_repo_rel),
        host_repo_rel: row.host_repo_rel,
        changes: 0,
        records: [],
      };
      byHost.set(row.host_repo_rel, file);
    }
    if (row.status === "fixable") file.changes += row.count || 1;
    file.records.push({
      old_path: row.old_path,
      new_path: row.new_path,
      target_file: row.target_file,
      verdict: row.verdict,
      note: row.note,
      count: row.count || 1,
    });
  }
  return [...byHost.values()];
}

function statsFromRows(hostCount: number, rows: XlinkFixIssueRow[]): XlinkFixResult["stats"] {
  const hosts = new Set(rows.map((row) => row.host_repo_rel));
  const fixable = rows
    .filter((row) => row.status === "fixable")
    .reduce((sum, row) => sum + (row.count || 1), 0);
  const notFound = rows
    .filter((row) => row.status === "not_found")
    .reduce((sum, row) => sum + (row.count || 1), 0);
  return {
    host_count: hostCount,
    hosts_with_issues: hosts.size,
    issue_count: rows.length,
    fixable_count: fixable,
    not_found_count: notFound,
    skipped_count: 0,
    total_changes: fixable,
  };
}

function applyOptionPatch(workspaceRoot: string, opts: any, dryRun: boolean): XlinkFixPrefs {
  const patch: any = { dry_run: dryRun };
  if (Object.prototype.hasOwnProperty.call(opts || {}, "batch_dir")) patch.batch_dir = opts.batch_dir;
  if (Object.prototype.hasOwnProperty.call(opts || {}, "all_in_dir")) patch.all_in_dir = opts.all_in_dir;
  return saveXlinkPrefs(workspaceRoot, patch);
}

export function analyzeXlinkFix(workspaceRoot: string, opts: any = {}): XlinkFixResult {
  const root = workspaceRootOrEmpty(workspaceRoot);
  if (!workspaceOk(root)) {
    return emptyResult("", { ...DEFAULT_PREFS }, ".", "workspace is not configured", true);
  }

  const prefs = applyOptionPatch(root, opts, true);
  const batchDir = resolveBatchDir(root, opts?.batch_dir);
  if (!fs.existsSync(batchDir) || !fs.statSync(batchDir).isDirectory()) {
    throw new Error(`XLink batch directory does not exist: ${displayPath(batchDir, root)}`);
  }
  const db = openDb(root);
  if (!db) {
    return emptyResult(root, prefs, batchDir, "CAD BOM xref index is not available; run FCStd map scan first.", true);
  }

  try {
    if (!prefs.all_in_dir) {
      if (!hasFileAssetTable(db)) {
        return emptyResult(root, prefs, batchDir, "CAD file index is not available; run FCStd map scan first.", true);
      }
      return analyzeStandaloneDocumentXml(root, prefs, batchDir, db);
    }
    if (!hasXlinkTables(db)) {
      return emptyResult(root, prefs, batchDir, "CAD BOM xref tables are not available; run FCStd map scan first.", true);
    }
    if (!xlinkIndexReady(db)) {
      return emptyResult(root, prefs, batchDir, "CAD BOM xref index has not been scanned; run FCStd map scan first.", true);
    }
    const seenHosts = new Set<string>();
    const rawRows: XlinkFixIssueRow[] = [];
    for (const row of xrefRows(db)) {
      const hostRel = normRel(row.host_repo_rel_path);
      if (!hostRel || !relIsUnderDir(root, hostRel, batchDir)) continue;
      seenHosts.add(hostRel);
      const oldAttr = String(row.xlink_file_attr || "");
      if (!oldAttr) continue;
      if (xlinkAttrResolves(root, hostRel, oldAttr)) continue;
      let targetRel = targetRelFromRow(row);
      if (targetRel && !repoFileExists(root, targetRel)) targetRel = "";
      let candidate: XlinkFixCandidateFile | null = null;
      if (!targetRel) {
        candidate = lookupCandidateForRow(db, row, root);
        targetRel = candidate?.repo_rel_path || "";
      }
      if (!targetRel) {
        rawRows.push(makeIssueRow(root, row, "", "", "not_found"));
        continue;
      }
      const newPath = preferredXlinkAttrForTarget(hostRel, targetRel);
      if (!newPath || newPath === oldAttr.replace(/\\/g, "/")) continue;
      rawRows.push(makeIssueRow(root, row, targetRel, newPath, "fixable"));
    }

    const issueRows = groupIssueRows(rawRows);
    const stats = statsFromRows(seenHosts.size, issueRows);
    const files = filesFromIssueRows(root, issueRows);
    return {
      exit_code: 0,
      log: issueRows.length
        ? `XLink analysis found ${stats.fixable_count} fixable and ${stats.not_found_count} unresolved references.`
        : "XLink analysis found no broken references in the selected scope.",
      prefs,
      batch_dir_display: displayPath(batchDir, root),
      map_path_display: displayPath(dbPath(root), root),
      schema: 1,
      dry_run: true,
      total_changes: stats.total_changes,
      skipped: [],
      files,
      issue_rows: issueRows,
      stats,
      index_pending: false,
      _native: "node",
    };
  } finally {
    db.close();
  }
}

function patchFcstdDocument(hostPath: string, replacements: Map<string, string>): number {
  return patchFcstdXlinkAttributes(
    hostPath,
    Object.fromEntries(replacements),
  ).count;
}

function patchStandaloneDocumentXml(documentPath: string, replacements: Map<string, string>): number {
  const original = fs.readFileSync(documentPath, "utf8");
  let count = 0;
  const patched = original.replace(
    /(<XLink\b[^>]*\bfile=")([^"]*)(")/gi,
    (whole, prefix: string, oldAttr: string, suffix: string) => {
      const replacement = replacements.get(oldAttr);
      if (replacement == null) return whole;
      count += 1;
      return `${prefix}${replacement}${suffix}`;
    },
  );
  if (!count) return 0;

  const token = `${process.pid}-${Date.now()}`;
  const dir = path.dirname(documentPath);
  const base = path.basename(documentPath);
  const temp = path.join(dir, `.${base}.phoenix-${token}.tmp`);
  const backup = path.join(dir, `.${base}.phoenix-${token}.backup`);
  fs.writeFileSync(temp, patched, "utf8");
  try {
    fs.renameSync(documentPath, backup);
    try {
      fs.renameSync(temp, documentPath);
    } catch (error) {
      fs.renameSync(backup, documentPath);
      throw error;
    }
    fs.rmSync(backup, { force: true });
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return count;
}

function isStandaloneDocumentXml(hostPath: string): boolean {
  return path.basename(hostPath).toLowerCase() === "document.xml";
}

function patchXlinkHost(hostPath: string, replacements: Map<string, string>): number {
  return isStandaloneDocumentXml(hostPath)
    ? patchStandaloneDocumentXml(hostPath, replacements)
    : patchFcstdDocument(hostPath, replacements);
}

function targetAssetForRel(db: PnwDbAdapter, repoRel: string): any | null {
  return db.get<any>(
    `SELECT id, repo_rel_path, filename, part_number, part_version, type_code,
            model_series, part_name, label, file_status
     FROM phoenix_cad_file_asset
     WHERE repo_rel_path = ?
     LIMIT 1`,
    [normRel(repoRel)],
  ) || null;
}

function updateXrefAfterPatch(db: PnwDbAdapter, hostRel: string, oldAttr: string, newAttr: string, targetRel: string): void {
  const asset = targetAssetForRel(db, targetRel);
  db.run(
    `UPDATE phoenix_cad_bom_xref
     SET xlink_file_attr = ?,
         target_file_asset_id = ?,
         target_repo_rel_path = ?,
         target_basename = ?,
         target_part_number = ?,
         target_part_version = ?,
         target_type_code = ?,
         target_model_series = ?,
         target_part_name = ?,
         target_asset_label = ?,
         resolve_status = 'resolved'
     WHERE host_repo_rel_path = ?
       AND xlink_file_attr = ?`,
    [
      newAttr,
      asset?.id || null,
      normRel(targetRel),
      basenamePosix(targetRel),
      String(asset?.part_number || ""),
      String(asset?.part_version || ""),
      String(asset?.type_code || ""),
      String(asset?.model_series || ""),
      String(asset?.part_name || ""),
      String(asset?.label || ""),
      normRel(hostRel),
      oldAttr,
    ],
  );
}

export function runXlinkFix(workspaceRoot: string, opts: any = {}): XlinkFixResult {
  const root = workspaceRootOrEmpty(workspaceRoot);
  if (!workspaceOk(root)) {
    return emptyResult("", { ...DEFAULT_PREFS }, ".", "workspace is not configured", true);
  }
  const requestedDryRun = opts?.dry_run == null ? getXlinkPrefs(root).dry_run : Boolean(opts.dry_run);
  if (requestedDryRun) return analyzeXlinkFix(root, opts);

  const analysis = analyzeXlinkFix(root, opts);
  const appliedPrefs = saveXlinkPrefs(root, { ...opts, dry_run: false });
  const fixable = analysis.issue_rows.filter((row) => row.status === "fixable" && row.new_path);
  if (!fixable.length) {
    return {
      ...analysis,
      prefs: appliedPrefs,
      dry_run: false,
      log: `${analysis.log}\nNo fixable XLink paths to write.`,
    };
  }

  const byHost = new Map<string, Map<string, string>>();
  for (const row of fixable) {
    if (!byHost.has(row.host_repo_rel)) byHost.set(row.host_repo_rel, new Map());
    byHost.get(row.host_repo_rel)!.set(row.old_path, row.new_path);
  }

  let total = 0;
  const touchedHosts: string[] = [];
  const touchedFcstdHosts: string[] = [];
  const logs: string[] = [];
  for (const [hostRel, replacements] of byHost) {
    const hostPath = resolveUnderWorkspace(root, hostRel);
    if (!fs.existsSync(hostPath)) throw new Error(`Host file does not exist: ${displayPath(hostPath, root)}`);
    const count = patchXlinkHost(hostPath, replacements);
    total += count;
    touchedHosts.push(hostRel);
    if (!isStandaloneDocumentXml(hostPath)) touchedFcstdHosts.push(hostRel);
    logs.push(`${hostRel}: ${count} patch(es)`);
  }

  const db = openDb(root);
  if (db) {
    try {
      if (hasXlinkTables(db)) {
        for (const row of fixable.filter((item) => !isStandaloneDocumentXml(resolveUnderWorkspace(root, item.host_repo_rel)))) {
          updateXrefAfterPatch(db, row.host_repo_rel, row.old_path, row.new_path, row.target_file);
        }
      }
    } finally {
      db.close();
    }
  }
  const refresh = touchedFcstdHosts.length ? refreshBomXrefsForHosts(root, touchedFcstdHosts) : undefined;
  const stats = { ...analysis.stats, total_changes: total };
  return {
    ...analysis,
    prefs: appliedPrefs,
    dry_run: false,
    total_changes: total,
    stats,
    log: [...analysis.log.split(/\r?\n/).filter(Boolean), ...logs].join("\n"),
    ...(refresh ? { bom_xref_refresh: refresh } : {}),
  };
}

export function applyXlinkFixOverride(workspaceRoot: string, opts: any = {}): any {
  const root = workspaceRootOrEmpty(workspaceRoot);
  if (!workspaceOk(root)) {
    return {
      patches: 0,
      applied: 0,
      new_path: "",
      host_repo_rel: "",
      old_path: "",
      target_repo_rel: "",
      target_display: "",
      unchanged: true,
      _native: "node",
    };
  }
  const hostRel = normRel(opts?.host_repo_rel || opts?.hostRepoRel || "");
  const targetRel = normRel(opts?.target_repo_rel || opts?.targetRepoRel || "");
  const oldAttr = String(opts?.old_path || opts?.oldPath || "").trim();
  if (!hostRel) throw new Error("host_repo_rel is required");
  if (!targetRel) throw new Error("target_repo_rel is required");
  if (!oldAttr) throw new Error("old_path is required");
  const hostPath = resolveUnderWorkspace(root, hostRel);
  const targetPath = resolveUnderWorkspace(root, targetRel);
  if (!fs.existsSync(hostPath)) throw new Error(`Host file does not exist: ${displayPath(hostPath, root)}`);
  if (!fs.existsSync(targetPath)) throw new Error(`Target file does not exist: ${displayPath(targetPath, root)}`);

  const newAttr = preferredXlinkAttrForTarget(hostRel, targetRel);
  if (newAttr === oldAttr.replace(/\\/g, "/")) {
    return {
      patches: 0,
      applied: 0,
      new_path: newAttr,
      host_repo_rel: hostRel,
      old_path: oldAttr,
      target_repo_rel: targetRel,
      target_display: displayPath(targetPath, root),
      unchanged: true,
      _native: "node",
    };
  }

  const standalone = isStandaloneDocumentXml(hostPath);
  const patches = patchXlinkHost(hostPath, new Map([[oldAttr, newAttr]]));
  if (patches < 1) throw new Error(`No XLink file attribute matched: ${oldAttr}`);
  const db = openDb(root);
  if (db) {
    try {
      if (!standalone && hasXlinkTables(db)) updateXrefAfterPatch(db, hostRel, oldAttr, newAttr, targetRel);
    } finally {
      db.close();
    }
  }
  const refresh = standalone ? undefined : refreshBomXrefsForHosts(root, [hostRel]);
  return {
    patches,
    applied: patches,
    new_path: newAttr,
    host_repo_rel: hostRel,
    old_path: oldAttr,
    target_repo_rel: targetRel,
    target_display: displayPath(targetPath, root),
    unchanged: false,
    ...(refresh ? { bom_xref_refresh: refresh } : {}),
    _native: "node",
  };
}
