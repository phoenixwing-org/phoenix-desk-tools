import {installPrivateNativeGateForTest} from "../../../test-support/native-gate.js";
installPrivateNativeGateForTest();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {spawn, type SpawnOptions} from 'node:child_process';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {acquireDrawingExecution} from '../drawing-research/executionGate.js';
import {prepareSingleFeatureManifest, extractSavedShapeSnapshot, canonicalSingleFeatureManifestPayload, type NativeMeasurementProfile, type SingleFeatureManifest} from './manifest.js';
import {measureSingleFeature, measureSavedBrepSnapshot, SAVED_BREP_SNAPSHOT_IDENTITY, NATIVE_MEASUREMENT_IDENTITY, NativeMeasurementError,
  bindNativeTaskTicket,type FrozenNativeEngine, type NativeMeasurementContext, type NativeSpawnProof,type NativeTaskExecutionTicket} from './runner.js';
import {compileNativePreparedStepV3,compilePreparedNativeTicketV3,canonicalNativeProfileV3Payload,canonicalPreparedNativeTicketV3Payload} from '../../../../shared/batch-tasks/native-protocol.js';

vi.mock('node:child_process', async original => {
  const actual=await original<typeof import('node:child_process')>(),mock=vi.fn();
  return {...actual,spawn:mock,default:{...actual,spawn:mock}};
});
vi.mock('./manifest.js', () => ({prepareSingleFeatureManifest: vi.fn(), extractSavedShapeSnapshot: vi.fn(),
  canonicalSingleFeatureManifestPayload: (manifest: Record<string, unknown>) => {
    const {manifest_sha256: _digest, ...payload} = manifest; return JSON.stringify(payload);
  }}));

const roots: string[] = [];
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Fixture = {root: string; source: string; original: Buffer; shape: Buffer; engine: FrozenNativeEngine; manifest: SingleFeatureManifest};
function fixture(profile: NativeMeasurementProfile = 'restored_document'): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-port-unit-'))); roots.push(root);
  const rel = 'parts/PublicSolid.FCStd', source = path.join(root, rel), original = Buffer.from('independently constructed inert saved-shape fixture; never opened by Native');
  fs.mkdirSync(path.dirname(source)); fs.writeFileSync(source, original);
  const command = path.join(root, 'freecadcmd'), binary = 'inert fake executable; mocked spawn only'; fs.writeFileSync(command, binary, {mode: 0o700});
  const engine: FrozenNativeEngine = {command, bytes: Buffer.byteLength(binary), sha256: sha(binary), app_version: ['1','1','0'], occ_version: '7.8.1'};
  const shape = Buffer.from('synthetic shape'), snapshot = profile === 'saved_brep_snapshot';
  const payload: Omit<SingleFeatureManifest, 'manifest_sha256'> = {schema_version: 1, algorithm_version: 'single-feature-saved-manifest-v2', measurement_profile: profile,
    source: {rel, bytes: original.byteLength, sha256: sha(original)}, document_xml: {bytes: 12, sha256: sha('synthetic xml')},
    entity: {node: 'PublicSolid', type_id: 'Part::Feature', shape_property: 'Shape', shape_property_type: 'Part::PropertyPartShape'},
    shape: {basis: 'serialized_shape_snapshot', member_path: 'PartShape.brp', bytes: shape.length, sha256: sha(shape), crc32: '00000001', compression: 'stored'},
    dependencies: [], dependency_check: snapshot ? 'strict_saved_shape_carrier_v1' : 'strict_self_contained_single_feature_v1',
    dependency_scope: snapshot ? 'saved_shape_carrier' : 'restored_document_structure', engine_asset_dependencies: 'not_attested',
    material: {uuid_raw: snapshot ? '11111111-2222-4333-8444-555555555555' : '00000000-0000-0000-0000-000000000000',
      state: snapshot ? 'unresolved_metadata_only' : 'nil', resolution_performed: false, density_kg_m3: null, mass_kg: null},
    restored_document: {verified: false}, native_executed: false};
  const manifest: SingleFeatureManifest = {...payload, manifest_sha256: sha(JSON.stringify(payload))};
  vi.mocked(prepareSingleFeatureManifest).mockResolvedValue({status: 'ready', manifest: structuredClone(manifest)});
  vi.mocked(extractSavedShapeSnapshot).mockResolvedValue({status: 'ready', manifest: structuredClone(manifest), shape: Buffer.from(shape)});
  return {root, source, original, shape, engine, manifest};
}
function context(options: Partial<NativeMeasurementContext> = {}) {
  return {onSpawn: vi.fn<NativeMeasurementContext['onSpawn']>(), onClose: vi.fn<NativeMeasurementContext['onClose']>(), ...options};
}
function taskTicket(f:Fixture){
  const profile={key:'freecad.saved-brep-snapshot',version:1,measurement_profile:'saved_brep_snapshot',algorithm_version:'saved-brep-snapshot-native-bounds-v1',
    script_sha256:SAVED_BREP_SNAPSHOT_IDENTITY.script_sha256,engine:{key:'freecadcmd',bytes:f.engine.bytes,sha256:f.engine.sha256,app_version:[...f.engine.app_version],occ_version:f.engine.occ_version},timeout_ms:120000};
  const step=compileNativePreparedStepV3({step_id:'step_test',item_id:'item_test',subject:{kind:'file',rel:f.manifest.source.rel,node:f.manifest.entity.node},manifest:f.manifest,profile,profile_sha256:sha(canonicalNativeProfileV3Payload(profile))});
  const binding={attempt_id:'attempt_test',run_id:'run_test',step_id:step.step_id,plan_digest:'8'.repeat(64),host_id:'public_test_host',session_nonce:'session_test',child_nonce:'child_test_nonce',prepared_at:'2026-01-01T00:00:00.000Z',
    profile:{key:profile.key,version:1},profile_sha256:step.profile_sha256,script_sha256:profile.script_sha256,engine_sha256:f.engine.sha256,source_manifest_sha256:f.manifest.manifest_sha256,result_schema_version:1,expected_item_ids:[step.item_id]};
  return compilePreparedNativeTicketV3({binding,step,execution_digest_claim:sha(canonicalPreparedNativeTicketV3Payload({binding,step}))});
}
type Native = {
  child: EventEmitter & {pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>};
  command: string; args: string[]; options: SpawnOptions; folder: string; script: string;
  job: {proof: Omit<NativeSpawnProof, 'owned_pid'>; source: {bytes: number; sha256: string}; shape: {bytes: number; sha256: string}; node: string; app_version: string[]; occ_version: string};
};
function nativeProcess(run: (native: Native) => void, killCloses = true) {
  const launches: Native[] = [];
  vi.mocked(spawn).mockImplementation((...arguments_: unknown[]) => {
    const child = Object.assign(new EventEmitter(), {pid: 43021, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn()});
    child.kill.mockImplementation(() => {if (killCloses) queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return killCloses;});
    const options = arguments_[2] as SpawnOptions, args = arguments_[1] as string[], folder = options.cwd as string;
    const native: Native = {child, command: arguments_[0] as string, args, options, folder,
      script: fs.readFileSync(args.at(-1)!, 'utf8'), job: JSON.parse(fs.readFileSync(path.join(folder, 'job.json'), 'utf8'))};
    launches.push(native);
    queueMicrotask(() => {child.emit('spawn'); queueMicrotask(() => run(native));});
    return child as unknown as ReturnType<typeof spawn>;
  });
  return launches;
}
function successReport(native: Native): Record<string, unknown> {
  const common = {schema_version: 1, state: 'measured', proof: {owned_pid: native.child.pid, ...native.job.proof}, node: native.job.node, type_id: 'Part::Feature',
    bounds_mm: {x_min: -2, x_max: 29, y_min: 4, y_max: 21, z_min: 0, z_max: 9, x_length: 31, y_length: 17, z_length: 9},
    volume_mm3: 31 * 17 * 9 - Math.PI * 3 ** 2 * 9,
    shape_type: 'Solid', valid: true, closed: true, solid_count: 1, private_paths_checked: true, owner_marker_verified: true,
    app_version: native.job.app_version, occ_version: native.job.occ_version};
  return native.job.proof.measurement_profile === 'saved_brep_snapshot' ? {...common,
    shape_before: {...native.job.shape}, shape_after: {...native.job.shape}, loaded_document_count: 0, document_opened: false,
    measurement_mode: 'saved_brep_snapshot_no_document', coordinate_system: 'serialized_saved_shape_xyz'} : {...common,
    source_before: {...native.job.source}, source_after: {...native.job.source}, loaded_document_count: 1, entity_count: 1, document_closed: true,
    placement_identity: true, placement_unchanged: true};
}
function writeReport(native: Native, value: unknown = successReport(native)) {fs.writeFileSync(path.join(native.folder, 'report.json'), JSON.stringify(value));}
function complete(native: Native) {writeReport(native); native.child.emit('close', 0, null);}
async function failure(promise: Promise<unknown>, code: string, closed: boolean) {
  const error = await promise.catch(cause => cause); expect(error).toBeInstanceOf(NativeMeasurementError);
  expect(error).toMatchObject({code, actual_close_observed: closed}); expect(String(error)).not.toMatch(/native-port-unit-|secret|PRIVATE|synthetic-invalid-path/);
}
async function flush() {for (let index = 0; index < 15; index++) await Promise.resolve();}
beforeEach(() => {vi.mocked(spawn).mockReset(); vi.mocked(prepareSingleFeatureManifest).mockReset(); vi.mocked(extractSavedShapeSnapshot).mockReset();});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});
});

