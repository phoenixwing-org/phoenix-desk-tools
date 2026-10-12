import type { PnwDbAdapter } from "@phoenix-wing/db-node";
import { safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { fileStamp, relativeFile, tableExists } from "./storage.js";
import type { GalleryRow } from "./types.js";

export type BoundingBox = { x_mm: number; y_mm: number; z_mm: number };
export type GeometrySource = { rel: string; stamp: string; hash: string };
export type GeometryRecord = { rel: string; sources: GeometrySource[]; box: BoundingBox | null; message: string };
export function validBoundingBox(value: unknown): value is BoundingBox {
  const box = value as BoundingBox | null;
  return !!box && [box.x_mm, box.y_mm, box.z_mm].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)
    && [box.x_mm, box.y_mm, box.z_mm].some(n => n > 0);
}
export function createGeometryTable(db: PnwDbAdapter) {
  db.exec(`CREATE TABLE IF NOT EXISTS desk_cad_geometry (
    rel TEXT PRIMARY KEY, sources_json TEXT NOT NULL, box_json TEXT NOT NULL,
    message TEXT NOT NULL, updated_at TEXT NOT NULL, algorithm_version INTEGER NOT NULL
  )`);
}
export function geometryRecord(db: PnwDbAdapter, rel: string): GeometryRecord | null {
  if (!tableExists(db, "desk_cad_geometry")) return null;
  const row = db.get<{ rel: string; sources_json: string; box_json: string; message: string; algorithm_version: number }>("SELECT * FROM desk_cad_geometry WHERE rel=?", [rel]);
  if (!row || row.algorithm_version !== 1) return null;
  try {
    const sources = JSON.parse(row.sources_json), box = JSON.parse(row.box_json);
    if (!Array.isArray(sources) || !sources.length || sources.length > 500 || sources.some(source => !source || typeof source.rel !== "string" || typeof source.stamp !== "string" || !/^[a-f0-9]{64}$/.test(source.hash))) return null;
    if (box !== null && !validBoundingBox(box)) return null;
    return { rel: row.rel, sources, box, message: row.message };
  } catch { return null; }
}
export function geometrySourcesCurrent(root: string, sources: GeometrySource[]) {
  return sources.every(source => {
    try { return fileStamp(safeFcstdPath(root, relativeFile(source.rel))) === source.stamp; }
    catch { return false; }
  });
}
export function saveGeometry(db: PnwDbAdapter, record: GeometryRecord) {
  if (record.box !== null && !validBoundingBox(record.box)) throw new Error("无效的零件边界盒");
  db.run("INSERT INTO desk_cad_geometry(rel,sources_json,box_json,message,updated_at,algorithm_version) VALUES(?,?,?,?,?,1) ON CONFLICT(rel) DO UPDATE SET sources_json=excluded.sources_json,box_json=excluded.box_json,message=excluded.message,updated_at=excluded.updated_at,algorithm_version=excluded.algorithm_version",
    [record.rel, JSON.stringify(record.sources), JSON.stringify(record.box), record.message, new Date().toISOString()]);
}
/** Browser and printing reads use SQLite + bounded stat checks, never a CAD kernel. */
export function withGeometry(root: string, db: PnwDbAdapter, row: GalleryRow): GalleryRow {
  const record = geometryRecord(db, row.rel), source = record?.sources.find(item => item.rel === row.rel);
  if (!record) return { ...row, bounding_box: null, dimension_message: "尺寸未获取，请更新尺寸" };
  if (!source || row.status === "stale" || row.status === "error" || source.stamp !== row.source_stamp || source.hash !== row.source_hash || !geometrySourcesCurrent(root, record.sources)) {
    return { ...row, bounding_box: null, dimension_message: "模型或引用已变化，请更新尺寸" };
  }
  return { ...row, bounding_box: record.box, dimension_message: record.message };
}
