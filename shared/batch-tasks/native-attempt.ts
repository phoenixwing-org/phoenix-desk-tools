/** Pure candidate-state checks, NOT a native-process capability or proof verifier.
 * Serialized host claims cannot grant runtime3 execution, kill or lease-release authority. */
export const NATIVE_ATTEMPT_MODEL_VERSION=1 as const;
export const NATIVE_ATTEMPT_LIMITS=Object.freeze({events:128,items:200,bytes:256*1024,nodes:40000});
export type NativeAttemptSpec={
 readonly attempt_id:string;readonly run_id:string;readonly step_id:string;readonly plan_digest:string;
 readonly host_id:string;readonly session_nonce:string;readonly child_nonce:string;readonly prepared_at:string;
 readonly profile:{readonly key:string;readonly version:number};readonly profile_sha256:string;readonly script_sha256:string;readonly engine_sha256:string;
 readonly source_manifest_sha256:string;readonly result_schema_version:number;readonly expected_item_ids:readonly string[];
};
type EventFields={readonly id:string;readonly attempt_id:string;readonly session_nonce:string;readonly at:string};
type ExitFields={readonly pid:number;readonly exit_code:number|null;readonly signal:string|null};
export type NativeAttemptOutcome='succeeded'|'failed'|'cancelled'|'interrupted';
export type NativeAttemptEvent=EventFields&(
 |{readonly type:'spawned';readonly pid:number}
 |{readonly type:'owner_acked';readonly pid:number;readonly nonce:string}
 |{readonly type:'report_ready';readonly pid:number;readonly nonce:string;readonly schema_version:number;readonly sha256:string;readonly source_manifest_sha256:string;readonly item_ids:readonly string[];readonly valid:boolean}
 |({readonly type:'actual_close';readonly nonce:string;readonly observer:'host_child_process_close'}&ExitFields)
 |{readonly type:'not_spawned';readonly observer:'host_no_spawn_fact';readonly reason:'preflight_failed'|'spawn_failed'|'cancelled'}
 |{readonly type:'sources_rechecked';readonly expected_manifest_sha256:string;readonly observed_manifest_sha256:string|null;readonly status:'matched'|'changed'|'unreadable'}
 |{readonly type:'cancel_requested'|'timeout'|'parent_lost'}
 |{readonly type:'kill_result';readonly signal:'SIGTERM'|'SIGKILL';readonly result:'returned_true'|'returned_false'|'threw'}
 |({readonly type:'exit_observed'}&ExitFields)
 |{readonly type:'host_outcome';readonly outcome:NativeAttemptOutcome}
);
export type NativeAttemptPhase='prepared'|'spawned'|'owner_acked'|'report_ready'|'closed'|'uncertain';
type ReportClaim={readonly sha256:string;readonly schema_version:number;readonly item_ids:readonly string[];readonly valid:boolean;readonly late_after_cancel:boolean};
type CloseClaim=
 |({readonly kind:'actual_close';readonly at:string;readonly nonce:string;readonly observer:'host_child_process_close'}&ExitFields)
 |{readonly kind:'not_spawned';readonly at:string;readonly observer:'host_no_spawn_fact';readonly reason:'preflight_failed'|'spawn_failed'|'cancelled'};