it('binds a private single-use task ticket to the full execution and waits for verified task commit before releasing',async()=>{
  const f=fixture('saved_brep_snapshot'),ticket=taskTicket(f),privateTicket=bindNativeTaskTicket(f.root,ticket);
  let commit!:()=>void,verified=false;const launches=nativeProcess(complete);
  const promise=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({taskTicket:privateTicket,onLifecycle:vi.fn(),onVerifiedMeasurement:async result=>{
    expect(result.process_proof.nonce).toBe(ticket.binding.child_nonce);expect(result.process_proof.execution_sha256).toBe(ticket.execution_digest_claim);
    verified=true;await new Promise<void>(resolve=>{commit=resolve;});
  }}));
  await vi.waitFor(()=>expect(verified).toBe(true));
  expect(fs.existsSync(launches[0].folder)).toBe(true);expect(()=>acquireDrawingExecution('public-commit-wait')).toThrow();
  commit();const result=await promise;expect(result.status).toBe('measured');expect(fs.existsSync(launches[0].folder)).toBe(false);
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({taskTicket:privateTicket,onLifecycle:vi.fn(),onVerifiedMeasurement:vi.fn()})),'invalid_context',false);
  expect(launches).toHaveLength(1);
});

it.each([{},JSON.parse('{}')])('does not reconstruct private execution authority from serialized token data',async raw=>{
  const f=fixture('saved_brep_snapshot');nativeProcess(complete);
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({taskTicket:raw as NativeTaskExecutionTicket,onLifecycle:vi.fn(),onVerifiedMeasurement:vi.fn()})),'invalid_context',false);
  expect(spawn).not.toHaveBeenCalled();
});

it.each(['execution','profile','script','source'])('rejects a changed task %s crypto claim before creating a private handle',what=>{
  const f=fixture('saved_brep_snapshot'),ticket=structuredClone(taskTicket(f));
  if(what==='execution')Object.assign(ticket,{execution_digest_claim:'a'.repeat(64)});
  if(what==='profile')Object.assign(ticket.step,{profile_sha256:'a'.repeat(64)});
  if(what==='script')Object.assign(ticket.step.profile,{script_sha256:'a'.repeat(64)});
  if(what==='source')Object.assign(ticket.step.manifest.source,{sha256:'a'.repeat(64)});
  expect(()=>bindNativeTaskTicket(f.root,ticket)).toThrow(NativeMeasurementError);expect(spawn).not.toHaveBeenCalled();
});

it('requires lifecycle and verified-result callbacks for a task ticket, and rejects a changed timeout',async()=>{
  const f=fixture('saved_brep_snapshot');nativeProcess(complete);
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({taskTicket:bindNativeTaskTicket(f.root,taskTicket(f))})),'invalid_context',false);
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({taskTicket:bindNativeTaskTicket(f.root,taskTicket(f)),timeout_ms:100,onLifecycle:vi.fn(),onVerifiedMeasurement:vi.fn()})),'invalid_context',false);
  expect(spawn).not.toHaveBeenCalled();
});

it('does not report success when verified result persistence rejects, but releases an already closed host process',async()=>{
  const f=fixture('saved_brep_snapshot'),launches=nativeProcess(complete),onVerifiedMeasurement=vi.fn(()=>{throw new Error('secret path');});
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({taskTicket:bindNativeTaskTicket(f.root,taskTicket(f)),onLifecycle:vi.fn(),onVerifiedMeasurement})),'result_receipt_failed',true);
  expect(onVerifiedMeasurement).toHaveBeenCalledTimes(1);expect(fs.existsSync(launches[0].folder)).toBe(false);
  const release=acquireDrawingExecution('public-after-failed-task-commit');release();
});

it('serializes real stop and kill-result observations after spawn persistence and before actual-close persistence',async()=>{
  const f=fixture('saved_brep_snapshot'),controller=new AbortController(),events:string[]=[],callbacks=context({signal:controller.signal,
    onSpawn:async()=>{events.push('spawn');controller.abort();},onLifecycle:async event=>{events.push(event.type);},onClose:async()=>{events.push('close');}});
  nativeProcess(()=>{});
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks),'cancelled',true);
  expect(events).toEqual(['spawn','cancel_requested','kill_result','close']);
});

it('waits for actual close even when lifecycle persistence itself fails',async()=>{
  const f=fixture('saved_brep_snapshot'),controller=new AbortController();let native:Native|undefined,closed=false;
  nativeProcess(value=>{native=value;controller.abort();},false);
  const promise=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({signal:controller.signal,onLifecycle:()=>{throw new Error('secret');},onClose:()=>{closed=true;}}));
  await vi.waitFor(()=>expect(native?.child.kill).toHaveBeenCalled());expect(closed).toBe(false);
  expect(()=>acquireDrawingExecution('public-lifecycle-failure-wait')).toThrow();native!.child.emit('close',null,'SIGTERM');
  await failure(promise,'lifecycle_receipt_failed',true);expect(closed).toBe(true);
});

