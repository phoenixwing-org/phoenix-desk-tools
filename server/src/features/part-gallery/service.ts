import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { extractFcstdThumbnail, readThumbnailPng } from "../../lib/fcstdThumbnail.js";
import { pnwExtractXlinksFromDocumentXml, pnwInferBomFieldsFromFilename, pnwInferBomDocumentKinds } from "@phoenix-wing/cad-core";
import { extractFcstdEmbeddedBomSnapshot } from "../../lib/fcstdDocumentXmlService.js";
import type { PnwDbAdapter } from "@phoenix-wing/db-node";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { cadPathExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import { cachedRow, decodeRow, fileStamp, imagePath, indexFiles, openGalleryDb, relativeFile, reusableImageBytes, safeDirectory, saveRow, tableExists } from "./storage.js";
import type { GalleryIssue, GalleryJob, GalleryResult, GalleryRow } from "./types.js";
import { withGeometry } from "./geometryStorage.js";

const jobs = new Map<string, { root: string; data: GalleryJob }>();
const clean = (root: string, error: unknown) => (error instanceof Error ? error.message : String(error)).split(root).join("[工作空间]");
const productKey = (value: string) => value ? relativeFile(value) : "";
function sourcePath(root: string, rel: string) {
  if (!/\.fcstd$/i.test(rel)) throw new Error("只支持 FCStd 文件");
  return safeFcstdPath(root, relativeFile(rel));
}
function inspect(root: string, rel: string, db: PnwDbAdapter): { row: GalleryRow; reused: boolean } {
  const filename = sourcePath(root, rel), stamp = fileStamp(filename), old = cachedRow(db, rel);
  if (old && old.source_stamp === stamp && old.status !== "error") {
    if (old.status !== "ready" || (() => { try { reusableImageBytes(root, db, old); return true; } catch { return false; } })()) return { row: old, reused: true };
  }
  const archive = readFcstdBatchArchive(filename);
  const inferred = pnwInferBomFieldsFromFilename(rel), fields = extractFcstdEmbeddedBomSnapshot(archive.xml).fields;
  const kinds = pnwInferBomDocumentKinds(rel);
  const row: GalleryRow = { rel, part_number: fields?.PartNumber || inferred.PartNumber,
    part_version: fields?.PartVersion || inferred.PartVersion, part_name: fields?.PartName || inferred.PartName || path.basename(rel),
    type_code: fields?.TypeCode || inferred.TypeCode, role: kinds.drawing ? "drawing" : kinds.assembly ? "assembly" : "part",
    status: "missing", width: 0, height: 0, image_hash: "", source_stamp: stamp, source_hash: fcstdFingerprint(archive.bytes),
    updated_at: new Date().toISOString(), message: "源文件未保存缩略图", refs: pnwExtractXlinksFromDocumentXml(archive.xml).map(link => link.file) };
  const thumbnail = extractFcstdThumbnail(archive.bytes);
  if (thumbnail) {
    const png = thumbnail.bytes;
    row.width = thumbnail.width; row.height = thumbnail.height;
    row.image_hash = fcstdFingerprint(png); row.status = "ready"; row.message = "源文件内嵌缩略图";
    const dir = safeDirectory(root, ".phoenix/thumbnail-cache", true), dest = path.join(dir, `${row.image_hash}.png`);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, png, { flag: "wx" });
    else if (fcstdFingerprint(fs.readFileSync(imagePath(root, row.image_hash))) !== row.image_hash) throw new Error("图片缓存内容已变化，请检查缓存文件");
  }
  if (fileStamp(filename) !== stamp) throw new Error("读取期间 CAD 文件变化，请重新更新");
  saveRow(db, row); return { row, reused: false };
}

