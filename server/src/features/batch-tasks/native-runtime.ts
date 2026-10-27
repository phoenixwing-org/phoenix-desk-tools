import {createHash,randomUUID} from 'node:crypto';
import os from 'node:os';
import type {ActionDescriptor,BatchTask,TaskDraft,BatchRun} from '../../../../shared/batch-tasks/contracts.js';
import {canonicalNativePlanV3Payload,createNativeBatchPlanV3,validateNativeBatchPlanV3,type NativeBatchPlanV3} from '../../../../shared/batch-tasks/native-envelope.js';
import {canonicalNativeProfileV3Payload,canonicalPreparedNativeTicketV3Payload,compileNativePreparedStepV3,compilePreparedNativeTicketV3,
  NATIVE_SAVED_SHAPE_ACTION_V3,type NativeSnapshotProfileV3} from '../../../../shared/batch-tasks/native-protocol.js';
import type {NativeAttemptEvent} from '../../../../shared/batch-tasks/native-attempt.js';
import {canonicalSingleFeatureManifestPayload,prepareSingleFeatureManifest} from '../cad-native-measurement/manifest.js';
import {bindNativeTaskTicket,measureSavedBrepSnapshot,NativeMeasurementError,SAVED_BREP_SNAPSHOT_IDENTITY,verifyFrozenNativeEngine,
  type FrozenNativeEngine,type NativeCloseProof,type NativeSpawnProof} from '../cad-native-measurement/runner.js';
import {BatchRepository} from './repository.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const KEY=NATIVE_SAVED_SHAPE_ACTION_V3.key;
export interface NativeBatchRuntimeOptions {engine:FrozenNativeEngine;timeout_ms?:number}
export class NativeBatchRuntimeError extends Error {
  constructor(readonly code:'invalid_native_task'|'native_plan_changed'|'native_source_unavailable'|'native_cancelled'|'native_binding_mismatch'|'native_ledger_uncertain'){
    super(code);this.name='NativeBatchRuntimeError';
  }
}
function requireFact(fact:unknown,code:NativeBatchRuntimeError['code']):asserts fact{if(!fact)throw new NativeBatchRuntimeError(code);}
function record(value:unknown,keys:string[]):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const own=Reflect.ownKeys(value);return own.length===keys.length&&own.every(key=>typeof key==='string'&&keys.includes(key)&&Object.getOwnPropertyDescriptor(value,key)?.enumerable&&'value'in Object.getOwnPropertyDescriptor(value,key)!);
}
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const terminal=(status:string)=>!['pending','running'].includes(status);

/** Explicit host-injected Native pilot. There is no environment/default discovery,
 * secondary queue, directory scan, CAD/cache write or DTO-to-executable path.
 * Version metadata is host-pinned and must also match the actual Native report. */
