import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {PinnedResource} from './resource.js';
import {ThumbnailWorkerClientError, type ThumbnailWorkerClient, type ThumbnailWorkerStatus} from './worker-client.js';
import {OwnedThumbnailWorkerError, type OwnedThumbnailWorkerInput, type OwnedThumbnailWorkerSession, type withOwnedThumbnailWorker} from './worker-session.js';
import {OwnedWorkerSessionManager, type OwnedWorkerStartInput} from './worker-manager.js';

// Pure Host factories only: no Native/GUI/process, execution gate, existing
// runtime/configuration, CAD documents, or production paths are exercised.
const roots: string[] = [];
const revision = 'a'.repeat(64);
const workerId = '11111111-1111-4111-8111-111111111111';
const transportId = '22222222-2222-4222-8222-222222222222';
const staleId = '33333333-3333-4333-8333-333333333333';
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; });
  return {promise, resolve, reject};
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function directory(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-worker-manager-test-')));
  fs.chmodSync(root, 0o700); roots.push(root); return root;
}
function ready(): ThumbnailWorkerStatus {
  return {schema_version: 1, worker_id: workerId, session_id: transportId, state: 'ready', active_job_id: null, saves_cad: false,
    render_profile: 'native-isometric-white-v1', supported_file_scope: 'trusted-native-self-contained', jobs_retained: 20, max_jobs: 256,
    max_input_bytes: 67108864, max_png_bytes: 4194304, dimensions: {max_width: 1024, max_height: 1024, max_pixels: 1048576}};
}
function fixture(options: {delayReady?: boolean; delayClose?: boolean; startupError?: Error; cleanupError?: Error} = {}) {
  const parent = directory(), gate = deferred(), closed = deferred(), controller = new AbortController();
  const events: string[] = [], inputs: OwnedThumbnailWorkerInput[] = [];
  const status = vi.fn<ThumbnailWorkerClient['status']>().mockImplementation(async () => ready());
  const client: ThumbnailWorkerClient = {status, render: vi.fn(), get: vi.fn(), cancel: vi.fn()};
  const session: OwnedThumbnailWorkerSession = {identity: {workerId, sessionId: transportId, nativePid: 45678, url: 'http://127.0.0.1:32109/'}, client, signal: controller.signal};
  const input: OwnedWorkerStartInput = {resource: {manifestPath: '/opaque/resource/release.json', manifestSha: 'b'.repeat(64), root: '/opaque/resource', version: '0.3.2',
    digest: 'b'.repeat(64), addonDir: 'addon/PhoenixFreeCADTools', installerEntry: 'scripts/install-addon.mjs', files: {'opaque.txt': 'c'.repeat(64)}} as PinnedResource,
    executable: '/opaque/resolved-native-binary', configurationRevision: revision};
  const own: typeof withOwnedThumbnailWorker = async <T>(value: OwnedThumbnailWorkerInput, operation: (owned: OwnedThumbnailWorkerSession) => Promise<T>): Promise<T> => {
    inputs.push(value); events.push('factory:start');
    const currentController = inputs.length === 1 ? controller : new AbortController();
    const currentSession = {...session, signal: currentController.signal};
    const abort = () => { events.push('input:abort'); currentController.abort(); };
    value.signal!.addEventListener('abort', abort, {once: true});
    try {
      if (options.delayReady) await gate.promise;
      if (options.startupError) throw options.startupError;
      if (value.signal!.aborted) throw new OwnedThumbnailWorkerError('startup_cancelled');
      events.push('operation:start');
      const result = await operation(currentSession);
      events.push('operation:end');
      return result;
    } finally {
      events.push('cleanup:start');
      if (options.delayClose) await closed.promise;
      events.push('actual:mcp:close', 'actual:native:close');
      value.signal!.removeEventListener('abort', abort);
      if (options.cleanupError) throw options.cleanupError;
    }
  };
  const profileParent = vi.fn(() => parent);
  const manager = new OwnedWorkerSessionManager({withOwned: own, createProfileParent: profileParent});
  return {manager, input, parent, gate, closed, controller, events, inputs, status, client, session, profileParent};
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); vi.restoreAllMocks(); });

