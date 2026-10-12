import fs from "node:fs";
import path from "node:path";
import type { PnwCadNativeV1FcstdDocument } from "@phoenix-wing/cad-contracts";
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive } from "../../lib/fcstdBatchFiles.js";
import { assertCadObjectInfoActive, CadObjectInfoError, parseCadObjectDocumentXml } from "./document.js";
import { verifyCadObjectArchive } from "./archive.js";
import { CadObjectInfoBudget, measureCadObjectInfoJsonBytes } from "./budget.js";

export type CadObjectInfoResult = {
  document: PnwCadNativeV1FcstdDocument;
  source: { file_size: number; mtime_ms: number; document_xml_bytes: number };
  warnings: string[];
};

export async function readCadObjectInfo(workspacePath: string, filePath: string, signal?: AbortSignal, budget = new CadObjectInfoBudget(signal)): Promise<CadObjectInfoResult> {
  assertCadObjectInfoActive(signal, budget);
  if (typeof workspacePath !== "string" || typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0")) {
    throw new CadObjectInfoError("invalid_arguments", "请选择工作空间中的 FCStd 文件");
  }
  let root: string; let filename: string;
  try {
    root = fcstdWorkspace(workspacePath);
    // A workspace itself may have a platform alias (/var -> /private/var).
    // Resolve absolute selections relative to that entry point, not child symlinks.
    const entryRoot = path.resolve(workspacePath);
    const relativeSelection = path.isAbsolute(filePath) ? path.relative(entryRoot, path.resolve(filePath)) : filePath;
    const selection = path.isAbsolute(filePath) && (relativeSelection === ".." || relativeSelection.startsWith(`..${path.sep}`)) ? filePath : relativeSelection;
    filename = safeFcstdPath(root, selection);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("路径超出") || message.includes("符号链接")) throw new CadObjectInfoError("path_escape", "文件路径不在工作空间内或为符号链接");
    throw new CadObjectInfoError("io_error", "工作空间或模型文件不可读");
  }
  assertCadObjectInfoActive(signal, budget);
  if (!/\.fcstd$/i.test(filename)) throw new CadObjectInfoError("invalid_arguments", "对象信息只支持 FCStd 文件");
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assertCadObjectInfoActive(signal, budget);
    safeFcstdPath(root, path.relative(root, filename));
    const before = fs.statSync(filename);
    assertCadObjectInfoActive(signal, budget);
    if (!before.isFile()) throw new CadObjectInfoError("invalid_arguments", "对象信息只读取普通 FCStd 文件");
    if (before.size > 64 * 1024 * 1024) throw new CadObjectInfoError("resource_limit", "FCStd 文件超过 64 MiB 安全上限");
    const archive = readFcstdBatchArchive(filename);
    assertCadObjectInfoActive(signal, budget);
    verifyCadObjectArchive(archive.bytes, archive.files["Document.xml"], budget);
    try { new TextDecoder("utf-8", { fatal: true }).decode(archive.files["Document.xml"]); }
    catch { throw new CadObjectInfoError("invalid_document_xml", "Document.xml 包含无效 UTF-8 字节"); }
    assertCadObjectInfoActive(signal, budget);
    const parsed = await parseCadObjectDocumentXml(archive.xml, signal, budget);
    assertCadObjectInfoActive(signal, budget);
    // Carry the legacy light reader's documentXmlBytes semantics for valid
    // UTF-8: the extracted XML's original byte count, including a saved BOM,
    // before XML parsing/normalization. This is not archive size or characters.
    const result = { ...parsed, source: { file_size: before.size, mtime_ms: before.mtimeMs,
      document_xml_bytes: archive.files["Document.xml"].byteLength } };
    await measureCadObjectInfoJsonBytes({ success: true, data: result }, budget);
    assertCadObjectInfoActive(signal, budget);
    // Re-resolve after all yielding parse/measurement stages; never return a mixed snapshot.
    if (safeFcstdPath(root, path.relative(root, filename)) !== filename) throw new CadObjectInfoError("source_changed", "模型在读取期间已变化，请重新读取");
    const after = fs.statSync(filename);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new CadObjectInfoError("source_changed", "模型在读取期间已变化，请重新读取");
    }
    assertCadObjectInfoActive(signal, budget);
    return result;
  } catch (error) {
    if (error instanceof CadObjectInfoError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/上限|解压大小/.test(message)) throw new CadObjectInfoError("resource_limit", "FCStd 压缩包或 Document.xml 超过安全上限");
    if (/缺少 Document.xml/.test(message)) throw new CadObjectInfoError("missing_document_xml", "FCStd 缺少 Document.xml");
    if (/Document.xml/.test(message)) throw new CadObjectInfoError("invalid_document_xml", "Document.xml 不完整或格式无效");
    if (/路径超出|符号链接/.test(message)) throw new CadObjectInfoError("path_escape", "读取期间模型路径已变化");
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.startsWith("E")) throw new CadObjectInfoError("io_error", "模型文件不可读");
    throw new CadObjectInfoError("invalid_fcstd_archive", "FCStd 压缩包损坏或格式无效");
  }
}
