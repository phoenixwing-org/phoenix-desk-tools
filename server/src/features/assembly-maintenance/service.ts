import fs from "node:fs";
import path from "node:path";
import type { AssemblyMaintenanceInspection, AssemblyMaintenanceLink } from "../../../../shared/assembly-maintenance.js";
import { fcstdFingerprint, fcstdWorkspace, readFcstdLightArchive, readFcstdLightBytes, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { readFcstdAssemblyState } from "../../lib/fcstdAssemblyState.js";
import { fcstdXmlObjects, xmlAttribute } from "../../lib/fcstdLinkIdentity.js";
import { CadObjectInfoBudget, measureCadObjectInfoJsonBytes } from "../cad-object-info/budget.js";
import { CadObjectInfoError, parseCadObjectDocumentXml } from "../cad-object-info/document.js";

export const ASSEMBLY_INSPECTION_RESPONSE_BYTES = 1024 * 1024;
const changed = () => new CadObjectInfoError("source_changed", "模型在检查期间已变化，请重新检查");
const inside = (root: string, filename: string) => {
  const rel = path.relative(root, filename);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
function sourcePath(workspacePath: string, filePath: string) {
  if (typeof workspacePath !== "string" || !workspacePath.trim() || workspacePath.includes("\0")
    || typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0") || !/\.fcstd$/i.test(filePath)) {
    throw new CadObjectInfoError("invalid_arguments", "请选择工作空间中的 FCStd 总成文件");
  }
  try {
    const root = fcstdWorkspace(workspacePath), entry = path.resolve(workspacePath);
    const selection = path.isAbsolute(filePath) && inside(entry, path.resolve(filePath)) ? path.relative(entry, filePath) : filePath;
    return { root, filename: safeFcstdPath(root, selection) };
  } catch (error) {
    if (/路径超出|符号链接/.test(error instanceof Error ? error.message : "")) {
      throw new CadObjectInfoError("path_escape", "文件必须位于工作空间内，且不能经过符号链接");
    }
    throw new CadObjectInfoError("io_error", "工作空间或总成文件不可读");
  }
}
function explicitLocalLinks(xml: string) {
  const local = new Set<string>();
  for (const object of fcstdXmlObjects(xml)) {
    const property = object.properties.get("LinkedObject");
    const tags = [...(property?.content || "").matchAll(/<XLink\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g)];
    if (/^App::PropertyXLink(?:Sub)?$/.test(property?.type || "") && tags.length === 1
      && /\sfile\s*=/.test(tags[0][0]) && xmlAttribute(tags[0][0], "file") === "") local.add(object.name);
  }
  return local;
}
/** Observe only the saved relative path. Existence does not prove object/subpath compatibility. */
function observePath(root: string, host: string, file: string | null, explicitLocal: boolean): Pick<AssemblyMaintenanceLink, "path_status" | "target_rel"> {
  if (explicitLocal) return { path_status: "local", target_rel: null };
  if (!file || file.includes("\0") || /[\r\n]/.test(file)) return { path_status: "unknown", target_rel: null };
  if (path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(file)) {
    return { path_status: "outside_workspace", target_rel: null };
  }
  const filename = path.resolve(path.dirname(host), file.replace(/\\/g, "/"));
  if (!inside(root, filename)) return { path_status: "outside_workspace", target_rel: null };
  const target_rel = path.relative(root, filename).replace(/\\/g, "/");
  if (!/\.fcstd$/i.test(filename)) return { path_status: "unknown", target_rel };
  let current = root;
  try {
    for (const segment of path.relative(root, filename).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return { path_status: "unknown", target_rel };
    }
    return { path_status: fs.statSync(filename).isFile() ? "present" : "unknown", target_rel };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    return { path_status: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unknown", target_rel };
  }
}
function sameStat(before: fs.Stats, after: fs.Stats) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs;
}

/** No Native, index, discovery, target-content reads, persistence or repair is performed. */
export async function inspectSavedAssembly(workspacePath: string, filePath: string, signal?: AbortSignal,
  budget = new CadObjectInfoBudget(signal, { bytes: ASSEMBLY_INSPECTION_RESPONSE_BYTES })): Promise<AssemblyMaintenanceInspection> {
  budget.check();
  const { root, filename } = sourcePath(workspacePath, filePath);
  try {
    await new Promise<void>(resolve => setImmediate(resolve)); budget.check();
    safeFcstdPath(root, path.relative(root, filename));
    const before = fs.statSync(filename);
    const archive = readFcstdLightArchive(filename, budget);
    const parsed = await parseCadObjectDocumentXml(archive.xml, signal, budget);
    budget.check();
    if (!parsed.document.objects.some(object => ["Assembly::AssemblyObject", "Assembly::AssemblyLink"].includes(object.type_id))) {
      throw new CadObjectInfoError("not_assembly", "当前保存文件未包含可识别的原生装配对象");
    }
    const saved = readFcstdAssemblyState(archive.xml), locals = explicitLocalLinks(archive.xml);
    const links = saved.links.map(row => {
      budget.check();
      return { ...row, ...observePath(root, filename, row.target_file, locals.has(row.object_name)) };
    });
    const sha256 = fcstdFingerprint(archive.bytes);
    const result: AssemblyMaintenanceInspection = {
      protocol_version: 1, rel: path.relative(root, filename).replace(/\\/g, "/"), scope: "current_saved_file", synchronization: "not_checked",
      source: { sha256, bytes: archive.bytes.byteLength, mtime_ms: before.mtimeMs }, links, joint_issues: saved.joint_issues,
      summary: { assembly_link_count: links.length, joint_issue_count: saved.joint_issues.length,
        missing_path_count: links.filter(link => link.path_status === "missing").length,
        unknown_path_count: links.filter(link => ["unknown", "outside_workspace"].includes(link.path_status)).length },
      warnings: ["仅检查当前文件已保存内容；未检查 FreeCAD 内存状态或子装配实时同步。", "路径存在不代表目标对象、子元素或关节兼容；未发现明确问题也不代表装配已验证正常。"],
      update: { available: false, reason_code: "requires_verified_preview", message: "保存态检查不是同步证明或写入许可；请明确勾选实例，另行生成通过独立重开核验的更新预览。本次检查不切换 Rigid、不修改或删除 Joint、不保存模型。" },
    };
    const responseBytes = await measureCadObjectInfoJsonBytes({ success: true, data: result }, budget);
    if (responseBytes > ASSEMBLY_INSPECTION_RESPONSE_BYTES) throw new CadObjectInfoError("resource_limit", "装配检查完整响应超过 1 MiB 安全上限");
    budget.check();
    if (safeFcstdPath(root, path.relative(root, filename)) !== filename) throw changed();
    const after = fs.statSync(filename);
    if (!sameStat(before, after)) throw changed();
    const current = readFcstdLightBytes(filename, budget);
    if (fcstdFingerprint(current) !== sha256 || !sameStat(before, fs.statSync(filename))) throw changed();
    budget.check();
    return result;
  } catch (error) {
    if (error instanceof CadObjectInfoError) throw error;
    if (/路径超出|符号链接/.test(error instanceof Error ? error.message : "")) throw changed();
    throw new CadObjectInfoError("invalid_fcstd_archive", "总成文件不可读或压缩包结构无效");
  }
}