it('binds the exact source, engine, fixed script and owned PID before reading a private copy, returning only bounded facts', async () => {
  const f = fixture(), callbacks = context(), launches = nativeProcess(native => {
    expect(fs.readFileSync(path.join(native.folder, 'source.FCStd'))).toEqual(f.original);
    expect(fs.statSync(path.join(native.folder, 'source.FCStd')).mode & 0o777).toBe(0o400);
    expect(JSON.parse(fs.readFileSync(path.join(native.folder, 'owner.json'), 'utf8'))).toEqual({owned_pid: native.child.pid, ...native.job.proof});
    expect(callbacks.onSpawn).toHaveBeenCalledTimes(1); complete(native);
  });
  const result = await measureSingleFeature(f.root, f.manifest, f.engine, callbacks);
  expect(result.bounds_mm).toEqual(successReport(launches[0]).bounds_mm);
  expect(result.volume_mm3).toBeCloseTo(31 * 17 * 9 - Math.PI * 3 ** 2 * 9, 8);
  expect(result).toMatchObject({status: 'measured', ...NATIVE_MEASUREMENT_IDENTITY, manifest_sha256: f.manifest.manifest_sha256,
    measurement_mode: 'restored_document_no_save', coordinate_system: 'staged_document_xyz',
    entity: {node: 'PublicSolid', type_id: 'Part::Feature'}, native_shape_type:'Solid', valid: true, closed: true, solid_count: 1,
    process_proof: {owned_pid: 43021, actual_close_observed: true, owner_acknowledged: true, owner_marker_written: true}});
  expect(result.byte_preservation).toEqual(Object.fromEntries(['source_before','source_after','stage_before','stage_after'].map(key => [key,sha(f.original)])));
  expect(callbacks.onClose).toHaveBeenCalledTimes(1); expect(callbacks.onClose).toHaveBeenCalledWith(result.process_proof);
  expect(prepareSingleFeatureManifest).toHaveBeenCalledWith(f.root, {rel: f.manifest.source.rel, node: 'PublicSolid', profile: 'restored_document', signal: undefined});
  expect(extractSavedShapeSnapshot).not.toHaveBeenCalled();
  expect(fs.readFileSync(f.source)).toEqual(f.original); expect(fs.existsSync(launches[0].folder)).toBe(false);
  expect(JSON.stringify(result)).not.toContain(f.root); expect(result).not.toHaveProperty('mass'); expect(result).not.toHaveProperty('density');
  expect(launches[0].command).toBe(f.engine.command); expect(launches[0].child.kill).not.toHaveBeenCalled();
});

it('uses pre-existing private FreeCAD and XDG paths with minimal environment and never emits or retains native text', async () => {
  const f = fixture();
  for (const key of ['FREECAD_USER_HOME','FREECAD_USER_DATA','FREECAD_USER_TEMP','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR']) vi.stubEnv(key, '/synthetic-invalid-path');
  vi.stubEnv('NODE_OPTIONS', 'secret'); vi.stubEnv('PYTHONPATH', 'secret'); vi.stubEnv('SYNTHETIC_API_TOKEN', 'secret');
  const launches = nativeProcess(native => {
    for (const key of ['FREECAD_USER_HOME','FREECAD_USER_DATA','FREECAD_USER_TEMP','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR','TMPDIR','TMP','TEMP']) {
      const directory = native.options.env?.[key]!; expect(path.dirname(directory)).toBe(native.folder);
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700); expect(fs.readdirSync(directory)).toEqual([]);
    }
    expect(native.options.env).not.toHaveProperty('NODE_OPTIONS'); expect(native.options.env).not.toHaveProperty('PYTHONPATH');
    expect(native.options.env).not.toHaveProperty('SYNTHETIC_API_TOKEN'); expect(native.options.env?.QT_QPA_PLATFORM).toBe('offscreen');
    native.child.stdout.emit('data', Buffer.from('PRIVATE native startup text')); native.child.stderr.emit('data', Buffer.from('secret exception text')); complete(native);
  });
  const result = await measureSingleFeature(f.root, f.manifest, f.engine, context());
  const native = launches[0]; expect(result.process_proof.output_bytes).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|secret/);
  expect(native.args.slice(0,4)).toEqual(['-u',path.join(native.folder,'user.cfg'),'-s',path.join(native.folder,'system.cfg')]);
  expect(sha(native.script)).toBe(NATIVE_MEASUREMENT_IDENTITY.script_sha256);
  expect(native.script.indexOf('owner != expected_owner')).toBeLessThan(native.script.indexOf('App.openDocument'));
  expect(native.script).toContain("set(App.listDocuments()) != {doc.Name}");
  expect(native.script).toContain("obj.TypeId != 'Part::Feature'"); expect(native.script).toContain('obj.Placement.toMatrix().A');
  expect(native.script).toContain("if shape_type != 'Solid'");
  expect(native.script).toContain('shape.Volume'); expect(native.script).toContain('Part.OCC_VERSION');
  expect(native.script).not.toMatch(/\.save(?:As)?\s*\(|\.recompute\s*\(|FreeCADGui|exec\s*\(|eval\s*\(|for .+App\.listDocuments/);
});

it('does not write an owner marker before host PID persistence completes', async () => {
  const f = fixture(); let persist!: () => void;
  const callbacks = context({onSpawn: vi.fn(() => new Promise<void>(resolve => {persist = resolve;}))});
  const launches = nativeProcess(() => {}, false), pending = measureSingleFeature(f.root, f.manifest, f.engine, callbacks);
  await flush(); expect(launches).toHaveLength(1); const native = launches[0];
  expect(fs.existsSync(path.join(native.folder,'owner.json'))).toBe(false); expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(() => acquireDrawingExecution('independent-gate-check')).toThrow();
  persist(); await flush(); expect(fs.existsSync(path.join(native.folder,'owner.json'))).toBe(true); complete(native); await pending;
});

it('never publishes an owner marker after early close and orders pending onSpawn before onClose', async () => {
  const f = fixture(); let persist!: () => void;
  const callbacks = context({onSpawn: vi.fn(() => new Promise<void>(resolve => {persist = resolve;}))});
  const launches = nativeProcess(() => {}, false), pending = measureSingleFeature(f.root,f.manifest,f.engine,callbacks);
  await flush(); const native = launches[0]; native.child.emit('close',0,null); await flush();
  expect(callbacks.onClose).not.toHaveBeenCalled(); expect(fs.existsSync(native.folder)).toBe(true);
  persist(); await failure(pending, 'native_failed', true);
  expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({actual_close_observed: true, owner_acknowledged: true, owner_marker_written: false}));
});

it.each(['onSpawn','onClose'] as const)('rejects %s persistence failure without leaking callback errors', async method => {
  const f = fixture(), callbacks = context({[method]: vi.fn(() => {throw new Error('PRIVATE secret /synthetic-invalid-path');})});
  const launches = nativeProcess(native => {if (method === 'onClose') complete(native);});
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,callbacks),method === 'onSpawn' ? 'spawn_receipt_failed' : 'close_receipt_failed',true);
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  if (method === 'onSpawn') expect(launches[0].child.kill).toHaveBeenCalledWith('SIGTERM');
  const release = acquireDrawingExecution('closed-only-local-gate'); release();
});

