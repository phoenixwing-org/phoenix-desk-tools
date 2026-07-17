import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  KT_CODEGEN_LEGACY_BLOCKS,
  KT_CODEGEN_TABLE_DATA_KIND,
  KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
  KtCodegenController,
  KtCodegenParam,
  ktCodegenCommitApplyWrites,
  ktCodegenIsBlockKey,
  ktCodegenProjectApply,
  type KtCodegenApplyWritePort,
  type KtCodegenBlockKey,
  type KtCodegenDiagnostic,
  type KtCodegenSourceFileSnapshot,
  type KtCodegenTableData,
} from "@phoenix-wing/kt-codegen";
import { effectiveCodeIgnorePatterns } from "./codeIgnoreService.js";
import { isIgnoredName, isScannableDir } from "./pdtCodeService.js";
import {
  decodeSourceBuffer,
  encodeSourceText,
  type SourceTextPayload,
} from "./sourceTextCodec.js";

const CODEGEN_EXTENSIONS = new Set([".json", ".csv"]);
const SOURCE_EXTENSIONS = new Set([".h", ".hpp", ".hh", ".hxx", ".c", ".cc", ".cpp", ".cxx"]);
const MARKER_TEXT = "KEVIN CAA WIZARD SECTION";
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const MAX_DISCOVERY_FILES = 5_000;
const DOCUMENT_DISCOVERY_BYTE_LIMIT = 64 * 1024 * 1024;
const MAX_SOURCE_FILES = 5_000;
const MAX_SOURCE_CANDIDATE_SUMMARIES = 500;
const PREFLIGHT_CACHE_LIMIT = 24;
const PREFLIGHT_CACHE_BYTE_LIMIT = 64 * 1024 * 1024;
const SOURCE_FILE_CACHE_LIMIT = 6_000;
const SOURCE_FILE_CACHE_BYTE_LIMIT = 64 * 1024 * 1024;
const SOURCE_SNAPSHOT_BYTE_LIMIT = 64 * 1024 * 1024;
const DOCUMENT_DISCOVERY_CACHE_LIMIT = 6_000;

export type KtCodegenDocumentFormat = "legacy-v4-json" | "legacy-17-column-csv";

export interface KtCodegenDocumentSummary {
  readonly path: string;
  readonly file_name: string;
  readonly format: KtCodegenDocumentFormat;
  readonly class_name: string;
  readonly item_count: number;
  readonly diagnostic_count: number;
}

export interface KtCodegenHostDocument extends KtCodegenDocumentSummary {
  readonly kind: "kt.codegen.host-document";
  readonly schema_version: 1;
  readonly fingerprint: string;
  readonly file_signature: string;
  readonly document_revision: number;
  readonly encoding: "utf8" | "utf8-bom" | "gbk";
  readonly param: KtCodegenParam;
  readonly table: KtCodegenTableData;
  readonly diagnostics: readonly KtCodegenDiagnostic[];
}

export interface KtCodegenPreflightPayload {
  readonly plan: ReturnType<KtCodegenController["analyze"]>;
  /** Param、Block 与全部候选源码指纹形成的稳定计划身份。 */
  readonly plan_fingerprint: string;
  readonly safe_to_apply: boolean;
  readonly reused: boolean;
  readonly created_at: string;
  readonly indexed_file_count: number;
  readonly candidate_file_count: number;
  readonly source_scan_truncated: boolean;
  readonly source_scan_byte_limit_reached: boolean;
  readonly source_snapshot_bytes: number;
  readonly source_cache_hits: number;
  readonly source_files_read: number;
  readonly source_file_signatures: Readonly<Record<string, string>>;
  readonly source_file_fingerprints: Readonly<Record<string, string>>;
  readonly source_candidates: readonly KtCodegenSourceCandidateSummary[];
  readonly source_candidates_truncated: boolean;
}

export interface KtCodegenAppliedFile {
  readonly path: string;
  readonly encoding: "utf8" | "utf8-bom" | "gbk";
  readonly eol: "lf" | "crlf";
  readonly region_count: number;
  readonly bytes_before: number;
  readonly bytes_after: number;
  readonly fingerprint_before: string;
  readonly fingerprint_after: string;
}

export interface KtCodegenApplyPayload {
  readonly kind: "kt.codegen.apply-result";
  readonly schema_version: 1;
  readonly applied_at: string;
  readonly plan_fingerprint: string;
  readonly region_count: number;
  readonly files: readonly KtCodegenAppliedFile[];
  readonly diagnostics: readonly KtCodegenDiagnostic[];
  readonly verified: true;
}

export interface KtCodegenSourceCandidateSummary {
  readonly path: string;
  readonly fingerprint: string;
  readonly encoding: "utf8" | "utf8-bom" | "gbk";
  readonly eol: "lf" | "crlf";
  readonly marker_line: number;
}

export interface KtCodegenSourcePreviewPayload {
  readonly path: string;
  readonly fingerprint: string;
  readonly file_signature: string;
  readonly expected_fingerprint: string;
  readonly stale: boolean;
  readonly encoding: "utf8" | "utf8-bom" | "gbk";
  readonly eol: "lf" | "crlf";
  readonly focus_start_line: number;
  readonly focus_end_line: number;
  readonly from_line: number;
  readonly to_line: number;
  readonly lines: Array<{ number: number; text: string; focus: boolean }>;
}

export interface KtCodegenFileStatePayload {
  readonly path: string;
  readonly exists: boolean;
  readonly file_signature: string;
  readonly fingerprint: string;
  readonly changed: boolean;
}

export interface KtCodegenFileStatesPayload {
  readonly files: readonly KtCodegenFileStatePayload[];
  readonly changed_count: number;
}