export class NativeBatchRuntime {
  readonly descriptor:ActionDescriptor={key:KEY,version:1,title:'保存形状尺寸（Native 试点）',description:'仅显式单文件/节点的保存 BRep；不证明参数新鲜度或文档坐标，不写 CAD/业务缓存',
    effects:[...NATIVE_SAVED_SHAPE_ACTION_V3.effects],phase:'collect',cancellable:true,scope:'file',source_read_only:true,cancellation:'owned_process',result_schema_version:1,algorithm_version:'saved-brep-snapshot-native-bounds-v1'};
  private readonly engine:FrozenNativeEngine;
  private readonly profile:NativeSnapshotProfileV3;
  private readonly profileSha:string;
  private readonly session=randomUUID();
  private readonly host=sha(os.hostname());
  constructor(private readonly root:string,private readonly repository:BatchRepository,options:NativeBatchRuntimeOptions){
    this.engine=verifyFrozenNativeEngine(options.engine);
    this.profile={key:'freecad.saved-brep-snapshot',version:1,measurement_profile:'saved_brep_snapshot',algorithm_version:'saved-brep-snapshot-native-bounds-v1',
      script_sha256:SAVED_BREP_SNAPSHOT_IDENTITY.script_sha256,engine:{key:'freecadcmd',bytes:this.engine.bytes,sha256:this.engine.sha256,app_version:[...this.engine.app_version],occ_version:this.engine.occ_version},timeout_ms:options.timeout_ms??120_000};
    // Exact profile validation also enforces the host-only bounded timeout.
    this.profileSha=sha(canonicalNativeProfileV3Payload(this.profile));
  }
  validateDraft(value:unknown):TaskDraft{
    requireFact(record(value,['name','subjects','actions']),'invalid_native_task');
    requireFact(typeof value.name==='string'&&!!value.name.trim()&&value.name.length<=120&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.name),'invalid_native_task');
    requireFact(Array.isArray(value.subjects)&&value.subjects.length===1&&Array.isArray(value.actions)&&value.actions.length===1,'invalid_native_task');
    const subject=value.subjects[0],action=value.actions[0];
    requireFact(record(subject,['kind','rel','node'])&&subject.kind==='file'&&typeof subject.rel==='string'&&subject.rel.length<=4096&&/\.FCStd$/i.test(subject.rel)
      &&!/[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(subject.rel)&&subject.rel.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&!['node_modules','__pycache__'].includes(part))
      &&typeof subject.node==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(subject.node),'invalid_native_task');
    requireFact(record(action,['instance_id','key','version','params'])&&id(action.instance_id)&&action.key===KEY&&action.version===1&&record(action.params,[]),'invalid_native_task');
    return {name:value.name.trim(),subjects:[{kind:'file',rel:subject.rel,node:subject.node}],actions:[{instance_id:action.instance_id,key:KEY,version:1,params:{}}]};
  }
  async preview(task:BatchTask,signal?:AbortSignal):Promise<NativeBatchPlanV3>{
    const draft=this.validateDraft({name:task.name,subjects:task.subjects,actions:task.actions});
    requireFact(!signal?.aborted,'native_cancelled');verifyFrozenNativeEngine(this.engine);
    const subject=draft.subjects[0],selected=await prepareSingleFeatureManifest(this.root,{rel:subject.rel,node:subject.node!,profile:'saved_brep_snapshot',signal});
    requireFact(selected.status==='ready','native_source_unavailable');requireFact(!signal?.aborted,'native_cancelled');
    const current=this.repository.getTask(task.id);requireFact(current&&!current.archived&&current.revision===task.revision,'native_plan_changed');
    const step=compileNativePreparedStepV3({step_id:randomUUID(),item_id:randomUUID(),subject:{kind:'file',rel:subject.rel,node:subject.node!},manifest:selected.manifest,profile:this.profile,profile_sha256:this.profileSha});
    const prepared={protocol_version:3,id:randomUUID(),task_id:task.id,task_revision:task.revision,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+15*60_000).toISOString(),action_instance_id:draft.actions[0].instance_id,step};
    return structuredClone(createNativeBatchPlanV3(prepared,sha(canonicalNativePlanV3Payload(prepared))));
  }
  async verify(input:NativeBatchPlanV3,signal?:AbortSignal):Promise<void>{
    const plan=validateNativeBatchPlanV3(input),step=plan.prepared.step;
    requireFact(sha(canonicalNativePlanV3Payload(plan.prepared))===plan.digest&&canonicalNativeProfileV3Payload(step.profile)===canonicalNativeProfileV3Payload(this.profile)
      &&step.profile_sha256===this.profileSha,'native_plan_changed');
    requireFact(!signal?.aborted,'native_cancelled');verifyFrozenNativeEngine(this.engine);
    const current=await prepareSingleFeatureManifest(this.root,{rel:step.subject.rel,node:step.subject.node,profile:'saved_brep_snapshot',signal});
    requireFact(current.status==='ready','native_source_unavailable');requireFact(current.manifest.manifest_sha256===step.manifest.manifest_sha256
      &&canonicalSingleFeatureManifestPayload(current.manifest)===canonicalSingleFeatureManifestPayload(step.manifest),'native_plan_changed');
    requireFact(!signal?.aborted,'native_cancelled');
  }
  async execute(run:BatchRun,input:NativeBatchPlanV3,signal:AbortSignal):Promise<void>{
    let attemptId:string|undefined,spawned:NativeSpawnProof|undefined,closed:NativeCloseProof|undefined,portCalled=false,stepStarted=false;
    const plan=validateNativeBatchPlanV3(input),step=plan.prepared.step;
    let sequence=0,lastAt=Date.now();const events=new Map<string,NativeAttemptEvent>();
    const append=(key:string,payload:Record<string,unknown>)=>{
      requireFact(attemptId,'native_binding_mismatch');let event=events.get(key);
      if(!event){lastAt=Math.max(lastAt,Date.now());event={id:randomUUID(),attempt_id:attemptId,session_nonce:this.session,at:new Date(lastAt).toISOString(),...payload} as NativeAttemptEvent;events.set(key,event);}
      return this.repository.appendNativeEvent(attemptId,event);
    };
    const finish=()=>{
      const detail=this.repository.getRun(run.id);requireFact(detail,'native_ledger_uncertain');
      if(!['running','cancel_requested'].includes(detail.run.status))return;
      const outcome=detail.steps[0].status;
      this.repository.finishRun(run.id,outcome==='succeeded'?'succeeded':outcome==='cancelled'?'cancelled':outcome==='interrupted'?'interrupted':'failed');
    };
    try{
      requireFact(run.plan_id===plan.id&&run.task_id===plan.task_id&&run.task_revision===plan.task_revision,'native_binding_mismatch');
      if(signal.aborted||this.repository.getRun(run.id)?.run.cancel_requested){this.repository.finishRun(run.id,'cancelled','尚未启动 Native：取消已确认');return;}
      await this.verify(plan,signal);
      this.repository.startStep(run.id,step.step_id);
      stepStarted=true;
      attemptId=randomUUID();lastAt=Math.max(lastAt,Date.now());
      const binding={attempt_id:attemptId,run_id:run.id,step_id:step.step_id,plan_digest:plan.digest,host_id:this.host,session_nonce:this.session,child_nonce:randomUUID(),prepared_at:new Date(lastAt).toISOString(),
        profile:{key:step.profile.key,version:step.profile.version},profile_sha256:step.profile_sha256,script_sha256:step.profile.script_sha256,engine_sha256:step.profile.engine.sha256,source_manifest_sha256:step.manifest.manifest_sha256,result_schema_version:1,expected_item_ids:[step.item_id]};
      const ticket=compilePreparedNativeTicketV3({binding,step,execution_digest_claim:sha(canonicalPreparedNativeTicketV3Payload({binding,step}))});
      const privateTicket=bindNativeTaskTicket(this.root,ticket);
      // No process launch is possible before this exact prepared transaction.
      this.repository.prepareNativeAttempt(ticket);
      const check=(proof:NativeSpawnProof)=>requireFact(proof.nonce===binding.child_nonce&&proof.execution_sha256===ticket.execution_digest_claim
        &&proof.manifest_sha256===step.manifest.manifest_sha256&&proof.script_sha256===step.profile.script_sha256&&proof.engine_sha256===step.profile.engine.sha256
        &&proof.timeout_ms===step.profile.timeout_ms&&proof.measurement_profile==='saved_brep_snapshot','native_binding_mismatch');
      portCalled=true;
      await measureSavedBrepSnapshot(this.root,step.manifest,this.engine,{signal,taskTicket:privateTicket,timeout_ms:step.profile.timeout_ms,
        onSpawn:proof=>{check(proof);spawned=proof;append('spawned',{type:'spawned',pid:proof.owned_pid});},
        onLifecycle:event=>{requireFact(spawned,'native_binding_mismatch');append(event.type==='cancel_requested'?'cancel_requested':'lifecycle_'+sequence++,event);},
        onClose:proof=>{
          check(proof);requireFact(spawned&&spawned.owned_pid===proof.owned_pid,'native_binding_mismatch');closed=proof;
          // Idempotently confirm the genuine spawn even if its first DB reply was uncertain.
          append('spawned',{type:'spawned',pid:proof.owned_pid});
          if(proof.owner_acknowledged)append('owner_acked',{type:'owner_acked',pid:proof.owned_pid,nonce:proof.nonce});
          append('actual_close',{type:'actual_close',pid:proof.owned_pid,nonce:proof.nonce,observer:'host_child_process_close',exit_code:proof.exit_code,signal:proof.signal});
        },
        onVerifiedMeasurement:result=>{
          requireFact(closed&&result.process_proof.owned_pid===closed.owned_pid,'native_binding_mismatch');
          if(signal.aborted||this.repository.getRun(run.id)?.run.cancel_requested){
            append('cancel_requested',{type:'cancel_requested'});
            lastAt=Math.max(lastAt,Date.now());this.repository.commitNativeMeasurement(attemptId!,{id:randomUUID(),attempt_id:attemptId!,session_nonce:this.session,at:new Date(lastAt).toISOString(),type:'host_outcome',outcome:'cancelled'},undefined,'核验后收到取消，未发布测量结果');return;
          }
          append('report_ready',{type:'report_ready',pid:result.process_proof.owned_pid,nonce:result.process_proof.nonce,schema_version:1,sha256:sha(JSON.stringify(result)),source_manifest_sha256:step.manifest.manifest_sha256,item_ids:[step.item_id],valid:true});
          append('sources_rechecked',{type:'sources_rechecked',expected_manifest_sha256:step.manifest.manifest_sha256,observed_manifest_sha256:step.manifest.manifest_sha256,status:'matched'});
          lastAt=Math.max(lastAt,Date.now());this.repository.commitNativeMeasurement(attemptId!,{id:randomUUID(),attempt_id:attemptId!,session_nonce:this.session,at:new Date(lastAt).toISOString(),type:'host_outcome',outcome:'succeeded'},result);
        },
      });
      finish();
    }catch(error){
      try{
        const detail=this.repository.getRun(run.id);requireFact(detail,'native_ledger_uncertain');
        if(!['running','cancel_requested'].includes(detail.run.status))return;
        if(terminal(detail.steps[0].status)){
          if(error instanceof NativeMeasurementError&&['cleanup_failed','host_barrier_uncertain'].includes(error.code)){
            this.repository.finishRun(run.id,'failed','测量步骤已记录，但 Native 清理或执行门禁需核对：'+error.code);return;
          }
          finish();return;
        }
        const cancelled=signal.aborted||detail.run.cancel_requested;
        if(attemptId&&closed){
          if(cancelled)append('cancel_requested',{type:'cancel_requested'});
          lastAt=Math.max(lastAt,Date.now());this.repository.commitNativeMeasurement(attemptId,{id:randomUUID(),attempt_id:attemptId,session_nonce:this.session,at:new Date(lastAt).toISOString(),type:'host_outcome',outcome:cancelled?'cancelled':'failed'},undefined,
            'Native 采集未完成：'+(error instanceof NativeMeasurementError?error.code:'native_ledger_uncertain'));
          finish();return;
        }
        // Absence of onSpawn is NOT a no-spawn proof. A live call with uncertain
        // persistence is history-only; never synthesize close/not_spawned/kill.
        this.repository.finishRun(run.id,portCalled||stepStarted?'interrupted':cancelled?'cancelled':'failed',portCalled||stepStarted?'Native 归属或任务记录未能完整确认，不自动重放':'Native 预检未通过，未启动测量');
      }catch{throw new NativeBatchRuntimeError('native_ledger_uncertain');}
    }
  }
}
