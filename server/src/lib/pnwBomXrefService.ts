import fs from "node:fs";
import path from "node:path";
import {
  pnwBuildAssemblyTreeFromXrefs,
  pnwResolveIncomingXlinkHosts,
} from "@phoenix-wing/cad-core";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import {
  refreshBomXrefHostIndex,
  refreshBomXrefHostIndexAsync,
  refreshBomXrefHostsIndex,
  type BomXrefIndexOptions,
} from "./pnwBomXrefIndexEngine.js";
import { patchFcstdReferenceLabels } from "./fcstdReferenceLabelService.js";

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

function keyCandidates(rel: string): string[] {
  const key = normKey(rel);
  return key ? [key, key.slice(2)] : [];
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

function allEdges(db: PnwDbAdapter): any[] {
  const rows = db.all<any>(
    `SELECT * FROM phoenix_cad_bom_xref
     ORDER BY host_repo_rel_path, xlink_file_attr`,
  );
  return rows.map(rowToEdge);
}

export function queryXrefCountsForRel(ws: string, rel: string): any {
  const db = openDb(ws);
  const key = normKey(rel);
  const keys = keyCandidates(rel);
  if (!db || !key) return { outgoing_count: 0, direct_incoming_count: 0, outgoing: 0, incoming: 0, flat_lines: 0, index_pending: true };
  try {
    if (!hasBomXrefTable(db)) return { outgoing_count: 0, direct_incoming_count: 0, outgoing: 0, incoming: 0, flat_lines: 0, index_pending: true };
    const row = db.get<{ outgoing_count: number; direct_incoming_count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM phoenix_cad_bom_xref WHERE host_repo_rel_path IN (?, ?)) AS outgoing_count,
         (
           SELECT COUNT(DISTINCT host_repo_rel_path) FROM phoenix_cad_bom_xref
           WHERE target_repo_rel_path IN (?, ?)
              OR target_file_asset_id = (
                SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path IN (?, ?) LIMIT 1
              )
         ) AS direct_incoming_count`,
      [...keys, ...keys, ...keys],
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

export function searchOutgoingRefs(ws: string, rel: string, opts: { limit?: number } = {}): any {
  const db = openDb(ws);
  const key = normKey(rel);
  const keys = keyCandidates(rel);
  const limit = Math.max(1, Math.min(2000, Number(opts.limit || 500)));
  if (!db || !key) return { host_repo_rel_path: key || rel, count: 0, label_mismatch_count: 0, refs: [], items: [], index_pending: true };
  try {
    if (!hasBomXrefTable(db)) return { host_repo_rel_path: key, count: 0, label_mismatch_count: 0, refs: [], items: [], index_pending: true };
    const rows = db.all<any>(
      `SELECT * FROM phoenix_cad_bom_xref
       WHERE host_repo_rel_path IN (?, ?)
       ORDER BY target_basename, xlink_file_attr
       LIMIT ?`,
      [...keys, limit],
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

export function searchIncomingRefs(
  ws: string,
  opts: { rel?: string; basename?: string; limit?: number; transitive?: boolean } = {},
): any {
  const db = openDb(ws);
  const relKey = opts.rel ? normKey(opts.rel) : "";
  const relKeys = opts.rel ? keyCandidates(opts.rel) : [];
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
      clauses.push(`(target_repo_rel_path IN (?, ?) OR target_file_asset_id = (SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path IN (?, ?) LIMIT 1))`);
      params.push(...relKeys, ...relKeys);
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

    const hosts = pnwResolveIncomingXlinkHosts(edges, refs, targets, opts.transitive !== false, limit);
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
    const tree = pnwBuildAssemblyTreeFromXrefs(allEdges(db), hostKey, Boolean(opts.full));
    return { host_repo_rel_path: hostKey, mode, ...tree };
  } finally {
    db.close();
  }
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

export function refreshBomXrefsForHosts(ws: string, rels: string[]): any {
  if (!workspaceOk(ws)) return { updated_hosts: 0, edge_count: 0, hosts: [] };
  return refreshBomXrefHostsIndex(ws, rels);
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
      const hostKeys = keyCandidates(host);
      const attr = String(patch.xlink_file_attr || "").trim();
      const label = String(patch.link_label ?? "");
      if (!host || !attr) {
        failed.push({ host_repo_rel: host, error: "host_repo_rel and xlink_file_attr are required" });
        continue;
      }
      const row = db.get<{ id: number }>(
        `SELECT id FROM phoenix_cad_bom_xref
         WHERE host_repo_rel_path IN (?, ?) AND xlink_file_attr = ?
         LIMIT 1`,
        [...hostKeys, attr],
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
