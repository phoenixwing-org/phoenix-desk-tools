import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import { fcstdFingerprint, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import type { GalleryRow } from "./types.js";

export function relativeFile(value: string): string {
  const rel = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split("/").some(p => !p || p === ".." || p === "." || p.toLowerCase() === ".git") || rel.includes("\0")) throw new Error("请使用工作空间内的相对路径，不允许 .. 或 .git");
  return rel;
}
/** Validate each existing component before creating a cache/export directory. */
export function safeDirectory(root: string, relative: string, create = false): string {
  const rel = relativeFile(relative); let current = root;
  for (const segment of rel.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) {
      if (!create) throw new Error("目录不存在");
      fs.mkdirSync(current);
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("目录不可用或为符号链接");
    safeFcstdPath(root, path.relative(root, current));
  }
  return current;
}
export function tableExists(db: PnwDbAdapter, table: string) {
  return !!db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
}
export function openGalleryDb(root: string, create = false): PnwDbAdapter | null {
  const filename = path.join(root, ".phoenix/phoenix-workspace.sqlite");
  if (!create && !fs.existsSync(filename)) return null;
  safeDirectory(root, ".phoenix", create);
  if (fs.existsSync(filename)) safeFcstdPath(root, ".phoenix/phoenix-workspace.sqlite");
  const db = pnwCreateDb(filename);
  if (create) db.exec(`
    CREATE TABLE IF NOT EXISTS desk_cad_thumbnail (
      rel TEXT PRIMARY KEY, part_number TEXT NOT NULL, part_version TEXT NOT NULL,
      part_name TEXT NOT NULL, type_code TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, image_hash TEXT NOT NULL,
      source_stamp TEXT NOT NULL, source_hash TEXT NOT NULL, updated_at TEXT NOT NULL,
      message TEXT NOT NULL, refs_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS desk_cad_thumbnail_part ON desk_cad_thumbnail(part_number,part_version);
    CREATE TABLE IF NOT EXISTS desk_cad_gallery_scope (product TEXT PRIMARY KEY, updated_at TEXT NOT NULL, issues_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS desk_cad_gallery_member (product TEXT NOT NULL, rel TEXT NOT NULL, PRIMARY KEY(product,rel));
    CREATE TABLE IF NOT EXISTS desk_cad_thumbnail_archive (output_rel TEXT PRIMARY KEY, source_rel TEXT NOT NULL, image_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS desk_cad_thumbnail_archive_source ON desk_cad_thumbnail_archive(source_rel,image_hash);
  `);
  return db;
}
export function decodeRow(row: any): GalleryRow {
  const { refs_json, ...data } = row;
  return { ...data, refs: JSON.parse(refs_json) };
}
export function cachedRow(db: PnwDbAdapter, rel: string): GalleryRow | null {
  const row = db.get("SELECT * FROM desk_cad_thumbnail WHERE rel=?", [rel]);
  return row ? decodeRow(row) : null;
}
export function saveRow(db: PnwDbAdapter, row: GalleryRow) {
  const { refs, ...data } = row; const values = { ...data, refs_json: JSON.stringify(refs) };
  const keys = Object.keys(values);
  db.run(`INSERT INTO desk_cad_thumbnail (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) ON CONFLICT(rel) DO UPDATE SET ${keys.filter(k => k !== "rel").map(k => `${k}=excluded.${k}`).join(",")}`, Object.values(values));
}
export function imagePath(root: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("无效的缩略图标识");
  return safeFcstdPath(root, `.phoenix/thumbnail-cache/${hash}.png`);
}
/** Stable public PNGs are preferred; the hash cache is only a fallback. No CAD ZIP is opened. */
export function reusableImageBytes(root: string, db: PnwDbAdapter, row: GalleryRow): Buffer {
  const archived = tableExists(db, "desk_cad_thumbnail_archive")
    ? db.all<{ output_rel: string }>("SELECT output_rel FROM desk_cad_thumbnail_archive WHERE source_rel=? AND image_hash=? ORDER BY created_at DESC", [row.rel, row.image_hash]) : [];
  for (const item of archived) {
    try {
      const filename = safeFcstdPath(root, relativeFile(item.output_rel));
      if (fs.statSync(filename).size > 4 * 1024 * 1024) continue;
      const bytes = fs.readFileSync(filename);
      if (fcstdFingerprint(bytes) === row.image_hash) return bytes;
    } catch { /* Missing/edited archives never authorize stale images. Try verified cache. */ }
  }
  const filename = imagePath(root, row.image_hash);
  if (fs.statSync(filename).size > 4 * 1024 * 1024) throw new Error("缓存图片超过上限");
  const bytes = fs.readFileSync(filename);
  if (fcstdFingerprint(bytes) !== row.image_hash) throw new Error("缓存图片校验失败");
  return bytes;
}
export function fileStamp(filename: string) {
  const s = fs.statSync(filename);
  if (!s.isFile()) throw new Error("不是普通文件");
  return [s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
}
export function indexFiles(root: string): string[] {
  const db = openGalleryDb(root);
  try {
    if (!db || !tableExists(db, "phoenix_cad_file_asset")) return [];
    // asset_kind describes CAD semantics (part/assembly/drawing), not the extension.
    return [...new Set(db.all<{ repo_rel_path: string }>("SELECT repo_rel_path FROM phoenix_cad_file_asset WHERE lower(repo_rel_path) LIKE '%.fcstd' AND file_status='present'").map(r => relativeFile(r.repo_rel_path)))];
  } finally { db?.close(); }
}
