import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { strFromU8, unzipSync } from "fflate";
import { reconcileFcstdPropertyCounts } from "./fcstdPropertyCounts.js";
import { cadDirectoryExcludedFromDiscovery, cadPathExcludedFromDiscovery } from "./cadIndexScanScope.js";
import { verifyCadObjectArchive } from "../features/cad-object-info/archive.js";
import { CadObjectInfoError } from "../features/cad-object-info/error.js";
import type { CadObjectInfoBudget } from "../features/cad-object-info/budget.js";

export const fcstdFingerprint = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const skipDirs = new Set([".git", ".phoenix", "node_modules", ".venv", "__pycache__"]);
function inside(root: string, candidate: string) {
  const rel = path.relative(root, candidate);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
export function fcstdWorkspace(value: string): string {
  if (!value?.trim()) throw new Error("请先打开工作空间");
  const root = fs.realpathSync(value);
  if (!fs.statSync(root).isDirectory()) throw new Error("工作空间不是目录");
  return root;
}
export function safeFcstdPath(root: string, rel: string): string {
  const filename = path.resolve(root, rel.replace(/\\/g, "/"));
  if (!inside(root, filename)) throw new Error("路径超出工作空间");
  let current = root;
  for (const segment of path.relative(root, filename).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("不处理符号链接");
  }
  if (!inside(root, fs.realpathSync(filename))) throw new Error("路径超出工作空间");
  return filename;
}
export function readFcstdBatchArchive(filename: string, all = false) {
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("不是普通文件或超过 64 MiB 安全上限");
  const bytes = fs.readFileSync(filename);
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize;
    if (total > 256 * 1024 * 1024 || (entry.name === "Document.xml" && entry.originalSize > 16 * 1024 * 1024)) throw new Error("解压大小超出安全上限");
    return all || entry.name === "Document.xml";
  } });
  if (!files["Document.xml"]) throw new Error("FCStd 缺少 Document.xml");
  const xml = strFromU8(files["Document.xml"]);
  reconcileFcstdPropertyCounts(xml);
  return { bytes, files, xml };
}

export const FCSTD_LIGHT_XML_BYTES = 32 * 1024 * 1024;
const FCSTD_READ_BYTES = 64 * 1024 * 1024;

/** Fixed-length reads also bound a file which grows after its initial stat.
 * Only regular, non-symlink files are accepted. Callers still own workspace
 * containment and before/after source identity checks. */
export function readFcstdLightBytes(filename: string, budget?: CadObjectInfoBudget): Uint8Array {
  budget?.check();
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let failed = false, primary: unknown;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new CadObjectInfoError("invalid_arguments", "轻量读取只支持普通 FCStd 文件");
    if (stat.size > FCSTD_READ_BYTES) throw new CadObjectInfoError("resource_limit", "FCStd 文件超过 64 MiB 安全上限");
    const bytes = Buffer.alloc(stat.size + 1); let length = 0;
    while (length < bytes.length) {
      budget?.check();
      const read = fs.readSync(fd, bytes, length, Math.min(64 * 1024, bytes.length - length), length);
      if (!read) break;
      length += read;
    }
    if (length !== stat.size) throw new CadObjectInfoError("source_changed", "模型在读取期间已变化，请重新读取");
    budget?.check();
    return bytes.subarray(0, length);
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { fs.closeSync(fd); }
    catch (cleanup) {
      if (failed) throw new AggregateError([primary, cleanup], "FCStd 读取和文件关闭均失败");
      throw cleanup;
    }
  }
}

/** Read-only light/index profile: the same fflate extractor, a separate 32 MiB
 * XML budget, and strict container/UTF-8 verification. Full/write callers keep
 * readFcstdBatchArchive's 16 MiB budget and exact member spelling. */
