import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeFcstdPath} from '../../lib/fcstdBatchFiles.js';
import {acquireDrawingExecution} from './executionGate.js';
import {runMaintenanceNative,verifyMaintenancePlan,type MaintenancePlan} from './maintenance.js';
import {maintenanceInspectionRunner} from './maintenance-runner.js';

export type NativeReferenceStatus='valid'|'invalid'|'manual';
export type NativeVector=[number,number,number];
export interface NativeProjectedGeometry {
 kind:'Vertex'|'Edge';coordinate_space:'view_projection';point?:NativeVector;
 curve?:string;length?:number;bbox?:[number,number,number,number,number,number];
 endpoints?:[NativeVector,NativeVector];samples?:NativeVector[];
 center?:NativeVector;radius?:number;axis?:NativeVector;direction?:NativeVector;full_circle?:boolean;
}
export interface NativeDimensionReference {view:string;sub:string;status:NativeReferenceStatus;geometry?:NativeProjectedGeometry;reason?:string}
export interface NativeDimensionInspection {dimension:string;type:string;status:NativeReferenceStatus;actual_value:number|null;references:NativeDimensionReference[];reason?:string}
export interface NativeAssemblySafety {
 status:'verified'|'manual';reason?:string;
 preferences:{SolveOnRecompute:boolean|null;SolveInJointCreation:boolean|null};
 solver_observations:Array<{kind:'preSolve'|'solveIfAllowed'|'solve';object:string}>;
 source_document_count:number;source_link_count:number;source_joint_count:number;
 source_poses_and_actual_frames_unchanged:boolean;existing_unresolved_joint_sides:number;observer_coverage:string[];
 source_object_errors?:Array<{file:string;object:string;kind:'link'|'joint';states:string[];status:string}>;
}
export interface NativeQuantityFact {value:number;property_type:string;unit:string|null}
export interface NativeDrawingFacts {
 pages:Array<{name:string;scale:NativeQuantityFact|null;template:string|null}>;
 templates:Array<{name:string;width:NativeQuantityFact|null;height:NativeQuantityFact|null;editable_texts:Record<string,string>}>;
 views:Array<{name:string;type:string;scale:NativeQuantityFact|null;scale_type:string|null;effective_scale:number|null;effective_scale_method:string|null;effective_scale_reason?:string;line_width?:NativeQuantityFact|null}>;
 dimensions:Array<{name:string;font_heights:Record<string,NativeQuantityFact>;font:string|null;standard_and_style:string|null;line_width?:NativeQuantityFact|null}>;
}
export interface NativeDrawingInspection {
 status:'completed';dimensions:NativeDimensionInspection[];facts:NativeDrawingFacts;source_safety:NativeAssemblySafety;
 source_fingerprints_unchanged:true;native_pid:number;diagnostics:{folder:string;log:string};inspection_error?:string;
}
export interface NativeInspectionOptions {signal?:AbortSignal}

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const text=(v:unknown,max=4096):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const vector=(v:unknown,n=3)=>Array.isArray(v)&&v.length===n&&v.every(finite);
const status=(v:unknown):v is NativeReferenceStatus=>v==='valid'||v==='invalid'||v==='manual';
function geometry(v:unknown):v is NativeProjectedGeometry {
 if(!object(v)||v.coordinate_space!=='view_projection')return false;
 if(v.kind==='Vertex')return vector(v.point);
 return v.kind==='Edge'&&text(v.curve,256)&&finite(v.length)&&v.length>=0&&vector(v.bbox,6)
  &&Array.isArray(v.endpoints)&&v.endpoints.length===2&&v.endpoints.every(x=>vector(x))
  &&Array.isArray(v.samples)&&v.samples.length>=2&&v.samples.length<=32&&v.samples.every(x=>vector(x))
  &&['center','axis','direction'].every(k=>v[k]===undefined||vector(v[k]))&&(v.radius===undefined||finite(v.radius)&&v.radius>=0)
  &&(v.full_circle===undefined||typeof v.full_circle==='boolean');
}
function dimensions(v:unknown):v is NativeDimensionInspection[] {
 return Array.isArray(v)&&v.length<=10000&&v.every(d=>object(d)&&text(d.dimension,256)&&text(d.type,256)&&status(d.status)
  &&(d.actual_value===null||finite(d.actual_value))&&(d.reason===undefined||text(d.reason))&&Array.isArray(d.references)&&d.references.length<=100
  &&d.references.every(r=>object(r)&&text(r.view,256)&&text(r.sub,4096)&&status(r.status)&&(r.reason===undefined||text(r.reason))
   &&(r.geometry===undefined?r.status!=='valid':geometry(r.geometry)))&&(d.status!=='valid'||finite(d.actual_value)&&d.references.length>0&&d.references.every(r=>r.status==='valid')));
}
function safety(v:unknown):v is NativeAssemblySafety {
 if(!object(v)||!['verified','manual'].includes(String(v.status))||!object(v.preferences)||!Array.isArray(v.solver_observations)||v.solver_observations.length>1000)return false;
 if(!v.solver_observations.every(o=>object(o)&&['preSolve','solveIfAllowed','solve'].includes(String(o.kind))&&text(o.object,256)))return false;
 if(!['source_document_count','source_link_count','source_joint_count','existing_unresolved_joint_sides'].every(k=>Number.isSafeInteger(v[k])&&Number(v[k])>=0&&Number(v[k])<=1_000_000))return false;
 if(typeof v.source_poses_and_actual_frames_unchanged!=='boolean'||!Array.isArray(v.observer_coverage)||!v.observer_coverage.every(x=>text(x,512))||(v.reason!==undefined&&!text(v.reason)))return false;
 if(v.source_object_errors!==undefined&&(!Array.isArray(v.source_object_errors)||v.source_object_errors.length>10000||!v.source_object_errors.every(x=>object(x)&&text(x.file,256)&&text(x.object,256)&&['link','joint'].includes(String(x.kind))&&Array.isArray(x.states)&&x.states.length>0&&x.states.every(s=>s==='Error'||s==='Invalid')&&text(x.status))))return false;
 if(v.status==='verified')return v.preferences.SolveOnRecompute===false&&v.preferences.SolveInJointCreation===false&&v.solver_observations.length===0&&v.source_poses_and_actual_frames_unchanged===true&&v.existing_unresolved_joint_sides===0;
 const preferences=v.preferences;
 return ['SolveOnRecompute','SolveInJointCreation'].every(k=>preferences[k]===null||typeof preferences[k]==='boolean');
}
function facts(v:unknown):v is NativeDrawingFacts {
 if(!object(v)||!['pages','templates','views','dimensions'].every(k=>Array.isArray(v[k])&&(v[k] as unknown[]).length<=10000))return false;
 const q=(value:unknown)=>value===null||object(value)&&finite(value.value)&&text(value.property_type,128)&&(value.unit===null||text(value.unit,128));
 return (v.pages as unknown[]).every(x=>object(x)&&text(x.name,256)&&q(x.scale)&&(x.template===null||text(x.template,256)))
  &&(v.templates as unknown[]).every(x=>object(x)&&text(x.name,256)&&q(x.width)&&q(x.height)&&object(x.editable_texts)&&Object.values(x.editable_texts).every(y=>text(y,4096)))
  &&(v.views as unknown[]).every(x=>object(x)&&text(x.name,256)&&text(x.type,256)&&q(x.scale)&&(x.scale_type===null||text(x.scale_type,256))&&(x.effective_scale===null||finite(x.effective_scale))&&(x.effective_scale_method===null||text(x.effective_scale_method,256))&&(x.effective_scale_reason===undefined||text(x.effective_scale_reason))&&(x.line_width===undefined||q(x.line_width)))
  &&(v.dimensions as unknown[]).every(x=>object(x)&&text(x.name,256)&&object(x.font_heights)&&Object.values(x.font_heights).every(q)&&(x.font===null||text(x.font,256))&&(x.standard_and_style===null||text(x.standard_and_style,256))&&(x.line_width===undefined||q(x.line_width)));
}

