import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import childProcess from 'node:child_process';
import {afterEach,expect,it,vi} from 'vitest';
import {isCurrentPlan,isBatchStep,isBatchPlannedStep,type LegacyBatchPlan} from '../../../../shared/batch-tasks/contracts.js';
import {canonicalPlanPayloadV2} from '../../../../shared/batch-tasks/next-protocol.js';
import {BatchTaskService} from './service.js';
import {defaultBatchAdapters,type BatchActionAdapter} from './adapters.js';

const roots:string[]=[],services:BatchTaskService[]=[],HASH='a'.repeat(64);
const REL='parts/DEMO42.007P1-H-Plate.FCStd';
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
function fixture(adapters?:BatchActionAdapter[]){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'batch-v2-service-')));roots.push(root);
 fs.mkdirSync(path.join(root,'parts'));fs.writeFileSync(path.join(root,REL),'independent inert saved-CAD placeholder; never opened by a CAD kernel');
 const service=new BatchTaskService(root,{adapters});services.push(service);return {root,service};
}
function cache(root:string){
 const file=path.join(root,'.phoenix/phoenix-workspace.sqlite'),db=new DatabaseSync(file);
 db.exec('CREATE TABLE desk_cad_geometry(rel TEXT PRIMARY KEY,sources_json TEXT,box_json TEXT,message TEXT,updated_at TEXT,algorithm_version INTEGER)');
 db.prepare('INSERT INTO desk_cad_geometry VALUES(?,?,?,?,?,?)').run(REL,JSON.stringify([{rel:REL,hash:HASH,stamp:'1:20:100:100'},
  {rel:'unselected/Ghost.FCStd',hash:'b'.repeat(64),stamp:'2:20:100:100'}]),JSON.stringify({x_mm:12,y_mm:8,z_mm:4}),'not exposed','2026-01-01T00:00:00Z',1);db.close();return file;
}
async function preview(service:BatchTaskService,rels:string[],keys:string[]){
 const task=service.save({name:'Independent explicit batch',subjects:rels.map(rel=>({kind:'file',rel})),actions:keys.map((key,index)=>({instance_id:'action_'+index,key,version:1,params:{}}))});
 const plan=await service.preview(task.id,task.revision);if(!isCurrentPlan(plan))throw new Error('expected V2 test fixture');return plan;
}
afterEach(async()=>{vi.restoreAllMocks();for(const service of services.splice(0))await service.close();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('freezes seven source-read-only catalog entries and never initializes a DB for an invalid adapter',()=>{
 const {service}=fixture(),catalog=service.catalog();expect(catalog).toHaveLength(7);
 expect(catalog.find(entry=>entry.key==='cad.name-audit')).toMatchObject({scope:'batch',source_read_only:true,effects:['read_file','write_task_db']});
 expect(catalog.find(entry=>entry.key==='cad.geometry-cache')).toMatchObject({scope:'file',effects:['read_file','read_cache','write_task_db']});
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'invalid-batch-catalog-')));roots.push(root);
 const base=defaultBatchAdapters()[0],bad={...base,descriptor:{...base.descriptor,effects:['read_file','write_task_db','write_cad']}} as unknown as BatchActionAdapter;
 expect(()=>new BatchTaskService(root,{adapters:[bad]})).toThrow(/只读/);expect(fs.readdirSync(root)).toEqual([]);
});
it('executes a whole-batch name audit once with all frozen identities, not once per file or a fake first file',async()=>{
 const {root,service}=fixture(),second='other/DEMO42.007P1-H-Other.FCStd';fs.mkdirSync(path.join(root,'other'));fs.writeFileSync(path.join(root,second),'different independently generated placeholder');
 const before=[REL,second].map(rel=>digest(fs.readFileSync(path.join(root,rel)))),p=await preview(service,[REL,second],['file.metadata','cad.name-audit']);
 expect(p.protocol_version).toBe(2);expect(p.prepared.summary).toMatchObject({files:2,actions:2,file_steps:2,batch_steps:1,ready:3});
 expect(p.digest).toBe(digest(canonicalPlanPayloadV2(p.prepared)));expect(p.steps).toHaveLength(3);
 const planned=p.steps.find(isBatchPlannedStep)!;expect(planned.item_ids).toEqual(p.items.map(item=>item.id));expect(planned).not.toHaveProperty('item_id');
 const accepted=await service.accept(p.id,p.digest,'whole-batch-once');await service.settled();const detail=service.detail(accepted.id),whole=detail.steps.find(isBatchStep)!;
 expect(detail.run).toMatchObject({status:'succeeded',total:3,completed:3});expect(whole.subjects.map(subject=>subject.rel)).toEqual([REL,second]);expect(whole).not.toHaveProperty('subject');
 expect(whole.result).toMatchObject({scope:'explicit_selection',complete:true,selected:2,inspected:2});expect(whole.result!.identity_duplicates).toHaveLength(1);
 expect([REL,second].map(rel=>digest(fs.readFileSync(path.join(root,rel))))).toEqual(before);
});
it('does not collapse repeated whole-batch action instances into per-file steps or a single different intent',async()=>{
 const {service}=fixture(),p=await preview(service,[REL],['cad.name-audit','cad.name-audit']);
 expect(p.prepared.summary.batch_steps).toBe(2);expect(p.prepared.descriptors).toHaveLength(1);
 const accepted=await service.accept(p.id,p.digest,'two-audit-instances');await service.settled();expect(service.detail(accepted.id).steps.filter(isBatchStep)).toHaveLength(2);
});
it('reads a frozen existing cache projection without measuring CAD, inspecting dependencies or changing cache bytes',async()=>{
 const {root,service}=fixture(),file=cache(root),before=digest(fs.readFileSync(file)),cad=digest(fs.readFileSync(path.join(root,REL)));
 const native=vi.spyOn(childProcess,'spawn');const p=await preview(service,[REL],['cad.geometry-cache']);
 expect(p.prepared.resources.find(resource=>resource.kind==='cache')).toMatchObject({key:'workspace_cad_geometry',lease:{temporary_coordination:true,ownership:'own_lock_only',reclaim:false}});
 expect(p.prepared.sources.find(source=>source.kind==='cache')).toMatchObject({selector:REL,schema_version:1,algorithm_version:'geometry-cache-snapshot-v1'});
 const accepted=await service.accept(p.id,p.digest,'cache-observation');await service.settled();const detail=service.detail(accepted.id);
 expect(detail.run.status).toBe('succeeded');expect(detail.steps[0].result).toMatchObject({source:'existing_geometry_cache',freshness:'unverified',status:'record',source_measurement:false,cached_box:{x_mm:12,y_mm:8,z_mm:4}});
 expect(detail.steps[0].result!.sources).toHaveLength(2);expect(native).not.toHaveBeenCalled();
 expect(digest(fs.readFileSync(file))).toBe(before);expect(digest(fs.readFileSync(path.join(root,REL)))).toBe(cad);expect(fs.existsSync(file+'.lock')).toBe(false);expect(fs.existsSync(path.join(root,'unselected'))).toBe(false);
});
it('reports an absent cache as missing without initializing it or launching a native measurement',async()=>{
 const {root,service}=fixture(),file=path.join(root,'.phoenix/phoenix-workspace.sqlite'),p=await preview(service,[REL],['cad.geometry-cache']);
 const accepted=await service.accept(p.id,p.digest,'missing-cache');await service.settled();
 expect(service.detail(accepted.id).steps[0].result).toMatchObject({status:'missing',reason:'database_missing',freshness:'unverified'});
 expect(fs.existsSync(file)).toBe(false);expect(fs.existsSync(file+'.lock')).toBe(false);
});
it('does not read or fabricate cache resources for inapplicable or unreadable selections',async()=>{
 const {root,service}=fixture();fs.writeFileSync(path.join(root,'notes.txt'),'independent text');
 const p=await preview(service,['notes.txt','missing.FCStd'],['cad.geometry-cache','file.metadata']);
 expect(p.prepared.resources.some(resource=>resource.kind==='cache')).toBe(false);expect(p.prepared.sources.every(source=>source.kind==='file')).toBe(true);
 expect(p.prepared.steps.map(step=>step.status)).toEqual(['not_applicable','blocked','ready','blocked']);
 const accepted=await service.accept(p.id,p.digest,'safe-exclusions');await service.settled();expect(service.detail(accepted.id).run).toMatchObject({status:'partial',completed:1,failed:2});
});
it('retains an unreadable member in the complete batch target and blocks that analysis, while independent files continue',async()=>{
 const {service}=fixture(),p=await preview(service,[REL,'missing.FCStd'],['file.metadata','cad.name-audit']);
 expect(p.items[1]).toMatchObject({sha256:null,bytes:null});expect(p.prepared.completeness).toBe('incomplete');
 const whole=p.prepared.steps.find(step=>step.target.scope==='batch')!;expect(whole.status).toBe('blocked');expect(whole.target).toEqual({scope:'batch',item_ids:p.items.map(item=>item.id)});
 const accepted=await service.accept(p.id,p.digest,'one-missing-member');await service.settled();const detail=service.detail(accepted.id);
 expect(detail.run).toMatchObject({status:'partial',completed:1,failed:2,total:3});expect(detail.steps.find(isBatchStep)).toMatchObject({status:'blocked'});
});
it('refuses cache drift after preview instead of silently refreshing the frozen result',async()=>{
 const {root,service}=fixture(),file=cache(root),p=await preview(service,[REL],['cad.geometry-cache']);
 const db=new DatabaseSync(file);db.prepare('UPDATE desk_cad_geometry SET box_json=?').run(JSON.stringify({x_mm:99,y_mm:8,z_mm:4}));db.close();
 await expect(service.accept(p.id,p.digest,'drifted-cache')).rejects.toThrow(/缓存投影/);expect(service.listRuns()).toEqual([]);expect(service.repository.getPlan(p.id)?.status).toBe('fresh');
});
it('does not commit mixed cache values if a domain read changes during execution; independent steps still continue',async()=>{
 const base=defaultBatchAdapters().find(adapter=>adapter.descriptor.key==='cad.geometry-cache')!;
 const changed:BatchActionAdapter={...base,execute:async(root,subject,signal,context)=>{const result=await base.execute(root,subject,signal,context);const db=new DatabaseSync(path.join(root,'.phoenix/phoenix-workspace.sqlite'));db.exec('UPDATE desk_cad_geometry SET algorithm_version=0');db.close();return result;}};
 const {root,service}=fixture([changed,defaultBatchAdapters()[0]]);cache(root);const p=await preview(service,[REL],['cad.geometry-cache','file.metadata']);
 const accepted=await service.accept(p.id,p.digest,'changed-during-cache-step');await service.settled();const detail=service.detail(accepted.id);
 expect(detail.run).toMatchObject({status:'partial',completed:1,failed:1});expect(detail.steps[0]).toMatchObject({status:'failed'});expect(detail.steps[0].result).toBeUndefined();expect(detail.steps[0].message).toMatch(/缓存投影/);
});
it('coalesces concurrent confirmations for the same request and rejects a changed intent without a second verification',async()=>{
 const {service}=fixture(),p=await preview(service,[REL],['file.metadata']);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 const actual=(service as any).verifySources.bind(service),verify=vi.spyOn(service as any,'verifySources').mockImplementationOnce(async(...args:unknown[])=>{await gate;return actual(...args);});
 const first=service.accept(p.id,p.digest,'coalesced-request'),second=service.accept(p.id,p.digest,'coalesced-request');expect(first).toBe(second);
 await expect(service.accept('different-plan',p.digest,'coalesced-request')).rejects.toThrow(/不同计划/);expect(verify).toHaveBeenCalledTimes(1);
 expect(service.repository.findRunByRequest('coalesced-request')).toBeUndefined();release();const [a,b]=await Promise.all([first,second]);expect(a.id).toBe(b.id);await service.settled();expect(service.listRuns()).toHaveLength(1);
});
it('cancels and awaits an in-flight admission before closing its ledger, without any late queued run',async()=>{
 const {service}=fixture(),p=await preview(service,[REL],['file.metadata']);let begun!:()=>void;const started=new Promise<void>(resolve=>begun=resolve);
 vi.spyOn(service as any,'verifySources').mockImplementationOnce(async(...args:unknown[])=>{const signal=args[1] as AbortSignal;begun();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('synthetic admission cancelled')),{once:true}));});
 const pending=expect(service.accept(p.id,p.digest,'closing-admission')).rejects.toThrow(/cancelled/);await started;await service.close();await pending;
});
it('does not upgrade a saved V1 preview to a new execution authorization',async()=>{
 const {service}=fixture(),current=await preview(service,[REL],['file.metadata']);
 const legacy:LegacyBatchPlan={id:randomUUID(),task_id:current.task_id,task_revision:current.task_revision,created_at:current.created_at,expires_at:current.expires_at,status:'fresh',digest:HASH,
  items:current.items.map(item=>({id:item.id,subject:item.subject,sha256:item.sha256!,bytes:item.bytes!})),actions:current.actions,
  steps:current.steps.map(step=>{if(isBatchPlannedStep(step))throw new Error('unexpected whole batch');return {id:step.id,item_id:step.item_id,action_instance_id:step.action_instance_id,applicable:step.applicable};}),summary:current.summary,effects:['read_file','write_task_db']};
 service.repository.savePlan(legacy);await expect(service.accept(legacy.id,legacy.digest,'old-preview')).rejects.toThrow(/旧版/);expect(service.listRuns()).toEqual([]);
});