interface KtCodegenPreflightCacheEntry {
  readonly plan: ReturnType<KtCodegenController["analyze"]>;
  readonly createdAt: string;
  readonly byteSize: number;
}

type KtCodegenCachedSource = Omit<KtCodegenSourceFileSnapshot, "path">;

interface KtCodegenSourceFileCacheEntry {
  readonly signature: string;
  readonly source: KtCodegenCachedSource | null;
  readonly byteSize: number;
}

type KtCodegenCachedDocumentSummary = Omit<KtCodegenDocumentSummary, "path" | "file_name">;

interface KtCodegenDocumentDiscoveryCacheEntry {
  readonly signature: string;
  readonly summary: KtCodegenCachedDocumentSummary | null;
}

const preflightCache = new Map<string, KtCodegenPreflightCacheEntry>();
const sourceFileCache = new Map<string, KtCodegenSourceFileCacheEntry>();
const documentDiscoveryCache = new Map<string, KtCodegenDocumentDiscoveryCacheEntry>();
let preflightCacheBytes = 0;
let sourceFileCacheBytes = 0;

function workspaceRoot(raw: string): string {
  const root = path.resolve(String(raw || ""));
  if (!raw || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("请先打开有效工作空间");
  }
  return root;
}

function normalizeRel(raw: unknown): string {
  return String(raw || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function resolveWorkspaceFile(rootValue: string, rawRel: unknown): { root: string; rel: string; abs: string } {
  const root = workspaceRoot(rootValue);
  const rel = normalizeRel(rawRel);
  if (!rel || path.isAbsolute(rel)) throw new Error("Codegen 文件路径必须位于工作空间内");
  const abs = path.resolve(root, rel);
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Codegen 文件路径越出工作空间");
  }
  if (fs.existsSync(abs)) {
    const realRoot = fs.realpathSync(root);
    const realAbs = fs.realpathSync(abs);
    const realRelative = path.relative(realRoot, realAbs);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Codegen 文件路径通过符号链接越出工作空间");
    }
    if (fs.lstatSync(abs).isSymbolicLink()) {
      throw new Error("Codegen 不直接打开符号链接文件");
    }
  }
  return { root, rel: relative.replace(/\\/g, "/"), abs };
}

function fingerprint(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function preflightCacheKey(
  root: string,
  param: KtCodegenParam,
  blockKeys: readonly KtCodegenBlockKey[],
  snapshots: readonly KtCodegenSourceFileSnapshot[],
): string {
  return fingerprint(Buffer.from(JSON.stringify({
    root,
    param,
    blockKeys,
    sources: snapshots.map((snapshot) => ({ path: snapshot.path, fingerprint: snapshot.fingerprint })),
  }), "utf8"));
}

function rememberPreflight(key: string, entry: KtCodegenPreflightCacheEntry): void {
  const previous = preflightCache.get(key);
  if (previous) preflightCacheBytes -= previous.byteSize;
  preflightCache.delete(key);
  preflightCache.set(key, entry);
  preflightCacheBytes += entry.byteSize;
  while (preflightCache.size > PREFLIGHT_CACHE_LIMIT
    || preflightCacheBytes > PREFLIGHT_CACHE_BYTE_LIMIT) {
    const oldest = preflightCache.keys().next().value;
    if (typeof oldest !== "string") break;
    preflightCacheBytes -= preflightCache.get(oldest)?.byteSize ?? 0;
    preflightCache.delete(oldest);
  }
  preflightCacheBytes = Math.max(0, preflightCacheBytes);
}

function sourceFileSignature(stat: fs.Stats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

function readStableFile(
  filename: string,
  sizeLimit: number,
  sizeError: string,
): { raw: Buffer; stat: fs.Stats; signature: string } {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: number | null = null;
    try {
      const noFollow = process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW;
      handle = fs.openSync(filename, fs.constants.O_RDONLY | noFollow);
    } catch (error) {
      if (attempt === 0) continue;
      throw error;
    }
    try {
      const before = fs.fstatSync(handle);
      if (!before.isFile()) throw new Error(`Codegen 文件不是普通文件：${filename}`);
      if (before.size > sizeLimit) throw new Error(sizeError);
      const beforeSignature = sourceFileSignature(before);
      const raw = fs.readFileSync(handle);
      if (raw.length > sizeLimit) throw new Error(sizeError);
      const after = fs.fstatSync(handle);
      const pathAfter = fs.lstatSync(filename);
      const afterSignature = sourceFileSignature(after);
      if (after.isFile()
        && pathAfter.isFile()
        && beforeSignature === afterSignature
        && afterSignature === sourceFileSignature(pathAfter)
        && raw.length === after.size) {
        return { raw, stat: after, signature: afterSignature };
      }
    } catch (error) {
      if (attempt === 1) throw error;
    } finally {
      if (handle !== null) fs.closeSync(handle);
    }
  }
  throw new Error("Codegen 文件在读取过程中持续变化，请稍后重试");
}

function rememberSourceFile(filename: string, entry: KtCodegenSourceFileCacheEntry): void {
  const previous = sourceFileCache.get(filename);
  if (previous) sourceFileCacheBytes -= previous.byteSize;
  sourceFileCache.delete(filename);
  sourceFileCache.set(filename, entry);
  sourceFileCacheBytes += entry.byteSize;
  while (sourceFileCache.size > SOURCE_FILE_CACHE_LIMIT
    || sourceFileCacheBytes > SOURCE_FILE_CACHE_BYTE_LIMIT) {
    const oldest = sourceFileCache.keys().next().value;
    if (typeof oldest !== "string") break;
    sourceFileCacheBytes -= sourceFileCache.get(oldest)?.byteSize ?? 0;
    sourceFileCache.delete(oldest);
  }
  sourceFileCacheBytes = Math.max(0, sourceFileCacheBytes);
}

function rememberDiscoveredDocument(
  filename: string,
  entry: KtCodegenDocumentDiscoveryCacheEntry,
): void {
  documentDiscoveryCache.delete(filename);
  documentDiscoveryCache.set(filename, entry);
  while (documentDiscoveryCache.size > DOCUMENT_DISCOVERY_CACHE_LIMIT) {
    const oldest = documentDiscoveryCache.keys().next().value;
    if (typeof oldest !== "string") break;
    documentDiscoveryCache.delete(oldest);
  }
}

function documentRevision(stat: fs.Stats): number {
  return Math.max(0, Math.trunc(stat.mtimeMs));
}

function formatForFilename(filename: string): KtCodegenDocumentFormat {
  return path.extname(filename).toLowerCase() === ".csv"
    ? "legacy-17-column-csv"
    : "legacy-v4-json";
}

function encodingLabel(payload: SourceTextPayload): "utf8" | "utf8-bom" | "gbk" {
  if (payload.encoding === "gbk") return "gbk";
  return payload.hadBom ? "utf8-bom" : "utf8";
}

function preserveSerializedNewlines(serialized: string, source: string): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /(?:\r\n|\r|\n)$/.test(source);
  const normalized = serialized.replace(/\r\n?|\n/g, "\n").replace(/\n/g, eol);
  const withoutFinalNewlines = normalized.replace(/(?:\r\n|\n)+$/, "");
  return hadFinalNewline ? `${withoutFinalNewlines}${eol}` : withoutFinalNewlines;
}

