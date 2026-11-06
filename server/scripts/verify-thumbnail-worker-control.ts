/** Isolated native control proof. No existing workspace, CAD, URL, PID, profile,
 * resource path or command is accepted as an argument. Candidate inputs belong
 * only to this explicitly opted-in process; receipts stay outside the repo. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import type {FreecadMcpStatus} from '../../shared/freecad-mcp/contracts.js';
import type {OwnedWorkerObservation} from '../../shared/freecad-mcp/worker.js';
import {loadPinnedResource} from '../src/features/freecad-mcp/resource.js';
import {createFreecadMcpRoutes} from '../src/features/freecad-mcp/routes.js';
import {FreecadMcpManager} from '../src/features/freecad-mcp/service.js';
import {FreecadMcpSettingsStore} from '../src/features/freecad-mcp/settings.js';
import {OwnedWorkerSessionManager} from '../src/features/freecad-mcp/worker-manager.js';
import {OwnedWorkerHost, closeFreecadHostServices} from '../src/features/freecad-mcp/worker-host.js';
import {withOwnedThumbnailWorker} from '../src/features/freecad-mcp/worker-session.js';
import {resolveFreecadGuiRuntime} from '../src/lib/freecadGuiRuntime.js';
import {configureDrawingExecutionBarrier} from '../src/features/drawing-research/executionGate.js';
import {deskToolsRegistrationDirectory} from '../src/lib/deskToolsRegistration.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const SOURCES = ['server/scripts/verify-thumbnail-worker-control.ts', 'shared/freecad-mcp/contracts.ts', 'shared/freecad-mcp/worker.ts',
  ...['routes', 'service', 'settings', 'resource', 'worker-host', 'worker-manager', 'worker-session', 'worker-client', 'worker-png']
    .map(name => `server/src/features/freecad-mcp/${name}.ts`),
  'server/src/lib/freecadGuiRuntime.ts', 'server/src/lib/appRuntimePaths.ts', 'server/src/lib/deskToolsRegistration.ts',
  'server/src/features/drawing-research/executionGate.ts',
  'server/src/features/cad-native-measurement/host-barrier.ts'];
function sourceHashes() {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  return Object.fromEntries(SOURCES.map(rel => [rel, hash(fs.readFileSync(path.join(repo, rel)))]));
}
function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error('Isolated worker control not verified'), {code});
}

export async function verifyThumbnailWorkerControl() {
  assert(process.argv.slice(2).join(' ') === '--allow-native', 'explicit_native_required');
  assert(process.env.PHOENIX_FREECAD_MCP_OWNED_WORKER_TEST === '1'
    && process.env.PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST && process.env.PHOENIX_FREECAD_MCP_RESOURCE_SHA256, 'explicit_candidate_required');
  assert(!process.env.PHOENIX_DESK_TOOLS_REGISTRY_DIR && os.homedir() === os.userInfo().homedir, 'normal_host_scope_required');
  const sources = sourceHashes(), loaded = loadPinnedResource();
  assert(loaded.state === 'ready', 'candidate_not_verified');
  const runtime = resolveFreecadGuiRuntime();
  // Exactly the normal host scope: a stale reservation is a blocker, not a
  // reason to choose a private namespace or clear another process's gate.
  configureDrawingExecutionBarrier(path.join(deskToolsRegistrationDirectory(), 'native-freecad-v1'));
  const artifact = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-worker-control-proof-')));
  fs.chmodSync(artifact, 0o700);
  const store = new FreecadMcpSettingsStore(path.join(artifact, 'preferences', 'freecad-mcp-settings.json'));
  const checks: Record<string, boolean> = {}, observations: OwnedWorkerObservation[] = [];
  const closed: Array<{kind: string; pid: number | null; resource_present: boolean}> = [];
  let frozenRoot = '', nativePid: number | null = null;
  const owner = new OwnedWorkerSessionManager({
    createProfileParent: () => { const parent = path.join(artifact, 'claim'); fs.mkdirSync(parent, {mode: 0o700}); return parent; },
    withOwned: (input, operation) => withOwnedThumbnailWorker(input, async session => {
      nativePid = session.identity.nativePid;
      frozenRoot = path.dirname(path.dirname(fs.realpathSync(path.join(input.profile, 'Mod', 'PhoenixFreeCADTools'))));
      return await operation(session);
    }, {onChildClose: (kind, proof) => { closed.push({kind, ...proof, resource_present: !!frozenRoot && fs.existsSync(frozenRoot)}); }}),
  });
  const host = new OwnedWorkerHost(owner);
  const deps = {store, resource: () => loadPinnedResource({
    PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST: loaded.resource.manifestPath,
    PHOENIX_FREECAD_MCP_RESOURCE_SHA256: loaded.resource.manifestSha,
  }), runtime: () => runtime, worker: host};
  const app = createFreecadMcpRoutes(new FreecadMcpManager({...deps, ownedWorkerTest: true}));
  const disabled = createFreecadMcpRoutes(new FreecadMcpManager({...deps, ownedWorkerTest: false}));
  const post = (route: string, body: unknown) => app.request(route, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const status = async (): Promise<FreecadMcpStatus> => {
    const response = await app.request('/status'); assert(response.status === 200, 'status_failed'); return await response.json() as FreecadMcpStatus;
  };
  let failure: unknown;
  try {
    const initial = await status();
    checks.readonly_open_does_not_start_or_write_preferences = initial.owned_worker?.observation.phase === 'idle'
      && !initial.owned_worker.observation.owned && !fs.existsSync(path.dirname(store.filename)) && !fs.existsSync(path.join(artifact, 'claim'));
    assert(initial.owned_worker?.enabled && initial.settings.mode === 'owned_batch' && initial.settings.mod_directory === '', 'worker_control_not_enabled');
    const blocked = await disabled.request('/instance/start', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: initial.revision, confirmed: true})});
    checks.default_disabled_cannot_launch = blocked.status === 409 && owner.status().phase === 'idle';
    checks.unconfirmed_start_rejected = (await post('/instance/start', {revision: initial.revision, confirmed: false})).status === 400;
    const started = await post('/instance/start', {revision: initial.revision, confirmed: true});
    assert(started.status === 202, 'start_not_accepted');
    const first = await started.json() as OwnedWorkerObservation; observations.push(first);
    assert(first.phase === 'starting' && first.owned && first.id, 'start_identity_missing');
    checks.start_returns_starting_before_ready = first.phase === 'starting';
    checks.repeated_start_is_rejected = (await post('/instance/start', {revision: initial.revision, confirmed: true})).status === 409;
    const deadline = Date.now() + 120_000;
    for (;;) {
      const current = (await status()).owned_worker?.observation;
      assert(current && current.id === first.id, 'observation_identity_changed');
      observations.push(current);
      if (current.phase === 'ready') break;
      assert(current.owned && current.phase === 'starting', 'worker_not_ready');
      assert(Date.now() < deadline, 'ready_observation_timeout');
      await delay(500);
    }
    checks.native_ready_observed_with_same_manager_identity = owner.status().phase === 'ready' && nativePid !== null;
    checks.batch_still_blocked = (await status()).batch.state === 'blocked';
    checks.stop_rejects_unconfirmed_request = (await post('/instance/stop', {id: first.id, confirmed: false})).status === 400 && owner.status().owned;
    const stopped = await post('/instance/stop', {id: first.id, confirmed: true});
    assert(stopped.status === 200, 'stop_not_confirmed');
    const last = await stopped.json() as OwnedWorkerObservation; observations.push(last);
    checks.stop_response_only_after_both_actual_closes = last.phase === 'stopped' && last.id === first.id && !last.owned
      && closed.length === 2 && closed[0].kind === 'mcp' && closed[1].kind === 'native' && closed[1].pid === nativePid;
    checks.resource_remains_at_both_close_events = closed.length === 2 && closed.every(value => value.resource_present);
    checks.resource_released_after_both_closes = !!frozenRoot && !fs.existsSync(frozenRoot);
    // There are deliberately no file/job endpoints in this proof. Absence of
    // this private settings file is not a claim to have hashed every host CAD.
    checks.private_preferences_not_created = !fs.existsSync(path.dirname(store.filename));
    checks.stop_same_identity_is_metadata_only = (await post('/instance/stop', {id: first.id, confirmed: true})).status === 200 && closed.length === 2;
    let batchClosed = false;
    await closeFreecadHostServices(async () => { batchClosed = true; }, host);
    checks.shutdown_closes_admission_and_joins_services = batchClosed && host.stopping
      && (await post('/instance/start', {revision: initial.revision, confirmed: true})).status === 409;
  } catch (error) { failure = error; }
  finally {
    try { await host.close(); } catch (error) { failure ??= error; }
  }
  checks.production_sources_unchanged = JSON.stringify(sources) === JSON.stringify(sourceHashes());
  const failedChecks = Object.keys(checks).filter(key => !checks[key]);
  const receipt = {state: !failure && failedChecks.length === 0 ? 'passed' : 'blocked',
    resource: {digest: loaded.resource.digest, version: loaded.version}, sources, checks, failed_checks: failedChecks, observations, closed,
    code: String((failure as {code?: string})?.code ?? (failure || failedChecks.length ? 'control_unverified' : 'verified'))};
  const fd = fs.openSync(path.join(artifact, 'control.json'), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(receipt, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (receipt.state !== 'passed') throw Object.assign(new Error('Isolated worker control not verified'), {code: 'control_unverified', artifact: path.basename(artifact)});
  return {state: receipt.state, checks, artifact: path.basename(artifact)};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--allow-native') {
    console.error('Explicit --allow-native, candidate gate and pinned resource environment are required. No existing CAD input is accepted.'); process.exitCode = 2;
  } else verifyThumbnailWorkerControl().then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = String(error?.code ?? 'control_unverified'), artifact = String(error?.artifact ?? '');
    console.error(JSON.stringify({state: 'blocked', code: /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(code) ? code : 'control_unverified',
      artifact: /^desk-worker-control-proof-[A-Za-z0-9-]+$/.test(artifact) ? artifact : null})); process.exitCode = 1;
  });
}
