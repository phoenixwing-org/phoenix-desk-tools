import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { openCadSqliteReadDatabase } from "../../lib/cadSqliteReadLease.js";

export const WORKSPACE_RECOVERY_LIMITS = Object.freeze({ databaseBytes: 128 * 1024 * 1024, outboxBytes: 64 * 1024 * 1024,
  totalBytes: 192 * 1024 * 1024, files: 4096, directories: 4096, entries: 8192, depth: 32,
  manifestBytes: 24 * 1024 * 1024, pathBytes: 4096, entryBytes: 255 });
export const WORKSPACE_BACKUP_MANIFEST = "phoenix-workspace-backup.v1.json";
export const WORKSPACE_RESTORE_MARKER = ".phoenix/workspace-recovery.complete.v1.json";
const DATABASE = ".phoenix/phoenix-workspace.sqlite", OUTBOX = ".phoenix/outbox", CHUNK = 64 * 1024;
export type RecoveryFile = { path: string; size: number; sha256: string };
export type WorkspaceRecoveryManifest = {
  format: "phoenix-workspace-recovery"; version: 1; state: "complete";
  databaseSchemaVersion: number | null; fileCount: number; totalBytes: number;
  directories: string[]; files: RecoveryFile[];
};
export type WorkspaceBackupReceipt = { backupDirectory: string; fileCount: number; totalBytes: number;
  databaseSchemaVersion: number | null; warnings: string[] };
export type WorkspaceRestoreReceipt = { workspace: string; fileCount: number; totalBytes: number; warnings: string[] };
export class WorkspaceRecoveryError extends Error {
  constructor(readonly code: string, message: string, readonly incompleteDirectory?: string, options?: ErrorOptions) { super(message, options); }
}
type Identity = { dev: number; ino: number };
type FileProof = { path: string; stat: fs.Stats; hash?: string };
type DirectoryProof = { path: string; identity: Identity; entries: string[] };
type Inventory = { files: FileProof[]; directories: DirectoryProof[] };
type OwnedRoot = { path: string; identity: Identity; parent: string; parentIdentity: Identity };
type Hooks = {
  /** Server-owned deterministic test seams, not request options. */
  afterDestinationCreated?: (operation: "backup" | "restore", destination: string) => void | Promise<void>;
  beforeCompletion?: (operation: "backup" | "restore", destination: string) => void | Promise<void>;
};
function error(code: string, message: string): never { throw new WorkspaceRecoveryError(code, message); }
const identity = (stat: fs.Stats): Identity => ({ dev: stat.dev, ino: stat.ino });
const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a: fs.Stats, b: fs.Stats) => a.isFile() && b.isFile() && sameIdentity(a, b)
  && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const checkActive = (signal?: AbortSignal) => { if (signal?.aborted) error("cancelled", "工作空间备份/恢复已取消"); };
