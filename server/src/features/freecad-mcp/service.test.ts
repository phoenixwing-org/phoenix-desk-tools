import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {FreecadMcpManager} from './service.js';
import {FreecadMcpSettingsStore} from './settings.js';
import type {PinnedResource, ResourceResult} from './resource.js';
import type {FrozenInstallPlan} from './installation.js';
import type {FreecadMcpConnection} from '../../../../shared/freecad-mcp/contracts.js';
import type {OwnedWorkerObservation} from '../../../../shared/freecad-mcp/worker.js';
import {OwnedWorkerHost} from './worker-host.js';
import {OwnedWorkerManagerError, type OwnedWorkerStartInput} from './worker-manager.js';

const roots: string[] = [];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture(options: {worker?: OwnedWorkerHost; ownedWorkerTest?: boolean; completeWorker?: boolean; platform?: NodeJS.Platform} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-mcp-manager-test-'))); roots.push(root);
  const mod = path.join(root, 'FreeCAD/Mod'); fs.mkdirSync(mod, {recursive: true});
  const entry = path.join(root, 'probe.mjs'); fs.writeFileSync(entry, '// Synthetic entry; never executed by these manager tests');
  const resource: PinnedResource = {manifestPath: path.join(root, 'release.json'), manifestSha: 'a'.repeat(64), root, version: '0.3.2', digest: 'a'.repeat(64), addonDir: options.completeWorker ? 'addon/PhoenixFreeCADTools' : 'addon', installerEntry: 'install-addon.mjs', mcpEntry: 'probe.mjs', files: {'probe.mjs': sha(fs.readFileSync(entry, 'utf8')),
    ...(options.completeWorker ? Object.fromEntries(['scripts/thumbnail-worker.mjs', 'scripts/dev-freecad.mjs', 'addon/PhoenixFreeCADTools/pft_thumbnail_worker.py'].map(name => [name, sha('independent never-executed test resource')])) : {})}};
  let resourceState: ResourceResult = {state: 'missing', version: null, reason: '未配置可信资源'};
  const store = new FreecadMcpSettingsStore(path.join(root, 'host/settings.json'));
  const frozen: FrozenInstallPlan = {preview: {state: 'ready', reason: 'synthetic', operation: 'install', source_version: resource.version, source_digest: resource.digest, target: path.join(mod, 'PhoenixFreeCADTools'), backup_parent: path.join(root, 'FreeCAD/.phoenix-freecad-tools'), changes: [{path: 'InitGui.py', kind: 'add'}]}, resource, modDir: mod, targetFingerprint: 'synthetic', operation: 'install'};
  const ready: FreecadMcpConnection = {state: 'ready', phase: 'mcp', reason: 'synthetic MCP proof', bridge_version: '0.3.2', supported_methods: ['get_status', 'list_documents'], mcp_verified: true};
  const prepare = vi.fn(async () => frozen), apply = vi.fn(async () => ({state: 'installed' as const, backup: null})), probe = vi.fn(async () => ready);
  const runtime = vi.fn(() => { throw new Error('synthetic unavailable'); });
  let now = 1_800_000_000_000;
  const manager = new FreecadMcpManager({store, resource: () => resourceState, prepare, apply, probe, runtime, now: () => now,
    worker: options.worker ?? new OwnedWorkerHost(), ownedWorkerTest: options.ownedWorkerTest ?? false, platform: options.platform ?? 'darwin',
    freeze: async (_resource, callback) => callback({root, addonDir: path.join(root, 'addon'), installerEntry: path.join(root, 'install-addon.mjs'), mcpEntry: entry})});
  const configure = (mode: 'owned_batch' | 'existing' = 'owned_batch') => manager.save({...store.read().settings, mode, mod_directory: mod, mod_directory_confirmed: true}, store.read().revision);
  return {root, mod, store, manager, prepare, apply, probe, runtime, frozen, resource, ready, configure,
    enable: () => { resourceState = {state: 'ready', version: resource.version, reason: 'synthetic approved', resource}; },
    changeResource: () => { resourceState = {state: 'invalid', version: null, reason: 'synthetic changed'}; },
    replaceResource: (value: PinnedResource) => { resourceState = {state: 'ready', version: value.version, reason: 'synthetic replaced', resource: value}; },
    advance: (ms: number) => { now += ms; }};
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
describe('FreeCAD MCP management boundaries', () => {
  it('status is read-only, defaults to owned mode and distinguishes all observations', () => {
    const f = fixture(), status = f.manager.status();
    expect(status.settings.mode).toBe('owned_batch'); expect(status.resource.state).toBe('missing');
    expect(status.freecad.state).toBe('unavailable'); expect(status.installation.state).toBe('not_checked');
    expect(status.connection.mcp_verified).toBe(false); expect(status.batch.state).toBe('blocked');
    expect(fs.existsSync(path.dirname(f.store.filename))).toBe(false);
    expect(f.probe).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });
  it('available executable is not readiness or permission to start', () => {
    const f = fixture(); f.runtime.mockImplementation(() => ({executable: '/synthetic/freecad', installationRoot: '/synthetic', templates: ''} as never));
    const status = f.manager.status(); expect(status.freecad.state).toBe('available'); expect(status.connection.mcp_verified).toBe(false);
    expect(() => f.manager.start(status.revision, true)).toThrow('暂不开放'); expect(f.probe).not.toHaveBeenCalled();
  });
  it('missing trusted resource blocks preview without importing installer', async () => {
    const f = fixture(), status = f.configure(); expect(await f.manager.preview(status.revision)).toMatchObject({state: 'blocked'});
    expect(f.prepare).not.toHaveBeenCalled(); expect(fs.readdirSync(f.mod)).toEqual([]);
  });
  it.each(['unconfirmed', 'missing', 'wrong_name', 'symlink'])('blocks install with %s Mod selection', async kind => {
    const f = fixture(); f.enable(); let mod = f.mod;
    if (kind === 'missing') mod = path.join(f.root, 'missing/Mod');
    if (kind === 'wrong_name') mod = f.root;
    if (kind === 'symlink') { mod = path.join(f.root, 'alias/Mod'); fs.mkdirSync(path.dirname(mod)); fs.symlinkSync(f.mod, mod); }
    const saved = f.manager.save({...f.store.read().settings, mod_directory: mod, mod_directory_confirmed: kind !== 'unconfirmed'}, f.store.read().revision);
    expect((await f.manager.preview(saved.revision)).state).toBe('blocked'); expect(f.prepare).not.toHaveBeenCalled();
  });
  it('never overwrites an unmanaged addon directory', async () => {
    const f = fixture(); f.enable(); fs.mkdirSync(path.join(f.mod, 'PhoenixFreeCADTools'));
    const status = f.configure(); expect(status.installation.state).toBe('unmanaged');
    expect((await f.manager.preview(status.revision)).state).toBe('blocked'); expect(f.prepare).not.toHaveBeenCalled();
  });
  it('frozen previews expire and require exact explicit confirmation', async () => {
    const f = fixture(); f.enable(); const status = f.configure(), plan = await f.manager.preview(status.revision);
    expect(plan.plan_id).toBeTruthy(); expect(plan.source_digest).toBe(f.resource.digest);
    await expect(f.manager.apply(plan.plan_id, false)).rejects.toThrow('显式确认'); expect(f.apply).not.toHaveBeenCalled();
    f.advance(300_001); await expect(f.manager.apply(plan.plan_id, true)).rejects.toThrow('过期'); expect(f.apply).not.toHaveBeenCalled();
  });
  it('successful apply consumes the plan and never starts FreeCAD or marks connected', async () => {
    const f = fixture(); f.enable(); const status = f.configure(), plan = await f.manager.preview(status.revision);
    const result = await f.manager.apply(plan.plan_id, true);
    expect(result.state).toBe('installed'); expect(result.restart_required).toBe(true); expect(result.status.connection.state).toBe('not_checked');
    await expect(f.manager.apply(plan.plan_id, true)).rejects.toThrow('已使用'); expect(f.apply).toHaveBeenCalledTimes(1); expect(f.probe).not.toHaveBeenCalled();
  });
  it('uncertain writes consume plans, return unknown and are never retried', async () => {
    const f = fixture(); f.enable(); const plan = await f.manager.preview(f.configure().revision);
    f.apply.mockRejectedValue(new Error('private provider diagnostic must not escape'));
    await expect(f.manager.apply(plan.plan_id, true)).rejects.toMatchObject({code: 'outcome_unknown', status: 503});
    await expect(f.manager.apply(plan.plan_id, true)).rejects.toThrow('已使用'); expect(f.apply).toHaveBeenCalledTimes(1);
  });
  it('saving settings invalidates plans, and changed resources block apply', async () => {
    const f = fixture(); f.enable(); const status = f.configure(), p = await f.manager.preview(status.revision);
    f.configure('existing'); await expect(f.manager.apply(p.plan_id, true)).rejects.toThrow('已使用');
    const p2 = await f.manager.preview(f.store.read().revision); f.changeResource();
    await expect(f.manager.apply(p2.plan_id, true)).rejects.toThrow('资源已变化'); expect(f.apply).not.toHaveBeenCalled();
  });
  it('discards a preview if preferences changed while preparing', async () => {
    const f = fixture(); f.enable(); const status = f.configure(); let release!: () => void;
    f.prepare.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return f.frozen; });
    const pending = f.manager.preview(status.revision); f.configure('existing'); release();
    await expect(pending).rejects.toThrow('配置或资源已变化');
  });
  it('owned mode never probes a user instance, even with trusted resource', async () => {
    const f = fixture(); f.enable(); const result = await f.manager.check(f.configure().revision);
    expect(result.state).toBe('blocked'); expect(result.mcp_verified).toBe(false); expect(f.probe).not.toHaveBeenCalled();
    expect(result.reason).toContain('Desk 专用 worker 候选'); expect(result.reason).toContain('队列接线尚未完成');
    const batch = f.manager.status().batch;
    expect(batch.state).toBe('blocked'); expect(batch.reason).toContain('Tools 已提供类型化 worker 生命周期');
    expect(batch.reason).toContain('版本化接线尚未完成'); expect(batch.reason).toContain('视觉与支持范围仍待验');
    expect(result.reason + batch.reason).not.toMatch(/当前插件尚缺|生产方尚缺|生命周期尚未具备/);
  });
  it('existing mode still requires a formal trusted entry, not just a port', async () => {
    const f = fixture(); const result = await f.manager.check(f.configure('existing').revision);
    expect(result.state).toBe('blocked'); expect(f.probe).not.toHaveBeenCalled();
  });
  it('checks an explicit existing port only via a frozen MCP resource, proof expires', async () => {
    const f = fixture(); f.enable(); const status = f.configure('existing');
    expect(await f.manager.check(status.revision)).toEqual(f.ready);
    expect(f.probe).toHaveBeenCalledWith(expect.objectContaining({port: 9876, entry_sha256: f.resource.files['probe.mjs']}));
    expect(f.manager.status().connection.mcp_verified).toBe(true); expect(f.manager.status().batch.state).toBe('blocked');
    f.advance(30_001); expect(f.manager.status().connection.state).toBe('not_checked');
  });
  it('late connection results cannot survive configuration changes or cancellation', async () => {
    const f = fixture(); f.enable(); const status = f.configure('existing'); let release!: () => void;
    f.probe.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return f.ready; });
    const pending = f.manager.check(status.revision); await Promise.resolve(); f.configure(); release();
    await expect(pending).rejects.toThrow('已取消或配置'); expect(f.manager.status().connection.mcp_verified).toBe(false);
    const controller = new AbortController(); controller.abort();
    await expect(f.manager.check(f.store.read().revision, controller.signal)).rejects.toThrow('已取消');
  });
  it('a save A to B to A still invalidates a late MCP result', async () => {
    const f = fixture(); f.enable(); const a = f.configure('existing'); let release!: () => void;
    f.probe.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return f.ready; });
    const pending = f.manager.check(a.revision); await Promise.resolve();
    f.configure('owned_batch'); const again = f.configure('existing'); expect(again.revision).toBe(a.revision);
    release(); await expect(pending).rejects.toMatchObject({code: 'check_stale'});
    expect(f.manager.status().connection.mcp_verified).toBe(false);
  });
  it('install and formal connection checks are mutually exclusive', async () => {
    const f = fixture(); f.enable(); const status = f.configure('existing'), plan = await f.manager.preview(status.revision); let release!: () => void;
    f.probe.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return f.ready; });
    const pending = f.manager.check(status.revision); await Promise.resolve();
    await expect(f.manager.apply(plan.plan_id, true)).rejects.toMatchObject({code: 'install_busy'}); expect(f.apply).not.toHaveBeenCalled();
    release(); await pending;
    await f.manager.apply(plan.plan_id, true); expect(f.manager.status().connection.state).toBe('not_checked');
  });
});

