import {validatePlanV2,type NextPlan} from './next-protocol.js';
import {isCurrentPlan,type BatchPlan,type CurrentBatchPlan,type PlannedStep} from './contracts.js';

export class BatchEnvelopeError extends Error {
  readonly code='invalid_plan';
  constructor(message:string){super(message);this.name='BatchEnvelopeError';}
}
const invalid=():never=>{throw new BatchEnvelopeError('V2 envelope must exactly reflect its complete frozen prepared payload');};
const envelopeKeys=['protocol_version','prepared','id','task_id','task_revision','created_at','expires_at','status','digest','items','actions','steps','effects','summary'];
function envelopeRecord(value:unknown):asserts value is CurrentBatchPlan{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
  const keys=Reflect.ownKeys(value as object);
  if(keys.length!==envelopeKeys.length||keys.some(key=>typeof key!=='string'||!envelopeKeys.includes(key)))invalid();
  for(const key of keys){const property=Object.getOwnPropertyDescriptor(value,key);if(!property||!('value'in property)||!property.enumerable)invalid();}
}
/** Bounded inert JSON comparison: no getters, toJSON, sparse arrays, non-finite numbers or cycles. */
function canonical(value:unknown,seen=new Set<object>(),depth=0,budget={nodes:0}):string{
  if(++budget.nodes>200000||depth>24)invalid();
  if(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(!value||typeof value!=='object'||seen.has(value))return invalid();
  if(Array.isArray(value)&&(Object.getPrototypeOf(value)!==Array.prototype||value.length>200000-budget.nodes))invalid();
  const keys=Reflect.ownKeys(value);if(keys.length>200000-budget.nodes+1)invalid();
  seen.add(value);let result:string;
  const properties=Object.getOwnPropertyDescriptors(value);
  if(Array.isArray(value)){
    if(keys.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/u.test(k)||Number(k)>=value.length)))invalid();
    const entries=Array.from({length:value.length},(_,index)=>properties[String(index)]);
    if(entries.some(entry=>!entry||!('value'in entry)||!entry.enumerable))invalid();
    result=`[${entries.map(entry=>canonical(entry.value,seen,depth+1,budget)).join(',')}]`;
  }else{
    if(![Object.prototype,null].includes(Object.getPrototypeOf(value))||keys.some(k=>typeof k!=='string')||Object.values(properties).some(p=>!('value'in p)||!p.enumerable))invalid();
    result=`{${(keys as string[]).sort().map(k=>`${JSON.stringify(k)}:${canonical(properties[k].value,seen,depth+1,budget)}`).join(',')}}`;
  }
  seen.delete(value);return result;
}

/** Digest is supplied by the host: SHA256(canonicalPlanPayloadV2(prepared)). No authorization is granted here. */
export function createCurrentBatchPlan(value:NextPlan,digest:string,status:BatchPlan['status']='fresh'):CurrentBatchPlan{
  const prepared=validatePlanV2(value);
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/u.test(digest)||!['fresh','consumed','invalidated'].includes(status))invalid();
  const items=prepared.items.map(item=>{
    const source=prepared.sources.find(source=>source.id===item.source_id)!;if(source.kind!=='file')return invalid();
    return {id:item.id,subject:{...item.subject},source_id:item.source_id,sha256:source.sha256,bytes:source.bytes,...(item.error===undefined?{}:{error:item.error})};
  });
  const steps:PlannedStep[]=prepared.steps.map(step=>({id:step.id,action_instance_id:step.action_instance_id,applicable:step.status==='ready',
    ...(step.target.scope==='batch'?{scope:'batch' as const,item_ids:[...step.target.item_ids]}:{scope:'file' as const,item_id:step.target.item_id}),...(step.reason===undefined?{}:{reason:step.reason})}));
  return {protocol_version:2,prepared,id:prepared.id,task_id:prepared.task_id,task_revision:prepared.task_revision,created_at:prepared.created_at,expires_at:prepared.expires_at,status,digest,
    items,actions:prepared.actions.map(action=>({...action,params:{}})),steps,effects:[...prepared.effects],
    summary:{files:prepared.summary.files,actions:prepared.summary.actions,executable:prepared.summary.ready,excluded:prepared.summary.blocked+prepared.summary.not_applicable}};
}

/** V1 history is not upgraded. Every V2 wrapper field and manifest must match exactly, including null observations. */
export function validateCurrentBatchPlan(value:unknown):CurrentBatchPlan{
  // Reject unknown top-level fields/accessors before inspecting data or spending nested JSON budget.
  envelopeRecord(value);
  if(!isCurrentPlan(value))return invalid();
  const expected=createCurrentBatchPlan(value.prepared,value.digest,value.status);
  const original=canonical(value);
  if(original!==canonical(expected))return invalid();
  return expected;
}