function controllerForText(format: KtCodegenDocumentFormat, text: string): {
  controller: KtCodegenController;
  diagnostics: readonly KtCodegenDiagnostic[];
} {
  const controller = new KtCodegenController();
  const result = format === "legacy-17-column-csv"
    ? controller.readCsv(text)
    : controller.readJson(text);
  if (!result.ok || !result.value) {
    const detail = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ");
    throw new Error(detail || "不是可识别的 KT Codegen 配置");
  }
  return { controller, diagnostics: result.diagnostics };
}

function tableData(param: KtCodegenParam, revision: number): KtCodegenTableData {
  return {
    kind: KT_CODEGEN_TABLE_DATA_KIND,
    schemaVersion: KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
    documentRevision: revision,
    selectedRow: param.items.length ? 0 : null,
    items: param.items,
  };
}

function documentFromSnapshot(
  resolved: { root: string; rel: string; abs: string },
  snapshot: { raw: Buffer; stat: fs.Stats; signature: string },
): KtCodegenHostDocument {
  if (!CODEGEN_EXTENSIONS.has(path.extname(resolved.abs).toLowerCase())) {
    throw new Error("Codegen 只支持旧 v4 JSON 与 17 列 CSV");
  }
  const raw = snapshot.raw;
  const decoded = decodeSourceBuffer(raw);
  if (!decoded) throw new Error("Codegen 配置不是可识别的 UTF-8/GBK 文本");
  const format = formatForFilename(resolved.abs);
  const { controller, diagnostics } = controllerForText(format, decoded.text);
  const revision = documentRevision(snapshot.stat);
  const className = `${controller.param.namePrefix}${controller.param.nameMiddle}`;
  return {
    kind: "kt.codegen.host-document",
    schema_version: 1,
    path: resolved.rel,
    file_name: path.basename(resolved.abs),
    format,
    class_name: className,
    item_count: controller.param.items.length,
    diagnostic_count: diagnostics.length,
    fingerprint: fingerprint(raw),
    file_signature: snapshot.signature,
    document_revision: revision,
    encoding: encodingLabel(decoded),
    param: controller.param,
    table: tableData(controller.param, revision),
    diagnostics,
  };
}

function documentFromFile(root: string, rel: string): KtCodegenHostDocument {
  const resolved = resolveWorkspaceFile(root, rel);
  if (!fs.existsSync(resolved.abs)) {
    throw new Error(`Codegen 文件不存在：${resolved.rel}`);
  }
  const snapshot = readStableFile(
    resolved.abs,
    MAX_CONFIG_BYTES,
    "Codegen 配置超过 4 MiB 限制",
  );
  return documentFromSnapshot(resolved, snapshot);
}

function walkFiles(
  root: string,
  extensions: ReadonlySet<string>,
  limit: number,
  ignorePatterns: readonly string[],
): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const effectiveIgnorePatterns = [...ignorePatterns];
  const walk = (dir: string): void => {
    if (files.length > limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length > limit) break;
      if (entry.isSymbolicLink()) continue;
      if (isIgnoredName(entry.name, effectiveIgnorePatterns)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isScannableDir(entry.name)) walk(abs);
        continue;
      }
      if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(abs);
    }
  };
  walk(root);
  return { files: files.slice(0, limit), truncated: files.length > limit };
}

