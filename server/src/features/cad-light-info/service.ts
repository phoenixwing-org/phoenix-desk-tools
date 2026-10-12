import fs from "node:fs";
import path from "node:path";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { pnwAnalyzeCadIndexDocumentXml, pnwCadXlinkRuleLabel, pnwResolveXlinkTarget,
  type PnwCadXlinkResolveStatus } from "@phoenix-wing/cad-core";
import { fcstdFingerprint, fcstdWorkspace, readFcstdLightArchive, readFcstdLightBytes, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { cadDirectoryExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import { CadObjectInfoBudget, measureCadObjectInfoJsonBytes } from "../cad-object-info/budget.js";
import { CadObjectInfoError } from "../cad-object-info/error.js";

export type CadLightDiagnostic = {
  file: string; label: string; status: PnwCadXlinkResolveStatus;
  targetRelativePath: string | null; candidates: string[]; message: string;
};
export type CadLightInfoResult = {
  analysis: ReturnType<typeof pnwAnalyzeCadIndexDocumentXml> & { readonly documentXmlBytes: number };
  diagnostics: { items: CadLightDiagnostic[]; counts: Record<PnwCadXlinkResolveStatus, number> };
  source: { file_size: number; mtime_ms: number };
  warnings: string[];
};
const INVENTORY_LIMITS = Object.freeze({ files: 5000, entries: 20000 });
type Options = {
  /** Deterministic, server-only test seams. No request field reaches these. */
  beforeFinalCheck?: () => void | Promise<void>;
  limits?: { files?: number; entries?: number };
};
type Inventory = { files: string[]; directories: Array<{ relative: string; dev: number; ino: number; entries: string[] }> };
const changed = () => { throw new CadObjectInfoError("source_changed", "模型或工作空间文件清单在读取期间已变化，请重新读取"); };
const sameStat = (a: fs.Stats, b: fs.Stats) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
/** Keep the primary typed reason when an independent cleanup failure is also
 * present. Aggregate details remain internal, never serialized to the client. */
export function cadLightInfoFailure(error: unknown): CadObjectInfoError | undefined {
  for (let depth = 0; depth < 8; depth++) {
    if (error instanceof CadObjectInfoError) return error;
    if (!(error instanceof AggregateError)) return undefined;
    error = error.errors[0];
  }
  return undefined;
}
function safeFailure(error: unknown): CadObjectInfoError {
  const typed = cadLightInfoFailure(error); if (typed) return typed;
  for (let depth = 0; depth < 8 && error instanceof AggregateError; depth++) error = error.errors[0];
  const detail = error instanceof Error ? error.message : String(error);
  if (/路径超出|符号链接/.test(detail) || (error && typeof error === "object" && "code" in error && error.code === "ELOOP")) {
    return new CadObjectInfoError("path_escape", "文件路径不在工作空间内或包含符号链接");
  }
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.startsWith("E")) {
    return new CadObjectInfoError("io_error", "工作空间或模型文件不可读，未返回不完整结果");
  }
  return new CadObjectInfoError("invalid_fcstd_archive", "FCStd ZIP 容器损坏或格式无效");
}
function limits(options: Options) {
  const values = { ...INVENTORY_LIMITS, ...options.limits };
  for (const key of ["files", "entries"] as const) if (!Number.isSafeInteger(values[key]) || values[key] <= 0 || values[key] > INVENTORY_LIMITS[key]) {
    throw new CadObjectInfoError("invalid_arguments", "轻量读取测试预算只能降低生产上限");
  }
  return values;
}

/** Stream directory entries rather than allocating an unbounded readdir list.
 * The complete in-scope inventory is re-read before returning any diagnostics.
 * No CAD dependency content is opened, parsed, indexed or modified. */
async function inventory(root: string, budget: CadObjectInfoBudget, cap: { files: number; entries: number }): Promise<Inventory> {
  const files: string[] = [], directories: Inventory["directories"] = [], pending = ["."]; let visited = 0;
  while (pending.length) {
    budget.check();
    const relative = pending.pop()!, absolute = safeFcstdPath(root, relative);
    const before = fs.statSync(absolute);
    if (!before.isDirectory()) changed();
    const directory = fs.opendirSync(absolute, { bufferSize: 32 }), entries: string[] = [];
    let failed = false, primary: unknown;
    try {
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        budget.check();
        if (++visited > cap.entries) throw new CadObjectInfoError("resource_limit", "轻量诊断范围超过 20000 个目录项，请缩小工作空间");
        if (visited % 128 === 0) { await yieldToHost(); budget.check(); }
        if (/[\u0000-\u001f\u007f]/.test(entry.name)) throw new CadObjectInfoError("invalid_arguments", "工作空间清单包含不支持的控制字符文件名");
        const rel = relative === "." ? entry.name : `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new CadObjectInfoError("path_escape", "轻量诊断的工作空间清单包含符号链接，未返回不完整结果");
        if (entry.isDirectory()) {
          if (cadDirectoryExcludedFromDiscovery(entry.name)) continue;
          safeFcstdPath(root, rel); entries.push(`d:${entry.name}`); pending.push(rel);
        } else if (entry.isFile() && /\.fcstd$/i.test(entry.name)) {
          const filename = safeFcstdPath(root, rel);
          if (!fs.statSync(filename).isFile()) changed();
          if (files.length >= cap.files) throw new CadObjectInfoError("resource_limit", "轻量诊断范围超过 5000 个 FCStd，请缩小工作空间");
          entries.push(`f:${entry.name}`); files.push(rel);
        }
      }
    } catch (error) { failed = true; primary = error; throw error; }
    finally {
      try { directory.closeSync(); }
      catch (cleanup) {
        if (failed) throw new AggregateError([primary, cleanup], "轻量诊断目录读取和关闭均失败");
        throw cleanup;
      }
    }
    const after = fs.statSync(safeFcstdPath(root, relative));
    if (!after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) changed();
    directories.push({ relative, dev: before.dev, ino: before.ino, entries: entries.sort() });
  }
  budget.check();
  return { files: files.sort(), directories: directories.sort((a, b) => a.relative.localeCompare(b.relative)) };
}

function diagnosticMessage(status: PnwCadXlinkResolveStatus, target: string | null, candidates: string[]) {
  switch (status) {
    case "resolved": return `已解析到 ${target}`;
    case "self": return "引用指向当前 FCStd 自身";
    case "ambiguous": return `存在多个候选，建议检查 ${candidates.join("、")}`;
    case "missing": return candidates.length ? `候选文件当前不可用：${candidates.join("、")}` : "工作空间中未找到匹配的 FCStd";
    case "non_fcstd": return "不是 FCStd 引用";
  }
}
/** A narrow compatibility guard, not another link parser. The inherited light
 * regex ends its tag at the first raw '>', including one inside quoted values.
 * The shared analyzer has already validated structure; refuse that projection
 * rather than return silently missing links. Comment/CDATA contents are inert. */
function assertSupportedLightProjection(xml: string, budget: CadObjectInfoBudget) {
  const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<XLink\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of xml.matchAll(tags)) {
    budget.check();
    if (/^<XLink\b/i.test(match[0]) && match[0].slice(0, -1).includes(">")) {
      throw new CadObjectInfoError("invalid_document_xml", "引用属性含有轻量投影不支持的原始 > 字符，请查看完整对象信息；未返回部分摘要");
    }
  }
  budget.check();
}
export async function buildCadLightDiagnostics(host: string, links: CadLightInfoResult["analysis"]["xlinks"], files: string[], budget: CadObjectInfoBudget,
  baseBytes: number): Promise<CadLightInfoResult["diagnostics"]> {
  const exactPaths = new Set(files), byFoldedPath = new Map<string, string[]>();
  const byBasename = new Map<string, string[]>();
  for (const file of files) {
    const folded = file.toLocaleLowerCase("en-US"), paths = byFoldedPath.get(folded) || [];
    paths.push(file); byFoldedPath.set(folded, paths);
    const key = path.posix.basename(file).toLocaleLowerCase("en-US");
    const group = byBasename.get(key) || []; group.push(file); byBasename.set(key, group);
  }
  const counts = { resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 };
  const items: CadLightDiagnostic[] = []; let bytes = baseBytes;
  for (const link of links) {
    budget.check();
    const file = link.file.trim().replaceAll("\\", "/"), candidateRels = byBasename.get(path.posix.basename(file).toLocaleLowerCase("en-US")) || [];
    const joined = path.posix.normalize(path.posix.join(path.posix.dirname(host), file));
    const foldedPaths = byFoldedPath.get(joined.toLocaleLowerCase("en-US")) || [];
    const directTargetRel = file.startsWith("/") || /^[A-Za-z]:\//.test(file) || joined === ".." || joined.startsWith("../")
      ? null : exactPaths.has(joined) ? joined : foldedPaths.length === 1 ? foldedPaths[0] : null;
    const resolved = pnwResolveXlinkTarget({ hostRel: host, xlinkFile: file, candidateRels, existingCandidateRels: candidateRels, directTargetRel });
    counts[resolved.status]++;
    const targetRelativePath = resolved.targetRel?.replace(/^\.\//, "") || null;
    const candidates = resolved.candidates.map(value => value.replace(/^\.\//, ""));
    const label = link.label.trim() || pnwCadXlinkRuleLabel(undefined, file, targetRelativePath);
    const item = { file, label, status: resolved.status, targetRelativePath, candidates, message: diagnosticMessage(resolved.status, targetRelativePath, candidates) };
    // Candidate lists can fan out even for a tiny XML. Bound each item and the
    // growing whole response before retaining the next expanded list.
    bytes += await measureCadObjectInfoJsonBytes(item, budget) + (items.length ? 1 : 0);
    budget.checkBytes(bytes); items.push(item);
  }
  return { items, counts };
}

/** Standalone static summary. It does not require an index/provider and performs
 * no filesystem writes. Outside-workspace selections remain fail-closed until
 * a controlled single-file permission port is available. */
export async function readCadLightInfo(workspacePath: string, filePath: string, signal?: AbortSignal,
  budget = new CadObjectInfoBudget(signal), options: Options = {}): Promise<CadLightInfoResult> {
  budget.check();
  if (typeof workspacePath !== "string" || !workspacePath.trim() || /[\u0000-\u001f\u007f]/.test(workspacePath)
    || typeof filePath !== "string" || !filePath.trim() || /[\u0000-\u001f\u007f]/.test(filePath)) {
    throw new CadObjectInfoError("invalid_arguments", "请选择工作空间中的 FCStd 文件");
  }
  try {
    const root = fcstdWorkspace(workspacePath), rootStat = fs.statSync(root), cap = limits(options);
    const entryRoot = path.resolve(workspacePath);
    const selection = path.isAbsolute(filePath) ? path.relative(entryRoot, path.resolve(filePath)) : filePath;
    const filename = safeFcstdPath(root, selection), relative = path.relative(root, filename).replaceAll("\\", "/");
    if (!/\.fcstd$/i.test(filename)) throw new CadObjectInfoError("invalid_arguments", "轻量读取只支持 FCStd 文件");
    const before = fs.statSync(filename);
    if (!before.isFile()) throw new CadObjectInfoError("invalid_arguments", "轻量读取只支持普通 FCStd 文件");
    await yieldToHost(); budget.check();
    const first = await inventory(root, budget, cap);
    safeFcstdPath(root, relative);
    const archive = readFcstdLightArchive(filename, budget), fingerprint = fcstdFingerprint(archive.bytes);
    let projected: ReturnType<typeof pnwAnalyzeCadIndexDocumentXml>;
    try { projected = pnwAnalyzeCadIndexDocumentXml(archive.xml); }
    catch { throw new CadObjectInfoError("invalid_document_xml", "Document.xml 不完整或不支持轻量解析"); }
    budget.check();
    assertSupportedLightProjection(archive.xml, budget);
    const analysis = { documentXmlBytes: archive.documentBytes.byteLength, ...projected };
    const source = { file_size: before.size, mtime_ms: before.mtimeMs }, warnings: string[] = [];
    const baseBytes = await measureCadObjectInfoJsonBytes({ success: true, data: { analysis,
      diagnostics: { items: [], counts: { resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 } }, source, warnings } }, budget);
    const known = first.files.includes(relative) ? first.files : [...first.files, relative];
    if (known.length > cap.files) throw new CadObjectInfoError("resource_limit", "轻量诊断范围超过 5000 个 FCStd，请缩小工作空间");
    const result = { analysis, diagnostics: await buildCadLightDiagnostics(relative, analysis.xlinks, known, budget, baseBytes), source, warnings };
    await measureCadObjectInfoJsonBytes({ success: true, data: result }, budget);
    if (options.beforeFinalCheck) await budget.waitFor(Promise.resolve(options.beforeFinalCheck()));
    const last = await inventory(root, budget, cap);
    if (JSON.stringify(first) !== JSON.stringify(last) || fcstdWorkspace(workspacePath) !== root) changed();
    const currentRoot = fs.statSync(root);
    if (currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino) changed();
    if (safeFcstdPath(root, relative) !== filename || !sameStat(before, fs.statSync(filename))) changed();
    if (fcstdFingerprint(readFcstdLightBytes(filename, budget)) !== fingerprint || !sameStat(before, fs.statSync(filename))) changed();
    budget.check();
    return result;
  } catch (error) {
    if (error instanceof CadObjectInfoError || cadLightInfoFailure(error)) throw error;
    const failure = safeFailure(error);
    if (error instanceof AggregateError) throw new AggregateError([failure, error], "轻量读取及资源关闭失败", { cause: error });
    throw failure;
  }
}