function normalizeError(cause: unknown): WorkspaceRecoveryError {
  let primary = cause;
  for (let depth = 0; depth < 8 && primary instanceof AggregateError; depth++) primary = primary.errors[0];
  if (primary instanceof WorkspaceRecoveryError) return new WorkspaceRecoveryError(primary.code, primary.message, primary.incompleteDirectory, { cause });
  const message = primary instanceof Error ? primary.message : "";
  const code = /busy|database is locked|owns the lock/i.test(message) ? "busy" : /WAL|journal layout/.test(message) ? "unsupported_journal"
    : /identity changed|changed while/.test(message) ? "source_changed"
    : primary && typeof primary === "object" && "code" in primary && primary.code === "EEXIST" ? "conflict" : "io_error";
  return new WorkspaceRecoveryError(code, code === "busy" ? "数据库正被其他进程使用，未获取备份快照"
    : code === "unsupported_journal" ? "不支持 WAL/SHM 数据库布局，请先通过受控流程关闭并检查数据库"
    : code === "conflict" ? "目标已存在，不会覆盖" : "备份/恢复读取或写入失败", undefined, { cause });
}
function absolute(value: string) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    error("invalid_arguments", "必须使用规范化的绝对路径");
  }
  return value;
}
function canonicalDirectory(value: string) {
  absolute(value);
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(value) !== value) error("unsafe_path", "目录必须是已存在的 canonical 普通目录");
  return identity(stat);
}
function safeRelative(value: string, directory = false) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > WORKSPACE_RECOVERY_LIMITS.pathBytes
    || /[\\\u0000-\u001f\u007f]/.test(value) || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) error("invalid_backup", "备份相对路径无效");
  const parts = value.split("/");
  // Portable lexical guard: an opaque POSIX name must not become an ADS,
  // device, or trailing-dot/space alias when the package is restored elsewhere.
  if (parts.some(part => !part || part === "." || part === ".." || part.includes(":") || /[. ]$/.test(part)
      || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part) || Buffer.byteLength(part) > WORKSPACE_RECOVERY_LIMITS.entryBytes)
    || parts.length > WORKSPACE_RECOVERY_LIMITS.depth + 2) error("invalid_backup", "备份路径超过边界或包含遍历段");
  if (directory ? value !== ".phoenix" && value !== OUTBOX && !value.startsWith(`${OUTBOX}/`)
    : value !== DATABASE && !value.startsWith(`${OUTBOX}/`)) error("invalid_backup", "备份只能包含当前数据库和 outbox");
  return value;
}
function safePath(root: string, relative: string) {
  let current = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) error("unsafe_path", "不处理符号链接");
  }
  return current;
}
function disjoint(a: string, b: string) {
  const contains = (root: string, candidate: string) => { const rel = path.relative(root, candidate); return !rel || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)); };
  if (contains(a, b) || contains(b, a)) error("invalid_arguments", "源与目标目录不得相同、嵌套或重叠");
}
function newDestination(target: string): OwnedRoot {
  absolute(target); const parent = path.dirname(target), parentIdentity = canonicalDirectory(parent);
  const base = path.basename(target);
  if (!base || base === "." || base === ".." || Buffer.byteLength(base) > WORKSPACE_RECOVERY_LIMITS.entryBytes) error("invalid_arguments", "目标目录名称无效");
  fs.mkdirSync(target, { mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameIdentity(canonicalDirectory(parent), parentIdentity)) error("source_changed", "目标目录或父目录身份已变化");
  return { path: target, identity: identity(stat), parent, parentIdentity };
}
function assertOwned(root: OwnedRoot) {
  if (!sameIdentity(canonicalDirectory(root.parent), root.parentIdentity) || !sameIdentity(canonicalDirectory(root.path), root.identity)) error("source_changed", "目标目录或父目录身份已变化");
}
function exists(filename: string) {
  try { return fs.lstatSync(filename); } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  }
}
function requireDatabase(root: string) {
  const filename = safePath(root, ".phoenix");
  if (!fs.lstatSync(filename).isDirectory()) error("missing_database", "工作空间没有当前数据库目录");
  if (!exists(path.join(root, DATABASE))) error("missing_database", "没有当前 phoenix-workspace.sqlite；不会初始化或读取 legacy-only 数据库");
  const fd = fs.openSync(safePath(root, DATABASE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let primary: unknown, failed = false;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) error("unsafe_path", "数据库不是普通文件");
    if (stat.size > WORKSPACE_RECOVERY_LIMITS.databaseBytes) error("resource_limit", "数据库超过 128 MiB 上限");
    const header = Buffer.alloc(100), length = fs.readSync(fd, header, 0, header.length, 0);
    if (length !== 100 || header.subarray(0, 16).toString("binary") !== "SQLite format 3\u0000") error("integrity_error", "数据库为空或缺少有效 SQLite 文件头");
    if (header[18] !== 1 || header[19] !== 1 || exists(`${path.join(root, DATABASE)}-wal`) || exists(`${path.join(root, DATABASE)}-shm`)) error("unsupported_journal", "不支持 WAL/SHM 数据库布局");
    return stat;
  } catch (cause) { failed = true; primary = cause; throw cause; }
  finally {
    try { fs.closeSync(fd); } catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], "数据库头读取和关闭均失败"); throw cleanup; }
  }
}
function databaseInfo(db: ReturnType<typeof openCadSqliteReadDatabase>) {
  db.exec("PRAGMA trusted_schema=OFF");
  const row = db.prepare("PRAGMA integrity_check(1)").get();
  if (!row || Object.values(row)[0] !== "ok") error("integrity_error", "SQLite integrity_check 未通过");
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='phoenix_meta'").get();
  if (!table) return null;
  const columns = db.prepare("SELECT name FROM pragma_table_info('phoenix_meta') WHERE name IN ('key','value')").all().map(row => row.name);
  if (!columns.includes("key") || !columns.includes("value")) return null;
  const raw = db.prepare("SELECT CASE WHEN typeof(value)='text' AND length(value)<=16 THEN value ELSE NULL END AS value FROM phoenix_meta WHERE key='schema_version'").get()?.value;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const version = Number(raw); return Number.isSafeInteger(version) ? version : null;
}
async function withLease<T>(filename: string, operation: (db: ReturnType<typeof openCadSqliteReadDatabase>) => Promise<T>,
  published: () => boolean, warnings: string[]): Promise<T> {
  const db = openCadSqliteReadDatabase(filename); let failed = false, primary: unknown;
  try { db.assertLeaseOwner(); return await operation(db); }
  catch (cause) { failed = true; primary = cause; throw cause; }
  finally {
    try { db.close(); }
    catch (cleanup) {
      if (published()) warnings.push("已完成，但数据库连接/读取 lease 关闭失败；请检查本地锁状态");
      else if (failed) throw new AggregateError([primary, cleanup], "恢复操作和数据库 lease 关闭均失败");
      else throw cleanup;
    }
  }
}

