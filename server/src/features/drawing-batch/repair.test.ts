import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {setImmediate} from 'node:timers/promises';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';import {afterEach,expect,it,vi} from 'vitest';
import {previewDrawingAudit} from './audit.js';import {startDrawingRepairs} from './repair.js';import * as maintenance from '../drawing-research/maintenance.js';
import * as batchJobs from './batchJobs.js';
import {DRAWING_REPAIR_MAX_ISSUES_PER_FILE} from './types.js';
const roots:string[]=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drawing-repair-independent-'));roots.push(root);fs.mkdirSync(path.join(root,'drawings'));
 const save=(rel:string,xml:string)=>fs.writeFileSync(path.join(root,rel),zipSync({'Document.xml':strToU8(xml)}));
 save('Model.FCStd','<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="Label" type="App::PropertyString"><String value="Independent model"/></Property><Property name="PartMaterial" type="App::PropertyString"><String value="STEEL-A"/></Property></Properties></Object></ObjectData></Document>');
 save('drawings/Example.Drawing.FCStd','<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/><Object name="Template" type="TechDraw::DrawSVGTemplate"/><Object name="Link" type="App::Link"/></Objects><ObjectData><Object name="Template"><Properties><Property name="EditableTexts" type="App::PropertyMap"><Map><Item key="part_material" value=""/></Map></Property></Properties></Object><Object name="Link"><Properties><Property name="Label" type="App::PropertyString"><String value="Human link"/></Property><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="../Model.FCStd" name="Body"/></Property></Properties></Object></ObjectData></Document>');return root;
}
async function wait(job:{status:string}){for(let i=0;i<100&&['queued','running'].includes(job.status);i++)await setImmediate();expect(['queued','running']).not.toContain(job.status);}
it('passes exactly the selected ready patch, never human-conflict labels, to the native maintenance port',async()=>{
 const root=fixture(),preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(i=>i.kind==='material')!;
 const source=fs.readFileSync(path.join(root,'Model.FCStd'));const apply=vi.spyOn(maintenance,'applyMaintenance').mockResolvedValue({outputs:[{path:row.rel}],backup:'local-independent-backup'} as never);
 const job=startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true});await wait(job);
 expect(job).toMatchObject({status:'completed',completed:1,failed:0});expect(apply).toHaveBeenCalledTimes(1);expect(apply.mock.calls[0][0].patches).toEqual([{kind:'text',object:'Template',field:'part_material',current:'',proposed:'STEEL-A'}]);expect(apply.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);expect(fs.readFileSync(path.join(root,'Model.FCStd'))).toEqual(source);
 expect(()=>startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true})).toThrow();
});
it('rejects source drift before native startup',async()=>{
 const root=fixture(),preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(i=>i.kind==='material')!;
 fs.writeFileSync(path.join(root,'Model.FCStd'),'external independent source edit');const apply=vi.spyOn(maintenance,'applyMaintenance');
 const job=startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true});await wait(job);expect(job.failed).toBe(1);expect(apply).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(root,'Model.FCStd'),'utf8')).toBe('external independent source edit');
});
it('refuses manual/conflict selections and absent human confirmation without native work',async()=>{
 const root=fixture(),preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(i=>i.kind==='label')!;const apply=vi.spyOn(maintenance,'applyMaintenance');
 expect(issue.status).toBe('conflict');expect(()=>startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:false as true})).toThrow(/确认/);
 expect(()=>startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true})).toThrow(/ready/);expect(apply).not.toHaveBeenCalled();
 // Invalid confirmation/selection must not consume the valid plan.
 const ready=row.issues.find(i=>i.kind==='material')!;apply.mockResolvedValue({outputs:[],backup:'local-independent-backup'}as never);const job=startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[ready.id]}],confirmed:true});await wait(job);expect(job.completed).toBe(1);
});
it.each(['create','edit'])('binds workspace defaults absence/bytes to preview (%s)',async(mode)=>{
 const root=fixture();fs.mkdirSync(path.join(root,'.phoenix'));const config=path.join(root,'.phoenix/drawing-defaults.json');if(mode==='edit')fs.writeFileSync(config,'{}');
 const preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(i=>i.kind==='material')!;fs.writeFileSync(config,JSON.stringify({material:'NEW-A'}));const apply=vi.spyOn(maintenance,'applyMaintenance');
 const job=startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true});await wait(job);expect(job.failed).toBe(1);expect(apply).not.toHaveBeenCalled();expect(job.results[0].message).toMatch(/配置已变化/);
});
it('does not consume a preview on busy queue registration and still enforces its original CAS on retry',async()=>{
 const root=fixture(),preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(i=>i.kind==='material')!;const input={plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true as const};
 vi.spyOn(batchJobs,'startBatchJob').mockImplementationOnce(()=>{throw new Error('Independent queue busy');});const apply=vi.spyOn(maintenance,'applyMaintenance');expect(()=>startDrawingRepairs(root,input)).toThrow(/busy/);expect(apply).not.toHaveBeenCalled();fs.writeFileSync(path.join(root,'Model.FCStd'),'Independent source changed after busy registration');
 const job=startDrawingRepairs(root,input);await wait(job);expect(job.failed).toBe(1);expect(apply).not.toHaveBeenCalled();
});
it('retains partial-publication outputs and backup in a failed batch result, not a false zero-write failure',async()=>{
 const root=fixture(),preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(i=>i.kind==='material')!;
 vi.spyOn(maintenance,'applyMaintenance').mockRejectedValue(new maintenance.MaintenancePublicationError('Independent publication incomplete',[row.rel],'.phoenix/cache/drawing-maintenance/independent-backup'));
 const job=startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[issue.id]}],confirmed:true});await wait(job);expect(job.failed).toBe(1);expect(job.results[0]).toMatchObject({status:'failed',outputs:[row.rel],backup:'.phoenix/cache/drawing-maintenance/independent-backup',warnings:[expect.stringContaining('不要盲目重试')],manual_review_required:true});
});
it('matches the native exact-patch boundary at 100 without starting Native',()=>{
 const root=fixture(),input={workspace:root,rel:'drawings/Example.Drawing.FCStd'};
 const patches=Array.from({length:101},(_,index)=>({kind:'label' as const,object:`Example${index}`,current:'',proposed:'Independent label'}));
 expect(DRAWING_REPAIR_MAX_ISSUES_PER_FILE).toBe(100);
 expect(maintenance.planMaintenance(input,{patches:patches.slice(0,100)}).patches).toHaveLength(100);
 expect(()=>maintenance.planMaintenance(input,{patches})).toThrow(/1–100/);
});
it('rejects 101 selected issues before queueing and preserves the ticket for a corrected 100-issue selection',async()=>{
 const root=fixture(),filename=path.join(root,'drawings/Example.Drawing.FCStd'),files=unzipSync(fs.readFileSync(filename));
 const objects=Array.from({length:101},(_,index)=>({name:`Note${index}`}));
 let xml=strFromU8(files['Document.xml']);
 xml=xml.replace('</Objects>',objects.map(({name})=>`<Object name="${name}" type="TechDraw::DrawViewAnnotation"/>`).join('')+'</Objects>');
 xml=xml.replace('</ObjectData>',objects.map(({name})=>`<Object name="${name}"><Properties><Property name="Font" type="App::PropertyString"><String value="Old Font"/></Property></Properties></Object>`).join('')+'</ObjectData>');
 files['Document.xml']=strToU8(xml);fs.writeFileSync(filename,zipSync(files));
 const preview=await previewDrawingAudit(root,{directory:'drawings',annotation_font:'Independent Font'}),row=preview.rows[0];
 const ids=row.issues.filter(issue=>issue.kind==='font'&&issue.status==='ready').map(issue=>issue.id);expect(ids).toHaveLength(101);
 const queue=vi.spyOn(batchJobs,'startBatchJob'),apply=vi.spyOn(maintenance,'applyMaintenance').mockResolvedValue({outputs:[],backup:'independent-backup'}as never);
 expect(()=>startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:ids}],confirmed:true})).toThrow(/最多选择 100/);
 expect(queue).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
 const job=startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:ids.slice(0,100)}],confirmed:true});await wait(job);
 expect(queue).toHaveBeenCalledOnce();expect(job.completed).toBe(1);expect(apply.mock.calls[0][0].patches).toHaveLength(100);
});
it('refuses an unproven material suggestion without consuming the preview',async()=>{
 const root=fixture(),filename=path.join(root,'Model.FCStd'),files=unzipSync(fs.readFileSync(filename));
 files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('value="STEEL-A"','value=""'));fs.writeFileSync(filename,zipSync(files));
 const preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],material=row.issues.find(issue=>issue.kind==='material')!;
 expect(material).toMatchObject({status:'manual',proposed:''});
 const queue=vi.spyOn(batchJobs,'startBatchJob'),apply=vi.spyOn(maintenance,'applyMaintenance');
 expect(()=>startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[material.id]}],confirmed:true})).toThrow(/ready/);
 expect(queue).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
 // The rejected request did not consume the server-side preview ticket.
 expect(()=>startDrawingRepairs(root,{plan_id:preview.plan_id,selections:[{id:row.id,issue_ids:[material.id]}],confirmed:true})).toThrow(/ready/);
});
