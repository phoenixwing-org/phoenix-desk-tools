import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { TextDecoder } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { COMPANION_READ_WORKER } from './read-worker.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'companion-worker-'))); roots.push(root);
  fs.mkdirSync(path.join(root, 'notes')); fs.writeFileSync(path.join(root, 'notes/note.md'), 'inside');
  return root;
}
function execute(root: string, hooks: { chdir?: (folder: string) => string; afterRead?: () => void; rootIdentity?: string[];
  mode?: 'read' | 'list'; rawNames?: unknown[]; limit?: number } = {}) {
  let cwd = root, output = '', contentReads = 0, directoryReads = 0, directoriesClosed = 0;
  const initial = fs.statSync(root, { bigint: true });
  const mode = hooks.mode ?? 'read';
  const spec = { mode, rel: mode === 'list' ? 'notes' : 'notes/note.md', maxBytes: 4096,
    limit: hooks.limit ?? 100, rootIdentity: hooks.rootIdentity ?? [String(initial.dev), String(initial.ino)] };
  const facade = {
    constants: fs.constants,
    readFileSync: (fd: number) => { if (fd !== 0) throw new Error('Only spec stdin'); return JSON.stringify(spec); },
    lstatSync: (name: string, options: any) => fs.lstatSync(path.resolve(cwd, name), options),
    openSync: (name: string, flags: number) => fs.openSync(path.resolve(cwd, name), flags),
    opendirSync: (name: string, options: any) => {
      directoryReads++;
      expect(options).toEqual({ encoding: 'buffer' });
      if (hooks.rawNames) {
        const names = [...hooks.rawNames];
        return { readSync: () => names.length ? { name: names.shift() } : null, closeSync: () => { directoriesClosed++; } };
      }
      return fs.opendirSync(path.resolve(cwd, name), options);
    },
    fstatSync: fs.fstatSync, closeSync: fs.closeSync,
    readSync: (...args: Parameters<typeof fs.readSync>) => { contentReads++; const count = Reflect.apply(fs.readSync, fs, args); hooks.afterRead?.(); return count; },
  };
  const processPort = { exitCode: 0, stdout: { write: (value: string) => { output += value; } }, chdir: (name: string) => { cwd = hooks.chdir ? hooks.chdir(path.resolve(cwd, name)) : fs.realpathSync(path.resolve(cwd, name)); } };
  vm.runInNewContext(COMPANION_READ_WORKER, { require: (name: string) => name === 'node:fs' ? facade : name === 'node:crypto' ? crypto
    : name === 'node:util' ? { TextDecoder } : (() => { throw new Error('Unexpected import'); })(), process: processPort, Buffer });
  return { result: JSON.parse(output), contentReads, directoryReads, directoriesClosed, exitCode: processPort.exitCode };
}
it('reads from the exact pinned parent directory', () => {
  const root = fixture(), run = execute(root);
  expect(run.exitCode).toBe(0); expect(Buffer.from(run.result.data, 'base64').toString()).toBe('inside');
});
it('rejects parent substitution between lstat and chdir before any document bytes are read', () => {
  const root = fixture(), outside = fixture(); fs.writeFileSync(path.join(outside, 'notes/note.md'), 'outside');
  const run = execute(root, { chdir: () => path.join(outside, 'notes') });
  expect(run.result).toEqual({ error: 'changed' }); expect(run.contentReads).toBe(0);
});
it('holds the original directory after its pathname is replaced by an outside symlink', () => {
  const root = fixture(), outside = fixture(); fs.writeFileSync(path.join(outside, 'notes/note.md'), 'outside');
  const run = execute(root, { chdir: folder => {
    const held = path.join(root, 'held'); fs.renameSync(folder, held); fs.symlinkSync(path.join(outside, 'notes'), folder);
    // This models a real child CWD: it still holds the moved directory inode.
    return held;
  } });
  expect(run.exitCode).toBe(0); expect(Buffer.from(run.result.data, 'base64').toString()).toBe('inside');
});
it('rejects a changed root identity before traversing or reading', () => {
  const run = execute(fixture(), { rootIdentity: ['0', '0'] });
  expect(run.result).toEqual({ error: 'changed' }); expect(run.contentReads).toBe(0);
});
it('rejects file changes during the exact descriptor read', () => {
  const root = fixture(); let changed = false;
  const run = execute(root, { afterRead: () => { if (!changed) { changed = true; fs.appendFileSync(path.join(root, 'notes/note.md'), 'changed'); } } });
  expect(run.result).toEqual({ error: 'changed' });
});
it('rejects a symbolic final leaf without reading its target', () => {
  const root = fixture(), outside = fixture();
  fs.unlinkSync(path.join(root, 'notes/note.md')); fs.symlinkSync(path.join(outside, 'notes/note.md'), path.join(root, 'notes/note.md'));
  const run = execute(root); expect(run.result).toEqual({ error: 'unsafe' }); expect(run.contentReads).toBe(0);
});
it('lists exact UTF-8 names without normalizing Unicode or dropping a filename BOM', () => {
  const names = ['DEMO42.007-示例-模型说明.md', 'Café.md', 'Cafe\u0301.md', '\ufeffnote.md'];
  const run = execute(fixture(), { mode: 'list', rawNames: names.map(name => Buffer.from(name)) });
  expect(run.exitCode).toBe(0); expect(run.result.names).toEqual([...names].sort());
  expect(run.result.complete).toBe(true); expect(run.result.proof).toMatch(/^[a-f0-9]{64}$/);
  expect(run.directoriesClosed).toBe(1); expect(run.contentReads).toBe(0);
});
it.each([
  { rawNames: [Buffer.from([0xff])] },
  { rawNames: [Buffer.from([0xc0, 0xaf])] },
  { rawNames: [Buffer.from([0xed, 0xa0, 0x80])] },
  { rawNames: [Buffer.from([0xe2, 0x82])] },
  { rawNames: ['already-decoded.md'] },
])('rejects invalid or unprovable raw directory encoding before returning names: $rawNames', ({ rawNames }) => {
  const run = execute(fixture(), { mode: 'list', rawNames });
  expect(run.result).toEqual({ error: 'invalid_encoding' }); expect(run.exitCode).toBe(1);
  expect(run.directoriesClosed).toBe(1); expect(run.contentReads).toBe(0);
});
it('rejects the original byte collision rather than folding it into the valid replacement-character filename', () => {
  const valid = Buffer.from('DEMO42.007-示例\ufffd-出图说明.md');
  const invalid = Buffer.concat([Buffer.from('DEMO42.007-示例'), Buffer.from([0xff]), Buffer.from('-出图说明.md')]);
  expect(valid.toString('utf8')).toBe(invalid.toString('utf8'));
  const run = execute(fixture(), { mode: 'list', rawNames: [valid, invalid] });
  expect(run.result).toEqual({ error: 'invalid_encoding' }); expect(run.directoriesClosed).toBe(1);
});
it('rejects duplicate decoded names even if their UTF-8 byte spelling is valid', () => {
  const run = execute(fixture(), { mode: 'list', rawNames: [Buffer.from('same.md'), Buffer.from('same.md')] });
  expect(run.result).toEqual({ error: 'unsafe' }); expect(run.directoriesClosed).toBe(1);
});
it('keeps the original enumeration budget and marks truncated names incomplete', () => {
  const run = execute(fixture(), { mode: 'list', limit: 1, rawNames: [Buffer.from('first.md'), Buffer.from('second.md')] });
  expect(run.result).toMatchObject({ names: ['first.md'], complete: false });
  expect(run.exitCode).toBe(0); expect(run.directoriesClosed).toBe(1);
});
it('rejects a substituted list directory before enumeration', () => {
  const root = fixture(), outside = fixture();
  const run = execute(root, { mode: 'list', chdir: () => path.join(outside, 'notes') });
  expect(run.result).toEqual({ error: 'changed' }); expect(run.directoryReads).toBe(0);
});
it('enumerates the pinned directory rather than a later symlink at its original path', () => {
  const root = fixture(), outside = fixture(); fs.writeFileSync(path.join(outside, 'notes/outside.md'), 'outside');
  const run = execute(root, { mode: 'list', chdir: folder => {
    const held = path.join(root, 'held'); fs.renameSync(folder, held); fs.symlinkSync(path.join(outside, 'notes'), folder);
    return held;
  } });
  expect(run.exitCode).toBe(0); expect(run.result.names).toEqual(['note.md']);
});
