import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync } from "fflate";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { readThumbnailPng } from "../../lib/fcstdThumbnail.js";
import { relativeFile, safeDirectory } from "../part-gallery/storage.js";

/** Replace only the embedded PNG; never save a temporary recoloured GUI document. */
export function writeFcstdThumbnail(workspace: string, rel: string, png: Uint8Array, expectedHash: string) {
  const root = fcstdWorkspace(workspace), key = relativeFile(rel);
  const filename = safeFcstdPath(root, key), image = readThumbnailPng(png);
  const archive = readFcstdBatchArchive(filename, true);
  if (fcstdFingerprint(archive.bytes) !== expectedHash) throw new Error("源文件已变化，未写入缩略图，请重新生成");
  archive.files["thumbnails/Thumbnail.png"] = image.bytes;
  if (Object.values(archive.files).reduce((sum, entry) => sum + entry.length, 0) > 256 * 1024 * 1024) throw new Error("新 FCStd 解压大小超过 256 MiB，未写入缩略图");
  const bytes = zipSync(archive.files, { level: 6 });
  if (bytes.length > 64 * 1024 * 1024) throw new Error("新 FCStd 超过 64 MiB，未写入缩略图");
  const directory = safeDirectory(root, ".phoenix/thumbnail-backups", true);
  const backup = path.join(directory, `${randomUUID()}.FCStd`);
  fs.writeFileSync(backup, archive.bytes, { flag: "wx" });
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.thumbnail-${randomUUID()}.tmp`);
  let created = false;
  try {
    const parent = safeFcstdPath(root, path.relative(root, path.dirname(filename)));
    if (!fs.statSync(parent).isDirectory()) throw new Error("源文件目录不可用");
    // Exclusive creation refuses pre-existing files/symlinks; durable backup
    // already exists, so one rename commits without moving away the source.
    fs.writeFileSync(temporary, bytes, { flag: "wx", mode: fs.statSync(filename).mode & 0o777 });
    created = true;
    if (fcstdFingerprint(readFcstdBatchArchive(safeFcstdPath(root, key)).bytes) !== expectedHash) throw new Error("源文件已变化，未写入缩略图，请重新生成");
    fs.renameSync(temporary, filename);
  } finally {
    // A cleanup error must not turn an already-committed write into failure.
    if (created) try { fs.rmSync(temporary, { force: true }); } catch { /* Backups remain recoverable. */ }
  }
  const persisted = readFcstdBatchArchive(safeFcstdPath(root, key), true), sourceHash = fcstdFingerprint(bytes);
  if (fcstdFingerprint(persisted.bytes) !== sourceHash || !Buffer.from(persisted.files["thumbnails/Thumbnail.png"] ?? []).equals(image.bytes)) {
    throw new Error("缩略图写入后校验失败，原文件备份已保留，请重新读取确认；未更新网页缓存");
  }
  return { sourceHash, backup: path.relative(root, backup).replace(/\\/g, "/"), ...image };
}
