import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {FreecadMcpSettingsStore, validateSettings} from './settings.js';

const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-mcp-settings-test-'))); roots.push(root);
  const filename = path.join(root, 'preferences/freecad-mcp-settings.json');
  return {root, filename, store: new FreecadMcpSettingsStore(filename)};
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
describe('host MCP settings', () => {
  it('reads absent settings without creating a directory and saves only on explicit CAS', () => {
    const f = fixture(), initial = f.store.read();
    expect(initial.settings).toEqual({mode: 'owned_batch', mod_directory: '', mod_directory_confirmed: false, existing_port: 9876});
    expect(fs.existsSync(path.dirname(f.filename))).toBe(false);
    const saved = f.store.save({...initial.settings, mode: 'existing'}, initial.revision);
    expect(saved.revision).not.toBe(initial.revision); expect(f.store.read()).toEqual(saved);
    expect(fs.statSync(f.filename).mode & 0o077).toBe(0);
    expect(() => f.store.save(initial.settings, initial.revision)).toThrow('变化');
    expect(fs.readdirSync(path.dirname(f.filename))).toEqual(['freecad-mcp-settings.json']);
  });
  it.each([
    {mode: 'unknown'}, {existing_port: 80}, {existing_port: 1.5}, {existing_port: 65536},
    {mod_directory: 'relative/Mod'}, {mod_directory: '/synthetic/../Mod'}, {mod_directory: '/synthetic\n/Mod'},
    {mod_directory_confirmed: true}, {command: 'node'},
  ])('rejects invalid or expanded authority %j', patch => {
    const f = fixture(), initial = f.store.read();
    expect(() => validateSettings({...initial.settings, ...patch})).toThrow();
    expect(fs.existsSync(path.dirname(f.filename))).toBe(false);
  });
  it.each(['json', 'version', 'extra', 'oversize', 'symlink', 'hardlink', 'directory'])('does not default/overwrite unsafe existing %s', kind => {
    const f = fixture(), initial = f.store.read(); fs.mkdirSync(path.dirname(f.filename));
    const data = kind === 'json' ? '{invalid' : kind === 'version' ? JSON.stringify({schema_version: 2, settings: initial.settings})
      : kind === 'extra' ? JSON.stringify({schema_version: 1, settings: initial.settings, script: 'x'})
      : kind === 'oversize' ? ' '.repeat(32769) : JSON.stringify({schema_version: 1, settings: initial.settings});
    if (kind === 'directory') fs.mkdirSync(f.filename);
    else if (kind === 'symlink') { fs.writeFileSync(path.join(f.root, 'other.json'), data); fs.symlinkSync(path.join(f.root, 'other.json'), f.filename); }
    else { fs.writeFileSync(f.filename, data); if (kind === 'hardlink') fs.linkSync(f.filename, path.join(f.root, 'linked.json')); }
    expect(() => f.store.read()).toThrow('未自动覆盖');
    expect(() => f.store.save(initial.settings, initial.revision)).toThrow();
    expect(fs.readdirSync(path.dirname(f.filename))).toEqual(['freecad-mcp-settings.json']);
  });
  it('rejects symlink ancestors even when the target is absent', () => {
    const f = fixture(), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.dirname(f.filename));
    expect(() => f.store.read()).toThrow(); expect(fs.readdirSync(outside)).toEqual([]);
  });
});
