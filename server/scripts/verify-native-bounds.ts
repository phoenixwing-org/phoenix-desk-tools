/** Manual public-fixture harness, never an automatic test or registered action.
 * Both reader profiles require host-assigned private FREECAD_USER_* paths:
 * pnpm -C server exec tsx scripts/verify-native-bounds.ts --allow-native --freecadcmd /absolute/path/to/freecadcmd
 * No input CAD, output directory, script, environment override or GUI fallback is accepted.
 * Artifacts remain in a private mkdtemp directory; stdout gives only its basename.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildFreecadChildEnvironment,resolveFreecadCommand} from '../src/lib/freecadProcessSecurity.js';
import {acquireDrawingExecution,configureDrawingExecutionBarrier} from '../src/features/drawing-research/executionGate.js';
import {readGeometryBatch} from '../src/features/part-gallery/geometryRunner.js';
import {prepareSingleFeatureManifest,type SingleFeatureManifest} from '../src/features/cad-native-measurement/manifest.js';
import {measureSavedBrepSnapshot,NativeMeasurementError,type FrozenNativeEngine,type NativeCloseProof,type NativeSpawnProof} from '../src/features/cad-native-measurement/runner.js';
import {BatchTaskService} from '../src/features/batch-tasks/service.js';
import {isNativePlan} from '../../shared/batch-tasks/contracts.js';
import {canonicalPreparedNativeTicketV3Payload} from '../../shared/batch-tasks/native-protocol.js';

const SOURCE='PublicBounds.FCStd',NODE='PublicBoundsSolid',REPORT='creation.json';
// The combined manual receipt includes four native reports and host observations.
// Individual runner reports remain capped at 16 KiB in the production port.
const MAX_BINARY=256*1024*1024,MAX_SOURCE=64*1024*1024,MAX_JSON=32*1024,MAX_OUTPUT=256*1024;
const EXPECTED={x_mm:31,y_mm:17,z_mm:9},TOLERANCE_MM=1e-7;
class HarnessFailure extends Error {constructor(readonly code:string){super(code);}}
const fail=(code:string):never=>{throw new HarnessFailure(code);};
function check(condition:unknown,code:string):asserts condition{if(!condition)fail(code);}
function safeNativeFailure(error:unknown){
 if(!(error instanceof NativeMeasurementError))return {};
 return {native_failure_stage:error.native_failure_stage,native_failure_code:error.native_failure_code,native_shape_type:error.native_shape_type};
}
const stamp=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const CODE_FILES=[
 'server/scripts/verify-native-bounds.ts','server/src/features/cad-native-measurement/runner.ts','server/src/features/cad-native-measurement/manifest.ts',
 'server/src/features/cad-native-measurement/host-barrier.ts','server/src/features/drawing-research/executionGate.ts',
 'server/src/features/batch-tasks/native-runtime.ts','server/src/features/batch-tasks/service.ts','server/src/features/batch-tasks/repository.ts',
 'server/src/features/batch-tasks/model.ts','server/src/features/batch-tasks/migration-worker.ts',
 'server/src/lib/freecadProcessSecurity.ts','server/src/lib/cadSqliteReadLease.ts','server/src/features/cad-companions/filesystem.ts',
 'shared/batch-tasks/contracts.ts','shared/batch-tasks/native-protocol.ts','shared/batch-tasks/native-envelope.ts','shared/batch-tasks/native-attempt.ts',
 'shared/batch-tasks/next-protocol.ts','shared/batch-tasks/envelope.ts',
] as const;
function freezeProductionSources(folder:string){
 const repository=fileURLToPath(new URL('../../',import.meta.url)),destination=path.join(folder,'frozen-sources');fs.mkdirSync(destination,{mode:0o700});
 return CODE_FILES.map(rel=>{
  const source=path.join(repository,rel),before=fingerprint(source,1024*1024),target=path.join(destination,rel);
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const bytes=fs.readFileSync(source);check(createHash('sha256').update(bytes).digest('hex')===before.sha256&&bytes.length===before.bytes,'code_changed');
  const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset);check(written>0,'code_snapshot_write_failed');offset+=written;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.chmodSync(target,0o400);check(JSON.stringify(fingerprint(target,1024*1024))===JSON.stringify(before)&&JSON.stringify(fingerprint(source,1024*1024))===JSON.stringify(before),'code_changed');
  return {rel,...before};
 });
}

/** Bounded FD reads; never include a path, exception or native output in a receipt. */
function fingerprint(filename:string,maximum:number,singleLink=false){
 const before=fs.lstatSync(filename,{bigint:true});
 check(before.isFile()&&!before.isSymbolicLink()&&before.size<=BigInt(maximum)&&(!singleLink||before.nlink===1n),'unsafe_or_oversized_file');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  check(stamp(fs.fstatSync(fd,{bigint:true}))===stamp(before),'file_changed');
  const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
  while(bytes<=Number(before.size)){
   const read=fs.readSync(fd,buffer,0,Math.min(buffer.length,Number(before.size)-bytes+1),bytes);
   if(!read)break;bytes+=read;check(bytes<=maximum,'file_too_large');hash.update(buffer.subarray(0,read));
  }
  check(BigInt(bytes)===before.size&&stamp(fs.fstatSync(fd,{bigint:true}))===stamp(before)&&stamp(fs.lstatSync(filename,{bigint:true}))===stamp(before),'file_changed');
  return {bytes,sha256:hash.digest('hex')};
 }finally{fs.closeSync(fd);}
}
function readJson(filename:string):unknown{
 const before=fs.lstatSync(filename,{bigint:true});check(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<=BigInt(MAX_JSON),'invalid_creation_report');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  check(stamp(fs.fstatSync(fd,{bigint:true}))===stamp(before),'creation_report_changed');
  const buffer=Buffer.alloc(Number(before.size)+1);let offset=0;
  while(offset<buffer.length){const read=fs.readSync(fd,buffer,offset,buffer.length-offset,offset);if(!read)break;offset+=read;}
  check(BigInt(offset)===before.size&&stamp(fs.fstatSync(fd,{bigint:true}))===stamp(before)&&stamp(fs.lstatSync(filename,{bigint:true}))===stamp(before),'creation_report_changed');
  check(!buffer.subarray(0,offset).includes(0),'invalid_creation_report');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,offset)));
 }finally{fs.closeSync(fd);}
}
function privateEnvironment(folder:string):NodeJS.ProcessEnv{
 const paths=Object.fromEntries(['home','data','temp','xdg-config','xdg-cache','xdg-data'].map(name=>{
  const location=path.join(folder,name);fs.mkdirSync(location,{mode:0o700});return [name,location];
 }));
 // Host-authored overrides, never values taken from FREECAD_USER_* in the parent.
 // FreeCAD 1.1 Application.cpp getCustomPaths requires these paths to EXIST.
 return {...buildFreecadChildEnvironment(process.env),
  FREECAD_USER_HOME:paths.home,FREECAD_USER_DATA:paths.data,FREECAD_USER_TEMP:paths.temp,
  XDG_CONFIG_HOME:paths['xdg-config'],XDG_CACHE_HOME:paths['xdg-cache'],XDG_DATA_HOME:paths['xdg-data'],
  TMPDIR:paths.temp,TMP:paths.temp,TEMP:paths.temp};
}

