import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {
  NEXT_PLAN_LIMITS,NextProtocolError,compilePlanV2,validatePlanV2,canonicalPlanPayloadV2,
  type NextPlanInput,
} from '../../../../shared/batch-tasks/next-protocol.js';

type Mutable<T>=T extends readonly(infer U)[]?Mutable<U>[]:T extends object?{-readonly[K in keyof T]:Mutable<T[K]>}:T;
type Draft=Mutable<NextPlanInput>;
const hash=(letter='a')=>letter.repeat(64);
function draft():Draft{
  return {
    id:'plan-synthetic',task_id:'task-synthetic',task_revision:1,
    created_at:'2026-01-01T00:00:00.000Z',expires_at:'2026-01-01T00:01:00.000Z',
    items:[
      {id:'item-a',subject:{kind:'file',rel:'fixtures/alpha.txt'},source_id:'source-a'},
      {id:'item-b',subject:{kind:'cad_model',rel:'fixtures/bravo.FCStd'},source_id:'source-b'},
    ],
    actions:[
      {instance_id:'inspect',key:'synthetic.inspect',version:1,params:{}},
      {instance_id:'compare',key:'synthetic.compare-cache',version:2,params:{}},
    ],
    descriptors:[
      {key:'synthetic.inspect',version:1,scope:'file',effects:['read_file','write_task_db'],source_read_only:true,cancellation:'cooperative',result_schema_version:1,algorithm_version:'inspect-v1'},
      {key:'synthetic.compare-cache',version:2,scope:'batch',effects:['read_file','read_cache','write_task_db'],source_read_only:true,cancellation:'cooperative',result_schema_version:3,algorithm_version:'compare-v2'},
    ],
    sources:[
      {id:'source-a',kind:'file',resource_id:'file-a',rel:'fixtures/alpha.txt',bytes:5,sha256:hash()},
      {id:'source-b',kind:'file',resource_id:'file-b',rel:'fixtures/bravo.FCStd',bytes:7,sha256:hash('b')},
      {id:'source-cache',kind:'cache',resource_id:'cache',selector:'exact-input-projection-v1',sha256:hash('c'),schema_version:2,algorithm_version:'cache-selector-v1'},
    ],
    resources:[
      {id:'file-a',kind:'file',rel:'fixtures/alpha.txt',access:'read'},
      {id:'file-b',kind:'file',rel:'fixtures/bravo.FCStd',access:'read'},
      {id:'cache',kind:'cache',key:'synthetic_catalog',access:'read',lease:{mode:'host_read_only',temporary_coordination:true,ownership:'own_lock_only',reclaim:false}},
      {id:'ledger',kind:'task_db',key:'batch_tasks',access:'write'},
    ],
    steps:[
      {id:'inspect-a',action_instance_id:'inspect',target:{scope:'file',item_id:'item-a'},source_ids:['source-a'],resource_ids:['file-a','ledger'],status:'ready'},
      {id:'inspect-b',action_instance_id:'inspect',target:{scope:'file',item_id:'item-b'},source_ids:['source-b'],resource_ids:['file-b','ledger'],status:'ready'},
      {id:'compare-all',action_instance_id:'compare',target:{scope:'batch',item_ids:['item-a','item-b']},source_ids:['source-a','source-b','source-cache'],resource_ids:['file-a','file-b','cache','ledger'],status:'ready'},
    ],
  };
}
const compile=(value:unknown)=>compilePlanV2(value as NextPlanInput);
function rejects(value:unknown,code?:NextProtocolError['code']){
  try{compile(value);expect.fail('Expected v2 rejection');}catch(error){expect(error).toBeInstanceOf(NextProtocolError);if(code)expect(error).toMatchObject({code});}
}
function unavailable(input:Draft){
  const source=input.sources[1];if(source.kind!=='file')throw new Error('Synthetic fixture');
  input.sources[1]={id:source.id,kind:'file',resource_id:source.resource_id,rel:source.rel,bytes:null,sha256:null,error:'Synthetic source unreadable'};
  input.items[1].error='Synthetic source unreadable';
  for(const step of input.steps.filter(step=>step.source_ids.includes(source.id))){step.status='blocked';step.reason='Input observation incomplete';}
}

