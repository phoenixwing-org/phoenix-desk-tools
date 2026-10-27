/** Pure v2 frozen-payload model: no v1 upgrade, I/O, digest or execution authority. */
export const NEXT_PROTOCOL_VERSION = 2 as const;
export const NEXT_PLAN_LIMITS = Object.freeze({items:200,actions:8,sources:2000,resources:2001,steps:1600,bytes:2*1024*1024});
export type NextEffect = 'read_file'|'read_cache'|'write_task_db';
export type NextSubject = {readonly kind:'file'|'cad_model';readonly rel:string};
export type NextActionSelection = {readonly instance_id:string;readonly key:string;readonly version:number;readonly params:Readonly<Record<string,never>>};
export type NextDescriptor = {
  readonly key:string;readonly version:number;readonly scope:'file'|'batch';readonly effects:readonly NextEffect[];
  readonly source_read_only:true;readonly cancellation:'cooperative';readonly result_schema_version:number;readonly algorithm_version:string;
};
/** A cache lease may create its own temporary coordination lock. It never reclaims somebody else's lock. */
export type NextCacheLease = {readonly mode:'host_read_only';readonly temporary_coordination:true;readonly ownership:'own_lock_only';readonly reclaim:false};
export type NextResource =
  | {readonly id:string;readonly kind:'file';readonly rel:string;readonly access:'read'}
  | {readonly id:string;readonly kind:'cache';readonly key:string;readonly access:'read';readonly lease:NextCacheLease}
  | {readonly id:string;readonly kind:'task_db';readonly key:'batch_tasks';readonly access:'write'};
export type NextSource =
  | ({readonly id:string;readonly kind:'file';readonly resource_id:string;readonly rel:string} & (
    | {readonly bytes:number;readonly sha256:string;readonly error?:never}
    | {readonly bytes:null;readonly sha256:null;readonly error:string}))
  // sha256 is the host's coherent, bounded projection digest, not a claim that hashing a live DB is safe.
  | ({readonly id:string;readonly kind:'cache';readonly resource_id:string;readonly selector:string;readonly schema_version:number;readonly algorithm_version:string} & (
    | {readonly sha256:string;readonly error?:never}
    | {readonly sha256:null;readonly error:string}));
