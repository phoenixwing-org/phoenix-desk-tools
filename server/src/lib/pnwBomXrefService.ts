import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "phoenix-wing/db/pnwDbAdapter";
import {
  bomXrefIndexTimestamp,
  discoverBomXrefSubtree,
  rebuildBomXrefIndex,
  rebuildBomXrefIndexAsync,
  refreshBomXrefHostIndex,
  refreshBomXrefHostIndexAsync,
  refreshBomXrefHostsIndex,
  type BomXrefIndexOptions,
} from "./pnwBomXrefIndexEngine.js";
import { patchFcstdReferenceLabels } from "./fcstdReferenceLabelService.js";

const GRAPH_TARGET_STATUSES = new Set(["resolved", "ambiguous", "self"]);

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

function normKey(rel: string): string {
  const s = String(rel || "").replace(/\\/g, "/").trim().replace(/^\.\//, "");
  return s ? `./${s}` : "";
}

function openDb(ws: string): PnwDbAdapter | null {
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

function hasBomXrefTable(db: PnwDbAdapter): boolean {
  return tableExists(db, "phoenix_cad_bom_xref");
}

function metaGet(db: PnwDbAdapter, key: string): string {
  try {
    const row = db.get<{ value: string }>("SELECT value FROM phoenix_meta WHERE key = ?", [key]);
    return String(row?.value || "");
  } catch {
    return "";
  }
}

function partKey(partNumber: string, partVersion: string): string {
  const pn = String(partNumber || "").trim();
  const pv = String(partVersion || "").trim();
  return pn && pv ? `${pn}.${pv}` : "";
}

function fileRole(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".drawing.fcstd")) return "drawing";
  if (lower.endsWith(".assy.fcstd")) return "assembly";
  return "part";
}

function parseDetail(raw: unknown): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw));
  } catch {
    return raw;
  }
}

function rowToEdge(row: any): any {
  const linkLabel = String(row.link_label || "");
  const ruleLabel = String(row.rule_label || "");
  return {
    id: Number(row.id || 0),
    host_repo_rel_path: String(row.host_repo_rel_path || ""),
    host_file_asset_id: Number(row.host_file_asset_id || 0),
    xlink_file_attr: String(row.xlink_file_attr || ""),
    target_basename: String(row.target_basename || ""),
    target_repo_rel_path: row.target_repo_rel_path || null,
    target_file_asset_id: row.target_file_asset_id == null ? null : Number(row.target_file_asset_id),
    resolve_status: String(row.resolve_status || "missing"),
    ref_kind: String(row.ref_kind || "xlink_file_attr"),
    detail: parseDetail(row.detail_json),
    link_label: linkLabel,
    rule_label: ruleLabel,
    label_mismatch: Boolean(linkLabel && ruleLabel && linkLabel !== ruleLabel),
    target_part_number: String(row.target_part_number || ""),
    target_part_version: String(row.target_part_version || ""),
    target_type_code: String(row.target_type_code || ""),
    target_model_series: String(row.target_model_series || ""),
    target_part_name: String(row.target_part_name || ""),
    target_asset_label: String(row.target_asset_label || ""),
  };
}

function emptyMeta(ws: string) {
  const db = dbPath(ws || "");
  return {
    database_path: db,
    database_path_display: db ? path.normalize(db) : "",
    edge_count: 0,
    host_count: 0,
    last_bom_xref_at: "",
    index_pending: true,
  };
}

function allEdges(db: PnwDbAdapter): any[] {
  const rows = db.all<any>(
    `SELECT * FROM phoenix_cad_bom_xref
     ORDER BY host_repo_rel_path, xlink_file_attr`,
  );
  return rows.map(rowToEdge);
}

export function loadBomXrefPayload(ws: string): any {
  const db = openDb(ws);
  if (!db) return emptyMeta(ws);
  try {
    if (!hasBomXrefTable(db)) return emptyMeta(ws);
    const count = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM phoenix_cad_bom_xref");
    const hosts = db.get<{ n: number }>("SELECT COUNT(DISTINCT host_repo_rel_path) AS n FROM phoenix_cad_bom_xref");
    let extra: any = {};
    try {
      const rawStats = metaGet(db, "last_bom_xref_stats");
      extra = rawStats ? JSON.parse(rawStats) : {};
    } catch {
      extra = {};
    }
    const lastBomXrefAt = metaGet(db, "last_bom_xref_at");
    return {
      ...emptyMeta(ws),
      edge_count: Number(count?.n || 0),
      host_count: Number(hosts?.n || 0),
      last_bom_xref_at: lastBomXrefAt,
      index_pending: !lastBomXrefAt,
      ...extra,
    };
  } finally {
    db.close();
  }
}

