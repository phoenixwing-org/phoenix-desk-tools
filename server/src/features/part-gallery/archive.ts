import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fcstdWorkspace, fcstdFingerprint, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { openGalleryDb, relativeFile, safeDirectory } from "./storage.js";
import { loadGallery, thumbnailBytes } from "./service.js";
import { galleryDocument } from "./document.js";
import type { GalleryRow } from "./types.js";

export function selectedGallery(workspace: string, body: { product?: string; rels?: string[] }) {
  const result = loadGallery(workspace, body.product || "");
  if (!result.updated_at) throw new Error("请先更新图册");
  if (result.scope_pending) throw new Error("产品或零件引用范围已变化，请先更新图册；旧成员不能用于输出");
  if (result.rows.some(row => row.status === "stale")) throw new Error("产品或零件已变化，请先更新图册");
  if (!Array.isArray(body.rels) || !body.rels.length || body.rels.length > 5000 || new Set(body.rels).size !== body.rels.length) throw new Error("请选择需要输出的卡片");
  const byRel = new Map(result.rows.map(row => [row.rel, row]));
  const rows = body.rels.map(rel => { const row = byRel.get(rel); if (!row) throw new Error("所选文件不属于当前图册，请刷新"); return row; });
  return { ...result, rows };
}
export function printGallery(workspace: string, body: { product?: string; rels?: string[]; show_category?: boolean; show_dimensions?: boolean; show_part_number?: boolean; show_filenames?: boolean }) {
  for (const option of [body.show_category, body.show_dimensions, body.show_part_number, body.show_filenames]) {
    if (option !== undefined && typeof option !== "boolean") throw new Error("图册显示选项必须为布尔值");
  }
  const result = selectedGallery(workspace, body); let total = 0;
  return { html: galleryDocument(result.rows, result.product, result.updated_at, row => {
    const bytes = thumbnailBytes(workspace, row.rel); total += bytes.length;
    if (total > 64 * 1024 * 1024) throw new Error("打印图片超过 64 MiB，请缩小筛选范围");
    return `data:image/png;base64,${bytes.toString("base64")}`;
  }, { showCategory: body.show_category !== false, showDimensions: body.show_dimensions !== false, showPartNumber: body.show_part_number !== false, showFilenames: body.show_filenames === true }) };
}
export function archiveGallery(workspace: string, body: { product?: string; rels?: string[]; directory?: string; include_documents?: boolean; confirmed?: boolean }) {
  if (body.confirmed !== true || typeof body.directory !== "string" || typeof body.include_documents !== "boolean") throw new Error("归档需要明确目录和确认");
  const root = fcstdWorkspace(workspace), directory = relativeFile(body.directory.trim());
  const result = selectedGallery(root, body), ready = result.rows.filter(row => row.status === "ready");
  if (!ready.length) throw new Error("没有可归档的 PNG");
  let ancestor = path.join(root, directory);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  safeFcstdPath(root, path.relative(root, ancestor));
  const gitRoot = execFileSync("git", ["-C", ancestor, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  safeFcstdPath(root, path.relative(root, gitRoot));
  const docRel = body.include_documents ? `${directory}/documents/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}` : "";
  const outputs = ready.map(row => path.relative(gitRoot, path.join(root, directory, thumbnailArchiveName(row.rel))));
  if (docRel) outputs.push(...["catalog.html", "catalog.json"].map(name => path.relative(gitRoot, path.join(root, docRel, name))));
  let ignored = "";
  try { ignored = execFileSync("git", ["-C", gitRoot, "check-ignore", "--no-index", "-z", "--stdin"], { input: `${outputs.join("\0")}\0`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  if (ignored.trim()) throw new Error("归档目录被 Git 忽略，请选择可跟踪的目录");
  return writeArchive(root, directory, result, ready, docRel);
}
export function thumbnailArchiveName(rel: string): string {
  const parts = relativeFile(rel).split("/");
  const filename = parts.at(-1)!.replace(/\.fcstd$/i, ".png");
  return parts.length > 1 ? `${parts[0]}/${filename}` : filename;
}
function existingImage(root: string, rel: string): Buffer | null {
  // lstat catches dangling symlinks as well as links to existing files.
  let stat: fs.Stats;
  try { stat = fs.lstatSync(path.join(root, rel)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error(`目标不是可写 PNG：${rel}`);
  return fs.readFileSync(safeFcstdPath(root, rel));
}
function writeArchive(root: string, destRel: string, result: ReturnType<typeof selectedGallery>, ready: GalleryRow[], docRel: string) {
  const db = openGalleryDb(root, true)!;
  try {
    // Preflight ownership, names and source snapshots before writing any public PNG.
    const targets = new Set<string>();
    const prepared = ready.map(row => {
      const output = `${destRel}/${thumbnailArchiveName(row.rel)}`, key = output.toLowerCase();
      if (targets.has(key)) throw new Error(`缩略图同名冲突，未导出：${output}`);
      targets.add(key);
      const source = safeFcstdPath(root, row.rel);
      if (fcstdFingerprint(fs.readFileSync(source)) !== row.source_hash) throw new Error("源文件已变化，请更新图册后归档");
      const bytes = thumbnailBytes(root, row.rel);
      const registered = db.get<{ source_rel: string; image_hash: string }>("SELECT source_rel,image_hash FROM desk_cad_thumbnail_archive WHERE lower(output_rel)=lower(?)", [output]);
      if (registered && registered.source_rel !== row.rel) throw new Error(`缩略图路径属于另一源文件：${output}`);
      const old = existingImage(root, output), oldHash = old ? fcstdFingerprint(old) : "";
      if (old && oldHash !== row.image_hash && (!registered || oldHash !== registered.image_hash)) throw new Error(`已有 PNG 未登记或被外部修改，拒绝覆盖：${output}`);
      const parent = path.dirname(path.join(root, output));
      if (fs.existsSync(parent) && fs.readdirSync(parent).some(name => name.toLowerCase() === path.basename(output).toLowerCase() && name !== path.basename(output))) throw new Error(`缩略图大小写冲突：${output}`);
      return { row, output, bytes, oldHash, old };
    });
    const images = new Map<string, string>();
    let reused = 0, updated = 0;
    for (const item of prepared) {
      const { row, output, bytes, oldHash, old } = item;
      safeDirectory(root, path.posix.dirname(output), true);
      const current = existingImage(root, output);
      if ((current ? fcstdFingerprint(current) : "") !== oldHash) throw new Error(`导出期间目标已变化：${output}`);
      if (oldHash === row.image_hash) reused++;
      else if (!old) fs.writeFileSync(path.join(root, output), bytes, { flag: "wx" });
      else {
        const backupDir = safeDirectory(root, ".phoenix/thumbnail-archive-backups", true);
        fs.writeFileSync(path.join(backupDir, `${randomUUID()}.png`), old, { flag: "wx" });
        const temp = path.join(path.dirname(path.join(root, output)), `.thumbnail-${randomUUID()}.tmp`);
        try { fs.writeFileSync(temp, bytes, { flag: "wx" }); fs.renameSync(temp, safeFcstdPath(root, output)); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        updated++;
      }
      db.run("INSERT INTO desk_cad_thumbnail_archive(output_rel,source_rel,image_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(output_rel) DO UPDATE SET source_rel=excluded.source_rel,image_hash=excluded.image_hash,created_at=excluded.created_at", [output, row.rel, row.image_hash, new Date().toISOString()]);
      images.set(row.rel, docRel ? path.posix.relative(docRel, output) : output);
    }
    if (docRel) {
      const dest = safeDirectory(root, docRel, true);
      const manifest = { version: 2, product: result.product, updated_at: result.updated_at, rows: result.rows.map(row => ({ rel: row.rel, part_number: row.part_number, part_version: row.part_version, part_name: row.part_name, type_code: row.type_code, status: row.status, png: images.get(row.rel) || null })) };
      fs.writeFileSync(path.join(dest, "catalog.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
      fs.writeFileSync(path.join(dest, "catalog.html"), galleryDocument(result.rows, result.product, result.updated_at, row => (images.get(row.rel) || "").split("/").map(encodeURIComponent).join("/")), { flag: "wx" });
    }
    return { directory: destRel, document_directory: docRel, png_count: ready.length, reused, updated, skipped: result.rows.length - ready.length, documents: !!docRel, message: `PNG 已保存到稳定路径，复用 ${reused} 张、更新 ${updated} 张；未暂存、提交或推送 Git` };
  } finally { db.close(); }
}
