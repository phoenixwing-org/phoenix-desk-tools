import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { reconcileFcstdPropertyCounts } from "./fcstdPropertyCounts.js";

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
/** Bounded disk discovery shared by count repair and explicit attribute writes. */
export async function visitFcstdBatch(root: string, scope: string, visit: (rel: string, filename: string) => void | Promise<void>,
  options: { maxFiles?: number; assertActive?: () => void; excludedDirectories?: readonly string[] } = {}) {
  const excludedDirectories = options.excludedDirectories ? new Set(options.excludedDirectories) : skipDirs;
  const dir = safeFcstdPath(root, scope);
  if (!fs.statSync(dir).isDirectory()) throw new Error("分析范围必须是目录");
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
      else if (entry.isDirectory() && !excludedDirectories.has(entry.name)) dirs.push(filename);
      else if (entry.isFile() && /\.fcstd$/i.test(entry.name)) {
        if (++scanned > (options.maxFiles ?? 1000)) throw new Error(`范围超过 ${options.maxFiles ?? 1000} 个 FCStd，请缩小目录后重新分析`);
        try { await visit(rel, safeFcstdPath(root, rel)); }
        catch (error) { errors.push({ rel, message: error instanceof Error ? error.message : String(error) }); }
      }
    }
  }
  return { batch_dir: path.relative(root, dir).replace(/\\/g, "/") || ".", scanned, errors };
}