function assertLeaseOwner(root: string, owner: Identity) {
  try { const lock = fs.lstatSync(safePath(root, `${DATABASE}.lock`));
    if (!lock.isDirectory() || lock.isSymbolicLink() || !sameIdentity(lock, owner)) error("source_changed", "数据库读取 lease 的 owner 已变化");
  } catch (cause) { throw new WorkspaceRecoveryError("source_changed", "数据库读取 lease 的 owner 已变化", undefined, { cause }); }
}
function* inventorySteps(root: string, kind: "source" | "package" | "target", signal?: AbortSignal,
  lockIdentity?: Identity): Generator<void, Inventory, void> {
  canonicalDirectory(root); const files: FileProof[] = [], directories: DirectoryProof[] = [];
  if (lockIdentity) assertLeaseOwner(root, lockIdentity);
  const pending = kind === "source" ? [".phoenix"] : [""], limit = WORKSPACE_RECOVERY_LIMITS; let visited = 0, total = 0, outbox = 0, ownerLeaseObserved = false;
  if (kind === "source") directories.push({ path: "", identity: canonicalDirectory(root), entries: ["d:.phoenix"] });
  while (pending.length) {
    checkActive(signal); const relative = pending.pop()!, filename = relative ? safePath(root, relative) : root;
    const before = fs.lstatSync(filename); if (!before.isDirectory()) error("unsafe_path", "清单包含非普通目录");
    if (relative && relative.split("/").length > limit.depth + 2) error("resource_limit", "outbox 目录深度超过 32 层");
    if (directories.length >= limit.directories) error("resource_limit", "目录数量超过 4096 上限");
    const entries: string[] = [], directory = fs.opendirSync(filename, { bufferSize: 32 }); let failed = false, primary: unknown;
    try {
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        checkActive(signal);
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        // A verified owner-only administrative lease is not package payload.
        // Counting it would make an otherwise valid near-cap package fail its
        // own verification only after acquiring the required read lease.
        if (relative === ".phoenix" && rel === `${DATABASE}.lock` && lockIdentity) {
          const lock = fs.lstatSync(path.join(root, rel));
          if (lock.isDirectory() && !lock.isSymbolicLink() && sameIdentity(lock, lockIdentity)) {
            if (ownerLeaseObserved) error("source_changed", "读取 lease 目录项重复，停止清单枚举");
            ownerLeaseObserved = true; continue;
          }
          error("source_changed", "读取 lease 的目录身份已变化");
        }
        if (++visited > limit.entries) error("resource_limit", "目录项数量超过 8192 上限");
        if (visited % 128 === 0) { yield; checkActive(signal); }
        if (!relative && kind === "source" && entry.name !== ".phoenix") continue;
        if (!relative && kind === "package" && entry.name === WORKSPACE_BACKUP_MANIFEST) continue;
        if (relative === ".phoenix" && kind === "source" && rel !== DATABASE && rel !== OUTBOX) continue;
        if (entry.isSymbolicLink()) error("unsafe_path", "备份范围包含符号链接");
        if (entry.isDirectory()) { safeRelative(rel, true); entries.push(`d:${entry.name}`); pending.push(rel); }
        else if (entry.isFile()) {
          safeRelative(rel); const stat = fs.lstatSync(safePath(root, rel));
          if (!stat.isFile()) error("unsafe_path", "文件类型在枚举时变化");
          if (files.length >= limit.files) error("resource_limit", "文件数量超过 4096 上限");
          if (rel === DATABASE && stat.size > limit.databaseBytes) error("resource_limit", "数据库超过 128 MiB 上限");
          total += stat.size; if (rel !== DATABASE) outbox += stat.size;
          if (total > limit.totalBytes || outbox > limit.outboxBytes) error("resource_limit", "outbox 或总备份字节超过上限");
          entries.push(`f:${entry.name}`); files.push({ path: rel, stat });
        } else error("unsafe_path", "备份范围包含 FIFO、设备或其他特殊文件");
      }
    } catch (cause) { failed = true; primary = cause; throw cause; }
    finally {
      try { directory.closeSync(); } catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], "目录枚举和关闭均失败"); throw cleanup; }
    }
    const after = fs.lstatSync(relative ? safePath(root, relative) : root);
    if (!after.isDirectory() || !sameIdentity(before, after)) error("source_changed", "枚举目录身份已变化");
    directories.push({ path: relative, identity: identity(before), entries: entries.sort() });
  }
  if (!files.some(file => file.path === DATABASE)) error("missing_database", "清单缺少当前数据库");
  if (lockIdentity) assertLeaseOwner(root, lockIdentity);
  return { files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    directories: directories.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}
