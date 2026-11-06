import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'node:child_process';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), acquire: vi.fn(), configure: vi.fn(), release: vi.fn(), healthy: vi.fn() }));
vi.mock('../drawing-research/executionGate.js', () => ({
  acquireDrawingExecution: mocks.acquire,
  configureDrawingExecutionBarrier: mocks.configure,
}));
vi.mock('../../lib/freecadProcessSecurity.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/freecadProcessSecurity.js')>();
  return { ...actual, resolveFreecadCommand: () => '/synthetic/official/freecadcmd' };
});
import { ASSEMBLY_NATIVE_BOOTSTRAP, runOwnedAssemblyNative } from './native-runner.js';
import { ASSEMBLY_NATIVE_PRESERVATION } from './native-preservation.js';
import { deskToolsRegistrationDirectory } from '../../lib/deskToolsRegistration.js';

// All native calls and the durable coordinator are mocked. These tests cannot start FreeCAD.
const roots: string[] = [];
let mismatch = false;
beforeEach(() => {
  mismatch = false;
  vi.clearAllMocks();
  mocks.acquire.mockReturnValue(Object.assign(mocks.release, { spawn: mocks.spawn, assertHealthy: mocks.healthy }));
  mocks.spawn.mockImplementation((_command: string, _args: string[], options: SpawnOptions) => {
    const directory = String(options.cwd); roots.push(directory);
    const child = Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    queueMicrotask(() => {
      child.emit('spawn');
      const spec = JSON.parse(fs.readFileSync(path.join(directory, 'spec.json'), 'utf8'));
      fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ version: 1, nonce: spec.nonce, pid: mismatch ? 99999 : child.pid, state: 'passed' }));
      child.emit('close', 0, null);
    });
    return child as unknown as ChildProcess;
  });
});
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('owned Assembly native runner without native execution', () => {
  it('uses the real fixed host scope and a private whitelist-configured headless process', async () => {
    process.env.SYNTHETIC_PROOF_SECRET = 'must-not-leak';
    try {
      const result = await runOwnedAssemblyNative({ freecadHome: '/synthetic/official', stage: 'synthetic', script: ASSEMBLY_NATIVE_BOOTSTRAP + '\nfinish({})', spec: {} });
      expect(mocks.configure).toHaveBeenCalledExactlyOnceWith(path.join(deskToolsRegistrationDirectory(), 'native-freecad-v1'));
      const [command, args, options] = mocks.spawn.mock.calls[0];
      expect(command).toBe('/synthetic/official/freecadcmd');
      expect(args).toEqual(['-u', path.join(result.directory, 'user.cfg'), '-s', path.join(result.directory, 'system.cfg'), path.join(result.directory, 'program.py')]);
      expect(options.env.SYNTHETIC_PROOF_SECRET).toBeUndefined();
      expect(options.env.QT_QPA_PLATFORM).toBe('offscreen');
      for (const key of ['FREECAD_USER_HOME', 'FREECAD_USER_DATA', 'FREECAD_USER_TEMP']) {
        expect(options.env[key].startsWith(result.directory + path.sep)).toBe(true);
        expect(fs.lstatSync(options.env[key]).mode & 0o077).toBe(0);
      }
      expect(JSON.parse(fs.readFileSync(path.join(result.directory, 'owner.json'), 'utf8'))).toEqual({ version: 1, nonce: result.proof.nonce, expected_pid: 12345 });
      expect(result.proof).toMatchObject({ pid: 12345, actual_close_observed: true, exit_code: 0 });
      expect(mocks.release).toHaveBeenCalledOnce();
      expect(fs.readFileSync(path.join(result.directory, 'program.py'), 'utf8')).toContain('if __name__ == "program":');
    } finally { delete process.env.SYNTHETIC_PROOF_SECRET; }
  });

  it('does not accept an unbound PID receipt despite successful process close', async () => {
    mismatch = true;
    await expect(runOwnedAssemblyNative({ freecadHome: '/synthetic', stage: 'synthetic', script: 'pass', spec: {} })).rejects.toMatchObject({ code: 'receipt_binding_mismatch' });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('propagates a busy fixed gate without launching or clearing it', async () => {
    mocks.acquire.mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { code: 'busy' }); });
    await expect(runOwnedAssemblyNative({ freecadHome: '/synthetic', stage: 'synthetic', script: 'pass', spec: {} })).rejects.toMatchObject({ code: 'busy' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it('rejects pre-cancellation and invalid programs before obtaining a native lease', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runOwnedAssemblyNative({ freecadHome: '/synthetic', stage: 'synthetic', script: 'pass', spec: {}, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    await expect(runOwnedAssemblyNative({ freecadHome: '/synthetic', stage: '../wrong', script: 'pass', spec: {} })).rejects.toMatchObject({ code: 'invalid_program' });
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it('requires actual private configuration and geometry-derived frames, not just stored Placements', () => {
    expect(ASSEMBLY_NATIVE_BOOTSTRAP).toContain("App.ConfigGet(key)");
    expect(ASSEMBLY_NATIVE_BOOTSTRAP).toContain("('UserParameter', 'user.cfg')");
    expect(ASSEMBLY_NATIVE_BOOTSTRAP).toContain("('SystemParameter', 'system.cfg')");
    expect(ASSEMBLY_NATIVE_PRESERVATION).toContain('joint.Proxy.findPlacement(joint, reference, side)');
    expect(ASSEMBLY_NATIVE_PRESERVATION).toContain('UtilsAssembly.getGlobalPlacement(reference) * computed');
    expect(ASSEMBLY_NATIVE_PRESERVATION).toContain('guard_assembly_removals(before, removed)');
    expect(ASSEMBLY_NATIVE_PRESERVATION).not.toContain('.Rigid =');
    expect(ASSEMBLY_NATIVE_PRESERVATION).not.toContain('.solve(');
  });
});
