import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {afterEach, expect, it, vi} from 'vitest';
import type {SidecarProvenance} from '../../../../shared/cad-companion/contracts.js';
import {formatSidecarProvenanceMarker, parseSidecarProvenanceMarker} from '../cad-companions/output.js';
import {finalizeDraftNotes} from './final-notes.js';

const MAX_BYTES = 2 * 1024 * 1024, roots: string[] = [];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const provenance = (): SidecarProvenance => ({schema: 'phoenix-cad-companion', version: 1, generated_draft: true,
  source_rel: 'parts/DEMO42.007P1-Bracket.FCStd', source_node: 'Body', source_sha256: '1'.repeat(64),
  drawing_rel: 'parts/DEMO42.007P1-Bracket.Drawing.FCStd', drawing_sha256: '2'.repeat(64),
  pdf_rel: 'parts/DEMO42.007P1-Bracket.Drawing.pdf', pdf_sha256: '3'.repeat(64), revisionRaw: '007P1', variantRaw: 'P1',
  draft_sequence: 1, reference_pdf: null});
function fixture(body: Buffer | string = '# Independent draft\nSynthetic description.\n') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'draft-final-notes-'))); roots.push(root);
  fs.mkdirSync(path.join(root, 'parts'));
  const stage = path.join(root, 'parts', `.${randomUUID()}-出图说明.md`), bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  fs.writeFileSync(stage, bytes);
  const production = path.join(root, 'parts', 'DEMO42.007P1-Bracket-出图说明.md'); fs.writeFileSync(production, 'untouched production note');
  return {root, stage, bytes, production, record: provenance()};
}
afterEach(() => {vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});

