import fs from'node:fs';import os from'node:os';import path from'node:path';
import {afterEach,expect,it,vi}from'vitest';import {strToU8,zipSync}from'fflate';
import {BatchTaskService}from'./service.js';import {defaultBatchAdapters,type BatchActionAdapter}from'./adapters.js';
import {isCurrentPlan}from'../../../../shared/batch-tasks/contracts.js';
import type {BatchTask}from'../../../../shared/batch-tasks/contracts.js';
import {createHash,randomUUID}from'node:crypto';
import childProcess from'node:child_process';
import {compileNativePreparedStepV3,canonicalNativeProfileV3Payload}from'../../../../shared/batch-tasks/native-protocol.js';
import {createNativeBatchPlanV3,canonicalNativePlanV3Payload}from'../../../../shared/batch-tasks/native-envelope.js';
import {NativeBatchRuntime}from'./native-runtime.js';
import * as nativeRunner from'../cad-native-measurement/runner.js';
import {taskDraft}from'./model.js';
const roots:string[]=[],services:BatchTaskService[]=[];
function fixture(adapters?:BatchActionAdapter[]){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'batch-service-')));roots.push(root);fs.writeFileSync(path.join(root,'alpha.txt'),'one two\nthree');const service=new BatchTaskService(root,{adapters});services.push(service);return {root,service};}
const draft=(name='Sample',files=['alpha.txt'],keys=['file.metadata','file.text-stats'])=>({name,subjects:files.map(rel=>({kind:'file' as const,rel})),actions:keys.map((key,i)=>({instance_id:'action_'+i,key,version:1 as const,params:{}}))});
async function plan(service:BatchTaskService,name='Sample',files=['alpha.txt'],keys=['file.metadata','file.text-stats']){const task=service.save(draft(name,files,keys)),value=await service.preview(task.id,task.revision);if(!isCurrentPlan(value))throw new Error('expected V2 test fixture');return value;}
afterEach(async()=>{for(const s of services.splice(0))await s.close();vi.restoreAllMocks();for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true});});
it('persists a read-only batch, observations and events without altering its inputs',async()=>{const {root,service}=fixture(),before=fs.readFileSync(path.join(root,'alpha.txt')),p=await plan(service),run=await service.accept(p.id,p.digest,'request-one');await service.settled();const detail=service.detail(run.id);expect(detail.run).toMatchObject({status:'succeeded',total:2,completed:2,failed:0});expect(detail.steps[1].result).toMatchObject({lines:2,words:3,encoding:'UTF-8'});expect(detail.events.map(e=>e.seq)).toEqual(detail.events.map((_,i)=>i+1));expect(fs.readFileSync(path.join(root,'alpha.txt'))).toEqual(before);expect(fs.readdirSync(root).sort()).toEqual(['.phoenix','alpha.txt']);});
it('queues two definitions, freezes an admitted revision and deduplicates lost responses',async()=>{let unblock!:()=>void;const gate=new Promise<void>(r=>unblock=r),executions:string[]=[];const base=defaultBatchAdapters()[0],slow={...base,execute:async(root:string,subject:any,signal:AbortSignal)=>{executions.push(subject.rel);await gate;return base.execute(root,subject,signal);}};const {service}=fixture([slow]);const first=await plan(service,'First',['alpha.txt'],['file.metadata']),a=await service.accept(first.id,first.digest,'same-request');await vi.waitFor(()=>expect(service.detail(a.id).run.status).toBe('running'));const second=await plan(service,'Second',['alpha.txt'],['file.metadata']),b=await service.accept(second.id,second.digest,'second-request');expect(service.detail(b.id).run.status).toBe('queued');service.save(draft('Updated',['alpha.txt'],['file.metadata']),first.task_id,first.task_revision);expect((await service.accept(first.id,first.digest,'same-request')).id).toBe(a.id);await expect(service.accept(second.id,second.digest,'same-request')).rejects.toThrow('不同计划');unblock();await service.settled();expect(service.detail(a.id).run.task_name).toBe('First');expect(service.detail(b.id).run.status).toBe('succeeded');expect(executions).toEqual(['alpha.txt','alpha.txt']);});
it('rejects source drift at admission, then continues independent safe steps after an execution error',async()=>{const {root,service}=fixture();let p=await plan(service);fs.appendFileSync(path.join(root,'alpha.txt'),'changed');await expect(service.accept(p.id,p.digest,'stale')).rejects.toThrow('源文件');expect(service.repository.getPlan(p.id)?.status).toBe('fresh');fs.writeFileSync(path.join(root,'binary.dat'),Buffer.from([0,1,2]));p=await plan(service,'mixed',['binary.dat','alpha.txt']);const run=await service.accept(p.id,p.digest,'valid');await service.settled();expect(service.detail(run.id).run).toMatchObject({status:'partial',completed:3,failed:1});});
it('records exclusions without executing them and refuses an all-excluded plan',async()=>{const {root,service}=fixture();fs.writeFileSync(path.join(root,'image.png'),'not-decoded');const p=await plan(service,'Missing',['missing.txt','image.png']);expect(p.items[0].error).toBeTruthy();const run=await service.accept(p.id,p.digest,'some-ready');await service.settled();expect(service.detail(run.id).steps.map(s=>s.status)).toEqual(['blocked','succeeded','blocked','not_applicable']);const q=await plan(service,'No applicable',['image.png'],['cad.saved-properties']);await expect(service.accept(q.id,q.digest,'no-ready')).rejects.toThrow('没有可执行');});
it('only cancels at the service boundary and preserves success before remaining steps cancel',async()=>{let unblock!:()=>void;const gate=new Promise<void>(r=>unblock=r),base=defaultBatchAdapters()[0];let calls=0;const adapter={...base,execute:async(root:string,subject:any,signal:AbortSignal)=>{if(++calls===2)await gate;return base.execute(root,subject,signal);}};const {root,service}=fixture([adapter]);fs.writeFileSync(path.join(root,'beta.txt'),'B');const p=await plan(service,'cancel',['alpha.txt','beta.txt'],['file.metadata']),run=await service.accept(p.id,p.digest,'cancel');await vi.waitFor(()=>expect(calls).toBe(2));expect(service.cancel(run.id).status).toBe('cancel_requested');expect(service.detail(run.id).run.status).toBe('cancel_requested');unblock();await service.settled();expect(service.detail(run.id).run).toMatchObject({status:'partial',completed:1,cancel_requested:true});expect(service.detail(run.id).steps[1].status).toBe('cancelled');expect(service.cancel(run.id).status).toBe('partial');});
it('collects saved FCStd fields through the existing bounded reader without Native',async()=>{const {root,service}=fixture();const xml='<Document><Objects Count="1"><Object name="Piece" type="Part::Feature"/></Objects><ObjectData Count="1"><Object name="Piece"><Properties Count="3"><Property name="Label" type="App::PropertyString"><String value="Independent block"/></Property><Property name="PartName" type="App::PropertyString"><String value="Block"/></Property><Property name="Material" type="App::PropertyString"><String value="Synthetic grade"/></Property></Properties></Object></ObjectData></Document>';fs.writeFileSync(path.join(root,'model.FCStd'),zipSync({'Document.xml':strToU8(xml)}));const bytes=fs.readFileSync(path.join(root,'model.FCStd')),p=await plan(service,'saved',['model.FCStd'],['cad.saved-properties']),run=await service.accept(p.id,p.digest,'CAD-read');await service.settled();const detail=service.detail(run.id);expect(detail.run.status,detail.steps[0].message).toBe('succeeded');expect(detail.steps[0].result).toMatchObject({physical_material:false,objects:[{name:'Piece',label:'Independent block',material:'Synthetic grade'}]});expect(fs.readFileSync(path.join(root,'model.FCStd'))).toEqual(bytes);});
it('rejects unknown actions, unsafe paths and symbolic input without broadening selection',async()=>{const {root,service}=fixture();expect(()=>service.save(draft('bad',['../outside.txt']))).toThrow('越界');expect(()=>service.save(draft('bad',['alpha.txt'],['shell.run']))).toThrow('动作');fs.symlinkSync(path.join(root,'alpha.txt'),path.join(root,'alias.txt'));const p=await plan(service,'symlink',['alias.txt'],['file.metadata']);expect(p.summary.executable).toBe(0);expect(p.items[0].error).toContain('符号链接');});
it('recovers a transient claim lock without an unhandled rejection or a lost queued task',async()=>{const {service}=fixture(),p=await plan(service);const claim=vi.spyOn(service.repository,'claimQueuedRun');claim.mockImplementationOnce(()=>{throw new Error('database is locked');});const run=await service.accept(p.id,p.digest,'lock-retry');await service.settled();expect(claim.mock.calls.length).toBeGreaterThan(1);expect(service.detail(run.id).run.status).toBe('succeeded');});
it('an idempotent request wakes its already-accepted queued run after a recoverable dispatcher error',async()=>{const {service}=fixture(),p=await plan(service),claim=vi.spyOn(service.repository,'claimQueuedRun').mockImplementation(()=>{throw new Error('owner resource unavailable');});const run=await service.accept(p.id,p.digest,'retry-wakeup');await service.settled();expect(service.detail(run.id).run.status).toBe('queued');expect(()=>service.listRuns()).toThrow('队列调度已停止');claim.mockRestore();expect((await service.accept(p.id,p.digest,'retry-wakeup')).id).toBe(run.id);await service.settled();expect(service.detail(run.id).run.status).toBe('succeeded');});
it('marks active and queued work interrupted on close and never replays it after service restart',async()=>{
 let started!:()=>void;
 const begun=new Promise<void>(resolve=>started=resolve),base=defaultBatchAdapters()[0];
 const adapter={...base,execute:async(_root:string,_subject:any,signal:AbortSignal)=>{
  started();
  await new Promise<void>((_resolve,reject)=>{
   if(signal.aborted)reject(new Error('Service stopped'));
   else signal.addEventListener('abort',()=>reject(new Error('Service stopped')),{once:true});
  });
  return {};
 }};
 const {root,service}=fixture([adapter]);
 const first=await plan(service,'First',['alpha.txt'],['file.metadata']);
 const a=await service.accept(first.id,first.digest,'close-active');
 await begun;
 const second=await plan(service,'Second',['alpha.txt'],['file.metadata']);
 const b=await service.accept(second.id,second.digest,'close-queued');
 expect(service.detail(b.id).run.status).toBe('queued');
 const unused=await plan(service,'Unused',['alpha.txt'],['file.metadata']);
 await service.close();
 const restarted=new BatchTaskService(root);services.push(restarted);
 expect(restarted.detail(a.id).run.status).toBe('interrupted');
 expect(restarted.detail(b.id).run.status).toBe('interrupted');
 expect(restarted.detail(a.id).steps[0].status).toBe('interrupted');
 expect(restarted.repository.getPlan(unused.id)?.status).toBe('invalidated');
 await restarted.settled();
 expect(restarted.listRuns().every(run=>run.status==='interrupted')).toBe(true);
});

