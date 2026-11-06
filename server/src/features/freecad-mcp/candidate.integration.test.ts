import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {createFreecadMcpRoutes} from './routes.js';
import {FreecadMcpManager} from './service.js';
import {FreecadMcpSettingsStore} from './settings.js';
import {loadPinnedResource, type PinnedResource} from './resource.js';

// Explicit opt-in only. No artifact location, digest or producer sample is kept
// in Git; CI/default tests never execute a host-provided release candidate.
const enabled = process.env.PHOENIX_FREECAD_MCP_CANDIDATE_TEST === '1';
const roots: string[] = [];
const bridges: http.Server[] = [];
function fixture() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('候选联调需要现有 Node 22 或更高版本；不会自动安装');
  const resource = loadPinnedResource({
    PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST: process.env.PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST,
    PHOENIX_FREECAD_MCP_RESOURCE_SHA256: process.env.PHOENIX_FREECAD_MCP_RESOURCE_SHA256,
  });
  if (resource.state !== 'ready') throw new Error('候选联调需显式提供已核验的本地清单及固定摘要');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-mcp-candidate-test-'))); roots.push(root);
  const mod = path.join(root, 'SyntheticFreeCAD/Mod'); fs.mkdirSync(mod, {recursive: true});
  const store = new FreecadMcpSettingsStore(path.join(root, 'host/preferences.json'));
  const manager = new FreecadMcpManager({store, resource: () => loadPinnedResource({
    PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST: resource.resource.manifestPath,
    PHOENIX_FREECAD_MCP_RESOURCE_SHA256: resource.resource.manifestSha,
  }), runtime: () => { throw new Error('No native executable in this synthetic integration'); }});
  const app = createFreecadMcpRoutes(manager);
  const post = async (route: string, value: unknown) => app.request(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
  async function configure(mode: 'owned_batch' | 'existing', port = 9876) {
    const old = store.read();
    const result = await app.request('/settings', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      expected_revision: old.revision, settings: {mode, mod_directory: mod, mod_directory_confirmed: true, existing_port: port},
    })});
    expect(result.status).toBe(200); return result.json();
  }
  return {root, mod, store, app, post, configure, resource: resource.resource};
}
async function syntheticBridge(resource: PinnedResource) {
  const requests: unknown[] = []; let protocol = 1;
  const server = http.createServer(async (request, response) => {
    let bytes = 0; const chunks: Buffer[] = [];
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 16_384) { response.writeHead(413).end(); return; } chunks.push(Buffer.from(chunk)); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400).end(); return; }
    requests.push({method: request.method, path: request.url, body});
    if (request.method !== 'POST' || request.url !== '/rpc' || JSON.stringify(body) !== JSON.stringify({method: 'get_status', params: {}})) {
      response.writeHead(400).end(); return;
    }
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic bridge address missing');
    response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({ok: true, data: {
      protocol_version: protocol, addon_name: 'PhoenixFreeCADTools', addon_version: resource.version,
      running: true, stopping: false, host: '127.0.0.1', port: address.port,
      supported_methods: ['get_status', 'list_documents'], gui_dispatch: {state: 'idle', job_id: 0, operation: '', running_seconds: 0},
    }}));
  });
  bridges.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic bridge address missing');
  expect(address.port).not.toBe(9876);
  return {port: address.port, requests, mismatch: () => { protocol = 2; }};
}
afterEach(async () => {
  for (const server of bridges.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});
});

describe.runIf(enabled)('explicit host-pinned MCP candidate integration', () => {
  it('observes and previews real installer material without an installation or native launch', async () => {
    const f = fixture(), status = await f.app.request('/status'); expect(status.status).toBe(200);
    expect((await status.json()).resource).toMatchObject({state: 'ready', version: '0.3.2'});
    expect(fs.existsSync(path.dirname(f.store.filename))).toBe(false);
    const saved = await f.configure('owned_batch'), response = await f.post('/install/preview', {revision: saved.revision});
    expect(response.status).toBe(200); const plan = await response.json();
    expect(plan).toMatchObject({state: 'ready', operation: 'install', source_version: '0.3.2'});
    expect(plan.changes.length).toBeGreaterThan(0); expect(plan.changes.every((change: {kind: string}) => change.kind === 'add')).toBe(true);
    expect(fs.readdirSync(f.mod)).toEqual([]); expect(fs.existsSync(plan.backup_parent)).toBe(false);
    expect((await f.post('/install/apply', {plan_id: plan.plan_id, confirmed: false})).status).toBe(400);
    expect(fs.readdirSync(f.mod)).toEqual([]);
    expect((await f.post('/instance/start', {revision: saved.revision, confirmed: true})).status).toBe(409);
  });
  it('uses the frozen bundled entry only against a private synthetic bridge and rejects bad protocol', async () => {
    const f = fixture(), bridge = await syntheticBridge(f.resource);
    const owned = await f.configure('owned_batch', bridge.port);
    expect((await (await f.post('/connection/check', {revision: owned.revision})).json()).state).toBe('blocked');
    expect(bridge.requests).toEqual([]);
    const existing = await f.configure('existing', bridge.port);
    const good = await f.post('/connection/check', {revision: existing.revision}); expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({state: 'ready', phase: 'mcp', bridge_version: '0.3.2', mcp_verified: true});
    bridge.mismatch();
    const bad = await f.post('/connection/check', {revision: existing.revision}); expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({state: 'failed', mcp_verified: false});
    expect((await (await f.app.request('/status')).json()).batch.state).toBe('blocked');
    expect(bridge.requests).toEqual([0, 1].map(() => ({method: 'POST', path: '/rpc', body: {method: 'get_status', params: {}}})));
    expect(fs.readdirSync(f.mod)).toEqual([]);
  });
});