it('holds local ownership while the actual-close host callback remains pending', async () => {
  const f = fixture(); let persist!: () => void;
  const callbacks = context({onClose: vi.fn(() => new Promise<void>(resolve => {persist = resolve;}))});
  nativeProcess(complete); const pending = measureSingleFeature(f.root,f.manifest,f.engine,callbacks);
  await flush(); expect(callbacks.onClose).toHaveBeenCalledTimes(1); expect(() => acquireDrawingExecution('still-owned')).toThrow();
  persist(); await pending; const release = acquireDrawingExecution('now-closed'); release();
});

it.each(['cancel','timeout','stdout','stderr','error'] as const)('waits for actual close after %s, including failed termination requests', async mode => {
  vi.useFakeTimers(); const f = fixture(), abort = new AbortController(), callbacks = context({signal: abort.signal});
  const launches = nativeProcess(() => {}, false), pending = measureSingleFeature(f.root,f.manifest,f.engine,callbacks);
  let settled = false; void pending.then(() => {settled=true;},() => {settled=true;}); await flush(); const native = launches[0];
  if (mode === 'cancel') abort.abort();
  else if (mode === 'timeout') await vi.advanceTimersByTimeAsync(120_000);
  else if (mode === 'error') native.child.emit('error',new Error('PRIVATE secret /synthetic-invalid-path'));
  else native.child[mode].emit('data',Buffer.alloc(256*1024+1));
  await vi.advanceTimersByTimeAsync(1000); expect(settled).toBe(false); expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(native.child.kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);
  expect(fs.existsSync(native.folder)).toBe(true); expect(() => acquireDrawingExecution('must-still-own')).toThrow();
  native.child.emit('exit',1,'SIGKILL'); await flush(); expect(settled).toBe(false);
  native.child.emit('close',1,'SIGKILL');
  await failure(pending,{cancel:'cancelled',timeout:'timeout',stdout:'output_limit',stderr:'output_limit',error:'spawn_failed'}[mode],true);
  expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({actual_close_observed:true,termination_requests:['SIGTERM','SIGKILL']}));
});

it('cancels after onSpawn but before persistence without opening permission or early release', async () => {
  const f=fixture(), abort=new AbortController(); let persist!:()=>void;
  const callbacks=context({signal:abort.signal,onSpawn:vi.fn(()=>new Promise<void>(resolve=>{persist=resolve;}))});
  const launches=nativeProcess(()=>{},false),pending=measureSingleFeature(f.root,f.manifest,f.engine,callbacks);
  await flush();abort.abort();const native=launches[0];native.child.emit('close',null,'SIGTERM');persist();
  await failure(pending,'cancelled',true);expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({owner_marker_written:false}));
});

it.each(['missing_context','pre_cancel','manual_manifest','forged_digest','forged_node','engine_sha','gui_command'] as const)('rejects %s before starting Native and never invents a close receipt',async mode=>{
  const f=fixture(),callbacks=context();let requested=f.manifest,engine=f.engine;
  if(mode==='missing_context')Object.assign(callbacks,{onSpawn:undefined});
  if(mode==='pre_cancel')callbacks.signal=AbortSignal.abort();
  if(mode==='manual_manifest')vi.mocked(prepareSingleFeatureManifest).mockResolvedValue({status:'manual',reason_codes:['unsupported_object_type']});
  if(mode==='forged_digest')requested={...f.manifest,manifest_sha256:'0'.repeat(64)};
  if(mode==='forged_node')requested={...f.manifest,entity:{...f.manifest.entity,node:'DifferentFeature'}};
  if(mode==='engine_sha')engine={...engine,sha256:'0'.repeat(64)};
  if(mode==='gui_command')engine={...engine,command:path.join(f.root,'FreeCAD')};
  const expected={missing_context:'invalid_context',pre_cancel:'cancelled',manual_manifest:'manifest_not_ready',forged_digest:'manifest_mismatch',forged_node:'manifest_mismatch',engine_sha:'engine_changed',gui_command:'engine_invalid'}[mode];
  await failure(measureSingleFeature(f.root,requested,engine,callbacks),expected,false);expect(spawn).not.toHaveBeenCalled();expect(callbacks.onClose).not.toHaveBeenCalled();
});

it('checks the full canonical manifest rather than accepting an authority-looking digest tag',async()=>{
  const f=fixture(),callbacks=context(), forged={...f.manifest,shape:{...f.manifest.shape,sha256:'1'.repeat(64)}};
  forged.manifest_sha256=sha(canonicalSingleFeatureManifestPayload(forged));
  await failure(measureSingleFeature(f.root,forged,f.engine,callbacks),'manifest_mismatch',false);expect(spawn).not.toHaveBeenCalled();
});

const invalidReportPatches: Array<[string,(report:Record<string,unknown>)=>void]> = [
  ['PID',r=>{(r.proof as Record<string,unknown>).owned_pid=88;}],
  ['nonce',r=>{(r.proof as Record<string,unknown>).nonce='mismatch';}],
  ['manifest',r=>{(r.proof as Record<string,unknown>).manifest_sha256='0'.repeat(64);}],
  ['execution',r=>{(r.proof as Record<string,unknown>).execution_sha256='0'.repeat(64);}],
  ['script',r=>{(r.proof as Record<string,unknown>).script_sha256='0'.repeat(64);}],
  ['engine',r=>{(r.proof as Record<string,unknown>).engine_sha256='0'.repeat(64);}],
  ['extra field',r=>{r.raw_exception='PRIVATE';}],['node',r=>{r.node='DifferentFeature';}],['type',r=>{r.type_id='PartDesign::Body';}],
  ['two documents',r=>{r.loaded_document_count=2;}],['two entities',r=>{r.entity_count=2;}],['unclosed doc',r=>{r.document_closed=false;}],
  ['compound with one solid',r=>{r.shape_type='Compound';}],
  ['placement',r=>{r.placement_unchanged=false;}],['identity',r=>{r.placement_identity=false;}],['invalid',r=>{r.valid=false;}],
  ['open solid',r=>{r.closed=false;}],['two solids',r=>{r.solid_count=2;}],['private paths',r=>{r.private_paths_checked=false;}],
  ['owner',r=>{r.owner_marker_verified=false;}],['app version',r=>{r.app_version=['1','0','0'];}],['occ',r=>{r.occ_version='unknown';}],
  ['stage hash',r=>{(r.source_after as Record<string,unknown>).sha256='0'.repeat(64);}],
  ['bounds mismatch',r=>{(r.bounds_mm as Record<string,unknown>).x_length=1;}],['negative bounds',r=>{(r.bounds_mm as Record<string,unknown>).z_length=-1;}],
  ['nonfinite bounds',r=>{(r.bounds_mm as Record<string,unknown>).x_min=null;}],['volume zero',r=>{r.volume_mm3=0;}],
  ['volume negative',r=>{r.volume_mm3=-1;}],['volume nonfinite',r=>{r.volume_mm3=null;}],['volume string',r=>{r.volume_mm3='12';}],
];
it.each(invalidReportPatches)('rejects report %s after actual close instead of returning approximate/unknown geometry',async(_label,patch)=>{
  const f=fixture(),callbacks=context();nativeProcess(native=>{const report=successReport(native);patch(report);writeReport(native,report);native.child.emit('close',0,null);});
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,callbacks),'report_invalid',true);expect(callbacks.onClose).toHaveBeenCalledTimes(1);
});