export function queryXrefCountsForRel(ws: string, rel: string): any {
  const db = openDb(ws);
  const key = normKey(rel);
  if (!db || !key) return { outgoing_count: 0, direct_incoming_count: 0, outgoing: 0, incoming: 0, flat_lines: 0, index_pending: true };
  try {
    if (!hasBomXrefTable(db)) return { outgoing_count: 0, direct_incoming_count: 0, outgoing: 0, incoming: 0, flat_lines: 0, index_pending: true };
    const row = db.get<{ outgoing_count: number; direct_incoming_count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = ?) AS outgoing_count,
         (
           SELECT COUNT(DISTINCT host_repo_rel_path) FROM phoenix_cad_bom_xref
           WHERE target_repo_rel_path = ?
              OR target_file_asset_id = (
                SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path = ? LIMIT 1
              )
         ) AS direct_incoming_count`,
      [key, key, key],
    );
    return {
      outgoing_count: Number(row?.outgoing_count || 0),
      direct_incoming_count: Number(row?.direct_incoming_count || 0),
      outgoing: Number(row?.outgoing_count || 0),
      incoming: Number(row?.direct_incoming_count || 0),
      flat_lines: Number(row?.outgoing_count || 0),
      index_pending: false,
    };
  } finally {
    db.close();
  }
}

export function emptyXrefCountsPayload(): any {
  return { outgoing_count: 0, direct_incoming_count: 0, outgoing: 0, incoming: 0, flat_lines: 0, index_pending: true };
}

export function searchOutgoingRefs(ws: string, rel: string, opts: { limit?: number } = {}): any {
  const db = openDb(ws);
  const key = normKey(rel);
  const limit = Math.max(1, Math.min(2000, Number(opts.limit || 500)));
  if (!db || !key) return { host_repo_rel_path: key || rel, count: 0, label_mismatch_count: 0, refs: [], items: [], index_pending: true };
  try {
    if (!hasBomXrefTable(db)) return { host_repo_rel_path: key, count: 0, label_mismatch_count: 0, refs: [], items: [], index_pending: true };
    const rows = db.all<any>(
      `SELECT * FROM phoenix_cad_bom_xref
       WHERE host_repo_rel_path = ?
       ORDER BY target_basename, xlink_file_attr
       LIMIT ?`,
      [key, limit],
    );
    const refs = rows.map(rowToEdge);
    return {
      host_repo_rel_path: key,
      count: refs.length,
      label_mismatch_count: refs.filter((r) => r.label_mismatch).length,
      refs,
      items: refs,
    };
  } finally {
    db.close();
  }
}

function parentMap(edges: any[]): Map<string, Set<string>> {
  const parents = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!GRAPH_TARGET_STATUSES.has(edge.resolve_status)) continue;
    const target = normKey(edge.target_repo_rel_path || "");
    const host = normKey(edge.host_repo_rel_path || "");
    if (!target || !host) continue;
    if (!parents.has(target)) parents.set(target, new Set());
    parents.get(target)!.add(host);
  }
  return parents;
}

function directRefsForHost(refs: any[], host: string): any[] {
  const key = normKey(host);
  return refs.filter((r) => normKey(r.host_repo_rel_path) === key);
}

function resolveIncomingHosts(edges: any[], directRefs: any[], targets: Set<string>, transitive: boolean, limit: number): any[] {
  if (!transitive) {
    const hosts = new Map<string, any>();
    for (const ref of directRefs) {
      const host = normKey(ref.host_repo_rel_path);
      if (!hosts.has(host)) hosts.set(host, { host_repo_rel_path: host, depth: 0, usage_kind: "direct", via_chain: [], direct_refs: [] });
      hosts.get(host).direct_refs.push(ref);
    }
    return [...hosts.values()].slice(0, limit);
  }

  const parents = parentMap(edges);
  const out: any[] = [];
  const visited = new Set<string>();
  const queue: Array<{ host: string; depth: number; via_chain: string[] }> = [];
  for (const target of targets) {
    for (const host of parents.get(target) || []) queue.push({ host, depth: 0, via_chain: [] });
  }
  while (queue.length && out.length < limit) {
    const item = queue.shift()!;
    const host = normKey(item.host);
    if (!host || visited.has(host)) continue;
    visited.add(host);
    out.push({
      host_repo_rel_path: host,
      depth: item.depth,
      usage_kind: item.depth === 0 ? "direct" : "indirect",
      via_chain: item.via_chain,
      direct_refs: directRefsForHost(directRefs, host),
    });
    for (const parent of parents.get(host) || []) {
      if (!visited.has(parent)) queue.push({ host: parent, depth: item.depth + 1, via_chain: [host, ...item.via_chain] });
    }
  }
  return out;
}

export function searchIncomingRefs(
  ws: string,
  opts: { rel?: string; basename?: string; limit?: number; transitive?: boolean } = {},
): any {
  const db = openDb(ws);
  const relKey = opts.rel ? normKey(opts.rel) : "";
  const base = String(opts.basename || "").trim();
  const limit = Math.max(1, Math.min(2000, Number(opts.limit || 500)));
  if (!db || (!relKey && !base)) {
    return { query: { repo_rel: relKey || null, basename: base || null, transitive: opts.transitive !== false }, count: 0, direct_count: 0, refs: [], items: [], hosts: [], index_pending: true };
  }
  try {
    if (!hasBomXrefTable(db)) return { query: { repo_rel: relKey || null, basename: base || null, transitive: opts.transitive !== false }, count: 0, direct_count: 0, refs: [], items: [], hosts: [], index_pending: true };
    const clauses: string[] = [];
    const params: any[] = [];
    if (relKey) {
      clauses.push(`(target_repo_rel_path = ? OR target_file_asset_id = (SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path = ? LIMIT 1))`);
      params.push(relKey, relKey);
    }
    if (base) {
      clauses.push(`target_basename LIKE ? COLLATE NOCASE`);
      params.push(`%${base}%`);
    }
    const refs = db.all<any>(
      `SELECT * FROM phoenix_cad_bom_xref
       WHERE ${clauses.map((c) => `(${c})`).join(" OR ")}
       ORDER BY host_repo_rel_path, xlink_file_attr
       LIMIT ?`,
      [...params, limit],
    ).map(rowToEdge);

    const edges = allEdges(db);
    const targets = new Set<string>();
    if (relKey) targets.add(relKey);
    if (base) {
      const folded = base.toLowerCase();
      for (const edge of edges) {
        if (String(edge.target_basename || "").toLowerCase().includes(folded) && edge.target_repo_rel_path) {
          targets.add(normKey(edge.target_repo_rel_path));
        }
      }
    }
    for (const ref of refs) if (ref.target_repo_rel_path) targets.add(normKey(ref.target_repo_rel_path));

    const hosts = resolveIncomingHosts(edges, refs, targets, opts.transitive !== false, limit);
    return {
      query: { repo_rel: relKey || null, basename: base || null, transitive: opts.transitive !== false },
      count: hosts.length,
      direct_count: hosts.filter((h) => h.depth === 0).length,
      refs,
      items: refs,
      hosts,
    };
  } finally {
    db.close();
  }
}

export function loadAssemblyBomCatalog(ws: string, search?: string): any {
  const db = openDb(ws);
  if (!db) return { count: 0, hosts: [], filter: { assembly_only: true, exclude_drawings: true }, index_pending: true };
  try {
    if (!hasBomXrefTable(db)) return { count: 0, hosts: [], filter: { assembly_only: true, exclude_drawings: true }, index_pending: true };
    const q = String(search || "").trim();
    const params: any[] = [];
    const where = q
      ? `AND (
          bx.host_repo_rel_path LIKE ? COLLATE NOCASE OR
          fa.filename LIKE ? COLLATE NOCASE OR
          COALESCE(fa.part_name, '') LIKE ? COLLATE NOCASE OR
          COALESCE(fa.label, '') LIKE ? COLLATE NOCASE
        )`
      : "";
    if (q) params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    const rows = db.all<any>(
      `SELECT
         bx.host_repo_rel_path,
         fa.filename,
         fa.part_number,
         fa.part_version,
         fa.type_code,
         fa.model_series,
         fa.part_name,
         fa.label,
         COUNT(*) AS ref_count,
         SUM(CASE WHEN bx.resolve_status = 'missing' THEN 1 ELSE 0 END) AS missing_count,
         SUM(CASE WHEN bx.resolve_status = 'ambiguous' THEN 1 ELSE 0 END) AS ambiguous_count,
         (
           SELECT COUNT(DISTINCT bx_in.host_repo_rel_path)
           FROM phoenix_cad_bom_xref bx_in
           WHERE bx_in.target_repo_rel_path = fa.repo_rel_path
         ) AS incoming_host_count
       FROM phoenix_cad_bom_xref bx
       INNER JOIN phoenix_cad_file_asset fa ON fa.id = bx.host_file_asset_id
       WHERE COALESCE(fa.file_status, 'present') = 'present'
         AND LOWER(fa.filename) LIKE '%.fcstd'
         AND LOWER(fa.filename) NOT LIKE '%.drawing.fcstd'
         ${where}
       GROUP BY bx.host_repo_rel_path
       HAVING COUNT(*) > 0 AND (LOWER(fa.filename) LIKE '%.assy.fcstd' OR COUNT(*) >= 2)
       ORDER BY fa.filename COLLATE NOCASE`,
      params,
    );
    const hosts = rows.map((r) => ({
      host_repo_rel_path: String(r.host_repo_rel_path || ""),
      filename: String(r.filename || ""),
      part_number: String(r.part_number || ""),
      part_version: String(r.part_version || ""),
      part_key: partKey(r.part_number || "", r.part_version || ""),
      TypeCode: String(r.type_code || ""),
      ModelSeries: String(r.model_series || ""),
      PartName: String(r.part_name || ""),
      label: String(r.label || ""),
      ref_count: Number(r.ref_count || 0),
      missing_count: Number(r.missing_count || 0),
      ambiguous_count: Number(r.ambiguous_count || 0),
      incoming_host_count: Number(r.incoming_host_count || 0),
      file_role: fileRole(String(r.filename || "")),
    }));
    return {
      count: hosts.length,
      hosts,
      filter: { assembly_only: true, exclude_drawings: true, note: ".ASSY.FCStd or outgoing refs >= 2" },
    };
  } finally {
    db.close();
  }
}

export function loadTargetUsageStats(ws: string, rel: string): any {
  const incoming = searchIncomingRefs(ws, { rel, transitive: false, limit: 2000 });
  const target = normKey(rel);
  return {
    target_repo_rel_path: target,
    direct_incoming_host_count: incoming.direct_count || 0,
    bom_occurrence_count: incoming.refs.length,
    bom_root_count: incoming.direct_count || 0,
    occurrences: incoming.refs.map((ref: any) => ({
      root_host_repo_rel_path: ref.host_repo_rel_path,
      tree_path: `${ref.host_repo_rel_path}/${ref.target_basename}`,
      host_repo_rel_path: ref.host_repo_rel_path,
      link_label: ref.link_label || "",
    })),
    index_pending: Boolean(incoming.index_pending),
  };
}

export function resolveIncomingHostEntries(ws: string, rel: string): any {
  return { hosts: searchIncomingRefs(ws, { rel, transitive: true }).hosts };
}

export function searchBomXrefEdges(ws: string, opts: { offset?: number; limit?: number; search?: string } = {}): any {
  const db = openDb(ws);
  const limit = Math.max(1, Math.min(500, Number(opts.limit || 100)));
  const offset = Math.max(0, Number(opts.offset || 0));
  if (!db) return { offset, limit, total: 0, count: 0, refs: [], index_pending: true };
  try {
    if (!hasBomXrefTable(db)) return { offset, limit, total: 0, count: 0, refs: [], index_pending: true };
    const q = String(opts.search || "").trim();
    const where = q
      ? `WHERE bx.host_repo_rel_path LIKE ? COLLATE NOCASE
          OR bx.target_basename LIKE ? COLLATE NOCASE
          OR COALESCE(bx.target_repo_rel_path, '') LIKE ? COLLATE NOCASE`
      : "";
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM phoenix_cad_bom_xref bx ${where}`, params)?.n || 0;
    const rows = db.all<any>(
      `SELECT * FROM phoenix_cad_bom_xref bx
       ${where}
       ORDER BY bx.host_repo_rel_path, bx.target_basename, bx.xlink_file_attr
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const refs = rows.map(rowToEdge);
    return { offset, limit, total: Number(total), count: refs.length, refs };
  } finally {
    db.close();
  }
}

export function loadAssemblyTreeFromXrefs(ws: string, hostRel: string, opts: { full?: boolean } = {}): any {
  const db = openDb(ws);
  const hostKey = normKey(hostRel);
  const mode = opts.full ? "full" : "first";
  if (!db || !hostKey) {
    return { host_repo_rel_path: hostKey || hostRel, mode, node_count: 0, nodes: [], index_pending: true };
  }
  try {
    if (!hasBomXrefTable(db)) {
      return { host_repo_rel_path: hostKey, mode, node_count: 0, nodes: [], index_pending: true };
    }
    const edges = allEdges(db);
    const byHost = new Map<string, any[]>();
    for (const edge of edges) {
      const host = normKey(edge.host_repo_rel_path || "");
      if (!host) continue;
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host)!.push(edge);
    }

    let nodeCount = 0;
    function build(host: string, seen: Set<string>): any[] {
      const rows = byHost.get(normKey(host)) || [];
      return rows.map((edge, index) => {
        const target = normKey(edge.target_repo_rel_path || "");
        const basename = String(edge.target_basename || (target ? path.basename(target) : edge.xlink_file_attr || ""));
        const canRecurse = Boolean(opts.full && target && !seen.has(target) && byHost.has(target));
        nodeCount += 1;
        return {
          id: `${normKey(host)}::${edge.xlink_file_attr || index}`,
          host_repo_rel: normKey(host),
          repo_rel_path: target || "",
          basename,
          resolve_status: edge.resolve_status || "missing",
          xlink_file_attr: edge.xlink_file_attr || "",
          part_number: edge.target_part_number || "",
          part_version: edge.target_part_version || "",
          part_key: partKey(edge.target_part_number || "", edge.target_part_version || ""),
          TypeCode: edge.target_type_code || "",
          ModelSeries: edge.target_model_series || "",
          PartName: edge.target_part_name || "",
          label: edge.target_asset_label || "",
          link_label: edge.link_label || "",
          link_labels: edge.link_label ? [edge.link_label] : [],
          xref_instances: [{
            xlink_file_attr: edge.xlink_file_attr || "",
            link_label: edge.link_label || "",
          }],
          rule_label: edge.rule_label || "",
          ref_count: 1,
          file_role: fileRole(basename),
          children: canRecurse ? build(target, new Set([...seen, target])) : [],
        };
      });
    }

    const nodes = build(hostKey, new Set([hostKey]));
    return { host_repo_rel_path: hostKey, mode, node_count: nodeCount, nodes };
  } finally {
    db.close();
  }
}

export function bomXrefIndexIsBuilt(ws: string): boolean {
  const meta = loadBomXrefPayload(ws);
  return !meta.index_pending && Boolean(meta.last_bom_xref_at || meta.edge_count);
}

export function rebuildBomXrefs(ws: string, _scanId?: number, options: BomXrefIndexOptions = {}): any {
  if (!workspaceOk(ws)) {
    const meta = loadBomXrefPayload(ws);
    return { ...meta, log: "CAD index is not available; run FCStd map scan first." };
  }
  return rebuildBomXrefIndex(ws, options);
}

export async function rebuildBomXrefsAsync(ws: string, options: BomXrefIndexOptions = {}): Promise<any> {
  if (!workspaceOk(ws)) return rebuildBomXrefs(ws, undefined, options);
  return rebuildBomXrefIndexAsync(ws, options);
}

export function ensureBomXrefBuilt(ws: string): void {
  if (!workspaceOk(ws) || bomXrefIndexTimestamp(ws)) return;
  rebuildBomXrefIndex(ws);
}

export function refreshBomXrefForHost(ws: string, rel: string, options: BomXrefIndexOptions = {}): any {
  if (!workspaceOk(ws)) {
    return { host_repo_rel_path: normKey(rel), recursive: options.recursive !== false, hosts_refreshed: 0, hosts: [], updated_hosts: 0, edge_count: 0 };
  }
  return refreshBomXrefHostIndex(ws, rel, options);
}

export async function refreshBomXrefForHostAsync(ws: string, rel: string, options: BomXrefIndexOptions = {}): Promise<any> {
  if (!workspaceOk(ws)) return refreshBomXrefForHost(ws, rel, options);
  return refreshBomXrefHostIndexAsync(ws, rel, options);
}

export function rebuildBomXrefsFromLastScan(ws: string): any {
  return rebuildBomXrefs(ws);
}

export function refreshBomXrefsForHosts(ws: string, rels: string[]): any {
  if (!workspaceOk(ws)) return { updated_hosts: 0, edge_count: 0, hosts: [] };
  return refreshBomXrefHostsIndex(ws, rels);
}

export function discoverFcstdSubtreeHosts(ws: string, rel: string, options: BomXrefIndexOptions = {}): any {
  return { hosts: workspaceOk(ws) ? discoverBomXrefSubtree(ws, rel, options) : [] };
}

export function fileDetailXrefs(
  ws: string,
  rel: string,
  opts: { limit?: number; transitive?: boolean; scope?: "both" | "outgoing" | "incoming" } = {},
): any {
  const scope = opts.scope || "both";
  const payload: any = {
    rel,
    incoming: { count: 0, direct_count: 0, hosts: [] },
    outgoing: { count: 0, label_mismatch_count: 0, refs: [] },
  };
  if (scope === "both" || scope === "outgoing") {
    const outgoing = searchOutgoingRefs(ws, rel, { limit: opts.limit });
    payload.outgoing = { count: outgoing.count, label_mismatch_count: outgoing.label_mismatch_count || 0, refs: outgoing.refs || [] };
    if (outgoing.index_pending) payload.index_pending = true;
  }
  if (scope === "both" || scope === "incoming") {
    const incoming = searchIncomingRefs(ws, { rel, limit: opts.limit, transitive: opts.transitive });
    payload.incoming = {
      count: incoming.count,
      direct_count: incoming.direct_count || 0,
      hosts: (incoming.hosts || []).map((h: any) => ({
        host_repo_rel_path: h.host_repo_rel_path,
        depth: h.depth || 0,
        usage_kind: h.usage_kind || "direct",
        via_chain: h.via_chain || [],
      })),
    };
    if (incoming.index_pending) payload.index_pending = true;
  }
  return payload;
}

export function patchBomLinkLabels(ws: string, patches: Array<{ host_repo_rel?: string; xlink_file_attr?: string; link_label?: string }>): any {
  const db = openDb(ws);
  const failed: Array<{ host_repo_rel: string; error: string }> = [];
  const byHost = new Map<string, Map<string, string>>();
  const labelChanges: Array<{ host_repo_rel: string; xlink_file_attr: string; old_label: string; new_label: string }> = [];
  let labelPatches = 0;

  if (!db) {
    return { label_patches: 0, applied_hosts: [], failed: [{ host_repo_rel: "", error: "BOM xref index is not available" }], label_changes: [] };
  }
  try {
    if (!hasBomXrefTable(db)) {
      return { label_patches: 0, applied_hosts: [], failed: [{ host_repo_rel: "", error: "BOM xref index is not available" }], label_changes: [] };
    }
    for (const patch of patches || []) {
      const host = normKey(patch.host_repo_rel || "");
      const attr = String(patch.xlink_file_attr || "").trim();
      const label = String(patch.link_label ?? "");
      if (!host || !attr) {
        failed.push({ host_repo_rel: host, error: "host_repo_rel and xlink_file_attr are required" });
        continue;
      }
      const row = db.get<{ id: number }>(
        `SELECT id FROM phoenix_cad_bom_xref
         WHERE host_repo_rel_path = ? AND xlink_file_attr = ?
         LIMIT 1`,
        [host, attr],
      );
      if (!row) {
        failed.push({ host_repo_rel: host, error: `xref row not found: ${attr}` });
        continue;
      }
      if (!byHost.has(host)) byHost.set(host, new Map());
      byHost.get(host)!.set(attr, label);
    }
  } finally {
    db.close();
  }
  const appliedHosts: string[] = [];
  const root = path.resolve(ws);
  for (const [host, labels] of byHost) {
    const hostPath = path.resolve(root, host.replace(/^\.\//, ""));
    const relative = path.relative(root, hostPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      failed.push({ host_repo_rel: host, error: "host path escapes workspace" });
      continue;
    }
    if (!fs.existsSync(hostPath) || !fs.statSync(hostPath).isFile()) {
      failed.push({ host_repo_rel: host, error: "host file does not exist" });
      continue;
    }
    try {
      const result = patchFcstdReferenceLabels(hostPath, Object.fromEntries(labels));
      if (result.count > 0) {
        labelPatches += result.count;
        appliedHosts.push(host);
        labelChanges.push(...result.changes.map((change) => ({ host_repo_rel: host, ...change })));
      }
    } catch (error: any) {
      failed.push({ host_repo_rel: host, error: error.message || String(error) });
    }
  }
  if (appliedHosts.length) {
    try {
      refreshBomXrefsForHosts(ws, appliedHosts);
    } catch (error: any) {
      failed.push({ host_repo_rel: "", error: `labels were written but index refresh failed: ${error.message || error}` });
    }
  }
  return {
    label_patches: labelPatches,
    applied_hosts: appliedHosts,
    failed,
    label_changes: labelChanges,
  };
}
