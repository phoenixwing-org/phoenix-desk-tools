import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { fcstdWorkspace, safeFcstdPath } from "./fcstdBatchFiles.js";
import { cachedRow, fileStamp, openGalleryDb, reusableImageBytes, tableExists } from "../features/part-gallery/storage.js";

/** Read only the saved PNG, never geometry or a FreeCAD process. */
export function extractFcstdThumbnail(archive: Uint8Array) {
  const files = unzipSync(archive, { filter: entry => {
    if (entry.name !== "thumbnails/Thumbnail.png") return false;
    if (entry.originalSize > 4 * 1024 * 1024) throw new Error("缩略图超过 4 MiB 上限");
    return true;
  } });
  const png = files["thumbnails/Thumbnail.png"];
  if (!png) return null;
  const bytes = Buffer.from(png);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("内嵌缩略图不是有效 PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error("缩略图尺寸超出安全范围");
  return { bytes, width, height };
}

export function readFileThumbnail(workspace: string, rel: string) {
  const root = fcstdWorkspace(workspace), normalized = rel.replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split("/").some(p => p === ".." || p === ".git") || !/\.fcstd$/i.test(normalized)) throw new Error("请指定工作空间内的 FCStd 文件");
  const filename = safeFcstdPath(root, normalized), stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("FCStd 不是普通文件或超过 64 MiB 上限");
  // A gallery/archive record proves ownership and freshness. Do not guess by PNG basename.
  let db: ReturnType<typeof openGalleryDb> = null;
  try {
    db = openGalleryDb(root);
    if (db && tableExists(db, "desk_cad_thumbnail")) {
      const row = cachedRow(db, normalized.replace(/^\.\//, ""));
      if (row?.status === "ready" && row.source_stamp === fileStamp(filename)) {
        const bytes = reusableImageBytes(root, db, row);
        return { data_url: `data:image/png;base64,${bytes.toString("base64")}`, width: row.width, height: row.height };
      }
    }
  } catch { /* A stale/missing archive falls back to the saved FCStd thumbnail. */ }
  finally { db?.close(); }
  const thumbnail = extractFcstdThumbnail(fs.readFileSync(filename));
  return thumbnail ? { data_url: `data:image/png;base64,${thumbnail.bytes.toString("base64")}`, width: thumbnail.width, height: thumbnail.height } : null;
}
