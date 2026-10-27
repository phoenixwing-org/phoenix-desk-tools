import {describe,expect,it,vi} from 'vitest';
import {compilePlanV2} from '../../../../shared/batch-tasks/next-protocol.js';
import {createCurrentBatchPlan,validateCurrentBatchPlan} from '../../../../shared/batch-tasks/envelope.js';
import {isBatchPlannedStep,isCurrentPlan} from '../../../../shared/batch-tasks/contracts.js';

function plan(){return compilePlanV2({id:'plan',task_id:'task',task_revision:1,created_at:'2026-01-01T00:00:00.000Z',expires_at:'2026-01-01T00:01:00.000Z',
 items:[{id:'item',subject:{kind:'file',rel:'fixture.txt'},source_id:'source'}],
 actions:[{instance_id:'action',key:'synthetic.batch',version:1,params:{}}],
 descriptors:[{key:'synthetic.batch',version:1,scope:'batch',effects:['read_file','write_task_db'],source_read_only:true,cancellation:'cooperative',algorithm_version:'v1',result_schema_version:1}],
 sources:[{id:'source',kind:'file',resource_id:'file',rel:'fixture.txt',sha256:'a'.repeat(64),bytes:1}],
 resources:[{id:'file',kind:'file',rel:'fixture.txt',access:'read'},{id:'ledger',kind:'task_db',key:'batch_tasks',access:'write'}],
 steps:[{id:'step',action_instance_id:'action',target:{scope:'batch',item_ids:['item']},source_ids:['source'],resource_ids:['file','ledger'],status:'ready'}]});}
describe('current batch plan envelope',()=>{
 it('projects whole-batch shape without a fake first-file subject or item',()=>{const envelope=createCurrentBatchPlan(plan(),'b'.repeat(64));expect(isCurrentPlan(envelope)).toBe(true);expect(isBatchPlannedStep(envelope.steps[0])).toBe(true);expect(envelope.steps[0]).not.toHaveProperty('item_id');expect(validateCurrentBatchPlan(envelope)).toEqual(envelope);});
 it.each(['items','actions','steps','effects','summary','id','task_id','task_revision','created_at','expires_at'])("rejects a wrapper mismatch in %s",field=>{const envelope=createCurrentBatchPlan(plan(),'b'.repeat(64));Object.assign(envelope,{[field]:field==='task_revision'?2:[]});expect(()=>validateCurrentBatchPlan(envelope)).toThrow();});
 it('does not upgrade a legacy plan or accept unknown wrapper fields',()=>{const envelope=createCurrentBatchPlan(plan(),'b'.repeat(64));delete (envelope as unknown as Record<string,unknown>).protocol_version;expect(()=>validateCurrentBatchPlan(envelope)).toThrow();const unknown=createCurrentBatchPlan(plan(),'b'.repeat(64));Object.assign(unknown,{authorize:true});expect(()=>validateCurrentBatchPlan(unknown)).toThrow();});
 it('rejects unsafe JSON before invoking getters or custom coercion',()=>{let accessed=false;const value={get protocol_version(){accessed=true;return 2;}};expect(()=>validateCurrentBatchPlan(value)).toThrow();expect(accessed).toBe(false);const cycle:Record<string,unknown>={};cycle.self=cycle;expect(()=>validateCurrentBatchPlan(cycle)).toThrow();});
 it('rejects oversized arrays before descriptor collection or per-entry allocation',()=>{
  const oversized:unknown[]=[];oversized.length=200001;const actual=Object.getOwnPropertyDescriptors;let touched=false;
  const spy=vi.spyOn(Object,'getOwnPropertyDescriptors').mockImplementation(value=>{if(value===oversized){touched=true;throw new Error('Unsafe allocation boundary');}return actual(value);});
  try{const unknown=createCurrentBatchPlan(plan(),'b'.repeat(64));Object.assign(unknown,{extra:oversized});expect(()=>validateCurrentBatchPlan(unknown)).toThrow();expect(touched).toBe(false);const known=createCurrentBatchPlan(plan(),'b'.repeat(64));Object.assign(known,{steps:oversized});expect(()=>validateCurrentBatchPlan(known)).toThrow();expect(touched).toBe(false);}finally{spy.mockRestore();}
 });
 it('rejects custom array prototypes without executing inherited map/getter hooks',()=>{const value=createCurrentBatchPlan(plan(),'b'.repeat(64));let called=false;const prototype=Object.create(Array.prototype);Object.defineProperty(prototype,'map',{get(){called=true;throw new Error('Must not execute');}});Object.setPrototypeOf(value.steps,prototype);expect(()=>validateCurrentBatchPlan(value)).toThrow();expect(called).toBe(false);});
 it('uses null fingerprint and bytes for an unavailable selected file and keeps its batch blocked',()=>{const source=plan(),{protocol_version:_v,effects:_e,summary:_s,completeness:_c,...input}=source;const envelope=createCurrentBatchPlan(compilePlanV2({...input,sources:[{id:'source',kind:'file',resource_id:'file',rel:'fixture.txt',sha256:null,bytes:null,error:'Unavailable'}],items:[{...source.items[0],error:'Unavailable'}],steps:[{...source.steps[0],status:'blocked',reason:'Incomplete'}]}),'b'.repeat(64));expect(envelope.items[0]).toMatchObject({sha256:null,bytes:null,error:'Unavailable'});expect(envelope.summary).toMatchObject({executable:0,excluded:1});expect(validateCurrentBatchPlan(envelope).prepared.completeness).toBe('incomplete');});
});