it('appends one canonical inert marker, fsyncs and reports the exact final bytes without touching production notes', () => {
  const {root, stage, bytes, production, record} = fixture(), sync = vi.spyOn(fs, 'fsyncSync');
  record.source_node = 'Body--><script>not executed</script>';
  const result = finalizeDraftNotes(root, stage, hash(bytes), record), final = fs.readFileSync(stage);
  expect(final.subarray(0, bytes.length)).toEqual(bytes);
  expect(final.toString()).toBe(bytes.toString() + '\n' + formatSidecarProvenanceMarker(record) + '\n');
  expect(parseSidecarProvenanceMarker(final.toString())).toEqual({status: 'valid', provenance: record});
  expect(result).toEqual({sha256: hash(final), bytes: final.byteLength}); expect(sync).toHaveBeenCalledOnce();
  expect(fs.readFileSync(production, 'utf8')).toBe('untouched production note');
  expect(fs.readdirSync(path.join(root, 'parts'))).toHaveLength(2);
});
it.each([{body: ''}, {body: 'no final newline'}, {body: 'CRLF\r\n'}])('keeps the original byte prefix for $body', ({body}) => {
  const {root, stage, bytes, record} = fixture(body);
  finalizeDraftNotes(root, stage, hash(bytes), record);
  const final = fs.readFileSync(stage); expect(final.subarray(0, bytes.length)).toEqual(bytes);
  expect(parseSidecarProvenanceMarker(final.toString()).status).toBe('valid');
});
it('preserves a UTF-8 BOM and uses only bounded descriptor reads, never readFileSync', () => {
  const {root, stage, bytes, record} = fixture(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Saved body\n')]));
  const reads = vi.spyOn(fs, 'readSync'), unbounded = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {throw new Error('unbounded read forbidden');});
  const result = finalizeDraftNotes(root, stage, hash(bytes), record);
  expect(reads.mock.calls.every(args => {
    const length = (args as unknown[])[3];
    return typeof length === 'number' && length <= 65536;
  })).toBe(true);
  expect(unbounded).not.toHaveBeenCalled(); unbounded.mockRestore();
  expect(fs.readFileSync(stage).subarray(0, bytes.length)).toEqual(bytes); expect(result.bytes).toBeGreaterThan(bytes.length);
});
it('rejects an already changed body before any append', () => {
  const {root, stage, bytes, record} = fixture(); fs.appendFileSync(stage, 'external edit');
  const changed = fs.readFileSync(stage), writes = vi.spyOn(fs, 'writeSync');
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/SHA256 已变化/);
  expect(writes).not.toHaveBeenCalled(); expect(fs.readFileSync(stage)).toEqual(changed);
});
it.each(['', 'a'.repeat(63), 'A'.repeat(64), 'not-a-hash'])('requires an exact lowercase expected SHA %s', expected => {
  const {root, stage, bytes, record} = fixture();
  expect(() => finalizeDraftNotes(root, stage, expected, record)).toThrow(/SHA256/);
  expect(fs.readFileSync(stage)).toEqual(bytes);
});
it.each([
  {marker: '<!-- phoenix-cad-companion:v2 unknown -->'}, {marker: '<!-- PHOENIX-CAD-COMPANION :v1 malformed -->'},
  {marker: '<!-- phoenix-cad-companion'}, {marker: formatSidecarProvenanceMarker(provenance())},
])('refuses any existing known, unknown, malformed or truncated source marker', ({marker}) => {
  const {root, stage, bytes, record} = fixture('Independent body\n' + marker), writes = vi.spyOn(fs, 'writeSync');
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/已有来源标记/);
  expect(writes).not.toHaveBeenCalled(); expect(fs.readFileSync(stage)).toEqual(bytes);
});
it.each([{bytes: Buffer.from([0xff])}, {bytes: Buffer.from([0xc0, 0xaf])}, {bytes: Buffer.from([0xed, 0xa0, 0x80])}, {bytes: Buffer.from('body\0binary')}])('refuses invalid UTF-8 or NUL body bytes', ({bytes}) => {
  const {root, stage, record} = fixture(bytes), writes = vi.spyOn(fs, 'writeSync');
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/UTF-8|NUL/);
  expect(writes).not.toHaveBeenCalled(); expect(fs.readFileSync(stage)).toEqual(bytes);
});
it('rejects oversized originals and oversized combined output before writing', () => {
  for (const size of [MAX_BYTES, MAX_BYTES + 1]) {
    const {root, stage, bytes, record} = fixture(Buffer.alloc(size, 120)), writes = vi.spyOn(fs, 'writeSync');
    expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/2 MiB/);
    expect(writes).not.toHaveBeenCalled(); expect(fs.statSync(stage).size).toBe(size); writes.mockRestore();
  }
});
it('accepts the exact total 2 MiB boundary and handles short descriptor writes', () => {
  const record = provenance(), markerBytes = Buffer.byteLength(formatSidecarProvenanceMarker(record));
  const {root, stage, bytes} = fixture(Buffer.alloc(MAX_BYTES - markerBytes - 3, 120)), write = fs.writeSync;
  vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number, position: number) => write(fd, buffer, offset, Math.min(length, 17), position)) as typeof fs.writeSync);
  const result = finalizeDraftNotes(root, stage, hash(bytes), record), final = fs.readFileSync(stage);
  expect(result.bytes).toBe(MAX_BYTES); expect(result.sha256).toBe(hash(final));
  expect(final.subarray(0, bytes.length)).toEqual(bytes);
});
it.each(['production-出图说明.md', `${randomUUID()}-出图说明.md`, `..${randomUUID()}-出图说明.md`, `.${randomUUID()}.ai.md`, `.${randomUUID()}-模型说明.md`, '.not-a-uuid-出图说明.md'])('rejects a non-owned stage basename %s', basename => {
  const {root, stage, bytes, record} = fixture();
  expect(() => finalizeDraftNotes(root, path.join(path.dirname(stage), basename), hash(bytes), record)).toThrow(/隐藏 UUID/);
  expect(fs.readFileSync(stage)).toEqual(bytes);
});
it('rejects relative stage paths and workspace escapes without changing either file', () => {
  const first = fixture(), outside = fixture();
  expect(() => finalizeDraftNotes(first.root, path.basename(first.stage), hash(first.bytes), first.record)).toThrow(/隐藏 UUID/);
  expect(() => finalizeDraftNotes(first.root, outside.stage, hash(outside.bytes), first.record)).toThrow(/定稿失败/);
  expect(fs.readFileSync(first.stage)).toEqual(first.bytes); expect(fs.readFileSync(outside.stage)).toEqual(outside.bytes);
});
it('rejects a symbolic stage, symbolic parent and hardlink to production', () => {
  const {root, stage, bytes, production, record} = fixture();
  fs.unlinkSync(stage); fs.symlinkSync(production, stage);
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow();
  fs.unlinkSync(stage); fs.linkSync(production, stage);
  expect(() => finalizeDraftNotes(root, stage, hash(fs.readFileSync(production)), record)).toThrow(/硬链接/);
  fs.unlinkSync(stage); fs.writeFileSync(stage, bytes); fs.symlinkSync(path.dirname(stage), path.join(root, 'alias'));
  expect(() => finalizeDraftNotes(root, path.join(root, 'alias', path.basename(stage)), hash(bytes), record)).toThrow();
  expect(fs.readFileSync(production, 'utf8')).toBe('untouched production note'); expect(fs.readFileSync(stage)).toEqual(bytes);
});
it('rejects a directory stage and malformed provenance without writing', () => {
  const {root, stage, bytes, record} = fixture(); fs.unlinkSync(stage); fs.mkdirSync(stage);
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/普通文件/);
  fs.rmdirSync(stage); fs.writeFileSync(stage, bytes);
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), {...record, drawing_sha256: 'bad'})).toThrow(/定稿失败/);
  expect(fs.readFileSync(stage)).toEqual(bytes);
});
it('detects replacement between lstat and open before any write', () => {
  const {root, stage, bytes, record} = fixture(), open = fs.openSync, writes = vi.spyOn(fs, 'writeSync'); let swapped = false;
  vi.spyOn(fs, 'openSync').mockImplementation(((filename: fs.PathLike, flags: number) => {
    if (!swapped && String(filename) === stage) {
      swapped = true; fs.renameSync(stage, `${stage}.held`); fs.writeFileSync(stage, bytes);
      writes.mockClear(); // Exclude the simulated concurrent actor's fixture write.
    }
    return open(filename, flags);
  }) as typeof fs.openSync);
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/打开前变化/);
  expect(writes).not.toHaveBeenCalled(); expect(fs.readFileSync(stage)).toEqual(bytes);
});
it('detects body mutation during a bounded read without appending', () => {
  const {root, stage, bytes, record} = fixture(), read = fs.readSync, writes = vi.spyOn(fs, 'writeSync'); let changed = false;
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
    const result = Reflect.apply(read, fs, args);
    if (!changed) {changed = true; fs.appendFileSync(stage, 'concurrent edit');}
    return result;
  }) as typeof fs.readSync);
  expect(() => finalizeDraftNotes(root, stage, hash(bytes), record)).toThrow(/变化/);
  expect(writes).not.toHaveBeenCalled();
});
it('leaves only its own partial stage on write failure and does not leak error or body content', () => {
  const secret = 'synthetic-body-token', {root, stage, bytes, production, record} = fixture(secret), write = fs.writeSync; let calls = 0;
  vi.spyOn(fs, 'writeSync').mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
    if (++calls > 1) throw new Error(secret + ' /synthetic/private/path');
    return write(fd, buffer, offset, Math.min(length, 5), position);
  }) as typeof fs.writeSync);
  let message = ''; try {finalizeDraftNotes(root, stage, hash(bytes), record);} catch (error) {message = String(error);}
  expect(message).toContain('定稿失败'); expect(message).not.toContain(secret); expect(message).not.toContain('/synthetic/private');
  expect(fs.readFileSync(stage).subarray(0, bytes.length)).toEqual(bytes);
  expect(fs.readFileSync(production, 'utf8')).toBe('untouched production note');
});
it('fails closed on zero writes, fsync failure or post-write byte corruption', () => {
  const first = fixture(); vi.spyOn(fs, 'writeSync').mockReturnValue(0);
  expect(() => finalizeDraftNotes(first.root, first.stage, hash(first.bytes), first.record)).toThrow(/追加未完成/); vi.restoreAllMocks();
  const second = fixture(); vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {throw new Error('synthetic-hidden-token');});
  expect(() => finalizeDraftNotes(second.root, second.stage, hash(second.bytes), second.record)).toThrow(/定稿失败/); vi.restoreAllMocks();
  const third = fixture(), sync = fs.fsyncSync;
  vi.spyOn(fs, 'fsyncSync').mockImplementation(fd => {fs.writeSync(fd, Buffer.from('X'), 0, 1, 0); sync(fd);});
  expect(() => finalizeDraftNotes(third.root, third.stage, hash(third.bytes), third.record)).toThrow(/写后字节/);
});