it.each(['source','stage','engine'] as const)('rejects %s byte drift after child close',async target=>{
  const f=fixture();nativeProcess(native=>{writeReport(native);const filename=target==='source'?f.source:target==='stage'?path.join(native.folder,'source.FCStd'):f.engine.command;
    fs.chmodSync(filename,target==='engine'?0o700:0o600);fs.appendFileSync(filename,'changed');native.child.emit('close',0,null);});
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,context()),target==='source'?'source_changed':target==='stage'?'stage_changed':'engine_changed',true);
});

it.each(['missing','oversize','invalid_utf8','nul','symlink','native_failed'] as const)('rejects %s final report with only fixed failure codes',async mode=>{
  const f=fixture();nativeProcess(native=>{const report=path.join(native.folder,'report.json');
    if(mode==='oversize')fs.writeFileSync(report,Buffer.alloc(16385));
    if(mode==='invalid_utf8')fs.writeFileSync(report,Buffer.from([0xff]));
    if(mode==='nul')fs.writeFileSync(report,Buffer.from('{\u0000}'));
    if(mode==='symlink')fs.symlinkSync(f.source,report);
    if(mode==='native_failed')writeReport(native,{schema_version:1,state:'failed'});
    native.child.emit('close',0,null);});
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,context()),'report_invalid',true);
});

it('does not call host close on a synchronous spawn failure and releases only the local not-started gate',async()=>{
  const f=fixture(),callbacks=context();vi.mocked(spawn).mockImplementation(()=>{throw new Error('PRIVATE secret');});
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,callbacks),'spawn_failed',false);expect(callbacks.onSpawn).not.toHaveBeenCalled();expect(callbacks.onClose).not.toHaveBeenCalled();
  const release=acquireDrawingExecution('not-started');release();
});

it('does not invent owned PID/actual-native-close proof when OS spawn fails asynchronously before spawn event',async()=>{
  const f=fixture(),callbacks=context();
  vi.mocked(spawn).mockImplementation(()=>{
    const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn(()=>false)});
    queueMicrotask(()=>{child.emit('error',Object.assign(new Error('PRIVATE spawn denied'),{syscall:'spawn synthetic-freecadcmd'}));queueMicrotask(()=>child.emit('close',-13,null));});
    return child as unknown as ReturnType<typeof spawn>;
  });
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,callbacks),'spawn_failed',false);
  expect(callbacks.onSpawn).not.toHaveBeenCalled();expect(callbacks.onClose).not.toHaveBeenCalled();
});

it('rejects a second invocation under the existing same-process CAD gate without launching another child',async()=>{
  const f=fixture(),release=acquireDrawingExecution('different-owned-native-task');
  try{await failure(measureSingleFeature(f.root,f.manifest,f.engine,context()),'gate_busy',false);expect(spawn).not.toHaveBeenCalled();}finally{release();}
});

it.each([0,99,120001,Infinity,NaN,500.5])('rejects host timeout profile %s outside the closed integer bounds before spawn',async timeout_ms=>{
  const f=fixture();await failure(measureSingleFeature(f.root,f.manifest,f.engine,context({timeout_ms})),'invalid_context',false);expect(spawn).not.toHaveBeenCalled();
});

it('binds a reduced host-only timeout into the execution digest and waits for actual close without late owner permission',async()=>{
  vi.useFakeTimers();const f=fixture();let persist!:()=>void;
  const callbacks=context({timeout_ms:500,onSpawn:vi.fn(()=>new Promise<void>(resolve=>{persist=resolve;}))});
  const launches=nativeProcess(()=>{},false),pending=measureSingleFeature(f.root,f.manifest,f.engine,callbacks);await flush();const native=launches[0];
  expect(native.job.proof.timeout_ms).toBe(500);
  expect(native.job.proof.execution_sha256).toBe(sha(JSON.stringify({manifest_sha256:f.manifest.manifest_sha256,
    measurement_profile:'restored_document',...NATIVE_MEASUREMENT_IDENTITY,timeout_ms:500,engine:{bytes:f.engine.bytes,sha256:f.engine.sha256,app_version:f.engine.app_version,occ_version:f.engine.occ_version}})));
  await vi.advanceTimersByTimeAsync(500);expect(native.child.kill).toHaveBeenCalledWith('SIGTERM');
  native.child.emit('close',null,'SIGTERM');persist();await failure(pending,'timeout',true);
  expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({timeout_ms:500,owner_marker_written:false}));
});

it('measures an explicitly selected saved-BRep without opening a document or claiming document placement/freshness',async()=>{
  const f=fixture('saved_brep_snapshot'),callbacks=context();
  const launches=nativeProcess(native=>{
    expect(fs.readFileSync(path.join(native.folder,'shape.brp'))).toEqual(f.shape);
    expect(fs.existsSync(path.join(native.folder,'source.FCStd'))).toBe(false);
    expect(native.job.shape).toEqual({bytes:f.shape.length,sha256:sha(f.shape)});
    expect(native.job.source).toEqual({bytes:f.original.length,sha256:sha(f.original)});
    expect(sha(native.script)).toBe(SAVED_BREP_SNAPSHOT_IDENTITY.script_sha256);
    expect(native.script).toContain('shape = Part.Shape()');expect(native.script).toContain('shape.importBrep(str(stage))');
    expect(native.script.indexOf("owner['measurement_profile']")).toBeLessThan(native.script.indexOf('shape.importBrep'));
    expect(native.script).not.toMatch(/App\.(?:openDocument|newDocument|restoreDocument|closeDocument)|\.recompute\s*\(|\.save(?:As)?\s*\(|Placement|FreeCADGui|Material|density/i);
    complete(native);
  });
  const result=await measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks);
  expect(result).toMatchObject({...SAVED_BREP_SNAPSHOT_IDENTITY,measurement_mode:'saved_brep_snapshot_no_document',
    coordinate_system:'serialized_saved_shape_xyz',saved_entity:{node:'PublicSolid',type_id:'Part::Feature'},
    loaded_document_count:0,document_opened:false,restored_document_verified:false,parameter_freshness:'not_attested',document_frame:'not_attested',
    native_shape_type:'Solid',valid:true,closed:true,solid_count:1,process_proof:{measurement_profile:'saved_brep_snapshot',actual_close_observed:true}});
  expect(result.bounds_mm).toEqual(successReport(launches[0]).bounds_mm);expect(result.volume_mm3).toBeGreaterThan(0);
  expect(result.byte_preservation).toEqual({source_before:sha(f.original),source_after:sha(f.original),staged_shape_before:sha(f.shape),staged_shape_after:sha(f.shape)});
  for(const field of ['placement_identity','placement_unchanged','entity_count','entity','document_closed','mass','density','material'])expect(result).not.toHaveProperty(field);
  expect(extractSavedShapeSnapshot).toHaveBeenCalledWith(f.root,expect.objectContaining({measurement_profile:'saved_brep_snapshot'}),{signal:undefined});
  expect(prepareSingleFeatureManifest).toHaveBeenCalledWith(f.root,{rel:f.manifest.source.rel,node:'PublicSolid',profile:'saved_brep_snapshot',signal:undefined});
  expect(fs.readFileSync(f.source)).toEqual(f.original);expect(JSON.stringify(result)).not.toContain(f.root);
  expect(f.manifest.material.state).toBe('unresolved_metadata_only');expect(f.manifest.material.resolution_performed).toBe(false);
});

it.each(['restored_document','saved_brep_snapshot'] as const)('rejects %s manifest at the other explicit entry without fallback or spawn',async profile=>{
  const f=fixture(profile),entry=profile==='restored_document'?measureSavedBrepSnapshot:measureSingleFeature;
  await failure(entry(f.root,f.manifest,f.engine,context()),'profile_mismatch',false);
  expect(spawn).not.toHaveBeenCalled();expect(prepareSingleFeatureManifest).not.toHaveBeenCalled();expect(extractSavedShapeSnapshot).not.toHaveBeenCalled();
});

it('does not retry a failed restored Native report in saved-BRep mode',async()=>{
  const f=fixture();nativeProcess(native=>{writeReport(native,{schema_version:1,state:'failed'});native.child.emit('close',0,null);});
  await failure(measureSingleFeature(f.root,f.manifest,f.engine,context()),'report_invalid',true);
  expect(spawn).toHaveBeenCalledTimes(1);expect(extractSavedShapeSnapshot).not.toHaveBeenCalled();
});

it.each(['cancel','timeout'] as const)('saved-BRep %s before owner marker waits for actual close and pending PID persistence without late authorization',async mode=>{
  vi.useFakeTimers();const f=fixture('saved_brep_snapshot'),abort=new AbortController();let persist!:()=>void;
  const callbacks=context({signal:abort.signal,timeout_ms:500,onSpawn:vi.fn(()=>new Promise<void>(resolve=>{persist=resolve;}))});
  const launches=nativeProcess(()=>{},false),pending=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks);
  let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});await flush();const native=launches[0];
  expect(fs.existsSync(path.join(native.folder,'owner.json'))).toBe(false);
  if(mode==='cancel')abort.abort();else await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(1000);expect(native.child.kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);
  expect(settled).toBe(false);expect(()=>acquireDrawingExecution('snapshot-still-owned')).toThrow();
  native.child.emit('close',null,'SIGKILL');await flush();expect(settled).toBe(false);expect(callbacks.onClose).not.toHaveBeenCalled();
  persist();await failure(pending,mode==='cancel'?'cancelled':'timeout',true);
  expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({measurement_profile:'saved_brep_snapshot',owner_marker_written:false,actual_close_observed:true}));
});

