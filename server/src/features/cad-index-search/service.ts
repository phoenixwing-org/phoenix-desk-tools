import fs from "node:fs";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { inspectCadIndexFromDatabase, missingCadIndexDiagnostics, type CadIndexDiagnostics } from "../../lib/cadIndexStatusService.js";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import { cadPathExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import { openCadSqliteReadDatabase } from "../../lib/cadSqliteReadLease.js";

export const CAD_INDEX_SEARCH_LIMIT = 200;
export type CadIndexSearchRow = {
  repo_rel_path: string;
  filename: string;
  asset_kind: string | null;
  part_number: string | null;
  part_version: string | null;
  part_name: string | null;
  label: string | null;
};
export type CadIndexSearchResult = {
  source: "sqlite";
  query: string;
  rows: CadIndexSearchRow[];
  limit: number;
  limitReached: boolean;
  diagnostics: CadIndexDiagnostics;
};
export class CadIndexSearchError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_workspace" | "index_missing" | "schema_incompatible" | "index_unreadable" | "unsafe_index_path",
    readonly status: 400 | 409 | 503,
    readonly diagnostics?: CadIndexDiagnostics,
  ) { super(message); }
}

/** Legacy ./ prefixes are accepted, but indexed data must never become an escaping navigation path. */
export function normalizeIndexedCadPath(value: string): string {
  let rel = String(value).replace(/\\/g, "/");
  while (rel.startsWith("./")) rel = rel.slice(2);
  if (!rel || rel.includes("\0") || /^[a-z]:/i.test(rel) || path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)
      || rel.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    throw new CadIndexSearchError("索引包含不安全的文件路径，无法打开；请核对索引后手动更新。", "unsafe_index_path", 409);
  }
  return rel;
}

function validateWorkspace(workspace: string): string {
  if (!workspace?.trim()) throw new CadIndexSearchError("请先打开工作空间。", "invalid_workspace", 400);
  const root = path.resolve(workspace);
  try { if (fs.statSync(root).isDirectory()) return fs.realpathSync(root); }
  catch { /* Return a stable, non-path-bearing error. */ }
  throw new CadIndexSearchError("工作空间不存在或不可访问。", "invalid_workspace", 400);
}

function assertDatabaseBoundary(root: string, filename: string): void {
  for (const entry of [path.dirname(filename), filename]) {
    if (fs.existsSync(entry) && fs.lstatSync(entry).isSymbolicLink()) {
      throw new CadIndexSearchError("索引数据库目录或文件为符号链接，拒绝读取。", "index_unreadable", 503);
    }
  }
  if (fs.existsSync(filename)) {
    const rel = path.relative(root, fs.realpathSync(filename));
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new CadIndexSearchError("索引数据库不在当前工作空间内，拒绝读取。", "index_unreadable", 503);
    }
  }
}

/** One bounded parameterized asset query. No DDL, journal conversion, scan, model reads or memory fallback. */
export function searchCadIndex(workspace: string, searchText = ""): CadIndexSearchResult {
  const root = validateWorkspace(workspace), filename = phoenixDatabasePath(root);
  assertDatabaseBoundary(root, filename);
  let diagnostics = missingCadIndexDiagnostics();
  if (!fs.existsSync(filename)) {
    throw new CadIndexSearchError("尚无 CAD 索引；没有可用扫描缓存可供回退，请点击「更新索引」。", "index_missing", 409, diagnostics);
  }
  const query = String(searchText).trim().toLocaleLowerCase("en-US");
  const where = query ? ` AND (lower(repo_rel_path) LIKE ? OR lower(filename) LIKE ? OR
    lower(COALESCE(part_number,'')) LIKE ? OR lower(COALESCE(part_version,'')) LIKE ? OR
    lower(COALESCE(part_name,'')) LIKE ? OR lower(COALESCE(label,'')) LIKE ?)` : "";
  const params: SQLInputValue[] = query ? Array(6).fill(`%${query}%`) : [];
  let db: ReturnType<typeof openCadSqliteReadDatabase> | undefined;
  try {
    // One host lease and native transaction cover diagnostics AND search rows.
    // readOnly refuses a vanished file instead of silently recreating it.
    assertDatabaseBoundary(root, filename);
    db = openCadSqliteReadDatabase(filename);
    diagnostics = inspectCadIndexFromDatabase(db);
    if (diagnostics.state === "incompatible") {
      throw new CadIndexSearchError("CAD 索引 Schema 不兼容。搜索不会创建、升级或清理数据库；请先备份并核对索引诊断。", "schema_incompatible", 409, diagnostics);
    }
    if (diagnostics.state === "unreadable") {
      throw new CadIndexSearchError(`CAD 索引读取失败；没有可用扫描缓存可供回退。${diagnostics.message}`, "index_unreadable", 503, diagnostics);
    }
    // A connection-local pure predicate filters old polluted indexes before
    // LIMIT, without DDL or dropping the bounded, ordered result query.
    db.function("desk_cad_in_scope", { deterministic: true }, value => typeof value === "string" && !cadPathExcludedFromDiscovery(value) ? 1 : 0);
    // Keep the golden query's indexed-path ordering and SQLite LIKE %/_ semantics.
    const rows = db.prepare(`SELECT repo_rel_path,filename,asset_kind,part_number,part_version,part_name,label
      FROM phoenix_cad_file_asset WHERE file_status='present' AND desk_cad_in_scope(repo_rel_path)=1${where} ORDER BY repo_rel_path LIMIT ${CAD_INDEX_SEARCH_LIMIT}`)
      .all(...params) as CadIndexSearchRow[];
    const normalized = rows.map(row => ({ ...row, repo_rel_path: normalizeIndexedCadPath(row.repo_rel_path) }));
    return { source: "sqlite", query, rows: normalized, limit: CAD_INDEX_SEARCH_LIMIT,
      limitReached: rows.length === CAD_INDEX_SEARCH_LIMIT, diagnostics };
  } catch (error) {
    if (error instanceof CadIndexSearchError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const safeDetail = detail.split(root).join("[工作空间]");
    diagnostics = { ...diagnostics, state: "unreadable", message: `索引读取失败：${safeDetail}` };
    throw new CadIndexSearchError(`CAD 索引${db ? "查询" : "读取"}失败：${safeDetail}。请刷新诊断并核对索引；未扫描磁盘或修改数据库。`, "index_unreadable", 503, diagnostics);
  } finally { db?.close(); }
}