export type NextItem = {readonly id:string;readonly subject:NextSubject;readonly source_id:string;readonly error?:string};
export type NextTarget = {readonly scope:'file';readonly item_id:string}|{readonly scope:'batch';readonly item_ids:readonly string[]};
export type NextPreparedStep = {
  readonly id:string;readonly action_instance_id:string;readonly target:NextTarget;
  readonly source_ids:readonly string[];readonly resource_ids:readonly string[];readonly status:'ready'|'blocked'|'not_applicable';readonly reason?:string;
};
export type NextPlanInput = {
  readonly id:string;readonly task_id:string;readonly task_revision:number;readonly created_at:string;readonly expires_at:string;
  readonly items:readonly NextItem[];readonly actions:readonly NextActionSelection[];readonly descriptors:readonly NextDescriptor[];
  readonly sources:readonly NextSource[];readonly resources:readonly NextResource[];readonly steps:readonly NextPreparedStep[];
};
export type NextPlan = NextPlanInput & {
  readonly protocol_version:2;readonly effects:readonly NextEffect[];readonly completeness:'complete'|'incomplete';
  readonly summary:{readonly files:number;readonly actions:number;readonly file_steps:number;readonly batch_steps:number;readonly ready:number;readonly blocked:number;readonly not_applicable:number};
};
export class NextProtocolError extends Error {
  constructor(readonly code:'invalid_plan'|'unknown_effect'|'incomplete_scope'|'limit',message:string){super(message);this.name='NextProtocolError';}
}
function fail(message:string,code:NextProtocolError['code']='invalid_plan'):never{throw new NextProtocolError(code,message);}
type RecordValue=Record<string,unknown>;
const EFFECTS:readonly NextEffect[]=['read_file','read_cache','write_task_db'];
const topKeys=['id','task_id','task_revision','created_at','expires_at','items','actions','descriptors','sources','resources','steps'];
function record(value:unknown,keys:readonly string[]):RecordValue{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('Expected a plain data object');
  const ownKeys=Reflect.ownKeys(value);if(ownKeys.length>keys.length||ownKeys.some(key=>typeof key!=='string'||!keys.includes(key)))fail('Unknown fields are not accepted');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(ownKeys.some(key=>typeof key!=='string'||!keys.includes(key))
    ||Object.values(descriptors).some(d=>!('value'in d)||!d.enumerable))fail('Unknown fields or executable properties are not accepted');
  return value as RecordValue;
}
function string(value:unknown,max=100):string{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))fail('Invalid bounded text');return value;
}
function id(value:unknown):string{const result=string(value);if(!/^[A-Za-z0-9_-]+$/u.test(result))fail('Invalid identifier');return result;}
function key(value:unknown):string{const result=string(value);if(!/^[a-z][a-z0-9_.-]*$/u.test(result))fail('Invalid registered key');return result;}
function positive(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<1)fail('Expected a positive version or revision');return Number(value);}
function rel(value:unknown):string{
  const result=string(value,2048);
  if(/[\\:]/u.test(result)||result.startsWith('/')||result.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||['node_modules','__pycache__'].includes(p)))fail('Expected an explicit safe relative file');
  return result;
}
function sha(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))fail('Every source requires an explicit SHA256');return value;}
function array(value:unknown,max:number,min=1):unknown[]{
  if(!Array.isArray(value)||value.length<min||value.length>max)fail('Collection exceeds its explicit budget','limit');
  if(Object.getPrototypeOf(value)!==Array.prototype||Reflect.ownKeys(value).length>max+1)fail('Expected an ordinary bounded data array');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/u.test(k)||Number(k)>=value.length))
    ||Array.from({length:value.length},(_,i)=>descriptors[String(i)]).some(d=>!d||!('value'in d)||!d.enumerable))fail('Expected a dense data array');
  return value;
}
function unique<T>(values:readonly T[],keyOf:(item:T)=>string):void{if(new Set(values.map(keyOf)).size!==values.length)fail('Duplicate manifest entries are not accepted');}
function ids(value:unknown,max:number=NEXT_PLAN_LIMITS.sources):string[]{const values=array(value,max).map(id);unique(values,v=>v);return values.sort();}
const fold=(value:string)=>value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
const actionId=(value:{key:string;version:number})=>`${value.key}@${value.version}`;
function effects(value:unknown):NextEffect[]{
  const values=array(value,EFFECTS.length).map(v=>{if(!EFFECTS.includes(v as NextEffect))fail('Unknown or non-readonly effect','unknown_effect');return v as NextEffect;});
  unique(values,v=>v);return EFFECTS.filter(effect=>values.includes(effect));
}
function equal(left:unknown,right:unknown):boolean{return stable(left)===stable(right);}
function stable(value:unknown):string{
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable((value as RecordValue)[k])}`).join(',')}}`;
  return fail('Non-JSON data is not accepted');
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

