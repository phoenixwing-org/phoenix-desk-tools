import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import {
  pnwCadXlinkRuleLabel,
  pnwExtractXlinksFromDocumentXml,
  pnwResolveXlinkTarget,
  type PnwCadXlinkRef,
  type PnwCadResolvedXlinkTarget,
} from "@phoenix-wing/cad-core";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";

const GRAPH_TARGET_STATUSES = new Set(["resolved", "ambiguous", "self"]);

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

function tableColumns(db: PnwDbAdapter, name: string): Set<string> {
  return new Set(db.all<{ name: string }>(`PRAGMA table_info(${name})`).map((row) => row.name));
}

function ensureIndexSchema(db: PnwDbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS phoenix_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phoenix_cad_scan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_uuid TEXT,
      scanned_at TEXT NOT NULL,
      scan_root TEXT NOT NULL DEFAULT '.',
      stats_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'done',
      phase TEXT DEFAULT '',
      progress_json TEXT,
      started_at TEXT,
      finished_at TEXT
    );
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

  const scanColumns = tableColumns(db, "phoenix_cad_scan");
  const requiredScanColumns: Array<[string, string]> = [
    ["scan_uuid", "TEXT"],
    ["scanned_at", "TEXT"],
    ["scan_root", "TEXT NOT NULL DEFAULT '.'"],
    ["stats_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["status", "TEXT NOT NULL DEFAULT 'done'"],
    ["phase", "TEXT DEFAULT ''"],
    ["progress_json", "TEXT"],
    ["started_at", "TEXT"],
    ["finished_at", "TEXT"],
  ];
  for (const [name, ddl] of requiredScanColumns) {
    if (!scanColumns.has(name)) db.exec(`ALTER TABLE phoenix_cad_scan ADD COLUMN ${name} ${ddl}`);
  }
}

function metaGet(db: PnwDbAdapter, key: string): string {
  return String(db.get<{ value: string }>("SELECT value FROM phoenix_meta WHERE key = ?", [key])?.value || "");
}

