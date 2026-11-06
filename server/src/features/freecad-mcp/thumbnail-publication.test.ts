import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as gallery from '../part-gallery/storage.js';
import type { GalleryRow } from '../part-gallery/types.js';
import { publishWorkerThumbnail, type WorkerThumbnailPublicationInput, type ThumbnailPublicationCheckpoint } from './thumbnail-publication.js';

const roots: string[] = [];
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function crc(bytes: Uint8Array) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; } return (n ^ 0xffffffff) >>> 0; }
function chunk(name: string, bytes: Uint8Array) {
  const data = Buffer.concat([Buffer.from(name), bytes]), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(data)); return Buffer.concat([size, data, checksum]);
}
function image(red = 42) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, red, 100, 170]))), chunk('IEND', Buffer.alloc(0))]);
}
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-worker-thumbnail-publication-'))); roots.push(root);
  const rel = 'examples/Block.FCStd', source = path.join(root, rel); fs.mkdirSync(path.dirname(source));
  const bytes = Buffer.from(zipSync({ 'Document.xml': strToU8('<Document><Objects Count="1"><Object name="Block" type="Part::Feature"/></Objects><ObjectData Count="1"><Object name="Block"><Properties Count="2"><Property name="Label" type="App::PropertyString"><String value="Independent block"/></Property><Property name="PartName" type="App::PropertyString"><String value="Independent block"/></Property></Properties></Object></ObjectData></Document>') }));
  fs.writeFileSync(source, bytes);
  const png = image(), input: WorkerThumbnailPublicationInput = { workspacePath: root, filePath: rel, expectedSourceSha256: hash(bytes),
    worker: { workerId: randomUUID(), sessionId: randomUUID(), jobId: randomUUID() }, inputRevision: { sha256: hash(bytes), bytes: bytes.length },
    renderProfile: 'native-isometric-white-v1', image: { png, sha256: hash(png), bytes: png.length, width: 1, height: 1 },
    cameraRestored: true, documentsClosed: true, savedCad: false, workerReusable: true };
  return { root, rel, source, bytes, png, input, target: path.join(root, `.phoenix/thumbnail-cache/${hash(png)}.png`) };
}
function readRow(root: string, rel: string) { const db = gallery.openGalleryDb(root); try { return db ? gallery.cachedRow(db, rel) : null; } finally { db?.close(); } }
function previous(f: ReturnType<typeof fixture>) {
  const old = image(200), db = gallery.openGalleryDb(f.root, true)!;
  const row: GalleryRow = { rel: f.rel, part_number: '', part_version: '', part_name: 'Previous independent observation', type_code: '', role: 'part', status: 'ready',
    width: 1, height: 1, image_hash: hash(old), source_stamp: gallery.fileStamp(f.source), source_hash: f.input.expectedSourceSha256,
    updated_at: '2026-01-01T00:00:00.000Z', message: 'Previous external image', refs: [] };
  gallery.saveRow(db, row); db.close(); return row;
}
function evidence(f: ReturnType<typeof fixture>, result: { evidenceRel: string | null }, name: string) {
  return JSON.parse(fs.readFileSync(path.join(f.root, result.evidenceRel!, name), 'utf8'));
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('bounded external worker PNG publication, without Native or CAD writes', () => {
  it('durably publishes one image and transactionally records source, worker and render profile without base64', () => {
    const f = fixture(), before = fs.statSync(f.source, { bigint: true }), result = publishWorkerThumbnail(f.input);
    expect(result).toMatchObject({ status: 'published', code: 'published', sourceWritten: false, cacheCreated: true, registered: true });
    expect(fs.readFileSync(f.target)).toEqual(f.png); expect(fs.statSync(f.target).nlink).toBe(1);
    expect(fs.readFileSync(f.source)).toEqual(f.bytes); expect(fs.statSync(f.source, { bigint: true })).toMatchObject({ ino: before.ino, mtimeNs: before.mtimeNs, ctimeNs: before.ctimeNs });
    expect(readRow(f.root, f.rel)).toMatchObject({ image_hash: f.input.image.sha256, source_hash: f.input.expectedSourceSha256, source_stamp: gallery.fileStamp(f.source), part_name: 'Independent block' });
    const db = gallery.openGalleryDb(f.root)!;
    try {
      const stored = db.get('SELECT * FROM desk_thumbnail_worker_publication');
      expect(stored).toMatchObject({ worker_id: f.input.worker.workerId, session_id: f.input.worker.sessionId, job_id: f.input.worker.jobId, render_profile: f.input.renderProfile, image_bytes: f.png.length, source_bytes: f.bytes.length });
      expect(JSON.stringify(stored)).not.toContain(f.png.toString('base64'));
    } finally { db.close(); }
    expect(evidence(f, result, 'published.json')).toMatchObject({ saved_cad: false, registered: true, source_written: false, image: { sha256: hash(f.png) } });
    expect(JSON.stringify(evidence(f, result, 'intent.json'))).not.toContain(f.root);
    expect(fs.statSync(path.join(f.root, result.evidenceRel!)).mode & 0o077).toBe(0);
  });

  it('reuses a verified same-hash image but never replays an already attempted worker/session/job', () => {
    const f = fixture(), first = publishWorkerThumbnail(f.input), stat = fs.statSync(f.target);
    const duplicate = publishWorkerThumbnail(f.input); expect(duplicate).toMatchObject({ status: 'unknown', code: 'publication_already_attempted', registered: null });
    expect(fs.statSync(f.target).ino).toBe(stat.ino);
    const reused = publishWorkerThumbnail({ ...f.input, worker: { ...f.input.worker, jobId: randomUUID() } });
    expect(reused).toMatchObject({ status: 'published', cacheCreated: false, registered: true }); expect(reused.evidenceRel).not.toBe(first.evidenceRel);
  });

  it.each(['different', 'symlink', 'hardlink'] as const)('refuses an existing %s hash-path target without replacing it or an old row', kind => {
    const f = fixture(), oldRow = previous(f); fs.mkdirSync(path.dirname(f.target));
    const other = path.join(f.root, 'sentinel'); fs.writeFileSync(other, f.png);
    if (kind === 'different') fs.writeFileSync(f.target, 'Unrelated bytes');
    else if (kind === 'symlink') fs.symlinkSync(other, f.target); else fs.linkSync(other, f.target);
    const before = fs.readFileSync(f.target), result = publishWorkerThumbnail(f.input);
    expect(result.status).not.toBe('published'); expect(result.registered).toBe(false);
    expect(fs.readFileSync(f.target)).toEqual(before); expect(readRow(f.root, f.rel)).toEqual(oldRow); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
  });

  it.each(['corrupt', 'trailing-metadata', 'dimension', 'sha', 'bytes', 'closure-flags'] as const)('requires complete sanitized PNG and typed successful provenance: %s', kind => {
    const f = fixture(), input = structuredClone(f.input);
    if (kind === 'corrupt') { input.image.png[42] ^= 1; input.image.sha256 = hash(input.image.png); }
    if (kind === 'trailing-metadata') { input.image.png = Buffer.concat([input.image.png, chunk('tEXt', Buffer.from('private metadata'))]); input.image.bytes = input.image.png.length; input.image.sha256 = hash(input.image.png); }
    if (kind === 'dimension') input.image.width = 2;
    if (kind === 'sha') input.image.sha256 = 'a'.repeat(64);
    if (kind === 'bytes') input.image.bytes++;
    if (kind === 'closure-flags') Object.assign(input, { documentsClosed: false });
    const result = publishWorkerThumbnail(input); expect(result).toMatchObject({ status: 'failed', sourceWritten: false, evidenceRel: null });
    expect(fs.existsSync(path.join(f.root, '.phoenix'))).toBe(false); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
  });

  it.each(['source-symlink', 'source-hardlink', 'workspace-symlink', 'parent-symlink', 'database-symlink', 'database-hardlink'] as const)('refuses unsafe path/link identity: %s', kind => {
    const f = fixture(), other = fixture();
    if (kind === 'source-symlink') { fs.unlinkSync(f.source); fs.symlinkSync(other.source, f.source); }
    if (kind === 'source-hardlink') fs.linkSync(f.source, path.join(f.root, 'Copy.FCStd'));
    if (kind === 'workspace-symlink') { const alias = path.join(other.root, 'workspace-alias'); fs.symlinkSync(f.root, alias); f.input.workspacePath = alias; }
    if (kind === 'parent-symlink') fs.symlinkSync(other.root, path.join(f.root, '.phoenix'));
    if (kind.startsWith('database-')) {
      previous(f); const file = path.join(f.root, '.phoenix/phoenix-workspace.sqlite');
      if (kind === 'database-hardlink') fs.linkSync(file, path.join(f.root, 'db-alias'));
      else { fs.renameSync(file, path.join(f.root, 'original-db')); fs.symlinkSync(path.join(f.root, 'original-db'), file); }
    }
    const result = publishWorkerThumbnail(f.input); expect(result.status).not.toBe('published'); expect(result.sourceWritten).toBe(false); expect(fs.readFileSync(other.source)).toEqual(other.bytes);
  });

  it.each(['before_cache_install', 'before_database_commit'] as const)('rejects a source change at %s and leaves the prior row untouched', stage => {
    const f = fixture(), oldRow = previous(f), changed = Buffer.concat([f.bytes, Buffer.from('Independent concurrent source write')]);
    const result = publishWorkerThumbnail(f.input, { checkpoint: point => { if (point === stage) fs.writeFileSync(f.source, changed); } });
    expect(result).toMatchObject({ status: 'failed', code: 'source_changed', registered: false, sourceWritten: false });
    expect(readRow(f.root, f.rel)).toEqual(oldRow); expect(fs.readFileSync(f.source)).toEqual(changed);
    expect(evidence(f, result, 'failure.json').registered).toBe(false);
  });

  it.each(['valid', 'different'] as const)('does not overwrite a concurrent %s target created before no-replace installation', kind => {
    const f = fixture(), oldRow = previous(f), concurrent = kind === 'valid' ? f.png : Buffer.from('Concurrent unrelated target');
    const result = publishWorkerThumbnail(f.input, { checkpoint: point => { if (point === 'before_cache_install') fs.writeFileSync(f.target, concurrent, { flag: 'wx' }); } });
    expect(fs.readFileSync(f.target)).toEqual(concurrent);
    if (kind === 'valid') expect(result).toMatchObject({ status: 'published', cacheCreated: false });
    else { expect(result.status).toBe('failed'); expect(readRow(f.root, f.rel)).toEqual(oldRow); }
  });

  it('finishes partial writes, fsyncs private PNG before installing it, and reconciles a lost link return', () => {
    const f = fixture(), originalWrite = fs.writeSync, originalSync = fs.fsyncSync, originalLink = fs.linkSync, originalOpen = fs.openSync, originalClose = fs.closeSync;
    let pngFd: number | undefined, synced = false, installed = false;
    vi.spyOn(fs, 'openSync').mockImplementation(((filename: fs.PathLike, ...args: unknown[]) => {
      const fd = (originalOpen as (...args: unknown[]) => number)(filename, ...args);
      if (String(filename).includes('.worker-thumbnail-') && typeof args[0] === 'number' && (args[0] & fs.constants.O_WRONLY)) { pngFd = fd; synced = false; } return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, 'closeSync').mockImplementation(fd => { originalClose(fd); if (fd === pngFd) pngFd = undefined; });
    vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, bytes: Uint8Array, offset: number, length: number, position: number) => originalWrite(fd, bytes, offset, fd === pngFd ? Math.min(5, length) : length, position)) as typeof fs.writeSync);
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { originalSync(fd); if (fd === pngFd) synced = true; });
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => { expect(synced).toBe(true); originalLink(from, to); installed = true; throw new Error('Lost link return after actual installation'); });
    expect(publishWorkerThumbnail(f.input)).toMatchObject({ status: 'published', cacheCreated: true, registered: true });
    expect(installed).toBe(true); expect(fs.readFileSync(f.target)).toEqual(f.png); expect(fs.statSync(f.target).nlink).toBe(1);
  });

  it('rolls registration back on a row failure, retaining old metadata and installed PNG evidence', () => {
    const f = fixture(), oldRow = previous(f); vi.spyOn(gallery, 'saveRow').mockImplementationOnce(() => { throw new Error('Independent DB failure'); });
    const result = publishWorkerThumbnail(f.input); expect(result).toMatchObject({ status: 'failed', registered: false, cacheCreated: true });
    expect(readRow(f.root, f.rel)).toEqual(oldRow); expect(fs.readFileSync(f.target)).toEqual(f.png);
    expect(evidence(f, result, 'database-intent.json').previous_row).toEqual(oldRow); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
    expect(publishWorkerThumbnail(f.input).status).toBe('unknown');
  });

  it('reports unknown after a committed registration loses its return, without restoring an obsolete row', () => {
    const f = fixture(); previous(f); const open = gallery.openGalleryDb;
    vi.spyOn(gallery, 'openGalleryDb').mockImplementation((...args) => {
      const db = open(...args); if (!db) return db; const exec = db.exec.bind(db);
      db.exec = sql => { exec(sql); if (sql === 'COMMIT') throw new Error('Lost database commit acknowledgement'); }; return db;
    });
    const result = publishWorkerThumbnail(f.input); expect(result).toMatchObject({ status: 'unknown', registered: null, cacheCreated: true });
    expect(readRow(f.root, f.rel)?.image_hash).toBe(f.input.image.sha256); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
  });

  it.each(['after_database_commit', 'before_published_receipt'] as ThumbnailPublicationCheckpoint[])('never claims failure/no-write after committed stage %s loses its receipt', stage => {
    const f = fixture(), result = publishWorkerThumbnail(f.input, { checkpoint: point => { if (point === stage) throw new Error('Independent post-commit uncertainty'); } });
    expect(result).toMatchObject({ status: 'unknown', registered: true, sourceWritten: false });
    expect(readRow(f.root, f.rel)?.image_hash).toBe(f.input.image.sha256); expect(fs.existsSync(path.join(f.root, result.evidenceRel!, 'published.json'))).toBe(false);
    expect(publishWorkerThumbnail(f.input)).toMatchObject({ status: 'unknown', code: 'publication_already_attempted' });
  });

  it('keeps registration unknown when published-receipt fsync fails after commit', () => {
    const f = fixture(), sync = fs.fsyncSync; let failNext = false;
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (failNext) { failNext = false; throw new Error('Independent receipt fsync failure'); } sync(fd); });
    const result = publishWorkerThumbnail(f.input, { checkpoint: point => { if (point === 'before_published_receipt') failNext = true; } });
    expect(result).toMatchObject({ status: 'unknown', code: 'receipt_unconfirmed', registered: true }); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
  });

  it('does not report success after another writer changes the registered row or cache after commit', () => {
    const f = fixture(), result = publishWorkerThumbnail(f.input, { checkpoint: point => {
      if (point === 'after_database_commit') fs.writeFileSync(f.target, 'Independent concurrent image edit');
    } });
    expect(result).toMatchObject({ status: 'unknown', registered: true }); expect(fs.readFileSync(f.target, 'utf8')).toContain('concurrent image edit');
  });

  it('does not restore over a concurrent registration committed after its own commit', () => {
    const f = fixture(), result = publishWorkerThumbnail(f.input, { checkpoint: point => {
      if (point === 'after_database_commit') {
        const db = gallery.openGalleryDb(f.root)!;
        try { gallery.saveRow(db, { ...gallery.cachedRow(db, f.rel)!, message: 'Independent subsequent writer' }); } finally { db.close(); }
      }
    } });
    expect(result).toMatchObject({ status: 'unknown', code: 'registration_changed', registered: true });
    expect(readRow(f.root, f.rel)?.message).toBe('Independent subsequent writer'); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
  });

  it('rechecks source after the final pre-receipt checkpoint instead of certifying a stale registration', () => {
    const f = fixture(), changed = Buffer.concat([f.bytes, Buffer.from('Independent late source write')]);
    const result = publishWorkerThumbnail(f.input, { checkpoint: point => { if (point === 'before_published_receipt') fs.writeFileSync(f.source, changed); } });
    expect(result).toMatchObject({ status: 'unknown', code: 'source_changed', registered: true }); expect(fs.readFileSync(f.source)).toEqual(changed);
    expect(fs.existsSync(path.join(f.root, result.evidenceRel!, 'published.json'))).toBe(false);
  });

  it('treats even an early unconfirmed intent receipt as unknown and does not replay it', () => {
    const f = fixture(), open = fs.openSync, sync = fs.fsyncSync; let intentFd: number | undefined, injected = false;
    vi.spyOn(fs, 'openSync').mockImplementation(((filename: fs.PathLike, ...args: unknown[]) => {
      const fd = (open as (...args: unknown[]) => number)(filename, ...args); if (String(filename).endsWith('/intent.json')) intentFd = fd; return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => { if (fd === intentFd && !injected) { injected = true; throw new Error('Independent lost intent durability'); } sync(fd); });
    const result = publishWorkerThumbnail(f.input); expect(result).toMatchObject({ status: 'unknown', code: 'receipt_unconfirmed', registered: false, cacheCreated: false });
    expect(fs.existsSync(f.target)).toBe(false); expect(publishWorkerThumbnail(f.input).code).toBe('publication_already_attempted');
  });

  it('rejects a file that changes during its first bounded source read', () => {
    const f = fixture(), read = fs.readSync, inode = fs.statSync(f.source).ino; let changed = false;
    vi.spyOn(fs, 'readSync').mockImplementation(((fd: number, bytes: Uint8Array, offset: number, length: number, position: number) => {
      const amount = read(fd, bytes, offset, length, position);
      if (!changed && fs.fstatSync(fd).ino === inode) { changed = true; fs.appendFileSync(f.source, 'Independent concurrent read mutation'); }
      return amount;
    }) as typeof fs.readSync);
    expect(publishWorkerThumbnail(f.input)).toMatchObject({ status: 'failed', code: 'file_changed', evidenceRel: null, registered: false });
    expect(fs.existsSync(path.join(f.root, '.phoenix'))).toBe(false);
  });

  it.each(['source-sha', 'source-bytes', 'profile', 'size-limit'] as const)('refuses an unbound or oversized input before publication: %s', kind => {
    const f = fixture();
    if (kind === 'source-sha') { f.input.expectedSourceSha256 = 'f'.repeat(64); f.input.inputRevision.sha256 = f.input.expectedSourceSha256; }
    if (kind === 'source-bytes') f.input.inputRevision.bytes++;
    if (kind === 'profile') Object.assign(f.input, { renderProfile: 'unknown-camera-profile' });
    if (kind === 'size-limit') { const fd = fs.openSync(f.source, 'r+'); try { fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); } }
    const result = publishWorkerThumbnail(f.input); expect(result).toMatchObject({ status: 'failed', registered: false, evidenceRel: null });
    expect(fs.existsSync(path.join(f.root, '.phoenix'))).toBe(false);
  });

  it('rejects a replaced cache ancestor without following it into an unrelated directory', () => {
    const f = fixture(), other = fixture();
    const result = publishWorkerThumbnail(f.input, { checkpoint: point => {
      if (point === 'after_intent') {
        fs.renameSync(path.join(f.root, '.phoenix/thumbnail-cache'), path.join(f.root, '.phoenix/original-cache'));
        fs.symlinkSync(other.root, path.join(f.root, '.phoenix/thumbnail-cache'));
      }
    } });
    expect(result.status).not.toBe('published'); expect(result.registered).toBe(false);
    expect(fs.existsSync(path.join(other.root, `${f.input.image.sha256}.png`))).toBe(false); expect(fs.readFileSync(other.source)).toEqual(other.bytes);
  });

  it('refuses foreign database coordination without removing its lock', () => {
    const f = fixture(), old = previous(f), lock = path.join(f.root, '.phoenix/phoenix-workspace.sqlite.lock'); fs.mkdirSync(lock);
    const result = publishWorkerThumbnail(f.input); expect(result).toMatchObject({ status: 'failed', code: 'database_busy', registered: false });
    expect(fs.existsSync(lock)).toBe(true); fs.rmdirSync(lock); expect(readRow(f.root, f.rel)).toEqual(old);
  });

  it('fails closed on existing thumbnail-table triggers before changing a prior registration', () => {
    const f = fixture(), old = previous(f), db = gallery.openGalleryDb(f.root)!;
    db.exec("CREATE TRIGGER unexpected_thumbnail_side_effect AFTER UPDATE ON desk_cad_thumbnail BEGIN UPDATE desk_cad_thumbnail SET message='Unexpected trigger'; END;"); db.close();
    const result = publishWorkerThumbnail(f.input); expect(result).toMatchObject({ status: 'failed', code: 'unsupported_database_triggers', registered: false });
    expect(readRow(f.root, f.rel)).toEqual(old); expect(fs.readFileSync(f.source)).toEqual(f.bytes);
  });
});
