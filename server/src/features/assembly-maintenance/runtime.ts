import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";
import { refreshBomXrefsForHosts } from "../../lib/pnwBomXrefService.js";
import { openGalleryDb, tableExists } from "../part-gallery/storage.js";
import { createAssemblyUpdateService } from "./updates.js";

/** The engine location is host configuration, never a request field. Invalid
 * explicit settings must not silently select a different FreeCAD installation. */
export function configuredAssemblyFreecadHome(): string {
  const filename = path.join(runtimeUserDataDir(), "launcher-prefs.json");
  let configured: unknown, opened = false;
  try {
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); opened = true;
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024) throw new Error();
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (!count) break; length += count;
      }
      const same = (other: fs.Stats) => stat.dev === other.dev && stat.ino === other.ino && stat.size === other.size
        && stat.mtimeMs === other.mtimeMs && stat.ctimeMs === other.ctimeMs && stat.nlink === other.nlink;
      if (length !== stat.size || !same(fs.fstatSync(fd)) || !same(fs.lstatSync(filename))) throw new Error();
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      configured = (parsed as Record<string, unknown>).freecad_dir;
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (opened || (error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("FreeCAD 安装目录配置不可读，请检查本机设置");
  }
  if (configured !== undefined && typeof configured !== "string") throw new Error("FreeCAD 安装目录配置无效");
  if (typeof configured === "string" && /[\x00-\x1f]/.test(configured)) throw new Error("FreeCAD 安装目录配置无效");
  const value = typeof configured === "string" ? configured.trim() : "";
  if (value) {
    if (!path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new Error("FreeCAD 安装目录必须为本机绝对路径");
    return value;
  }
  if (os.platform() === "darwin") return "/Applications/FreeCAD.app";
  throw new Error("请先在本机设置中配置 FreeCAD 安装目录");
}

/** Publication already succeeded when called. Refresh failures must never turn
 * into a no-write result or authorize another publication. No CAD kernel runs. */
export async function refreshAssemblyDerivedData(root: string, rel: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const result = refreshBomXrefsForHosts(root, [rel]);
    if (result.index_pending) warnings.push("文件已发布；当前索引未包含该文件，请在 CAD 索引完整更新后核对 BOM");
    else warnings.push("已刷新该文件的引用投影；递归 BOM 仍需完整更新 CAD 索引后核对");
  } catch { warnings.push("文件已发布；引用索引刷新失败，请手动更新 CAD 索引"); }
  try {
    const db = openGalleryDb(root);
    if (db) try {
      db.exec("BEGIN TRANSACTION");
      if (tableExists(db, "desk_cad_thumbnail")) db.run("UPDATE desk_cad_thumbnail SET status='stale', message=? WHERE rel IN (?,?)", ["装配已更新，请重新生成缩略图", rel, `./${rel}`]);
      if (tableExists(db, "desk_cad_geometry")) db.run("DELETE FROM desk_cad_geometry WHERE rel IN (?,?)", [rel, `./${rel}`]);
      db.exec("COMMIT");
    } catch (error) { if (db.inTransaction) db.exec("ROLLBACK"); throw error; }
    finally { db.close(); }
  } catch { warnings.push("文件已发布；图册派生缓存未能标记过期，请手动刷新图册及尺寸"); }
  return warnings;
}

export const assemblyUpdateService = createAssemblyUpdateService({
  native: async input => {
    const { createAssemblyNativePreview } = await import("./native-preview.js");
    return createAssemblyNativePreview(configuredAssemblyFreecadHome())(input);
  },
  refresh: refreshAssemblyDerivedData,
});