/** Publish an explicitly rendered PNG into the same cache used by details and the gallery. */
export function cacheRenderedThumbnail(workspace: string, rel: string, png: Uint8Array, expectedHash: string, embedded = false) {
  const root = fcstdWorkspace(workspace), key = relativeFile(rel), filename = sourcePath(root, key);
  const thumbnail = readThumbnailPng(png), archive = readFcstdBatchArchive(filename);
  if (fcstdFingerprint(archive.bytes) !== expectedHash) throw new Error("源文件已变化，请重新生成");
  const db = openGalleryDb(root, true)!;
  try {
    const { row } = inspect(root, key, db);
    const hash = fcstdFingerprint(thumbnail.bytes), dir = safeDirectory(root, ".phoenix/thumbnail-cache", true);
    const destination = path.join(dir, `${hash}.png`);
    if (!fs.existsSync(destination)) fs.writeFileSync(destination, thumbnail.bytes, { flag: "wx" });
    else if (fcstdFingerprint(fs.readFileSync(imagePath(root, hash))) !== hash) throw new Error("图片缓存校验失败");
    if (fcstdFingerprint(readFcstdBatchArchive(filename).bytes) !== expectedHash) throw new Error("源文件已变化，请重新生成");
    saveRow(db, { ...row, status: "ready", width: thumbnail.width, height: thumbnail.height, image_hash: hash,
      source_stamp: fileStamp(filename), source_hash: expectedHash, updated_at: new Date().toISOString(),
      message: embedded ? "单件重新渲染缩略图（已写入 FCStd）" : "单件重新渲染缩略图（未修改 FCStd）" });
    return thumbnail;
  } finally { db.close(); }
}