it('binds snapshot profile/script/engine/timeout into execution identity independently of restored mode',async()=>{
  const f=fixture('saved_brep_snapshot'),launches=nativeProcess(complete);
  const result=await measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context({timeout_ms:900}));
  expect(result.process_proof.execution_sha256).toBe(sha(JSON.stringify({manifest_sha256:f.manifest.manifest_sha256,
    measurement_profile:'saved_brep_snapshot',...SAVED_BREP_SNAPSHOT_IDENTITY,timeout_ms:900,
    engine:{bytes:f.engine.bytes,sha256:f.engine.sha256,app_version:f.engine.app_version,occ_version:f.engine.occ_version}})));
  expect(SAVED_BREP_SNAPSHOT_IDENTITY.script_sha256).not.toBe(NATIVE_MEASUREMENT_IDENTITY.script_sha256);
  expect(fs.existsSync(launches[0].folder)).toBe(false);
});

it.each(['source','shape'] as const)('saved-BRep rejects %s byte drift after actual close',async target=>{
  const f=fixture('saved_brep_snapshot');nativeProcess(native=>{writeReport(native);
    const filename=target==='source'?f.source:path.join(native.folder,'shape.brp');fs.chmodSync(filename,0o600);fs.appendFileSync(filename,'changed');native.child.emit('close',0,null);});
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context()),target==='source'?'source_changed':'stage_changed',true);
});

it.each(['manual','wrong_profile','wrong_digest','wrong_bytes','wrong_sha'] as const)('saved-BRep rejects extraction %s before Native',async mode=>{
  const f=fixture('saved_brep_snapshot');
  if(mode==='manual')vi.mocked(extractSavedShapeSnapshot).mockResolvedValue({status:'manual',reason_codes:['source_changed']});
  else{
    const manifest=structuredClone(f.manifest);let shape=Buffer.from(f.shape);
    if(mode==='wrong_profile')Object.assign(manifest,{measurement_profile:'restored_document'});
    if(mode==='wrong_digest')Object.assign(manifest,{manifest_sha256:'0'.repeat(64)});
    if(mode==='wrong_bytes')shape=Buffer.from('wrong bytes');
    if(mode==='wrong_sha')shape=Buffer.alloc(f.shape.length);
    vi.mocked(extractSavedShapeSnapshot).mockResolvedValue({status:'ready',manifest,shape});
  }
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context()),mode==='manual'?'manifest_not_ready':mode==='wrong_profile'||mode==='wrong_digest'?'manifest_mismatch':'stage_changed',false);
  expect(spawn).not.toHaveBeenCalled();
});

const snapshotReportPatches: Array<[string,(report:Record<string,unknown>)=>void]> = [
  ['loaded document',r=>{r.loaded_document_count=1;}],['document opened',r=>{r.document_opened=true;}],
  ['restore coordinate',r=>{r.coordinate_system='staged_document_xyz';}],['restore mode',r=>{r.measurement_mode='restored_document_no_save';}],
  ['document placement claim',r=>{r.placement_identity=true;}],
  ['profile',r=>{(r.proof as Record<string,unknown>).measurement_profile='restored_document';}],
  ['shape before',r=>{(r.shape_before as Record<string,unknown>).sha256='0'.repeat(64);}],
  ['shape after',r=>{(r.shape_after as Record<string,unknown>).bytes=1;}],
  ['Compound',r=>{r.shape_type='Compound';}],['invalid',r=>{r.valid=false;}],['not closed',r=>{r.closed=false;}],['not one solid',r=>{r.solid_count=2;}],
  ['zero volume',r=>{r.volume_mm3=0;}],['negative volume',r=>{r.volume_mm3=-1;}],['nonfinite volume',r=>{r.volume_mm3=null;}],
  ['bad bbox',r=>{(r.bounds_mm as Record<string,unknown>).x_max=0;}],['nonce',r=>{(r.proof as Record<string,unknown>).nonce='incorrect';}],
];
it.each(snapshotReportPatches)('saved-BRep rejects %s report only after actual close',async(_name,patch)=>{
  const f=fixture('saved_brep_snapshot'),callbacks=context();nativeProcess(native=>{const report=successReport(native);patch(report);writeReport(native,report);native.child.emit('close',0,null);});
  await failure(measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks),'report_invalid',true);expect(callbacks.onClose).toHaveBeenCalledTimes(1);
});

it('keeps the same process-wide CAD gate across profile/workspace while a saved-BRep child has not closed',async()=>{
  const f=fixture('saved_brep_snapshot'),launches=nativeProcess(()=>{},false),pending=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context());
  await flush();const other=fixture();await failure(measureSingleFeature(other.root,other.manifest,other.engine,context()),'gate_busy',false);
  expect(spawn).toHaveBeenCalledTimes(1);complete(launches[0]);await pending;
});

