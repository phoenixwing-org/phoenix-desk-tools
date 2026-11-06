import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { cadPathExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import { inspectFcstdBatchTarget } from "../../lib/fcstdDocumentXmlService.js";
import { fileStamp, openGalleryDb, relativeFile } from "./storage.js";
import { loadGallery } from "./service.js";
import { createGeometryTable, geometryRecord, geometrySourcesCurrent, saveGeometry, validBoundingBox, type GeometrySource } from "./geometryStorage.js";
import { geometryReadFailureMessage, geometryResultFailureMessage, geometryResultSuccessMessage, readGeometryBatch, type GeometryInput, type GeometryResult } from "./geometryRunner.js";
import { fcstdNativeXlinkFiles } from "../../lib/fcstdNativeXlinkFiles.js";
import type { GalleryJob } from "./types.js";
import type { PnwDbAdapter } from "@phoenix-wing/db-node";

const jobs = new Map<string, { root: string; data: GalleryJob }>();
type Prepared = { input: GeometryInput; sources: GeometrySource[] };
/** Compatibility name; native preflight is shared with explicit thumbnail rendering. */
export const geometryXlinkFiles = fcstdNativeXlinkFiles;
export function geometrySnapshot(root: string, rel: string, kind: "part" | "assembly" = "part"): Prepared {
  const queue = [relativeFile(rel)], seen = new Set<string>(), sources: GeometrySource[] = [];
  let node = "";
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i]; if (seen.has(key)) continue; seen.add(key);
    if (!/\.fcstd$/i.test(key)) throw new Error("模型依赖不是 FCStd");
    const filename = safeFcstdPath(root, key), stamp = fileStamp(filename), archive = readFcstdBatchArchive(filename);
    if (i === 0) {
      const target = inspectFcstdBatchTarget(archive.xml);
      node = target.objectName;
      if (kind === "assembly" && !["Assembly::AssemblyObject", "App::Part", "App::LinkGroup"].includes(target.typeId)) throw new Error("未找到唯一总成几何根对象");
    }
    sources.push({ rel: key, stamp, hash: fcstdFingerprint(archive.bytes) });
    if (fileStamp(filename) !== stamp) throw new Error("模型读取期间变化，请重新更新尺寸");
    for (const file of geometryXlinkFiles(archive.xml)) {
      const normalized = file.replace(/\\/g, "/");
      if (!/\.fcstd$/i.test(normalized) || /^(?:\/|[A-Za-z][\w+.-]*:)/.test(normalized)) throw new Error("模型依赖不是工作空间内的 FCStd");
      const target = relativeFile(path.relative(root, path.resolve(path.dirname(filename), normalized)).replace(/\\/g, "/"));
      if (!queue.includes(target)) queue.push(target);
      if (queue.length > 500) throw new Error("单个模型依赖超过 500 个文件，请缩小范围");
    }
  }
  return { input: { rel, filename: safeFcstdPath(root, rel), node, ...(kind === "assembly" ? { kind } : {}) }, sources };
}
function snapshotUnchanged(root: string, sources: GeometrySource[]) {
  return geometrySourcesCurrent(root, sources) && sources.every(source => {
    try { return fcstdFingerprint(readFcstdBatchArchive(safeFcstdPath(root, source.rel)).bytes) === source.hash; }
    catch { return false; }
  });
}
/** Explicit geometry operation. The ordinary thumbnail extraction job stays ZIP-only. */
export function startGeometryJob(workspace: string, product = "", read = readGeometryBatch) {
  const root = fcstdWorkspace(workspace);
  if (cadPathExcludedFromDiscovery(product)) throw new Error("默认图册范围不包含隐藏目录、node_modules 或 __pycache__ 中的文件");
  const key = product ? relativeFile(product) : "";
  const catalog = loadGallery(root, key);
  if (!catalog.updated_at || !catalog.rows.length) throw new Error("请先更新缩略图缓存，再获取模型尺寸");
  if (catalog.scope_pending) throw new Error("源文件已变化或引用范围待核对，请先更新图册再获取尺寸");
  if (catalog.rows.length > 5000) throw new Error("超过 5000 个文件，请按产品更新尺寸");
  if (catalog.rows.some(row => row.status === "stale")) throw new Error("源文件已变化，请先更新图册再获取尺寸");
  if ([...jobs.values()].some(job => job.root === root && job.data.state === "running")) throw new Error("该工作空间正在读取尺寸，请等待完成");
  while (jobs.size >= 20) { const old = [...jobs].find(([, job]) => job.data.state !== "running"); if (!old) throw new Error("尺寸任务繁忙"); jobs.delete(old[0]); }
  const data: GalleryJob = { id: randomUUID(), product: key, state: "running", completed: 0, total: catalog.rows.length, reused: 0, current_rel: "", message: "正在检查零件与总成尺寸缓存" };
  jobs.set(data.id, { root, data });
  void (async () => {
    let completed = 0, missing = 0;
    let db: PnwDbAdapter | null = null;
    try {
      db = openGalleryDb(root, true)!;
      const cache = db;
      createGeometryTable(cache);
      const pending: Prepared[] = [];
      const progress = () => { data.message = `尺寸 ${data.completed} / ${data.total}：已获取 ${completed}，未获取 ${missing}，复用 ${data.reused}`; };
      for (const row of catalog.rows) {
        await yieldToHost(); data.current_rel = row.rel;
        if (row.role === "drawing") {
          const sources = [{ rel: row.rel, hash: row.source_hash, stamp: row.source_stamp }];
          saveGeometry(cache, { rel: row.rel, sources, box: null, message: "图纸请查看源模型尺寸" });
          missing++; data.completed++; progress(); continue;
        }
        const old = geometryRecord(cache, row.rel);
        if (old?.box && old.kind === row.role && old.sources[0]?.rel === row.rel && old.sources[0]?.hash === row.source_hash && old.sources[0]?.stamp === row.source_stamp && geometrySourcesCurrent(root, old.sources)) {
          data.reused++; completed++; data.completed++; progress(); continue;
        }
        try {
          pending.push(geometrySnapshot(root, row.rel, row.role));
        } catch {
          const sources = [{ rel: row.rel, hash: row.source_hash, stamp: row.source_stamp }];
          if (row.source_hash && row.source_stamp) saveGeometry(cache, { rel: row.rel, sources, box: null, kind: row.role, message: "主实体或依赖无法安全确定，请在文件详情确认" });
          missing++; data.completed++; progress();
        }
      }
      for (let offset = 0; offset < pending.length; offset += 100) {
        const chunk = pending.slice(offset, offset + 100), byRel = new Map(chunk.map(item => [item.input.rel, item]));
        let results: GeometryResult[], readFailed = false, readFailureMessage = "";
        try {
          results = await read(chunk.map(item => item.input), result => {
            if (!byRel.has(result.rel)) throw new Error("尺寸返回了未知的文件");
            data.current_rel = result.rel;
            data.message = `正在读取零件或总成几何：${data.completed} / ${data.total} 已完成`;
          });
          // Streamed output only updates progress. Persist nothing until the final
          // report has passed the reader's validation and all identities match.
          if (!Array.isArray(results) || results.length !== chunk.length || results.some((result, index) => result.rel !== chunk[index].input.rel)) throw new Error("尺寸结果不完整");
        } catch (cause) {
          readFailed = true;
          readFailureMessage = geometryReadFailureMessage(cause) || "FreeCADCmd 尺寸读取失败或超时，请确认安装目录后重试";
          results = chunk.map(item => ({ rel: item.input.rel, bounding_box: null, message: "读取失败" }));
        }
        for (const result of results) {
          const prepared = byRel.get(result.rel);
          if (!prepared) throw new Error("尺寸返回了未知的文件");
          data.current_rel = result.rel;
          const current = snapshotUnchanged(root, prepared.sources);
          const kind = prepared.input.kind || "part", success = geometryResultSuccessMessage(result, kind);
          const box = current && validBoundingBox(result.bounding_box) && (kind === "part" || success) ? result.bounding_box : null;
          // Only fixed status text is persisted; no native errors or absolute paths.
          saveGeometry(cache, { rel: result.rel, sources: prepared.sources, box, kind, message: box ? success || "主实体边界盒 X × Y × Z（mm）" : !current ? "模型或引用在读取期间变化，请重新更新尺寸" : readFailed ? readFailureMessage : geometryResultFailureMessage(result) || "模型没有可安全确认的有效边界盒" });
          if (box) completed++; else missing++;
          data.completed++; progress();
        }
      }
      data.state = missing ? "attention" : "done";
      data.message = `尺寸更新完成：已获取 ${completed}，未获取 ${missing}，复用 ${data.reused}；只读零件/总成几何包络 X × Y × Z（mm），未求解或修改 CAD`;
    } catch {
      data.state = "failed"; data.message = "尺寸缓存更新失败，请检查工作空间数据库后重试";
    } finally { data.current_rel = ""; db?.close(); }
  })();
  return structuredClone(data);
}
export function geometryJob(workspace: string, id: string): GalleryJob | null {
  const job = jobs.get(id);
  if (!job || job.root !== fcstdWorkspace(workspace)) return null;
  return structuredClone(job.data);
}