export function galleryOptions(workspace: string) {
  const root = fcstdWorkspace(workspace), files = indexFiles(root);
  return { products: files.filter(rel => /\.assy\.fcstd$/i.test(rel)).sort(), indexed_files: files.length };
}
export function loadGallery(workspace: string, product = ""): GalleryResult {
  const root = fcstdWorkspace(workspace), key = productKey(product), db = openGalleryDb(root);
  const empty: GalleryResult = { product: key, updated_at: "", rows: [], issues: [] };
  try {
    if (cadPathExcludedFromDiscovery(key) || !db || !tableExists(db, "desk_cad_gallery_scope")) return empty;
    const scope = db.get<{ updated_at: string; issues_json: string }>("SELECT * FROM desk_cad_gallery_scope WHERE product=?", [key]);
    if (!scope) return empty;
    const rows = db.all("SELECT t.* FROM desk_cad_gallery_member m JOIN desk_cad_thumbnail t ON t.rel=m.rel WHERE m.product=? ORDER BY t.rel", [key])
      .filter(row => typeof row.rel === "string" && !cadPathExcludedFromDiscovery(row.rel)).map(decodeRow);
    for (const row of rows) {
      try { if (row.source_stamp && fileStamp(sourcePath(root, row.rel)) !== row.source_stamp) { row.status = "stale"; row.message = "源文件已变化，请更新图册"; } }
      catch { row.status = "error"; row.message = "源文件缺失或不可访问"; }
    }
    const issues: GalleryIssue[] = JSON.parse(scope.issues_json);
    return { product: key, updated_at: scope.updated_at, rows: rows.map(row => withGeometry(root, db, row)), issues: issues.filter(issue => !cadPathExcludedFromDiscovery(issue.rel)) };
  } finally { db?.close(); }
}
export function thumbnailBytes(workspace: string, rel: string): Buffer {
  const root = fcstdWorkspace(workspace), key = relativeFile(rel), db = openGalleryDb(root);
  try {
    if (!db || !tableExists(db, "desk_cad_thumbnail")) throw new Error("尚未建立缩略图缓存");
    const row = cachedRow(db, key);
    if (!row || row.status !== "ready" || fileStamp(sourcePath(root, key)) !== row.source_stamp) throw new Error("缩略图缺失或已过期，请更新图册");
    return reusableImageBytes(root, db, row);
  } finally { db?.close(); }
}
export function startGalleryJob(workspace: string, product = "") {
  const root = fcstdWorkspace(workspace);
  if (cadPathExcludedFromDiscovery(product)) throw new Error("默认图册范围不包含隐藏目录、node_modules 或 __pycache__ 中的文件");
  const key = productKey(product);
  if (key) sourcePath(root, key);
  const seeds = key ? [key] : indexFiles(root);
  if (!seeds.length) throw new Error("CAD 索引中没有 FCStd 文件，请先更新 CAD 索引或指定产品总成");
  if (seeds.length > 5000) throw new Error("超过 5000 个文件，请按产品更新");
  if ([...jobs.values()].some(job => job.root === root && job.data.state === "running")) throw new Error("该工作空间正在更新图册，请等待完成");
  while (jobs.size >= 20) { const old = [...jobs].find(([, j]) => j.data.state !== "running"); if (!old) throw new Error("任务繁忙"); jobs.delete(old[0]); }
  const data: GalleryJob = { id: randomUUID(), product: key, state: "running", completed: 0, total: seeds.length, reused: 0, current_rel: "", message: "正在读取缩略图" };
  jobs.set(data.id, { root, data });
  void (async () => {
    let db: PnwDbAdapter | null = null;
    let readyCount = 0, missingCount = 0, errorCount = 0;
    const members: string[] = [], issues: GalleryIssue[] = [];
    const graph = new Map<string, string[]>();
    try {
      db = openGalleryDb(root, true)!;
      const queue = [...seeds]; const queued = new Set(queue);
      for (let i = 0; i < queue.length; i++) {
        const rel = queue[i]; members.push(rel); data.current_rel = rel; data.total = queue.length;
        await yieldToHost();
        try {
          const { row, reused } = inspect(root, rel, db); if (reused) data.reused++;
          if (row.status === "ready") readyCount++; else missingCount++;
          if (row.status !== "ready") issues.push({ rel, message: row.message });
          const targets: string[] = [];
          for (const file of row.refs) {
            try {
              const resolved = path.relative(root, path.resolve(path.dirname(sourcePath(root, rel)), file.replace(/\\/g, "/"))).replace(/\\/g, "/");
              // Excluded directories are outside discovery, not missing dependencies.
              if (cadPathExcludedFromDiscovery(resolved)) continue;
              const target = relativeFile(resolved);
              sourcePath(root, target); targets.push(target);
              if (key && !queued.has(target)) {
                if (queue.length >= 5000) throw new Error("引用范围超过 5000 个文件");
                queued.add(target); queue.push(target);
              }
            } catch (error) { issues.push({ rel, message: `引用 ${file}：${clean(root, error)}` }); }
          }
          graph.set(rel, targets);
        } catch (error) {
          errorCount++;
          const message = clean(root, error); issues.push({ rel, message });
          saveRow(db, { rel, part_number: "", part_version: "", part_name: path.basename(rel), type_code: "", role: /\.assy\.fcstd$/i.test(rel) ? "assembly" : "part",
            status: "error", width: 0, height: 0, image_hash: "", source_stamp: "", source_hash: "", updated_at: new Date().toISOString(), message, refs: [] });
        }
        data.completed++; data.total = queue.length; data.message = `已处理 ${data.completed} / ${data.total}：图片 ${readyCount}，缺图 ${missingCount}，失败 ${errorCount}，复用 ${data.reused} 项`;
      }
      // Iterative DFS: report dependency cycles without recursion/stack overflow.
      const done = new Set<string>(), active = new Set<string>();
      for (const start of members) {
        const stack: Array<[string, boolean]> = [[start, false]];
        while (stack.length) {
          const [node, exit] = stack.pop()!;
          if (exit) { active.delete(node); done.add(node); continue; }
          if (active.has(node)) { issues.push({ rel: node, message: "文件引用存在循环，已去重停止展开" }); continue; }
          if (done.has(node)) continue;
          active.add(node); stack.push([node, true]);
          for (const next of graph.get(node) ?? []) stack.push([next, false]);
        }
      }
      const updated = new Date().toISOString();
      db.exec("SAVEPOINT desk_gallery_members");
      try {
        db.run("DELETE FROM desk_cad_gallery_member WHERE product=?", [key]);
        for (const rel of members) db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", [key, rel]);
        db.run("INSERT INTO desk_cad_gallery_scope(product,updated_at,issues_json) VALUES(?,?,?) ON CONFLICT(product) DO UPDATE SET updated_at=excluded.updated_at,issues_json=excluded.issues_json", [key, updated, JSON.stringify(issues)]);
        db.exec("RELEASE desk_gallery_members");
      } catch (error) { db.exec("ROLLBACK TO desk_gallery_members; RELEASE desk_gallery_members"); throw error; }
      data.state = issues.length ? "attention" : "done"; data.message = `图册更新完成：${members.length} 个文件，图片 ${readyCount}，缺图 ${missingCount}，失败 ${errorCount}，复用 ${data.reused} 项；${issues.length} 项提示，未修改 CAD`;
    } catch (error) { data.state = "failed"; data.message = clean(root, error); }
    finally { data.current_rel = ""; db?.close(); }
  })();
  return structuredClone(data);
}
export function galleryJob(workspace: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.root !== fcstdWorkspace(workspace)) throw new Error("任务不存在，请重新加载图册");
  return structuredClone(job.data);
}