describe('explicit owned worker manager without Native execution', () => {
  it('observes idle without invoking either Host factory or any protocol method', () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) expect(f.manager.status()).toMatchObject({id: null, phase: 'idle', owned: false, reason_code: 'not_started'});
    expect(f.profileParent).not.toHaveBeenCalled(); expect(f.inputs).toHaveLength(0); expect(f.status).not.toHaveBeenCalled();
  });
  it('returns a starting manager UUID immediately and only exposes safe metadata', async () => {
    const f = fixture({delayReady: true});
    const initial = f.manager.start(f.input);
    expect(initial).toMatchObject({phase: 'starting', owned: true, configuration_revision: revision});
    expect(initial.id).toMatch(/^[a-f0-9-]{36}$/); expect(initial.id).not.toBe(transportId); expect(f.inputs).toHaveLength(0);
    await flush();
    expect(Object.keys(initial).sort()).toEqual(['configuration_revision', 'id', 'message', 'owned', 'phase', 'reason_code', 'schema_version']);
    expect(JSON.stringify(f.manager.status())).not.toMatch(/opaque|127\.0\.0\.1|45678|profile|11111111|22222222/);
    initial.phase = 'ready'; expect(f.manager.status().phase).toBe('starting');
    const stop = f.manager.stop(initial.id!); f.gate.resolve(); await stop;
  });
  it('rejects duplicate start immediately rather than queuing or replaying it', async () => {
    const f = fixture({delayReady: true}), first = f.manager.start(f.input);
    expect(() => f.manager.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    await flush(); expect(f.inputs).toHaveLength(1);
    const stop = f.manager.stop(first.id!); f.gate.resolve(); await stop;
  });
  it('copies the pinned Host inputs before background work and fixes its own fresh profile', async () => {
    const f = fixture(), initial = f.manager.start(f.input);
    (f.input.resource as {digest: string}).digest = 'changed';
    (f.input.resource.files as Record<string, string>)['opaque.txt'] = 'changed';
    f.input.executable = '/different';
    await flush();
    expect(f.inputs[0].resource.digest).toBe('b'.repeat(64)); expect(f.inputs[0].resource.files['opaque.txt']).toBe('c'.repeat(64));
    expect(f.inputs[0].executable).toBe('/opaque/resolved-native-binary');
    expect(f.inputs[0].profile).toBe(path.join(f.parent, 'profile')); expect(fs.existsSync(f.inputs[0].profile)).toBe(false);
    expect(Object.keys(f.inputs[0]).sort()).toEqual(['executable', 'profile', 'resource', 'signal']);
    expect(JSON.parse(fs.readFileSync(path.join(f.parent, '.desk-owned-worker-manager.json'), 'utf8'))).toMatchObject({id: initial.id});
    await f.manager.stop(initial.id!);
  });
  it.each([{configurationRevision: 'not-a-digest'}, {executable: 'relative'}, {profile: '/forbidden'}, {gate: 'different'}])('rejects unsafe or extra start fields %j', fields => {
    const f = fixture(); expect(() => f.manager.start({...f.input, ...fields})).toThrow(expect.objectContaining({code: 'invalid_start'}));
    expect(f.profileParent).not.toHaveBeenCalled(); expect(f.manager.status().phase).toBe('idle');
  });
  it('does not allow a Host namespace seam', () => {
    expect(() => new OwnedWorkerSessionManager({namespace: 'other'} as never)).toThrow(expect.objectContaining({code: 'invalid_start'}));
  });
  it('moves to ready and never sends status requests from observation calls', async () => {
    const f = fixture(), initial = f.manager.start(f.input); await flush();
    expect(f.manager.status()).toMatchObject({id: initial.id, phase: 'ready', owned: true});
    for (let i = 0; i < 5; i++) f.manager.status();
    expect(f.status).not.toHaveBeenCalled(); await f.manager.stop(initial.id!);
  });
  it('takes one immediate lease, passes the private session and probes before returning ready', async () => {
    const f = fixture(), initial = f.manager.start(f.input); await flush();
    const result = await f.manager.withReadySession(initial.id!, async session => {
      expect(f.manager.status().phase).toBe('leased'); expect(session.identity).toEqual(f.session.identity);
      expect(session.client).not.toBe(f.client); expect(session.signal.aborted).toBe(false); return 42;
    });
    expect(result).toBe(42); expect(f.status).toHaveBeenCalledOnce(); expect(f.manager.status().phase).toBe('ready');
    await f.manager.stop(initial.id!);
  });
  it('does not queue a second borrower while the callback or post-callback probe is pending', async () => {
    const f = fixture(), initial = f.manager.start(f.input), callback = deferred(), probe = deferred<ThumbnailWorkerStatus>(); await flush();
    f.status.mockReturnValue(probe.promise);
    const first = f.manager.withReadySession(initial.id!, async () => { await callback.promise; return 1; });
    const second = vi.fn(); await expect(f.manager.withReadySession(initial.id!, second)).rejects.toMatchObject({code: 'session_busy'});
    callback.resolve(); await flush(); expect(f.manager.status().phase).toBe('leased');
    await expect(f.manager.withReadySession(initial.id!, second)).rejects.toMatchObject({code: 'session_busy'}); expect(second).not.toHaveBeenCalled();
    probe.resolve(ready()); await expect(first).resolves.toBe(1); await f.manager.stop(initial.id!);
  });
  it('expires each client facade and signal when its callback finishes, including during a later lease', async () => {
    const f = fixture(), initial = f.manager.start(f.input); await flush();
    let prior!: OwnedThumbnailWorkerSession;
    await f.manager.withReadySession(initial.id!, async session => { prior = session; await session.client.status(); });
    expect(prior.signal.aborted).toBe(true); expect(f.status).toHaveBeenCalledTimes(2);
    await expect(prior.client.status()).rejects.toMatchObject({code: 'session_not_ready'});
    await expect(prior.client.render({jobId: staleId, file: '/opaque/File.FCStd', expectedSha256: 'd'.repeat(64)})).rejects.toMatchObject({code: 'session_not_ready'});
    expect(f.client.render).not.toHaveBeenCalled();
    await f.manager.withReadySession(initial.id!, async session => {
      expect(session.signal.aborted).toBe(false); expect(session.client).not.toBe(prior.client);
      await expect(prior.client.get({jobId: staleId, file: '/opaque/File.FCStd', expectedSha256: 'd'.repeat(64)})).rejects.toMatchObject({code: 'session_not_ready'});
      await expect(prior.client.cancel({jobId: staleId, file: '/opaque/File.FCStd', expectedSha256: 'd'.repeat(64)})).rejects.toMatchObject({code: 'session_not_ready'});
      expect(f.client.get).not.toHaveBeenCalled(); expect(f.client.cancel).not.toHaveBeenCalled();
    });
    await f.manager.stop(initial.id!);
  });
  it('preserves a callback failure only after checking that the same worker is reusable', async () => {
    const f = fixture(), initial = f.manager.start(f.input); await flush(); const error = new Error('domain failure');
    await expect(f.manager.withReadySession(initial.id!, async () => { throw error; })).rejects.toBe(error);
    expect(f.status).toHaveBeenCalledOnce(); expect(f.manager.status().phase).toBe('ready'); await f.manager.stop(initial.id!);
  });
  it.each(['busy', 'quarantined', 'stopped', 'identity', 'active_job', 'request_failed'])('does not re-lend a session with %s after callback', async mode => {
    const f = fixture({delayClose: true}), initial = f.manager.start(f.input); await flush();
    if (mode === 'request_failed') f.status.mockRejectedValue(new Error('/untrusted/private/error'));
    else f.status.mockResolvedValue({...ready(), ...(mode === 'identity' ? {session_id: staleId} : mode === 'active_job' ? {active_job_id: staleId}
      : {state: mode as 'busy' | 'quarantined' | 'stopped', active_job_id: mode === 'busy' ? staleId : null})});
    await expect(f.manager.withReadySession(initial.id!, async () => 1)).rejects.toMatchObject({code: 'session_not_reusable'});
    expect(f.manager.status()).toMatchObject({phase: 'unknown', reason_code: 'session_not_reusable', owned: true});
    expect(() => f.manager.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    await expect(f.manager.withReadySession(initial.id!, async () => 2)).rejects.toMatchObject({code: 'session_not_ready'});
    expect(JSON.stringify(f.manager.status())).not.toContain('untrusted');
    const stop = f.manager.stop(initial.id!); f.closed.resolve();
    expect(await stop).toMatchObject({phase: 'failed', reason_code: 'session_not_reusable', owned: false});
  });
  it('aborts a borrower on stop but waits for its real settlement and then both close proofs', async () => {
    const f = fixture({delayClose: true}), initial = f.manager.start(f.input); await flush();
    const callback = deferred(); let signal!: AbortSignal;
    const lease = f.manager.withReadySession(initial.id!, async session => { signal = session.signal; await callback.promise; return 1; });
    const rejected = expect(lease).rejects.toMatchObject({code: 'session_cancelled'});
    let stopped = false; const stop = f.manager.stop(initial.id!).then(value => { stopped = true; return value; });
    await flush(); expect(signal.aborted).toBe(true); expect(stopped).toBe(false); expect(f.events).not.toContain('cleanup:start');
    expect(f.manager.status()).toMatchObject({phase: 'stopping', owned: true});
    expect(() => f.manager.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    callback.resolve(); await rejected; await flush(); expect(f.events).toContain('cleanup:start'); expect(stopped).toBe(false);
    expect(f.status).not.toHaveBeenCalled(); f.closed.resolve();
    expect(await stop).toMatchObject({phase: 'stopped', reason_code: 'stopped_after_owned_close', owned: false});
    expect(f.events.slice(-2)).toEqual(['actual:mcp:close', 'actual:native:close']);
  });
  it('keeps a post-callback status probe in the lease while stop is pending', async () => {
    const f = fixture(), initial = f.manager.start(f.input), probe = deferred<ThumbnailWorkerStatus>(); await flush();
    f.status.mockReturnValue(probe.promise);
    const lease = f.manager.withReadySession(initial.id!, async () => 1), rejected = expect(lease).rejects.toMatchObject({code: 'session_cancelled'});
    await flush(); const stop = f.manager.stop(initial.id!); await flush();
    expect(f.events).not.toContain('cleanup:start');
    probe.reject(new ThumbnailWorkerClientError('worker_cancelled')); await rejected;
    expect(await stop).toMatchObject({phase: 'stopped', owned: false});
  });
  it('joins repeated stops by UUID and cannot stop another session or a PID', async () => {
    const f = fixture({delayClose: true}), initial = f.manager.start(f.input); await flush();
    await expect(f.manager.stop('45678')).rejects.toMatchObject({code: 'invalid_session_id'});
    await expect(f.manager.stop(staleId)).rejects.toMatchObject({code: 'session_not_current'});
    const first = f.manager.stop(initial.id!), second = f.manager.stop(initial.id!); await flush();
    expect(f.events.filter(item => item === 'input:abort')).toHaveLength(1); f.closed.resolve();
    expect(await first).toEqual(await second); expect(await f.manager.stop(initial.id!)).toMatchObject({phase: 'stopped'});
    expect(f.inputs).toHaveLength(1);
  });
  it('can stop a starting operation but never assumes a startup timeout proves close', async () => {
    const f = fixture({delayReady: true, delayClose: true}), initial = f.manager.start(f.input); await flush();
    const stop = f.manager.stop(initial.id!); await flush();
    expect(f.manager.status()).toMatchObject({phase: 'stopping', owned: true});
    f.gate.resolve(); await flush(); expect(f.manager.status().owned).toBe(true);
    f.closed.resolve(); expect(await stop).toMatchObject({phase: 'stopped', owned: false});
  });
  it('does not even launch if stopped before its background turn', async () => {
    const f = fixture(), initial = f.manager.start(f.input); const result = await f.manager.stop(initial.id!);
    expect(result).toMatchObject({phase: 'stopped', owned: false}); expect(f.profileParent).not.toHaveBeenCalled(); expect(f.inputs).toHaveLength(0);
  });
  it('waits for a pending profile factory but never launches after stop', async () => {
    const f = fixture(), parent = deferred<string>();
    const manager = new OwnedWorkerSessionManager({withOwned: async () => { throw new Error('must not launch'); }, createProfileParent: () => parent.promise});
    const initial = manager.start(f.input); await flush();
    let settled = false; const stop = manager.stop(initial.id!).then(value => { settled = true; return value; }); await flush();
    expect(settled).toBe(false); expect(manager.status()).toMatchObject({phase: 'stopping', owned: true});
    expect(() => manager.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    parent.resolve(f.parent); expect(await stop).toMatchObject({phase: 'stopped', owned: false});
    expect(fs.readdirSync(f.parent)).toEqual([]);
  });
  it.each(['throw', 'reject'])('contains a %s from the Host profile factory without leaking its message', async mode => {
    const f = fixture();
    const manager = new OwnedWorkerSessionManager({withOwned: async () => { throw new Error('must not launch'); }, createProfileParent: () => {
      if (mode === 'throw') throw new Error('/private/profile-factory'); return Promise.reject(new Error('/private/profile-factory'));
    }});
    manager.start(f.input); await flush(); expect(manager.status()).toMatchObject({phase: 'failed', reason_code: 'startup_failed', owned: false});
    expect(JSON.stringify(manager.status())).not.toContain('/private');
  });
  it('retains starting ownership after startup failure until the factory really settles', async () => {
    const f = fixture({startupError: new Error('/private/raw-failure'), delayClose: true}), initial = f.manager.start(f.input); await flush();
    expect(f.manager.status()).toMatchObject({phase: 'starting', owned: true});
    expect(() => f.manager.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    f.closed.resolve(); await flush();
    expect(f.manager.status()).toMatchObject({id: initial.id, phase: 'failed', reason_code: 'startup_failed', owned: false});
    expect(JSON.stringify(f.manager.status())).not.toContain('private');
  });
  it('reacts to unexpected Native/MCP closure even with no borrower, but holds the slot through cleanup', async () => {
    const f = fixture({delayClose: true}), initial = f.manager.start(f.input); await flush();
    f.controller.abort(); await flush();
    expect(f.manager.status()).toMatchObject({phase: 'unknown', reason_code: 'session_lost', owned: true});
    expect(f.inputs[0].signal!.aborted).toBe(true); expect(f.events).toContain('cleanup:start');
    expect(() => f.manager.start(f.input)).toThrow(expect.objectContaining({code: 'manager_busy'}));
    const stop = f.manager.stop(initial.id!); f.closed.resolve(); expect(await stop).toMatchObject({phase: 'failed', reason_code: 'session_lost', owned: false});
  });
  it('unexpected signal abort reaches the active borrower and waits for it before releasing resources', async () => {
    const f = fixture({delayClose: true}), initial = f.manager.start(f.input), callback = deferred(); await flush();
    let signal!: AbortSignal;
    const lease = f.manager.withReadySession(initial.id!, async session => { signal = session.signal; await callback.promise; return 1; });
    const rejected = expect(lease).rejects.toMatchObject({code: 'session_lost'});
    f.controller.abort(); await flush(); expect(signal.aborted).toBe(true); expect(f.events).not.toContain('cleanup:start');
    callback.resolve(); await rejected; await flush(); expect(f.events).toContain('cleanup:start');
    const stop = f.manager.stop(initial.id!); f.closed.resolve(); expect(await stop).toMatchObject({phase: 'failed', owned: false});
  });
  it('never advertises ready if the owned signal was already aborted on entry', async () => {
    const f = fixture({delayReady: true, delayClose: true}), initial = f.manager.start(f.input); await flush();
    f.controller.abort(); f.gate.resolve(); await flush();
    expect(f.manager.status()).toMatchObject({phase: 'unknown', reason_code: 'session_lost', owned: true});
    await expect(f.manager.withReadySession(initial.id!, async () => 1)).rejects.toMatchObject({code: 'session_not_ready'});
    const stop = f.manager.stop(initial.id!); f.closed.resolve(); expect(await stop).toMatchObject({phase: 'failed', reason_code: 'session_lost'});
  });
  it.each(['resolve', 'reject'])('revokes readiness if a bad Host factory unexpectedly %ss after opening its operation', async mode => {
    const f = fixture(); let operation: Promise<unknown> | undefined;
    const own: typeof withOwnedThumbnailWorker = async <T>(_input: OwnedThumbnailWorkerInput, run: (session: OwnedThumbnailWorkerSession) => Promise<T>): Promise<T> => {
      operation = run(f.session); if (mode === 'reject') throw new Error('/private/bad-factory'); return undefined as T;
    };
    const manager = new OwnedWorkerSessionManager({withOwned: own, createProfileParent: () => f.parent});
    const initial = manager.start(f.input); await flush(); await operation;
    expect(manager.status()).toMatchObject({owned: false, phase: mode === 'resolve' ? 'failed' : 'unknown', reason_code: mode === 'resolve' ? 'session_lost' : 'cleanup_failed'});
    await expect(manager.withReadySession(initial.id!, async () => 1)).rejects.toMatchObject({code: 'session_not_current'});
    expect(JSON.stringify(manager.status())).not.toContain('/private');
  });
  it.each(['starting', 'ready'])('irreversibly latches unknown after %s cleanup, even after same-ID stop and observation mutation', async phase => {
    const f = fixture({cleanupError: new Error('/private/cleanup'), delayReady: phase === 'starting'}), initial = f.manager.start(f.input); await flush();
    const stop = f.manager.stop(initial.id!); if (phase === 'starting') f.gate.resolve();
    expect(await stop).toMatchObject({phase: 'unknown', reason_code: 'cleanup_failed', owned: false});
    const metadata = f.manager.status(); metadata.phase = 'stopped'; metadata.owned = false;
    expect(await f.manager.stop(initial.id!)).toMatchObject({phase: 'unknown', reason_code: 'cleanup_failed', owned: false});
    expect(() => f.manager.start(f.input)).toThrow(expect.objectContaining({name: 'OwnedWorkerManagerError', code: 'manager_uncertain'}));
    expect(() => f.manager.start({...f.input, configurationRevision: 'e'.repeat(64)})).toThrow(expect.objectContaining({code: 'manager_uncertain'}));
    await flush();
    expect(f.profileParent).toHaveBeenCalledOnce(); expect(f.inputs).toHaveLength(1);
    expect(f.manager.status()).toMatchObject({id: initial.id, phase: 'unknown', owned: false});
    await expect(f.manager.withReadySession(initial.id!, async () => 1)).rejects.toMatchObject({code: 'session_not_current'});
    expect(JSON.stringify(f.manager.status())).not.toContain('/private');
  });
  it.each(['startup_failed', 'session_lost'])('permits only an explicit fresh ID after known-closed %s', async reason => {
    const options: {startupError?: Error} = reason === 'startup_failed' ? {startupError: new Error('synthetic startup failure')} : {};
    const f = fixture(options), parents = [f.parent, directory()]; f.profileParent.mockImplementation(() => parents.shift()!);
    const initial = f.manager.start(f.input); await flush();
    if (reason === 'session_lost') { f.controller.abort(); await flush(); }
    expect(f.manager.status()).toMatchObject({phase: 'failed', reason_code: reason, owned: false});
    expect(f.events.slice(-2)).toEqual(['actual:mcp:close', 'actual:native:close']);
    options.startupError = undefined;
    const next = f.manager.start(f.input); expect(next.id).not.toBe(initial.id); await flush();
    expect(f.manager.status()).toMatchObject({id: next.id, phase: 'ready', owned: true});
    await expect(f.manager.withReadySession(next.id!, async () => 42)).resolves.toBe(42);
    expect(await f.manager.stop(next.id!)).toMatchObject({phase: 'stopped', owned: false});
    expect(f.inputs).toHaveLength(2); expect(f.inputs[1].profile).not.toBe(f.inputs[0].profile);
  });
  it('rejects a nonprivate, aliased, or previously claimed profile parent without calling withOwned', async () => {
    const f = fixture(); fs.chmodSync(f.parent, 0o755); const first = f.manager.start(f.input); await flush();
    expect(f.manager.status()).toMatchObject({phase: 'failed', owned: false}); expect(f.inputs).toHaveLength(0);
    fs.chmodSync(f.parent, 0o700); const second = f.manager.start(f.input); await flush(); await f.manager.stop(second.id!);
    const third = f.manager.start(f.input); await flush();
    expect(third.id).not.toBe(first.id); expect(f.manager.status()).toMatchObject({phase: 'failed', owned: false}); expect(f.inputs).toHaveLength(1);
    const root = directory(), alias = path.join(root, 'alias'); fs.symlinkSync(f.parent, alias);
    const manager = new OwnedWorkerSessionManager({withOwned: async () => { throw new Error('must not launch'); }, createProfileParent: () => alias});
    manager.start(f.input); await flush(); expect(manager.status()).toMatchObject({phase: 'failed', owned: false});
  });
  it('allows an explicit new start only after old lifetime completion, with a new ID and fresh profile', async () => {
    const f = fixture(), parents = [f.parent, directory()]; f.profileParent.mockImplementation(() => parents.shift()!);
    const old = f.manager.start(f.input); await flush(); await f.manager.stop(old.id!);
    const next = f.manager.start(f.input); expect(next.id).not.toBe(old.id);
    await expect(f.manager.stop(old.id!)).rejects.toMatchObject({code: 'session_not_current'}); await flush();
    expect(f.inputs).toHaveLength(2); expect(f.inputs[1].profile).not.toBe(f.inputs[0].profile);
    expect(f.manager.status()).toMatchObject({phase: 'ready', owned: true});
    await expect(f.manager.withReadySession(next.id!, async session => { expect(session.signal.aborted).toBe(false); return 2; })).resolves.toBe(2);
    expect(await f.manager.stop(next.id!)).toMatchObject({phase: 'stopped', owned: false});
  });
  it('never restores a historical observation into a ready capability', async () => {
    const f = fixture(), initial = f.manager.start(f.input); await flush(); await f.manager.stop(initial.id!);
    await expect(f.manager.withReadySession(initial.id!, async () => 1)).rejects.toMatchObject({code: 'session_not_current'});
    const other = fixture(); expect(other.manager.status()).toMatchObject({phase: 'idle', id: null});
    await expect(other.manager.stop(initial.id!)).rejects.toMatchObject({code: 'session_not_current'});
    await expect(other.manager.withReadySession(initial.id!, async () => 1)).rejects.toMatchObject({code: 'session_not_current'});
    expect(other.inputs).toHaveLength(0);
  });
});
