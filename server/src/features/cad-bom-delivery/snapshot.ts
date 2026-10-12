import fs from "node:fs";
import { createHash } from "node:crypto";
import { PNW_CAD_INDEX_EXCLUDED_DIRECTORIES, pnwCadIndexRelativePath } from "@phoenix-wing/cad-core";
import { openCadSqliteReadDatabase } from "../../lib/cadSqliteReadLease.js";
import { cadDirectoryExcludedFromDiscovery, cadPathExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import { fcstdWorkspace, safeFcstdPath, visitFcstdBatch } from "../../lib/fcstdBatchFiles.js";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import { canonicalCadBomTransferJson, type CadBomTransferEnvelope } from "./envelope.js";
import { buildCadBomTransferFromSource, type CadBomSourceSnapshot } from "./source.js";

const MAX_FILES = 5000;
const MAX_ASSETS = 5000;
const MAX_REFERENCES = 100000;
const MAX_RAW_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
type Identity = { readonly dev: number; readonly ino: number };
export interface CadBomFileProof extends Identity {
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly sha256: string;
}
export interface CadBomTransferProof {
  readonly workspace: Identity & { readonly canonicalPath: string };
  readonly database: Identity;
  readonly scan: { readonly id: number; readonly uuid: string; readonly scannedAt: string };
  readonly rawSourceHash: string;
  readonly files: readonly CadBomFileProof[];
  readonly directories: readonly (Identity & { readonly relativePath: string; readonly scopedEntries: readonly string[] })[];
}
export interface PreparedCadBomTransfer {
  readonly envelope: CadBomTransferEnvelope;
  /** A defensive copy on every access, never the server's retained byte buffer. */
  readonly bytes: Uint8Array;
  readonly proof: CadBomTransferProof;
}
export interface TrustedCadBomTransfer {
  readonly envelope: CadBomTransferEnvelope;
  readonly bytes: Uint8Array;
  /** Final synchronous filesystem observation; valid only during this callback. */
  readonly assertCurrent: () => void;
}
type Options = { producerVersion: string; assertActive?: () => void };
type Retained = { envelope: CadBomTransferEnvelope; bytes: Uint8Array; proof: CadBomTransferProof; options: Options };
type LiveSnapshot = Retained & { assertCurrent: () => void };
const preparedTransfers = new WeakMap<PreparedCadBomTransfer, Retained>();
type ReadDb = ReturnType<typeof openCadSqliteReadDatabase>;

function sha(bytes: string | Uint8Array) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function sameIdentity(a: Identity, b: Identity) { return a.dev === b.dev && a.ino === b.ino; }
function sameFile(a: fs.Stats, b: fs.Stats) {
  return a.isFile() && b.isFile() && sameIdentity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function workspaceIdentity(workspace: string) {
  const canonicalPath = fcstdWorkspace(workspace), stat = fs.statSync(canonicalPath);
  return { canonicalPath, dev: stat.dev, ino: stat.ino };
}
function databaseIdentity(root: string) {
  const filename = safeFcstdPath(root, phoenixDatabasePath(root));
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error("BOM 交付索引不是普通文件");
  return { filename, dev: stat.dev, ino: stat.ino };
}
function boundedCount(db: ReadDb, table: string, max: number, fields: readonly string[], where = "") {
  const row = db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(${fields.map(field => `COALESCE(length(CAST(${field} AS BLOB)),0)`).join("+")}),0) AS bytes FROM ${table} ${where}`).get() as { count: number; bytes: number };
  if (!Number.isSafeInteger(row.count) || row.count < 0 || row.count > max) throw new Error(`BOM 交付 ${table} 超出 ${max} 行安全上限`);
  if (!Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > MAX_RAW_BYTES) throw new Error("BOM 交付原始索引超过 64 MiB 安全上限");
  return row.bytes;
}
function sourceSnapshot(db: ReadDb, root: string, assertActive: () => void): CadBomSourceSnapshot {
  assertActive();
  const schema = db.prepare("SELECT value FROM phoenix_meta WHERE key='schema_version'").get() as { value: string } | undefined;
  if (schema?.value !== "13") throw new Error("BOM 交付需要 Schema v13；不会自动迁移索引");
  const columns = ["repo_rel_path", "asset_kind", "part_number", "part_version", "type_code", "model_series", "part_name", "label", "file_status", "last_seen_at", "bom_json"];
  const referenceColumns = ["host_repo_rel_path", "xlink_file_attr", "target_repo_rel_path", "target_part_number", "target_part_version", "resolve_status", "detail_json"];
  // Historical missing/ignored and non-CAD rows belong to other/manual data,
  // not this generation's source proof. The shared discovery scope still applies.
  db.function("CAD_BOM_SCOPE", { deterministic: true }, value => typeof value === "string" && !cadPathExcludedFromDiscovery(value) ? 1 : 0);
  const assetWhere = "WHERE lower(repo_rel_path) LIKE '%.fcstd' AND file_status NOT IN ('missing','ignored') AND CAD_BOM_SCOPE(repo_rel_path)=1";
  let rawBytes = boundedCount(db, "phoenix_cad_file_asset", MAX_ASSETS, columns, assetWhere)
    + boundedCount(db, "phoenix_cad_bom_xref", MAX_REFERENCES, referenceColumns);
  const scanSize = db.prepare(`SELECT ${["scan_uuid", "scanned_at", "status", "phase", "stats_json", "scan_root"].map(field => `COALESCE(length(CAST(${field} AS BLOB)),0)`).join("+")} AS bytes FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1`).get() as { bytes: number } | undefined;
  rawBytes += scanSize?.bytes ?? 0;
  if (rawBytes > MAX_RAW_BYTES) throw new Error("BOM 交付原始索引超过 64 MiB 安全上限");
  const scan = db.prepare(`SELECT id,scan_uuid AS scanUuid,scanned_at AS scannedAt,status,phase,stats_json AS statsJson,scan_root AS scanRoot FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1`).get() as (CadBomSourceSnapshot["scan"] & { scanRoot: string }) | undefined;
  if (!scan) throw new Error("BOM 交付缺少完整扫描，请更新索引");
  if (scan.scanRoot !== root) throw new Error("BOM 交付扫描根目录不匹配，请完整重新扫描");
  if (scan.status !== "done") throw new Error("BOM 交付最新扫描不是完整 done 快照，请完整重新扫描");
  // Unlike the SQL string preflight, this also counts keys, nulls, integers and
  // row containers. Iteration stops before an unbounded array can be built.
  let serializedBytes = Buffer.byteLength(JSON.stringify(scan), "utf8") + 256;
  const assets: CadBomSourceSnapshot["assets"][number][] = [];
  const references: CadBomSourceSnapshot["references"][number][] = [];
  const read = <T>(sql: string, output: T[]) => {
    for (const row of db.prepare(sql).iterate()) {
      assertActive(); serializedBytes += Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
      if (serializedBytes > MAX_RAW_BYTES) throw new Error("BOM 交付原始索引超过 64 MiB 安全上限");
      output.push(row as T);
    }
  };
  read(`SELECT id,repo_rel_path AS relativePath,asset_kind AS assetKind,part_number AS partNo,part_version AS revision,type_code AS typeCode,model_series AS modelSeries,part_name AS partName,label,file_status AS fileStatus,last_seen_at AS lastSeenAt,bom_json AS bomJson FROM phoenix_cad_file_asset ${assetWhere} ORDER BY id`, assets);
  read(`SELECT id,scan_id AS scanId,host_file_asset_id AS hostAssetId,host_repo_rel_path AS hostRelativePath,xlink_file_attr AS xlinkFile,target_file_asset_id AS targetAssetId,target_repo_rel_path AS targetRelativePath,target_part_number AS targetPartNo,target_part_version AS targetRevision,resolve_status AS resolveStatus,detail_json AS detailJson FROM phoenix_cad_bom_xref ORDER BY id`, references);
  const counts = db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN scan_id=? THEN 1 ELSE 0 END) AS current FROM phoenix_cad_bom_line").get(scan.id) as { total: number; current: number | null };
  if (counts.total !== (counts.current ?? 0)) throw new Error("BOM 交付递归行含不同扫描代，请完整重新扫描");
  return { schemaVersion: 13, scan: { id: scan.id, scanUuid: scan.scanUuid, scannedAt: scan.scannedAt, status: scan.status, phase: scan.phase, statsJson: scan.statsJson }, assets, references, bomLineCount: counts.total };
}
function fileProof(root: string, relativePath: string, assertActive: () => void): CadBomFileProof {
  const filename = safeFcstdPath(root, relativePath), before = fs.statSync(filename);
  if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error("BOM 交付 FCStd 不是普通文件或超过 64 MiB 安全上限");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let failed = false; let failure: unknown;
  try {
    if (!sameFile(before, fs.fstatSync(fd))) throw new Error("BOM 交付读取期间文件身份改变");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
    let bytes = 0, count: number;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      assertActive(); bytes += count;
      if (bytes > MAX_FILE_BYTES) throw new Error("BOM 交付 FCStd 超过 64 MiB 安全上限");
      hash.update(buffer.subarray(0, count));
    }
    if (bytes !== before.size || !sameFile(before, fs.fstatSync(fd)) || !sameFile(before, fs.statSync(safeFcstdPath(root, relativePath)))) throw new Error("BOM 交付读取期间文件内容或身份改变");
    return { relativePath, dev: before.dev, ino: before.ino, size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, sha256: `sha256:${hash.digest("hex")}` };
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { fs.closeSync(fd); }
    catch (error) { if (failed) throw new AggregateError([failure, error], "BOM 文件读取和关闭均失败"); throw error; }
  }
}
async function inventory(root: string, source: CadBomSourceSnapshot, assertActive: () => void) {
  const files = new Map<string, CadBomFileProof>();
  const options = { maxFiles: MAX_FILES, assertActive, excludedDirectories: PNW_CAD_INDEX_EXCLUDED_DIRECTORIES };
  const discovered = await visitFcstdBatch(root, ".", rel => { files.set(rel, fileProof(root, rel, assertActive)); }, options);
  assertActive();
  if (discovered.errors.length) throw new Error(`BOM 交付文件检查失败：${discovered.errors.slice(0, 5).map(row => `${row.rel}：${row.message}`).join("；")}`);
  const current = source.assets.filter(asset => asset.fileStatus === "present" && /\.fcstd$/i.test(asset.relativePath) && !cadPathExcludedFromDiscovery(asset.relativePath));
  if (current.length !== files.size) throw new Error("BOM 交付文件清单已改变，请完整重新扫描");
  for (const asset of current) {
    assertActive();
    const rel = pnwCadIndexRelativePath(asset.relativePath), actual = files.get(rel);
    const metadata: unknown = typeof asset.bomJson === "string" ? JSON.parse(asset.bomJson) : asset.bomJson;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("BOM 交付文件快照元数据缺失，请完整重新扫描");
    const expected = metadata as Record<string, unknown>;
    if (!actual || expected.size_bytes !== actual.size || expected.mtime_ms !== Math.trunc(actual.mtimeMs) || expected.source_sha256 !== actual.sha256) throw new Error(`BOM 交付文件快照过期：${rel}；请完整重新扫描`);
  }
  const checked = new Set<string>();
  const confirmed = await visitFcstdBatch(root, ".", rel => {
    assertActive();
    const prior = files.get(rel), stat = fs.statSync(safeFcstdPath(root, rel));
    if (!prior || !stat.isFile() || !sameIdentity(prior, stat) || prior.size !== stat.size || prior.mtimeMs !== stat.mtimeMs || prior.ctimeMs !== stat.ctimeMs) throw new Error("BOM 交付文件清单或内容在校验期间改变");
    checked.add(rel);
  }, options);
  assertActive();
  if (confirmed.errors.length || checked.size !== files.size) throw new Error("BOM 交付文件清单或内容在校验期间改变");
  return [...files.values()].sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
}

function scopedDirectoryEntries(root: string, rel: string, consumeEntry: () => void) {
  const filename = safeFcstdPath(root, rel), stat = fs.statSync(filename);
  if (!stat.isDirectory()) throw new Error("BOM 交付扫描目录已改变");
  // Bound enumeration before any whole-directory allocation. The old shared
  // visitor still uses readdir; this gate precedes it, and is repeated at publish.
  const directory = fs.opendirSync(filename, { bufferSize: 32 });
  let failed = false, failure: unknown;
  try {
    const excluded = new Set(PNW_CAD_INDEX_EXCLUDED_DIRECTORIES), scopedEntries: string[] = [];
    let entry: fs.Dirent | null;
    while ((entry = directory.readSync()) !== null) {
      consumeEntry();
      if (entry.isSymbolicLink()) throw new Error("BOM 交付扫描范围不处理符号链接");
      if (entry.isDirectory() && !cadDirectoryExcludedFromDiscovery(entry.name) && !excluded.has(entry.name)) scopedEntries.push(`D:${entry.name}`);
      else if (entry.isFile() && /\.fcstd$/i.test(entry.name)) scopedEntries.push(`F:${entry.name}`);
    }
    const after = fs.statSync(safeFcstdPath(root, rel));
    if (!sameIdentity(stat, after) || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error("BOM 交付目录在读取期间改变");
    return { relativePath: rel, dev: stat.dev, ino: stat.ino, scopedEntries: scopedEntries.sort() };
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { directory.closeSync(); }
    catch (error) { if (failed) throw new AggregateError([failure, error], "BOM 目录读取和关闭均失败"); throw error; }
  }
}
function directoryEntryBudget() {
  let visited = 0;
  return () => { if (++visited > 20000) throw new Error("BOM 交付范围超过 20000 个目录项安全上限"); };
}
function directoryInventory(root: string, assertActive: () => void): CadBomTransferProof["directories"] {
  const output: CadBomTransferProof["directories"][number][] = [], pending = ["."];
  const consumeEntry = directoryEntryBudget();
  while (pending.length) {
    assertActive(); const rel = pending.pop()!, entry = scopedDirectoryEntries(root, rel, consumeEntry);
    output.push(entry);
    for (const name of entry.scopedEntries) if (name.startsWith("D:")) pending.push(rel === "." ? name.slice(2) : `${rel}/${name.slice(2)}`);
  }
  return output.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
}
async function withSnapshot<T>(workspace: string, options: Options, action: (retained: LiveSnapshot) => T): Promise<T> {
  options.assertActive?.();
  const root = workspaceIdentity(workspace), database = databaseIdentity(root.canonicalPath);
  const db = openCadSqliteReadDatabase(database.filename);
  let active = true, failed = false, failure: unknown;
  try {
    const assertActive = () => {
      options.assertActive?.();
      const active = workspaceIdentity(workspace), currentDb = databaseIdentity(root.canonicalPath);
      if (active.canonicalPath !== root.canonicalPath || !sameIdentity(active, root) || !sameIdentity(database, currentDb)) throw new Error("BOM 交付工作空间或数据库身份已改变");
    };
    assertActive();
    const source = sourceSnapshot(db, root.canonicalPath, assertActive);
    const envelope = buildCadBomTransferFromSource(source, options);
    const directories = directoryInventory(root.canonicalPath, assertActive);
    const files = await inventory(root.canonicalPath, source, assertActive);
    const assertCurrent = () => {
      if (!active) throw new Error("BOM 交付发布边界已结束");
      assertActive();
      // The lease protects index generations, not arbitrary external CAD writers.
      // These final synchronous observations cannot abolish their later race.
      const consumeEntry = directoryEntryBudget();
      for (const dir of directories) {
        const current = scopedDirectoryEntries(root.canonicalPath, dir.relativePath, consumeEntry);
        if (!sameIdentity(dir, current) || JSON.stringify(dir.scopedEntries) !== JSON.stringify(current.scopedEntries)) throw new Error("BOM 交付目录清单在发布边界前改变");
      }
      for (const file of files) {
        const stat = fs.statSync(safeFcstdPath(root.canonicalPath, file.relativePath));
        if (!stat.isFile() || !sameIdentity(file, stat) || file.size !== stat.size || file.mtimeMs !== stat.mtimeMs || file.ctimeMs !== stat.ctimeMs) throw new Error("BOM 交付文件在发布边界前改变");
      }
    };
    assertCurrent();
    const proof = frozen({ workspace: root, database: { dev: database.dev, ino: database.ino }, scan: { id: source.scan.id, uuid: source.scan.scanUuid, scannedAt: source.scan.scannedAt }, rawSourceHash: sha(JSON.stringify(source)), files, directories });
    return action({ envelope: frozen(envelope), bytes: Buffer.from(canonicalCadBomTransferJson(envelope), "utf8"), proof, options: { ...options }, assertCurrent });
  } catch (error) { failed = true; failure = error; throw error; }
  finally {
    active = false;
    try { db.close(); }
    catch (error) { if (failed) throw new AggregateError([failure, error], "BOM 交付读取和租约关闭均失败"); throw error; }
  }
}

/** Read-only complete scan + disk proof, under one native transaction/WASM lease. */
export async function prepareCadBomTransfer(workspace: string, options: Options): Promise<PreparedCadBomTransfer> {
  // Do not retain a caller-mutable options container across inventory awaits.
  const stableOptions = Object.freeze({ producerVersion: options.producerVersion, assertActive: options.assertActive });
  return withSnapshot(workspace, stableOptions, retained => {
    const result = Object.freeze({ envelope: retained.envelope, get bytes() { return Uint8Array.from(retained.bytes); }, proof: retained.proof });
    preparedTransfers.set(result, retained);
    return result;
  });
}

/**
 * Reacquire and compare the entire proof, then execute a synchronous publication.
 * Async callbacks are a programming error: detecting a thenable after invocation
 * cannot roll back side effects already performed by a misbehaving callback.
 */
export async function revalidateCadBomTransfer<T>(workspace: string, prepared: PreparedCadBomTransfer, action: (trusted: TrustedCadBomTransfer) => T extends PromiseLike<unknown> ? never : T): Promise<T> {
  const retained = preparedTransfers.get(prepared);
  if (!retained) throw new Error("BOM 交付预览不是本服务准备的快照，请重新预览");
  return withSnapshot(workspace, retained.options, current => {
    if (JSON.stringify(current.proof) !== JSON.stringify(retained.proof) || !Buffer.from(current.bytes).equals(retained.bytes)) throw new Error("BOM 交付预览已过期，请重新预览");
    retained.options.assertActive?.();
    const result = action(Object.freeze({ envelope: retained.envelope, bytes: Uint8Array.from(retained.bytes), assertCurrent: current.assertCurrent }));
    if (result && (typeof result === "object" || typeof result === "function") && typeof (result as { then?: unknown }).then === "function") throw new Error("BOM 交付发布回调必须同步，异步回调不受支持");
    return result as T;
  });
}