describe('unwired next batch protocol: pure v2 frozen payload',()=>{
  it('compiles one file step per item and exactly one whole-input batch step',()=>{
    const plan=compilePlanV2(draft());
    expect(plan.protocol_version).toBe(2);expect(plan.completeness).toBe('complete');
    expect(plan.steps.map(s=>s.id)).toEqual(['inspect-a','inspect-b','compare-all']);
    expect(plan.steps[2].target).toEqual({scope:'batch',item_ids:['item-a','item-b']});
    expect(plan.summary).toEqual({files:2,actions:2,file_steps:2,batch_steps:1,ready:3,blocked:0,not_applicable:0});
    expect(plan.effects).toEqual(['read_file','read_cache','write_task_db']);
    expect(plan.descriptors[1]).toMatchObject({scope:'batch',source_read_only:true,result_schema_version:3,algorithm_version:'compare-v2',cancellation:'cooperative'});
    expect(plan).not.toHaveProperty('digest');expect(plan).not.toHaveProperty('status');expect(plan).not.toHaveProperty('authorization');
  });
  it('deep-freezes an independent copy without freezing or modifying caller data',()=>{
    const input=draft(),before=structuredClone(input),plan=compilePlanV2(input);
    expect(input).toEqual(before);expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(plan.steps[2].target)).toBe(true);expect(Object.isFrozen(plan.resources[0])).toBe(true);
    input.items[0].subject.rel='fixtures/changed.txt';expect(plan.items[0].subject.rel).toBe('fixtures/alpha.txt');
    expect(()=>{(plan.items as unknown[]).pop();}).toThrow();
  });
  it('has deterministic canonical bytes, but delegates all hashing and authorization to the host',()=>{
    const input=draft(),plan=compilePlanV2(input),payload=canonicalPlanPayloadV2(plan);
    const reordered=Object.fromEntries(Object.entries(plan).reverse());expect(canonicalPlanPayloadV2(reordered)).toBe(payload);
    input.steps.reverse();input.resources.reverse();input.sources.reverse();input.descriptors.reverse();
    expect(canonicalPlanPayloadV2(compilePlanV2(input))).toBe(payload);
    const changed=draft();changed.sources[0].sha256=hash('d');
    expect(createHash('sha256').update(canonicalPlanPayloadV2(compilePlanV2(changed))).digest('hex')).not.toBe(createHash('sha256').update(payload).digest('hex'));
    expect(validatePlanV2(JSON.parse(payload))).toEqual(plan);
  });
  it('retains all items and makes an unreadable input and its whole-batch action blocked/incomplete',()=>{
    const input=draft();unavailable(input);const plan=compilePlanV2(input);
    expect(plan.items).toHaveLength(2);expect(plan.items[1].error).toBe('Synthetic source unreadable');
    expect(plan.sources.find(s=>s.id==='source-b')).toMatchObject({sha256:null,bytes:null,error:'Synthetic source unreadable'});
    expect(plan.steps[2]).toMatchObject({target:{scope:'batch',item_ids:['item-a','item-b']},status:'blocked'});
    expect(plan.completeness).toBe('incomplete');expect(plan.summary).toMatchObject({files:2,ready:1,blocked:2});expect(validatePlanV2(plan)).toEqual(plan);
  });
  it.each(['ready','not_applicable'] as const)('cannot disguise an unreadable batch input as %s',status=>{
    const input=draft();unavailable(input);input.steps[2].status=status;rejects(input,'incomplete_scope');
  });
  it('also blocks a missing cache projection without claiming a cache hash',()=>{
    const input=draft(),source=input.sources[2];if(source.kind!=='cache')throw new Error('Synthetic fixture');
    input.sources[2]={...source,sha256:null,error:'Synthetic coherent projection unavailable'};input.steps[2].status='blocked';input.steps[2].reason='Cache observation unavailable';
    expect(compilePlanV2(input)).toMatchObject({completeness:'incomplete',summary:{ready:2,blocked:1}});
    input.steps[2].status='ready';rejects(input,'incomplete_scope');
  });
  it('keeps legitimate not-applicable steps instead of dropping matrix entries',()=>{
    const input=draft();input.steps[1].status='not_applicable';input.steps[1].reason='Synthetic file action does not apply';
    expect(compilePlanV2(input).summary).toMatchObject({file_steps:2,ready:2,not_applicable:1});
    input.steps.splice(1,1);rejects(input,'incomplete_scope');
  });
  it.each(['not_applicable','blocked'] as const)('does not invent an unread cache source for an excluded %s capability',status=>{
    const input=draft();input.sources=input.sources.filter(source=>source.kind!=='cache');input.resources=input.resources.filter(resource=>resource.kind!=='cache');
    const excluded=input.steps[2];excluded.source_ids=['source-a','source-b'];excluded.resource_ids=['file-a','file-b','ledger'];excluded.status=status;excluded.reason='No domain cache read was performed';
    const plan=compilePlanV2(input);expect(plan.effects).toContain('read_cache');expect(plan.resources.some(resource=>resource.kind==='cache')).toBe(false);
    expect(plan.steps[2].status).toBe(status);expect(validatePlanV2(plan)).toEqual(plan);
    excluded.status='ready';expect(()=>compilePlanV2(input)).toThrow(/effects/);
  });
  it('supports repeated action instances without multiplying each batch into file steps',()=>{
    const input=draft();input.actions.push({...input.actions[1],instance_id:'compare-again'});
    input.steps.push({...input.steps[2],id:'compare-again-all',action_instance_id:'compare-again'});
    const plan=compilePlanV2(input);expect(plan.descriptors).toHaveLength(2);expect(plan.summary).toMatchObject({actions:3,file_steps:2,batch_steps:2});
  });
  it.each([
    ['batch represented by first item',(p:Draft)=>{p.steps[2].target={scope:'batch',item_ids:['item-a']};}],
    ['batch input reordered',(p:Draft)=>{p.steps[2].target={scope:'batch',item_ids:['item-b','item-a']};}],
    ['duplicate batch input',(p:Draft)=>{p.steps[2].target={scope:'batch',item_ids:['item-a','item-a']};}],
    ['file masquerading as batch',(p:Draft)=>{p.steps[2].target={scope:'file',item_id:'item-a'};}],
    ['missing file action member',(p:Draft)=>{p.steps.splice(1,1);}],
    ['missing batch action',(p:Draft)=>{p.steps.pop();}],
    ['two steps for one batch action',(p:Draft)=>{p.steps.push({...p.steps[2],id:'extra-batch'});}],
    ['missing input source',(p:Draft)=>{p.steps[2].source_ids.splice(1,1);}],
    ['unknown input source',(p:Draft)=>{p.steps[2].source_ids.push('absent-source');}],
  ])('rejects incomplete scope: %s',(_name,mutate)=>{const input=draft();mutate(input);rejects(input,'incomplete_scope');});
  it.each([
    ['native effect',(p:Draft)=>{(p.descriptors[0].effects as string[]).push('native');}],
    ['source write effect',(p:Draft)=>{(p.descriptors[0].effects as string[]).push('write_source');}],
    ['undeclared cache read',(p:Draft)=>{p.descriptors[1].effects=['read_file','write_task_db'];}],
    ['unperformed cache read',(p:Draft)=>{p.descriptors[0].effects=['read_file','read_cache','write_task_db'];}],
  ])('rejects unknown or mismatched effects: %s',(_name,mutate)=>{const input=draft();mutate(input);rejects(input,'unknown_effect');});
  it.each([
    ['duplicate item',(p:Draft)=>{p.items[1].id=p.items[0].id;}],
    ['duplicate action',(p:Draft)=>{p.actions[1].instance_id=p.actions[0].instance_id;}],
    ['duplicate descriptor',(p:Draft)=>{p.descriptors.push({...p.descriptors[0]});}],
    ['duplicate source',(p:Draft)=>{p.sources.push({...p.sources[0]});}],
    ['duplicate resource',(p:Draft)=>{p.resources.push({...p.resources[0]});}],
    ['duplicate step',(p:Draft)=>{p.steps[1].id=p.steps[0].id;}],
    ['duplicate source id in step',(p:Draft)=>{p.steps[2].source_ids.push('source-a');}],
    ['duplicate effect',(p:Draft)=>{p.descriptors[0].effects.push('read_file');}],
    ['extra manifest resource',(p:Draft)=>{p.resources.push({id:'unused',kind:'file',rel:'fixtures/unused.txt',access:'read'});}],
    ['extra manifest source',(p:Draft)=>{p.sources.push({id:'unused',kind:'cache',resource_id:'cache',selector:'unused-projection',sha256:hash('e'),schema_version:2,algorithm_version:'cache-selector-v1'});}],
    ['missing ledger resource',(p:Draft)=>{p.resources.pop();}],
    ['missing step resource',(p:Draft)=>{p.steps[0].resource_ids.pop();}],
    ['wrong file resource',(p:Draft)=>{p.steps[0].resource_ids.push('file-b');}],
    ['wrong item source',(p:Draft)=>{p.items[1].source_id='source-a';}],
    ['missing descriptor',(p:Draft)=>{p.descriptors.pop();}],
    ['wrong descriptor version',(p:Draft)=>{p.descriptors[1].version=3;}],
    ['source readonly false',(p:Draft)=>{(p.descriptors[0] as unknown as Record<string,unknown>).source_read_only=false;}],
    ['unsafe cancellation',(p:Draft)=>{(p.descriptors[0] as unknown as Record<string,unknown>).cancellation='kill_native';}],
    ['missing result version',(p:Draft)=>{p.descriptors[0].result_schema_version=0;}],
    ['missing algorithm version',(p:Draft)=>{p.descriptors[0].algorithm_version='';}],
    ['unreviewed action params',(p:Draft)=>{Object.assign(p.actions[0].params,{write:true});}],
    ['source hash absent',(p:Draft)=>{delete (p.sources[0] as unknown as Record<string,unknown>).sha256;}],
    ['source hash blank',(p:Draft)=>{p.sources[0].sha256='';}],
    ['source hash null without error',(p:Draft)=>{(p.sources[0] as unknown as Record<string,unknown>).sha256=null;}],
    ['source hash plus error',(p:Draft)=>{Object.assign(p.sources[0],{error:'Unreadable'});}],
    ['item error hidden',(p:Draft)=>{unavailable(p);delete p.items[1].error;}],
    ['fake bytes for unreadable source',(p:Draft)=>{unavailable(p);Object.assign(p.sources[1],{bytes:0});}],
    ['blocked without reason',(p:Draft)=>{p.steps[0].status='blocked';}],
    ['cache lease reclaim',(p:Draft)=>{const r=p.resources[2];if(r.kind==='cache')(r.lease as unknown as Record<string,unknown>).reclaim=true;}],
    ['source write access',(p:Draft)=>{(p.resources[0] as unknown as Record<string,unknown>).access='write';}],
    ['unsafe source rel',(p:Draft)=>{const s=p.sources[0];if(s.kind==='file')s.rel='../outside.txt';}],
    ['expired lifetime',(p:Draft)=>{p.expires_at=p.created_at;}],
  ])('rejects invalid frozen data: %s',(_name,mutate)=>{const input=draft();mutate(input);rejects(input);});
  it('rejects hidden cache path resources instead of treating them as ordinary user files',()=>{
    const input=draft(),resource=input.resources[0];if(resource.kind==='file')resource.rel='.phoenix/cache.sqlite';rejects(input);
  });
  it.each(['case','nfc'])('does not accept ambiguous %s path aliases',mode=>{
    const input=draft();const first=mode==='case'?'fixtures/Alpha.txt':'fixtures/caf\u00e9.txt',second=mode==='case'?'fixtures/alpha.txt':'fixtures/cafe\u0301.txt';
    input.resources[0]={id:'file-a',kind:'file',rel:first,access:'read'};input.resources[1]={id:'file-b',kind:'file',rel:second,access:'read'};rejects(input);
  });
  it('rejects arrays with holes, accessors or extra properties without evaluating them',()=>{
    const sparse=draft();delete (sparse.items as unknown[])[0];rejects(sparse);
    const accessor=draft();let called=false;Object.defineProperty(accessor.steps,'0',{enumerable:true,get(){called=true;return {};}});rejects(accessor);expect(called).toBe(false);
    const extra=draft();Object.assign(extra.actions,{ignored:true});rejects(extra);
    const object=draft();Object.defineProperty(object.descriptors[0],'scope',{enumerable:true,get(){called=true;return 'file';}});rejects(object);expect(called).toBe(false);
  });
  it('does not coerce executable values to strings',()=>{
    const input=draft();let called=false;Object.assign(input.descriptors[0],{scope:{toString(){called=true;return 'file';}}});rejects(input);expect(called).toBe(false);
  });
  it('does not execute inherited custom Array methods while compiling prepared data',()=>{
    const input=draft();let called=false;const prototype=Object.create(Array.prototype);Object.defineProperty(prototype,'map',{get(){called=true;throw new Error('Do not execute');}});Object.setPrototypeOf(input.items,prototype);rejects(input);expect(called).toBe(false);
  });
  it('enforces the independent input budget without truncating to a successful prefix',()=>{
    const input=draft();input.items=Array.from({length:NEXT_PLAN_LIMITS.items+1},(_,i)=>({...input.items[0],id:`item-${i}`}));rejects(input,'limit');
    const actions=draft();actions.actions=Array.from({length:NEXT_PLAN_LIMITS.actions+1},(_,i)=>({...actions.actions[0],instance_id:`action-${i}`}));rejects(actions,'limit');
  });
  it('rejects a complete but oversized canonical matrix instead of truncating its frozen content',()=>{
    const input=draft();input.descriptors=[input.descriptors[0]];
    input.actions=Array.from({length:8},(_,i)=>({...input.actions[0],instance_id:`inspect-${i}`}));
    input.items=Array.from({length:200},(_,i)=>({id:`item-${i}`,subject:{kind:'file',rel:`fixtures/public-${i}.txt`},source_id:`source-${i}`}));
    input.sources=input.items.map(item=>({id:item.source_id,kind:'file',resource_id:`file-${item.id}`,rel:item.subject.rel,bytes:1,sha256:hash()}));
    input.resources=[...input.items.map(item=>({id:`file-${item.id}`,kind:'file' as const,rel:item.subject.rel,access:'read' as const})),{id:'ledger',kind:'task_db',key:'batch_tasks',access:'write'}];
    input.steps=input.actions.flatMap(action=>input.items.map(item=>({id:`${action.instance_id}-${item.id}`,action_instance_id:action.instance_id,target:{scope:'file' as const,item_id:item.id},source_ids:[item.source_id],resource_ids:[`file-${item.id}`,'ledger'],status:'blocked' as const,reason:'x'.repeat(2048)})));
    rejects(input,'limit');
  });
  it.each([
    ['v1 projection',(p:Record<string,unknown>)=>{delete p.protocol_version;}],
    ['unknown version',(p:Record<string,unknown>)=>{p.protocol_version=3;}],
    ['invented digest',(p:Record<string,unknown>)=>{p.digest=hash();}],
    ['invented permission',(p:Record<string,unknown>)=>{p.authorized=true;}],
    ['forged counts',(p:Record<string,unknown>)=>{(p.summary as Record<string,unknown>).ready=999;}],
    ['forged completeness',(p:Record<string,unknown>)=>{p.completeness='incomplete';}],
    ['forged effect',(p:Record<string,unknown>)=>{p.effects=['read_file','write_task_db'];}],
    ['noncanonical steps',(p:Record<string,unknown>)=>{(p.steps as unknown[]).reverse();}],
  ])('does not repair or upgrade frozen payloads: %s',(_name,mutate)=>{
    const plan=structuredClone(compilePlanV2(draft())) as unknown as Record<string,unknown>;mutate(plan);expect(()=>validatePlanV2(plan)).toThrow(NextProtocolError);
  });
  it('rejects non-JSON summary cycles before canonical serialization',()=>{
    const plan=structuredClone(compilePlanV2(draft())) as unknown as Record<string,unknown>,summary=plan.summary as Record<string,unknown>;summary.ready=summary;
    expect(()=>validatePlanV2(plan)).toThrow(NextProtocolError);
  });
});
