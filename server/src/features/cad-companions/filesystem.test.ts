import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { assertRoot, listDirectory, readBoundedFile, readDocument, safeRelative, validateRelative } from './filesystem.js';

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cad-companion-fs-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'notes'));
  fs.writeFileSync(path.join(root, 'notes', 'sample.md'), '# Independent note\n仅用于测试');
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it('reads UTF-8 text and its exact raw hash without changing bytes or creating side files', () => {
  const root = fixture(), file = path.join(root, 'notes/sample.md'), before = fs.readFileSync(file);
  const result = readDocument(root, 'notes/sample.md');
  expect(result.text).toBe(before.toString('utf8'));
  expect(result.sha256).toBe(createHash('sha256').update(before).digest('hex'));
  expect(fs.readFileSync(file)).toEqual(before);
  expect(fs.readdirSync(root)).toEqual(['notes']);
});
it.each(['../outside.md', '/absolute.md', 'C:/note.md', 'notes\\note.md', 'notes//file.md', '.private.md', 'notes/.private.md', 'notes/__pycache__/x.md', 'notes/bad\0.md', 'notes/spoof\u202e.md', 'notes/lone\ud800.md'])('rejects unsafe relative input %s', rel => {
  expect(() => validateRelative(rel)).toThrow();
});
it('rejects a symlink root, parent or leaf and permits only a missing final output leaf', () => {
  const root = fixture();
  fs.symlinkSync(root, path.join(root, 'root-alias'));
  fs.symlinkSync(path.join(root, 'notes'), path.join(root, 'alias'));
  fs.symlinkSync(path.join(root, 'notes/sample.md'), path.join(root, 'notes/link.md'));
  expect(() => assertRoot(path.join(root, 'root-alias'))).toThrow();
  expect(() => readDocument(root, 'alias/sample.md')).toThrow();
  expect(() => readDocument(root, 'notes/link.md')).toThrow();
  expect(safeRelative(root, 'notes/new.md', { allowMissingLeaf: true })).toBe(path.join(root, 'notes/new.md'));
  expect(() => safeRelative(root, 'missing/new.md', { allowMissingLeaf: true })).toThrow();
});
it('does not read directories, oversized text, binary NUL or invalid UTF-8 as Markdown', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'notes/folder.md'));
  fs.writeFileSync(path.join(root, 'notes/large.md'), Buffer.alloc(2 * 1024 * 1024 + 1));
  fs.writeFileSync(path.join(root, 'notes/binary.md'), Buffer.from([65, 0, 66]));
  fs.writeFileSync(path.join(root, 'notes/invalid.md'), Buffer.from([0xff, 0xff]));
  for (const name of ['folder', 'large', 'binary', 'invalid']) expect(() => readDocument(root, `notes/${name}.md`)).toThrow();
});
it('bounds directory enumeration and changes proof when candidates change', () => {
  const root = fixture(), a = listDirectory(root, 'notes');
  fs.writeFileSync(path.join(root, 'notes/other.md'), 'other');
  const b = listDirectory(root, 'notes');
  expect(a.complete).toBe(true); expect(b.proof).not.toBe(a.proof);
  expect(listDirectory(root, 'notes', 1)).toMatchObject({ complete: false });
  expect(listDirectory(root, 'notes', 0).names).toEqual([]);
  expect(() => listDirectory(root, 'notes', 2001)).toThrow();
});
it('preserves a real Unicode and replacement-character filename through the Buffer directory API', () => {
  const root = fixture(), name = 'DEMO42.007-夹具\ufffd-模型说明.md';
  fs.writeFileSync(path.join(root, 'notes', name), 'independent UTF-8 name');
  expect(listDirectory(root, 'notes')).toMatchObject({ complete: true, names: [name, 'sample.md'].sort() });
});
it('refuses a real non-UTF-8 raw filename where the filesystem can preserve it', ({ skip }) => {
  const root = fixture(), folder = path.join(root, 'notes');
  const rawName = Buffer.concat([Buffer.from('DEMO42.007-示例'), Buffer.from([0xff]), Buffer.from('-模型说明.md')]);
  try { fs.writeFileSync(Buffer.concat([Buffer.from(folder + path.sep), rawName]), 'independent raw byte name', { flag: 'wx' }); }
  catch (error) {
    if (['EINVAL', 'EILSEQ', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('Filesystem does not support this raw byte filename');
    throw error;
  }
  if (!fs.readdirSync(folder, { encoding: 'buffer' }).some(name => name.equals(rawName))) skip('Filesystem did not retain the original filename bytes');
  expect(() => listDirectory(root, 'notes')).toThrow('有效 UTF-8');
});
it('refuses a real lossy-decoding name collision instead of reporting a unique candidate', ({ skip }) => {
  const root = fixture(), folder = path.join(root, 'notes'), validName = 'DEMO42.007-示例\ufffd-出图说明.md';
  fs.writeFileSync(path.join(folder, validName), 'first independent content');
  const rawName = Buffer.concat([Buffer.from('DEMO42.007-示例'), Buffer.from([0xff]), Buffer.from('-出图说明.md')]);
  try { fs.writeFileSync(Buffer.concat([Buffer.from(folder + path.sep), rawName]), 'different independent content', { flag: 'wx' }); }
  catch (error) {
    if (['EINVAL', 'EILSEQ', 'ENOTSUP', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) skip('Filesystem cannot represent both distinct original byte names');
    throw error;
  }
  if (!fs.readdirSync(folder, { encoding: 'buffer' }).some(name => name.equals(rawName))) skip('Filesystem did not retain the distinct raw filename');
  expect(fs.readdirSync(folder).filter(name => name === validName)).toHaveLength(2);
  expect(() => listDirectory(root, 'notes')).toThrow('有效 UTF-8');
});
it.each([
  { names: ['same.md', 'same.md'] }, { names: ['lone\ud800.md'] }, { names: [''] }, { names: ['.'] }, { names: ['..'] },
])('rejects duplicate or unprovable names in the parent DTO: $names', ({ names }) => {
  const root = fixture();
  vi.spyOn(childProcess, 'execFileSync').mockReturnValue(JSON.stringify({ names, complete: true, proof: 'a'.repeat(64) }));
  expect(() => listDirectory(root, 'notes')).toThrow('候选目录报告无效');
});
it('cancels before reading and rejects invalid budgets', () => {
  const root = fixture(), controller = new AbortController(); controller.abort();
  expect(() => readDocument(root, 'notes/sample.md', controller.signal)).toThrow('取消');
  expect(() => readBoundedFile(root, 'notes/sample.md', -1)).toThrow('预算');
  expect(() => readBoundedFile(root, 'notes/sample.md', 65 * 1024 * 1024)).toThrow('预算');
});
it('uses fixed diagnostics rather than exposing raw filesystem paths', () => {
  const root = fixture();
  vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => { throw new Error('synthetic-private-token/path'); });
  expect(() => readDocument(root, 'notes/sample.md')).toThrow('无法完成隔离只读文档检查');
  try { readDocument(root, 'notes/sample.md'); } catch (error) { expect(String(error)).not.toContain('synthetic-private'); }
});
it('passes only a fixed program and JSON stdin with no inherited Node injection settings', () => {
  const root = fixture(), original = childProcess.execFileSync;
  const invocation = vi.spyOn(childProcess, 'execFileSync').mockImplementation(((...args: Parameters<typeof childProcess.execFileSync>) => Reflect.apply(original, childProcess, args)) as typeof childProcess.execFileSync);
  readDocument(root, 'notes/sample.md');
  const [executable, args, options] = invocation.mock.calls[0] as [string, string[], { env: Record<string, string>; input: string; cwd: string }];
  expect(executable).toBe(process.execPath); expect(args.slice(0, 2)).toEqual(['--input-type=commonjs', '--eval']);
  expect(args).not.toContain('notes/sample.md'); expect(JSON.parse(options.input)).toMatchObject({ rel: 'notes/sample.md', mode: 'read' });
  expect(options.env).not.toHaveProperty('NODE_OPTIONS'); expect(options.env).not.toHaveProperty('NODE_PATH');
  expect(options.cwd).toBe(root);
});
