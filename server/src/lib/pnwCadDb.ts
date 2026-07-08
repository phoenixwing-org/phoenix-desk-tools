/** 对应 Python cad_index/common.py */
export const GRAPH_TARGET_STATUSES = Object.freeze(["resolved", "ambiguous", "self"]);

export function normXrefPath(p: string | null): string | null {
  if (!p) return null;
  return p.replace(/\\/g, "/").trim();
}

// ── fcstd_mapping.py 命名约定 ──────────────────────────

/** 对应 Python normalize_repo_rel_path_for_map */
export function normalizeRepoRel(rel: string): string {
  const s = rel.replace(/\\/g, "/").trim();
  if (!s || s.startsWith("/") || s.startsWith("..")) return s;
  if (s.startsWith("./")) return s;
  return `./${s}`;
}

/** 对应 Python infer_part_key_from_filename */
export function inferPartKeyFromFilename(filename: string): { part_number: string; part_version: string; } | null {
  const m = filename.match(/^(\d{6})\.(\d{3})/);
  return m ? { part_number: m[1], part_version: m[2] } : null;
}

/** 对应 Python compose_fcstd_body_label_display */
export function composeLabel(pn: string, pv: string, pname: string, fallback: string): string | null {
  const a = (pn || "").trim(), b = (pv || "").trim();
  const n = (pname || fallback || "").trim();
  if (!a || !b) return null;
  return `${a}.${b}-${n}`;
}

/** pnwCadDb — Phoenix Wing CAD 数据库查询适配层
 *
 * 封装 fcstd-query Rust CLI 的调用，提供类型安全的查询接口。
 * 未来可拆到 phoenix-wing/db/pnwCadDb.ts。
 *
 * 架构：
 *   pnwCadDb (TS) → execFile → fcstd-query (Rust/rusqlite) → SQLite → JSON
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUERY_CLI = path.resolve(__dirname, "../../fcstd-query/target/release/fcstd-query");

// ── 路径 ──────────────────────────────────────────────

export function pnwCadDbPath(workspace: string): string {
  return path.join(workspace, ".phoenix", "phoenix-workspace.sqlite");
}

// ── 查询接口 ──────────────────────────────────────────

export interface PnwPartRow {
  part_number: string; part_version: string;
  part_name: string | null; type_code: string | null;
  model_series: string | null; file_count: number | null;
}

export interface PnwFcstdEntry {
  repo_rel_path: string; filename: string;
  asset_kind: string | null; part_number: string | null;
  part_version: string | null; part_name: string | null;
  label: string | null; file_status: string | null;
}

export interface PnwBomHost {
  host_rel: string; host_filename: string;
  direct_children: number; total_descendants: number;
  incoming_count: number; issues_count: number;
}

/** 查询零件号列表 */
export async function pnwQueryParts(
  workspace: string, opts?: { search?: string; limit?: number },
): Promise<PnwPartRow[]> {
  const db = pnwCadDbPath(workspace);
  const args = ["parts", db, "--limit", String(opts?.limit ?? 100)];
  if (opts?.search) args.push("--search", opts.search);
  const data = await pnwExec(args);
  return data.items ?? [];
}

/** 查询 CAD 索引条目 */
export async function pnwQueryFcstdMap(
  workspace: string,
  opts?: { search?: string; kind?: string; offset?: number; limit?: number },
): Promise<PnwFcstdEntry[]> {
  const db = pnwCadDbPath(workspace);
  const args = ["fcstd-map", db, "--limit", String(opts?.limit ?? 100), "--offset", String(opts?.offset ?? 0)];
  if (opts?.search) args.push("--search", opts.search);
  if (opts?.kind) args.push("--kind", opts.kind);
  const data = await pnwExec(args);
  return data.items ?? [];
}

/** 查询 BOM xref 装配列表 */
export async function pnwQueryBomHosts(workspace: string): Promise<PnwBomHost[]> {
  const db = pnwCadDbPath(workspace);
  const data = await pnwExec(["bom-xref-meta", db]);
  return data.items ?? [];
}

export interface PnwXrefRow {
  host_repo_rel_path?: string; host_filename?: string;
  target_repo_rel_path?: string; target_filename?: string;
  link_label: string | null; ref_kind?: string | null;
  target_part_number?: string | null;
}

export interface PnwXrefCounts { incoming: number; outgoing: number; flat_lines: number; }

/** 查询谁引用了这个文件 */
export async function pnwQueryXrefIncoming(workspace: string, rel: string): Promise<PnwXrefRow[]> {
  const data = await pnwExec(["bom-xref-incoming", pnwCadDbPath(workspace), "--rel", rel]);
  return data.items ?? [];
}

/** 查询这个文件引用了谁 */
export async function pnwQueryXrefOutgoing(workspace: string, rel: string): Promise<PnwXrefRow[]> {
  const data = await pnwExec(["bom-xref-outgoing", pnwCadDbPath(workspace), "--rel", rel]);
  return data.items ?? [];
}

/** 引用计数 */
export async function pnwQueryXrefCounts(workspace: string, rel: string): Promise<PnwXrefCounts> {
  return pnwExec(["bom-xref-counts", pnwCadDbPath(workspace), "--rel", rel]);
}

export interface PnwBomTreeNode { depth: number; part_rel: string; part_key: string; quantity: number; bom_path: string; }

/** 查询 BOM 展开树 */
export async function pnwQueryBomTree(workspace: string, rel: string): Promise<PnwBomTreeNode[]> {
  const data = await pnwExec(["bom-tree", pnwCadDbPath(workspace), "--rel", rel]);
  return data.items ?? [];
}

export interface PnwScanRecord { scan_id: string; started_at: string; finished_at: string | null; status: string; file_count: number; }

export async function pnwQueryScanRecent(workspace: string, limit = 10): Promise<PnwScanRecord[]> {
  const data = await pnwExec(["scan-recent", pnwCadDbPath(workspace), "--limit", String(limit)]);
  return data.items ?? [];
}

/** 按路径查询单个文件资产 */
export async function pnwQueryBomFile(
  workspace: string, rel: string,
): Promise<PnwFcstdEntry | null> {
  const db = pnwCadDbPath(workspace);
  const data = await pnwExec(["bom-file", db, "--rel", rel]);
  return data && data.repo_rel_path ? data : null;
}

// ── 底层 ──────────────────────────────────────────────

function pnwExec(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(QUERY_CLI, args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(stderr || err.message)); return; }
      try { resolve(JSON.parse(stdout)); }
      catch (e: any) { reject(new Error(`pnwCadDb JSON parse: ${e.message}`)); }
    });
  });
}
