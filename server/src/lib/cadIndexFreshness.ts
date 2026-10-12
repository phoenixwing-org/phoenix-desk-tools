import fs from "node:fs";
import path from "node:path";
import type { PnwDbAdapter } from "@phoenix-wing/db-node";

export type CadIndexState = "ready" | "missing" | "incomplete" | "stale";
export type CadIndexFreshness = {
  index_state: CadIndexState;
  index_pending: boolean;
  index_stale: boolean;
  index_reason: string;
  bom_index_state: CadIndexState;
  bom_index_pending: boolean;
  bom_index_stale: boolean;
  scan_id: number | null;
  freshness_scope: "file" | "workspace";
};

function hasTable(db: PnwDbAdapter, table: string) {
  return Boolean(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]));
}
export function missingCadIndexFreshness(reason = "index_missing"): CadIndexFreshness {
  return { index_state: "missing", index_pending: true, index_stale: false, index_reason: reason,
    bom_index_state: "missing", bom_index_pending: true, bom_index_stale: false, scan_id: null, freshness_scope: "workspace" };
}

/** Read only: a partial projection never establishes a completed BOM snapshot. */
export function readCadIndexFreshness(db: PnwDbAdapter, workspace: string, relativePath?: string): CadIndexFreshness {
  if (!hasTable(db, "phoenix_cad_scan") || !hasTable(db, "phoenix_cad_file_asset") || !hasTable(db, "phoenix_cad_bom_xref")) {
    return missingCadIndexFreshness();
  }
  const scan = db.get<{ id: number; status?: string; phase?: string }>("SELECT * FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1");
  if (!scan) return missingCadIndexFreshness("scan_missing");
  let state: CadIndexState = scan.status === "done" || scan.status === "completed" ? "ready" : "incomplete";
  let reason = state === "ready" ? "" : "scan_incomplete";
  if (scan.status === "stale") { state = "stale"; reason = scan.phase === "xref-partial-refresh" ? "partial_refresh" : "scan_stale"; }
  const normalized = (value: string) => value.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
  const key = relativePath ? normalized(relativePath) : "";
  const assets = db.all<{ repo_rel_path: string; file_status?: string; bom_json?: string }>(
    `SELECT * FROM phoenix_cad_file_asset WHERE COALESCE(file_status,'present')='present' AND LOWER(filename) LIKE '%.fcstd'
      ${key ? "AND repo_rel_path IN (?,?)" : ""}`, key ? [key, `./${key}`] : [],
  );
  if (relativePath && !assets.length) {
    return { ...missingCadIndexFreshness("asset_missing"), scan_id: Number(scan.id), freshness_scope: "file" };
  }
  if (new Set(assets.map(asset => normalized(asset.repo_rel_path))).size !== assets.length) {
    state = "incomplete"; reason = "asset_path_ambiguous";
  }
  if (state === "ready") for (const asset of assets) {
    let metadata: any;
    try { metadata = JSON.parse(asset.bom_json || "null"); } catch { metadata = null; }
    if (!metadata || typeof metadata.size_bytes !== "number" || !Number.isSafeInteger(metadata.size_bytes) || metadata.size_bytes < 0
      || typeof metadata.mtime_ms !== "number" || !Number.isSafeInteger(metadata.mtime_ms) || metadata.mtime_ms <= 0 || metadata.parse_error) {
      state = "stale"; reason = "snapshot_metadata_missing"; break;
    }
    const root = path.resolve(workspace);
    const absolute = path.resolve(root, normalized(asset.repo_rel_path));
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) { state = "stale"; reason = "unsafe_asset_path"; break; }
    try {
      const realRelative = path.relative(fs.realpathSync(root), fs.realpathSync(absolute));
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("unsafe path");
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size !== metadata.size_bytes || Math.trunc(stat.mtimeMs) !== metadata.mtime_ms) {
        state = "stale"; reason = "file_changed"; break;
      }
    } catch { state = "stale"; reason = "file_unreadable"; break; }
  }
  const bomExists = hasTable(db, "phoenix_cad_bom_line");
  return { index_state: state, index_pending: state === "incomplete", index_stale: state === "stale", index_reason: reason,
    bom_index_state: bomExists ? state : "missing", bom_index_pending: !bomExists || state === "incomplete",
    bom_index_stale: bomExists && state === "stale", scan_id: Number(scan.id), freshness_scope: relativePath ? "file" : "workspace" };
}

/**
 * Reject known stale indexed files; this is not the complete M2 export gate.
 * M2 must also validate schema/protocol, scan ownership and reference quality,
 * discover the current file set, and recheck inside a consistent snapshot and
 * at the publication boundary.
 */
export function assertCadBomSnapshotFresh(db: PnwDbAdapter, workspace: string): CadIndexFreshness {
  const state = readCadIndexFreshness(db, workspace);
  if (state.bom_index_state !== "ready") throw new Error(`BOM snapshot is not current (${state.index_reason || state.bom_index_state}); complete workspace scan required`);
  return state;
}