export function discoverKtCodegenDocuments(rootValue: string, prefsDir?: string): {
  workspace: string;
  documents: KtCodegenDocumentSummary[];
  scanned_file_count: number;
  truncated: boolean;
  cache_hit_count: number;
  files_read: number;
  config_snapshot_bytes: number;
  config_scan_byte_limit_reached: boolean;
} {
  const root = workspaceRoot(rootValue);
  const ignorePatterns = effectiveCodeIgnorePatterns(root, prefsDir ? { prefsDir } : undefined);
  const walked = walkFiles(root, CODEGEN_EXTENSIONS, MAX_DISCOVERY_FILES, ignorePatterns);
  const candidates = walked.files;
  const documents: KtCodegenDocumentSummary[] = [];
  let cacheHitCount = 0;
  let filesRead = 0;
  let snapshotBytes = 0;
  let byteLimitReached = false;
  for (const abs of candidates) {
    try {
      const stat = fs.lstatSync(abs);
      if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) continue;
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      let signature = sourceFileSignature(stat);
      const cached = documentDiscoveryCache.get(abs);
      let summary: KtCodegenCachedDocumentSummary | null;
      if (cached?.signature === signature) {
        cacheHitCount += 1;
        documentDiscoveryCache.delete(abs);
        documentDiscoveryCache.set(abs, cached);
        summary = cached.summary;
      } else {
        if (snapshotBytes + stat.size > DOCUMENT_DISCOVERY_BYTE_LIMIT) {
          byteLimitReached = true;
          continue;
        }
        let snapshot: ReturnType<typeof readStableFile>;
        try {
          snapshot = readStableFile(
            abs,
            MAX_CONFIG_BYTES,
            "Codegen 配置超过 4 MiB 限制",
          );
        } catch {
          // 不稳定/不可读是瞬时状态，不能把它负缓存成“不兼容文档”。
          continue;
        }
        filesRead += 1;
        if (snapshotBytes + snapshot.raw.length > DOCUMENT_DISCOVERY_BYTE_LIMIT) {
          byteLimitReached = true;
          continue;
        }
        snapshotBytes += snapshot.raw.length;
        signature = snapshot.signature;
        try {
          const document = documentFromSnapshot({ root, rel, abs }, snapshot);
          summary = {
            format: document.format,
            class_name: document.class_name,
            item_count: document.item_count,
            diagnostic_count: document.diagnostic_count,
          };
        } catch {
          summary = null;
        }
        rememberDiscoveredDocument(abs, { signature, summary });
      }
      if (summary) documents.push({ path: rel, file_name: path.basename(abs), ...summary });
    } catch {
      // 普通 JSON/CSV 不是 Codegen 文档，发现阶段静默跳过。
    }
  }
  documents.sort((left, right) => left.path.localeCompare(right.path));
  return {
    workspace: root,
    documents,
    scanned_file_count: candidates.length,
    truncated: walked.truncated,
    cache_hit_count: cacheHitCount,
    files_read: filesRead,
    config_snapshot_bytes: snapshotBytes,
    config_scan_byte_limit_reached: byteLimitReached,
  };
}

export function loadKtCodegenDocument(rootValue: string, rel: unknown): KtCodegenHostDocument {
  return documentFromFile(rootValue, normalizeRel(rel));
}

export function inspectKtCodegenDocumentState(
  rootValue: string,
  body: Record<string, unknown>,
): KtCodegenFileStatePayload {
  return inspectKtCodegenFileState(
    rootValue,
    body,
    CODEGEN_EXTENSIONS,
    "Codegen 只支持旧 v4 JSON 与 17 列 CSV",
    "Codegen 配置超过 4 MiB 限制",
  );
}

export function inspectKtCodegenSourceState(
  rootValue: string,
  body: Record<string, unknown>,
): KtCodegenFileStatePayload {
  return inspectKtCodegenFileState(
    rootValue,
    body,
    SOURCE_EXTENSIONS,
    "Codegen 源码检查只支持 C/C++ 文本",
    "Codegen 源码超过 4 MiB 检查限制",
  );
}

