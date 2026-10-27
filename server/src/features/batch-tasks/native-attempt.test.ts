import {describe,expect,it,vi} from 'vitest';
import {
  NATIVE_ATTEMPT_LIMITS,NativeAttemptError,applyNativeAttemptEvent,canonicalNativeAttemptEventPayload,
  createNativeAttempt,importNativeAttemptHistory,recoverNativeAttempt,validateNativeAttempt,
  type NativeAttemptSpec,type NativeAttemptState,
} from '../../../../shared/batch-tasks/native-attempt.js';

type Mutable<T>=T extends readonly(infer U)[]?Mutable<U>[]:T extends object?{-readonly[K in keyof T]:Mutable<T[K]>}:T;
const hash=(letter='a')=>letter.repeat(64);
function spec():Mutable<NativeAttemptSpec>{
  return {attempt_id:'attempt-synthetic',run_id:'run-synthetic',step_id:'step-synthetic',plan_digest:hash(),
    host_id:'synthetic-host',session_nonce:'session-synthetic',child_nonce:'child-synthetic',prepared_at:'2026-01-01T00:00:00.000Z',
    profile:{key:'synthetic.measure',version:1},profile_sha256:hash('f'),script_sha256:hash('b'),engine_sha256:hash('c'),source_manifest_sha256:hash('d'),
    result_schema_version:1,expected_item_ids:['item-alpha','item-bravo']};
}
function event(type:string,fields:Record<string,unknown>={},suffix=''):Record<string,unknown>{
  return {id:`event-${type}${suffix}`,attempt_id:'attempt-synthetic',session_nonce:'session-synthetic',at:'2026-01-01T00:00:00.000Z',type,...fields};
}
const spawned=()=>event('spawned',{pid:1234});
const acked=()=>event('owner_acked',{pid:1234,nonce:'child-synthetic'});
const report=(fields:Record<string,unknown>={})=>event('report_ready',{pid:1234,nonce:'child-synthetic',schema_version:1,sha256:hash('e'),source_manifest_sha256:hash('d'),item_ids:['item-alpha','item-bravo'],valid:true,...fields});
const close=(fields:Record<string,unknown>={})=>event('actual_close',{pid:1234,nonce:'child-synthetic',observer:'host_child_process_close',exit_code:0,signal:null,...fields});
const recheck=(fields:Record<string,unknown>={},suffix='')=>event('sources_rechecked',{expected_manifest_sha256:hash('d'),observed_manifest_sha256:hash('d'),status:'matched',...fields},suffix);
const apply=(state:NativeAttemptState,...events:unknown[])=>events.reduce<NativeAttemptState>((current,input)=>applyNativeAttemptEvent(current,input),state);
const prepared=()=>createNativeAttempt(spec());
const running=()=>apply(prepared(),spawned(),acked());
const complete=()=>apply(running(),report(),close(),recheck());
const clone=(state:NativeAttemptState)=>structuredClone(state) as Mutable<NativeAttemptState>;
function rejects(call:()=>unknown,code?:NativeAttemptError['code']){
  try{call();expect.fail('Expected native candidate-model rejection');}catch(error){expect(error).toBeInstanceOf(NativeAttemptError);if(code)expect(error).toMatchObject({code});}
}
function noAuthority(state:NativeAttemptState){
  expect(state).toMatchObject({validation_scope:'pure_state_model',authority:'not_authority',native_proof:'not_attested',execution_allowed:false,kill_allowed:false,lease_release_allowed:false});
}