function nativeFailureReport(native: Native, extra: Record<string,unknown> = {}): Record<string,unknown> {
  return {schema_version:1,state:'failed',proof:{owned_pid:native.child.pid,...native.job.proof},
    failure_stage:'shape_validation',failure_code:'unsupported_shape_type',shape_type:'Compound',...extra};
}

it.each(['restored_document','saved_brep_snapshot'] as const)('%s exposes only attested fixed native guard diagnostics after actual close',async profile=>{
  const f=fixture(profile),callbacks=context(),entry=profile==='restored_document'?measureSingleFeature:measureSavedBrepSnapshot;
  nativeProcess(native=>{writeReport(native,nativeFailureReport(native));native.child.emit('close',0,null);});
  const error=await entry(f.root,f.manifest,f.engine,callbacks).catch(cause=>cause);
  expect(error).toBeInstanceOf(NativeMeasurementError);expect(error).toMatchObject({code:'native_failed',actual_close_observed:true,
    native_failure_stage:'shape_validation',native_failure_code:'unsupported_shape_type',native_shape_type:'Compound'});
  expect(JSON.stringify(error)).not.toContain(f.root);expect(callbacks.onClose).toHaveBeenCalledTimes(1);expect(spawn).toHaveBeenCalledTimes(1);
});

it.each([
  ['private_environment','private_path_mismatch'],['engine_identity','engine_version_mismatch'],
  ['shape_import','unexpected_native_failure'],['shape_validation','shape_null'],['staged_bytes','stage_changed'],
  ['bounds_measurement','bounds_invalid'],['owner_handshake','owner_mismatch'],
] as const)('preserves native stage %s/code %s without pretending to know an exception or shape type',async(failure_stage,failure_code)=>{
  const f=fixture('saved_brep_snapshot');nativeProcess(native=>{
    const report=nativeFailureReport(native,{failure_stage,failure_code});delete report.shape_type;writeReport(native,report);native.child.emit('close',0,null);
  });
  const error=await measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context()).catch(cause=>cause);
  expect(error).toMatchObject({code:'native_failed',actual_close_observed:true,native_failure_stage:failure_stage,native_failure_code:failure_code});
  expect(error.native_shape_type).toBeUndefined();expect(JSON.stringify(error)).not.toMatch(/native-port-unit-|exception text|PRIVATE/);
});

const invalidFailurePatches: Array<[string,(report:Record<string,unknown>)=>void]> = [
  ['unknown stage',r=>{r.failure_stage='external-native-stage';}],['unknown reason',r=>{r.failure_code='PRIVATE exception text';}],
  ['unbounded exception-shaped reason',r=>{r.failure_code='x'.repeat(17000);}],
  ['unknown shape type',r=>{r.shape_type='PRIVATE source label';}],['shape object',r=>{r.shape_type={path:'PRIVATE'};}],
  ['raw exception field',r=>{r.exception='PRIVATE /synthetic-invalid-path';}],['traceback field',r=>{r.traceback='PRIVATE';}],
  ['geometry field',r=>{r.bounds_mm={x:1};}],['wrong PID',r=>{(r.proof as Record<string,unknown>).owned_pid=77;}],
  ['wrong nonce',r=>{(r.proof as Record<string,unknown>).nonce='not-the-owned-child';}],
  ['wrong manifest',r=>{(r.proof as Record<string,unknown>).manifest_sha256='0'.repeat(64);}],
  ['wrong execution',r=>{(r.proof as Record<string,unknown>).execution_sha256='0'.repeat(64);}],
  ['wrong script',r=>{(r.proof as Record<string,unknown>).script_sha256='0'.repeat(64);}],
  ['wrong engine',r=>{(r.proof as Record<string,unknown>).engine_sha256='0'.repeat(64);}],
  ['wrong profile',r=>{(r.proof as Record<string,unknown>).measurement_profile='restored_document';}],
  ['missing proof',r=>{delete r.proof;}],['null proof',r=>{r.proof=null;}],['legacy failed DTO',r=>{delete r.failure_stage;delete r.failure_code;delete r.proof;delete r.shape_type;}],
  ['snapshot document restore',r=>{r.failure_stage='document_restore';r.failure_code='restored_structure_mismatch';}],
  ['snapshot document close',r=>{r.failure_stage='document_close';r.failure_code='document_close_unobserved';}],
  ['snapshot placement',r=>{r.failure_stage='entity_validation';r.failure_code='placement_changed';}],
  ['mismatched guard pair',r=>{r.failure_stage='owner_handshake';r.failure_code='volume_invalid';}],
];
it.each(invalidFailurePatches)('rejects failure report %s without promoting its text/fields to trusted diagnostic',async(_label,patch)=>{
  const f=fixture('saved_brep_snapshot');nativeProcess(native=>{const report=nativeFailureReport(native);patch(report);writeReport(native,report);native.child.emit('close',0,null);});
  const error=await measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context()).catch(cause=>cause);
  expect(error).toMatchObject({code:'report_invalid',actual_close_observed:true});
  expect(error.native_failure_stage).toBeUndefined();expect(error.native_failure_code).toBeUndefined();expect(error.native_shape_type).toBeUndefined();
  expect(JSON.stringify(error)).not.toMatch(/PRIVATE|external-native-stage|not-the-owned-child|synthetic-invalid-path/);
});

it('does not parse a failed Native report or release the gate before actual child close',async()=>{
  const f=fixture('saved_brep_snapshot'),callbacks=context(),launches=nativeProcess(native=>writeReport(native,nativeFailureReport(native)),false);
  const pending=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks);let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});
  await flush();expect(settled).toBe(false);expect(callbacks.onClose).not.toHaveBeenCalled();expect(()=>acquireDrawingExecution('failed-report-but-running')).toThrow();
  launches[0].child.emit('close',0,null);await failure(pending,'native_failed',true);
  expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({actual_close_observed:true}));
});

it('prioritizes close-receipt uncertainty over unvalidated Native failure diagnostics',async()=>{
  const f=fixture('saved_brep_snapshot'),callbacks=context({onClose:()=>{throw new Error('PRIVATE host failure');}});
  nativeProcess(native=>{writeReport(native,nativeFailureReport(native));native.child.emit('close',0,null);});
  const error=await measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks).catch(cause=>cause);
  expect(error).toMatchObject({code:'close_receipt_failed',actual_close_observed:true});expect(error.native_failure_code).toBeUndefined();
});

it('rejects a restored-document proof claiming the snapshot-only BRep import stage',async()=>{
  const f=fixture();nativeProcess(native=>{const report=nativeFailureReport(native,{failure_stage:'shape_import',failure_code:'unexpected_native_failure'});
    delete report.shape_type;writeReport(native,report);native.child.emit('close',0,null);});
  const error=await measureSingleFeature(f.root,f.manifest,f.engine,context()).catch(cause=>cause);
  expect(error).toMatchObject({code:'report_invalid',actual_close_observed:true});expect(error.native_failure_stage).toBeUndefined();
});

