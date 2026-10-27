import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {isNativePlan,isCurrentPlan} from '../../../../shared/batch-tasks/contracts.js';
import {BatchTaskService} from './service.js';
import {canonicalSingleFeatureManifestPayload,prepareSingleFeatureManifest,type SingleFeatureManifest} from '../cad-native-measurement/manifest.js';
import {measureSavedBrepSnapshot,NativeMeasurementError,type NativeMeasurementContext,type NativeSpawnProof,type NativeCloseProof,type SavedBrepSnapshotMeasurement} from '../cad-native-measurement/runner.js';

vi.mock('../cad-native-measurement/manifest.js',async original=>({...await original<typeof import('../cad-native-measurement/manifest.js')>(),prepareSingleFeatureManifest:vi.fn()}));
vi.mock('../cad-native-measurement/runner.js',async original=>({...await original<typeof import('../cad-native-measurement/runner.js')>(),measureSavedBrepSnapshot:vi.fn()}));
// Independently constructed inert bytes/DTOs. The actual Native port is mocked;
// these tests prove DB/worker wiring, never geometric/native process validity.
const roots:string[]=[],services:BatchTaskService[]=[],REL='parts/Example.FCStd',NODE='ExampleFeature';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture(){
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-native-runtime-unit-')));roots.push(root);fs.mkdirSync(path.join(root,'parts'));
  const source=Buffer.from('independent inert saved-CAD placeholder for mocked manifest only');fs.writeFileSync(path.join(root,REL),source);
  const command=path.join(root,'freecadcmd'),binary='inert test engine; never executed';fs.writeFileSync(command,binary,{mode:0o700});
  const engine={command,bytes:Buffer.byteLength(binary),sha256:hash(binary),app_version:['1','1','0'] as const,occ_version:'7.8.1'};
  const payload:Omit<SingleFeatureManifest,'manifest_sha256'>={schema_version:1,algorithm_version:'single-feature-saved-manifest-v2',measurement_profile:'saved_brep_snapshot',source:{rel:REL,bytes:source.length,sha256:hash(source)},
    document_xml:{bytes:500,sha256:hash('inert synthetic XML claim')},entity:{node:NODE,type_id:'Part::Feature',shape_property:'Shape',shape_property_type:'Part::PropertyPartShape'},
    shape:{basis:'serialized_shape_snapshot',member_path:'ExampleFeature.Shape.brp',bytes:40,sha256:hash('inert synthetic shape claim'),crc32:'1234abcd',compression:'deflate'},dependencies:[],dependency_check:'strict_saved_shape_carrier_v1',dependency_scope:'saved_shape_carrier',engine_asset_dependencies:'not_attested',
    material:{uuid_raw:'00000000-0000-0000-0000-000000000000',state:'nil',resolution_performed:false,density_kg_m3:null,mass_kg:null},restored_document:{verified:false},native_executed:false};
  const manifest={...payload,manifest_sha256:hash(canonicalSingleFeatureManifestPayload(payload))};vi.mocked(prepareSingleFeatureManifest).mockResolvedValue({status:'ready',manifest});
  const service=new BatchTaskService(root,{native:{engine}});services.push(service);return {root,service,manifest,source};
}
async function preview(f:ReturnType<typeof fixture>){
  const task=f.service.save({name:'Independent Native test task',subjects:[{kind:'file',rel:REL,node:NODE}],actions:[{instance_id:'measure',key:'cad.saved-shape-measurement',version:1,params:{}}]});
  const plan=await f.service.preview(task.id,task.revision);if(!isNativePlan(plan))throw new Error('Expected explicit V3 fixture');return plan;
}
type Fixture=ReturnType<typeof fixture>;
function proofs(f:Fixture,ctx:NativeMeasurementContext):{spawn:NativeSpawnProof;close:NativeCloseProof}{
  const attempt=f.service.repository.listNativeAttempts()[0];expect(attempt?.state.events).toEqual([]);expect(attempt?.state.projection).toBe('restarted_history');
  const {binding,step,execution_digest_claim}=attempt.ticket;
  const spawn:NativeSpawnProof={owned_pid:41077,nonce:binding.child_nonce,manifest_sha256:step.manifest.manifest_sha256,execution_sha256:execution_digest_claim,engine_sha256:step.profile.engine.sha256,script_sha256:step.profile.script_sha256,timeout_ms:step.profile.timeout_ms,measurement_profile:'saved_brep_snapshot'};
  expect(ctx.taskTicket).toBeTruthy();expect(JSON.stringify(ctx.taskTicket)).toBe('{}');
  return {spawn,close:{...spawn,actual_close_observed:true,exit_code:0,signal:null,owner_acknowledged:true,owner_marker_written:true,output_bytes:0,termination_requests:[]}};
}
function result(f:Fixture,close:NativeCloseProof):SavedBrepSnapshotMeasurement{
  const p=f.service.repository.listNativeAttempts()[0].ticket.step.profile,m=f.manifest;
  return {schema_version:1,status:'measured',algorithm_version:'saved-brep-snapshot-native-bounds-v1',script_sha256:p.script_sha256,measurement_mode:'saved_brep_snapshot_no_document',coordinate_system:'serialized_saved_shape_xyz',manifest_sha256:m.manifest_sha256,
    source:{...m.source},shape:{basis:'serialized_shape_snapshot',member_path:m.shape.member_path,bytes:m.shape.bytes,sha256:m.shape.sha256},saved_entity:{node:NODE,type_id:'Part::Feature'},bounds_mm:{x_min:0,x_max:3,y_min:0,y_max:2,z_min:0,z_max:1,x_length:3,y_length:2,z_length:1},volume_mm3:6,
    native_shape_type:'Solid',valid:true,closed:true,solid_count:1,loaded_document_count:0,document_opened:false,restored_document_verified:false,parameter_freshness:'not_attested',document_frame:'not_attested',private_paths_checked:true,
    app_version:[...p.engine.app_version],occ_version:p.engine.occ_version,engine:{bytes:p.engine.bytes,sha256:p.engine.sha256},process_proof:close,byte_preservation:{source_before:m.source.sha256,source_after:m.source.sha256,staged_shape_before:m.shape.sha256,staged_shape_after:m.shape.sha256}};
}
function succeed(f:Fixture,beforeResult?:(ctx:NativeMeasurementContext)=>void){
  vi.mocked(measureSavedBrepSnapshot).mockImplementation(async(_root,_manifest,_engine,ctx)=>{
    const proof=proofs(f,ctx);await ctx.onSpawn(proof.spawn);await ctx.onClose(proof.close);beforeResult?.(ctx);const value=result(f,proof.close);await ctx.onVerifiedMeasurement!(value);return value;
  });
}
beforeEach(()=>{vi.mocked(prepareSingleFeatureManifest).mockReset();vi.mocked(measureSavedBrepSnapshot).mockReset();});
afterEach(async()=>{vi.restoreAllMocks();for(const service of services.splice(0))await service.close();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('prepares before calling the port and commits verified results only into the existing task DB/worker',async()=>{
  const f=fixture(),plan=await preview(f);succeed(f);
  await expect(f.service.accept(plan.id,plan.digest,'wrong-v2-confirmation')).rejects.toThrow();expect(measureSavedBrepSnapshot).not.toHaveBeenCalled();
  const run=await f.service.accept(plan.id,plan.digest,'native-explicit-confirmation',3);await f.service.settled();
  const detail=f.service.detail(run.id),attempt=f.service.repository.listNativeAttempts(run.id)[0];
  expect(detail.run).toMatchObject({status:'succeeded',completed:1,failed:0,total:1});expect(detail.steps[0].result).toMatchObject({status:'measured',bounds_mm:{x_length:3,y_length:2,z_length:1}});
  expect(attempt.state.events.map(event=>event.type)).toEqual(['spawned','owner_acked','actual_close','report_ready','sources_rechecked','host_outcome']);
  expect(attempt.state).toMatchObject({projection:'restarted_history',phase:'closed',execution_allowed:false,kill_allowed:false,lease_release_allowed:false});
  expect(fs.readFileSync(path.join(f.root,REL))).toEqual(f.source);expect(fs.existsSync(path.join(f.root,'.phoenix','phoenix-workspace.sqlite'))).toBe(false);
  expect(measureSavedBrepSnapshot).toHaveBeenCalledTimes(1);
});

it('does not enable Native catalog or accept Native drafts in a default service',async()=>{
  const f=fixture();await f.service.close();services.splice(services.indexOf(f.service),1);const service=new BatchTaskService(f.root);services.push(service);
  expect(service.catalog()).toHaveLength(7);expect(()=>service.save({name:'Not authorized',subjects:[{kind:'file',rel:REL,node:NODE}],actions:[{instance_id:'m',key:'cad.saved-shape-measurement',version:1,params:{}}]})).toThrow();
});

it('keeps V2 source/effect validation closed even when a host has Native configured',()=>{
  const f=fixture();expect(f.service.catalog()).toHaveLength(8);
  expect(()=>f.service.save({name:'No mixed implicit scope',subjects:[{kind:'file',rel:REL,node:NODE}],actions:[{instance_id:'file',key:'file.metadata',version:1,params:{}}]})).toThrow();
  expect(()=>f.service.save({name:'No mixed protocol',subjects:[{kind:'file',rel:REL,node:NODE}],actions:[{instance_id:'native',key:'cad.saved-shape-measurement',version:1,params:{}},{instance_id:'file',key:'file.metadata',version:1,params:{}}]})).toThrow();
});

it('retains queue ownership after cancel until the owned actual-close callback is durably recorded',async()=>{
  const f=fixture(),plan=await preview(f);let close!:()=>Promise<void>,started=false;
  vi.mocked(measureSavedBrepSnapshot).mockImplementation(async(_root,_manifest,_engine,ctx)=>{
    const proof=proofs(f,ctx);await ctx.onSpawn(proof.spawn);started=true;
    await new Promise<void>(resolve=>{ctx.signal!.addEventListener('abort',()=>{
      close=async()=>{await ctx.onLifecycle!({type:'cancel_requested'});await ctx.onLifecycle!({type:'kill_result',signal:'SIGTERM',result:'returned_true'});
        await ctx.onClose({...proof.close,exit_code:null,signal:'SIGTERM',owner_marker_written:false,termination_requests:['SIGTERM']});resolve();};
    },{once:true});});throw new NativeMeasurementError('cancelled',true);
  });
  const run=await f.service.accept(plan.id,plan.digest,'cancel-owned-native',3);await vi.waitFor(()=>expect(started).toBe(true));
  const textTask=f.service.save({name:'Later metadata',subjects:[{kind:'file',rel:REL}],actions:[{instance_id:'file',key:'file.metadata',version:1,params:{}}]});
  const nextPlan=await f.service.preview(textTask.id,textTask.revision);if(!isCurrentPlan(nextPlan))throw new Error('Expected V2');const next=await f.service.accept(nextPlan.id,nextPlan.digest,'next-read-only');
  f.service.cancel(run.id);expect(f.service.detail(run.id).run.status).toBe('cancel_requested');expect(f.service.detail(next.id).run.status).toBe('queued');
  await close();await f.service.settled();expect(f.service.detail(run.id).run.status).toBe('cancelled');expect(f.service.detail(next.id).run.status).toBe('succeeded');
  expect(f.service.repository.listNativeAttempts(run.id)[0].state.events.map(event=>event.type)).toEqual(['spawned','cancel_requested','kill_result','owner_acked','actual_close','host_outcome']);
});

it('records timeout/kill/actual-close as failed, never a successful late measurement',async()=>{
  const f=fixture(),plan=await preview(f);
  vi.mocked(measureSavedBrepSnapshot).mockImplementation(async(_root,_manifest,_engine,ctx)=>{const proof=proofs(f,ctx);await ctx.onSpawn(proof.spawn);await ctx.onLifecycle!({type:'timeout'});await ctx.onLifecycle!({type:'kill_result',signal:'SIGTERM',result:'returned_false'});
    await ctx.onClose({...proof.close,exit_code:null,signal:'SIGTERM',owner_marker_written:false,termination_requests:['SIGTERM']});throw new NativeMeasurementError('timeout',true);});
  const run=await f.service.accept(plan.id,plan.digest,'native-timeout',3);await f.service.settled();expect(f.service.detail(run.id).run.status).toBe('failed');expect(f.service.detail(run.id).steps[0].result).toBeUndefined();
  expect(f.service.repository.listNativeAttempts(run.id)[0].state).toMatchObject({timeout_requested:true,kill_requested:true,phase:'closed',host_claimed_outcome:'failed'});
});

it('does not publish a success after cancellation arrives at the verified-commit boundary',async()=>{
  const f=fixture(),plan=await preview(f);succeed(f,()=>{const run=f.service.listRuns()[0];f.service.cancel(run.id);});
  const run=await f.service.accept(plan.id,plan.digest,'cancel-at-commit',3);await f.service.settled();expect(f.service.detail(run.id).run.status).toBe('cancelled');expect(f.service.detail(run.id).steps[0].result).toBeUndefined();
});

it('does not replay Native or keep a success DTO after an atomic result transaction fails',async()=>{
  const f=fixture(),plan=await preview(f),db=new DatabaseSync(f.service.repository.path);db.exec("CREATE TRIGGER reject_native_success BEFORE UPDATE ON desk_batch_step WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'independent synthetic result rejection'); END");db.close();succeed(f);
  const run=await f.service.accept(plan.id,plan.digest,'native-result-transaction-failed',3);await f.service.settled();expect(f.service.detail(run.id).run.status).toBe('failed');expect(f.service.detail(run.id).steps[0].result).toBeUndefined();expect(measureSavedBrepSnapshot).toHaveBeenCalledTimes(1);
});

it('rejects source drift during admission and never calls the Native port',async()=>{
  const f=fixture(),plan=await preview(f);vi.mocked(prepareSingleFeatureManifest).mockResolvedValue({status:'ready',manifest:{...f.manifest,manifest_sha256:'0'.repeat(64)}});
  await expect(f.service.accept(plan.id,plan.digest,'changed-native-source',3)).rejects.toThrow();expect(measureSavedBrepSnapshot).not.toHaveBeenCalled();expect(f.service.listRuns()).toEqual([]);
});

it('seals an unclosed live attempt as interrupted history without synthesizing a close or replaying it',async()=>{
  const f=fixture(),plan=await preview(f);vi.mocked(measureSavedBrepSnapshot).mockImplementation(async(_root,_manifest,_engine,ctx)=>{const proof=proofs(f,ctx);await ctx.onSpawn(proof.spawn);throw new NativeMeasurementError('spawn_receipt_failed');});
  const run=await f.service.accept(plan.id,plan.digest,'unknown-close',3);await f.service.settled();expect(f.service.detail(run.id).run.status).toBe('interrupted');
  expect(f.service.repository.listNativeAttempts(run.id)[0].state).toMatchObject({phase:'uncertain',native_barrier:true,projection:'restarted_history',execution_allowed:false,kill_allowed:false});
  expect(f.service.repository.listNativeAttempts(run.id)[0].state.events.map(event=>event.type)).toEqual(['spawned']);expect(measureSavedBrepSnapshot).toHaveBeenCalledTimes(1);
});

it.each(['cleanup_failed','host_barrier_uncertain'] as const)('surfaces %s after result commit without discarding verified data or replaying Native',async code=>{
  const f=fixture(),plan=await preview(f);vi.mocked(measureSavedBrepSnapshot).mockImplementation(async(_root,_manifest,_engine,ctx)=>{
    const proof=proofs(f,ctx);await ctx.onSpawn(proof.spawn);await ctx.onClose(proof.close);await ctx.onVerifiedMeasurement!(result(f,proof.close));throw new NativeMeasurementError(code,true);
  });
  const run=await f.service.accept(plan.id,plan.digest,'post-commit-resource-failure-'+code,3);await f.service.settled();
  const detail=f.service.detail(run.id);expect(detail.run.status).toBe('failed');expect(detail.run.message).toContain(code);expect(detail.steps[0]).toMatchObject({status:'succeeded',result:{status:'measured'}});expect(measureSavedBrepSnapshot).toHaveBeenCalledTimes(1);
});