function metaSet(db: PnwDbAdapter, key: string, value: string): void {
  db.run(
    `INSERT INTO phoenix_meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

function ensureScanId(db: PnwDbAdapter): number | null {
  const existing = db.get<{ id: number }>("SELECT id FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1");
  if (existing) return Number(existing.id);
  const assetCount = Number(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM phoenix_cad_file_asset")?.n || 0);
  if (!assetCount) return null;
  const now = utcNowIso();
  db.run(
    `INSERT INTO phoenix_cad_scan
       (scan_uuid, scanned_at, scan_root, stats_json, status, phase, started_at, finished_at)
     VALUES (?, ?, '.', '{}', 'done', 'done', ?, ?)`,
    [randomUUID(), now, now, now],
  );
  return Number(db.get<{ id: number }>("SELECT id FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1")?.id || 0) || null;
}

function loadContext(ws: string): IndexContext | null {
  if (!workspaceOk(ws) || !fs.existsSync(dbPath(ws))) return null;
  const db = pnwCreateDb(dbPath(ws));
  try {
    if (!tableExists(db, "phoenix_cad_file_asset")) return null;
    ensureIndexSchema(db);
    const scanId = ensureScanId(db);
    if (scanId == null) return null;
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
    return { ws: path.resolve(ws), scanId, assets, assetsByRel, basenameMap };
  } finally {
    db.close();
  }
}

function absForRel(ws: string, rel: string): string | null {
  const root = path.resolve(ws);
  const abs = path.resolve(root, normKey(rel).replace(/^\.\//, ""));
  const diff = path.relative(root, abs);
  if (diff === "" || (!diff.startsWith("..") && !path.isAbsolute(diff))) return abs;
  return null;
}

function relForAbs(ws: string, abs: string): string | null {
  const root = path.resolve(ws);
  const diff = path.relative(root, path.resolve(abs));
  if (!diff || diff.startsWith("..") || path.isAbsolute(diff)) return null;
  return normKey(diff);
}

export const extractXlinksFromDocumentXml = pnwExtractXlinksFromDocumentXml;

function unzipDocumentXml(raw: Uint8Array): string | null {
  try {
    const files = unzipSync(raw, {
      filter: (file) => file.name.replace(/\\/g, "/") === "Document.xml",
    });
    const bytes = files["Document.xml"];
    return bytes ? strFromU8(bytes) : null;
  } catch {
    return null;
  }
}

export function readFcstdXlinks(filePath: string): XlinkRef[] {
  try {
    const raw = fs.readFileSync(filePath);
    return extractXlinksFromDocumentXml(unzipDocumentXml(raw) || "");
  } catch {
    return [];
  }
}

async function readFcstdXlinksAsync(filePath: string): Promise<XlinkRef[]> {
  try {
    const raw = await fs.promises.readFile(filePath);
    return extractXlinksFromDocumentXml(unzipDocumentXml(raw) || "");
  } catch {
    return [];
  }
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
    if (!fs.existsSync(direct) || !fs.statSync(direct).isFile()) continue;
    directTargetRel = relForAbs(ctx.ws, direct);
    if (directTargetRel) break;
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
  const targetAsset = resolved.targetRel ? ctx.assetsByRel.get(normKey(resolved.targetRel)) : undefined;
  const targetBase = basenameOf(xlink.file);
  return {
    host_file_asset_id: host.id,
    host_repo_rel_path: host.repo_rel_path,
    xlink_file_attr: xlink.file,
    link_label: xlink.label,
    rule_label: pnwCadXlinkRuleLabel(targetAsset, targetBase, resolved.targetRel),
    target_basename: targetBase,
    target_file_asset_id: targetAsset?.id ?? null,
    target_repo_rel_path: resolved.targetRel,
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
  if (!abs || !fs.existsSync(abs)) return [];
  return readFcstdXlinks(abs).map((xlink) => edgeForXlink(ctx, host, xlink));
}

async function edgesForHostAsync(ctx: IndexContext, host: AssetRow): Promise<XrefEdge[]> {
  const abs = absForRel(ctx.ws, host.repo_rel_path);
  if (!abs || !fs.existsSync(abs)) return [];
  return (await readFcstdXlinksAsync(abs)).map((xlink) => edgeForXlink(ctx, host, xlink));
}

function dedupeEdges(edges: XrefEdge[]): XrefEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.host_file_asset_id}\0${edge.xlink_file_attr}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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

function persistMeta(db: PnwDbAdapter, scanId: number, now: string): Record<string, number> {
  const stats = currentStats(db);
  metaSet(db, "last_bom_xref_at", now);
  metaSet(db, "last_bom_xref_scan_id", String(scanId));
  metaSet(db, "last_bom_xref_stats", JSON.stringify(stats));
  return stats;
}

function writeFullIndex(ctx: IndexContext, edges: XrefEdge[]): Record<string, number> {
  const db = pnwCreateDb(dbPath(ctx.ws));
  const now = utcNowIso();
  try {
    ensureIndexSchema(db);
    db.exec("BEGIN TRANSACTION");
    db.run("DELETE FROM phoenix_cad_bom_xref");
    clearDerivedTables(db);
    insertEdges(db, ctx.scanId, edges, now);
    const stats = persistMeta(db, ctx.scanId, now);
    db.exec("COMMIT");
    return stats;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function writeHostIndex(ctx: IndexContext, hosts: string[], edges: XrefEdge[]): Record<string, number> {
  const db = pnwCreateDb(dbPath(ctx.ws));
  const now = utcNowIso();
  try {
    ensureIndexSchema(db);
    db.exec("BEGIN TRANSACTION");
    clearDerivedTables(db);
    const keys = [...new Set(hosts.map(normKey).filter(Boolean))];
    if (keys.length) {
      const placeholders = keys.map(() => "?").join(", ");
      db.run(`DELETE FROM phoenix_cad_bom_xref WHERE host_repo_rel_path IN (${placeholders})`, keys);
      const ids = keys.map((key) => ctx.assetsByRel.get(key)?.id).filter((id): id is number => id != null);
      if (ids.length) db.run(`DELETE FROM phoenix_cad_bom_xref WHERE host_file_asset_id IN (${ids.map(() => "?").join(", ")})`, ids);
    }
    insertEdges(db, ctx.scanId, edges, now);
    const stats = persistMeta(db, ctx.scanId, now);
    db.exec("COMMIT");
    return stats;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

function rebuildResult(ctx: IndexContext, stats: Record<string, number>, hostsWithXlink: number): any {
  return {
    scan_id: ctx.scanId,
    database_path: dbPath(ctx.ws),
    database_path_display: path.normalize(dbPath(ctx.ws)),
    host_files_scanned: ctx.assets.length,
    hosts_with_xlink: hostsWithXlink,
    hosts_without_xlink: Math.max(0, ctx.assets.length - hostsWithXlink),
    ...stats,
    index_pending: false,
    log: `Rebuilt BOM xref index from ${ctx.assets.length} FCStd files: ${stats.edge_count || 0} edges across ${stats.host_count || 0} hosts.`,
  };
}

function emptyRebuild(ws: string, message: string): any {
  return {
    database_path: dbPath(ws || ""),
    database_path_display: path.normalize(dbPath(ws || "")),
    edge_count: 0,
    host_count: 0,
    target_resolved: 0,
    target_ambiguous: 0,
    target_missing: 0,
    index_pending: true,
    log: message,
  };
}

export function rebuildBomXrefIndex(ws: string, options: BomXrefIndexOptions = {}): any {
  const ctx = loadContext(ws);
  if (!ctx) return emptyRebuild(ws, "CAD index is not available; run FCStd map scan first.");
  const edges: XrefEdge[] = [];
  let hostsWithXlink = 0;
  options.onProgress?.("xref", 0, ctx.assets.length);
  for (let index = 0; index < ctx.assets.length; index += 1) {
    const hostEdges = edgesForHost(ctx, ctx.assets[index]);
    if (hostEdges.length) hostsWithXlink += 1;
    edges.push(...hostEdges);
    options.onProgress?.("xref", index + 1, ctx.assets.length, ctx.assets[index].repo_rel_path);
  }
  return rebuildResult(ctx, writeFullIndex(ctx, edges), hostsWithXlink);
}

export async function rebuildBomXrefIndexAsync(ws: string, options: BomXrefIndexOptions = {}): Promise<any> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const ctx = loadContext(ws);
  if (!ctx) return emptyRebuild(ws, "CAD index is not available; run FCStd map scan first.");
  const isCancelled = options.isCancelled || (() => false);
  const edges: XrefEdge[] = [];
  let hostsWithXlink = 0;
  options.onProgress?.("xref", 0, ctx.assets.length);
  for (let index = 0; index < ctx.assets.length; index += 1) {
    if (isCancelled()) return { ...emptyRebuild(ws, "BOM xref rebuild cancelled."), cancelled: true };
    const hostEdges = await edgesForHostAsync(ctx, ctx.assets[index]);
    if (hostEdges.length) hostsWithXlink += 1;
    edges.push(...hostEdges);
    options.onProgress?.("xref", index + 1, ctx.assets.length, ctx.assets[index].repo_rel_path);
  }
  if (isCancelled()) return { ...emptyRebuild(ws, "BOM xref rebuild cancelled."), cancelled: true };
  return rebuildResult(ctx, writeFullIndex(ctx, edges), hostsWithXlink);
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
    for (const xlink of readFcstdXlinks(abs)) {
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
    for (const xlink of await readFcstdXlinksAsync(abs)) {
      const resolved = resolveTarget(ctx, host, xlink.file);
      const target = resolved.targetRel ? normKey(resolved.targetRel) : "";
      if (target && GRAPH_TARGET_STATUSES.has(resolved.status) && !seen.has(target) && !queue.includes(target)) queue.push(target);
    }
  }
  options.onProgress?.("walk", order.length, order.length, order.at(-1));
  return { hosts: order, cancelled: false };
}

export function discoverBomXrefSubtree(ws: string, rel: string, options: BomXrefIndexOptions = {}): string[] {
  const ctx = loadContext(ws);
  return ctx ? discoverSubtree(ctx, rel, options) : [];
}

export function refreshBomXrefHostsIndex(ws: string, rels: string[]): any {
  const ctx = loadContext(ws);
  if (!ctx) return { updated_hosts: 0, edge_count: 0, hosts: [] };
  const hosts = [...new Set(rels.map(normKey).filter(Boolean))].sort();
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
  return {
    updated_hosts: updatedHosts,
    edge_count: dedupeEdges(edges).length,
    target_resolved: edges.filter((edge) => edge.resolve_status === "resolved" || edge.resolve_status === "self").length,
    target_ambiguous: edges.filter((edge) => edge.resolve_status === "ambiguous").length,
    target_missing: edges.filter((edge) => edge.resolve_status === "missing" || edge.resolve_status === "non_fcstd").length,
    hosts,
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
  let ctx = loadContext(ws);
  if (!ctx) return { host_repo_rel_path: host, recursive: options.recursive !== false, hosts_refreshed: 0, hosts: [], updated_hosts: 0, edge_count: 0 };
  const db = pnwCreateDb(dbPath(ws));
  const built = Boolean(metaGet(db, "last_bom_xref_at"));
  db.close();
  if (!built) rebuildBomXrefIndex(ws, options);
  ctx = loadContext(ws);
  if (!ctx) throw new Error("CAD index is not available; run FCStd map scan first.");
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
    log: `Rebuilt xref index for ${hosts.length} host(s); root has ${summary.outgoing_count} outgoing edge(s).`,
  };
}

export async function refreshBomXrefHostIndexAsync(ws: string, rel: string, options: BomXrefIndexOptions = {}): Promise<any> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const host = validateRootHost(ws, rel);
  const isCancelled = options.isCancelled || (() => false);
  let ctx = loadContext(ws);
  if (!ctx) return { host_repo_rel_path: host, recursive: options.recursive !== false, hosts_refreshed: 0, hosts: [], updated_hosts: 0, edge_count: 0 };
  const db = pnwCreateDb(dbPath(ws));
  const built = Boolean(metaGet(db, "last_bom_xref_at"));
  db.close();
  if (!built) {
    const initial = await rebuildBomXrefIndexAsync(ws, options);
    if (initial.cancelled || isCancelled()) return { ...initial, host_repo_rel_path: host, cancelled: true };
  }
  ctx = loadContext(ws);
  if (!ctx) throw new Error("CAD index is not available; run FCStd map scan first.");
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
    log: `Rebuilt xref index for ${discovered.hosts.length} host(s); root has ${summary.outgoing_count} outgoing edge(s).`,
  };
}

export function bomXrefIndexTimestamp(ws: string): string {
  if (!workspaceOk(ws) || !fs.existsSync(dbPath(ws))) return "";
  const db = pnwCreateDb(dbPath(ws));
  try {
    if (!tableExists(db, "phoenix_meta")) return "";
    return metaGet(db, "last_bom_xref_at");
  } finally {
    db.close();
  }
}