const PYTHON=String.raw`
import json, math, os, re
from pathlib import Path
import FreeCAD as App
import Part

root = Path.cwd().resolve()
spec = json.loads((root / 'create-spec.json').read_text(encoding='utf-8'))
nonce = spec.get('nonce', '')
result = {'version': 1, 'state': 'failed'}
doc = None
try:
    if set(spec) != {'nonce'} or not re.fullmatch(r'[a-f0-9-]{36}', nonce):
        raise ValueError('invalid private spec')
    expected_paths = {'UserHomePath': 'home', 'UserConfigPath': 'home',
        'UserAppData': 'data', 'UserCachePath': 'temp', 'AppTempPath': 'temp'}
    for key, directory in expected_paths.items():
        if Path(App.ConfigGet(key)).resolve() != (root / directory).resolve():
            raise ValueError('native private path mismatch')
    if App.listDocuments() or (root / 'PublicBounds.FCStd').exists():
        raise ValueError('unexpected document or output')
    doc = App.newDocument('PublicBounds')
    doc.CreatedBy = 'Independent public fixture'
    doc.LastModifiedBy = 'Independent public fixture'
    doc.Company = ''
    feature = doc.addObject('Part::Feature', 'PublicBoundsSolid')
    block = Part.makeBox(31.0, 17.0, 9.0)
    bore = Part.makeCylinder(3.0, 11.0, App.Vector(15.5, 8.5, -1.0), App.Vector(0, 0, 1))
    boolean_result = block.cut(bore)
    # Fixture construction ONLY: choose the single solid this known recipe made.
    # The measurement port never unwraps a production Compound or selects [0].
    construction_root_type = boolean_result.ShapeType
    if construction_root_type not in ('Solid', 'Compound') or len(boolean_result.Solids) != 1:
        raise ValueError('unexpected public construction')
    feature.Shape = boolean_result.Solids[0]
    doc.recompute()
    shape = feature.Shape
    if shape.isNull() or shape.ShapeType != 'Solid' or not shape.isValid() or not shape.isClosed() or len(shape.Solids) != 1:
        raise ValueError('invalid public solid')
    expected_volume = 31.0 * 17.0 * 9.0 - math.pi * 3.0 * 3.0 * 9.0
    if not math.isclose(float(shape.Volume), expected_volume, rel_tol=1e-9, abs_tol=1e-7):
        raise ValueError('through hole not verified')
    doc.saveAs(str(root / 'PublicBounds.FCStd'))
    App.closeDocument(doc.Name)
    doc = None
    if App.listDocuments():
        raise ValueError('public document not closed')
    version = [str(value) for value in list(App.Version())[:3]]
    if len(version) != 3 or any(not re.fullmatch(r'[0-9A-Za-z.+_-]{1,40}', value) for value in version):
        raise ValueError('unsupported version components')
    occ_version = str(Part.OCC_VERSION)
    if not re.fullmatch(r'[0-9A-Za-z.+_()-]{1,64}', occ_version):
        raise ValueError('unsupported OCCT version')
    result = {'version': 1, 'state': 'created', 'nonce': nonce, 'pid': os.getpid(),
        'source': 'PublicBounds.FCStd', 'node': 'PublicBoundsSolid', 'version_components': version, 'occ_version': occ_version,
        'private_paths_checked': True, 'single_valid_solid': True,
        'fixture_construction_root_type': construction_root_type, 'saved_shape_type': 'Solid',
        'through_hole_volume_checked': True, 'document_closed': True}
except Exception:
    # No exception text, traceback, application paths or user values in reports.
    result = {'version': 1, 'state': 'failed'}
finally:
    if doc is not None:
        try:
            App.closeDocument(doc.Name)
        except Exception:
            result = {'version': 1, 'state': 'failed'}
    (root / 'creation.json').write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
`;