// Only routing fixtures: inert bytes and pure DTO claims. Native preview/verify/
// execute are stubbed explicitly; no fixture is a valid BRep or Native proof.
const nativeDraft=()=>({name:'Explicit host pilot',subjects:[{kind:'file' as const,rel:'Independent.FCStd',node:'ExampleFeature'}],actions:[{instance_id:'snapshot',key:'cad.saved-shape-measurement',version:1,params:{}}]});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function nativeFixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'batch-host-routing-unit-')));roots.push(root);
 const command=path.join(root,'freecadcmd'),binary=Buffer.from('independent inert executable fixture; never spawned\n');
 fs.writeFileSync(command,binary,{mode:0o700});fs.writeFileSync(path.join(root,'Independent.FCStd'),'inert source, not an FCStd');fs.writeFileSync(path.join(root,'alpha.txt'),'one two\nthree');
 const engine={command,bytes:binary.length,sha256:sha(binary),app_version:['1','1','0'] as const,occ_version:'7.8.1'};
 const service=new BatchTaskService(root,{native:{engine}});services.push(service);return {root,service,engine};
}
function nativePlan(task:BatchTask){
 const subject={kind:'file' as const,rel:task.subjects[0].rel,node:task.subjects[0].node!},claim='1'.repeat(64);
 const profile={key:'freecad.saved-brep-snapshot' as const,version:1 as const,measurement_profile:'saved_brep_snapshot' as const,algorithm_version:'saved-brep-snapshot-native-bounds-v1' as const,
  script_sha256:claim,engine:{key:'freecadcmd' as const,bytes:100,sha256:claim,app_version:['1','1','0'] as const,occ_version:'7.8.1'},timeout_ms:120000};
 const step=compileNativePreparedStepV3({step_id:randomUUID(),item_id:randomUUID(),subject,profile,profile_sha256:sha(canonicalNativeProfileV3Payload(profile)),
  manifest:{schema_version:1,algorithm_version:'single-feature-saved-manifest-v2',measurement_profile:'saved_brep_snapshot',source:{rel:subject.rel,bytes:25,sha256:claim},document_xml:{bytes:40,sha256:claim},
   entity:{node:subject.node,type_id:'Part::Feature',shape_property:'Shape',shape_property_type:'Part::PropertyPartShape'},
   shape:{basis:'serialized_shape_snapshot',member_path:'ExampleFeature.Shape.brp',bytes:20,sha256:claim,crc32:'12345678',compression:'stored'},
   dependencies:[],dependency_check:'strict_saved_shape_carrier_v1',dependency_scope:'saved_shape_carrier',engine_asset_dependencies:'not_attested',
   material:{uuid_raw:'00000000-0000-0000-0000-000000000000',state:'nil',resolution_performed:false,density_kg_m3:null,mass_kg:null},restored_document:{verified:false},native_executed:false,manifest_sha256:claim}});
 const prepared={protocol_version:3,id:randomUUID(),task_id:task.id,task_revision:task.revision,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),action_instance_id:task.actions[0].instance_id,step};
 return createNativeBatchPlanV3(prepared,sha(canonicalNativePlanV3Payload(prepared)));
}
function stubNativePreview(){return vi.spyOn(NativeBatchRuntime.prototype,'preview').mockImplementation(async task=>nativePlan(task));}
function noNative(){return vi.spyOn(childProcess,'spawn').mockImplementation(()=>{throw new Error('Native forbidden in service routing unit test');});}

