import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {pnwCreateDb} from '@phoenix-wing/db-node';
import {BatchRepository,type BatchBackup} from './repository.js';
import {createNativeBatchPlanV3,canonicalNativePlanV3Payload} from '../../../../shared/batch-tasks/native-envelope.js';
import {compileNativePreparedStepV3,compilePreparedNativeTicketV3,canonicalPreparedNativeTicketV3Payload,canonicalNativeProfileV3Payload,type NativePreparedStepInputV3,type PreparedNativeTicketV3} from '../../../../shared/batch-tasks/native-protocol.js';
import {validateNativeAttempt,type NativeAttemptEvent} from '../../../../shared/batch-tasks/native-attempt.js';

// Inert, independently constructed DTO claims. No source CAD, engine, process or Native proof is used.
const NOW='2026-01-01T00:00:00.000Z',roots:string[]=[],repos:BatchRepository[]=[];let sequence=0;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-native-ledger-')));roots.push(root);return open(root);}
function open(root:string){const repo=new BatchRepository(root,{now:()=>Date.parse(NOW),id:()=>`synthetic-${++sequence}`});repos.push(repo);return repo;}
function input():NativePreparedStepInputV3{
 const value:NativePreparedStepInputV3={step_id:'measure-step',item_id:'saved-item',subject:{kind:'file',rel:'fixtures/Example.FCStd',node:'ExampleFeature'},
  profile:{key:'freecad.saved-brep-snapshot',version:1,measurement_profile:'saved_brep_snapshot',algorithm_version:'saved-brep-snapshot-native-bounds-v1',script_sha256:'5'.repeat(64),engine:{key:'freecadcmd',bytes:2048,sha256:'6'.repeat(64),app_version:['1','1','0'],occ_version:'7.8.1'},timeout_ms:120000},profile_sha256:'7'.repeat(64),
  manifest:{schema_version:1,algorithm_version:'single-feature-saved-manifest-v2',measurement_profile:'saved_brep_snapshot',source:{rel:'fixtures/Example.FCStd',bytes:4096,sha256:'1'.repeat(64)},document_xml:{bytes:2500,sha256:'2'.repeat(64)},
   entity:{node:'ExampleFeature',type_id:'Part::Feature',shape_property:'Shape',shape_property_type:'Part::PropertyPartShape'},shape:{basis:'serialized_shape_snapshot',member_path:'ExampleFeature.Shape.brp',bytes:512,sha256:'3'.repeat(64),crc32:'1a2b3c4d',compression:'deflate'},
   dependencies:[],dependency_check:'strict_saved_shape_carrier_v1',dependency_scope:'saved_shape_carrier',engine_asset_dependencies:'not_attested',material:{uuid_raw:'00000000-0000-0000-0000-000000000000',state:'nil',resolution_performed:false,density_kg_m3:null,mass_kg:null},restored_document:{verified:false},native_executed:false,manifest_sha256:'4'.repeat(64)}};
 return {...value,profile_sha256:sha(canonicalNativeProfileV3Payload(value.profile))};
}
function setup(active=true){
 const repo=fixture(),step=compileNativePreparedStepV3(input()),task=repo.saveTask({name:'Independent snapshot ledger',subjects:[step.subject],actions:[{instance_id:'measure',key:'cad.saved-shape-measurement',version:1,params:{}}]});
 const prepared={protocol_version:3 as const,id:`native-plan-${++sequence}`,task_id:task.id,task_revision:task.revision,created_at:NOW,expires_at:'2026-01-01T01:00:00.000Z',action_instance_id:'measure',step};
 const plan=createNativeBatchPlanV3(prepared,sha(canonicalNativePlanV3Payload(prepared)));repo.savePlan(plan);const detail=repo.acceptRun(plan.id,plan.digest,`request-${++sequence}`);
 if(active){repo.claimQueuedRun();repo.startStep(detail.run.id,step.step_id);}
 const binding={attempt_id:`attempt-${++sequence}`,run_id:detail.run.id,step_id:step.step_id,plan_digest:plan.digest,host_id:'synthetic-host',session_nonce:'session-a',child_nonce:'child-a',prepared_at:NOW,
  profile:{key:step.profile.key,version:step.profile.version},profile_sha256:step.profile_sha256,script_sha256:step.profile.script_sha256,engine_sha256:step.profile.engine.sha256,source_manifest_sha256:step.manifest.manifest_sha256,result_schema_version:1,expected_item_ids:[step.item_id]};
 const ticket=compilePreparedNativeTicketV3({binding,step,execution_digest_claim:sha(canonicalPreparedNativeTicketV3Payload({binding,step}))});
 return {repo,task,plan,detail,ticket};
}
type Fixture=ReturnType<typeof setup>;
function event(f:Fixture,type:string,fields:Record<string,unknown>={}):NativeAttemptEvent{return {id:`event-${++sequence}`,attempt_id:f.ticket.binding.attempt_id,session_nonce:f.ticket.binding.session_nonce,at:NOW,type,...fields} as NativeAttemptEvent;}
function append(f:Fixture,type:string,fields:Record<string,unknown>={}){const value=event(f,type,fields);f.repo.appendNativeEvent(f.ticket.binding.attempt_id,value);return value;}
function measurement(ticket:PreparedNativeTicketV3):Record<string,unknown>{
 const s=ticket.step,p=s.profile;
 return {schema_version:1,status:'measured',algorithm_version:p.algorithm_version,script_sha256:p.script_sha256,measurement_mode:'saved_brep_snapshot_no_document',coordinate_system:'serialized_saved_shape_xyz',manifest_sha256:s.manifest.manifest_sha256,
  source:{...s.manifest.source},shape:{basis:'serialized_shape_snapshot',member_path:s.manifest.shape.member_path,bytes:s.manifest.shape.bytes,sha256:s.manifest.shape.sha256},saved_entity:{node:s.subject.node,type_id:'Part::Feature'},
  bounds_mm:{x_min:0,x_max:3,y_min:0,y_max:2,z_min:0,z_max:1,x_length:3,y_length:2,z_length:1},volume_mm3:6,native_shape_type:'Solid',valid:true,closed:true,solid_count:1,loaded_document_count:0,document_opened:false,restored_document_verified:false,parameter_freshness:'not_attested',document_frame:'not_attested',private_paths_checked:true,
  app_version:[...p.engine.app_version],occ_version:p.engine.occ_version,engine:{bytes:p.engine.bytes,sha256:p.engine.sha256},
  process_proof:{owned_pid:32101,nonce:ticket.binding.child_nonce,manifest_sha256:s.manifest.manifest_sha256,execution_sha256:ticket.execution_digest_claim,engine_sha256:p.engine.sha256,script_sha256:p.script_sha256,timeout_ms:p.timeout_ms,measurement_profile:'saved_brep_snapshot',actual_close_observed:true,exit_code:0,signal:null,owner_acknowledged:true,owner_marker_written:true,output_bytes:100,termination_requests:[]},
  byte_preservation:{source_before:s.manifest.source.sha256,source_after:s.manifest.source.sha256,staged_shape_before:s.manifest.shape.sha256,staged_shape_after:s.manifest.shape.sha256}};
}
function closed(f:Fixture,result=measurement(f.ticket)){
 f.repo.prepareNativeAttempt(f.ticket);append(f,'spawned',{pid:32101});append(f,'owner_acked',{pid:32101,nonce:f.ticket.binding.child_nonce});append(f,'actual_close',{pid:32101,nonce:f.ticket.binding.child_nonce,observer:'host_child_process_close',exit_code:0,signal:null});
 append(f,'report_ready',{pid:32101,nonce:f.ticket.binding.child_nonce,schema_version:1,sha256:sha(JSON.stringify(result)),source_manifest_sha256:f.ticket.binding.source_manifest_sha256,item_ids:f.ticket.binding.expected_item_ids,valid:true});
 append(f,'sources_rechecked',{expected_manifest_sha256:f.ticket.binding.source_manifest_sha256,observed_manifest_sha256:f.ticket.binding.source_manifest_sha256,status:'matched'});return result;
}
afterEach(()=>{for(const repo of repos.splice(0)){try{repo.close();}catch{/* displaced synthetic owner */}}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe('schema3 native attempt ledger: historical claims, never host capabilities',()=>{
 it('accepts one complete V3 file/node plan and freezes it without upgrading V2',()=>{const f=setup(false);expect(f.repo.getRunPlan(f.detail.run.id)).toEqual(f.plan);expect(f.detail.steps[0]).toMatchObject({scope:'file',subject:{node:'ExampleFeature'},status:'pending'});expect(f.repo.acceptRun(f.plan.id,f.plan.digest,f.detail.run.client_request_id)).toEqual(f.detail);expect(f.repo.exportBackup()).toMatchObject({version:3,schema_version:3,data:{native_attempts:[]}});});
 it('requires active run/step and an exact frozen ticket before preparing',()=>{
  const f=setup(false);expect(()=>f.repo.prepareNativeAttempt(f.ticket)).toThrow();f.repo.claimQueuedRun();f.repo.startStep(f.detail.run.id,f.ticket.binding.step_id);
  const bad={...f.ticket,execution_digest_claim:'0'.repeat(64)};expect(()=>f.repo.prepareNativeAttempt(bad)).toThrow();
  const prepared=f.repo.prepareNativeAttempt(f.ticket);expect(prepared).toMatchObject({phase:'prepared',execution_allowed:false,kill_allowed:false,lease_release_allowed:false,authority:'not_authority'});expect(f.repo.prepareNativeAttempt(f.ticket)).toEqual(prepared);
  expect(f.repo.getNativeAttempt(f.ticket.binding.attempt_id)?.state).toMatchObject({projection:'restarted_history',phase:'uncertain',native_barrier:true,eligibility:{eligible_for_succeeded:false}});
 });
 it('makes stable event retries idempotent and rejects same-ID content conflicts atomically',()=>{const f=setup();f.repo.prepareNativeAttempt(f.ticket);const spawned=append(f,'spawned',{pid:32101});expect(f.repo.appendNativeEvent(f.ticket.binding.attempt_id,spawned).events).toHaveLength(1);const before=f.repo.exportBackup();expect(()=>f.repo.appendNativeEvent(f.ticket.binding.attempt_id,{...spawned,pid:32102} as NativeAttemptEvent)).toThrow();expect(f.repo.exportBackup()).toEqual(before);});
 it('requires the dedicated close/report/source-checked transaction and atomically commits its final DTO',()=>{
  const f=setup();expect(()=>f.repo.finishStep(f.detail.run.id,f.ticket.binding.step_id,'succeeded',{})).toThrow();const result=closed(f),outcome=event(f,'host_outcome',{outcome:'succeeded'});
  expect(()=>f.repo.appendNativeEvent(f.ticket.binding.attempt_id,outcome)).toThrow();const step=f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,outcome,result);
  expect(step).toMatchObject({status:'succeeded',result});expect(f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,outcome,result)).toEqual(step);expect(f.repo.finishRun(f.detail.run.id,'succeeded')).toMatchObject({completed:1,failed:0,total:1});
  expect(f.repo.listNativeAttempts(f.detail.run.id)[0].state).toMatchObject({phase:'closed',authority:'not_authority',execution_allowed:false,eligibility:{eligible_for_succeeded:false}});
  expect(()=>append(f,'spawned',{pid:32102})).toThrow();
 });
 it('rolls back attempt terminal event, step result, counts and public event on an injected step write failure',()=>{
  const f=setup(),result=closed(f),outcome=event(f,'host_outcome',{outcome:'succeeded'}),before=f.repo.exportBackup(),db=pnwCreateDb(f.repo.path);
  db.exec("CREATE TRIGGER native_atomic_failure BEFORE UPDATE ON desk_batch_step BEGIN SELECT RAISE(ABORT,'synthetic native write failure'); END");db.close();
  expect(()=>f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,outcome,result)).toThrow(/synthetic native write failure/);expect(f.repo.exportBackup()).toEqual(before);
  const clear=pnwCreateDb(f.repo.path);clear.exec('DROP TRIGGER native_atomic_failure');clear.close();expect(f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,outcome,result).status).toBe('succeeded');
 });
 it.each(['hash','node','source','profile','process','old_recipe','length','zero_length','zero_volume','output_bytes'] as const)('rejects a successful DTO with wrong %s even when its report hash is recomputed',part=>{
  const f=setup(),result=measurement(f.ticket);if(part==='node')result.saved_entity={node:'OtherFeature',type_id:'Part::Feature'};if(part==='source')result.source={...f.ticket.step.manifest.source,sha256:'0'.repeat(64)};if(part==='profile')result.script_sha256='0'.repeat(64);if(part==='process')result.process_proof={...(result.process_proof as object),nonce:'other-child'};if(part==='old_recipe')result.process_proof={...(result.process_proof as object),execution_sha256:'0'.repeat(64)};
  if(part==='length')(result.bounds_mm as Record<string,number>).x_length=100;if(part==='zero_length'){(result.bounds_mm as Record<string,number>).x_length=0;(result.bounds_mm as Record<string,number>).x_max=0;}if(part==='zero_volume')result.volume_mm3=0;if(part==='output_bytes')(result.process_proof as Record<string,unknown>).output_bytes=256*1024+1;
  closed(f,result);if(part==='hash')result.volume_mm3=7;const before=f.repo.exportBackup();expect(()=>f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,event(f,'host_outcome',{outcome:'succeeded'}),result)).toThrow();expect(f.repo.exportBackup()).toEqual(before);
 });
 it('keeps cancellation a request, never releases unknown Native state or permits late success',()=>{
  const f=setup();f.repo.prepareNativeAttempt(f.ticket);append(f,'spawned',{pid:32101});f.repo.requestCancel(f.detail.run.id);append(f,'cancel_requested');
  expect(()=>f.repo.finishRun(f.detail.run.id,'cancelled')).toThrow();expect(()=>f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,event(f,'host_outcome',{outcome:'cancelled'}))).toThrow();
  append(f,'actual_close',{pid:32101,nonce:f.ticket.binding.child_nonce,observer:'host_child_process_close',exit_code:null,signal:'SIGTERM'});
  expect(f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,event(f,'host_outcome',{outcome:'cancelled'})).status).toBe('cancelled');expect(f.repo.finishRun(f.detail.run.id,'cancelled').status).toBe('cancelled');
 });
 it('allows explicit no-spawn failure only through its durable attempt and keeps queued cancellation simple',()=>{
  const queued=setup(false);expect(queued.repo.requestCancel(queued.detail.run.id).status).toBe('cancelled');expect(queued.repo.listNativeAttempts()).toEqual([]);
  const f=setup();f.repo.prepareNativeAttempt(f.ticket);append(f,'not_spawned',{observer:'host_no_spawn_fact',reason:'preflight_failed'});expect(f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,event(f,'host_outcome',{outcome:'failed'})).status).toBe('failed');
 });
 it('restarts prepared/spawned attempts as uncertain history without replay, kill or modifying a host barrier',()=>{
  for(const spawned of [false,true]){const f=setup();f.repo.prepareNativeAttempt(f.ticket);if(spawned)append(f,'spawned',{pid:32101});const marker=path.join(f.repo.root,'synthetic-external-host-barrier');fs.writeFileSync(marker,'keep unknown ownership');f.repo.close();const next=open(f.repo.root);
   expect(next.getRun(f.detail.run.id)?.run.status).toBe('interrupted');expect(next.claimQueuedRun()).toBeUndefined();expect(next.getNativeAttempt(f.ticket.binding.attempt_id)?.state).toMatchObject({phase:'uncertain',native_barrier:true,projection:'restarted_history',execution_allowed:false,kill_allowed:false});expect(fs.readFileSync(marker,'utf8')).toBe('keep unknown ownership');expect(()=>next.prepareNativeAttempt(f.ticket)).toThrow();}
 });
 it('interrupts a run after uncertain persistence without fabricating parent-lost or close facts',()=>{
  const f=setup();f.repo.prepareNativeAttempt(f.ticket);append(f,'spawned',{pid:32101});const before=f.repo.getNativeAttempt(f.ticket.binding.attempt_id)!.state.events;
  expect(f.repo.finishRun(f.detail.run.id,'interrupted').status).toBe('interrupted');const saved=f.repo.exportBackup().data.native_attempts![0].state;
  expect(saved).toMatchObject({projection:'restarted_history',phase:'uncertain',native_barrier:true,close:null,parent_lost:false,execution_allowed:false,kill_allowed:false});expect(saved.events).toEqual(before);expect(()=>append(f,'actual_close',{pid:32101,nonce:f.ticket.binding.child_nonce,observer:'host_child_process_close',exit_code:0,signal:null})).toThrow();
 });
 it('rejects Native result accessors and unknown oversized fields without evaluating them',()=>{
  const f=setup(),result=closed(f),outcome=event(f,'host_outcome',{outcome:'succeeded'});let called=0;
  const accessor={...result};Object.defineProperty(accessor,'volume_mm3',{enumerable:true,get(){called++;return 6;}});expect(()=>f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,outcome,accessor)).toThrow();expect(called).toBe(0);
  expect(()=>f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,outcome,{...result,unknown:'x'.repeat(256*1024+1)})).toThrow();
  const raw=event(f,'timeout');Object.defineProperty(raw,'type',{enumerable:true,get(){called++;return 'timeout';}});expect(()=>f.repo.appendNativeEvent(f.ticket.binding.attempt_id,raw)).toThrow();expect(called).toBe(0);
 });
 it('round-trips complete and unknown native histories without restoring any execution eligibility',()=>{
  const f=setup(),result=closed(f);f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,event(f,'host_outcome',{outcome:'succeeded'}),result);f.repo.finishRun(f.detail.run.id,'succeeded');const backup=f.repo.exportBackup(),target=fixture();target.restoreBackup(backup);
  expect(target.getRun(f.detail.run.id)?.steps[0]).toMatchObject({status:'succeeded',result});expect(target.getNativeAttempt(f.ticket.binding.attempt_id)?.state).toMatchObject({phase:'closed',execution_allowed:false,kill_allowed:false,eligibility:{eligible_for_succeeded:false}});
  const active=setup();active.repo.prepareNativeAttempt(active.ticket);const activeBackup=active.repo.exportBackup(),other=fixture();other.restoreBackup(activeBackup);expect(other.getNativeAttempt(active.ticket.binding.attempt_id)?.state).toMatchObject({phase:'uncertain',native_barrier:true});expect(other.claimQueuedRun()).toBeUndefined();
 });
 it('rejects checksum-recomputed missing attempts, higher-version content and forged terminal claims',()=>{
  const f=setup(),result=closed(f);f.repo.commitNativeMeasurement(f.ticket.binding.attempt_id,event(f,'host_outcome',{outcome:'succeeded'}),result);f.repo.finishRun(f.detail.run.id,'succeeded');
  for(const change of ['missing','version','result','length','zero_volume','output_bytes']){const backup=structuredClone(f.repo.exportBackup());if(change==='missing')backup.data.native_attempts=[];if(change==='version'){backup.version=2;backup.schema_version=2;delete backup.data.native_attempts;}if(change==='result')backup.data.runs[0].steps[0].result!.manifest_sha256='0'.repeat(64);
   if(change==='length'||change==='zero_volume'||change==='output_bytes'){const dto=backup.data.runs[0].steps[0].result!;if(change==='length')(dto.bounds_mm as Record<string,number>).x_length=100;else if(change==='zero_volume')dto.volume_mm3=0;else (dto.process_proof as Record<string,unknown>).output_bytes=256*1024+1;const digest=sha(JSON.stringify(dto)),attempt=backup.data.native_attempts![0];attempt.state={...attempt.state,report:{...attempt.state.report!,sha256:digest},events:attempt.state.events.map(event=>event.type==='report_ready'?{...event,sha256:digest}:event)};expect(()=>validateNativeAttempt(attempt.state)).not.toThrow();}
   backup.checksum=sha(JSON.stringify(backup.data));expect(()=>fixture().restoreBackup(backup as BatchBackup)).toThrow();}
  const unfinished=setup();unfinished.repo.prepareNativeAttempt(unfinished.ticket);const forged=structuredClone(unfinished.repo.exportBackup());forged.data.runs[0].run={...forged.data.runs[0].run,status:'failed',failed:1};delete forged.data.runs[0].run.active_step_id;forged.data.runs[0].steps[0].status='failed';forged.checksum=sha(JSON.stringify(forged.data));expect(()=>fixture().restoreBackup(forged)).toThrow();
 });
});