export function inspectKtCodegenSourceStates(
  rootValue: string,
  body: Record<string, unknown>,
): KtCodegenFileStatesPayload {
  if (!Array.isArray(body.files)) throw new Error("Codegen 源码状态检查缺少 files 数组");
  const rawFiles = body.files;
  if (rawFiles.length > MAX_SOURCE_FILES) {
    throw new Error(`Codegen 源码状态检查最多支持 ${MAX_SOURCE_FILES} 个文件`);
  }
  const unique = new Map<string, Record<string, unknown>>();
  for (const [index, raw] of rawFiles.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Codegen 源码状态检查第 ${index + 1} 项不是对象`);
    }
    const item = raw as Record<string, unknown>;
    const rel = normalizeRel(item.path);
    if (!rel) throw new Error(`Codegen 源码状态检查第 ${index + 1} 项缺少路径`);
    if (!unique.has(rel)) unique.set(rel, item);
  }
  const files = [...unique.values()].map((item) => inspectKtCodegenSourceState(rootValue, item));
  return {
    files,
    changed_count: files.filter((item) => item.changed).length,
  };
}

function inspectKtCodegenFileState(
  rootValue: string,
  body: Record<string, unknown>,
  extensions: ReadonlySet<string>,
  extensionError: string,
  sizeError: string,
): KtCodegenFileStatePayload {
  const resolved = resolveWorkspaceFile(rootValue, body.path);
  const expectedFingerprint = typeof body.expected_fingerprint === "string"
    ? body.expected_fingerprint
    : "";
  if (!fs.existsSync(resolved.abs)) {
    return {
      path: resolved.rel,
      exists: false,
      file_signature: "",
      fingerprint: "",
      changed: true,
    };
  }
  const stat = fs.lstatSync(resolved.abs);
  if (!stat.isFile()) throw new Error(`Codegen 文件不是普通文件：${resolved.rel}`);
  if (!extensions.has(path.extname(resolved.abs).toLowerCase())) throw new Error(extensionError);
  if (stat.size > MAX_CONFIG_BYTES) throw new Error(sizeError);
  const signature = sourceFileSignature(stat);
  const expectedSignature = typeof body.expected_file_signature === "string"
    ? body.expected_file_signature
    : "";
  if (expectedSignature && expectedFingerprint && expectedSignature === signature) {
    return {
      path: resolved.rel,
      exists: true,
      file_signature: signature,
      fingerprint: expectedFingerprint,
      changed: false,
    };
  }
  const snapshot = readStableFile(resolved.abs, MAX_CONFIG_BYTES, sizeError);
  const actualFingerprint = fingerprint(snapshot.raw);
  return {
    path: resolved.rel,
    exists: true,
    file_signature: snapshot.signature,
    fingerprint: actualFingerprint,
    changed: !expectedFingerprint || expectedFingerprint !== actualFingerprint,
  };
}

export function previewKtCodegenSource(
  rootValue: string,
  body: Record<string, unknown>,
): KtCodegenSourcePreviewPayload {
  const resolved = resolveWorkspaceFile(rootValue, body.path);
  if (!fs.existsSync(resolved.abs) || !fs.lstatSync(resolved.abs).isFile()) {
    throw new Error(`Codegen 源码不存在：${resolved.rel}`);
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(resolved.abs).toLowerCase())) {
    throw new Error("Codegen 源码预览只支持 C/C++ 文本");
  }
  const snapshot = readStableFile(
    resolved.abs,
    MAX_CONFIG_BYTES,
    "Codegen 源码超过 4 MiB 预览限制",
  );
  const raw = snapshot.raw;
  const decoded = decodeSourceBuffer(raw);
  if (!decoded) throw new Error("Codegen 源码不是可识别的 UTF-8/GBK 文本");

  const allLines = decoded.text.split(/\r\n|\r|\n/);
  const requestedStart = Number(body.start_line);
  const requestedEnd = Number(body.end_line);
  const focusStart = Number.isFinite(requestedStart)
    ? Math.min(Math.max(0, Math.trunc(requestedStart)), Math.max(0, allLines.length - 1))
    : 0;
  const focusEnd = Number.isFinite(requestedEnd)
    ? Math.min(Math.max(focusStart, Math.trunc(requestedEnd)), Math.max(0, allLines.length - 1))
    : focusStart;
  const requestedContext = Number(body.context_lines);
  const context = Number.isFinite(requestedContext)
    ? Math.min(50, Math.max(0, Math.trunc(requestedContext)))
    : 6;
  const fromLine = Math.max(0, focusStart - context);
  const toLine = Math.min(Math.max(0, allLines.length - 1), focusEnd + context);
  const actualFingerprint = fingerprint(raw);
  const expectedFingerprint = typeof body.expected_fingerprint === "string"
    ? body.expected_fingerprint
    : "";
  return {
    path: resolved.rel,
    fingerprint: actualFingerprint,
    file_signature: snapshot.signature,
    expected_fingerprint: expectedFingerprint,
    stale: Boolean(expectedFingerprint && expectedFingerprint !== actualFingerprint),
    encoding: encodingLabel(decoded),
    eol: decoded.text.includes("\r\n") ? "crlf" : "lf",
    focus_start_line: focusStart,
    focus_end_line: focusEnd,
    from_line: fromLine,
    to_line: toLine,
    lines: allLines.slice(fromLine, toLine + 1).map((text, index) => {
      const number = fromLine + index;
      return { number, text, focus: number >= focusStart && number <= focusEnd };
    }),
  };
}

function paramFromHost(rawParam: unknown, rawTable?: unknown): KtCodegenParam {
  if (!rawParam || typeof rawParam !== "object" || Array.isArray(rawParam)) {
    throw new Error("缺少 Codegen Param 数据");
  }
  const param = new KtCodegenParam(rawParam as Partial<KtCodegenParam>);
  if (rawTable && typeof rawTable === "object" && !Array.isArray(rawTable)) {
    const table = rawTable as Partial<KtCodegenTableData>;
    if (table.kind !== KT_CODEGEN_TABLE_DATA_KIND
      || table.schemaVersion !== KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION
      || !Array.isArray(table.items)) {
      throw new Error("Codegen 表格数据版本不受支持");
    }
    param.items.splice(0, param.items.length, ...table.items.map((item) => ({ ...item })));
  }
  return param;
}

export function saveKtCodegenDocument(rootValue: string, body: Record<string, unknown>): KtCodegenHostDocument {
  const resolved = resolveWorkspaceFile(rootValue, body.path);
  if (!fs.existsSync(resolved.abs)) throw new Error(`Codegen 文件不存在：${resolved.rel}`);
  const stat = fs.lstatSync(resolved.abs);
  if (!stat.isFile()) throw new Error(`Codegen 文件不是普通文件：${resolved.rel}`);
  if (!CODEGEN_EXTENSIONS.has(path.extname(resolved.abs).toLowerCase())) {
    throw new Error("Codegen 只支持保存旧 v4 JSON 与 17 列 CSV");
  }
  if (stat.size > MAX_CONFIG_BYTES) throw new Error("Codegen 配置超过 4 MiB 限制");
  const snapshot = readStableFile(resolved.abs, MAX_CONFIG_BYTES, "Codegen 配置超过 4 MiB 限制");
  const raw = snapshot.raw;
  const expectedFingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  if (!expectedFingerprint || expectedFingerprint !== fingerprint(raw)) {
    throw new Error("磁盘上的 Codegen 配置已变化，请先还原/重新打开后再保存");
  }
  const decoded = decodeSourceBuffer(raw);
  if (!decoded) throw new Error("Codegen 配置不是可识别的 UTF-8/GBK 文本");
  const param = paramFromHost(body.param, body.table);
  const controller = new KtCodegenController({ param });
  const format = formatForFilename(resolved.abs);
  const result = format === "legacy-17-column-csv"
    ? controller.writeCsv()
    : controller.writeJson();
  if (!result.ok || result.value === null) {
    const detail = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ");
    throw new Error(detail || "Codegen 配置校验失败");
  }
  const nextText = preserveSerializedNewlines(result.value, decoded.text);
  const nextRaw = encodeSourceText(decoded, nextText);
  if (nextRaw.length > MAX_CONFIG_BYTES) {
    throw new Error("Codegen 配置保存结果超过 4 MiB 限制");
  }
  const temp = `${resolved.abs}.kt-codegen-${process.pid}-${Date.now()}.tmp`;
  try {
    const tempHandle = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      snapshot.stat.mode,
    );
    try {
      fs.writeFileSync(tempHandle, nextRaw);
      fs.fsyncSync(tempHandle);
    } finally {
      fs.closeSync(tempHandle);
    }
    const tempSnapshot = readStableFile(
      temp,
      MAX_CONFIG_BYTES,
      "Codegen 配置保存结果超过 4 MiB 限制",
    );
    if (fingerprint(tempSnapshot.raw) !== fingerprint(nextRaw)) {
      throw new Error("Codegen 临时文件在保存过程中被替换");
    }
    const verified = decodeSourceBuffer(tempSnapshot.raw);
    if (!verified) throw new Error("Codegen 临时文件复读失败");
    controllerForText(format, verified.text);
    const current = readStableFile(
      resolved.abs,
      MAX_CONFIG_BYTES,
      "Codegen 配置超过 4 MiB 限制",
    );
    if (current.signature !== snapshot.signature
      || fingerprint(current.raw) !== expectedFingerprint) {
      throw new Error("磁盘上的 Codegen 配置在保存过程中已再次变化，未覆盖外部修改");
    }
    fs.renameSync(temp, resolved.abs);
    if (process.platform !== "win32") {
      let directoryHandle: number | null = null;
      try {
        directoryHandle = fs.openSync(path.dirname(resolved.abs), fs.constants.O_RDONLY);
        fs.fsyncSync(directoryHandle);
      } catch {
        // 部分文件系统不支持目录 fsync；文件替换本身已经完成。
      } finally {
        if (directoryHandle !== null) {
          try { fs.closeSync(directoryHandle); } catch { /* best effort */ }
        }
      }
    }
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
  return documentFromFile(resolved.root, resolved.rel);
}

function sourceSnapshots(root: string, prefsDir?: string): {
  snapshots: KtCodegenSourceFileSnapshot[];
  signatures: Record<string, string>;
  fingerprints: Record<string, string>;
  indexedFileCount: number;
  truncated: boolean;
  cacheHits: number;
  filesRead: number;
  candidates: KtCodegenSourceCandidateSummary[];
  candidatesTruncated: boolean;
  snapshotBytes: number;
  byteLimitReached: boolean;
} {
  const ignorePatterns = effectiveCodeIgnorePatterns(root, prefsDir ? { prefsDir } : undefined);
  const walked = walkFiles(root, SOURCE_EXTENSIONS, MAX_SOURCE_FILES, ignorePatterns);
  const candidates = walked.files;
  const snapshots: KtCodegenSourceFileSnapshot[] = [];
  const signatures: Record<string, string> = {};
  const fingerprints: Record<string, string> = {};
  let cacheHits = 0;
  let filesRead = 0;
  let snapshotBytes = 0;
  let byteLimitReached = false;
  for (const abs of candidates) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) continue;
    let signature = sourceFileSignature(stat);
    const cached = sourceFileCache.get(abs);
    let source: KtCodegenCachedSource | null;
    let sourceByteSize = 0;
    if (cached?.signature === signature) {
      cacheHits += 1;
      sourceFileCache.delete(abs);
      sourceFileCache.set(abs, cached);
      source = cached.source;
      sourceByteSize = cached.byteSize;
    } else {
      let raw: Buffer;
      try {
        const snapshot = readStableFile(abs, MAX_CONFIG_BYTES, "Codegen 源码超过 4 MiB 限制");
        raw = snapshot.raw;
        signature = snapshot.signature;
        filesRead += 1;
      } catch {
        continue;
      }
      const decoded = raw.includes(MARKER_TEXT) ? decodeSourceBuffer(raw) : null;
      source = decoded ? {
        text: decoded.text,
        fingerprint: fingerprint(raw),
        encoding: encodingLabel(decoded),
        eol: decoded.text.includes("\r\n") ? "crlf" : "lf",
      } : null;
      sourceByteSize = source ? raw.length : 0;
      rememberSourceFile(abs, { signature, source, byteSize: sourceByteSize });
    }
    if (!source) continue;
    if (snapshotBytes + sourceByteSize > SOURCE_SNAPSHOT_BYTE_LIMIT) {
      byteLimitReached = true;
      continue;
    }
    snapshotBytes += sourceByteSize;
    const rel = path.relative(root, abs).replace(/\\/g, "/");
    signatures[rel] = signature;
    fingerprints[rel] = source.fingerprint;
    snapshots.push({
      path: rel,
      ...source,
    });
  }
  return {
    snapshots,
    signatures,
    fingerprints,
    indexedFileCount: candidates.length,
    truncated: walked.truncated || byteLimitReached,
    cacheHits,
    filesRead,
    candidates: snapshots.slice(0, MAX_SOURCE_CANDIDATE_SUMMARIES).map((snapshot) => ({
      path: snapshot.path,
      fingerprint: snapshot.fingerprint,
      encoding: snapshot.encoding === "gbk"
        ? "gbk"
        : snapshot.encoding === "utf8-bom" ? "utf8-bom" : "utf8",
      eol: snapshot.eol === "crlf" ? "crlf" : "lf",
      marker_line: snapshot.text.slice(0, snapshot.text.indexOf(MARKER_TEXT)).split(/\r?\n/).length - 1,
    })),
    candidatesTruncated: snapshots.length > MAX_SOURCE_CANDIDATE_SUMMARIES,
    snapshotBytes,
    byteLimitReached,
  };
}

export function preflightKtCodegen(
  rootValue: string,
  body: Record<string, unknown>,
  prefsDir?: string,
): KtCodegenPreflightPayload {
  const root = workspaceRoot(rootValue);
  const param = paramFromHost(body.param, body.table);
  const rawKeys = Array.isArray(body.block_keys) ? body.block_keys.map(String) : [];
  if (!rawKeys.every(ktCodegenIsBlockKey)) throw new Error("包含未知的 Codegen 控制符");
  const blockKeys: KtCodegenBlockKey[] = [...new Set(rawKeys as KtCodegenBlockKey[])];
  const targets = [...new Set(blockKeys.map((key) =>
    KT_CODEGEN_LEGACY_BLOCKS.find((block) => block.key === key)?.target,
  ).filter((target): target is NonNullable<typeof target> => Boolean(target)))];
  const source = sourceSnapshots(root, prefsDir);
  const cacheKey = preflightCacheKey(root, param, blockKeys, source.snapshots);
  const cached = preflightCache.get(cacheKey);
  const createdAt = cached?.createdAt ?? new Date().toISOString();
  const plan = cached?.plan ?? new KtCodegenController({ param }).analyze({
    targets,
    blockKeys,
    snapshot: { files: source.snapshots },
  });
  if (cached) {
    rememberPreflight(cacheKey, cached);
  } else {
    rememberPreflight(cacheKey, {
      plan,
      createdAt,
      byteSize: Buffer.byteLength(JSON.stringify(plan), "utf8"),
    });
  }
  return {
    plan,
    plan_fingerprint: cacheKey,
    safe_to_apply: plan.canApply && !source.truncated,
    reused: Boolean(cached),
    created_at: createdAt,
    indexed_file_count: source.indexedFileCount,
    candidate_file_count: source.snapshots.length,
    source_scan_truncated: source.truncated,
    source_scan_byte_limit_reached: source.byteLimitReached,
    source_snapshot_bytes: source.snapshotBytes,
    source_cache_hits: source.cacheHits,
    source_files_read: source.filesRead,
    source_file_signatures: source.signatures,
    source_file_fingerprints: source.fingerprints,
    source_candidates: source.candidates,
    source_candidates_truncated: source.candidatesTruncated,
  };
}

type KtCodegenHostApplyTarget = {
  readonly path: string;
  readonly abs: string;
  readonly originalRaw: Buffer;
  readonly originalFingerprint: string;
  readonly nextRaw: Buffer;
  readonly nextFingerprint: string;
  readonly encoding: "utf8" | "utf8-bom" | "gbk";
  readonly eol: "lf" | "crlf";
  readonly regionCount: number;
};

function writeSyncedExclusiveFile(filename: string, raw: Buffer, mode: number): void {
  const handle = fs.openSync(
    filename,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    mode,
  );
  try {
    fs.writeFileSync(handle, raw);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function syncParentDirectory(filename: string): void {
  if (process.platform === "win32") return;
  let handle: number | null = null;
  try {
    handle = fs.openSync(path.dirname(filename), fs.constants.O_RDONLY);
    fs.fsyncSync(handle);
  } catch {
    // 某些文件系统不支持目录 fsync；文件本身已经完成同步与原子替换。
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch { /* best effort */ }
    }
  }
}

function equalApplyBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));
}

/** Wing 事务 Port 的 Desk 原子写适配：保留权限、fsync、复读和最终 checkpoint。 */
function writeAtomicKtCodegenFile(target: KtCodegenHostApplyTarget, content: Uint8Array): void {
  const raw = Buffer.from(content);
  const rollback = equalApplyBytes(raw, target.originalRaw);
  const expected = rollback ? target.nextRaw : target.originalRaw;
  if (!rollback && !equalApplyBytes(raw, target.nextRaw)) {
    throw new Error(`Codegen Apply 收到未知写入内容：${target.path}`);
  }
  const current = readStableFile(target.abs, MAX_CONFIG_BYTES, "Codegen Apply 源码超过 4 MiB 限制");
  if (!equalApplyBytes(current.raw, expected)) {
    throw new Error(`Codegen Apply 即将写回时源码已变化：${target.path}`);
  }
  const phase = rollback ? "rollback" : "apply";
  const temp = `${target.abs}.kt-codegen-${phase}-${process.pid}-${Date.now()}.tmp`;
  try {
    writeSyncedExclusiveFile(temp, raw, current.stat.mode);
    const staged = readStableFile(temp, MAX_CONFIG_BYTES, `Codegen Apply ${phase} 临时文件超过 4 MiB 限制`);
    if (!equalApplyBytes(staged.raw, raw)) {
      throw new Error(`Codegen Apply ${phase} 临时文件复读失败：${target.path}`);
    }
    const checkpoint = readStableFile(target.abs, MAX_CONFIG_BYTES, "Codegen Apply 源码超过 4 MiB 限制");
    if (!equalApplyBytes(checkpoint.raw, expected)) {
      throw new Error(`Codegen Apply 即将写回时源码已变化：${target.path}`);
    }
    fs.renameSync(temp, target.abs);
    syncParentDirectory(target.abs);
    const final = readStableFile(target.abs, MAX_CONFIG_BYTES, "Codegen Apply 结果超过 4 MiB 限制");
    if (!equalApplyBytes(final.raw, raw)) {
      throw new Error(`Codegen Apply 写回复读不一致：${target.path}`);
    }
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
  }
}

const ktCodegenApplyWritePort: KtCodegenApplyWritePort<KtCodegenHostApplyTarget> = {
  async readFile(target) {
    return readStableFile(
      target.abs,
      MAX_CONFIG_BYTES,
      "Codegen Apply 源码超过 4 MiB 限制",
    ).raw;
  },
  async writeFile(target, content) {
    writeAtomicKtCodegenFile(target, content);
  },
};

/**
 * 使用刚展示给用户的 Wing Plan 真实写回源码。
 *
 * 宿主重新 Analyze 并核对 plan_fingerprint；Wing 负责 Marker/Artifact 校验、
 * 倒序投影和多文件回滚事务，Desk 只负责编码及 fsync/复读/原子替换 Port。
 */
export async function applyKtCodegen(
  rootValue: string,
  body: Record<string, unknown>,
  prefsDir?: string,
): Promise<KtCodegenApplyPayload> {
  const expectedPlanFingerprint = typeof body.expected_plan_fingerprint === "string"
    ? body.expected_plan_fingerprint.trim()
    : "";
  if (!expectedPlanFingerprint) throw new Error("Codegen Apply 缺少预检计划指纹");
  const preflight = preflightKtCodegen(rootValue, body, prefsDir);
  if (preflight.plan_fingerprint !== expectedPlanFingerprint) {
    throw new Error("Codegen Apply 前配置、控制符或源码已变化，请重新预检");
  }
  if (!preflight.safe_to_apply) {
    throw new Error("Codegen Apply 安全门禁未通过，请先处理诊断或缩小扫描范围");
  }
  if (!preflight.plan.artifacts.length) throw new Error("Codegen Apply 没有可写回的 Artifact");

  const root = workspaceRoot(rootValue);
  const sourcePaths = [...new Set(preflight.plan.markerRegions.map((region) => region.path))];
  const sourceByPath = new Map<string, {
    readonly resolved: ReturnType<typeof resolveWorkspaceFile>;
    readonly raw: Buffer;
    readonly decoded: SourceTextPayload;
    readonly fingerprint: string;
  }>();
  for (const sourcePath of sourcePaths) {
    const resolved = resolveWorkspaceFile(root, sourcePath);
    if (!SOURCE_EXTENSIONS.has(path.extname(resolved.abs).toLowerCase())) {
      throw new Error(`Codegen Apply 只支持 C/C++ 源码：${resolved.rel}`);
    }
    const snapshot = readStableFile(resolved.abs, MAX_CONFIG_BYTES, "Codegen Apply 源码超过 4 MiB 限制");
    const decoded = decodeSourceBuffer(snapshot.raw);
    if (!decoded) throw new Error(`Codegen Apply 无法识别源码编码：${resolved.rel}`);
    sourceByPath.set(sourcePath, {
      resolved,
      raw: snapshot.raw,
      decoded,
      fingerprint: fingerprint(snapshot.raw),
    });
  }

  const projection = ktCodegenProjectApply(preflight.plan, [...sourceByPath].map(([sourcePath, source]) => ({
    path: sourcePath,
    text: source.decoded.text,
    fingerprint: source.fingerprint,
  })));
  if (projection.diagnostics.length) {
    throw new Error(`Codegen Apply 投影失败：${projection.diagnostics.map((item) => item.message).join("；")}`);
  }

  const targets = projection.changes.map((change): KtCodegenHostApplyTarget => {
    const source = sourceByPath.get(change.path);
    if (!source) throw new Error(`Codegen Apply 缺少宿主源码：${change.path}`);
    const nextRaw = encodeSourceText(source.decoded, change.after);
    if (nextRaw.length > MAX_CONFIG_BYTES) {
      throw new Error(`Codegen Apply 结果超过 4 MiB 限制：${source.resolved.rel}`);
    }
    return {
      path: source.resolved.rel,
      abs: source.resolved.abs,
      originalRaw: source.raw,
      originalFingerprint: source.fingerprint,
      nextRaw,
      nextFingerprint: fingerprint(nextRaw),
      encoding: source.decoded.encoding === "gbk" ? "gbk" : source.decoded.hadBom ? "utf8-bom" : "utf8",
      eol: source.decoded.text.includes("\r\n") ? "crlf" : "lf",
      regionCount: change.regionCount,
    };
  });
  const commit = await ktCodegenCommitApplyWrites(
    ktCodegenApplyWritePort,
    targets.map((target) => ({ target, before: target.originalRaw, after: target.nextRaw })),
  );
  if (!commit.ok) {
    if (commit.rollbackFailures.length) {
      throw new Error(`${String(commit.error)}；自动回滚失败：${commit.rollbackFailures.map((item) => item.path).join("；")}`);
    }
    throw commit.error;
  }

  return {
    kind: "kt.codegen.apply-result",
    schema_version: 1,
    applied_at: new Date().toISOString(),
    plan_fingerprint: preflight.plan_fingerprint,
    region_count: targets.reduce((sum, file) => sum + file.regionCount, 0),
    files: targets.map((file) => ({
      path: file.path,
      encoding: file.encoding,
      eol: file.eol,
      region_count: file.regionCount,
      bytes_before: file.originalRaw.length,
      bytes_after: file.nextRaw.length,
      fingerprint_before: file.originalFingerprint,
      fingerprint_after: file.nextFingerprint,
    })),
    diagnostics: preflight.plan.diagnostics,
    verified: true,
  };
}
