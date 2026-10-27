import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {BatchTaskService,batchTaskService,closeBatchTaskServices} from './service.js';
import {batchTaskRoutes} from './routes.js';
import {defaultBatchAdapters,type BatchActionAdapter} from './adapters.js';
import {buildRetryDrafts} from './retry-drafts.js';
import {isCurrentPlan} from '../../../../shared/batch-tasks/contracts.js';

const roots:string[]=[],services:BatchTaskService[]=[];
function fixture(adapters?:BatchActionAdapter[]){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'batch-retry-public-')));roots.push(root);
 fs.writeFileSync(path.join(root,'alpha.txt'),'A');fs.writeFileSync(path.join(root,'beta.txt'),'B');
 const service=new BatchTaskService(root,{adapters});services.push(service);return {root,service};
}
const draft=(keys=['file.metadata'],files=['alpha.txt','beta.txt'])=>({name:'Independent retry sample',subjects:files.map(rel=>({kind:'file' as const,rel})),actions:keys.map((key,index)=>({instance_id:'instance_'+index,key,version:1,params:{}}))});
async function prepare(service:BatchTaskService,value= draft()){
 const task=service.save(value),plan=await service.preview(task.id,task.revision);if(!isCurrentPlan(plan))throw new Error('expected V2');return plan;
}
afterEach(async()=>{for(const service of services.splice(0))await service.close();await closeBatchTaskServices();vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('groups failure files by action instance without a Cartesian scope expansion or ledger mutation',async()=>{
 const base=defaultBatchAdapters()[0];let calls=0;
 const {service}=fixture([{...base,execute:async()=>{if([1,4].includes(++calls))throw new Error('Independent expected failure');return {ok:true};}}]);
 const plan=await prepare(service,draft(['file.metadata','file.metadata'])),run=await service.accept(plan.id,plan.digest,'independent-matrix');await service.settled();
 const before=service.repository.exportBackup(),value=service.retryDrafts(run.id);
 expect(value.groups).toHaveLength(2);expect(value.groups.map(group=>[group.id,group.draft?.subjects.map(subject=>subject.rel)])).toEqual([['instance_0',['alpha.txt']],['instance_1',['beta.txt']]]);
 for(const group of value.groups){expect(group.available).toBe(true);expect(group.draft?.actions).toHaveLength(1);expect(group.draft?.actions[0].instance_id).toBe(group.id);}
 expect(service.repository.exportBackup()).toMatchObject({data:before.data,checksum:before.checksum});expect(service.listTasks()).toHaveLength(1);expect(service.listRuns()).toHaveLength(1);
 // A retry is a new ordinary definition and a fresh preview, never old authority.
 const task=service.save(value.groups[0].draft),fresh=await service.preview(task.id,task.revision);
 expect(fresh.id).not.toBe(plan.id);expect(fresh.digest).not.toBe(plan.digest);expect(fresh.summary).toMatchObject({files:1,actions:1});expect(service.listRuns()).toHaveLength(1);
});
it('retains all explicit subjects for a failed whole-batch action rather than its first file',async()=>{
 const base=defaultBatchAdapters()[0],batch:BatchActionAdapter={...base,descriptor:{...base.descriptor,key:'independent.batch',scope:'batch'},executeBatch:async()=>{throw new Error('Expected whole-batch failure');}};
 const {service}=fixture([base,batch]),plan=await prepare(service,draft(['file.metadata','independent.batch'])),run=await service.accept(plan.id,plan.digest,'whole-batch');await service.settled();
 const groups=service.retryDrafts(run.id).groups;expect(groups).toHaveLength(1);
 expect(groups[0]).toMatchObject({scope:'batch',failed_steps:1,available:true});expect(groups[0].draft?.subjects).toEqual(plan.items.map(item=>item.subject));expect(groups[0].draft?.actions.map(action=>action.key)).toEqual(['independent.batch']);
});
it('prepares blocked and interrupted observations but never successful, inapplicable or cancelled ones',async()=>{
 const {root,service}=fixture(),plan=await prepare(service,draft(['file.metadata'],['alpha.txt','missing.txt'])),run=await service.accept(plan.id,plan.digest,'blocked');await service.settled();
 expect(service.retryDrafts(run.id).groups[0].draft?.subjects).toEqual([{kind:'file',rel:'missing.txt'}]);
 for(const status of ['cancelled','interrupted'] as const){const next=await prepare(service),accepted=service.repository.acceptRun(next.id,next.digest,status).run;service.repository.finishRun(accepted.id,status);
  const groups=service.retryDrafts(accepted.id).groups;expect(groups.length).toBe(status==='cancelled'?0:1);if(status==='interrupted')expect(groups[0].draft?.subjects).toEqual(next.items.map(item=>item.subject));}
 const good=await prepare(service),succeeded=await service.accept(good.id,good.digest,'success');await service.settled();expect(service.retryDrafts(succeeded.id).groups).toEqual([]);
 fs.writeFileSync(path.join(root,'image.png'),'independent inert image placeholder');const excluded=await prepare(service,draft(['file.metadata','file.text-stats'],['image.png'])),excludedRun=await service.accept(excluded.id,excluded.digest,'excluded');await service.settled();
 expect(service.detail(excludedRun.id).steps[1].status).toBe('not_applicable');expect(service.retryDrafts(excludedRun.id).groups).toEqual([]);
});
it('rejects active, legacy and Native plans and blocks unavailable exact action versions without upgrading',async()=>{
 const base=defaultBatchAdapters()[0],{service}=fixture([{...base,execute:async()=>{throw new Error('Expected failure');}}]),plan=await prepare(service);
 const queued=service.repository.acceptRun(plan.id,plan.digest,'queued').run;expect(()=>service.retryDrafts(queued.id)).toThrow('等待运行结束');service.repository.finishRun(queued.id,'interrupted');
 const detail=service.detail(queued.id),catalog=service.catalog();
 expect(()=>buildRetryDrafts(detail,{...plan,protocol_version:undefined},catalog)).toThrow('旧版或 Native');
 expect(()=>buildRetryDrafts(detail,{protocol_version:3},catalog)).toThrow('旧版或 Native');
 const changed=buildRetryDrafts(detail,plan,catalog.map(action=>({...action,version:action.version+1}))).groups[0];
 expect(changed).toMatchObject({action_version:1,available:false});expect(changed.draft).toBeUndefined();expect(changed.reason).toContain('未自动升级');
});
it('checks the entire frozen digest and every persisted binding before projecting failure candidates',async()=>{
 const {service}=fixture(),plan=await prepare(service),run=service.repository.acceptRun(plan.id,plan.digest,'binding').run;service.repository.finishRun(run.id,'interrupted');const detail=service.detail(run.id),catalog=service.catalog();
 const tampered=structuredClone(detail);if(tampered.steps[0].scope==='batch')throw new Error('file fixture');tampered.steps[0].subject.rel='outside-selection.txt';
 expect(()=>buildRetryDrafts(tampered,plan,catalog)).toThrow('完整冻结计划不一致');
 expect(()=>buildRetryDrafts(detail,{...plan,digest:'f'.repeat(64)},catalog)).toThrow('完整冻结计划不一致');
 expect(()=>buildRetryDrafts({...detail,steps:[...detail.steps].reverse()},plan,catalog)).toThrow('完整冻结计划不一致');
});
it('freezes and executes the selected action order with stable instance identity',async()=>{
 const called:string[]=[],adapters=defaultBatchAdapters().slice(0,2).map(adapter=>({...adapter,execute:async()=>{called.push(adapter.descriptor.key);return {ok:true};}}));
 const {service}=fixture(adapters),value=draft(['file.metadata','file.text-stats']);value.actions.reverse();const plan=await prepare(service,value);
 expect(plan.actions.map(action=>action.instance_id)).toEqual(['instance_1','instance_0']);expect(plan.steps.map(step=>step.action_instance_id)).toEqual(['instance_1','instance_1','instance_0','instance_0']);
 await service.accept(plan.id,plan.digest,'ordered');await service.settled();expect(called).toEqual(['file.text-stats','file.text-stats','file.metadata','file.metadata']);
});
it('exposes only a workspace-bound read-only GET and requires terminal server history',async()=>{
 const {root,service:owned}=fixture();await owned.close();const service=batchTaskService(root),plan=await prepare(service),run=service.repository.acceptRun(plan.id,plan.digest,'http-retry').run;
 const app=new Hono().route('/api/batch-tasks',batchTaskRoutes),url=`/api/batch-tasks/runs/${run.id}/retry-drafts?workspace=${encodeURIComponent(root)}`;
 expect((await app.request(url)).status).toBe(400);service.repository.finishRun(run.id,'interrupted');const response=await app.request(url);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({run_id:run.id,groups:[{available:true,action_instance_id:'instance_0'}]});expect(service.listTasks()).toHaveLength(1);expect(service.listRuns()).toHaveLength(1);
});
