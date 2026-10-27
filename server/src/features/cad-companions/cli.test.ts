import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { runCompanionCli } from '../../../scripts/inspect-cad-companions.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'companion-cli-'))); roots.push(root);
  fs.writeFileSync(path.join(root, 'DEMO42.007P1-导向件.FCStd'), 'Synthetic path fixture; no CAD engine');
  fs.writeFileSync(path.join(root, 'DEMO42.007P1-导向件-模型说明.md'), '# Independent note\n');
  return root;
}
async function run(args: string[]) {
  let output = '', error = '';
  const code = await runCompanionCli(args, { out: value => { output += value; }, error: value => { error += value; } });
  return { code, output, error };
}
it('prints usage without reading or changing a workspace', async () => {
  const result = await run(['--help']); expect(result.code).toBe(0); expect(result.output).toContain('No files are modified');
});
it('inspects an explicit synthetic binding and leaves all source files untouched', async () => {
  const root = fixture(), before = fs.readdirSync(root).map(name => [name, fs.readFileSync(path.join(root, name))] as const);
  const result = await run(['--workspace', root, '--source', 'DEMO42.007P1-导向件.FCStd', '--purpose', 'model_notes']);
  expect(result.code, result.error).toBe(0);
  expect(JSON.parse(result.output)).toMatchObject({ status: 'unique', selected_rel: 'DEMO42.007P1-导向件-模型说明.md' });
  for (const [name, bytes] of before) expect(fs.readFileSync(path.join(root, name))).toEqual(bytes);
  expect(fs.readdirSync(root)).toHaveLength(2);
});
it('reads text only with the exact expected SHA and uses a plain-text DTO', async () => {
  const root = fixture(), rel = 'DEMO42.007P1-导向件-模型说明.md';
  const sha = createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
  const result = await run(['--workspace', root, '--read', rel, '--sha256', sha]);
  expect(result.code, result.error).toBe(0);
  expect(JSON.parse(result.output)).toMatchObject({ content_type: 'text/plain; charset=utf-8', sha256: sha });
  expect((await run(['--workspace', root, '--read', rel, '--sha256', '0'.repeat(64)])).code).toBe(2);
});
it.each([{ args: ['--apply', 'yes'] }, { args: ['--workspace', '/unused', '--output', 'target.md'] }, { args: ['--workspace', '/unused', '--workspace', '/other'] }, { args: ['--source'] }])('rejects unknown/write/duplicate/incomplete arguments', async ({ args }) => {
  expect((await run(args)).code).toBe(2);
});
