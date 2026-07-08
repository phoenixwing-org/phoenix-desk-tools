/** pnwBomXrefService — 对应 Python:
 *   bom_xref_service.py (~800行, 20函数)
 *   cad_index/bom_xref_index.py (~500行, 写入部分)
 *
 * 读查询已由 Rust fcstd-query 原生覆盖，写操作待 Rust fcstd-xlink。
 */

// ── 对应 Python bom_xref_service.py ──────────────────

/** 对应 Python: load_bom_xref_payload → GET /api/bom-xrefs/meta */
export function loadBomXrefPayload(): any {
  return { hosts: [], edge_count: 0, last_built: "", _stub: true };
}

/** 对应 Python: query_xref_counts_for_rel → GET /api/bom-xrefs/counts */
export function queryXrefCountsForRel(_ws: string, _rel: string): any {
  return { incoming: 0, outgoing: 0, flat_lines: 0 };
}

/** 对应 Python: empty_xref_counts_payload */
export function emptyXrefCountsPayload(): any {
  return { incoming: 0, outgoing: 0, flat_lines: 0 };
}

/** 对应 Python: search_incoming_refs */
export function searchIncomingRefs(_ws: string, _rel: string): any {
  return { items: [], _stub: true };
}

/** 对应 Python: search_outgoing_refs */
export function searchOutgoingRefs(_ws: string, _rel: string): any {
  return { items: [], _stub: true };
}

/** 对应 Python: bom_xref_index_is_built */
export function bomXrefIndexIsBuilt(_ws: string): boolean { return true; }

/** 对应 Python: load_assembly_bom_catalog */
export function loadAssemblyBomCatalog(_ws: string, _search?: string): any {
  return { hosts: [], count: 0, _stub: true };
}

/** 对应 Python: load_target_usage_stats */
export function loadTargetUsageStats(_ws: string, _rel: string): any {
  return { usage_count: 0, _stub: true };
}

/** 对应 Python: resolve_incoming_host_entries */
export function resolveIncomingHostEntries(_ws: string, _rel: string): any {
  return { hosts: [], _stub: true };
}

// ── 对应 Python cad_index/bom_xref_index.py (写入) ───

/** 对应 Python: rebuild_bom_xrefs */
export function rebuildBomXrefs(_ws: string, _scanId?: number): any {
  return { log: "cad-rust: xref 重建待迁移", _stub: true };
}

/** 对应 Python: ensure_bom_xref_built */
export function ensureBomXrefBuilt(_ws: string): void { /* Rust reads directly, no pre-build needed */ }

/** 对应 Python: refresh_bom_xref_index_for_host */
export function refreshBomXrefForHost(_ws: string, _rel: string): any {
  return { _stub: true };
}

/** 对应 Python: rebuild_bom_xrefs_from_last_scan */
export function rebuildBomXrefsFromLastScan(_ws: string): any {
  return { log: "", _stub: true };
}

/** 对应 Python: refresh_bom_xrefs_for_hosts */
export function refreshBomXrefsForHosts(_ws: string, _rels: string[]): any {
  return { _stub: true };
}

/** 对应 Python: discover_fcstd_subtree_hosts */
export function discoverFcstdSubtreeHosts(_ws: string, _rel: string): any {
  return { hosts: [], _stub: true };
}
