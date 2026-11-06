import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pnwCreateDb, type PnwDbAdapter } from '@phoenix-wing/db-node';
import { pnwInferBomDocumentKinds, pnwInferBomFieldsFromFilename, pnwExtractXlinksFromDocumentXml } from '@phoenix-wing/cad-core';
import { fcstdWorkspace, readFcstdLightArchive, safeFcstdPath } from '../../lib/fcstdBatchFiles.js';
import { extractFcstdEmbeddedBomSnapshot } from '../../lib/fcstdDocumentXmlService.js';
import { cachedRow, fileStamp, openGalleryDb, saveRow } from '../part-gallery/storage.js';
import type { GalleryRow } from '../part-gallery/types.js';
import { validateWorkerPng } from './worker-png.js';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const PROFILE = 'native-isometric-white-v1' as const;
const SOURCE_MAX = 64 * 1024 * 1024, PNG_MAX = 4 * 1024 * 1024, RECORD_MAX = 128 * 1024;
const DATABASE = '.phoenix/phoenix-workspace.sqlite';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Identity = { dev: string; ino: string; size: number; mtimeNs: string; ctimeNs: string };
export interface WorkerThumbnailPublicationInput {
  workspacePath: string;
  filePath: string;
  expectedSourceSha256: string;
  worker: { workerId: string; sessionId: string; jobId: string };
  inputRevision: { sha256: string; bytes: number };
  renderProfile: typeof PROFILE;
  image: { png: Uint8Array; sha256: string; bytes: number; width: number; height: number };
  cameraRestored: true; documentsClosed: true; savedCad: false; workerReusable: true;
}
export interface WorkerThumbnailPublicationResult {
  status: 'published' | 'failed' | 'unknown';
  code: string;
  sourceWritten: false;
  cacheRel: string | null;
  evidenceRel: string | null;
  cacheCreated: boolean | null;
  /** Whether this attempt's DB commit was observed, not a lasting freshness guarantee. */
  registered: boolean | null;
}
export type ThumbnailPublicationCheckpoint = 'after_intent' | 'before_cache_install' | 'after_cache_install'
  | 'before_database_commit' | 'after_database_commit' | 'before_published_receipt';