type CreationProof={nonce:string;owned_pid:number|null;actual_close_observed:boolean;exit_code:number|null;signal:NodeJS.Signals|null;output_bytes:number;termination_requests:string[]};
async function createPublicSource(command:string,folder:string,env:NodeJS.ProcessEnv,signal:AbortSignal,proof:CreationProof){
 const release=acquireDrawingExecution('public-native-bounds:'+proof.nonce);
 try{
  if(signal.aborted)fail('cancelled_before_creation');
  fs.writeFileSync(path.join(folder,'create-spec.json'),JSON.stringify({nonce:proof.nonce}),{flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(folder,'create.py'),PYTHON,{flag:'wx',mode:0o600});
  await new Promise<void>((resolve,reject)=>{
   const child=release.spawn(command,['-u',path.join(folder,'user.cfg'),'-s',path.join(folder,'system.cfg'),path.join(folder,'create.py')],{cwd:folder,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
   proof.owned_pid=child.pid??null;
   let stopped='',closed=false,grace:ReturnType<typeof setTimeout>|undefined;
   const stop=(code:string)=>{
    if(stopped||closed)return;stopped=code;
    grace=setTimeout(()=>{proof.termination_requests.push('SIGKILL');try{child.kill('SIGKILL');}catch{/* Still wait for close. */}},1000);
    proof.termination_requests.push('SIGTERM');try{child.kill('SIGTERM');}catch{/* A failed kill is not exit proof. */}
   };
   const timeout=setTimeout(()=>stop('creation_timeout'),120000);
   const abort=()=>stop('creation_cancelled');
   const output=(chunk:Uint8Array)=>{proof.output_bytes=Math.min(MAX_OUTPUT+1,proof.output_bytes+chunk.byteLength);if(proof.output_bytes>MAX_OUTPUT)stop('creation_output_limit');};
   child.stdout?.on('data',output);child.stderr?.on('data',output); // Drain but never retain native text.
   child.once('error',()=>stop('creation_spawn_failed'));
   child.once('close',(code,exitSignal)=>{
    closed=true;clearTimeout(timeout);if(grace)clearTimeout(grace);signal.removeEventListener('abort',abort);
    proof.actual_close_observed=true;proof.exit_code=code;proof.signal=exitSignal;
    if(stopped||code!==0||exitSignal)reject(new HarnessFailure(stopped||'creation_exit_failed'));else resolve();
   });
   signal.addEventListener('abort',abort);if(signal.aborted)abort();
  });
 }finally{release();} // This promise settles only on this owned child's actual close.
}
function storeReceipt(folder:string,value:unknown){
 const bytes=Buffer.from(JSON.stringify(value)+'\n');check(bytes.length<=MAX_JSON,'receipt_too_large');
 const fd=fs.openSync(path.join(folder,'receipt.json'),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{let offset=0;while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset);check(written>0,'receipt_write_failed');offset+=written;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 return bytes;
}

/** Real processes; callbacks are deliberately only in-memory test observers.
 * A separate host barrier persists PID/close; this is not Repository3 or a
 * Native crash/restart test of that barrier.
 * Cancellation/timeout here occur before the owner marker, not mid geometry read.
 */
async function verifyControlledSnapshot(folder:string,manifest:SingleFeatureManifest,engine:FrozenNativeEngine,outerSignal:AbortSignal,observations:Record<string,unknown>){
 const cases:Record<string,unknown>[]=[];
 const expectedVolume=31*17*9-Math.PI*3*3*9;
 Object.assign(observations,{profile:'saved_brep_snapshot',host_persistence:'fixed_private_host_scope_v1',task_db_persistence:false,
  cross_process_native_restart_tested:false,
  expected_volume_mm3:expectedVolume,cases});
 for(const name of ['normal','cancel_before_owner','timeout_before_owner','normal_after_close'] as const){
  check(!outerSignal.aborted,'cancelled_before_controlled_case');
  const controller=new AbortController(),relay=()=>controller.abort();outerSignal.addEventListener('abort',relay,{once:true});
  let spawned:NativeSpawnProof|undefined,closed:NativeCloseProof|undefined,competingCallbacks=0,gateRejected=false;
  const caseRecord:Record<string,unknown>={case:name,status:'started'};cases.push(caseRecord);
  const observeHostBarrier=(proof:NativeSpawnProof,state:'spawned'|'actual_close')=>{
   const filename=path.join(folder,'host-native','active.v1.json'),record=readJson(filename) as Record<string,unknown>;
   check(record?.format==='desk-host-native-barrier'&&record.version===1&&record.state===state&&typeof record.nonce==='string'
    &&Array.isArray(record.launches)&&record.launches.length===1,'host_barrier_record_mismatch');
   const launch=record.launches[0] as Record<string,unknown>;
   check(launch.state===state&&launch.pid===proof.owned_pid,'host_barrier_pid_mismatch');
   return {state,owned_pid:proof.owned_pid,host_nonce:record.nonce,...fingerprint(filename,MAX_JSON,true)};
  };
  const sourceBefore=fingerprint(path.join(folder,SOURCE),MAX_SOURCE,true);
  const expectBusy=async()=>{
   try{
    await measureSavedBrepSnapshot(folder,manifest,engine,{onSpawn(){competingCallbacks++;},onClose(){}});
    fail('competing_native_not_rejected');
   }catch(error){check(error instanceof NativeMeasurementError&&error.code==='gate_busy','competing_gate_wrong_failure');gateRejected=true;}
  };
  try{
   const measured=await measureSavedBrepSnapshot(folder,manifest,engine,{
    signal:controller.signal,timeout_ms:name==='timeout_before_owner'?100:120_000,
    async onSpawn(proof){
     check(!spawned,'duplicate_spawn_proof');spawned=proof;caseRecord.spawn_proof=proof;
     caseRecord.host_barrier_spawn=observeHostBarrier(proof,'spawned');
     await expectBusy();
     if(name==='cancel_before_owner')controller.abort();
     if(name==='timeout_before_owner')await new Promise<void>(resolve=>setTimeout(resolve,250));
    },
    onClose(proof){check(!closed,'duplicate_close_proof');closed=proof;caseRecord.process_proof=proof;
     caseRecord.host_barrier_close=observeHostBarrier(proof,'actual_close');},
   });
   check(name==='normal'||name==='normal_after_close','stop_case_reported_success');
   check(measured.measurement_mode==='saved_brep_snapshot_no_document'&&measured.coordinate_system==='serialized_saved_shape_xyz'
    &&measured.loaded_document_count===0&&measured.document_opened===false&&measured.restored_document_verified===false
    &&measured.parameter_freshness==='not_attested'&&measured.document_frame==='not_attested','snapshot_scope_not_verified');
   const box=measured.bounds_mm;
   check(Math.abs(box.x_length-31)<=TOLERANCE_MM&&Math.abs(box.y_length-17)<=TOLERANCE_MM&&Math.abs(box.z_length-9)<=TOLERANCE_MM,'controlled_bounds_mismatch');
   check(Math.abs(measured.volume_mm3-expectedVolume)<=1e-7,'controlled_through_hole_volume_mismatch');
   check(measured.native_shape_type==='Solid'&&measured.valid&&measured.closed&&measured.solid_count===1,'controlled_not_single_solid');
   check(closed?.actual_close_observed===true&&closed.owner_marker_written&&closed.owner_acknowledged&&closed.exit_code===0
    &&closed.signal===null&&closed.termination_requests.length===0,'controlled_normal_close_missing');
   Object.assign(caseRecord,{status:'measured',measurement:measured,analytic_volume_checked:true});
  }catch(error){
   Object.assign(caseRecord,{status:'failed',error_code:error instanceof NativeMeasurementError?error.code:error instanceof HarnessFailure?error.code:'controlled_case_failed',...safeNativeFailure(error)});
   if(name==='normal'||name==='normal_after_close')throw error;
   const expectedCode=name==='cancel_before_owner'?'cancelled':'timeout';
   check(error instanceof NativeMeasurementError&&error.code===expectedCode&&error.actual_close_observed,'controlled_stop_not_verified');
   check(spawned&&closed?.actual_close_observed===true&&!closed.owner_marker_written&&closed.termination_requests.includes('SIGTERM'),'controlled_stop_close_missing');
   Object.assign(caseRecord,{status:expectedCode,actual_close_observed:error.actual_close_observed,process_proof:closed,
    stopped_before_owner_marker:true,geometry_read_not_attested:true});
  }finally{
   outerSignal.removeEventListener('abort',relay);
   // Also preserve the no-save observation when a normal case fails and throws.
   const sourceAfter=fingerprint(path.join(folder,SOURCE),MAX_SOURCE,true);
   check(JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter),'controlled_source_bytes_changed');
   caseRecord.source_sha_unchanged=sourceAfter.sha256;
  }
  check(gateRejected&&competingCallbacks===0,'controlled_exclusivity_not_verified');
  check(spawned&&closed&&spawned.owned_pid===closed.owned_pid&&spawned.nonce===closed.nonce,'controlled_process_binding_mismatch');
  check(fs.readdirSync(path.join(folder,'host-native')).length===0,'host_barrier_not_released_after_close');
  Object.assign(caseRecord,{same_process_competitor_rejected:true,competing_on_spawn_callbacks:0,
   competing_probe_phase:'on_spawn_before_stop_request',host_barrier_released_after_close:true});
 }
}

/** Actual fixed Native port through the SAME service/SQLite worker. The manual
 * observer wraps real repository append only to cancel after the genuine spawn
 * transaction and record the host barrier; it never fabricates events/results.
 * No production workspace, arbitrary script, cache or GUI is used. */
async function verifyTaskDbSnapshot(folder:string,engine:FrozenNativeEngine,outerSignal:AbortSignal,observations:Record<string,unknown>){
 const cases:Record<string,unknown>[]=[];Object.assign(observations,{protocol_version:3,schema_version:3,task_db_persistence:true,host_persistence:'fixed_private_host_scope_v1',
  single_file_pilot:true,cross_process_native_restart_tested:false,cases});
 for(const name of ['normal','cancel_after_spawn','timeout','normal_after_close'] as const){
  check(!outerSignal.aborted,'cancelled_before_task_case');const service=new BatchTaskService(folder,{native:{engine,timeout_ms:name==='timeout'?100:120000}});
  let runId:string|undefined,competitionRejected=false,observerFailed=false;const row:Record<string,unknown>={case:name,status:'started'};cases.push(row);
  const relay=()=>{if(runId)service.cancel(runId);};outerSignal.addEventListener('abort',relay,{once:true});
  const realAppend=service.repository.appendNativeEvent.bind(service.repository),observedEvents=new Set<string>();
  service.repository.appendNativeEvent=(attemptId,event)=>{
   const state=realAppend(attemptId,event);
   const first=!observedEvents.has(event.id);observedEvents.add(event.id);
   if(first&&(event.type==='spawned'||event.type==='actual_close')){
    try{
    const filename=path.join(folder,'host-native','active.v1.json'),record=readJson(filename) as Record<string,unknown>;
    check(record.state===event.type&&Array.isArray(record.launches)&&record.launches.length===1,'task_host_state_mismatch');
    const launch=record.launches[0] as Record<string,unknown>;check(launch.pid===event.pid&&launch.state===event.type,'task_host_pid_mismatch');
    row['host_'+event.type]={state:event.type,owned_pid:event.pid,host_nonce:record.nonce,...fingerprint(filename,MAX_JSON,true)};
    if(event.type==='spawned'){
     try{const release=acquireDrawingExecution('public-task-native-competition');release();}catch{competitionRejected=true;}
     check(competitionRejected,'task_competing_gate_not_rejected');
     if(name==='cancel_after_spawn'){check(runId,'task_cancel_run_missing');service.cancel(runId);}
    }
    }catch{observerFailed=true;throw new HarnessFailure('task_host_observer_failed');}
   }
   return state;
  };
  try{
   const before=fingerprint(path.join(folder,SOURCE),MAX_SOURCE,true);
   const task=service.save({name:'Independent public Native '+name,subjects:[{kind:'file',rel:SOURCE,node:NODE}],actions:[{instance_id:'measure',key:'cad.saved-shape-measurement',version:1,params:{}}]});
   const plan=await service.preview(task.id,task.revision,outerSignal);check(isNativePlan(plan),'task_plan_not_v3');
   check(!outerSignal.aborted,'cancelled_before_task_admission');
   const run=await service.accept(plan.id,plan.digest,'public-'+name,3);runId=run.id;
   if(outerSignal.aborted)service.cancel(runId); // Pump yields before claiming, so no late launch escapes an earlier stop.
   await service.settled();check(!observerFailed&&row.host_spawned&&row.host_actual_close,'task_host_observer_failed');
   const detail=service.detail(runId),attempts=service.repository.listNativeAttempts(runId);check(attempts.length===1,'task_attempt_count_mismatch');
   const attempt=attempts[0],events=attempt.state.events,spawned=events.find(event=>event.type==='spawned'),closed=events.find(event=>event.type==='actual_close');
   check(spawned?.type==='spawned'&&closed?.type==='actual_close'&&spawned.pid===closed.pid&&closed.nonce===attempt.ticket.binding.child_nonce,'task_owned_close_missing');
   check(competitionRejected&&fs.readdirSync(path.join(folder,'host-native')).length===0,'task_host_not_released');
   check(attempt.state.projection==='restarted_history'&&!attempt.state.execution_allowed&&!attempt.state.kill_allowed&&!attempt.state.lease_release_allowed,'task_history_claims_authority');
   check(createHash('sha256').update(canonicalPreparedNativeTicketV3Payload({binding:attempt.ticket.binding,step:attempt.ticket.step})).digest('hex')===attempt.ticket.execution_digest_claim,'task_execution_digest_mismatch');
   const outcome=name==='cancel_after_spawn'?'cancelled':name==='timeout'?'failed':'succeeded';check(detail.run.status===outcome&&detail.steps[0].status===outcome,'task_outcome_mismatch');
   if(outcome==='succeeded'){
    const result=detail.steps[0].result as Record<string,unknown>,box=result.bounds_mm as Record<string,number>;
    check(result.measurement_mode==='saved_brep_snapshot_no_document'&&result.document_opened===false&&result.parameter_freshness==='not_attested','task_measurement_scope_mismatch');
    check(Math.abs(box.x_length-31)<=TOLERANCE_MM&&Math.abs(box.y_length-17)<=TOLERANCE_MM&&Math.abs(box.z_length-9)<=TOLERANCE_MM&&Math.abs(Number(result.volume_mm3)-(31*17*9-Math.PI*3*3*9))<=1e-7,'task_geometry_mismatch');
    row.measurement=result;
   }else{
    check(detail.steps[0].result===undefined,'task_stop_published_success');
    check(events.some(event=>event.type===(name==='timeout'?'timeout':'cancel_requested'))&&events.some(event=>event.type==='kill_result'),'task_stop_events_missing');
   }
   const after=fingerprint(path.join(folder,SOURCE),MAX_SOURCE,true);check(JSON.stringify(before)===JSON.stringify(after),'task_source_changed');
   check(!fs.existsSync(path.join(folder,'.phoenix','phoenix-workspace.sqlite')),'business_cache_created');
   Object.assign(row,{status:outcome,run_id:runId,task_id:task.id,plan_digest:plan.digest,attempt_id:attempt.ticket.binding.attempt_id,
    child_nonce:attempt.ticket.binding.child_nonce,execution_sha256:attempt.ticket.execution_digest_claim,owned_pid:spawned.pid,actual_close_observed:true,
    event_types:events.map(event=>event.type),attempt_phase:attempt.state.phase,history_only:true,host_released_after_close:true,source_sha_unchanged:after.sha256,
    step_message:detail.steps[0].message??null});
   if(name==='normal_after_close'){
    const backup=service.repository.exportBackup();check(backup.version===3&&backup.schema_version===3,'task_backup_not_v3');
    const payload=Buffer.from(JSON.stringify(backup)+'\n'),filename=path.join(folder,'task-history.json');
    check(payload.length<=32*1024*1024,'task_backup_limit');fs.writeFileSync(filename,payload,{flag:'wx',mode:0o600});
    observations.logical_backup={rel:'task-history.json',...fingerprint(filename,32*1024*1024,true),runs:backup.data.runs.length,attempts:backup.data.native_attempts?.length};
   }
  }finally{outerSignal.removeEventListener('abort',relay);await service.close();}
 }
 observations.task_db={rel:'.phoenix/batch-tasks.sqlite',...fingerprint(path.join(folder,'.phoenix','batch-tasks.sqlite'),32*1024*1024,true)};
}

async function main(){
 const receipt:Record<string,unknown>={format:'desk-public-native-bounds',version:1,status:'not_run',
  expected_box_mm:EXPECTED,through_hole_radius_mm:3,tolerance_mm:TOLERANCE_MM,
  limitations:['Only one independently constructed Part::Feature; not material, assembly, dependency, queue or cache-write validation.',
   'readGeometryBatch exposes no PID/nonce/version/actual-close/private-path receipt; those reader facts are not independently attested here.',
   'Command SHA identifies the selected executable, not linked libraries or protection against arbitrary hostile path replacement.']};
 let folder:string|undefined;const controller=new AbortController(),abort=()=>controller.abort();
 process.on('SIGINT',abort);process.on('SIGTERM',abort);
 try{
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--help'){
   receipt.usage='pnpm -C server exec tsx scripts/verify-native-bounds.ts --allow-native --freecadcmd ABSOLUTE_FREECADCMD [--profile saved-shape [--task-db]]';return;
  }
  const taskDb=args.length===6&&args[5]==='--task-db';
  const snapshot=(args.length===5||taskDb)&&args[3]==='--profile'&&args[4]==='saved-shape';
  check((args.length===3||snapshot)&&args[0]==='--allow-native'&&args[1]==='--freecadcmd','explicit_manual_opt_in_required');
  const selected=args[2];check(path.isAbsolute(selected)&&selected.length<=4096&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(selected),'invalid_command');
  const command=resolveFreecadCommand('',selected);check(command&&/^freecadcmd(?:\.exe)?$/i.test(path.basename(command)),'headless_command_required');
  fs.accessSync(command,fs.constants.X_OK);const binaryBefore=fingerprint(command,MAX_BINARY);
  receipt.command={basename:path.basename(command),...binaryBefore};
  folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-public-native-bounds-')));fs.chmodSync(folder,0o700);
  configureDrawingExecutionBarrier(path.join(folder,'host-native'));
  receipt.artifacts={temporary_directory_basename:path.basename(folder),receipt:'receipt.json',source:SOURCE,retained:true};
  receipt.frozen_sources={directory:'frozen-sources',scope:'fixed_reviewed_file_list_not_all_transitive_or_engine_assets',files:freezeProductionSources(folder)};
  const env=privateEnvironment(folder),proof:CreationProof={nonce:randomUUID(),owned_pid:null,actual_close_observed:false,exit_code:null,signal:null,output_bytes:0,termination_requests:[]};
  receipt.creation=proof;
  receipt.creation_script_sha256=createHash('sha256').update(PYTHON).digest('hex');
  await createPublicSource(command,folder,env,controller.signal,proof);
  const created=readJson(path.join(folder,REPORT)) as Record<string,unknown>;
  check(created&&created.version===1&&created.state==='created'&&created.nonce===proof.nonce&&created.pid===proof.owned_pid&&created.source===SOURCE&&created.node===NODE
   &&created.private_paths_checked===true&&created.single_valid_solid===true&&created.through_hole_volume_checked===true&&created.document_closed===true
   &&['Solid','Compound'].includes(String(created.fixture_construction_root_type))&&created.saved_shape_type==='Solid'
   &&Array.isArray(created.version_components)&&created.version_components.length===3&&created.version_components.every(value=>typeof value==='string'&&/^[0-9A-Za-z.+_-]{1,40}$/.test(value))
   &&typeof created.occ_version==='string'&&/^[0-9A-Za-z.+_()-]{1,64}$/.test(created.occ_version),'creation_report_not_verified');
  receipt.version_components=created.version_components;receipt.occ_version=created.occ_version;receipt.creation_checks={private_paths:true,single_valid_solid:true,through_hole_volume:true,document_closed:true,
   fixture_construction_root_type:created.fixture_construction_root_type,saved_shape_type:'Solid'};
  const filename=path.join(folder,SOURCE),before=fingerprint(filename,MAX_SOURCE,true);
  check(!controller.signal.aborted,'cancelled_before_read');
  if(snapshot){
   receipt.version=taskDb?4:3;receipt.profile='saved_brep_snapshot';
   receipt.limitations=['One independently constructed, identity-placement Part::Feature saved BRep snapshot only; not parameter freshness, document frame, assembly or dependency resolution.',
    'Material UUID is unresolved metadata only; density and mass remain unknown. No business cache or CAD writes during measurement.',
    'Callbacks are in-memory manual observers, not Repository3. A separate private host barrier persists PID/close; Native crash/restart recovery is not exercised by this harness.',
    'Stop cases occur before the owner marker; cancellation during geometry import or successful SIGKILL is not attested.',
    'Competing calls are probed during onSpawn before the stop request; zero callbacks is not independent OS spawn tracing or a probe throughout the stop-to-close interval.',
    'Command SHA identifies the executable, not dynamic libraries, all engine assets or a hostile operating system.'];
   const prepared=await prepareSingleFeatureManifest(folder,{rel:SOURCE,node:NODE,profile:'saved_brep_snapshot',signal:controller.signal});
   check(prepared.status==='ready','snapshot_manifest_not_ready');
   receipt.manifest=prepared.manifest;
   const observations:Record<string,unknown>={};receipt.controlled_port=observations;
   const engine={command,...binaryBefore,app_version:created.version_components as [string,string,string],occ_version:created.occ_version as string};
   if(taskDb){
    receipt.limitations=['Actual task DB/worker Native single-file pilot only. Default HTTP catalog remains Native-disabled; not a general Body/assembly/multi-file release.',
     'Saved BRep carrier only; not parameter freshness, document frame, dependency resolution, material density or mass. No business cache/CAD writes during measurement.',
     'Manual repository observer wraps genuine append to request cancellation after persisted spawn and capture live host state. Historical host files are deleted on release; only summaries/fingerprints survive.',
     'Timeout and cancellation are real owned processes; no claim of mid-import cancellation, successful SIGKILL, full process-tree or Native crash/restart recovery.',
     'Frozen reviewed source list is retained before Native creation/measurement; not all transitive dependencies, dynamic libraries, engine assets or hostile-OS protection.'];
    await verifyTaskDbSnapshot(folder,engine,controller.signal,observations);
   }else await verifyControlledSnapshot(folder,prepared.manifest,engine,controller.signal,observations);
   const after=fingerprint(filename,MAX_SOURCE,true),binaryAfter=fingerprint(command,MAX_BINARY);
   check(JSON.stringify(before)===JSON.stringify(after),'source_bytes_changed');check(JSON.stringify(binaryBefore)===JSON.stringify(binaryAfter),'command_bytes_changed');
   receipt.source={rel:SOURCE,before,after,bytes_unchanged:true};receipt.command_unchanged=true;receipt.status='passed';return;
  }
  const inherited=process.env;let rows:Awaited<ReturnType<typeof readGeometryBatch>>;
  receipt.reader={api:'readGeometryBatch',rel:SOURCE,node:NODE,process_receipt:'not_exposed',status:'started'};
  try{
   // This standalone process has no other callers. The explicit command prevents
   // preference/default discovery; runner owns its own private cfg/AppData paths.
   process.env={...env,PHOENIX_FREECAD_CMD:command};
   rows=await readGeometryBatch([{rel:SOURCE,filename,node:NODE}],undefined,{signal:controller.signal});
  }finally{process.env=inherited;}
  const after=fingerprint(filename,MAX_SOURCE,true),binaryAfter=fingerprint(command,MAX_BINARY);
  check(JSON.stringify(before)===JSON.stringify(after),'source_bytes_changed');check(JSON.stringify(binaryBefore)===JSON.stringify(binaryAfter),'command_bytes_changed');
  check(rows.length===1&&rows[0].rel===SOURCE&&rows[0].bounding_box,'missing_bounds');
  const box=rows[0].bounding_box;
  check(Object.entries(EXPECTED).every(([axis,value])=>Math.abs(box[axis as keyof typeof box]-value)<=TOLERANCE_MM),'bounds_mismatch');
  receipt.source={rel:SOURCE,before,after,bytes_unchanged:true};receipt.reader={api:'readGeometryBatch',rel:SOURCE,node:NODE,bounding_box:box,status:'returned',process_receipt:'not_exposed'};
  receipt.command_unchanged=true;receipt.status='passed';
 }catch(error){receipt.status='failed';receipt.error_code=error instanceof HarnessFailure||error instanceof NativeMeasurementError?error.code:'harness_failed_without_external_diagnostics';Object.assign(receipt,safeNativeFailure(error));process.exitCode=1;}
 finally{
  process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  let bytes:Buffer;
  try{bytes=folder?storeReceipt(folder,receipt):Buffer.from(JSON.stringify(receipt)+'\n');check(bytes.length<=MAX_JSON,'receipt_too_large');}
  catch{process.exitCode=1;bytes=Buffer.from(JSON.stringify({format:'desk-public-native-bounds',version:1,status:'failed',error_code:'safe_receipt_write_failed'})+'\n');}
  process.stdout.write(bytes); // No absolute path, native output or exception text.
 }
}
void main().catch(()=>{process.exitCode=1;process.stdout.write('{"format":"desk-public-native-bounds","version":1,"status":"failed","error_code":"harness_failed_without_external_diagnostics"}\n');});
