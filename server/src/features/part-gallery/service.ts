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
import { observeGalleryScope, parseGalleryScopeProof, serializeGalleryScopeProof, type GalleryScopeProof } from "./scope.js";

const jobs = new Map<string, { root: string; data: GalleryJob; cancelled: boolean }>();
const clean = (root: string, error: unknown) => (error instanceof Error ? error.message : String(error)).split(root).join("[工作空间]");
const productKey = (value: string) => value ? relativeFile(value) : "";
function sourcePath(root: string, rel: string) {
  if (!/\.fcstd$/i.test(rel)) throw new Error("只支持 FCStd 文件");
  const key = relativeFile(rel);
  try { return safeFcstdPath(root, key); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`源文件已不存在：${key}。请刷新 CAD 索引和图片缓存；不会自动猜测新路径。`);
    throw error;
  }
}
function inspect(root: string, rel: string, db: PnwDbAdapter): { row: GalleryRow; reused: boolean } {
  const filename = sourcePath(root, rel), stamp = fileStamp(filename), old = cachedRow(db, rel);
  const archive = readFcstdBatchArchive(filename);
  const hash = fcstdFingerprint(archive.bytes), refs = pnwExtractXlinksFromDocumentXml(archive.xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "")).map(link => link.file);
  // Reuse only image bytes/metadata, never old cached traversal edges. A stamp
  // alone is not a cache-format version or a content fingerprint.
  if (old && old.source_stamp === stamp && old.source_hash === hash && old.status !== "error") {
    if (old.status !== "ready" || (() => { try { reusableImageBytes(root, db, old); return true; } catch { return false; } })()) {
      if (fileStamp(filename) !== stamp) throw new Error("读取期间 CAD 文件变化，请重新更新");
      return { row: { ...old, refs }, reused: true };
    }
  }
  const inferred = pnwInferBomFieldsFromFilename(rel), fields = extractFcstdEmbeddedBomSnapshot(archive.xml).fields;
  const kinds = pnwInferBomDocumentKinds(rel);
  const row: GalleryRow = { rel, part_number: fields?.PartNumber || inferred.PartNumber,
    part_version: fields?.PartVersion || inferred.PartVersion, part_name: fields?.PartName || inferred.PartName || path.basename(rel),
    type_code: fields?.TypeCode || inferred.TypeCode, role: kinds.drawing ? "drawing" : kinds.assembly ? "assembly" : "part",
    status: "missing", width: 0, height: 0, image_hash: "", source_stamp: stamp, source_hash: hash,
    updated_at: new Date().toISOString(), message: "源文件未保存缩略图", refs };
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
  return { row, reused: false };
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
  const root = fcstdWorkspace(workspace), files = indexFiles(root).filter(rel => {
    try { return fs.statSync(sourcePath(root, rel)).isFile(); } catch { return false; }
  });
  return { products: files.filter(rel => /\.assy\.fcstd$/i.test(rel)).sort(), indexed_files: files.length };
}
export function loadGallery(workspace: string, product = ""): GalleryResult {
  const root = fcstdWorkspace(workspace), key = productKey(product), db = openGalleryDb(root);
  const empty: GalleryResult = { product: key, updated_at: "", rows: [], issues: [] };
  try {
    if (cadPathExcludedFromDiscovery(key) || !db || !tableExists(db, "desk_cad_gallery_scope")) return empty;
    const scope = db.get<{ updated_at: string; issues_json: string; sources_json?: string }>("SELECT * FROM desk_cad_gallery_scope WHERE product=?", [key]);
    if (!scope) return empty;
    const proof = parseGalleryScopeProof(scope.sources_json, key), current = observeGalleryScope(root, key, proof ?? undefined);
    const live = new Set(current.members), sources = new Map(current.sources.map(source => [source.rel, source]));
    const rows = db.all("SELECT t.* FROM desk_cad_gallery_member m JOIN desk_cad_thumbnail t ON t.rel=m.rel WHERE m.product=? ORDER BY t.rel", [key])
      .filter(row => typeof row.rel === "string" && !cadPathExcludedFromDiscovery(row.rel)).map(decodeRow);
    const retained = rows.filter(row => live.has(row.rel)), removed = rows.length - retained.length;
    const sameMembers = JSON.stringify([...live].sort()) === JSON.stringify(retained.map(row => row.rel).sort());
    const pending = !proof || !current.complete || !sameMembers || removed > 0
      || serializeGalleryScopeProof({ version: 1, product: key, sources: current.sources }) !== serializeGalleryScopeProof(proof);
    for (const row of retained) {
      const source = sources.get(row.rel);
      if (source && (source.stamp !== row.source_stamp || source.hash !== row.source_hash)) { row.status = "stale"; row.message = "源文件已变化，请更新图片缓存"; }
      else if (!source) { row.status = "error"; row.message = "源文件结构无法读取，请先检查文件；未启动渲染"; }
    }
    const historical: GalleryIssue[] = JSON.parse(scope.issues_json);
    const issues = [...historical.filter(issue => live.has(issue.rel) && !cadPathExcludedFromDiscovery(issue.rel)), ...current.issues];
    if (pending) issues.push({ rel: key, message: `当前引用范围待更新，已隐藏 ${removed} 个旧成员；请更新图片缓存。旧图片及其他范围均保留。` });
    return { product: key, updated_at: scope.updated_at, rows: retained.map(row => withGeometry(root, db, row)),
      issues: [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()], ...(pending ? { scope_pending: true, removed_count: removed } : {}) };
  } finally { db?.close(); }
}
export function thumbnailBytes(workspace: string, rel: string): Buffer {
  const root = fcstdWorkspace(workspace), key = relativeFile(rel), db = openGalleryDb(root);
  try {
    if (!db || !tableExists(db, "desk_cad_thumbnail")) throw new Error("尚未建立缩略图缓存");
    const row = cachedRow(db, key);
    if (!row || row.status !== "ready" || fileStamp(sourcePath(root, key)) !== row.source_stamp) throw new Error("缩略图缺失或已过期，请更新图册");
    try { return reusableImageBytes(root, db, row); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("源 CAD 存在，但图片缓存缺失；请更新图片缓存，不需要修复模型路径");
      throw error;
    }
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
  const job = { root, data, cancelled: false }; jobs.set(data.id, job);
  void (async () => {
    let db: PnwDbAdapter | null = null;
    let readyCount = 0, missingCount = 0, errorCount = 0;
    const staged: GalleryRow[] = [];
    const assertActive = () => { if (job.cancelled) throw Object.assign(new Error("图片缓存任务已取消，原范围未替换；未修改 CAD"), { code: "gallery_cancelled" }); };
    try {
      db = openGalleryDb(root, true)!;
      await yieldToHost(); assertActive();
      // Observe actual saved links, independent of the shared image row. The
      // index supplies global seeds, not evidence that an old path still exists.
      const observed = observeGalleryScope(root, key);
      const oldScope = db.get("SELECT product FROM desk_cad_gallery_scope WHERE product=?", [key]);
      if (!observed.complete && oldScope) throw new Error("当前源文件或引用结构无法完整核对，原图册范围未替换；请先修复文件后更新");
      const members = observed.members, issues = [...observed.issues];
      const proof: GalleryScopeProof = { version: 1, product: key, sources: observed.sources };
      const sources = new Map(observed.sources.map(source => [source.rel, source]));
      data.total = members.length;
      for (const rel of members) {
        data.current_rel = rel;
        await yieldToHost();
        assertActive();
        try {
          const { row, reused } = inspect(root, rel, db); if (reused) data.reused++;
          const source = sources.get(rel);
          if (!source || row.source_hash !== source.hash || row.source_stamp !== source.stamp) throw new Error("读取期间 CAD 文件变化，请重新更新");
          staged.push(row);
          if (row.status === "ready") readyCount++; else missingCount++;
          if (row.status !== "ready") issues.push({ rel, message: row.message });
        } catch (error) {
          errorCount++;
          const message = clean(root, error); issues.push({ rel, message });
          const source = sources.get(rel);
          staged.push({ rel, part_number: "", part_version: "", part_name: path.basename(rel), type_code: "", role: /\.assy\.fcstd$/i.test(rel) ? "assembly" : "part",
            status: "error", width: 0, height: 0, image_hash: "", source_stamp: source?.stamp ?? "", source_hash: source?.hash ?? "", updated_at: new Date().toISOString(), message, refs: source?.refs ?? [] });
        }
        data.completed++; data.message = `已处理 ${data.completed} / ${data.total}：图片 ${readyCount}，缺图 ${missingCount}，失败 ${errorCount}，复用 ${data.reused} 项`;
      }
      await yieldToHost(); assertActive();
      // Recheck membership (including previously missing targets) and every
      // content hash before the single scope/row publication transaction.
      const final = observeGalleryScope(root, key, proof);
      if (final.complete !== observed.complete || (!final.complete && oldScope)
        || JSON.stringify(final.members) !== JSON.stringify(members)
        || serializeGalleryScopeProof({ version: 1, product: key, sources: final.sources }) !== serializeGalleryScopeProof(proof)
        || (key === "" && JSON.stringify(indexFiles(root)) !== JSON.stringify(seeds))) throw new Error("更新期间引用范围变化，原图册范围未替换，请重新更新");
      for (const source of observed.sources) {
        const filename = sourcePath(root, source.rel);
        if (fileStamp(filename) !== source.stamp || fcstdFingerprint(readFcstdBatchArchive(filename).bytes) !== source.hash
          || fileStamp(sourcePath(root, source.rel)) !== source.stamp) throw new Error("更新期间源文件变化，原图册范围未替换，请重新更新");
      }
      for (const source of observed.sources) {
        if (fileStamp(sourcePath(root, source.rel)) !== source.stamp) throw new Error("更新期间源文件变化，原图册范围未替换，请重新更新");
      }
      const updated = new Date().toISOString();
      const oldMembers = db.all<{ rel: string }>("SELECT rel FROM desk_cad_gallery_member WHERE product=?", [key]);
      const live = new Set(members), removed = oldMembers.filter(row => !live.has(row.rel)).length;
      db.exec("SAVEPOINT desk_gallery_members");
      try {
        for (const row of staged) saveRow(db, row);
        db.run("DELETE FROM desk_cad_gallery_member WHERE product=?", [key]);
        for (const rel of members) db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", [key, rel]);
        db.run("INSERT INTO desk_cad_gallery_scope(product,updated_at,issues_json,sources_json) VALUES(?,?,?,?) ON CONFLICT(product) DO UPDATE SET updated_at=excluded.updated_at,issues_json=excluded.issues_json,sources_json=excluded.sources_json", [key, updated, JSON.stringify(issues), serializeGalleryScopeProof(proof)]);
        db.exec("RELEASE desk_gallery_members");
      } catch (error) {
        try { db.exec("ROLLBACK TO desk_gallery_members; RELEASE desk_gallery_members"); }
        catch { throw new Error("图片缓存范围提交结果未确认，请加载缓存核对，不要重复运行；未修改 CAD"); }
        throw error;
      }
      data.removed_count = removed;
      data.state = issues.length ? "attention" : "done"; data.message = `图册更新完成：${members.length} 个文件，图片 ${readyCount}，缺图 ${missingCount}，失败 ${errorCount}，复用 ${data.reused} 项；清理本范围旧成员 ${removed} 个，${issues.length} 项提示。共享图片、其他范围及归档保留，未修改 CAD`;
    } catch (error) { data.state = job.cancelled ? "cancelled" : "failed"; data.message = clean(root, error); }
    finally { data.current_rel = ""; db?.close(); }
  })();
  return structuredClone(data);
}
export function galleryJob(workspace: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.root !== fcstdWorkspace(workspace)) throw new Error("任务不存在，请重新加载图册");
  return structuredClone(job.data);
}
export function cancelGalleryJob(workspace: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.root !== fcstdWorkspace(workspace)) throw new Error("任务不存在，请重新加载图册");
  if (job.data.state === "running") job.cancelled = true;
  return structuredClone(job.data);
}
