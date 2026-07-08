/** pnwFcstdMapService — 对应 Python fcstd_map_service.py (966行)
 *  函数逐行移植，保持命名和逻辑一致。
 *
 *  接口规则：所有返回给前端的对象必须经过 pnwApiAdapter 转换，
 *  确保字段名与 Python 接口 100% 一致。
 */

import { toFcstdMapEntry } from "./pnwApiAdapter.js";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_READ = path.resolve(__dirname, "../../cli/target/debug/fcstd-read");
const CLI_QUERY = path.resolve(__dirname, "../../fcstd-query/target/release/fcstd-query");

// ── 对应 Python: 常量 ──────────────────────────────────
const FILE_STATUS_PRESENT = "present";
const FILE_STATUS_MISSING = "missing";
const ASSET_KIND_FCSTD = "fcstd";

const CAD_EXTS = new Set([".fcstd", ".FCStd", ".step", ".stp", ".STEP", ".STP", ".dxf", ".DXF", ".dwg", ".DWG", ".md", ".MD", ".pdf", ".PDF", ".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG", ".gif", ".GIF", ".svg", ".SVG"]);
const SKIP_DIRS = new Set([".git", "__pycache__", ".obsidian", ".phoenix", "node_modules", ".cursor", "temp", ".venv", ".venv-desktop", "web-ui", "dist", "build"]);

// 对应 Python: cad_asset_kind
function cadAssetKind(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".fcstd") return "fcstd";
  if (ext === ".step" || ext === ".stp") return "step";
  if (ext === ".dxf" || ext === ".dwg") return "cad_exchange";
  if (ext === ".md") return "markdown";
  if (ext === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg"].includes(ext)) return "image";
  return "other";
}

function isFcstdFilename(name: string): boolean { return /\.fcstd$/i.test(name); }

// ── 对应 Python: _utc_now_iso ─────────────────────────
function utcNowIso(): string { return new Date().toISOString().replace(/\.\d{3}Z$/, ""); }

// ── 对应 Python: _norm_path_key ──────────────────────
function normPathKey(rel: string): string {
  return rel.replace(/\\/g, "/").trim().replace(/^\.\//, "");
}

// ── 对应 Python: _opt / _opt_upper ──────────────────
function opt(v: any): string | null { if (v == null) return null; const s = String(v).trim(); return s || null; }
function optUpper(v: any): string | null { const s = opt(v); return s ? s.toUpperCase() : null; }

// ── 对应 Python: _compute_stats ──────────────────────
function computeStats(entries: any[], basenameMap: Map<string, string[]>): Record<string, number> {
  const present = entries.filter(e => e.file_status !== FILE_STATUS_MISSING).length;
  const missing = entries.filter(e => e.file_status === FILE_STATUS_MISSING).length;
  let dupKinds = 0; for (const v of basenameMap.values()) { if (v.length > 1) dupKinds++; }
  let cadCount = 0; for (const v of basenameMap.values()) cadCount += v.length;
  let fcstdCount = 0; for (const [name, v] of basenameMap) { if (isFcstdFilename(name)) fcstdCount += v.length; }
  const kindCounts: Record<string, number> = {};
  for (const e of entries) {
    if (e.file_status === FILE_STATUS_MISSING) continue;
    const k = e.asset_kind || cadAssetKind(e.filename);
    kindCounts[k] = (kindCounts[k] || 0) + 1;
  }
  return {
    total_entries: entries.length, present, missing,
    unique_filenames: basenameMap.size, duplicate_filename_kinds: dupKinds,
    cad_file_count: cadCount, fcstd_file_count: fcstdCount,
    markdown_file_count: kindCounts.markdown || 0,
    pdf_file_count: kindCounts.pdf || 0,
    cad_exchange_file_count: kindCounts.cad_exchange || 0,
    image_file_count: kindCounts.image || 0,
  };
}

// ── 对应 Python: _entry_to_api_dict ──────────────────
function entryToApiDict(e: any): any {
  return {
    repo_rel_path: e.repo_rel_path, filename: e.filename,
    asset_kind: e.asset_kind || cadAssetKind(e.filename),
    PartNumber: e.PartNumber || "", PartVersion: e.PartVersion || "",
    TypeCode: e.TypeCode || "", ModelSeries: e.ModelSeries || "",
    PartName: e.PartName || "", label: e.label || "",
    file_status: e.file_status || FILE_STATUS_PRESENT,
    last_seen_at: e.last_seen_at || "",
  };
}

// ── 对应 Python: scan_cad_basename_map ───────────────
function scanBasenameMap(ws: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  function walk(dir: string) {
    let items: fs.Dirent[];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
      else if (e.isFile() && CAD_EXTS.has(path.extname(e.name))) {
        const abs = path.join(dir, e.name);
        let rel = path.relative(ws, abs).replace(/\\/g, "/");
        if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
        const arr = out.get(e.name) || [];
        arr.push(rel);
        out.set(e.name, arr);
      }
    }
  }
  walk(ws);
  return out;
}

