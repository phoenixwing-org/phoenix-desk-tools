import {createHash} from 'node:crypto';
import {isBatchPlannedStep,isBatchStep,isCurrentPlan,isTerminalRun,type ActionDescriptor,type RunDetail,type TaskDraft} from '../../../../shared/batch-tasks/contracts.js';
import {validateCurrentBatchPlan} from '../../../../shared/batch-tasks/envelope.js';
import {canonicalPlanPayloadV2} from '../../../../shared/batch-tasks/next-protocol.js';
import {hasNativeTaskAction,taskDraft} from './model.js';

export interface RetryDraftGroup {
 id:string;action_instance_id:string;action_key:string;action_title:string;action_version:number;
 scope:'file'|'batch';failed_steps:number;available:boolean;reason?:string;draft?:TaskDraft;
}
export interface RetryDrafts {run_id:string;groups:RetryDraftGroup[]}
const retryable=new Set(['failed','blocked','interrupted']);
const terminal=new Set(['succeeded','failed','blocked','interrupted','cancelled','not_applicable']);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const invalid=():never=>{throw new Error('原运行记录与完整冻结计划不一致，未生成重试草稿');};

/** A read-only projection, never a resumed admission or execution capability.
 * Group by the original action INSTANCE: V2 still executes the full Cartesian
 * product of each new definition. A whole-batch action retains all its inputs. */
export function buildRetryDrafts(detail:RunDetail,stored:unknown,catalog:readonly ActionDescriptor[]):RetryDrafts {
 if(!isTerminalRun(detail.run.status))throw new Error('请等待运行结束，再准备失败项重试');
 if(!['succeeded','partial','failed','cancelled','interrupted'].includes(detail.run.status))invalid();
 if(!isCurrentPlan(stored)||hasNativeTaskAction(stored))throw new Error('仅支持普通 V2 只读任务；旧版或 Native 运行不能生成重试草稿');
 const plan=validateCurrentBatchPlan(stored),run=detail.run;
 if(createHash('sha256').update(canonicalPlanPayloadV2(plan.prepared)).digest('hex')!==plan.digest
  ||run.plan_id!==plan.id||run.task_id!==plan.task_id||run.task_revision!==plan.task_revision
  ||run.total!==plan.steps.length||detail.steps.length!==plan.steps.length||run.active_step_id!==undefined)invalid();
 for(const [ordinal,step] of detail.steps.entries()){
  const planned=plan.steps[ordinal],action=plan.actions.find(value=>value.instance_id===planned.action_instance_id)!;
  if(step.id!==planned.id||step.run_id!==run.id||step.action_instance_id!==action.instance_id||step.action_key!==action.key||!terminal.has(step.status))invalid();
  if(isBatchPlannedStep(planned)){
   if(!isBatchStep(step)||'item_id'in step||'subject'in step||!equal(step.item_ids,planned.item_ids)
    ||!equal(step.subjects,planned.item_ids.map(id=>plan.items.find(item=>item.id===id)!.subject)))invalid();
  }else if(isBatchStep(step)||'item_ids'in step||'subjects'in step||step.item_id!==planned.item_id
   ||!equal(step.subject,plan.items.find(item=>item.id===planned.item_id)!.subject))invalid();
  const prepared=plan.prepared.steps[ordinal];if(prepared.status!=='ready'&&step.status!==prepared.status)invalid();
 }
 if(run.completed!==detail.steps.filter(step=>step.status==='succeeded').length
  ||run.failed!==detail.steps.filter(step=>step.status==='failed'||step.status==='blocked').length)invalid();
 if(run.status==='succeeded'&&detail.steps.some(step=>!['succeeded','not_applicable'].includes(step.status))
  ||run.status==='partial'&&(!detail.steps.some(step=>step.status==='succeeded')||!detail.steps.some(step=>['failed','blocked','cancelled','interrupted'].includes(step.status))))invalid();
 const groups:RetryDraftGroup[]=[];
 for(const action of plan.actions){
  const failed=detail.steps.filter(step=>step.action_instance_id===action.instance_id&&retryable.has(step.status));if(!failed.length)continue;
  const frozen=plan.prepared.descriptors.find(descriptor=>descriptor.key===action.key&&descriptor.version===action.version)!;
  const current=catalog.find(descriptor=>descriptor.key===action.key&&descriptor.version===action.version);
  const group:RetryDraftGroup={id:action.instance_id,action_instance_id:action.instance_id,action_key:action.key,
   action_title:current?.title??action.key,action_version:action.version,scope:frozen.scope,failed_steps:failed.length,available:false};
  const descriptor=current&&{key:current.key,version:current.version,scope:current.scope??'file',effects:[...current.effects],source_read_only:current.source_read_only,
   cancellation:current.cancellation,result_schema_version:current.result_schema_version,algorithm_version:current.algorithm_version};
  if(!descriptor||!equal(descriptor,frozen)){group.reason='原动作精确版本或实现已不可用；未自动升级，请另建任务核对';groups.push(group);continue;}
  const failedItems=new Set(failed.flatMap(step=>isBatchStep(step)?step.item_ids:[step.item_id]));
  const subjects=plan.items.filter(item=>failedItems.has(item.id)).map(item=>({...item.subject}));
  // Do not feed a mixed action/file matrix back into V2: only this instance and
  // its failed file inputs; whole-batch inputs were checked against the full plan.
  const draft=taskDraft({name:run.task_name.slice(0,100)+'（失败项重试）',subjects,actions:[structuredClone(action)]},catalog);
  group.available=true;group.draft=draft;groups.push(group);
 }
 return {run_id:run.id,groups};
}
