import fs from "node:fs";
import path from "node:path";
import {
  pnwCadXlinkRuleLabel,
  pnwExtractXlinksFromDocumentXml,
  pnwResolveXlinkTarget,
  type PnwCadXlinkRef,
  type PnwCadResolvedXlinkTarget,
} from "@phoenix-wing/cad-core";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import { randomUUID } from "node:crypto";
import { analyzeCadIndexDocumentXmlWithInstances } from "./cadIndexLinkInstances.js";
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive } from "./fcstdBatchFiles.js";

const GRAPH_TARGET_STATUSES = new Set(["resolved", "self"]);

type AssetRow = {
  id: number;
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
};

type XlinkRef = PnwCadXlinkRef;

type ResolvedTarget = PnwCadResolvedXlinkTarget;

type XrefEdge = {
  host_file_asset_id: number;
  host_repo_rel_path: string;
  xlink_file_attr: string;
  link_label: string;
  rule_label: string;
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
  detail_json: string | null;
};

type IndexContext = {
  ws: string;
  scanId: number;
  assets: AssetRow[];
  assetsByRel: Map<string, AssetRow>;
  basenameMap: Map<string, string[]>;
  snapshots: Map<string, fs.Stats>;
};

export type BomXrefIndexOptions = {
  recursive?: boolean;
  maxHosts?: number;
  isCancelled?: () => boolean;
  onProgress?: (phase: "walk" | "xref", current: number, total: number, currentFile?: string) => void;
};

function dbPath(ws: string): string {
  return path.join(ws, ".phoenix", "phoenix-workspace.sqlite");
}

function assertIndexPath(ws: string): void {
  const filename = dbPath(ws);
  if (fs.lstatSync(path.dirname(filename)).isSymbolicLink() || fs.lstatSync(filename).isSymbolicLink()
    || fs.realpathSync(filename) !== path.join(fcstdWorkspace(ws), ".phoenix", "phoenix-workspace.sqlite")) throw new Error("CAD index database path is unsafe");
}

function utcNowIso(): string {
  return new Date().toISOString();
}

function workspaceOk(ws: string): boolean {
  try {
    return Boolean(ws) && fs.statSync(ws).isDirectory();
  } catch {
    return false;
  }
}