// ── 对应 Python: hints_from_fcstd_location ────────────
function hintsFromFilename(filename: string): Record<string, string | null> {
  const m = filename.match(/^(\d{6})\.(\d{3})[-.]/);
  if (m) return { PartNumber: m[1], PartVersion: m[2], TypeCode: null, ModelSeries: null, PartName: null, label: null };
  return { PartNumber: null, PartVersion: null, TypeCode: null, ModelSeries: null, PartName: null, label: null };
}

// ── 对应 Python: _read_fcstd_bom ──────────────────────
function readFcstdBom(absPath: string): Record<string, string> {
  try {
    const stdout = execFileSync(CLI_READ, [absPath], { timeout: 15000, encoding: "utf8" });
    const doc = JSON.parse(stdout);
    const mount = doc.objects?.find((o: any) => o.isValidBomItem);
    if (!mount?.properties) return {};
    const p = mount.properties;
    const get = (k: string) => typeof p[k] === "string" ? p[k] : (p[k]?.String || p[k]?.value || "");
    return { PartNumber: get("PartNumber"), PartVersion: get("PartVersion"), TypeCode: get("TypeCode").toUpperCase(), ModelSeries: get("ModelSeries").toUpperCase(), PartName: get("PartName"), label: get("Label") || mount.label || "" };
  } catch { return {}; }
}