/** A read-only native scan uses the same owned PID+nonce/private-config/close
 * lifecycle as maintenance. It acquires the shared CAD lease and retains local
 * diagnostics on success/failure; it never creates a Drawing/PDF/stage/backup. */
export async function inspectDrawingNative(plan:MaintenancePlan,options:NativeInspectionOptions={}):Promise<NativeDrawingInspection> {
 if(options.signal?.aborted)throw new Error('原生校核已取消；未启动原生程序');
 const release=acquireDrawingExecution('native-inspection:'+randomUUID());
 let folder='';
 try {
  verifyMaintenancePlan(plan);
  const root=plan.input.workspace,source=safeFcstdPath(root,plan.input.rel);
  folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-drawing-inspect-'));
  const report=path.join(folder,'result.json'),config=path.join(folder,'job.json'),macro=path.join(folder,'inspect.FCMacro');
  fs.writeFileSync(config,JSON.stringify({source,report,source_fingerprints:Object.fromEntries(Object.entries(plan.fingerprints).map(([rel,digest])=>[safeFcstdPath(root,rel),digest]))}),{mode:0o600});
  fs.writeFileSync(macro,'JOB_PATH = '+JSON.stringify(config)+'\n'+maintenanceInspectionRunner,{mode:0o600});
  const nativePid=await runMaintenanceNative(macro,folder,root,config,options.signal,release);
  if(options.signal?.aborted)throw new Error('原生校核已取消；源文件保留');
  verifyMaintenancePlan(plan);
  if(fs.statSync(report).size>32*1024*1024)throw new Error('原生校核回执过大，需缩小范围；诊断目录：'+folder);
  const result:unknown=JSON.parse(fs.readFileSync(report,'utf8'));
  if(!object(result)||result.status!=='completed'||result.native_pid!==nativePid||result.source_fingerprints_unchanged!==true||!dimensions(result.dimensions)||!safety(result.source_safety)||!facts(result.facts)||(result.inspection_error!==undefined&&!text(result.inspection_error)))throw new Error('原生校核证据缺失或格式/归属不匹配；诊断目录：'+folder);
  return {status:'completed',dimensions:result.dimensions,facts:result.facts,source_safety:result.source_safety,source_fingerprints_unchanged:true,native_pid:nativePid,diagnostics:{folder,log:path.join(folder,'native-maintain.log')},...(result.inspection_error?{inspection_error:String(result.inspection_error)}:{})};
 } finally {release();}
}