it('fixed scripts emit only guard constants or a fixed unexpected reason, never Python exception text',async()=>{
  for(const profile of ['restored_document','saved_brep_snapshot'] as const){
    const f=fixture(profile),launches=nativeProcess(complete),entry=profile==='restored_document'?measureSingleFeature:measureSavedBrepSnapshot;
    await entry(f.root,f.manifest,f.engine,context());const script=launches[0].script;
    expect(script).toContain('except MeasurementFailure as failure:');expect(script).toContain("failure_report('unexpected_native_failure')");
    expect(script).not.toMatch(/str\(failure|str\(exception|traceback\.format|failure\.args/);
    expect(script).toContain("raise MeasurementFailure('unsupported_shape_type')");expect(script).not.toContain('shape.Solids[0]');
  }
});

it('publishes no owner.json at the exact create-before-first-write and partial-write interleavings, only complete fsynced JSON',async()=>{
  const f=fixture('saved_brep_snapshot'),open=fs.openSync,write=fs.writeSync,fsync=fs.fsyncSync,link=fs.linkSync;
  let ownerFd:number|undefined,temporary='',synchronized=false,sawEmpty=false,sawPartial=false,sawPublished=false;
  vi.spyOn(fs,'openSync').mockImplementation((...args:unknown[])=>{
    const fd=Reflect.apply(open,fs,args) as number,filename=String(args[0]);
    if(/^\.owner-[a-f0-9-]+\.tmp$/.test(path.basename(filename))&&(Number(args[1])&fs.constants.O_CREAT)!==0){
      ownerFd=fd;temporary=filename;sawEmpty=true;
      expect(fs.statSync(temporary).size).toBe(0);expect(fs.existsSync(path.join(path.dirname(filename),'owner.json'))).toBe(false);
    }
    return fd;
  });
  vi.spyOn(fs,'writeSync').mockImplementation((...args:unknown[])=>{
    if(args[0]===ownerFd&&!sawPartial){
      expect(fs.existsSync(path.join(path.dirname(temporary),'owner.json'))).toBe(false);
      const partial=[...args];partial[3]=Math.min(7,Number(args[3]));const count=Reflect.apply(write,fs,partial) as number;
      sawPartial=true;expect(fs.statSync(temporary).size).toBe(7);expect(fs.existsSync(path.join(path.dirname(temporary),'owner.json'))).toBe(false);return count;
    }
    return Reflect.apply(write,fs,args) as number;
  });
  vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{fsync(fd);if(fd===ownerFd)synchronized=true;});
  vi.spyOn(fs,'linkSync').mockImplementation((from,to)=>{
    if(path.basename(String(to))==='owner.json'){
      expect(from).toBe(temporary);expect(synchronized).toBe(true);expect(fs.existsSync(to)).toBe(false);
      const complete=JSON.parse(fs.readFileSync(from,'utf8'));expect(complete).toMatchObject({owned_pid:43021,measurement_profile:'saved_brep_snapshot'});
      link(from,to);expect(JSON.parse(fs.readFileSync(to,'utf8'))).toEqual(complete);sawPublished=true;return;
    }
    link(from,to);
  });
  nativeProcess(native=>{expect(fs.readdirSync(native.folder).filter(name=>name.startsWith('.owner-'))).toEqual([]);complete(native);});
  await measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context());
  expect([sawEmpty,sawPartial,synchronized,sawPublished]).toEqual([true,true,true,true]);
});

it.each(['unknown','matching_but_preexisting','symlink'] as const)('does not overwrite or accept an %s owner marker',async mode=>{
  const f=fixture('saved_brep_snapshot');let folder='',expected='';
  const launches=nativeProcess(()=>{},false);
  const callbacks=context({onSpawn:proof=>{
    folder=launches[0].folder;const marker=path.join(folder,'owner.json');
    if(mode==='symlink')fs.symlinkSync(f.source,marker);
    else{expected=mode==='unknown'?'unrecognized marker':JSON.stringify(proof);fs.writeFileSync(marker,expected);}
  }});
  const pending=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks);await flush();
  expect(launches[0].child.kill).toHaveBeenCalledWith('SIGTERM');expect(callbacks.onClose).not.toHaveBeenCalled();
  if(mode==='symlink')expect(fs.readlinkSync(path.join(folder,'owner.json'))).toBe(f.source);
  else expect(fs.readFileSync(path.join(folder,'owner.json'),'utf8')).toBe(expected);
  expect(()=>acquireDrawingExecution('foreign-owner-still-running')).toThrow();launches[0].child.emit('close',null,'SIGTERM');
  await failure(pending,'owner_marker_failed',true);expect(callbacks.onClose).toHaveBeenCalledWith(expect.objectContaining({owner_marker_written:false}));
  expect(fs.readFileSync(f.source)).toEqual(f.original);
});

it.each(['write','fsync'] as const)('does not publish owner permission after a private marker %s failure and waits for close',async mode=>{
  const f=fixture('saved_brep_snapshot'),open=fs.openSync,write=fs.writeSync,fsync=fs.fsyncSync,close=fs.closeSync;let ownerFd:number|undefined;
  vi.spyOn(fs,'openSync').mockImplementation((...args:unknown[])=>{const fd=Reflect.apply(open,fs,args) as number;
    if(/^\.owner-[a-f0-9-]+\.tmp$/.test(path.basename(String(args[0])))&&(Number(args[1])&fs.constants.O_CREAT)!==0)ownerFd=fd;return fd;});
  vi.spyOn(fs,'writeSync').mockImplementation((...args:unknown[])=>{if(mode==='write'&&args[0]===ownerFd)throw new Error('PRIVATE marker write failure');return Reflect.apply(write,fs,args) as number;});
  vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(mode==='fsync'&&fd===ownerFd)throw new Error('PRIVATE marker fsync failure');fsync(fd);});
  // FD numbers can be reused by the host barrier after marker cleanup. Limit
  // this fault to the owned marker's lifetime, not a later directory fsync.
  vi.spyOn(fs,'closeSync').mockImplementation(fd=>{if(fd===ownerFd)ownerFd=undefined;close(fd);});
  const launches=nativeProcess(()=>{},false),callbacks=context(),pending=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,callbacks);await flush();
  expect(fs.existsSync(path.join(launches[0].folder,'owner.json'))).toBe(false);
  expect(fs.readdirSync(launches[0].folder).filter(name=>name.startsWith('.owner-'))).toEqual([]);
  expect(callbacks.onClose).not.toHaveBeenCalled();expect(()=>acquireDrawingExecution('failed-marker-still-owned')).toThrow();
  launches[0].child.emit('close',null,'SIGTERM');await failure(pending,'owner_marker_failed',true);
});

it('does not unlink a replacement temp inode during failed no-replace owner publication',async()=>{
  const f=fixture('saved_brep_snapshot'),link=fs.linkSync;let replacement='';
  vi.spyOn(fs,'linkSync').mockImplementation((from,to)=>{
    if(path.basename(String(to))==='owner.json'){
      replacement=String(from);fs.unlinkSync(from);fs.writeFileSync(replacement,'unowned replacement');
      throw new Error('PRIVATE publication failure');
    }
    link(from,to);
  });
  const launches=nativeProcess(()=>{},false),pending=measureSavedBrepSnapshot(f.root,f.manifest,f.engine,context());await flush();
  expect(replacement).not.toBe('');expect(fs.readFileSync(replacement,'utf8')).toBe('unowned replacement');
  expect(fs.existsSync(path.join(launches[0].folder,'owner.json'))).toBe(false);
  launches[0].child.emit('close',null,'SIGTERM');await failure(pending,'owner_marker_failed',true);
});