it('keeps the default seven-action service Native-disabled without engine discovery or process launch',async()=>{
 const spawn=noNative(),engine=vi.spyOn(nativeRunner,'verifyFrozenNativeEngine'),{service}=fixture();
 expect(service.catalog()).toHaveLength(7);expect(service.catalog().some(d=>d.key==='cad.saved-shape-measurement')).toBe(false);
 expect(()=>service.save(nativeDraft())).toThrow(/宿主显式配置/);
 expect(()=>service.save({...draft(),subjects:[{kind:'file',rel:'alpha.txt',node:'ExampleFeature'}]})).toThrow(/输入对象/);
 const p=await plan(service),run=await service.accept(p.id,p.digest,'default-still-v2');await service.settled();expect(service.detail(run.id).run.status).toBe('succeeded');
 expect(engine).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();
 await expect(service.accept(p.id,p.digest,'new-protocol-request',3)).rejects.toThrow(/宿主显式配置/);
});
it('adds Native only through explicit host options and keeps mixed/multi-file/parameterized drafts outside V2',()=>{
 noNative();const {service}=nativeFixture(),catalog=service.catalog();expect(catalog).toHaveLength(8);
 expect(catalog.at(-1)).toMatchObject({key:'cad.saved-shape-measurement',scope:'file',cancellation:'owned_process',effects:['read_file','run_native_readonly','write_private_temp','write_task_db']});
 expect(()=>taskDraft(nativeDraft(),catalog)).toThrow(/不能按V2/);
 for(const change of [(v:any)=>v.subjects.push({...v.subjects[0]}),(v:any)=>v.actions.push(draft().actions[0]),(v:any)=>delete v.subjects[0].node,(v:any)=>v.actions[0].params={script:'not allowed'}]){const value=nativeDraft();change(value);expect(()=>service.save(value)).toThrow(/invalid_native_task/);}
 expect(service.save(nativeDraft()).subjects[0].node).toBe('ExampleFeature');
 const bad={...defaultBatchAdapters()[0],descriptor:{...defaultBatchAdapters()[0].descriptor,key:'cad.saved-shape-measurement'}};
 expect(()=>new BatchTaskService(service.root,{adapters:[bad]})).toThrow(/只读/);
});
it('persists a Native preview exactly once and rejects task revision changes after async preparation',async()=>{
 const spawn=noNative(),{service}=nativeFixture(),preview=stubNativePreview(),save=vi.spyOn(service.repository,'savePlan'),task=service.save(nativeDraft());
 const p=await service.preview(task.id,1);expect(p.protocol_version).toBe(3);expect(save).toHaveBeenCalledTimes(1);expect(service.repository.getPlan(p.id)).toEqual(p);
 preview.mockImplementationOnce(async current=>{service.save({...nativeDraft(),name:'Changed'},current.id,current.revision);return nativePlan(current);});
 await expect(service.preview(task.id,1)).rejects.toThrow(/预览期间变化/);expect(save).toHaveBeenCalledTimes(1);expect(spawn).not.toHaveBeenCalled();
});
it('requires explicit V3 confirmation and preserves protocol in committed idempotency checks',async()=>{
 const spawn=noNative(),{service}=nativeFixture();stubNativePreview();const verify=vi.spyOn(NativeBatchRuntime.prototype,'verify').mockResolvedValue();
 const execute=vi.spyOn(NativeBatchRuntime.prototype,'execute').mockImplementation(async run=>{service.repository.finishRun(run.id,'interrupted','synthetic routing stub; no Native ran');});
 const task=service.save(nativeDraft()),p=await service.preview(task.id,1);
 await expect(service.accept(p.id,p.digest,'native-intent')).rejects.toThrow(/协议3/);expect(verify).not.toHaveBeenCalled();expect(service.listRuns()).toEqual([]);
 const run=await service.accept(p.id,p.digest,'native-intent',3);await service.settled();expect(execute).toHaveBeenCalledTimes(1);
 expect((await service.accept(p.id,p.digest,'native-intent',3)).id).toBe(run.id);expect(verify).toHaveBeenCalledTimes(1);
 await expect(service.accept(p.id,p.digest,'native-intent',2)).rejects.toThrow(/不同计划或协议/);
 const v2=await plan(service);await expect(service.accept(v2.id,v2.digest,'wrongly-v3',3)).rejects.toThrow(/不是V3/);
 expect(spawn).not.toHaveBeenCalled();
});
it('coalesces the same V3 admission promise but never joins an in-flight V3 intent using default V2',async()=>{
 noNative();const {service}=nativeFixture();stubNativePreview();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const verify=vi.spyOn(NativeBatchRuntime.prototype,'verify').mockImplementationOnce(async()=>{await gate;});
 vi.spyOn(NativeBatchRuntime.prototype,'execute').mockImplementation(async run=>{service.repository.finishRun(run.id,'interrupted','synthetic routing stub');});
 const task=service.save(nativeDraft()),p=await service.preview(task.id,1),first=service.accept(p.id,p.digest,'coalesced-native',3),second=service.accept(p.id,p.digest,'coalesced-native',3);
 expect(first).toBe(second);await expect(service.accept(p.id,p.digest,'coalesced-native')).rejects.toThrow(/不同计划或协议/);expect(verify).toHaveBeenCalledTimes(1);
 release();const [a,b]=await Promise.all([first,second]);expect(a.id).toBe(b.id);await service.settled();expect(service.listRuns()).toHaveLength(1);
});
it('executes V3 and V2 through the same serial queue and never replays an uncertain Native exception',async()=>{
 noNative();const {service}=nativeFixture();stubNativePreview();vi.spyOn(NativeBatchRuntime.prototype,'verify').mockResolvedValue();
 let release!:()=>void,begun!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>begun=resolve);
 const execute=vi.spyOn(NativeBatchRuntime.prototype,'execute').mockImplementationOnce(async()=>{begun();await gate;throw new Error('private exception must not leak or trigger replay');});
 const task=service.save(nativeDraft()),p=await service.preview(task.id,1),run=await service.accept(p.id,p.digest,'serialized-native',3);await started;
 const v2=await plan(service),next=await service.accept(v2.id,v2.digest,'serialized-v2');expect(service.detail(next.id).run.status).toBe('queued');
 release();await service.settled();expect(service.detail(run.id).run).toMatchObject({status:'interrupted',message:'Native运行未确认，保留记录且不自动重放'});
 expect(service.detail(next.id).run.status).toBe('succeeded');expect(execute).toHaveBeenCalledTimes(1);
 expect((await service.accept(p.id,p.digest,'serialized-native',3)).id).toBe(run.id);await service.settled();expect(execute).toHaveBeenCalledTimes(1);
});
it('aborts and awaits an in-flight V3 verification before closing its ledger',async()=>{
 noNative();const {service}=nativeFixture();stubNativePreview();let begun!:()=>void;const started=new Promise<void>(resolve=>begun=resolve);
 vi.spyOn(NativeBatchRuntime.prototype,'verify').mockImplementationOnce(async(_plan,signal)=>{begun();await new Promise<void>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new Error('synthetic native admission cancelled')),{once:true}));});
 const admit=vi.spyOn(service.repository,'acceptRun'),task=service.save(nativeDraft()),p=await service.preview(task.id,1);
 const pending=expect(service.accept(p.id,p.digest,'closing-native',3)).rejects.toThrow(/cancelled/);await started;await service.close();await pending;expect(admit).not.toHaveBeenCalled();
});
it.each(['engine','timeout'])('closes only its self-created ledger if explicit Native %s configuration is invalid',async invalid=>{
 noNative();const {root,service,engine}=nativeFixture();await service.close();
 const options=invalid==='engine'?{engine:{...engine,sha256:'f'.repeat(64)}}:{engine,timeout_ms:99};
 expect(()=>new BatchTaskService(root,{native:options})).toThrow();
 const reopened=new BatchTaskService(root);services.push(reopened);expect(reopened.listTasks()).toEqual([]);
});
it('never closes an injected repository when Native configuration fails',()=>{
 noNative();const {root,service}=fixture(),close=vi.spyOn(service.repository,'close');
 expect(()=>new BatchTaskService(root,{repository:service.repository,native:{engine:{command:path.join(root,'missing-freecadcmd'),bytes:1,sha256:'1'.repeat(64),app_version:['1','1','0'],occ_version:'7.8.1'}}})).toThrow();
 expect(close).not.toHaveBeenCalled();expect(service.listTasks()).toEqual([]);expect(service.save(draft()).revision).toBe(1);
});
