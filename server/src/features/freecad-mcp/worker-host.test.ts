import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {OwnedWorkerSessionManager} from './worker-manager.js';
import {OwnedWorkerHost, closeFreecadHostServices} from './worker-host.js';
import type {OwnedThumbnailWorkerSession, withOwnedThumbnailWorker} from './worker-session.js';
import type {ThumbnailWorkerClient} from './worker-client.js';
import type {PinnedResource} from './resource.js';
import type {OwnedWorkerObservation} from '../../../../shared/freecad-mcp/worker.js';

const roots: string[] = [];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return {promise, resolve}; }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-worker-host-test-'))); roots.push(parent); fs.chmodSync(parent, 0o700);
  const didClose = deferred(), batchClose = deferred(), events: string[] = [];
  const factory: typeof withOwnedThumbnailWorker = async <T>(input: Parameters<typeof withOwnedThumbnailWorker>[0], operation: (owned: OwnedThumbnailWorkerSession) => Promise<T>): Promise<T> => {
    events.push('worker:launch');
    const identity = {workerId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', nativePid: 45678, url: 'http://127.0.0.1:19991/'};
    const client: ThumbnailWorkerClient = {status: vi.fn(), render: vi.fn(), get: vi.fn(), cancel: vi.fn()};
    try { return await operation({identity, client, signal: input.signal!}); }
    finally { events.push('worker:cleanup'); await didClose.promise; events.push('worker:actual-close'); }
  };
  const manager = new OwnedWorkerSessionManager({withOwned: factory, createProfileParent: () => parent});
  const host = new OwnedWorkerHost(manager);
  const input = {resource: {manifestPath: '/synthetic/resource/manifest.json', manifestSha: 'a'.repeat(64), root: '/synthetic/resource', version: '0.3.2', digest: 'a'.repeat(64), addonDir: 'addon/PhoenixFreeCADTools', installerEntry: 'scripts/install-addon.mjs', files: {}} as PinnedResource,
    executable: '/synthetic/raw-freecad-gui', configurationRevision: 'b'.repeat(64)};
  return {host, input, events, didClose, batchClose};
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
describe('host owned-worker shutdown without any Native child', () => {
  it('closes start admission synchronously, including before any service has started', async () => {
    const f = fixture(), closing = f.host.close();
    expect(f.host.stopping).toBe(true); expect(() => f.host.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    await closing; expect(f.events).toEqual([]);
  });
  it('stops both services in parallel and waits for actual owned close before server close/exit', async () => {
    const f = fixture(); f.host.start(f.input); await flush();
    const closeServer = vi.fn(), exit = vi.fn();
    const shuttingDown = closeFreecadHostServices(async () => { f.events.push('batch:stop'); await f.batchClose.promise; f.events.push('batch:closed'); }, f.host)
      .then(() => { closeServer(); exit(); });
    expect(f.host.stopping).toBe(true); expect(() => f.host.start(f.input)).toThrow(); await flush();
    expect(f.events).toContain('batch:stop'); expect(f.events).toContain('worker:cleanup');
    f.batchClose.resolve(); await flush(); expect(closeServer).not.toHaveBeenCalled(); expect(exit).not.toHaveBeenCalled();
    expect(f.host.status()).toMatchObject({phase: 'stopping', owned: true});
    f.didClose.resolve(); await shuttingDown;
    expect(f.host.status()).toMatchObject({phase: 'stopped', owned: false}); expect(closeServer).toHaveBeenCalledOnce(); expect(exit).toHaveBeenCalledOnce();
  });
  it('does not short-circuit a pending worker after batch failure or pretend to close the server', async () => {
    const f = fixture(); f.host.start(f.input); await flush();
    const closeServer = vi.fn(); let rejected = false;
    const shuttingDown = closeFreecadHostServices(async () => { throw new Error('synthetic private diagnostic'); }, f.host).then(closeServer, error => {
      rejected = true; expect(String(error)).toBe('Error: host_execution_close_unconfirmed');
    });
    await flush(); expect(rejected).toBe(false); expect(f.host.status().owned).toBe(true); expect(closeServer).not.toHaveBeenCalled();
    f.didClose.resolve(); await shuttingDown; expect(rejected).toBe(true); expect(closeServer).not.toHaveBeenCalled();
    expect(() => f.host.start(f.input)).toThrow();
  });
  it('joins duplicate shutdown requests and never invokes a second lifetime', async () => {
    const f = fixture(); f.host.start(f.input); await flush();
    const first = f.host.close(), second = f.host.close(); expect(first).toBe(second); await flush();
    expect(f.events.filter(value => value === 'worker:cleanup')).toHaveLength(1);
    f.didClose.resolve(); await first; expect(f.events.filter(value => value === 'worker:launch')).toHaveLength(1);
  });
  it('does not treat unknown cleanup with owned=false as proof the host may exit or start again', async () => {
    const f = fixture();
    let observation: OwnedWorkerObservation = {schema_version: 1, id: '33333333-3333-4333-8333-333333333333', phase: 'ready', reason_code: 'worker_ready', message: 'synthetic', owned: true, configuration_revision: 'b'.repeat(64)};
    const start = vi.fn(), stop = vi.fn(async () => {
      observation = {...observation, phase: 'unknown', reason_code: 'cleanup_failed', owned: false}; return {...observation};
    });
    const host = new OwnedWorkerHost({status: () => ({...observation}), start, stop});
    const serverClose = vi.fn();
    await expect(closeFreecadHostServices(async () => {}, host).then(serverClose)).rejects.toThrow('host_execution_close_unconfirmed');
    expect(stop).toHaveBeenCalledOnce(); expect(host.stopping).toBe(true); expect(serverClose).not.toHaveBeenCalled();
    expect(() => host.start(f.input)).toThrow(); expect(start).not.toHaveBeenCalled();
    const recoveredObservationOnly = new OwnedWorkerHost({status: () => ({...observation}), start, stop});
    expect(() => recoveredObservationOnly.start(f.input)).toThrow(); await expect(recoveredObservationOnly.close()).rejects.toThrow('close_unconfirmed');
  });
});
