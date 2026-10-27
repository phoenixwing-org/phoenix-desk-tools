import {installPrivateNativeGateForTest} from "../../../test-support/native-gate.js";
installPrivateNativeGateForTest();
import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {inspectDrawingNative,type NativeDrawingInspection} from './native-inspection.js';
import {planMaintenance,runMaintenanceNative} from './maintenance.js';
import {acquireDrawingExecution} from './executionGate.js';
vi.mock('./maintenance.js',async original=>({...await original<typeof import('./maintenance.js')>(),runMaintenanceNative:vi.fn()}));
const dirs:string[]=[];
afterEach(()=>{vi.mocked(runMaintenanceNative).mockReset();for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-native-inspection-contract-'));dirs.push(root);
 const source=path.join(root,'Sample.Drawing.FCStd');fs.writeFileSync(source,zipSync({'Document.xml':strToU8('<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/></Objects><ObjectData><Object name="Page"><Properties/></Object></ObjectData></Document>')}));
 return {root,source,plan:planMaintenance({workspace:root,rel:path.basename(source),export_pdf:false})};
}
type InspectionFixture=Omit<NativeDrawingInspection,'source_fingerprints_unchanged'>&{source_fingerprints_unchanged:boolean};
function receipt(pid=123456):InspectionFixture{return {status:'completed',native_pid:pid,source_fingerprints_unchanged:true,diagnostics:{folder:'independent-fixture',log:'independent-log'},dimensions:[{dimension:'Width',type:'DistanceX',status:'valid',actual_value:20,references:[{view:'Front',sub:'Vertex0',status:'valid',geometry:{kind:'Vertex',coordinate_space:'view_projection',point:[0,0,0]}}]}],facts:{pages:[],templates:[],views:[],dimensions:[]},source_safety:{status:'verified',preferences:{SolveOnRecompute:false,SolveInJointCreation:false},solver_observations:[],source_document_count:0,source_link_count:0,source_joint_count:0,source_poses_and_actual_frames_unchanged:true,existing_unresolved_joint_sides:0,observer_coverage:['actual native callback coverage']}};}
it('returns real geometry evidence with source fingerprint guards and creates no workspace outputs/stages/backups',async()=>{
 const f=fixture(),before=fs.readFileSync(f.source),files=fs.readdirSync(f.root);
 vi.mocked(runMaintenanceNative).mockImplementation(async(macro,folder,root,config)=>{dirs.push(folder);expect(path.basename(macro)).toBe('inspect.FCMacro');const spec=JSON.parse(fs.readFileSync(config,'utf8'));expect(spec.source_fingerprints[fs.realpathSync(f.source)]).toBe(f.plan.fingerprints[path.basename(f.source)]);expect(spec.stage).toBeUndefined();fs.writeFileSync(spec.report,JSON.stringify(receipt()));return 123456;});
 const result=await inspectDrawingNative(f.plan);expect(result.dimensions[0].status).toBe('valid');expect(result.dimensions[0].references[0].geometry?.point).toEqual([0,0,0]);expect(result.source_safety.status).toBe('verified');expect(fs.readFileSync(f.source)).toEqual(before);expect(fs.readdirSync(f.root)).toEqual(files);const release=acquireDrawingExecution('after-readonly');release();
});
it.each(['missing-geometry','nonfinite','unsafe-preferences','false-hash-proof','verified-unresolved-frames'])('rejects incomplete or unsafe native evidence (%s)',async mode=>{
 const f=fixture();vi.mocked(runMaintenanceNative).mockImplementation(async(_macro,folder,_root,config)=>{dirs.push(folder);const spec=JSON.parse(fs.readFileSync(config,'utf8')),result=receipt();if(mode==='missing-geometry')delete (result.dimensions[0].references[0] as {geometry?:unknown}).geometry;if(mode==='nonfinite')result.dimensions[0].actual_value=NaN;if(mode==='unsafe-preferences')result.source_safety.preferences.SolveOnRecompute=true;if(mode==='false-hash-proof')result.source_fingerprints_unchanged=false;if(mode==='verified-unresolved-frames')result.source_safety.existing_unresolved_joint_sides=1;fs.writeFileSync(spec.report,JSON.stringify(result));return 123456;});await expect(inspectDrawingNative(f.plan)).rejects.toThrow(/证据缺失/);
});
it('keeps real dimensions/facts when source actual Joint frames require manual review',async()=>{
 const f=fixture();vi.mocked(runMaintenanceNative).mockImplementation(async(_macro,folder,_root,config)=>{dirs.push(folder);const spec=JSON.parse(fs.readFileSync(config,'utf8')),result=receipt();Object.assign(result.source_safety,{status:'manual',existing_unresolved_joint_sides:1,source_poses_and_actual_frames_unchanged:false,reason:'已有引用不能确认实际Joint Frames'});fs.writeFileSync(spec.report,JSON.stringify(result));return 123456;});const result=await inspectDrawingNative(f.plan);expect(result.dimensions[0].status).toBe('valid');expect(result.source_safety.status).toBe('manual');expect(result.source_safety.existing_unresolved_joint_sides).toBe(1);expect(result.source_safety.source_poses_and_actual_frames_unchanged).toBe(false);
});
it('does not spawn a pre-cancelled inspection',async()=>{const f=fixture(),abort=new AbortController();abort.abort();await expect(inspectDrawingNative(f.plan,{signal:abort.signal})).rejects.toThrow(/取消/);expect(runMaintenanceNative).not.toHaveBeenCalled();});
it('holds the shared execution lease until the owned native lifecycle has closed on cancellation',async()=>{
 const f=fixture(),abort=new AbortController();let closed!:()=>void;vi.mocked(runMaintenanceNative).mockImplementation(async(_m,folder)=>{dirs.push(folder);await new Promise<void>(resolve=>closed=resolve);throw new Error('owned child closed after cancellation');});const running=inspectDrawingNative(f.plan,{signal:abort.signal});const caught=running.catch(error=>error);abort.abort();expect(()=>acquireDrawingExecution('other-task')).toThrow(/运行中/);closed();expect((await caught).message).toContain('child closed');const release=acquireDrawingExecution('after-close');release();
});

it.each(['missing','null','quantity'] as const)('retains optional native line-width facts without guessing missing evidence (%s)',async mode=>{
 const f=fixture(),result=receipt();
 const lineWidth=mode==='missing'?{}:{line_width:mode==='null'?null:{value:.35,property_type:'Independent::UnknownWidth',unit:'independent-unit'}};
 result.facts.views=[{name:'Front',type:'TechDraw::DrawViewPart',scale:null,scale_type:null,effective_scale:null,effective_scale_method:null,...lineWidth}];
 result.facts.dimensions=[{name:'Width',font_heights:{},font:null,standard_and_style:null,...lineWidth}];
 vi.mocked(runMaintenanceNative).mockImplementation(async(_macro,folder,_root,config)=>{dirs.push(folder);const spec=JSON.parse(fs.readFileSync(config,'utf8'));fs.writeFileSync(spec.report,JSON.stringify(result));return result.native_pid;});
 const inspected=await inspectDrawingNative(f.plan);
 expect(inspected.facts.views[0].line_width).toEqual(mode==='missing'?undefined:lineWidth.line_width);
 expect(inspected.facts.dimensions[0].line_width).toEqual(mode==='missing'?undefined:lineWidth.line_width);
});
it.each(['view','dimension'] as const)('rejects malformed line-width quantity transport for a native %s',async role=>{
 const f=fixture(),result=receipt();
 result.facts.views=[{name:'Front',type:'TechDraw::DrawViewPart',scale:null,scale_type:null,effective_scale:null,effective_scale_method:null}];
 result.facts.dimensions=[{name:'Width',font_heights:{},font:null,standard_and_style:null}];
 const raw=JSON.parse(JSON.stringify(result)) as {facts:{views:Array<Record<string,unknown>>;dimensions:Array<Record<string,unknown>>}};
 (role==='view'?raw.facts.views:raw.facts.dimensions)[0].line_width={value:'0.35',property_type:'App::PropertyLength',unit:'mm'};
 vi.mocked(runMaintenanceNative).mockImplementation(async(_macro,folder,_root,config)=>{dirs.push(folder);const spec=JSON.parse(fs.readFileSync(config,'utf8'));fs.writeFileSync(spec.report,JSON.stringify(raw));return result.native_pid;});
 await expect(inspectDrawingNative(f.plan)).rejects.toThrow(/证据缺失/);
});