export function readFcstdLightArchive(filename: string, budget?: CadObjectInfoBudget) {
  const bytes = readFcstdLightBytes(filename, budget);
  let total = 0, entries = 0, documents = 0, documentName = "";
  // Metadata only: fflate's fixed-size inflate output can truncate a dishonest
  // stream. Never let that first inflate run before proving its actual length.
  unzipSync(bytes, { filter: entry => {
    budget?.check();
    if (++entries > 10000) throw new CadObjectInfoError("resource_limit", "FCStd ZIP 目录超过 10000 个条目上限");
    total += entry.originalSize;
    if (total > 256 * 1024 * 1024) throw new CadObjectInfoError("resource_limit", "FCStd ZIP 声明总大小超过 256 MiB 安全上限");
    if (!/^document\.xml$/i.test(entry.name)) return false;
    if (++documents !== 1) throw new CadObjectInfoError("invalid_fcstd_archive", "FCStd 包含重复的 Document.xml 条目或大小写别名");
    if (entry.originalSize > FCSTD_LIGHT_XML_BYTES) throw new CadObjectInfoError("resource_limit", "Document.xml 超过 32 MiB 轻量读取上限");
    documentName = entry.name;
    return false;
  } });
  budget?.check();
  if (!documentName) throw new CadObjectInfoError("missing_document_xml", "FCStd 缺少 Document.xml");
  const span = verifyCadObjectArchive(bytes, undefined, budget, documentName);
  if (span.method === 8) {
    // A controlled validation pass, not a second public reader. The output is
    // capped at the declared size + one sentinel, at most 32 MiB + 1 byte.
    // Full/write retain their older 16 MiB reader; this does not fix that path.
    let actual: Buffer;
    try { actual = inflateRawSync(bytes.subarray(span.compressedStart, span.compressedStart + span.compressedBytes),
      { maxOutputLength: span.originalBytes + 1 }); }
    catch { throw new CadObjectInfoError("invalid_fcstd_archive", "Document.xml 压缩流或声明长度无效"); }
    budget?.check();
    if (actual.byteLength !== span.originalBytes) throw new CadObjectInfoError("invalid_fcstd_archive", "Document.xml 实际长度与声明不一致");
  }
  const files = unzipSync(bytes, { filter: entry => entry.name === documentName });
  budget?.check();
  const documentBytes = files[documentName];
  if (!documentBytes) throw new CadObjectInfoError("missing_document_xml", "FCStd 缺少 Document.xml");
  if (documentBytes.byteLength > FCSTD_LIGHT_XML_BYTES) throw new CadObjectInfoError("resource_limit", "Document.xml 超过 32 MiB 轻量读取上限");
  verifyCadObjectArchive(bytes, documentBytes, budget, documentName);
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(documentBytes); }
  catch { throw new CadObjectInfoError("invalid_document_xml", "Document.xml 包含无效 UTF-8 字节"); }
  budget?.check();
  return { bytes, documentBytes, xml };
}
/** Bounded disk discovery shared by count repair and explicit attribute writes. */
export async function visitFcstdBatch(root: string, scope: string, visit: (rel: string, filename: string) => void | Promise<void>,
  options: { maxFiles?: number; assertActive?: () => void; excludedDirectories?: readonly string[] } = {}) {
  const excludedDirectories = options.excludedDirectories ? new Set(options.excludedDirectories) : skipDirs;
  const dir = safeFcstdPath(root, scope);
  if (!fs.statSync(dir).isDirectory()) throw new Error("分析范围必须是目录");
  if (cadPathExcludedFromDiscovery(`${path.relative(root, dir).replace(/\\/g, "/")}/scope.FCStd`)) throw new Error("该目录不在默认扫描范围内");
  const errors: Array<{ rel: string; message: string }> = [];
  let scanned = 0; let visited = 0;
  const dirs = [dir];
  while (dirs.length) {
    options.assertActive?.();
    const current = dirs.pop()!;
    const entries = await fs.promises.readdir(safeFcstdPath(root, path.relative(root, current)), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      options.assertActive?.();
      if (++visited > 20000) throw new Error("范围超过 20000 个目录项，请缩小目录后重新分析");
      const filename = path.join(current, entry.name);
      const rel = path.relative(root, filename).replace(/\\/g, "/");
      if (entry.isSymbolicLink()) errors.push({ rel, message: "已跳过符号链接" });
      else if (entry.isDirectory() && !cadDirectoryExcludedFromDiscovery(entry.name) && !excludedDirectories.has(entry.name)) dirs.push(filename);
      else if (entry.isFile() && /\.fcstd$/i.test(entry.name)) {
        if (++scanned > (options.maxFiles ?? 1000)) throw new Error(`范围超过 ${options.maxFiles ?? 1000} 个 FCStd，请缩小目录后重新分析`);
        try { await visit(rel, safeFcstdPath(root, rel)); }
        catch (error) { errors.push({ rel, message: error instanceof Error ? error.message : String(error) }); }
      }
    }
  }
  return { batch_dir: path.relative(root, dir).replace(/\\/g, "/") || ".", scanned, errors };
}
