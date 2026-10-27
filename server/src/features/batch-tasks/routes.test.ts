import fs from'node:fs';import os from'node:os';import path from'node:path';import{Hono}from'hono';import{afterEach,expect,it,vi}from'vitest';
import{batchTaskRoutes}from'./routes.js';import{batchTaskService,closeBatchTaskServices}from'./service.js';
const app=new Hono().route('/api/batch-tasks',batchTaskRoutes),roots:string[]=[];
function root(){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'batch-http-')));roots.push(dir);fs.writeFileSync(path.join(dir,'sample.txt'),'alpha beta');return dir;}
const call=(workspace:string,route:string,value?:unknown)=>app.request(`/api/batch-tasks/${route}?workspace=${encodeURIComponent(workspace)}`,value===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const draft={name:'HTTP sample',subjects:[{kind:'file',rel:'sample.txt'}],actions:[{instance_id:'meta',key:'file.metadata',version:1,params:{}}]};
afterEach(async()=>{await closeBatchTaskServices();vi.restoreAllMocks();for(const dir of roots.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
it('requires an explicit V2-capable confirmation without consuming the plan for a legacy client',async()=>{
 const workspace=root(),task=(await(await call(workspace,'tasks',{draft})).json() as any).task;
 const plan=(await(await call(workspace,`tasks/${task.id}/preview`,{expected_revision:1})).json() as any).plan;
 expect(plan.protocol_version).toBe(2);const input={plan_id:plan.id,digest:plan.digest,client_request_id:'version-aware',confirmed:true};
 for(const version of [undefined,1,3]){const response=await call(workspace,'runs',{...input,...(version===undefined?{}:{protocol_version:version})});expect(response.status).toBe(400);}
 expect((await(await call(workspace,'runs')).json() as any).runs).toEqual([]);
 expect((await call(workspace,'runs',{...input,protocol_version:2})).status).toBe(202);
});
it('keeps default HTTP Native-disabled and forwards only an explicit numeric V3 declaration without upgrading V2',async()=>{
 const workspace=root(),catalog=await(await call(workspace,'actions')).json() as any;
 expect(catalog.actions).toHaveLength(7);expect(catalog.actions.some((action:any)=>action.key==='cad.saved-shape-measurement')).toBe(false);
 const native={name:'No default Native',subjects:[{kind:'file',rel:'Example.FCStd',node:'ExampleFeature'}],actions:[{instance_id:'snapshot',key:'cad.saved-shape-measurement',version:1,params:{}}]};
 expect((await call(workspace,'tasks',{draft:native})).status).toBe(400);
 const service=batchTaskService(workspace),accept=vi.spyOn(service,'accept').mockRejectedValue(new Error('synthetic protocol boundary'));
 const input={plan_id:'plan',digest:'a'.repeat(64),client_request_id:'explicit-protocol',confirmed:true};
 for(const version of [undefined,1,4,'3'])expect((await call(workspace,'runs',{...input,protocol_version:version})).status).toBe(400);
 expect(accept).not.toHaveBeenCalled();expect((await call(workspace,'runs',{...input,protocol_version:3})).status).toBe(400);
 expect(accept).toHaveBeenLastCalledWith('plan','a'.repeat(64),'explicit-protocol',3);
});
it('runs the CRUD/preview/confirmation/queue/result HTTP path with an idempotent request',async()=>{const workspace=root();expect((await call(workspace,'actions')).status).toBe(200);let response=await call(workspace,'tasks',{draft});const task=(await response.json() as any).task;expect(task.revision).toBe(1);response=await call(workspace,`tasks/${task.id}/preview`,{expected_revision:1});const plan=(await response.json() as any).plan;expect(plan.summary).toMatchObject({files:1,actions:1,executable:1});expect((await call(workspace,'runs',{plan_id:plan.id,digest:plan.digest,client_request_id:'http-one',confirmed:false})).status).toBe(400);const input={plan_id:plan.id,digest:plan.digest,client_request_id:'http-one',confirmed:true,protocol_version:2};response=await call(workspace,'runs',input);expect(response.status).toBe(202);const run=(await response.json() as any).run;expect((await call(workspace,'runs',input)).status).toBe(202);expect((await(await call(workspace,'runs/by-request/http-one')).json() as any).run.id).toBe(run.id);await vi.waitFor(async()=>{const value=await(await call(workspace,`runs/${run.id}`)).json() as any;expect(value.run.status).toBe('succeeded');expect(value.steps[0].result.bytes).toBe(10);});expect((await call(workspace,`runs/${run.id}/cancel`,{})).status).toBe(200);const page=await(await app.request(`/api/batch-tasks/runs/${run.id}?workspace=${encodeURIComponent(workspace)}&after=2`)).json() as any;expect(page.events.every((e:any)=>e.seq>2)).toBe(true);});
it('rejects wrong workspace, unknown fields, stale revision and unconfirmed run without executing',async()=>{const workspace=root(),other=root();expect((await app.request('/api/batch-tasks/tasks')).status).toBe(400);expect((await call(workspace,'tasks',{draft,shell:'do not execute'})).status).toBe(400);const task=(await(await call(workspace,'tasks',{draft})).json() as any).task;expect((await call(other,`tasks/${task.id}/preview`,{expected_revision:1})).status).toBe(400);expect((await call(workspace,`tasks/${task.id}/preview`,{expected_revision:2})).status).toBe(400);expect((await call(workspace,'runs/by-request/missing')).status).toBe(404);expect((await call(workspace,'runs')).status).toBe(200);});
it('backs up and restores its own >1MiB logical task data through HTTP, not execution permissions',async()=>{const source=root(),target=root(),subjects=Array.from({length:180},(_,i)=>({kind:'file',rel:`missing_${i}_`+'x'.repeat(900)+'.txt'}));for(let i=0;i<8;i++)expect((await call(source,'tasks',{draft:{...draft,name:'Synthetic '+i,subjects}})).status).toBe(200);const backup=await(await call(source,'backup',{})).json();expect(Buffer.byteLength(JSON.stringify(backup))).toBeGreaterThan(1024*1024);const response=await call(target,'restore',{backup});expect(response.status,await response.clone().text()).toBe(200);expect((await(await call(target,'tasks')).json() as any).tasks).toHaveLength(8);expect((await(await call(target,'runs')).json() as any).runs).toEqual([]);expect((await call(target,'restore',{backup})).status).toBe(400);});
it('retries a new-task save with its creation key without duplicating or overwriting definitions',async()=>{
 const workspace=root(),creation_id='http-create-once';
 const first=await call(workspace,'tasks',{draft,creation_id});
 expect(first.status).toBe(200);
 const task=(await first.json() as any).task;
 const retry=await call(workspace,'tasks',{draft,creation_id});
 expect((await retry.json() as any).task.id).toBe(task.id);
 expect((await(await call(workspace,'tasks')).json() as any).tasks).toHaveLength(1);
 expect((await call(workspace,'tasks',{draft:{...draft,name:'Different'},creation_id})).status).toBe(400);
 expect((await call(workspace,'tasks',{draft,id:task.id,expected_revision:1,creation_id})).status).toBe(400);
});