function normKey(rel: string): string {
  const value = String(rel || "").replace(/\\/g, "/").trim().replace(/^\.\//, "");
  return value ? `./${value}` : "";
}

function basenameOf(value: string): string {
  return path.posix.basename(String(value || "").replace(/\\/g, "/"));
}

function isFcstd(value: string): boolean {
  return basenameOf(value).toLowerCase().endsWith(".fcstd");
}

function tableExists(db: PnwDbAdapter, name: string): boolean {
  return Boolean(db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
}

function ensureXrefSchema(db: PnwDbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS phoenix_cad_bom_xref (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL,
      host_file_asset_id INTEGER NOT NULL,
      host_repo_rel_path TEXT NOT NULL,
      ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
      locator TEXT NOT NULL DEFAULT 'Document.xml',
      xlink_file_attr TEXT NOT NULL,
      link_label TEXT NOT NULL DEFAULT '',
      rule_label TEXT NOT NULL DEFAULT '',
      target_basename TEXT NOT NULL,
      target_file_asset_id INTEGER,
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
    CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_host_path
      ON phoenix_cad_bom_xref(host_repo_rel_path);
    CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_asset
      ON phoenix_cad_bom_xref(target_file_asset_id);
    CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_basename
      ON phoenix_cad_bom_xref(target_basename);
    CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_path
      ON phoenix_cad_bom_xref(target_repo_rel_path);
  `);

}

function latestScanId(db: PnwDbAdapter): number | null {
  const existing = db.get<{ id: number }>("SELECT id FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1");
  return existing ? Number(existing.id) : null;
}

function loadContext(ws: string): IndexContext | null {
  if (!workspaceOk(ws) || !fs.existsSync(dbPath(ws))) return null;
  const root = fcstdWorkspace(ws);
  const filename = dbPath(root);
  assertIndexPath(root);
  const db = pnwCreateDb(filename);
  try {
    if (!tableExists(db, "phoenix_cad_file_asset") || !tableExists(db, "phoenix_cad_scan")) return null;
    const scanId = latestScanId(db);
    if (scanId == null) return null;
    ensureXrefSchema(db);
    const assets = db.all<AssetRow>(
      `SELECT id, repo_rel_path, filename, asset_kind, part_number, part_version,
              type_code, model_series, part_name, label, file_status
       FROM phoenix_cad_file_asset
       WHERE COALESCE(file_status, 'present') = 'present'
         AND LOWER(filename) LIKE '%.fcstd'
       ORDER BY repo_rel_path`,
    ).map((asset) => ({
      ...asset,
      id: Number(asset.id),
      repo_rel_path: normKey(asset.repo_rel_path),
      filename: String(asset.filename || basenameOf(asset.repo_rel_path)),
    }));
    const assetsByRel = new Map(assets.map((asset) => [asset.repo_rel_path, asset]));
    const basenameMap = new Map<string, string[]>();
    for (const asset of assets) {
      const key = asset.filename.toLowerCase();
      const paths = basenameMap.get(key) || [];
      paths.push(asset.repo_rel_path);
      basenameMap.set(key, paths);
    }
    return { ws: root, scanId, assets, assetsByRel, basenameMap, snapshots: new Map() };
  } finally {
    db.close();
  }
}

function absForRel(ws: string, rel: string): string | null {
  const root = fcstdWorkspace(ws);
  const abs = path.resolve(root, normKey(rel).replace(/^\.\//, ""));
  const diff = path.relative(root, abs);
  if (diff === "" || (!diff.startsWith("..") && !path.isAbsolute(diff))) {
    try { return safeFcstdPath(root, diff || "."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  return null;
}

function relForAbs(ws: string, abs: string): string | null {
  const root = path.resolve(ws);
  const diff = path.relative(root, path.resolve(abs));
  if (!diff || diff.startsWith("..") || path.isAbsolute(diff)) return null;
  return normKey(diff);
}

export const extractXlinksFromDocumentXml = pnwExtractXlinksFromDocumentXml;

function readFcstdIndexAnalysis(filePath: string) {
  const { xml } = readFcstdBatchArchive(filePath);
  return analyzeCadIndexDocumentXmlWithInstances(xml);
}

export function readFcstdXlinks(filePath: string): XlinkRef[] {
  return readFcstdIndexAnalysis(filePath).xlinks;
}

async function readFcstdIndexAnalysisAsync(filePath: string, validate: () => string = () => filePath) {
  // Yield between hosts while reusing the one bounded ZIP reader.
  await new Promise<void>(resolve => setImmediate(resolve));
  const analysis = readFcstdIndexAnalysis(validate());
  validate();
  return analysis;
}

async function readFcstdXlinksAsync(filePath: string, validate: () => string = () => filePath): Promise<XlinkRef[]> {
  return (await readFcstdIndexAnalysisAsync(filePath, validate)).xlinks;
}

function resolveTarget(ctx: IndexContext, hostRel: string, attr: string): ResolvedTarget {
  const normalizedAttr = String(attr || "").replace(/\\/g, "/").trim();
  const basename = basenameOf(normalizedAttr);
  const candidates = ctx.basenameMap.get(basename.toLowerCase()) || [];
  const hostAbs = absForRel(ctx.ws, hostRel);
  const hostDir = hostAbs ? path.dirname(hostAbs) : ctx.ws;
  let directTargetRel: string | null = null;
  const stripped = normalizedAttr.replace(/^(\.\/)+/, "");
  const directAttrs = stripped.includes("/") ? [normalizedAttr] : [];
  if (candidates.length) directAttrs.push(basename);
  for (const directAttr of directAttrs) {
    const direct = path.resolve(hostDir, directAttr);
    const candidateRel = relForAbs(ctx.ws, direct);
    if (!candidateRel || !fs.existsSync(direct)) continue;
    const safeDirect = absForRel(ctx.ws, candidateRel);
    if (!safeDirect || !fs.statSync(safeDirect).isFile()) continue;
    directTargetRel = candidateRel; break;
  }
  const existingCandidateRels = candidates.filter((candidate) => {
    const absolute = absForRel(ctx.ws, candidate);
    return Boolean(absolute && fs.existsSync(absolute) && fs.statSync(absolute).isFile());
  });
  return pnwResolveXlinkTarget({
    hostRel,
    xlinkFile: normalizedAttr,
    candidateRels: candidates,
    existingCandidateRels,
    directTargetRel,
  });
}

function edgeForXlink(ctx: IndexContext, host: AssetRow, xlink: XlinkRef): XrefEdge {
  const resolved = resolveTarget(ctx, host.repo_rel_path, xlink.file);
  // Candidate suggestions are not committed target identities.
  const targetRel = resolved.status === "resolved" || resolved.status === "self" ? resolved.targetRel : null;
  const targetAsset = targetRel ? ctx.assetsByRel.get(normKey(targetRel)) : undefined;
  const targetBase = basenameOf(xlink.file);
  return {
    host_file_asset_id: host.id,
    host_repo_rel_path: host.repo_rel_path,
    xlink_file_attr: xlink.file,
    link_label: xlink.label,
    rule_label: pnwCadXlinkRuleLabel(targetAsset, targetBase, resolved.targetRel),
    target_basename: targetBase,
    target_file_asset_id: targetAsset?.id ?? null,
    target_repo_rel_path: targetRel,
    target_part_number: String(targetAsset?.part_number || ""),
    target_part_version: String(targetAsset?.part_version || ""),
    target_type_code: String(targetAsset?.type_code || ""),
    target_model_series: String(targetAsset?.model_series || ""),
    target_part_name: String(targetAsset?.part_name || ""),
    target_asset_label: String(targetAsset?.label || ""),
    resolve_status: resolved.status,
    detail_json: resolved.candidates.length ? JSON.stringify({ candidates: resolved.candidates }) : null,
  };
}

function edgesForHost(ctx: IndexContext, host: AssetRow): XrefEdge[] {
  const abs = absForRel(ctx.ws, host.repo_rel_path);
  if (!abs || !fs.existsSync(abs)) throw new Error(`Host FCStd file is missing; previous index preserved: ${host.repo_rel_path}`);
  const before = fs.statSync(abs);
  const analysis = readFcstdIndexAnalysis(abs);
  const after = fs.statSync(absForRel(ctx.ws, host.repo_rel_path)!);
  if (!sameStat(before, after)) throw new Error("Host changed during reference read; previous index preserved");
  ctx.snapshots.set(host.repo_rel_path, after);
  return edgesForAnalysis(ctx, host, analysis);
}

async function edgesForHostAsync(ctx: IndexContext, host: AssetRow): Promise<XrefEdge[]> {
  const abs = absForRel(ctx.ws, host.repo_rel_path);
  if (!abs || !fs.existsSync(abs)) throw new Error(`Host FCStd file is missing; previous index preserved: ${host.repo_rel_path}`);
  const before = fs.statSync(abs);
  const analysis = await readFcstdIndexAnalysisAsync(abs, () => {
    const current = absForRel(ctx.ws, host.repo_rel_path);
    if (!current) throw new Error("Host FCStd file is missing; previous index preserved");
    return current;
  });
  const after = fs.statSync(absForRel(ctx.ws, host.repo_rel_path)!);
  if (!sameStat(before, after)) throw new Error("Host changed during reference read; previous index preserved");
  ctx.snapshots.set(host.repo_rel_path, after);
  return edgesForAnalysis(ctx, host, analysis);
}

function edgesForAnalysis(ctx: IndexContext, host: AssetRow, analysis: ReturnType<typeof readFcstdIndexAnalysis>): XrefEdge[] {
  const physicalFiles = new Set(analysis.bomXlinks.map(link => link.file));
  return analysis.xlinks.map(link => {
    const edge = edgeForXlink(ctx, host, link);
    if (!physicalFiles.has(link.file)) edge.detail_json = JSON.stringify({ ...(edge.detail_json ? JSON.parse(edge.detail_json) : {}),
      basic_bom: false, reference_role: "drawing_source" });
    return edge;
  });
}

function sameStat(a: fs.Stats, b: fs.Stats) {
  return a.isFile() && b.isFile() && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev;
}

function dedupeEdges(edges: XrefEdge[]): XrefEdge[] {
  const grouped = new Map<string, { edge: XrefEdge; quantity: number }>();
  for (const edge of edges) {
    const key = `${edge.host_file_asset_id}\0${edge.xlink_file_attr}`;
    const entry = grouped.get(key);
    if (entry) entry.quantity += 1;
    else grouped.set(key, { edge, quantity: 1 });
  }
  return [...grouped.values()].map(({ edge, quantity }) => {
    const detail = edge.detail_json ? JSON.parse(edge.detail_json) : {};
    return { ...edge, detail_json: JSON.stringify({ ...detail,
      source: "phoenix-desk-tools-xref-partial-refresh",
      ...(detail.basic_bom === false ? { basic_bom: false } : { basic_bom: true, quantity }) }) };
  });
}

function insertEdges(db: PnwDbAdapter, scanId: number, edges: XrefEdge[], now: string): void {
  const sql = `
    INSERT INTO phoenix_cad_bom_xref (
      scan_id, host_file_asset_id, host_repo_rel_path, ref_kind, locator,
      xlink_file_attr, link_label, rule_label, target_basename,
      target_file_asset_id, target_repo_rel_path, target_part_number,
      target_part_version, target_type_code, target_model_series,
      target_part_name, target_asset_label, resolve_status, detail_json, last_seen_at
    ) VALUES (?, ?, ?, 'xlink_file_attr', 'Document.xml', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  for (const edge of dedupeEdges(edges)) {
    db.run(sql, [
      scanId,
      edge.host_file_asset_id,
      edge.host_repo_rel_path,
      edge.xlink_file_attr,
      edge.link_label,
      edge.rule_label,
      edge.target_basename,
      edge.target_file_asset_id,
      edge.target_repo_rel_path,
      edge.target_part_number,
      edge.target_part_version,
      edge.target_type_code,
      edge.target_model_series,
      edge.target_part_name,
      edge.target_asset_label,
      edge.resolve_status,
      edge.detail_json,
      now,
    ]);
  }
}

function clearDerivedTables(db: PnwDbAdapter): void {
  for (const table of ["phoenix_cad_bom_assembly_cache", "phoenix_cad_bom_tree_occurrence"]) {
    if (tableExists(db, table)) db.run(`DELETE FROM ${table}`);
  }
}

function currentStats(db: PnwDbAdapter): Record<string, number> {
  const row = db.get<any>(
    `SELECT COUNT(*) AS edge_count,
            COUNT(DISTINCT host_repo_rel_path) AS host_count,
            SUM(CASE WHEN resolve_status IN ('resolved', 'self') THEN 1 ELSE 0 END) AS target_resolved,
            SUM(CASE WHEN resolve_status = 'ambiguous' THEN 1 ELSE 0 END) AS target_ambiguous,
            SUM(CASE WHEN resolve_status IN ('missing', 'non_fcstd') THEN 1 ELSE 0 END) AS target_missing
     FROM phoenix_cad_bom_xref`,
  ) || {};
  return {
    edge_count: Number(row.edge_count || 0),
    host_count: Number(row.host_count || 0),
    target_resolved: Number(row.target_resolved || 0),
    target_ambiguous: Number(row.target_ambiguous || 0),
    target_missing: Number(row.target_missing || 0),
  };
}

function writeHostIndex(ctx: IndexContext, hosts: string[], edges: XrefEdge[]): Record<string, number> {
  assertIndexPath(ctx.ws);
  const db = pnwCreateDb(dbPath(ctx.ws));
  const now = utcNowIso();
  try {
    assertIndexPath(ctx.ws);
    ensureXrefSchema(db);
    db.exec("BEGIN IMMEDIATE");
    if (latestScanId(db) !== ctx.scanId) throw new Error("CAD index changed during reference discovery; retry required");
    for (const [rel, snapshot] of ctx.snapshots) {
      const abs = absForRel(ctx.ws, rel);
      if (!abs || !sameStat(snapshot, fs.statSync(abs))) throw new Error("Host snapshot changed; previous index preserved");
    }
    // A partial refresh is a new index revision, never a full-scan completion.
    // This also invalidates a full scan's optimistic expectedScanId contract.
    db.run(`INSERT INTO phoenix_cad_scan
      (scan_uuid,scanned_at,scan_root,stats_json,status,phase,started_at,finished_at)
      VALUES (?,?,?,?,'stale','xref-partial-refresh',?,?)`,
    [randomUUID(), now, ctx.ws, JSON.stringify({ source: "phoenix-desk-tools-xref-partial-refresh", complete: false, hosts: hosts.length }), now, now]);
    const revision = latestScanId(db)!;
    clearDerivedTables(db);
    const keys = [...new Set(hosts.map(normKey).filter(Boolean).flatMap(key => [key, key.slice(2)]))];
    if (keys.length) {
      const placeholders = keys.map(() => "?").join(", ");
      db.run(`DELETE FROM phoenix_cad_bom_xref WHERE host_repo_rel_path IN (${placeholders})`, keys);
      const ids = keys.map((key) => ctx.assetsByRel.get(normKey(key))?.id).filter((id): id is number => id != null);
      if (ids.length) db.run(`DELETE FROM phoenix_cad_bom_xref WHERE host_file_asset_id IN (${ids.map(() => "?").join(", ")})`, ids);
    }
    insertEdges(db, revision, edges, now);
    const stats = currentStats(db);
    db.exec("COMMIT");
    return stats;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function discoverSubtree(ctx: IndexContext, rootHost: string, options: BomXrefIndexOptions = {}): string[] {
  const root = normKey(rootHost);
  const recursive = options.recursive !== false;
  const maxHosts = Math.max(1, Math.min(1000, Number(options.maxHosts || 64)));
  const queue = root ? [root] : [];
  const seen = new Set<string>();
  const order: string[] = [];
  while (queue.length && order.length < maxHosts) {
    const host = queue.shift()!;
    if (seen.has(host)) continue;
    seen.add(host);
    order.push(host);
    if (!recursive) continue;
    const abs = absForRel(ctx.ws, host);
    if (!abs || !fs.existsSync(abs) || !isFcstd(abs)) continue;
    const xlinks = readFcstdXlinks(abs);
    absForRel(ctx.ws, host); // Revalidate the same safe path after bounded I/O.
    for (const xlink of xlinks) {
      const resolved = resolveTarget(ctx, host, xlink.file);
      const target = resolved.targetRel ? normKey(resolved.targetRel) : "";
      if (target && GRAPH_TARGET_STATUSES.has(resolved.status) && !seen.has(target) && !queue.includes(target)) queue.push(target);
    }
  }
  return order;
}

async function discoverSubtreeAsync(ctx: IndexContext, rootHost: string, options: BomXrefIndexOptions = {}): Promise<{ hosts: string[]; cancelled: boolean }> {
  const root = normKey(rootHost);
  const recursive = options.recursive !== false;
  const maxHosts = Math.max(1, Math.min(1000, Number(options.maxHosts || 64)));
  const isCancelled = options.isCancelled || (() => false);
  const queue = root ? [root] : [];
  const seen = new Set<string>();
  const order: string[] = [];
  options.onProgress?.("walk", 0, 1);
  while (queue.length && order.length < maxHosts) {
    if (isCancelled()) return { hosts: order, cancelled: true };
    const host = queue.shift()!;
    if (seen.has(host)) continue;
    seen.add(host);
    order.push(host);
    options.onProgress?.("walk", order.length, Math.max(order.length, order.length + queue.length), host);
    if (!recursive) continue;
    const abs = absForRel(ctx.ws, host);
    if (!abs || !fs.existsSync(abs) || !isFcstd(abs)) continue;
    for (const xlink of await readFcstdXlinksAsync(abs, () => {
      const current = absForRel(ctx.ws, host);
      if (!current) throw new Error("Host FCStd file is missing; previous index preserved");
      return current;
    })) {
      const resolved = resolveTarget(ctx, host, xlink.file);
      const target = resolved.targetRel ? normKey(resolved.targetRel) : "";
      if (target && GRAPH_TARGET_STATUSES.has(resolved.status) && !seen.has(target) && !queue.includes(target)) queue.push(target);
    }
  }
  options.onProgress?.("walk", order.length, order.length, order.at(-1));
  return { hosts: order, cancelled: false };
}

export function refreshBomXrefHostsIndex(ws: string, rels: string[]): any {
  const ctx = loadContext(ws);
  if (!ctx) return { updated_hosts: 0, edge_count: 0, hosts: [], index_pending: true };
  const hosts = [...new Set(rels.map(normKey).filter(key => key && ctx.assetsByRel.has(key)))].sort();
  if (!hosts.length) return { updated_hosts: 0, edge_count: 0, hosts: [], index_pending: true };
  const edges: XrefEdge[] = [];
  let updatedHosts = 0;
  for (const hostRel of hosts) {
    const asset = ctx.assetsByRel.get(hostRel);
    if (!asset) continue;
    const hostEdges = edgesForHost(ctx, asset);
    if (hostEdges.length) updatedHosts += 1;
    edges.push(...hostEdges);
  }
  writeHostIndex(ctx, hosts, edges);
  const grouped = dedupeEdges(edges);
  return {
    updated_hosts: updatedHosts,
    edge_count: grouped.length,
    target_resolved: grouped.filter((edge) => edge.resolve_status === "resolved" || edge.resolve_status === "self").length,
    target_ambiguous: grouped.filter((edge) => edge.resolve_status === "ambiguous").length,
    target_missing: grouped.filter((edge) => edge.resolve_status === "missing" || edge.resolve_status === "non_fcstd").length,
    hosts,
    index_state: "stale", index_stale: true, bom_index_state: "stale", bom_index_stale: true, index_reason: "partial_refresh",
  };
}

function rootSummary(ws: string, root: string): Record<string, number> {
  const db = pnwCreateDb(dbPath(ws));
  try {
    const rows = db.all<{ resolve_status: string }>(
      "SELECT resolve_status FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = ?",
      [normKey(root)],
    );
    return {
      outgoing_count: rows.length,
      outgoing_missing: rows.filter((row) => row.resolve_status === "missing").length,
      outgoing_ambiguous: rows.filter((row) => row.resolve_status === "ambiguous").length,
      outgoing_resolved: rows.filter((row) => row.resolve_status === "resolved" || row.resolve_status === "self").length,
    };
  } finally {
    db.close();
  }
}

function validateRootHost(ws: string, rel: string): string {
  const host = normKey(rel);
  if (!host) throw new Error("host_repo_rel is required");
  const abs = absForRel(ws, host);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`Host FCStd file does not exist: ${host}`);
  if (!isFcstd(abs)) throw new Error("Host must be an .FCStd file");
  return host;
}

export function refreshBomXrefHostIndex(ws: string, rel: string, options: BomXrefIndexOptions = {}): any {
  const host = validateRootHost(ws, rel);
  const ctx = loadContext(ws);
  if (!ctx || !ctx.assetsByRel.has(host)) return { host_repo_rel_path: host, recursive: options.recursive !== false, hosts_refreshed: 0, hosts: [], updated_hosts: 0, edge_count: 0, index_pending: true };
  const hosts = discoverSubtree(ctx, host, options);
  const refreshed = refreshBomXrefHostsIndex(ws, hosts);
  const summary = rootSummary(ws, host);
  return {
    host_repo_rel_path: host,
    recursive: options.recursive !== false,
    hosts_refreshed: hosts.length,
    hosts,
    ...summary,
    ...refreshed,
    log: `Refreshed xref index for ${hosts.length} host(s); root has ${summary.outgoing_count} outgoing edge(s).`,
  };
}

export async function refreshBomXrefHostIndexAsync(ws: string, rel: string, options: BomXrefIndexOptions = {}): Promise<any> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const host = validateRootHost(ws, rel);
  const isCancelled = options.isCancelled || (() => false);
  const ctx = loadContext(ws);
  if (!ctx || !ctx.assetsByRel.has(host)) return { host_repo_rel_path: host, recursive: options.recursive !== false, hosts_refreshed: 0, hosts: [], updated_hosts: 0, edge_count: 0, index_pending: true };
  const discovered = await discoverSubtreeAsync(ctx, host, options);
  if (discovered.cancelled || isCancelled()) return { host_repo_rel_path: host, hosts: discovered.hosts, cancelled: true };

  const edges: XrefEdge[] = [];
  let updatedHosts = 0;
  options.onProgress?.("xref", 0, discovered.hosts.length);
  for (let index = 0; index < discovered.hosts.length; index += 1) {
    if (isCancelled()) return { host_repo_rel_path: host, hosts: discovered.hosts, cancelled: true };
    const hostRel = discovered.hosts[index];
    const asset = ctx.assetsByRel.get(hostRel);
    if (asset) {
      const hostEdges = await edgesForHostAsync(ctx, asset);
      if (hostEdges.length) updatedHosts += 1;
      edges.push(...hostEdges);
    }
    options.onProgress?.("xref", index + 1, discovered.hosts.length, hostRel);
  }
  if (isCancelled()) return { host_repo_rel_path: host, hosts: discovered.hosts, cancelled: true };
  writeHostIndex(ctx, discovered.hosts, edges);
  const summary = rootSummary(ws, host);
  return {
    host_repo_rel_path: host,
    recursive: options.recursive !== false,
    hosts_refreshed: discovered.hosts.length,
    hosts: discovered.hosts,
    ...summary,
    updated_hosts: updatedHosts,
    edge_count: dedupeEdges(edges).length,
    index_state: "stale", index_stale: true, bom_index_state: "stale", bom_index_stale: true, index_reason: "partial_refresh",
    log: `Refreshed xref index for ${discovered.hosts.length} host(s); root has ${summary.outgoing_count} outgoing edge(s).`,
  };
}