/** Compile a proposed payload, NOT admission/execution authority. Ordering is action-major, then explicit input order. */
export function compilePlanV2(input:NextPlanInput):NextPlan{
  const p=record(input,topKeys),planId=id(p.id),taskId=id(p.task_id),revision=positive(p.task_revision);
  const created=string(p.created_at,40),expires=string(p.expires_at,40);
  if(!Number.isFinite(Date.parse(created))||!Number.isFinite(Date.parse(expires))||Date.parse(expires)<=Date.parse(created))fail('Invalid plan lifetime');
  const resources=array(p.resources,NEXT_PLAN_LIMITS.resources).map(value=>{
    const base=record(value,['id','kind','rel','key','access','lease']),resourceId=id(base.id);
    if(base.kind==='file'){record(value,['id','kind','rel','access']);if(base.access!=='read')fail('Source writes are not supported');return {id:resourceId,kind:'file',rel:rel(base.rel),access:'read'} as const;}
    if(base.kind==='cache'){
      record(value,['id','kind','key','access','lease']);const lease=record(base.lease,['mode','temporary_coordination','ownership','reclaim']);
      if(base.access!=='read'||lease.mode!=='host_read_only'||lease.temporary_coordination!==true||lease.ownership!=='own_lock_only'||lease.reclaim!==false)fail('Cache access must declare an owned, non-reclaiming host read-only lease');
      return {id:resourceId,kind:'cache',key:key(base.key),access:'read',lease:{mode:'host_read_only',temporary_coordination:true,ownership:'own_lock_only',reclaim:false}} as const;
    }
    if(base.kind==='task_db'){record(value,['id','kind','key','access']);if(base.key!=='batch_tasks'||base.access!=='write')fail('Only the task ledger may be written');return {id:resourceId,kind:'task_db',key:'batch_tasks',access:'write'} as const;}
    return fail('Unknown resource kind');
  }).sort((a,b)=>a.id<b.id?-1:1);
  unique(resources,r=>r.id);unique(resources,r=>r.kind==='file'?`file:${fold(r.rel)}`:`${r.kind}:${r.key}`);
  const ledgers=resources.filter(r=>r.kind==='task_db');if(ledgers.length!==1)fail('Exactly one task ledger resource is required');
  const resourceMap=new Map(resources.map(r=>[r.id,r]));
  const sources=array(p.sources,NEXT_PLAN_LIMITS.sources).map(value=>{
    const s=record(value,['id','kind','resource_id','rel','bytes','sha256','selector','schema_version','algorithm_version','error']);
    const sourceId=id(s.id),resourceId=id(s.resource_id),resource=resourceMap.get(resourceId);
    const observation=s.error===undefined?{sha256:sha(s.sha256)}:{sha256:null,error:string(s.error,2048)};
    if(s.error!==undefined&&s.sha256!==null)fail('Unavailable sources must not claim a fingerprint');
    if(s.kind==='file'){
      record(value,['id','kind','resource_id','rel','bytes','sha256','error']);const relative=rel(s.rel);
      if(!resource||resource.kind!=='file'||resource.rel!==relative)fail('File source does not match its read resource');
      if(s.error!==undefined){if(s.bytes!==null)fail('Unavailable files require null bytes');return {id:sourceId,kind:'file',resource_id:resourceId,rel:relative,bytes:null,sha256:null,error:observation.error!} as const;}
      if(!Number.isSafeInteger(s.bytes)||Number(s.bytes)<0||Number(s.bytes)>64*1024*1024)fail('File source does not match a bounded read resource');
      return {id:sourceId,kind:'file',resource_id:resourceId,rel:relative,bytes:Number(s.bytes),sha256:observation.sha256!} as const;
    }
    if(s.kind==='cache'){
      record(value,['id','kind','resource_id','selector','sha256','schema_version','algorithm_version','error']);
      if(!resource||resource.kind!=='cache')fail('Cache projection requires a cache-read resource');
      return {id:sourceId,kind:'cache',resource_id:resourceId,selector:string(s.selector,2048),...observation,schema_version:positive(s.schema_version),algorithm_version:string(s.algorithm_version)} as NextSource;
    }
    return fail('Unknown source kind');
  }).sort((a,b)=>a.id<b.id?-1:1);
  unique(sources,s=>s.id);unique(sources,s=>s.kind==='file'?`file:${fold(s.rel)}`:`cache:${s.resource_id}:${s.selector}`);
  const sourceMap=new Map(sources.map(s=>[s.id,s]));
  const items=array(p.items,NEXT_PLAN_LIMITS.items).map(value=>{
    const item=record(value,['id','subject','source_id','error']),subject=record(item.subject,['kind','rel']),source=sourceMap.get(id(item.source_id));
    if(typeof subject.kind!=='string'||!['file','cad_model'].includes(subject.kind))fail('Invalid subject kind');
    const relative=rel(subject.rel);if(!source||source.kind!=='file'||source.rel!==relative)fail('Selected item is missing its exact file source');
    const error=item.error===undefined?undefined:string(item.error,2048);if(error!==source.error)fail('Unavailable items must retain the exact source error');
    return {id:id(item.id),subject:{kind:subject.kind as NextSubject['kind'],rel:relative},source_id:source.id,...(error===undefined?{}:{error})};
  });
  unique(items,item=>item.id);unique(items,item=>fold(item.subject.rel));const itemMap=new Map(items.map(item=>[item.id,item]));
  const actions=array(p.actions,NEXT_PLAN_LIMITS.actions).map(value=>{
    const a=record(value,['instance_id','key','version','params']);record(a.params,[]);
    return {instance_id:id(a.instance_id),key:key(a.key),version:positive(a.version),params:{}};
  });unique(actions,a=>a.instance_id);const actionMap=new Map(actions.map(a=>[a.instance_id,a]));
  const descriptors=array(p.descriptors,NEXT_PLAN_LIMITS.actions).map(value=>{
    const d=record(value,['key','version','scope','effects','source_read_only','cancellation','result_schema_version','algorithm_version']);
    if(typeof d.scope!=='string'||!['file','batch'].includes(d.scope)||d.source_read_only!==true||d.cancellation!=='cooperative')fail('Only cooperative source-read-only action descriptors are supported');
    return {key:key(d.key),version:positive(d.version),scope:d.scope as 'file'|'batch',effects:effects(d.effects),source_read_only:true as const,cancellation:'cooperative' as const,result_schema_version:positive(d.result_schema_version),algorithm_version:string(d.algorithm_version)};
  });unique(descriptors,actionId);
  const descriptorMap=new Map(descriptors.map(d=>[actionId(d),d]));
  if(actions.some(a=>!descriptorMap.has(actionId(a)))||descriptors.some(d=>!actions.some(a=>actionId(a)===actionId(d))))fail('Selections and frozen descriptors must match exactly');
  const orderedDescriptors=[...new Map(actions.map(a=>[actionId(a),descriptorMap.get(actionId(a))!])).values()];
  const steps=array(p.steps,NEXT_PLAN_LIMITS.steps).map(value=>{
    const s=record(value,['id','action_instance_id','target','source_ids','resource_ids','status','reason']),action=actionMap.get(id(s.action_instance_id));
    if(!action)fail('Step action is not selected');const descriptor=descriptorMap.get(actionId(action))!;
    const target=record(s.target,['scope','item_id','item_ids']);let resolved:NextTarget;let inputItems:typeof items;
    if(target.scope==='file'){
      record(s.target,['scope','item_id']);const item=itemMap.get(id(target.item_id));if(!item||descriptor.scope!=='file')fail('Invalid file target','incomplete_scope');
      resolved={scope:'file',item_id:item.id};inputItems=[item];
    }else if(target.scope==='batch'){
      record(s.target,['scope','item_ids']);const inputIds=array(target.item_ids,NEXT_PLAN_LIMITS.items).map(id);
      if(descriptor.scope!=='batch'||!equal(inputIds,items.map(item=>item.id)))fail('Batch target must cover the entire explicit input list in order','incomplete_scope');
      resolved={scope:'batch',item_ids:[...inputIds]};inputItems=items;
    }else return fail('Unknown target scope','incomplete_scope');
    const sourceIds=ids(s.source_ids),resourceIds=ids(s.resource_ids,NEXT_PLAN_LIMITS.resources);
    if(sourceIds.some(sourceId=>!sourceMap.has(sourceId))||inputItems.some(item=>!sourceIds.includes(item.source_id)))fail('Step omits an input source or references an unknown source','incomplete_scope');
    const usedSources=sourceIds.map(sourceId=>sourceMap.get(sourceId)!);
    const requiredResources=[...new Set([...usedSources.map(source=>source.resource_id),ledgers[0].id])].sort();
    if(!equal(resourceIds,requiredResources))fail('Step resource declaration must exactly cover its sources and ledger');
    const actualEffects=EFFECTS.filter(effect=>effect==='write_task_db'||usedSources.some(source=>source.kind===(effect==='read_file'?'file':'cache')));
    if(typeof s.status!=='string'||!['ready','blocked','not_applicable'].includes(s.status))fail('Step preparation status must be explicit');
    // A blocked/not-applicable step does not perform optional domain reads.
    // Its declared capability remains visible, but absent cache resources are
    // not fabricated just to make an excluded step look executable.
    if(s.status==='ready'?!equal(descriptor.effects,actualEffects):actualEffects.some(effect=>!descriptor.effects.includes(effect)))fail('Descriptor effects do not match actual frozen resources','unknown_effect');
    const reason=s.reason===undefined?undefined:string(s.reason,2048);if(s.status!=='ready'&&!reason)fail('Non-ready steps need an explicit reason');
    if(usedSources.some(source=>source.error!==undefined)&&s.status!=='blocked')fail('Incomplete observations must block every affected step','incomplete_scope');
    return {id:id(s.id),action_instance_id:action.instance_id,target:resolved,source_ids:sourceIds,resource_ids:resourceIds,status:s.status as NextPreparedStep['status'],...(reason===undefined?{}:{reason})};
  });unique(steps,s=>s.id);
  const orderedSteps:NextPreparedStep[]=[];
  for(const action of actions){
    const matching=steps.filter(s=>s.action_instance_id===action.instance_id),descriptor=descriptorMap.get(actionId(action))!;
    if(descriptor.scope==='batch'){
      if(matching.length!==1||matching[0].target.scope!=='batch')fail('Each batch action requires exactly one whole-batch step','incomplete_scope');orderedSteps.push(matching[0]);
    }else{
      if(matching.length!==items.length)fail('Each file action requires one step for every explicit item','incomplete_scope');
      for(const item of items){const found=matching.filter(s=>s.target.scope==='file'&&s.target.item_id===item.id);if(found.length!==1)fail('Missing or duplicated file step','incomplete_scope');orderedSteps.push(found[0]);}
    }
  }
  const usedSourceIds=new Set(steps.flatMap(s=>s.source_ids)),usedResourceIds=new Set(steps.flatMap(s=>s.resource_ids));
  if(sources.some(source=>!usedSourceIds.has(source.id))||resources.some(resource=>!usedResourceIds.has(resource.id)))fail('Unused manifest entries cannot widen the frozen scope');
  const plan:NextPlan={protocol_version:2,id:planId,task_id:taskId,task_revision:revision,created_at:created,expires_at:expires,items,actions,descriptors:orderedDescriptors,sources,resources,steps:orderedSteps,
    completeness:sources.some(source=>source.error!==undefined)?'incomplete':'complete',
    effects:EFFECTS.filter(effect=>descriptors.some(d=>d.effects.includes(effect))),summary:{files:items.length,actions:actions.length,file_steps:steps.filter(s=>s.target.scope==='file').length,batch_steps:steps.filter(s=>s.target.scope==='batch').length,ready:steps.filter(s=>s.status==='ready').length,blocked:steps.filter(s=>s.status==='blocked').length,not_applicable:steps.filter(s=>s.status==='not_applicable').length}};
  if(new TextEncoder().encode(stable(plan)).byteLength>NEXT_PLAN_LIMITS.bytes)fail('Canonical plan exceeds 2 MiB','limit');
  return freeze(plan);
}

/** Exact canonical v2 data only. Versionless v1 and unknown versions never acquire v2 semantics. */
export function validatePlanV2(value:unknown):NextPlan{
  const p=record(value,[...topKeys,'protocol_version','effects','summary','completeness']);if(p.protocol_version!==2)fail('Only explicit protocol_version 2 is accepted');
  if(p.completeness!=='complete'&&p.completeness!=='incomplete')fail('Observation completeness must be explicit');
  const input=Object.fromEntries(topKeys.map(k=>[k,p[k]])) as unknown as NextPlanInput,compiled=compilePlanV2(input);
  // Check claimed summary/effects and canonical list ordering, not merely a repaired projection.
  const summary=record(p.summary,['files','actions','file_steps','batch_steps','ready','blocked','not_applicable']);
  if(Object.values(summary).some(count=>!Number.isSafeInteger(count)||Number(count)<0))fail('Invalid summary count');effects(p.effects);
  if(!equal(value,compiled))fail('Plan summary, effects or frozen ordering is inconsistent');return compiled;
}
/** The host may hash these bytes. No hash is invented and this payload is not execution authorization. */
export function canonicalPlanPayloadV2(value:unknown):string{return stable(validatePlanV2(value));}