describe('unwired native attempt candidate model: never runtime authority',()=>{
  it('freezes identities and host-supplied fingerprints without granting any permission',()=>{
    const state=prepared();noAuthority(state);
    expect(state).toMatchObject({model_version:1,projection:'live_model',phase:'prepared',native_barrier:true,child:null,close:null});
    expect(Object.values(state.eligibility)).toEqual([false,false,false,false]);
    expect(state.spec).toEqual(spec());expect(state).not.toHaveProperty('protocol_version');
  });
  it('deep-freezes an independent snapshot, not caller-owned objects',()=>{
    const input=spec(),before=structuredClone(input),state=createNativeAttempt(input);
    expect(input).toEqual(before);expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(state)).toBe(true);expect(Object.isFrozen(state.spec.profile)).toBe(true);expect(Object.isFrozen(state.spec.expected_item_ids)).toBe(true);
    input.expected_item_ids.pop();input.profile.version=9;expect(state.spec.expected_item_ids).toHaveLength(2);expect(state.spec.profile.version).toBe(1);
    expect(()=>{(state.spec.expected_item_ids as string[]).pop();}).toThrow();
  });
  it('records the ordered lifecycle, retaining the barrier until an explicit close claim',()=>{
    let state=prepared();
    for(const [input,phase] of [[spawned(),'spawned'],[acked(),'owner_acked'],[report(),'report_ready']] as const){state=applyNativeAttemptEvent(state,input);expect(state.phase).toBe(phase);expect(state.native_barrier).toBe(true);noAuthority(state);}
    state=applyNativeAttemptEvent(state,close());expect(state.phase).toBe('closed');expect(state.native_barrier).toBe(false);expect(state.eligibility.eligible_for_succeeded).toBe(false);
    state=applyNativeAttemptEvent(state,recheck());expect(state.eligibility.eligible_for_succeeded).toBe(true);noAuthority(state);
  });
  it('only makes complete post-close/post-report declarations eligible for a host success claim',()=>{
    const state=complete();expect(state.eligibility.eligible_for_succeeded).toBe(true);
    const final=applyNativeAttemptEvent(state,event('host_outcome',{outcome:'succeeded'}));
    expect(final.host_claimed_outcome).toBe('succeeded');noAuthority(final);
    expect(validateNativeAttempt(JSON.parse(JSON.stringify(final)))).toEqual(final);
    rejects(()=>applyNativeAttemptEvent(final,event('cancel_requested')),'state_conflict');
  });
  it('accepts a report after close but requires a new source recheck after that report',()=>{
    let state=apply(running(),close(),recheck());expect(state.source_check?.after_report).toBe(false);
    state=applyNativeAttemptEvent(state,report());expect(state.phase).toBe('closed');expect(state.eligibility.eligible_for_succeeded).toBe(false);
    state=applyNativeAttemptEvent(state,recheck({},'-after-report'));expect(state.eligibility.eligible_for_succeeded).toBe(true);
  });
  it('does not allow a pre-close source recheck to serve as a close proof',()=>{
    rejects(()=>applyNativeAttemptEvent(apply(running(),report()),recheck()),'state_conflict');
  });
  it('cannot declare success using close alone, missing owner acknowledgement or missing report',()=>{
    const closed=apply(prepared(),spawned(),close(),recheck());
    expect(closed.eligibility).toMatchObject({eligible_for_succeeded:false,eligible_for_failed:true});
    rejects(()=>applyNativeAttemptEvent(closed,event('host_outcome',{outcome:'succeeded'})),'state_conflict');
    rejects(()=>applyNativeAttemptEvent(apply(prepared(),spawned()),report()),'state_conflict');
  });
  it.each([{exit_code:3},{signal:'SIGKILL',exit_code:null},{exit_code:null}])('never makes an unsuccessful close %j eligible for success',fields=>{
    const state=apply(running(),report(),close(fields),recheck());
    expect(state.eligibility).toMatchObject({eligible_for_succeeded:false,eligible_for_failed:true});
    expect(applyNativeAttemptEvent(state,event('host_outcome',{outcome:'failed'})).host_claimed_outcome).toBe('failed');
  });
  it.each([
    {attempt_id:'other-attempt'},{session_nonce:'other-session'},{pid:9999},{nonce:'other-child'},
  ])('rejects a report bound to another frozen attempt or child %j',fields=>{
    rejects(()=>applyNativeAttemptEvent(running(),report(fields)),'binding_mismatch');
  });
  it.each([
    {item_ids:['item-alpha']},{item_ids:['item-alpha','item-bravo','item-extra']},{item_ids:['item-bravo','item-alpha']},
    {item_ids:['item-alpha','item-alpha']},{schema_version:2},
  ])('rejects a claimed-valid report with incomplete or wrong result scope %j',fields=>{
    rejects(()=>applyNativeAttemptEvent(running(),report(fields)),'invalid_data');
  });
  it('rejects a report against another source manifest even when marked invalid',()=>{
    rejects(()=>applyNativeAttemptEvent(running(),report({valid:false,source_manifest_sha256:hash('f')})),'binding_mismatch');
  });
  it('retains an explicitly invalid/incomplete report without elevating it to success',()=>{
    const state=apply(running(),report({valid:false,item_ids:['item-alpha'],schema_version:2}),close(),recheck());
    expect(state.report).toMatchObject({valid:false,item_ids:['item-alpha']});expect(state.integrity_failed).toBe(true);
    expect(state.eligibility).toMatchObject({eligible_for_succeeded:false,eligible_for_failed:true});
  });
  it.each(['changed','unreadable'] as const)('latches %s source evidence even if a later recheck claims matched',status=>{
    let state=apply(running(),report(),close(),recheck({status,observed_manifest_sha256:status==='changed'?hash('f'):null}));
    state=applyNativeAttemptEvent(state,recheck({},'-later'));
    expect(state.source_check?.status).toBe('matched');expect(state.integrity_failed).toBe(true);expect(state.eligibility.eligible_for_succeeded).toBe(false);
  });
  it.each([
    {expected_manifest_sha256:hash('f')},{status:'matched',observed_manifest_sha256:hash('f')},
    {status:'changed',observed_manifest_sha256:hash('d')},{status:'changed',observed_manifest_sha256:null},
    {status:'unreadable',observed_manifest_sha256:hash('d')},
  ])('rejects internally inconsistent source recheck %j',fields=>{
    rejects(()=>applyNativeAttemptEvent(apply(running(),close()),recheck(fields)));
  });
  it('treats timeout as a request/observation, not failed completion or child closure',()=>{
    const state=applyNativeAttemptEvent(running(),event('timeout'));
    expect(state).toMatchObject({phase:'owner_acked',native_barrier:true,timeout_requested:true,close:null});
    expect(state.eligibility.eligible_for_failed).toBe(false);rejects(()=>applyNativeAttemptEvent(state,event('host_outcome',{outcome:'failed'})),'state_conflict');
    expect(apply(state,report(),close(),recheck()).eligibility.eligible_for_succeeded).toBe(false);
  });
  it.each(['returned_true','returned_false','threw'] as const)('does not turn kill %s into a close receipt',result=>{
    const state=applyNativeAttemptEvent(running(),event('kill_result',{signal:'SIGKILL',result}));
    expect(state).toMatchObject({phase:'owner_acked',native_barrier:true,kill_requested:true,close:null});noAuthority(state);
    expect(Object.values(state.eligibility).every(value=>!value)).toBe(true);
    expect(apply(state,report(),close(),recheck()).eligibility.eligible_for_succeeded).toBe(false);
  });
  it('does not equate exit with close, and rejects disagreeing later close claims',()=>{
    const state=applyNativeAttemptEvent(running(),event('exit_observed',{pid:1234,exit_code:0,signal:null}));
    expect(state).toMatchObject({phase:'owner_acked',native_barrier:true,close:null});expect(state.eligibility.eligible_for_failed).toBe(false);
    rejects(()=>applyNativeAttemptEvent(state,close({exit_code:1})),'invalid_data');
    expect(apply(state,report(),close(),recheck()).eligibility.eligible_for_succeeded).toBe(true);
  });
  it('turns a lost parent into an uncertain barrier, not inferred child death',()=>{
    const state=applyNativeAttemptEvent(running(),event('parent_lost'));
    expect(state).toMatchObject({phase:'uncertain',native_barrier:true,parent_lost:true,close:null});noAuthority(state);
    expect(state.eligibility).toMatchObject({eligible_for_succeeded:false,eligible_for_failed:false,eligible_for_interrupted:true});
    rejects(()=>applyNativeAttemptEvent(state,close()),'state_conflict');
    expect(applyNativeAttemptEvent(state,event('host_outcome',{outcome:'interrupted'}))).toMatchObject({host_claimed_outcome:'interrupted',native_barrier:true});
  });
  it('keeps cancellation pending without a child close or explicit no-spawn fact',()=>{
    const state=applyNativeAttemptEvent(prepared(),event('cancel_requested'));
    expect(state).toMatchObject({phase:'prepared',native_barrier:true,cancel_requested:true,child:null,close:null});
    rejects(()=>applyNativeAttemptEvent(state,event('host_outcome',{outcome:'cancelled'})),'state_conflict');
  });
  it.each(['preflight_failed','spawn_failed','cancelled'] as const)('accepts an explicit pre-spawn host fact %s, never as success',reason=>{
    const initial=reason==='cancelled'?applyNativeAttemptEvent(prepared(),event('cancel_requested')):prepared();
    const state=applyNativeAttemptEvent(initial,event('not_spawned',{observer:'host_no_spawn_fact',reason}));
    expect(state).toMatchObject({phase:'closed',native_barrier:false,child:null,close:{kind:'not_spawned',reason}});noAuthority(state);
    expect(state.eligibility.eligible_for_succeeded).toBe(false);expect(state.eligibility.eligible_for_failed).toBe(true);
  });
  it('does not invent a cancelled no-spawn fact without a prior cancellation request',()=>{
    rejects(()=>applyNativeAttemptEvent(prepared(),event('not_spawned',{observer:'host_no_spawn_fact',reason:'cancelled'})),'state_conflict');
  });
  it('cannot erase a recorded spawn with a later no-spawn declaration',()=>{
    rejects(()=>applyNativeAttemptEvent(apply(prepared(),spawned()),event('not_spawned',{observer:'host_no_spawn_fact',reason:'spawn_failed'})),'state_conflict');
  });
  it('allows a normal cancellation claim only after close and blocks a late complete report',()=>{
    const pending=apply(running(),event('cancel_requested'),report());expect(pending.report?.late_after_cancel).toBe(true);
    expect(pending.eligibility.eligible_for_cancelled).toBe(false);
    const state=apply(pending,close(),recheck());expect(state.eligibility).toMatchObject({eligible_for_succeeded:false,eligible_for_cancelled:true});
    expect(applyNativeAttemptEvent(state,event('host_outcome',{outcome:'cancelled'})).host_claimed_outcome).toBe('cancelled');
  });
  it('also revokes success eligibility for cancellation arriving after a complete report',()=>{
    const state=applyNativeAttemptEvent(complete(),event('cancel_requested'));
    expect(state.report?.late_after_cancel).toBe(false);expect(state.eligibility.eligible_for_succeeded).toBe(false);
    rejects(()=>applyNativeAttemptEvent(state,event('host_outcome',{outcome:'succeeded'})),'state_conflict');
  });
  it('makes identical stable event IDs idempotent but rejects changed content',()=>{
    const input=spawned(),state=applyNativeAttemptEvent(prepared(),input);
    expect(applyNativeAttemptEvent(state,Object.fromEntries(Object.entries(input).reverse()))).toEqual(state);
    rejects(()=>applyNativeAttemptEvent(state,{...input,pid:9876}),'event_conflict');
    rejects(()=>applyNativeAttemptEvent(state,{...input,at:'2026-01-01T00:00:01.000Z'}),'event_conflict');
    expect(canonicalNativeAttemptEventPayload(input)).toBe(canonicalNativeAttemptEventPayload(Object.fromEntries(Object.entries(input).reverse())));
  });
  it('supports exact idempotent event retry even after the final host claim',()=>{
    const input=event('host_outcome',{outcome:'succeeded'}),state=applyNativeAttemptEvent(complete(),input);
    expect(applyNativeAttemptEvent(state,input)).toEqual(state);
    rejects(()=>applyNativeAttemptEvent(state,{...input,outcome:'failed'}),'event_conflict');
  });
  it.each([prepared,running,()=>apply(running(),report())])('seals non-closed restart history with an uncertain barrier, including missing PID',factory=>{
    const state=recoverNativeAttempt(factory());noAuthority(state);
    expect(state).toMatchObject({projection:'restarted_history',phase:'uncertain',native_barrier:true});
    expect(Object.values(state.eligibility).every(value=>!value)).toBe(true);
    rejects(()=>applyNativeAttemptEvent(state,close()),'history_only');
    rejects(()=>applyNativeAttemptEvent(state,event('not_spawned',{observer:'host_no_spawn_fact',reason:'preflight_failed'})),'history_only');
    expect(validateNativeAttempt(state)).toEqual(state);
  });
  it('retains a closed restart receipt as history without restoring eligibility or permission',()=>{
    const state=recoverNativeAttempt(applyNativeAttemptEvent(complete(),event('host_outcome',{outcome:'succeeded'})));
    expect(state).toMatchObject({projection:'restarted_history',phase:'closed',native_barrier:false,host_claimed_outcome:'succeeded'});noAuthority(state);
    expect(Object.values(state.eligibility).every(value=>!value)).toBe(true);
    rejects(()=>applyNativeAttemptEvent(state,event('cancel_requested')),'history_only');
  });
  it.each([prepared,complete])('imports a validated snapshot only as sealed history, never as runtime ownership',factory=>{
    const original=factory(),state=importNativeAttemptHistory(JSON.parse(JSON.stringify(original)));noAuthority(state);
    expect(state.projection).toBe('imported_history');expect(state.phase).toBe(original.phase==='closed'?'closed':'uncertain');
    expect(Object.values(state.eligibility).every(value=>!value)).toBe(true);
    rejects(()=>applyNativeAttemptEvent(state,event('cancel_requested')),'history_only');
  });
  it.each(['execution_allowed','kill_allowed','lease_release_allowed','native_barrier'] as const)('rejects forged derived permission or barrier %s',key=>{
    const input=clone(prepared());input[key]=!input[key] as never;rejects(()=>validateNativeAttempt(input),'invalid_data');
  });
  it('rejects forged eligibility and unknown authority/proof labels',()=>{
    const input=clone(prepared());input.eligibility.eligible_for_succeeded=true;rejects(()=>validateNativeAttempt(input),'invalid_data');
    rejects(()=>validateNativeAttempt({...prepared(),authority:'runtime_authority'}),'invalid_data');
    rejects(()=>validateNativeAttempt({...prepared(),native_proof:'verified'}),'invalid_data');
  });
  it('validates serialized host declarations but explicitly does not attest that they happened',()=>{
    const state=validateNativeAttempt(JSON.parse(JSON.stringify(complete())));
    expect(state.eligibility.eligible_for_succeeded).toBe(true);noAuthority(state);
  });
  it('rejects duplicate stored IDs, forged report state, and nonmonotonic event timestamps',()=>{
    const duplicate=clone(apply(prepared(),spawned()));duplicate.events.push(duplicate.events[0]);rejects(()=>validateNativeAttempt(duplicate),'invalid_data');
    const forged=clone(complete());forged.report!.sha256=hash('f');rejects(()=>validateNativeAttempt(forged),'invalid_data');
    rejects(()=>applyNativeAttemptEvent(prepared(),{...spawned(),at:'2025-12-31T23:59:59.999Z'}),'invalid_data');
    const later=applyNativeAttemptEvent(prepared(),{...spawned(),at:'2026-01-01T00:00:01.000Z'});
    rejects(()=>applyNativeAttemptEvent(later,acked()),'invalid_data');
  });
  it.each([
    ['missing plan digest',(input:Mutable<NativeAttemptSpec>)=>{delete (input as Partial<Mutable<NativeAttemptSpec>>).plan_digest;}],
    ['missing profile digest',(input:Mutable<NativeAttemptSpec>)=>{input.profile_sha256='';}],
    ['missing script digest',(input:Mutable<NativeAttemptSpec>)=>{input.script_sha256='';}],
    ['missing engine digest',(input:Mutable<NativeAttemptSpec>)=>{input.engine_sha256='bad';}],
    ['missing source manifest',(input:Mutable<NativeAttemptSpec>)=>{input.source_manifest_sha256='A'.repeat(64);}],
    ['unknown profile version',(input:Mutable<NativeAttemptSpec>)=>{input.profile.version=0;}],
    ['unknown result version',(input:Mutable<NativeAttemptSpec>)=>{input.result_schema_version=0;}],
    ['unknown profile key',(input:Mutable<NativeAttemptSpec>)=>{input.profile.key='../engine';}],
    ['control in host',(input:Mutable<NativeAttemptSpec>)=>{input.host_id='host\u200b';}],
    ['duplicate item',(input:Mutable<NativeAttemptSpec>)=>{input.expected_item_ids=['item-alpha','item-alpha'];}],
    ['empty scope',(input:Mutable<NativeAttemptSpec>)=>{input.expected_item_ids=[];}],
    ['noncanonical time',(input:Mutable<NativeAttemptSpec>)=>{input.prepared_at='2026-01-01T00:00:00Z';}],
  ] as const)('rejects incomplete frozen spec: %s',(_label,mutate)=>{const input=spec();mutate(input);rejects(()=>createNativeAttempt(input));});
  it.each([
    {type:'native_write'},{pid:0},{pid:1.5},{id:'bad/id'},{extra:'unknown'},{at:'2026-01-01'},
  ])('rejects unknown or unsafe event data %j',fields=>{rejects(()=>applyNativeAttemptEvent(prepared(),{...spawned(),...fields}));});
  it('does not invoke getters when validating raw events, specs, or state records',()=>{
    for(const target of ['event','spec','state']){
      const getter=vi.fn(()=>{throw new Error('Must not execute caller code');});
      const value=target==='event'?spawned():target==='spec'?spec():clone(prepared());
      Object.defineProperty(value,target==='event'?'type':target==='spec'?'profile':'projection',{get:getter,enumerable:true});
      rejects(()=>target==='event'?applyNativeAttemptEvent(prepared(),value):target==='spec'?createNativeAttempt(value):validateNativeAttempt(value),'invalid_data');
      expect(getter).not.toHaveBeenCalled();
    }
  });
  it('rejects branch-inappropriate known fields before executing nested getters',()=>{
    const getter=vi.fn(),extra={};Object.defineProperty(extra,'anything',{get:getter,enumerable:true});
    rejects(()=>canonicalNativeAttemptEventPayload({...spawned(),item_ids:extra}),'invalid_data');expect(getter).not.toHaveBeenCalled();
  });
  it('rejects nonplain prototypes, symbol keys, nonenumerable fields and cycle-shaped inputs',()=>{
    const prototype=Object.assign(Object.create({hidden:true}),spawned());rejects(()=>canonicalNativeAttemptEventPayload(prototype),'invalid_data');
    const symbol={...spawned(),[Symbol('unknown')]:true};rejects(()=>canonicalNativeAttemptEventPayload(symbol),'invalid_data');
    const hidden=spawned();Object.defineProperty(hidden,'pid',{value:1234,enumerable:false});rejects(()=>canonicalNativeAttemptEventPayload(hidden),'invalid_data');
    const cyclic=spawned();cyclic.pid=cyclic;rejects(()=>canonicalNativeAttemptEventPayload(cyclic),'invalid_data');
  });
  it('rejects sparse, accessor-backed, custom-prototype and oversized result arrays',()=>{
    const accessor=['item-alpha','item-bravo'],getter=vi.fn();Object.defineProperty(accessor,'0',{get:getter,enumerable:true});
    const custom=['item-alpha','item-bravo'];Object.setPrototypeOf(custom,null);
    for(const item_ids of [Array(2),accessor,custom,Array(NATIVE_ATTEMPT_LIMITS.items+1)])rejects(()=>applyNativeAttemptEvent(running(),report({item_ids})));
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects oversized event arrays before enumerating descriptors or allocating entries',()=>{
    const input=clone(prepared());input.events=Array(200001);
    const descriptor=vi.spyOn(Object,'getOwnPropertyDescriptor');let rejection:unknown;
    try{validateNativeAttempt(input);}catch(error){rejection=error;}
    const arrayCalls=descriptor.mock.calls.filter(([value])=>value===input.events).length;descriptor.mockRestore();
    expect(rejection).toBeInstanceOf(NativeAttemptError);expect(rejection).toMatchObject({code:'limit'});expect(arrayCalls).toBe(0);
  });
  it('rejects unknown top-level large values before traversing them or invoking their getters',()=>{
    const getter=vi.fn(),extra=Array(200001);Object.defineProperty(extra,'0',{get:getter,enumerable:true});
    rejects(()=>validateNativeAttempt({...prepared(),extra}),'invalid_data');expect(getter).not.toHaveBeenCalled();
  });
  it.each(['value','key','utf8','escaped','cumulative'] as const)('bounds raw %s bytes before stringify or aggregate JSON construction',kind=>{
    const input=clone(prepared()),large=kind==='utf8'?'\u{1f600}'.repeat(NATIVE_ATTEMPT_LIMITS.bytes/4):kind==='escaped'?'\0'.repeat(Math.ceil(NATIVE_ATTEMPT_LIMITS.bytes/6)):'x'.repeat(kind==='cumulative'?100*1024:NATIVE_ATTEMPT_LIMITS.bytes+1);
    // Derived data is untrusted too; a forged child is compared only after bounded canonicalization.
    (input as unknown as Record<string,unknown>).child=kind==='key'?{[large]:null}:kind==='cumulative'?{a:large,b:large,c:large}:{value:large};
    const stringify=vi.spyOn(JSON,'stringify');let rejection:unknown;
    try{validateNativeAttempt(input);}catch(error){rejection=error;}
    const largeCalls=stringify.mock.calls.filter(([value])=>value===large).length;stringify.mockRestore();
    expect(rejection).toBeInstanceOf(NativeAttemptError);expect(rejection).toMatchObject({code:'limit'});
    expect(largeCalls).toBe(kind==='cumulative'?2:0);
  });
  it('keeps a bounded unique event ledger while allowing exact retry at the limit',()=>{
    let state=prepared();let last:Record<string,unknown>={};
    for(let index=0;index<NATIVE_ATTEMPT_LIMITS.events;index++){last=event('cancel_requested',{},`-${index}`);state=applyNativeAttemptEvent(state,last);}
    expect(state.events).toHaveLength(NATIVE_ATTEMPT_LIMITS.events);expect(applyNativeAttemptEvent(state,last)).toEqual(state);
    rejects(()=>applyNativeAttemptEvent(state,event('cancel_requested',{},'-over-limit')),'limit');
  });
});