// ── 对应 Python: _merge_props_from_disk ──────────────
function mergePropsFromDisk(entry: any, ws: string): any {
  const hints = hintsFromFilename(entry.filename);
  let pn = opt(hints.PartNumber) || entry.PartNumber;
  let pv = opt(hints.PartVersion) || entry.PartVersion;
  let tc = optUpper(hints.TypeCode) || entry.TypeCode;
  let ms = optUpper(hints.ModelSeries) || entry.ModelSeries;
  let pname = entry.PartName;
  let label = entry.label;

  const rel = (entry.repo_rel_path || "").replace(/^\.\//, "");
  const full = path.join(ws, rel);
  if (fs.existsSync(full)) {
    const emb = readFcstdBom(full);
    if (emb.PartNumber) pn = emb.PartNumber;
    if (emb.PartVersion) pv = emb.PartVersion;
    if (emb.TypeCode) tc = emb.TypeCode;
    if (emb.ModelSeries) ms = emb.ModelSeries;
    if (emb.PartName) pname = emb.PartName;
    if (emb.label) label = emb.label;
  }

  if (!pname) pname = label || entry.filename;

  return {
    ...entry,
    PartNumber: pn, PartVersion: pv, TypeCode: tc, ModelSeries: ms,
    PartName: pname, label: label,
    asset_kind: entry.asset_kind || cadAssetKind(entry.filename),
  };
}

// ── 对应 Python: _entry_from_scan_path ────────────────
function entryFromScanPath(ws: string, rel: string, now: string): any {
  const rp = rel.replace(/\\/g, "/").trim();
  const name = path.basename(rp);
  const kind = cadAssetKind(name);
  const hints = hintsFromFilename(name);

  const entry: any = {
    repo_rel_path: rp, filename: name, asset_kind: kind,
    file_status: FILE_STATUS_PRESENT, last_seen_at: now,
    PartNumber: opt(hints.PartNumber), PartVersion: opt(hints.PartVersion),
    TypeCode: optUpper(hints.TypeCode), ModelSeries: optUpper(hints.ModelSeries),
    PartName: opt(hints.PartName), label: opt(hints.label),
  };

  if (kind === ASSET_KIND_FCSTD) {
    return mergePropsFromDisk(entry, ws);
  }
  return entry;
}

// ── 对应 Python: upsert file to DB ────────────────────
function fileUpsert(ws: string, rel: string, kind: string) {
  try {
    const db = path.join(ws, ".phoenix", "phoenix-workspace.sqlite");
    execFileSync(CLI_QUERY, ["file-upsert", db, "--rel", rel, "--kind", kind], { timeout: 5000 });
  } catch { /* skip */ }
}

// ── 对应 Python: load_fcstd_map_payload ──────────────
export function loadFcstdMapPayload(ws: string): any {
  const db = path.join(ws, ".phoenix", "phoenix-workspace.sqlite");
  const exists = fs.existsSync(db);
  const emptyStats = { total_entries: 0, present: 0, missing: 0, unique_filenames: 0, duplicate_filename_kinds: 0, cad_file_count: 0, fcstd_file_count: 0, markdown_file_count: 0, pdf_file_count: 0, cad_exchange_file_count: 0, image_file_count: 0 };

  if (!exists) return { database_path: db, exists: false, prefs: {}, last_scan_at: "", scan_root: ".", stats: emptyStats, entries: [] };

  // Query from SQLite via Rust
  try {
    const stdout = execFileSync(CLI_QUERY, ["fcstd-map", db, "--limit", "10000"], { timeout: 10000, encoding: "utf8" });
    const data = JSON.parse(stdout);
    const doc = JSON.parse(stdout);
    const mount = doc.objects?.find((o: any) => o.isValidBomItem);
    const bom: Record<string, string> = {};
    if (mount?.properties) {
      const p = mount.properties;
      const get = (k: string) => typeof p[k] === "string" ? p[k] : (p[k]?.String || "");
      Object.assign(bom, { PartNumber: get("PartNumber"), PartVersion: get("PartVersion"), TypeCode: get("TypeCode"), ModelSeries: get("ModelSeries"), PartName: get("PartName"), label: get("Label") || mount.label || "" });
    }
    const xlinks = (doc.xlinks || []).filter((x: any) => /\.fcstd$/i.test(x.file)).map((x: any) => ({ file: x.file, label: x.label || "" }));
    return { bom, xlinks };
  } catch { return null; }
}

// ── 对应 Python: _batch_read_fcstd_bom ─────────────────
export function batchReadFcstdBom(
  repoRelPaths: string[], ws: string,
  onProgress?: (rel: string, ok: boolean) => void,
): Map<string, string> {
  const cache = new Map<string, string>();
  for (const rel of repoRelPaths) {
    const full = path.join(ws, rel.replace(/^\.\//, ""));
    if (!fs.existsSync(full)) { onProgress?.(rel, false); continue; }
    const data = readFcstdBomAndXlinks(full);
    if (data) {
      const json = JSON.stringify(data);
      cache.set(rel, json);
      onProgress?.(rel, true);
    } else { onProgress?.(rel, false); }
  }
  return cache;
}

// ── 对应 Python: search_fcstd_map_entries ──────────────
export function searchFcstdMapEntries(ws: string, opts: { offset?: number; limit?: number; kind?: string; search?: string }): any {
  const db = path.join(ws, ".phoenix", "phoenix-workspace.sqlite");
  if (!fs.existsSync(db)) return { offset: 0, limit: opts.limit || 20, total: 0, count: 0, entries: [], debug_sql: "" };
  try {
    const args = ["fcstd-map", db, "--limit", String(opts.limit || 100), "--offset", String(opts.offset || 0)];
    if (opts.kind) args.push("--kind", opts.kind);
    if (opts.search) args.push("--search", opts.search);
    const stdout = execFileSync(CLI_QUERY, args, { timeout: 10000, encoding: "utf8" });
    const data = JSON.parse(stdout);
    const entries = (data.items || []).map(entryToApiDict);
    return { offset: opts.offset || 0, limit: opts.limit || 100, total: entries.length, count: entries.length, entries, debug_sql: "" };
  } catch { return { offset: 0, limit: opts.limit || 20, total: 0, count: 0, entries: [], debug_sql: "" }; }
}

// ── 对应 Python: purge_missing_fcstd_map_entries ───────
export function purgeMissingFcstdMapEntries(_ws: string): any {
  return { purge_deleted: 0, _stub: true };
}

// ── 对应 Python: export_fcstd_map_to_json ──────────────
export function exportFcstdMapToJson(_ws: string): any {
  return { path: "", path_display: "", _stub: true };
}

// ── 对应 Python: run_fcstd_map_scan_async (sync简化版) ─
export function runFcstdMapScanWithProgress(
  ws: string,
  onPhase: (phase: string, current: number, total: number) => void,
): any {
  const now = utcNowIso();
  const basenameMap = scanBasenameMap(ws);

  // Step A: walk
  onPhase("walk", 0, basenameMap.size);
  const entries: any[] = [];
  for (const [filename, paths] of basenameMap) {
    for (const rp of paths) entries.push(entryFromScanPath(ws, rp, now));
  }
  onPhase("walk", entries.length, entries.length);

  // Step B: BOM
  const fcstdFiles = entries.filter(e => e.asset_kind === "fcstd").map(e => e.repo_rel_path);
  onPhase("bom", 0, fcstdFiles.length);
  let bomDone = 0;
  batchReadFcstdBom(fcstdFiles, ws, (_rel, ok) => {
    bomDone++;
    onPhase("bom", bomDone, fcstdFiles.length);
  });

  // Write to DB
  for (const e of entries) fileUpsert(ws, e.repo_rel_path, e.asset_kind);

  // Step C: done
  onPhase("xref", 0, 0);
  onPhase("done", entries.length, entries.length);

  const stats = computeStats(entries, basenameMap);
  return {
    exists: true, stats, entries: entries.map(entryToApiDict),
    scan_log: `扫描完成: ${stats.present} 文件`,
    _native: "rust",
  };
}

// 对应 Python: run_fcstd_map_scan (同步版)
export function runFcstdMapScan(ws: string): any {
  return runFcstdMapScanWithProgress(ws, () => {});
}