async function inventory(root: string, kind: "source" | "package" | "target", signal?: AbortSignal, lock?: Identity): Promise<Inventory> {
  const steps = inventorySteps(root, kind, signal, lock);
  let step = steps.next(); while (!step.done) { await yieldToHost(); step = steps.next(); } return step.value;
}
function assertCurrent(root: string, proof: Inventory, kind: "source" | "package" | "target", signal?: AbortSignal, lock?: Identity) {
  try {
    const steps = inventorySteps(root, kind, signal, lock);
    let step = steps.next(); while (!step.done) step = steps.next();
    if (snapshot(proof) !== snapshot(step.value)) error("source_changed", "完成发布前目录、文件身份或清单已变化");
  } catch (cause) { const primary = normalizeError(cause); if (primary.code === "cancelled") throw cause;
    throw new WorkspaceRecoveryError("source_changed", "完成发布前目录、文件身份或清单已变化", undefined, { cause }); }
}
async function readHashed(root: string, proof: FileProof, signal?: AbortSignal, chunk?: (bytes: Buffer) => void) {
  checkActive(signal); const filename = safePath(root, proof.path);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let failed = false, primary: unknown;
  try {
    if (!sameFile(fs.fstatSync(fd), proof.stat)) error("source_changed", "文件身份、大小或时间在读取前已变化");
    const hash = createHash("sha256"), buffer = Buffer.alloc(CHUNK); let position = 0, chunks = 0;
    while (position < proof.stat.size) {
      checkActive(signal); const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, proof.stat.size - position), position);
      if (!length) error("source_changed", "文件在读取时缩短");
      hash.update(buffer.subarray(0, length)); chunk?.(buffer.subarray(0, length)); position += length;
      if (++chunks % 16 === 0) { await yieldToHost(); checkActive(signal); }
    }
    if (fs.readSync(fd, buffer, 0, 1, position) !== 0 || !sameFile(fs.fstatSync(fd), proof.stat)
      || !sameFile(fs.lstatSync(safePath(root, proof.path)), proof.stat)) error("source_changed", "文件在读取时变化");
    checkActive(signal); return hash.digest("hex");
  } catch (cause) { failed = true; primary = cause; throw cause; }
  finally {
    try { fs.closeSync(fd); } catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], "文件读取和关闭均失败"); throw cleanup; }
  }
}
function snapshot(inventory: Inventory) {
  return JSON.stringify({ files: inventory.files.map(file => ({ path: file.path, dev: file.stat.dev, ino: file.stat.ino,
    size: file.stat.size, mtime: file.stat.mtimeMs, ctime: file.stat.ctimeMs })), directories: inventory.directories });
}
async function verifyInventory(root: string, before: Inventory, kind: "source" | "package" | "target", signal?: AbortSignal, lock?: Identity) {
  checkActive(signal); const after = await inventory(root, kind, signal, lock);
  if (snapshot(before) !== snapshot(after)) error("source_changed", "数据库/outbox 清单或目录身份已变化");
  for (const file of before.files) if (!file.hash || await readHashed(root, file, signal) !== file.hash) error("source_changed", "数据库/outbox 内容哈希已变化");
  // Observe identities/presence again after the full bounded hash pass.
  if (snapshot(before) !== snapshot(await inventory(root, kind, signal, lock))) error("source_changed", "数据库/outbox 清单在最终验证时变化");
}
function createDirectories(root: OwnedRoot, directories: string[]) {
  for (const rel of [...directories].sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1))) {
    assertOwned(root); safeRelative(rel, true); const parent = path.posix.dirname(rel);
    if (parent !== ".") { const stat = fs.lstatSync(safePath(root.path, parent)); if (!stat.isDirectory()) error("unsafe_path", "目标父目录不是普通目录"); }
    fs.mkdirSync(path.join(root.path, rel), { mode: 0o700 }); assertOwned(root);
  }
}
async function copyExclusive(source: string, file: FileProof, destination: OwnedRoot, signal?: AbortSignal) {
  assertOwned(destination); const parent = path.posix.dirname(file.path);
  const parentPath = safePath(destination.path, parent), parentIdentity = canonicalDirectory(parentPath);
  const fd = fs.openSync(path.join(destination.path, file.path), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let failed = false, primary: unknown;
  try {
    assertOwned(destination); if (!sameIdentity(canonicalDirectory(parentPath), parentIdentity)) error("source_changed", "写入父目录身份已变化");
    const targetIdentity = identity(fs.fstatSync(fd));
    const hash = await readHashed(source, file, signal, bytes => {
      checkActive(signal); let position = 0;
      while (position < bytes.length) { const written = fs.writeSync(fd, bytes, position, bytes.length - position); if (!written) error("io_error", "文件写入未完成"); position += written; }
    });
    fs.fsyncSync(fd); assertOwned(destination);
    if (!sameIdentity(canonicalDirectory(parentPath), parentIdentity) || !sameIdentity(fs.lstatSync(safePath(destination.path, file.path)), targetIdentity)) error("source_changed", "写入目标身份已变化");
    return hash;
  } catch (cause) { failed = true; primary = cause; throw cause; }
  finally {
    try { fs.closeSync(fd); } catch (cleanup) { if (failed) throw new AggregateError([primary, cleanup], "文件复制和关闭均失败"); throw cleanup; }
  }
}
function manifest(inventory: Inventory, databaseSchemaVersion: number | null): WorkspaceRecoveryManifest {
  return { format: "phoenix-workspace-recovery", version: 1, state: "complete", databaseSchemaVersion,
    fileCount: inventory.files.length, totalBytes: inventory.files.reduce((sum, file) => sum + file.stat.size, 0),
    directories: inventory.directories.map(dir => dir.path).filter(Boolean),
    files: inventory.files.map(file => ({ path: file.path, size: file.stat.size, sha256: file.hash! })) };
}
function canonicalBytes(value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > WORKSPACE_RECOVERY_LIMITS.manifestBytes) error("resource_limit", "manifest 超过 24 MiB 上限");
  return bytes;
}
function writeCompletion(root: OwnedRoot, relative: string, bytes: Buffer, completed: () => void, warnings: string[],
  signal: AbortSignal | undefined, assertSource: () => void, assertActive?: () => void) {
  assertActive?.();
  assertOwned(root); checkActive(signal); const parent = path.posix.dirname(relative);
  const parentPath = parent === "." ? root.path : safePath(root.path, parent), parentIdentity = canonicalDirectory(parentPath);
  const filename = path.join(root.path, relative), temporary = path.join(root.parent, `.phoenix-recovery-marker-${randomUUID()}.tmp`);
  // The temporary file is outside the package inventory, but on the selected
  // parent filesystem. Only the marker link is atomic; the directory is not.
  const fd = fs.openSync(temporary, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let fileIdentity: Identity | undefined;
  let published = false, failed = false, primary: unknown;
  try {
    fileIdentity = identity(fs.fstatSync(fd)); assertOwned(root); let position = 0;
    while (position < bytes.length) { checkActive(signal); const written = fs.writeSync(fd, bytes, position, Math.min(CHUNK, bytes.length - position));
      if (!written) error("io_error", "完成 marker 写入未完成"); position += written; }
    assertOwned(root); checkActive(signal);
    const stat = fs.fstatSync(fd), leaf = fs.lstatSync(temporary);
    if (!sameIdentity(canonicalDirectory(parentPath), parentIdentity) || !stat.isFile() || !leaf.isFile() || stat.size !== bytes.length
      || !sameIdentity(stat, fileIdentity) || !sameIdentity(leaf, fileIdentity)) error("source_changed", "完成 marker 或其父目录已被替换");
    const hash = createHash("sha256"), buffer = Buffer.alloc(CHUNK); let readPosition = 0;
    while (readPosition < bytes.length) {
      checkActive(signal); const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, bytes.length - readPosition), readPosition);
      if (!length) error("source_changed", "完成 marker 在核验时缩短"); hash.update(buffer.subarray(0, length)); readPosition += length;
    }
    if (hash.digest("hex") !== createHash("sha256").update(bytes).digest("hex") || fs.readSync(fd, buffer, 0, 1, readPosition)
      || !sameFile(fs.fstatSync(fd), fs.lstatSync(temporary))) error("source_changed", "完成 marker 完整字节核验失败");
    fs.fsyncSync(fd);
    assertOwned(root); if (!sameIdentity(canonicalDirectory(parentPath), parentIdentity)) error("source_changed", "完成 marker 父目录已变化"); checkActive(signal);
    // Activity is server-owned; run it before the final source observation so
    // even a test callback cannot mutate a source after its publication guard.
    assertActive?.(); assertSource(); checkActive(signal);
    fs.linkSync(temporary, filename); // Atomic no-replace: EEXIST never replaces a competitor.
    // Publication has occurred. No post-publication cancellation/cleanup may
    // turn this into a claim that the completed package was never published.
    completed(); published = true;
    try { fs.fsyncSync(fd); } catch { warnings.push("完成 marker 已写入，但文件 fsync 失败；未承诺断电耐久性"); }
  } catch (cause) {
    failed = true; primary = cause;
    throw primary;
  }
  finally {
    const cleanupErrors: unknown[] = [];
    try { fs.closeSync(fd); } catch (cleanup) {
      if (published) warnings.push("完成 marker 已写入，但文件关闭失败");
      else cleanupErrors.push(cleanup);
    }
    try {
      if (fileIdentity && sameIdentity(canonicalDirectory(root.parent), root.parentIdentity)) {
        const current = exists(temporary);
        if (current && !current.isSymbolicLink() && current.isFile() && sameIdentity(current, fileIdentity)) fs.unlinkSync(temporary);
        else if (current) error("source_changed", "临时 marker 已替换，未删除其他 owner 的文件");
      } else error("source_changed", "临时 marker 父目录已变化，未清理未知目录");
    } catch (cleanup) {
      if (published) warnings.push("完成 marker 已发布，但自有临时文件清理未完成");
      else cleanupErrors.push(cleanup);
    }
    // Closing failure must not skip the identity-guarded temporary cleanup.
    // Preserve the primary cancellation/resource/consistency reason first.
    if (cleanupErrors.length) throw new AggregateError(failed ? [primary, ...cleanupErrors] : cleanupErrors,
      "marker 发布前失败或安全清理未完成");
  }
  try {
    const directory = fs.openSync(parentPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } catch { warnings.push("目录 fsync/关闭未完成；目录可见性不等于断电耐久性"); }
}
function incomplete(cause: unknown, owned: OwnedRoot | undefined, completed: boolean): never {
  const primary = normalizeError(cause); let directory: string | undefined;
  if (owned && !completed) { try { assertOwned(owned); directory = owned.path; } catch { /* Unknown replacement is not ours to clean or label complete. */ } }
  // Never recursively delete: retain the known exclusive root as incomplete.
  throw new WorkspaceRecoveryError(primary.code, primary.message + (directory ? "；保留未完成目录，请人工核对后处置" : ""), directory, { cause });
}
function preflightManifest(bytes: Buffer, signal?: AbortSignal) {
  // This is a resource scanner, not a second JSON parser. Strings (including
  // escapes) are skipped before structural depth/value counts are observed.
  // Legal v1 manifests have depth three and fewer than 50,000 such tokens.
  let depth = 0, tokens = 0, position = 0;
  const separators = new Set([34, 123, 91, 125, 93, 44, 58, 32, 9, 10, 13]);
  const count = () => { if (++tokens > 50_000) error("resource_limit", "manifest 结构/值项超过受控上限"); };
  while (position < bytes.length) {
    if (position % CHUNK === 0) checkActive(signal);
    const byte = bytes[position++];
    if (byte === 34) {
      count(); const start = position;
      while (position < bytes.length) {
        const next = bytes[position++];
        if (next === 34) break;
        if (next === 92 && position < bytes.length) position++;
        if (position - start > 32_768) error("resource_limit", "manifest 单个原始字符串超过受控上限");
      }
    } else if (byte === 123 || byte === 91) {
      count(); if (++depth > 4) error("resource_limit", "manifest JSON 深度超过受控上限");
    } else if (byte === 125 || byte === 93) { count(); depth--; }
    else if (byte === 44 || byte === 58 || byte === 32 || byte === 9 || byte === 10 || byte === 13) { /* JSON separator */ }
    else {
      count();
      while (position < bytes.length && !separators.has(bytes[position])) position++;
    }
  }
  checkActive(signal);
}
async function boundedManifest(root: string, signal?: AbortSignal) {
  const filename = path.join(root, WORKSPACE_BACKUP_MANIFEST), stat = exists(filename);
  if (!stat) error("incomplete_backup", "备份缺少最后写入的 complete manifest");
  if (!stat.isFile() || stat.isSymbolicLink()) error("unsafe_path", "manifest 不是普通文件");
  if (stat.size > WORKSPACE_RECOVERY_LIMITS.manifestBytes) error("resource_limit", "manifest 超过 24 MiB 上限");
  const chunks: Buffer[] = [];
  const proof = { path: WORKSPACE_BACKUP_MANIFEST, stat };
  const hash = await readHashed(root, proof, signal, bytes => chunks.push(Buffer.from(bytes)));
  const bytes = Buffer.concat(chunks); preflightManifest(bytes, signal); let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { error("incomplete_backup", "manifest 为无效 UTF-8/JSON 或尚未写完整"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) error("invalid_backup", "manifest 格式无效");
  const value = parsed as Record<string, unknown>, keys = ["format", "version", "state", "databaseSchemaVersion", "fileCount", "totalBytes", "directories", "files"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value)) || value.format !== "phoenix-workspace-recovery" || value.version !== 1 || value.state !== "complete"
    || !(value.databaseSchemaVersion === null || (Number.isSafeInteger(value.databaseSchemaVersion) && Number(value.databaseSchemaVersion) >= 0))
    || !Number.isSafeInteger(value.fileCount) || !Number.isSafeInteger(value.totalBytes) || !Array.isArray(value.directories) || !Array.isArray(value.files)) error("invalid_backup", "manifest 版本、状态或字段无效");
  if (value.files.length < 1 || value.files.length > WORKSPACE_RECOVERY_LIMITS.files || value.directories.length > WORKSPACE_RECOVERY_LIMITS.directories) error("resource_limit", "manifest 清单超过数量上限");
  const directories: string[] = [], files: RecoveryFile[] = [];
  for (const dir of value.directories) { if (typeof dir !== "string") error("invalid_backup", "目录清单无效"); directories.push(safeRelative(dir, true)); }
  for (const raw of value.files) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) error("invalid_backup", "文件清单无效");
    const file = raw as Record<string, unknown>;
    if (Object.keys(file).length !== 3 || typeof file.path !== "string" || !Number.isSafeInteger(file.size) || Number(file.size) < 0
      || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) error("invalid_backup", "文件字段、大小或 SHA-256 无效");
    files.push({ path: safeRelative(file.path), size: Number(file.size), sha256: file.sha256 });
  }
  if (new Set(directories).size !== directories.length || new Set(files.map(file => file.path)).size !== files.length
    || !directories.includes(".phoenix") || files.filter(file => file.path === DATABASE).length !== 1) error("invalid_backup", "manifest 重复或缺少当前数据库路径");
  const result: WorkspaceRecoveryManifest = { format: "phoenix-workspace-recovery", version: 1, state: "complete",
    databaseSchemaVersion: value.databaseSchemaVersion as number | null, fileCount: Number(value.fileCount), totalBytes: Number(value.totalBytes), directories, files };
  if (result.fileCount !== files.length || result.totalBytes !== files.reduce((sum, file) => sum + file.size, 0)
    || !bytes.equals(canonicalBytes(result))) error("invalid_backup", "manifest 计数或 canonical 字节不一致");
  return { manifest: result, proof: { ...proof, hash } };
}
async function verifiedBackup<T>(backupDirectory: string, signal: AbortSignal | undefined,
  operation: (root: string, data: WorkspaceRecoveryManifest, inventory: Inventory, revalidate: () => Promise<void>, assertCurrentSource: () => void) => Promise<T>,
  published: () => boolean, warnings: string[], expectedManifestSha256?: string, assertActive?: () => void) {
  assertActive?.();
  canonicalDirectory(backupDirectory); checkActive(signal); const document = await boundedManifest(backupDirectory, signal);
  if (expectedManifestSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedManifestSha256) || expectedManifestSha256 !== document.proof.hash)) {
    error("source_changed", "备份 manifest 已不同于服务器检查的版本，请重新检查；未创建恢复目录");
  }
  assertActive?.();
  requireDatabase(backupDirectory); const initial = await inventory(backupDirectory, "package", signal);
  const dirs = initial.directories.map(dir => dir.path).filter(Boolean);
  if (JSON.stringify(dirs) !== JSON.stringify(document.manifest.directories) || initial.files.length !== document.manifest.files.length) error("invalid_backup", "备份磁盘清单与 manifest 不一致");
  return withLease(path.join(backupDirectory, DATABASE), async db => {
    const lock = identity(fs.lstatSync(`${path.join(backupDirectory, DATABASE)}.lock`));
    if (databaseInfo(db) !== document.manifest.databaseSchemaVersion) error("invalid_backup", "备份数据库 schema 记录与 manifest 不一致");
    for (let i = 0; i < initial.files.length; i++) {
      const file = initial.files[i], declared = document.manifest.files[i];
      if (file.path !== declared.path || file.stat.size !== declared.size || (file.hash = await readHashed(backupDirectory, file, signal)) !== declared.sha256) error("invalid_backup", "备份文件大小或内容哈希与 manifest 不一致");
    }
    const revalidate = async () => {
      assertActive?.();
      db.assertLeaseOwner();
      await verifyInventory(backupDirectory, initial, "package", signal, lock);
      if (await readHashed(backupDirectory, document.proof, signal) !== document.proof.hash) error("source_changed", "备份 manifest 在读取期间变化");
      db.assertLeaseOwner();
    };
    const assertCurrentSource = () => {
      db.assertLeaseOwner();
      assertCurrent(backupDirectory, initial, "package", signal, lock);
      if (!sameFile(fs.lstatSync(safePath(backupDirectory, WORKSPACE_BACKUP_MANIFEST)), document.proof.stat)) error("source_changed", "备份 manifest 在完成发布前变化");
      db.assertLeaseOwner();
    };
    await revalidate(); return operation(backupDirectory, document.manifest, initial, revalidate, assertCurrentSource);
  }, published, warnings);
}