/** Internal fault seam; never expose checkpoints or database ports to HTTP. */
export interface ThumbnailPublicationOptions { checkpoint?: (point: ThumbnailPublicationCheckpoint) => void }
class PublicationError extends Error { constructor(readonly code: string) { super(code); } }
const fail = (code: string): never => { throw new PublicationError(code); };
const identity = (stat: fs.BigIntStats): Identity => ({ dev: String(stat.dev), ino: String(stat.ino), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
const same = (a: fs.BigIntStats, b: fs.BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const sameNode = (a: fs.BigIntStats, b: fs.BigIntStats) => a.dev === b.dev && a.ino === b.ino;
const absent = (filename: string) => {
  try { fs.lstatSync(filename); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
};
function relative(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
    || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || ['.git', '.phoenix'].includes(part.toLowerCase()))
    || !/\.fcstd$/i.test(value)) fail('invalid_source_path');
  return value;
}
function rootFor(workspace: string) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || path.resolve(workspace) !== workspace || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(workspace)) fail('unsafe_workspace');
  const root = fcstdWorkspace(workspace);
  if (root !== workspace || root === path.parse(root).root) fail('unsafe_workspace');
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_workspace');
  }
  return root;
}
/** Pin every directory used for publication. Never adopt a replaced ancestor. */
class Directories {
  private readonly nodes = new Map<string, fs.BigIntStats>();
  constructor(readonly root: string) { this.nodes.set(root, fs.lstatSync(root, { bigint: true })); }
  check() {
    for (const [filename, before] of this.nodes) {
      const current = fs.lstatSync(filename, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameNode(before, current) || fs.realpathSync(filename) !== filename) fail('directory_changed');
    }
  }
  ensure(rel: string, privateMode = false, create = true) {
    let current = this.root;
    for (const part of rel.split('/')) {
      this.check(); current = path.join(current, part);
      if (absent(current)) { if (!create) fail('directory_changed'); fs.mkdirSync(current, { mode: 0o700 }); syncDirectory(path.dirname(current)); }
      const stat = fs.lstatSync(current, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(current) !== current) fail('unsafe_directory');
      if (this.nodes.has(current) && !sameNode(this.nodes.get(current)!, stat)) fail('directory_changed');
      this.nodes.set(current, stat);
    }
    if (privateMode && (fs.lstatSync(current).mode & 0o077) !== 0) fail('evidence_not_private');
    this.check(); return current;
  }
}
function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function stableBytes(filename: string, maximum: number): { bytes: Buffer; stat: fs.BigIntStats } {
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum)) fail('unsafe_or_oversized_file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!same(before, fs.fstatSync(fd, { bigint: true }))) fail('file_changed');
    const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, Math.min(65536, bytes.length - length), length); if (!n) break; length += n; }
    if (BigInt(length) !== before.size || !same(before, fs.fstatSync(fd, { bigint: true })) || !same(before, fs.lstatSync(filename, { bigint: true }))) fail('file_changed');
    return { bytes: bytes.subarray(0, length), stat: before };
  } finally { fs.closeSync(fd); }
}
function writeNew(filename: string, bytes: Uint8Array) {
  const fd = fs.openSync(filename, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < bytes.byteLength) { const n = fs.writeSync(fd, bytes, offset, Math.min(65536, bytes.byteLength - offset), offset); if (n < 1) fail('incomplete_write'); offset += n; }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
function receipt(directories: Directories, directory: string, name: string, value: unknown) {
  try {
    directories.check(); const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > RECORD_MAX) fail('receipt_too_large');
    writeNew(path.join(directory, name), bytes); syncDirectory(directory); directories.check();
  } catch { fail('receipt_unconfirmed'); }
}
function argumentsChecked(input: WorkerThumbnailPublicationInput): Buffer {
  relative(input.filePath);
  if (!SHA.test(input.expectedSourceSha256) || !input.worker || ![input.worker.workerId, input.worker.sessionId, input.worker.jobId].every(value => typeof value === 'string' && UUID.test(value))
    || !input.inputRevision || input.inputRevision.sha256 !== input.expectedSourceSha256 || !Number.isSafeInteger(input.inputRevision.bytes) || input.inputRevision.bytes < 1 || input.inputRevision.bytes > SOURCE_MAX
    || input.renderProfile !== PROFILE || input.cameraRestored !== true || input.documentsClosed !== true || input.savedCad !== false || input.workerReusable !== true
    || !input.image || !(input.image.png instanceof Uint8Array) || input.image.png.byteLength > PNG_MAX) fail('invalid_worker_success');
  return validateWorkerPng(input.image.png, input.image);
}
function galleryRow(root: string, rel: string, source: { bytes: Buffer; stat: fs.BigIntStats }, input: WorkerThumbnailPublicationInput): GalleryRow {
  const archive = readFcstdLightArchive(safeFcstdPath(root, rel));
  if (sha(archive.bytes) !== input.expectedSourceSha256) fail('source_changed');
  const inferred = pnwInferBomFieldsFromFilename(rel), fields = extractFcstdEmbeddedBomSnapshot(archive.xml).fields, kinds = pnwInferBomDocumentKinds(rel);
  const row: GalleryRow = { rel, part_number: fields?.PartNumber || inferred.PartNumber, part_version: fields?.PartVersion || inferred.PartVersion,
    part_name: fields?.PartName || inferred.PartName || path.basename(rel), type_code: fields?.TypeCode || inferred.TypeCode,
    role: kinds.drawing ? 'drawing' : kinds.assembly ? 'assembly' : 'part', status: 'ready', width: input.image.width, height: input.image.height,
    image_hash: input.image.sha256, source_stamp: fileStamp(path.join(root, rel)), source_hash: input.expectedSourceSha256,
    updated_at: new Date().toISOString(), message: '独立 worker 外部缩略图（未修改 FCStd）', refs: pnwExtractXlinksFromDocumentXml(archive.xml).map(link => link.file) };
  if (Buffer.byteLength(JSON.stringify(row)) > RECORD_MAX / 2 || !same(source.stat, fs.lstatSync(path.join(root, rel), { bigint: true }))) fail('source_metadata_invalid_or_changed');
  return row;
}
function checkDatabase(root: string, expected?: fs.BigIntStats) {
  const filename = path.join(root, DATABASE);
  if (absent(filename)) { if (expected) fail('database_changed'); return undefined; }
  const stat = fs.lstatSync(filename, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(SOURCE_MAX) || fs.realpathSync(filename) !== filename
    || expected && !sameNode(stat, expected)) fail('unsafe_or_changed_database');
  for (const suffix of ['-wal', '-shm']) if (!absent(filename + suffix)) fail('unsupported_database_journal');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!sameNode(stat, fs.fstatSync(fd, { bigint: true }))) fail('database_changed');
    const header = Buffer.alloc(20), length = fs.readSync(fd, header, 0, header.length, 0);
    if (length === 20 && (header[18] === 2 || header[19] === 2)) fail('unsupported_database_journal');
  } finally { fs.closeSync(fd); }
  return stat;
}
function syncDatabase(root: string, expected: fs.BigIntStats) {
  checkDatabase(root, expected);
  const fd = fs.openSync(path.join(root, DATABASE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try { if (!sameNode(expected, fs.fstatSync(fd, { bigint: true }))) fail('database_changed'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDirectory(path.join(root, '.phoenix')); checkDatabase(root, expected);
}

/** Publish one already-completed worker image. This never launches Native,
 * saves CAD, recursively discovers files, retries an attempt or embeds PNG in a
 * task ledger. Artifacts and database commits are not a cross-file transaction:
 * a lost commit/receipt is unknown and retained evidence never grants replay. */
export function publishWorkerThumbnail(input: WorkerThumbnailPublicationInput, options: ThumbnailPublicationOptions = {}): WorkerThumbnailPublicationResult {
  let result: WorkerThumbnailPublicationResult = { status: 'failed', code: 'publication_preflight_failed', sourceWritten: false, cacheRel: null, evidenceRel: null, cacheCreated: false, registered: false };
  let directories: Directories | undefined, evidence: string | undefined, temporary: string | undefined, temporaryStat: fs.BigIntStats | undefined;
  let db: PnwDbAdapter | undefined, commitAttempted = false, committed = false;
  const point = (name: ThumbnailPublicationCheckpoint) => options.checkpoint?.(name);
  try {
    const png = argumentsChecked(input), root = rootFor(input.workspacePath), rel = relative(input.filePath);
    const sourceFile = safeFcstdPath(root, rel), source = stableBytes(sourceFile, SOURCE_MAX);
    if (source.bytes.length !== input.inputRevision.bytes || sha(source.bytes) !== input.expectedSourceSha256) fail('source_changed');
    const verifySource = () => {
      directories!.check();
      if (safeFcstdPath(root, rel) !== sourceFile) fail('source_changed');
      const current = stableBytes(sourceFile, SOURCE_MAX);
      if (!same(source.stat, current.stat) || sha(current.bytes) !== input.expectedSourceSha256) fail('source_changed');
    };
    const row = galleryRow(root, rel, source, input);
    directories = new Directories(root);
    // Pin source ancestors as well as every cache/evidence ancestor.
    if (path.posix.dirname(rel) !== '.') directories.ensure(path.posix.dirname(rel), false, false);
    const evidenceParent = directories.ensure('.phoenix/freecad-mcp/thumbnail-publications', true);
    const evidenceName = `${input.worker.workerId}-${input.worker.sessionId}-${input.worker.jobId}`;
    evidence = path.join(evidenceParent, evidenceName); result.evidenceRel = path.relative(root, evidence).replace(/\\/g, '/');
    try { fs.mkdirSync(evidence, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { ...result, status: 'unknown', code: 'publication_already_attempted', cacheCreated: null, registered: null };
      throw error;
    }
    directories.ensure(`${path.relative(root, evidence).replace(/\\/g, '/')}`, true); syncDirectory(evidenceParent);
    const cache = directories.ensure('.phoenix/thumbnail-cache'), cacheRel = `.phoenix/thumbnail-cache/${input.image.sha256}.png`;
    const temporaryRel = `.phoenix/thumbnail-cache/.worker-thumbnail-${randomUUID()}.tmp`;
    result.cacheRel = cacheRel;
    const binding = { schema_version: 1, worker: input.worker, file_rel: rel, source_sha256: input.expectedSourceSha256, source_bytes: source.bytes.length,
      source_identity: identity(source.stat), render_profile: input.renderProfile,
      image: { sha256: input.image.sha256, bytes: png.length, width: input.image.width, height: input.image.height }, cache_rel: cacheRel, temporary_rel: temporaryRel,
      camera_restored: true, documents_closed: true, saved_cad: false, worker_reusable: true };
    receipt(directories, evidence, 'intent.json', binding); point('after_intent'); verifySource();
    const target = path.join(root, cacheRel);
    const verifyImage = () => { directories!.check(); const current = stableBytes(target, PNG_MAX); if (sha(current.bytes) !== input.image.sha256 || !current.bytes.equals(png)) fail('cache_content_conflict'); };
    if (!absent(target)) verifyImage();
    else {
      temporary = path.join(root, temporaryRel); directories.check(); writeNew(temporary, png);
      temporaryStat = fs.lstatSync(temporary, { bigint: true });
      if (!stableBytes(temporary, PNG_MAX).bytes.equals(png)) fail('temporary_image_changed');
      point('before_cache_install'); verifySource(); directories.check();
      try { fs.linkSync(temporary, target); result.cacheCreated = true; }
      catch (error) {
        // Reconcile a syscall that may have installed its link before losing
        // the return result. Never replace or delete a different target.
        if (!absent(target) && sameNode(temporaryStat, fs.lstatSync(target, { bigint: true }))) result.cacheCreated = true;
        else if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { result.cacheCreated = null; throw error; }
      }
      const named = fs.lstatSync(temporary, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink() || !sameNode(named, temporaryStat)) fail('temporary_identity_changed');
      fs.unlinkSync(temporary); temporary = undefined; syncDirectory(cache); verifyImage();
    }
    syncDirectory(cache); point('after_cache_install'); verifySource(); verifyImage();
    receipt(directories, evidence, 'cache-installed.json', { ...binding, cache_created: result.cacheCreated });
    const existingDatabase = checkDatabase(root);
    if (!absent(path.join(root, DATABASE + '.lock')) || !absent(path.join(root, DATABASE + '-journal'))) fail('database_busy');
    // Do not use the legacy create=true bootstrap: its DDL happens outside our
    // transaction. Reuse the exact GalleryRow/saveRow layout, creating only its
    // thumbnail table inside this attempt's transaction when necessary.
    directories.check(); db = existingDatabase ? openGalleryDb(root)! : pnwCreateDb(path.join(root, DATABASE));
    const databaseIdentity = checkDatabase(root, existingDatabase)!;
    db.exec('PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE');
    const table = db.get<{ type: string }>("SELECT type FROM sqlite_master WHERE name='desk_cad_thumbnail'");
    if (table && table.type !== 'table') fail('unsupported_database_schema');
    if (db.all("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('desk_cad_thumbnail','desk_thumbnail_worker_publication') LIMIT 1").length) fail('unsupported_database_triggers');
    db.exec(`CREATE TABLE IF NOT EXISTS desk_cad_thumbnail (
      rel TEXT PRIMARY KEY, part_number TEXT NOT NULL, part_version TEXT NOT NULL,
      part_name TEXT NOT NULL, type_code TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, image_hash TEXT NOT NULL,
      source_stamp TEXT NOT NULL, source_hash TEXT NOT NULL, updated_at TEXT NOT NULL,
      message TEXT NOT NULL, refs_json TEXT NOT NULL)`);
    const oldRow = cachedRow(db, rel);
    if (oldRow && Buffer.byteLength(JSON.stringify(oldRow)) > RECORD_MAX / 2) fail('previous_row_too_large');
    db.exec(`CREATE TABLE IF NOT EXISTS desk_thumbnail_worker_publication (
      worker_id TEXT NOT NULL, session_id TEXT NOT NULL, job_id TEXT NOT NULL, file_rel TEXT NOT NULL,
      source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL, render_profile TEXT NOT NULL,
      image_sha256 TEXT NOT NULL, image_bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      cache_rel TEXT NOT NULL, receipt_rel TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(worker_id,session_id,job_id))`);
    if (db.get('SELECT 1 FROM desk_thumbnail_worker_publication WHERE worker_id=? AND session_id=? AND job_id=?', [input.worker.workerId, input.worker.sessionId, input.worker.jobId])) fail('database_attempt_already_recorded');
    receipt(directories, evidence, 'database-intent.json', { ...binding, previous_row: oldRow, next_row: row });
    saveRow(db, row);
    db.run('INSERT INTO desk_thumbnail_worker_publication VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [input.worker.workerId, input.worker.sessionId, input.worker.jobId, rel,
      input.expectedSourceSha256, source.bytes.length, input.renderProfile, input.image.sha256, png.length, input.image.width, input.image.height, cacheRel, result.evidenceRel, row.updated_at]);
    point('before_database_commit'); verifySource(); verifyImage(); checkDatabase(root, databaseIdentity);
    commitAttempted = true; db.exec('COMMIT'); committed = true; result.registered = true;
    point('after_database_commit'); db.close(); db = undefined; syncDatabase(root, databaseIdentity);
    db = openGalleryDb(root)!; db.exec('PRAGMA trusted_schema=OFF; BEGIN');
    const registered = cachedRow(db, rel), recorded = db.get<{ file_rel: string; source_sha256: string; image_sha256: string; render_profile: string }>(
      'SELECT file_rel,source_sha256,image_sha256,render_profile FROM desk_thumbnail_worker_publication WHERE worker_id=? AND session_id=? AND job_id=?',
      [input.worker.workerId, input.worker.sessionId, input.worker.jobId]);
    if (!registered || Object.keys(row).some(key => JSON.stringify(registered[key as keyof GalleryRow]) !== JSON.stringify(row[key as keyof GalleryRow]))
      || recorded?.file_rel !== rel || recorded.source_sha256 !== input.expectedSourceSha256 || recorded.image_sha256 !== input.image.sha256 || recorded.render_profile !== PROFILE) fail('registration_changed');
    // Hold this verified read transaction while publishing the local receipt;
    // another cooperating gallery writer cannot replace the row in that gap.
    point('before_published_receipt'); verifySource(); verifyImage();
    receipt(directories, evidence, 'published.json', { ...binding, cache_created: result.cacheCreated, registered: true, source_written: false });
    verifySource(); verifyImage(); db.exec('ROLLBACK'); db.close(); db = undefined; checkDatabase(root, databaseIdentity);
    return { ...result, status: 'published', code: 'published' };
  } catch (error) {
    let rollbackFailed = false;
    if (db?.inTransaction) try { db.exec('ROLLBACK'); } catch { rollbackFailed = true; }
    if (db) { try { db.close(); } catch { rollbackFailed = true; } db = undefined; }
    if (commitAttempted && !committed || rollbackFailed) result.registered = null;
    const unknown = committed || commitAttempted || rollbackFailed || result.cacheCreated === null || error instanceof PublicationError && error.code === 'receipt_unconfirmed';
    result = { ...result, status: unknown ? 'unknown' : 'failed', code: error instanceof PublicationError ? error.code : unknown ? 'publication_outcome_unknown' : 'publication_failed' };
    if (evidence && directories) try { receipt(directories, evidence, 'failure.json', { schema_version: 1, ...result }); } catch { result.status = 'unknown'; result.code = 'receipt_unconfirmed'; }
    return result;
  } finally {
    if (temporary && temporaryStat && directories) try {
      directories.check(); const named = fs.lstatSync(temporary, { bigint: true });
      if (named.isFile() && !named.isSymbolicLink() && sameNode(named, temporaryStat)) fs.unlinkSync(temporary);
    } catch { /* Retain uncertain temporary bytes; never remove a replacement. */ }
  }
}