function fakeControl() {
  const id = '11111111-1111-4111-8111-111111111111';
  let observation: OwnedWorkerObservation = {schema_version: 1, id: null, phase: 'idle', reason_code: 'not_started', message: 'synthetic idle', owned: false, configuration_revision: null};
  let close!: () => void;
  const didClose = new Promise<void>(resolve => { close = resolve; });
  const start = vi.fn((input: OwnedWorkerStartInput) => {
    observation = {...observation, id, phase: 'starting', reason_code: 'launching', owned: true, configuration_revision: input.configurationRevision};
    return {...observation};
  });
  const stop = vi.fn(async (requested: string) => {
    if (requested !== observation.id) throw new OwnedWorkerManagerError('session_not_current');
    observation = {...observation, phase: 'stopping', reason_code: 'stop_requested'};
    await didClose;
    observation = {...observation, phase: 'stopped', reason_code: 'stopped_after_owned_close', owned: false};
    return {...observation};
  });
  const host = new OwnedWorkerHost({start, stop, status: () => ({...observation})});
  return {host, start, stop, id, close, phase: (phase: OwnedWorkerObservation['phase']) => { observation = {...observation, phase}; }};
}
function ownedFixture(options: {gate?: boolean; complete?: boolean; platform?: NodeJS.Platform} = {}) {
  const control = fakeControl(), f = fixture({worker: control.host, ownedWorkerTest: options.gate ?? true, completeWorker: options.complete ?? true, platform: options.platform});
  f.enable(); f.runtime.mockImplementation(() => ({executable: '/synthetic/raw-freecad-gui', installationRoot: '/synthetic', templates: ''} as never));
  return {...f, control};
}
describe('host-gated M0 owned worker controls, without Native', () => {
  it('enables only a complete pinned candidate and explicit host gate, without needing user Mod selection', () => {
    const f = ownedFixture(), status = f.manager.status();
    expect(status.mod_directory.state).toBe('unselected'); expect(status.owned_worker?.enabled).toBe(true);
    expect(status.owned_worker?.observation.phase).toBe('idle'); expect(status.batch.state).toBe('blocked');
    expect(f.control.start).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled();
    for (const settings of [{gate: false}, {complete: false}, {platform: 'linux' as const}]) {
      const disabled = ownedFixture(settings); expect(disabled.manager.status().owned_worker?.enabled).toBe(false);
      expect(() => disabled.manager.start(disabled.store.read().revision, true)).toThrow(); expect(disabled.control.start).not.toHaveBeenCalled();
    }
  });
  it('requires explicit confirmation and owned mode; never adopts an existing instance', () => {
    const f = ownedFixture(), revision = f.store.read().revision;
    expect(() => f.manager.start(revision, false)).toThrow(expect.objectContaining({code: 'confirmation_required'}));
    const existing = f.configure('existing');
    expect(f.manager.status().owned_worker?.enabled).toBe(false);
    expect(() => f.manager.start(existing.revision, true)).toThrow('不会接管');
    expect(f.control.start).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled();
  });
  it('starts once in the background and fixes host-owned inputs to configuration, resource and GUI', () => {
    const f = ownedFixture(), revision = f.store.read().revision, started = f.manager.start(revision, true);
    expect(started).toMatchObject({phase: 'starting', owned: true, id: f.control.id});
    const input = f.control.start.mock.calls[0][0];
    expect(input.resource).toBe(f.resource); expect(input.executable).toBe('/synthetic/raw-freecad-gui');
    expect(input.configurationRevision).toMatch(/^[a-f0-9]{64}$/); expect(input.configurationRevision).not.toBe(revision);
    expect(() => f.manager.start(revision, true)).toThrow(expect.objectContaining({code: 'owned_worker_busy'}));
    for (let i = 0; i < 3; i++) f.manager.status();
    expect(f.control.start).toHaveBeenCalledOnce(); expect(f.probe).not.toHaveBeenCalled();
  });
  it.each(['starting', 'ready', 'leased', 'stopping', 'unknown'] as const)('retains mutual exclusion throughout owned %s', async phase => {
    const f = ownedFixture(), revision = f.store.read().revision; f.manager.start(revision, true); f.control.phase(phase);
    expect(() => f.manager.save(f.store.read().settings, revision)).toThrow(expect.objectContaining({code: 'owned_worker_busy'}));
    await expect(f.manager.preview(revision)).rejects.toMatchObject({code: 'owned_worker_busy'});
    await expect(f.manager.apply('not-a-plan', true)).rejects.toMatchObject({code: 'owned_worker_busy'});
    await expect(f.manager.check(revision)).rejects.toMatchObject({code: 'owned_worker_busy'});
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.probe).not.toHaveBeenCalled();
  });
  it.each(['resource', 'settings', 'runtime'])('invalidates old readiness after an observed %s change, even if changed back', async change => {
    const f = ownedFixture(), revision = f.store.read().revision; f.manager.start(revision, true); f.control.phase('ready');
    if (change === 'resource') f.replaceResource({...f.resource, digest: 'b'.repeat(64)});
    if (change === 'settings') f.store.save({...f.store.read().settings, existing_port: 19991}, revision);
    if (change === 'runtime') f.runtime.mockImplementation(() => ({executable: '/synthetic/different-gui'} as never));
    expect(f.manager.status().owned_worker).toMatchObject({enabled: false, observation: {id: f.control.id, owned: true, phase: 'unknown'}});
    f.enable();
    if (change === 'settings') f.store.save({...f.store.read().settings, existing_port: 9876}, f.store.read().revision);
    f.runtime.mockImplementation(() => ({executable: '/synthetic/raw-freecad-gui'} as never));
    expect(f.manager.status().owned_worker?.observation.phase).toBe('unknown');
    const stopped = f.manager.stop(f.control.id, true); f.control.close();
    expect(await stopped).toMatchObject({phase: 'stopped', owned: false}); expect(f.control.start).toHaveBeenCalledOnce();
  });
  it('can stop its UUID after resource/config corruption, and cannot stop PID/URL/another UUID', async () => {
    const f = ownedFixture(); f.manager.start(f.store.read().revision, true);
    for (const id of ['12345', 'http://127.0.0.1:19991', '/synthetic/gui']) await expect(f.manager.stop(id, true)).rejects.toMatchObject({code: 'invalid_session_id'});
    await expect(f.manager.stop('22222222-2222-4222-8222-222222222222', true)).rejects.toMatchObject({code: 'session_not_current'});
    await expect(f.manager.stop(f.control.id, false)).rejects.toMatchObject({code: 'confirmation_required'});
    f.changeResource(); fs.mkdirSync(path.dirname(f.store.filename), {recursive: true}); fs.writeFileSync(f.store.filename, '{invalid');
    let settled = false; const stopping = f.manager.stop(f.control.id, true).then(value => { settled = true; return value; });
    await Promise.resolve(); expect(settled).toBe(false); f.control.close();
    expect(await stopping).toMatchObject({owned: false, phase: 'stopped'});
  });
  it('refuses start while an install preview is preparing and during host shutdown', async () => {
    const f = ownedFixture(), revision = f.configure().revision; let release!: () => void;
    f.prepare.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return f.frozen; });
    const preview = f.manager.preview(revision);
    expect(() => f.manager.start(revision, true)).toThrow(expect.objectContaining({code: 'owned_worker_busy'})); release(); await preview;
    await f.control.host.close();
    expect(f.manager.status().owned_worker?.enabled).toBe(false);
    expect(() => f.manager.start(revision, true)).toThrow('正在退出'); expect(f.control.start).not.toHaveBeenCalled();
  });
  it('reports unknown close as typed 503 and never enables another lifetime', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    let observed: OwnedWorkerObservation = {schema_version: 1, id, phase: 'ready', reason_code: 'worker_ready', message: 'synthetic', owned: true, configuration_revision: 'b'.repeat(64)};
    const start = vi.fn(), stop = vi.fn(async () => {
      observed = {...observed, phase: 'unknown', reason_code: 'cleanup_failed', owned: false}; return {...observed};
    });
    const worker = new OwnedWorkerHost({status: () => ({...observed}), start, stop});
    const f = fixture({worker, ownedWorkerTest: true, completeWorker: true}); f.enable();
    f.runtime.mockImplementation(() => ({executable: '/synthetic/raw-gui'} as never));
    await expect(f.manager.stop(id, true)).rejects.toMatchObject({code: 'owned_worker_close_unknown', status: 503});
    expect(f.manager.status().owned_worker).toMatchObject({enabled: false, observation: {id, phase: 'unknown', owned: false}});
    expect(() => f.manager.start(f.store.read().revision, true)).toThrow('关闭结果未确认'); expect(start).not.toHaveBeenCalled();
  });
});