export function createWorkspaceRecoveryEngine(hooks: Hooks = {}) {
  async function createWorkspaceRecoveryBackup({ workspace, destinationDirectory, signal, assertActive }: { workspace: string; destinationDirectory: string; signal?: AbortSignal; /** Server-only lifecycle hook, never an HTTP field. */ assertActive?: () => void }): Promise<WorkspaceBackupReceipt> {
    let owned: OwnedRoot | undefined, completed = false; const warnings: string[] = [];
    try {
      assertActive?.(); canonicalDirectory(workspace); absolute(destinationDirectory); disjoint(workspace, destinationDirectory); checkActive(signal);
      if (!exists(path.join(workspace, ".phoenix")) || !exists(path.join(workspace, DATABASE))) error("missing_database", "没有当前数据库；不会初始化或备份 legacy-only 数据库");
      const original = requireDatabase(workspace);
      return await withLease(path.join(workspace, DATABASE), async db => {
        const sourceLock = identity(fs.lstatSync(`${path.join(workspace, DATABASE)}.lock`));
        const schemaVersion = databaseInfo(db), source = await inventory(workspace, "source", signal, sourceLock);
        if (!sameFile(source.files.find(file => file.path === DATABASE)!.stat, original)) error("source_changed", "数据库在获取读取 lease 时变化");
        assertActive?.(); owned = newDestination(destinationDirectory); await hooks.afterDestinationCreated?.("backup", owned.path); checkActive(signal); assertActive?.(); assertOwned(owned);
        createDirectories(owned, source.directories.map(dir => dir.path).filter(Boolean));
        for (const file of source.files) { assertActive?.(); file.hash = await copyExclusive(workspace, file, owned, signal); }
        const data = manifest(source, schemaVersion), bytes = canonicalBytes(data);
        await hooks.beforeCompletion?.("backup", owned.path); checkActive(signal); assertActive?.();
        await verifyInventory(workspace, source, "source", signal, sourceLock);
        requireDatabase(workspace); assertOwned(owned);
        const copied = await inventory(owned.path, "target", signal);
        if (JSON.stringify(copied.directories.map(dir => dir.path).filter(Boolean)) !== JSON.stringify(data.directories)
          || JSON.stringify(copied.files.map(file => ({ path: file.path, size: file.stat.size }))) !== JSON.stringify(data.files.map(file => ({ path: file.path, size: file.size })))) error("source_changed", "备份目标出现未知文件、目录或大小变化");
        for (let i = 0; i < copied.files.length; i++) if ((copied.files[i].hash = await readHashed(owned.path, copied.files[i], signal)) !== data.files[i].sha256) error("source_changed", "备份目标内容已变化");
        await withLease(path.join(owned.path, DATABASE), async copiedDb => { if (databaseInfo(copiedDb) !== schemaVersion) error("integrity_error", "复制后数据库验证失败"); }, () => false, warnings);
        await verifyInventory(workspace, source, "source", signal, sourceLock); await verifyInventory(owned.path, copied, "target", signal);
        assertOwned(owned); checkActive(signal);
        writeCompletion(owned, WORKSPACE_BACKUP_MANIFEST, bytes, () => { completed = true; }, warnings, signal,
          () => { db.assertLeaseOwner(); assertCurrent(workspace, source, "source", signal, sourceLock); assertOwned(owned!); assertCurrent(owned!.path, copied, "target", signal); db.assertLeaseOwner(); }, assertActive);
        return { backupDirectory: owned.path, fileCount: data.fileCount, totalBytes: data.totalBytes, databaseSchemaVersion: schemaVersion, warnings };
      }, () => completed, warnings);
    } catch (cause) { return incomplete(cause, owned, completed); }
  }
  async function inspectWorkspaceRecoveryBackup(backupDirectory: string, signal?: AbortSignal, assertActive?: () => void): Promise<WorkspaceRecoveryManifest> {
    const warnings: string[] = [];
    try { return await verifiedBackup(backupDirectory, signal, async (_root, data) => { assertActive?.(); return data; }, () => false, warnings, undefined, assertActive); }
    catch (cause) { throw normalizeError(cause); }
  }
  async function restoreWorkspaceRecoveryBackup({ backupDirectory, destinationWorkspace, signal, expectedManifestSha256, assertActive }: { backupDirectory: string; destinationWorkspace: string; signal?: AbortSignal; /** Server-bound fingerprint, not a client proof. */ expectedManifestSha256?: string; assertActive?: () => void }): Promise<WorkspaceRestoreReceipt> {
    let owned: OwnedRoot | undefined, completed = false; const warnings: string[] = [];
    try {
      assertActive?.(); absolute(backupDirectory); absolute(destinationWorkspace); disjoint(backupDirectory, destinationWorkspace); checkActive(signal);
      return await verifiedBackup(backupDirectory, signal, async (source, data, proof, revalidate, assertSource) => {
        assertActive?.(); owned = newDestination(destinationWorkspace); await hooks.afterDestinationCreated?.("restore", owned.path); checkActive(signal); assertActive?.(); assertOwned(owned);
        createDirectories(owned, data.directories);
        for (const file of proof.files) { assertActive?.(); if (await copyExclusive(source, file, owned, signal) !== file.hash) error("source_changed", "复制时备份内容变化"); }
        const bytes = canonicalBytes({ format: "phoenix-workspace-restore", version: 1, state: "complete", databaseSchemaVersion: data.databaseSchemaVersion,
          fileCount: data.fileCount, totalBytes: data.totalBytes });
        await hooks.beforeCompletion?.("restore", owned.path); checkActive(signal); await revalidate(); assertOwned(owned);
        const copied = await inventory(owned.path, "target", signal);
        if (JSON.stringify(copied.directories.map(dir => dir.path).filter(Boolean)) !== JSON.stringify(data.directories)
          || copied.files.length !== data.files.length) error("source_changed", "恢复目标出现未知文件或目录");
        for (let i = 0; i < copied.files.length; i++) if (copied.files[i].path !== data.files[i].path || copied.files[i].stat.size !== data.files[i].size
          || (copied.files[i].hash = await readHashed(owned.path, copied.files[i], signal)) !== data.files[i].sha256) error("source_changed", "恢复目标内容已变化");
        await withLease(path.join(owned.path, DATABASE), async copiedDb => { if (databaseInfo(copiedDb) !== data.databaseSchemaVersion) error("integrity_error", "恢复后数据库验证失败"); }, () => false, warnings);
        await revalidate(); await verifyInventory(owned.path, copied, "target", signal);
        assertOwned(owned); checkActive(signal); writeCompletion(owned, WORKSPACE_RESTORE_MARKER, bytes, () => { completed = true; }, warnings, signal,
          () => { assertSource(); assertOwned(owned!); assertCurrent(owned!.path, copied, "target", signal); }, assertActive);
        return { workspace: owned.path, fileCount: data.fileCount, totalBytes: data.totalBytes, warnings };
      }, () => completed, warnings, expectedManifestSha256, assertActive);
    } catch (cause) { return incomplete(cause, owned, completed); }
  }
  return { createWorkspaceRecoveryBackup, inspectWorkspaceRecoveryBackup, restoreWorkspaceRecoveryBackup };
}
const engine = createWorkspaceRecoveryEngine();
export const createWorkspaceRecoveryBackup = engine.createWorkspaceRecoveryBackup;
export const inspectWorkspaceRecoveryBackup = engine.inspectWorkspaceRecoveryBackup;
export const restoreWorkspaceRecoveryBackup = engine.restoreWorkspaceRecoveryBackup;