type SourceClaim={readonly status:'matched'|'changed'|'unreadable';readonly observed_manifest_sha256:string|null;readonly after_report:boolean};
export type NativeAttemptState={
 readonly model_version:1;readonly validation_scope:'pure_state_model';readonly authority:'not_authority';readonly native_proof:'not_attested';
 readonly execution_allowed:false;readonly kill_allowed:false;readonly lease_release_allowed:false;
 readonly projection:'live_model'|'restarted_history'|'imported_history';readonly spec:NativeAttemptSpec;
 readonly phase:NativeAttemptPhase;readonly native_barrier:boolean;readonly cancel_requested:boolean;readonly timeout_requested:boolean;
 readonly kill_requested:boolean;readonly parent_lost:boolean;readonly integrity_failed:boolean;
 readonly child:{readonly pid:number;readonly nonce:string;readonly owner_acked:boolean}|null;
 readonly report:ReportClaim|null;readonly close:CloseClaim|null;readonly source_check:SourceClaim|null;
 readonly exit_observation:ExitFields|null;readonly host_claimed_outcome:NativeAttemptOutcome|null;
 readonly eligibility:{readonly eligible_for_succeeded:boolean;readonly eligible_for_failed:boolean;readonly eligible_for_cancelled:boolean;readonly eligible_for_interrupted:boolean};
 readonly events:readonly NativeAttemptEvent[];
};
export class NativeAttemptError extends Error{
 constructor(readonly code:'invalid_data'|'event_conflict'|'state_conflict'|'binding_mismatch'|'history_only'|'limit',message:string){super(message);this.name='NativeAttemptError';}
}
function fail(code:NativeAttemptError['code'],message:string):never{throw new NativeAttemptError(code,message);}
type Data=Record<string,unknown>;
function record(value:unknown,allowed:readonly string[]):Data{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid_data','Expected a plain inert record');
 const keys=Reflect.ownKeys(value);if(keys.length>allowed.length||keys.some(k=>typeof k!=='string'||!allowed.includes(k)))fail('invalid_data','Unknown fields are not accepted');
 for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)fail('invalid_data','Executable properties are not accepted');}
 return value as Data;
}
function bounded(value:unknown,max=100):string{if(typeof value!=='string'||!value.trim()||value.length>max||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))fail('invalid_data','Invalid bounded text');return value;}
function id(value:unknown):string{const text=bounded(value);if(!/^[A-Za-z0-9_-]+$/u.test(text))fail('invalid_data','Invalid identifier');return text;}
function positive(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<1)fail('invalid_data','Expected a positive integer');return Number(value);}
function digest(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/u.test(value))fail('invalid_data','An explicit SHA256 is required');return value;}
function timestamp(value:unknown):string{const result=bounded(value,24),parsed=Date.parse(result);if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==result)fail('invalid_data','Expected a canonical UTC timestamp');return result;}
function choice<T extends string>(value:unknown,allowed:readonly T[]):T{if(typeof value!=='string'||!allowed.includes(value as T))fail('invalid_data','Unknown enum value');return value as T;}
function bool(value:unknown):boolean{if(typeof value!=='boolean')fail('invalid_data','Expected an explicit boolean');return value;}
function array(value:unknown,max:number):unknown[]{
 if(!Array.isArray(value)||value.length>max)fail('limit','Array exceeds its explicit budget');
 if(Object.getPrototypeOf(value)!==Array.prototype)fail('invalid_data','Custom array prototypes are not accepted');
 const keys=Reflect.ownKeys(value);if(keys.length!==value.length+1||keys.some(k=>typeof k!=='string'||k!=='length'&&(!/^(0|[1-9][0-9]*)$/u.test(k)||Number(k)>=value.length)))fail('invalid_data','Expected a dense data array');
 for(let index=0;index<value.length;index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)fail('invalid_data','Array accessors are not accepted');}
 return value;
}
function itemIds(value:unknown,allowEmpty=false):string[]{const result=array(value,NATIVE_ATTEMPT_LIMITS.items).map(id);if(!allowEmpty&&!result.length)fail('invalid_data','Expected a complete nonempty item list');if(new Set(result).size!==result.length)fail('invalid_data','Duplicate item identities');return result;}
function exitFields(value:Data):ExitFields{
 const code=value.exit_code;if(code!==null&&(!Number.isSafeInteger(code)||Number(code)<-2147483648||Number(code)>4294967295))fail('invalid_data','Invalid exit code');
 const signal=value.signal;if(signal!==null&&(typeof signal!=='string'||!/^SIG[A-Z0-9]{1,16}$/u.test(signal)))fail('invalid_data','Invalid exit signal');
 return {pid:positive(value.pid),exit_code:code as number|null,signal:signal as string|null};
}
/** Inert, bounded canonical data only. This is not a hash or an authority signature. */
function canonical(value:unknown,seen=new Set<object>(),depth=0,budget={nodes:0,bytes:0}):string{
 if(++budget.nodes>NATIVE_ATTEMPT_LIMITS.nodes||depth>16)fail('limit','Native attempt JSON budget exceeded');
 const charge=(bytes:number)=>{if(bytes>NATIVE_ATTEMPT_LIMITS.bytes-budget.bytes)fail('limit','Native attempt JSON exceeds 256 KiB');budget.bytes+=bytes;};
 const quote=(text:string)=>{
  const remaining=NATIVE_ATTEMPT_LIMITS.bytes-budget.bytes;
  // No stringify/encoding allocation for an obviously oversized raw value or key.
  if(text.length>remaining-2)fail('limit','Native attempt JSON exceeds 256 KiB');
  let bytes=2;
  for(let i=0;i<text.length;i++){
   const code=text.charCodeAt(i);
   if(code===34||code===92)bytes+=2;
   else if(code<32)bytes+=[8,9,10,12,13].includes(code)?2:6;
   else if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff){bytes+=4;i++;}else bytes+=6;}
   else if(code>=0xdc00&&code<=0xdfff)bytes+=6;
   else bytes+=code<128?1:code<2048?2:3;
   if(bytes>remaining)fail('limit','Native attempt JSON exceeds 256 KiB');
  }
  charge(bytes);return JSON.stringify(text);
 };
 if(typeof value==='string')return quote(value);
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)){const text=JSON.stringify(value);charge(text.length);return text;}
 if(!value||typeof value!=='object'||seen.has(value))fail('invalid_data','Non-JSON values or cycles are not accepted');
 if(Array.isArray(value)&&(Object.getPrototypeOf(value)!==Array.prototype||value.length>NATIVE_ATTEMPT_LIMITS.nodes-budget.nodes))fail('limit','Array exceeds the remaining JSON budget');
 const keys=Reflect.ownKeys(value);if(keys.length>NATIVE_ATTEMPT_LIMITS.nodes-budget.nodes+1)fail('limit','Record exceeds the remaining JSON budget');
 seen.add(value);let result:string;
 if(Array.isArray(value)){const entries=array(value,NATIVE_ATTEMPT_LIMITS.nodes-budget.nodes);charge(2+Math.max(0,entries.length-1));result=`[${entries.map(entry=>canonical(entry,seen,depth+1,budget)).join(',')}]`;}
 else{
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value))||keys.some(k=>typeof k!=='string'))fail('invalid_data','Expected a plain JSON object');
  const descriptors=Object.getOwnPropertyDescriptors(value);if(Object.values(descriptors).some(d=>!('value'in d)||!d.enumerable))fail('invalid_data','Executable JSON properties are not accepted');
  charge(2+keys.length+Math.max(0,keys.length-1));
  result=`{${(keys as string[]).sort().map(k=>`${quote(k)}:${canonical(descriptors[k].value,seen,depth+1,budget)}`).join(',')}}`;
 }
 seen.delete(value);return result;
}
function size(value:unknown):string{const text=canonical(value);if(new TextEncoder().encode(text).byteLength>NATIVE_ATTEMPT_LIMITS.bytes)fail('limit','Native attempt JSON exceeds 256 KiB');return text;}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const same=(left:unknown,right:unknown)=>canonical(left)===canonical(right);
const specKeys=['attempt_id','run_id','step_id','plan_digest','host_id','session_nonce','child_nonce','prepared_at','profile','profile_sha256','script_sha256','engine_sha256','source_manifest_sha256','result_schema_version','expected_item_ids'];
function spec(value:unknown):NativeAttemptSpec{
 const input=record(value,specKeys),profile=record(input.profile,['key','version']),key=bounded(profile.key);
 if(!/^[a-z][a-z0-9_.-]*$/u.test(key))fail('invalid_data','Invalid registered native profile');
 return {attempt_id:id(input.attempt_id),run_id:id(input.run_id),step_id:id(input.step_id),plan_digest:digest(input.plan_digest),host_id:bounded(input.host_id),session_nonce:id(input.session_nonce),child_nonce:id(input.child_nonce),prepared_at:timestamp(input.prepared_at),
  profile:{key,version:positive(profile.version)},profile_sha256:digest(input.profile_sha256),script_sha256:digest(input.script_sha256),engine_sha256:digest(input.engine_sha256),source_manifest_sha256:digest(input.source_manifest_sha256),result_schema_version:positive(input.result_schema_version),expected_item_ids:itemIds(input.expected_item_ids)};
}
const eventFields=['id','attempt_id','session_nonce','at','type'];
function event(value:unknown):NativeAttemptEvent{
 const v=record(value,[...eventFields,'pid','nonce','schema_version','sha256','source_manifest_sha256','item_ids','valid','observer','exit_code','signal','reason','expected_manifest_sha256','observed_manifest_sha256','status','result','outcome']);
 const base={id:id(v.id),attempt_id:id(v.attempt_id),session_nonce:id(v.session_nonce),at:timestamp(v.at)};
 const strict=(keys:string[])=>record(value,[...eventFields,...keys]);
 switch(v.type){
  case 'spawned':strict(['pid']);return {...base,type:v.type,pid:positive(v.pid)};
  case 'owner_acked':strict(['pid','nonce']);return {...base,type:v.type,pid:positive(v.pid),nonce:id(v.nonce)};
  case 'report_ready':strict(['pid','nonce','schema_version','sha256','source_manifest_sha256','item_ids','valid']);return {...base,type:v.type,pid:positive(v.pid),nonce:id(v.nonce),schema_version:positive(v.schema_version),sha256:digest(v.sha256),source_manifest_sha256:digest(v.source_manifest_sha256),item_ids:itemIds(v.item_ids,true),valid:bool(v.valid)};
  case 'actual_close':strict(['pid','nonce','observer','exit_code','signal']);return {...base,type:v.type,...exitFields(v),nonce:id(v.nonce),observer:choice(v.observer,['host_child_process_close'])};
  case 'not_spawned':strict(['observer','reason']);return {...base,type:v.type,observer:choice(v.observer,['host_no_spawn_fact']),reason:choice(v.reason,['preflight_failed','spawn_failed','cancelled'])};
  case 'sources_rechecked':strict(['expected_manifest_sha256','observed_manifest_sha256','status']);return {...base,type:v.type,expected_manifest_sha256:digest(v.expected_manifest_sha256),observed_manifest_sha256:v.observed_manifest_sha256===null?null:digest(v.observed_manifest_sha256),status:choice(v.status,['matched','changed','unreadable'])};
  case 'cancel_requested':case 'timeout':case 'parent_lost':strict([]);return {...base,type:v.type};
  case 'kill_result':strict(['signal','result']);return {...base,type:v.type,signal:choice(v.signal,['SIGTERM','SIGKILL']),result:choice(v.result,['returned_true','returned_false','threw'])};
  case 'exit_observed':strict(['pid','exit_code','signal']);return {...base,type:v.type,...exitFields(v)};
  case 'host_outcome':strict(['outcome']);return {...base,type:v.type,outcome:choice(v.outcome,['succeeded','failed','cancelled','interrupted'])};
  default:return fail('invalid_data','Unknown native attempt event');
 }
}
type Core={phase:NativeAttemptPhase;cancel_requested:boolean;timeout_requested:boolean;kill_requested:boolean;parent_lost:boolean;integrity_failed:boolean;child:{pid:number;nonce:string;owner_acked:boolean}|null;report:ReportClaim|null;close:CloseClaim|null;source_check:SourceClaim|null;exit_observation:ExitFields|null;host_claimed_outcome:NativeAttemptOutcome|null};
function empty():Core{return {phase:'prepared',cancel_requested:false,timeout_requested:false,kill_requested:false,parent_lost:false,integrity_failed:false,child:null,report:null,close:null,source_check:null,exit_observation:null,host_claimed_outcome:null};}
function eligible(core:Core):NativeAttemptState['eligibility']{
 const closed=core.phase==='closed'&&core.close!==null,actual=core.close?.kind==='actual_close'?core.close:null;
 return {eligible_for_succeeded:closed&&actual!==null&&actual.exit_code===0&&actual.signal===null&&core.child?.owner_acked===true&&core.report?.valid===true&&core.source_check?.status==='matched'&&core.source_check.after_report&&!core.cancel_requested&&!core.timeout_requested&&!core.kill_requested&&!core.parent_lost&&!core.integrity_failed,
  eligible_for_failed:closed,eligible_for_cancelled:closed&&core.cancel_requested,eligible_for_interrupted:closed||core.phase==='uncertain'};
}
function reduce(core:Core,input:NativeAttemptEvent,binding:NativeAttemptSpec):void{
 if(input.attempt_id!==binding.attempt_id||input.session_nonce!==binding.session_nonce)fail('binding_mismatch','Event belongs to another attempt or host session');
 if(core.host_claimed_outcome)fail('state_conflict','A finalized host claim rejects late events');
 if(core.phase==='uncertain'&&input.type!=='host_outcome')fail('state_conflict','Unknown ownership remains blocked');
 const child=(pid:number,nonce?:string)=>{if(!core.child||core.child.pid!==pid||nonce!==undefined&&core.child.nonce!==nonce)fail('binding_mismatch','Child PID/nonce do not match this frozen attempt');};
 switch(input.type){
  case 'spawned':if(core.phase!=='prepared'||core.child||core.close)fail('state_conflict','Spawn may be recorded only once');core.child={pid:input.pid,nonce:binding.child_nonce,owner_acked:false};core.phase='spawned';break;
  case 'owner_acked':child(input.pid,input.nonce);if(core.phase!=='spawned')fail('state_conflict','Owner acknowledgement is out of order');core.child!.owner_acked=true;core.phase='owner_acked';break;
  case 'report_ready':{
   child(input.pid,input.nonce);if(!core.child!.owner_acked||core.report||!['owner_acked','closed'].includes(core.phase)||core.close?.kind==='not_spawned')fail('state_conflict','Report requires one acknowledged child');
   if(input.source_manifest_sha256!==binding.source_manifest_sha256)fail('binding_mismatch','Report is bound to another source manifest');
   if(input.valid&&(input.schema_version!==binding.result_schema_version||!same(input.item_ids,binding.expected_item_ids)))fail('invalid_data','A valid report must cover the complete frozen result scope');
   core.report={sha256:input.sha256,schema_version:input.schema_version,item_ids:[...input.item_ids],valid:input.valid,late_after_cancel:core.cancel_requested};core.integrity_failed ||= !input.valid;if(core.phase!=='closed')core.phase='report_ready';break;
  }
  case 'actual_close':{
   child(input.pid,input.nonce);if(core.close||!['spawned','owner_acked','report_ready'].includes(core.phase))fail('state_conflict','A close claim requires a recorded, non-closed child');
   if(core.exit_observation&&(core.exit_observation.exit_code!==input.exit_code||core.exit_observation.signal!==input.signal))fail('invalid_data','Exit and close observations disagree');
   core.close={kind:'actual_close',at:input.at,pid:input.pid,nonce:input.nonce,observer:input.observer,exit_code:input.exit_code,signal:input.signal};core.phase='closed';break;
  }
  case 'not_spawned':if(core.phase!=='prepared'||core.child||core.close)fail('state_conflict','No-spawn fact cannot erase a spawn or unknown owner');if(input.reason==='cancelled'&&!core.cancel_requested)fail('state_conflict','Cancellation was not requested');core.close={kind:'not_spawned',at:input.at,observer:input.observer,reason:input.reason};core.phase='closed';break;
  case 'sources_rechecked':{
   if(core.phase!=='closed'||core.close?.kind!=='actual_close')fail('state_conflict','Sources must be rechecked after the actual-close claim');
   if(input.expected_manifest_sha256!==binding.source_manifest_sha256)fail('binding_mismatch','Recheck targets another frozen manifest');
   if(input.status==='matched'?input.observed_manifest_sha256!==binding.source_manifest_sha256:input.status==='changed'?input.observed_manifest_sha256===null||input.observed_manifest_sha256===binding.source_manifest_sha256:input.observed_manifest_sha256!==null)fail('invalid_data','Source recheck status is inconsistent');
   core.source_check={status:input.status,observed_manifest_sha256:input.observed_manifest_sha256,after_report:core.report!==null};core.integrity_failed ||= input.status!=='matched';break;
  }
  case 'cancel_requested':core.cancel_requested=true;break;
  case 'timeout':if(core.phase==='closed')fail('state_conflict','A closed attempt cannot time out');core.timeout_requested=true;break;
  case 'kill_result':if(!core.child||core.phase==='closed')fail('state_conflict','Signal requests need a non-closed owned child');core.kill_requested=true;break;
  case 'exit_observed':child(input.pid);if(core.close||core.exit_observation)fail('state_conflict','Exit observation is duplicate or late');core.exit_observation={pid:input.pid,exit_code:input.exit_code,signal:input.signal};break;
  case 'parent_lost':if(core.phase==='closed')fail('state_conflict','Closed receipt already exists');core.parent_lost=true;core.phase='uncertain';break;
  case 'host_outcome':if(!eligible(core)[`eligible_for_${input.outcome}`])fail('state_conflict','Host outcome claim lacks the required evidence declarations');core.host_claimed_outcome=input.outcome;break;
 }
}
const stateKeys=['model_version','validation_scope','authority','native_proof','execution_allowed','kill_allowed','lease_release_allowed','projection','spec','phase','native_barrier','cancel_requested','timeout_requested','kill_requested','parent_lost','integrity_failed','child','report','close','source_check','exit_observation','host_claimed_outcome','eligibility','events'];
function project(binding:NativeAttemptSpec,events:NativeAttemptEvent[],projection:NativeAttemptState['projection']):NativeAttemptState{
 const core=empty();let at=binding.prepared_at;const seen=new Set<string>();
 for(const input of events){if(seen.has(input.id))fail('invalid_data','Stored event IDs must be unique');if(input.at<at)fail('invalid_data','Event timestamps must be monotonic');seen.add(input.id);at=input.at;reduce(core,input,binding);}
 const phase=projection==='live_model'||core.phase==='closed'?core.phase:'uncertain';
 const state:NativeAttemptState={model_version:1,validation_scope:'pure_state_model',authority:'not_authority',native_proof:'not_attested',execution_allowed:false,kill_allowed:false,lease_release_allowed:false,projection,spec:binding,...core,phase,native_barrier:phase!=='closed',
  eligibility:projection==='live_model'?eligible(core):{eligible_for_succeeded:false,eligible_for_failed:false,eligible_for_cancelled:false,eligible_for_interrupted:false},events};
 size(state);return freeze(state);
}
export function createNativeAttempt(value:unknown):NativeAttemptState{return project(spec(value),[],'live_model');}
/** Pure consistency only: even an exact validated DTO remains NOT native proof or authority. */
export function validateNativeAttempt(value:unknown):NativeAttemptState{
 const v=record(value,stateKeys),binding=spec(v.spec),events=array(v.events,NATIVE_ATTEMPT_LIMITS.events).map(event),projection=choice(v.projection,['live_model','restarted_history','imported_history']);
 const expected=project(binding,events,projection);if(size(value)!==size(expected))fail('invalid_data','Derived native attempt state was forged or inconsistent');return expected;
}
export function canonicalNativeAttemptEventPayload(value:unknown):string{return size(event(value));}
/** Repository3 must atomically persist the returned state/event; runtime3 must supply genuine host evidence separately. */
export function applyNativeAttemptEvent(value:NativeAttemptState,rawEvent:unknown):NativeAttemptState{
 const state=validateNativeAttempt(value),input=event(rawEvent),previous=state.events.find(previous=>previous.id===input.id);
 if(previous){if(canonical(previous)!==canonical(input))fail('event_conflict','An event ID cannot be reused for different content');return state;}
 if(state.projection!=='live_model')fail('history_only','Restarted/imported history cannot be resumed or used as a kill capability');
 if(state.events.length>=NATIVE_ATTEMPT_LIMITS.events)fail('limit','Native attempt event budget exceeded');
 return project(state.spec,[...state.events,input],state.projection);
}
/** Never infer child closure from a dead parent, missing PID, elapsed time or a previous run terminal state. */
export function recoverNativeAttempt(value:unknown):NativeAttemptState{const state=validateNativeAttempt(value);return project(state.spec,[...state.events],'restarted_history');}
/** Original event claims remain historical data only; no execution/kill/lease-release permission is restored. */
export function importNativeAttemptHistory(value:unknown):NativeAttemptState{const state=validateNativeAttempt(value);return project(state.spec,[...state.events],'imported_history');}
