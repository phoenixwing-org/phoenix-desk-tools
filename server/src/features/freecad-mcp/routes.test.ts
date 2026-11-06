import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createFreecadMcpRoutes} from './routes.js';
import {FreecadMcpManager} from './service.js';
import {FreecadMcpError, FreecadMcpSettingsStore} from './settings.js';
import {OwnedWorkerHost} from './worker-host.js';
import {OwnedWorkerSessionManager} from './worker-manager.js';
import type {OwnedThumbnailWorkerSession, withOwnedThumbnailWorker} from './worker-session.js';
import type {ThumbnailWorkerClient} from './worker-client.js';
import type {PinnedResource} from './resource.js';
const roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-mcp-routes-test-'))); roots.push(root);
  const store = new FreecadMcpSettingsStore(path.join(root, 'host/settings.json'));
  const manager = new FreecadMcpManager({store, resource: () => ({state: 'missing', version: null, reason: '未配置可信资源'}), runtime: () => { throw new Error('unavailable'); }});
  const app = createFreecadMcpRoutes(manager);
  const post = (route: string, body: unknown, method = 'POST') => app.request(route, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  return {app, manager, store, post};
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
describe('FreeCAD MCP HTTP contract', () => {
  it('status GET is read-only, then explicit save uses revision', async () => {
    const f = fixture(), first = await f.app.request('/status'), status = await first.json();
    expect(first.status).toBe(200); expect(status.settings.mode).toBe('owned_batch'); expect(fs.existsSync(path.dirname(f.store.filename))).toBe(false);
    const saved = await f.post('/settings', {settings: {...status.settings, mode: 'existing'}, expected_revision: status.revision}, 'PUT');
    expect(saved.status).toBe(200); expect((await saved.json()).settings.mode).toBe('existing');
    expect((await f.post('/install/preview', {revision: f.store.read().revision})).status).toBe(200);
  });
  it.each(['/install/preview', '/install/apply', '/connection/check', '/instance/start', '/instance/stop', '/settings'])('refuses executable/path/script authority at %s', async route => {
    const f = fixture(), result = await f.post(route, {revision: f.store.read().revision, command: 'arbitrary', resource_path: '/untrusted/entry.mjs'}, route === '/settings' ? 'PUT' : 'POST');
    expect(result.status).toBe(400); expect((await result.json()).code).toBe('invalid_request');
  });
  it('requires JSON and a bounded valid body', async () => {
    const f = fixture(); expect((await f.app.request('/connection/check', {method: 'POST', body: '{}'})).status).toBe(400);
    const malformed = await f.app.request('/connection/check', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'});
    expect(malformed.status).toBe(400); expect((await malformed.json()).code).toBe('invalid_json');
    expect((await f.app.request('/connection/check', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: ' '.repeat(32769)})).status).toBe(413);
  });
  it('start remains blocked and errors never expose provider diagnostics', async () => {
    const f = fixture(), start = await f.post('/instance/start', {revision: f.store.read().revision, confirmed: true});
    expect(start.status).toBe(409); expect((await start.json()).code).toBe('missing_task_lifecycle');
    vi.spyOn(f.manager, 'preview').mockRejectedValue(new Error('/private/synthetic/secrets must not appear'));
    const result = await f.post('/install/preview', {revision: f.store.read().revision});
    expect(result.status).toBe(500); expect(await result.text()).not.toContain('secrets');
  });
  it('uncertain install results are explicit, not automatically replayed', async () => {
    const f = fixture(), apply = vi.spyOn(f.manager, 'apply').mockRejectedValue(new FreecadMcpError('outcome_unknown', '请重新检测，不自动重试', 503));
    const response = await f.post('/install/apply', {plan_id: 'synthetic', confirmed: true});
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({execution_state: 'unknown'}); expect(apply).toHaveBeenCalledTimes(1);
  });
  it('accepts only explicit start/stop controls and holds HTTP stop through fake actual-close proof', async () => {
    const f = fixture(), parent = path.join(path.dirname(f.store.filename), 'profile-parent'); fs.mkdirSync(parent, {recursive: true, mode: 0o700});
    let actualClose!: () => void; const closed = new Promise<void>(resolve => { actualClose = resolve; });
    let launched = 0;
    const factory: typeof withOwnedThumbnailWorker = async <T>(input: Parameters<typeof withOwnedThumbnailWorker>[0], operation: (session: OwnedThumbnailWorkerSession) => Promise<T>): Promise<T> => {
      ++launched;
      const identity = {workerId: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222', nativePid: 56789, url: 'http://127.0.0.1:19992/'};
      const client: ThumbnailWorkerClient = {status: vi.fn(), render: vi.fn(), get: vi.fn(), cancel: vi.fn()};
      try { return await operation({identity, client, signal: input.signal!}); } finally { await closed; }
    };
    const worker = new OwnedWorkerHost(new OwnedWorkerSessionManager({withOwned: factory, createProfileParent: () => parent}));
    const resource: PinnedResource = {manifestPath: '/synthetic/pinned.json', manifestSha: 'a'.repeat(64), root: '/synthetic/pinned', version: '0.3.2', digest: 'a'.repeat(64), addonDir: 'addon/PhoenixFreeCADTools', installerEntry: 'scripts/install-addon.mjs', mcpEntry: 'dist/worker.mjs',
      files: Object.fromEntries(['dist/worker.mjs', 'scripts/thumbnail-worker.mjs', 'scripts/dev-freecad.mjs', 'addon/PhoenixFreeCADTools/pft_thumbnail_worker.py'].map(name => [name, 'b'.repeat(64)]))};
    const manager = new FreecadMcpManager({store: f.store, worker, ownedWorkerTest: true, platform: 'darwin', resource: () => ({state: 'ready', version: resource.version, reason: 'synthetic pin', resource}), runtime: () => ({executable: '/synthetic/raw-gui', installationRoot: '/synthetic', templates: ''})});
    const app = createFreecadMcpRoutes(manager), post = (route: string, body: unknown) => app.request(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const revision = f.store.read().revision;
    expect((await post('/instance/start', {revision, confirmed: false})).status).toBe(400);
    expect((await post('/instance/start', {revision, confirmed: true, file: '/synthetic/File.FCStd'})).status).toBe(400);
    const response = await post('/instance/start', {revision, confirmed: true}), started = await response.json();
    expect(response.status).toBe(202); expect(started).toMatchObject({phase: 'starting', owned: true}); expect(started.id).toMatch(/^[a-f0-9-]{36}$/);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect((await post('/instance/start', {revision, confirmed: true})).status).toBe(409); expect(launched).toBe(1);
    expect((await post('/instance/stop', {id: 56789, confirmed: true})).status).toBe(400);
    expect((await post('/instance/stop', {id: started.id, confirmed: false})).status).toBe(400);
    expect((await post('/instance/stop', {id: started.id, confirmed: true, url: 'http://127.0.0.1:19992/'})).status).toBe(400);
    let settled = false;
    const stopping = Promise.resolve(post('/instance/stop', {id: started.id, confirmed: true})).then(value => { settled = true; return value; });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(settled).toBe(false);
    const observed = await (await app.request('/status')).json();
    expect(observed.owned_worker.observation).toMatchObject({phase: 'stopping', owned: true, id: started.id}); expect(observed.batch.state).toBe('blocked');
    expect(JSON.stringify(observed.owned_worker)).not.toMatch(/56789|19992|11111111|22222222/);
    actualClose(); const stopped = await stopping;
    expect(stopped.status).toBe(200); expect(await stopped.json()).toMatchObject({phase: 'stopped', owned: false, id: started.id});
    expect(launched).toBe(1);
    expect((await post('/worker/render', {file: '/synthetic/File.FCStd'})).status).toBe(404);
  });
  it('returns typed 503 rather than successful stop for an unconfirmed owned close', async () => {
    const f = fixture();
    vi.spyOn(f.manager, 'stop').mockRejectedValue(new FreecadMcpError('owned_worker_close_unknown', '关闭结果未确认，不重启', 503));
    const result = await f.post('/instance/stop', {id: '33333333-3333-4333-8333-333333333333', confirmed: true});
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({code: 'owned_worker_close_unknown'});
  });
});
