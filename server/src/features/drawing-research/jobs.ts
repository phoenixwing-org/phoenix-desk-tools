import { planDrawingOutputs, drawingOutputPaths, assertDrawingOutputPlanAbsent } from './output-name.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { zipSync, strToU8 } from 'fflate';
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive, fcstdFingerprint } from '../../lib/fcstdBatchFiles.js';
import { runtimeUserDataDir } from '../../lib/appRuntimePaths.js';
import { buildFreecadChildEnvironment } from '../../lib/freecadProcessSecurity.js';
import { sourceNodes, templateCatalog } from './service.js';
import { drawingRunner, drawingVerificationRunner } from './runner.js';
import { fcstdNativeXlinkFiles } from '../../lib/fcstdNativeXlinkFiles.js';
import { makeFcstdIncludedNamesPortable } from '../../lib/fcstdArchiveNames.js';
import { acquireDrawingExecution, type DrawingExecutionLease } from './executionGate.js';
import { readDrawingThumbnail } from './drawing-thumbnail.js';
import { resolveFreecadGuiRuntime } from '../../lib/freecadGuiRuntime.js';
import type { ExplicitCompanionAlias, SidecarProvenance } from '../../../../shared/cad-companion/contracts.js';
import { verifySidecarProvenance } from '../cad-companions/output.js';
import { finalizeDraftNotes } from './final-notes.js';
export type DrawingDefaults = {template_root: string; template: string; creator: string; approval_person: string; company: string; material: string; tolerances: string; contour_line_width_mm: number; dimension_line_width_mm: number};
const empty: DrawingDefaults = {template_root:'',template:'',creator:'',approval_person:'',company:'',material:'',tolerances:'',contour_line_width_mm:0.5,dimension_line_width_mm:0.25};
const textDefaultKeys=['template_root','template','creator','approval_person','company','material','tolerances'] as const;
const lineWidthKeys=['contour_line_width_mm','dimension_line_width_mm'] as const;
function read(file:string): Record<string,unknown> {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
function clean(value:unknown):Partial<DrawingDefaults> {
 const result:Partial<DrawingDefaults>={};
 for(const key of textDefaultKeys){const v=(value as Record<string,unknown>)?.[key];if(typeof v==='string')result[key]=v.slice(0,4096);}
 for(const key of lineWidthKeys){const v=(value as Record<string,unknown>)?.[key];if(v===undefined)continue;if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>5)throw new Error('新稿线宽须为大于0且不超过5mm的有限数字');result[key]=v;}
 return result;
}
function validDefaults(value:DrawingDefaults):DrawingDefaults {if(value.contour_line_width_mm<=value.dimension_line_width_mm)throw new Error('新稿轮廓线宽必须大于尺寸线宽');return value;}
function preferencesPath(root:string) {const folder=path.join(root,'.phoenix');if(fs.existsSync(folder))safeFcstdPath(root,'.phoenix');const file=path.join(folder,'drawing-defaults.json');if(fs.existsSync(file))safeFcstdPath(root,path.relative(root,file));return file;}
function resolvedDefaults(root:string,overrides?:unknown):DrawingDefaults {return validDefaults({...empty,...clean(read(path.join(runtimeUserDataDir(),'drawing-defaults.json'))),...clean(read(preferencesPath(root))),...clean(overrides)});}
export function drawingDefaults(workspace:string):DrawingDefaults {return resolvedDefaults(fcstdWorkspace(workspace));}
export function saveDrawingDefaults(workspace:string,scope:string,value:unknown) {
 const root=fcstdWorkspace(workspace);if(!['workspace','machine'].includes(scope))throw new Error('未知设置范围');
 const machine=path.join(runtimeUserDataDir(),'drawing-defaults.json'),local=preferencesPath(root),file=scope==='workspace'?local:machine;
 // Older settings forms omit new keys. Preserve stored values (including other
 // versioned drawing settings), while accepting only this schema's input keys.
 const next={...read(file),...clean(value)},machineValues=clean(scope==='machine'?next:read(machine)),localValues=clean(scope==='workspace'?next:read(local));
 validDefaults({...empty,...machineValues});validDefaults({...empty,...machineValues,...localValues});
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(next,null,2)+'\n');return drawingDefaults(root);
}
export type DrawingJob = {id:string;workspace:string;status:'running'|'completed'|'failed'|'cancelled';error?:string;outputs?:string[];warnings?:string[];dimensions?:string[];planned_outputs?:string[];cancel_requested?:boolean;manual_review_required:true};
type Job = DrawingJob;
const jobs=new Map<string,Job>();
const controls = new Map<string, { controller: AbortController; completion: Promise<Job> }>();
export function guiExecutable() {return resolveFreecadGuiRuntime().executable;}
export function drawingJob(workspace:string,id:string) {const root=fcstdWorkspace(workspace),job=jobs.get(id);if(!job||job.workspace!==root)throw new Error('出图任务不存在');return job;}
export type DrawingSourceGuards = Record<string, string>;
export function captureDrawingSources(root: string, rel: string): DrawingSourceGuards {
 root=fcstdWorkspace(root); const guards:DrawingSourceGuards={},queue=[safeFcstdPath(root,rel)];
 while(queue.length){const filename=queue.shift()!,key=path.relative(root,filename).replace(/\\/g,'/');if(key in guards)continue;if(Object.keys(guards).length>=500)throw new Error('模型链依赖超过500个');const archive=readFcstdBatchArchive(filename);guards[key]=fcstdFingerprint(archive.bytes);for(const link of fcstdNativeXlinkFiles(archive.xml)){const target=safeFcstdPath(root,path.relative(root,path.resolve(path.dirname(filename),link)));if(!/\.fcstd$/i.test(target))throw new Error('链依赖不是FCStd');queue.push(target);}}
 return guards;
}
export function verifyDrawingSources(root:string,guards:DrawingSourceGuards){for(const [rel,digest] of Object.entries(guards))if(fcstdFingerprint(readFcstdBatchArchive(safeFcstdPath(root,rel)).bytes)!==digest)throw new Error('源模型或链依赖已变化，请重新预览');}
/** Until the new-draft runner shares assembly solver/frame protection, every
 * entry point must keep assembly-dependent sources manual, not only auto paper. */
export function assertDrawingGenerationSourceSafety(root:string,guards:DrawingSourceGuards){
 for(const rel of Object.keys(guards)){
  const xml=readFcstdBatchArchive(safeFcstdPath(root,rel)).xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
  if(/<Object\b[^>]*\btype=["']Assembly::/.test(xml)||/<Property\b[^>]*\bname=["']Reference[12]["']/.test(xml))throw new Error('源依赖含装配/Joint，正式新稿尚未验证相同求解与Frame保护；需人工处理，未启动生成');
 }
}
export function validateDrawingTemplate(root:string,rel:string,paper?:string){
 const filename=safeFcstdPath(root,rel),stat=fs.statSync(filename);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('图框模板无效或超过2MiB');const raw=fs.readFileSync(filename),svg=raw.toString('utf8');
 const semantic=svg.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,''),tag=semantic.match(/<svg\b[^>]*>/)?.[0]||'',number=(attr:string)=>Number(new RegExp('\\b'+attr+'\\s*=\\s*["\\\']([0-9.]+)(?:mm)?["\\\']').exec(tag)?.[1]);
 const size=[number('width'),number('height')].sort((a,b)=>a-b);const selected=Object.entries({A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],A0:[841,1189]}).find(([,dims])=>dims.every((n,i)=>Math.abs(n-size[i])<3))?.[0];
 const fields=[...semantic.matchAll(/\b(?:[\w-]+:)?editable\s*=\s*["']([^"']+)["']/g)].map(m=>m[1]);
 if(!selected||paper&&paper!=='auto'&&paper!==selected)throw new Error('出图只支持实际A4/A3/A2/A1/A0图框，纸幅须与SVG一致');
 if(!/<(?:path|rect|line|polyline|polygon)\b/i.test(semantic)||!fields.some(x=>/drawing.?number|FC-NO/i.test(x))||!fields.some(x=>/revision/i.test(x))||!fields.some(x=>/material|title|FC-Title/i.test(x))||!fields.some(x=>/scale|FC-SC/i.test(x)))throw new Error('图框须含实际边框及图号、版本、标题/材料、比例可编辑字段');
 return {filename,paper:selected,hash:fcstdFingerprint(raw)};
}
export type StartDrawingInput={workspace:string;rel:string;node:string;template_root:string;template:string;defaults?:unknown;paper?:string;scale?:string;output?:string;fingerprints?:DrawingSourceGuards;template_hash?:string;reference_pdf?:string;reference_hash?:string;companion_name?:string;companion_aliases?:ExplicitCompanionAlias[]};
export type DrawingExecutionPorts={executable?:()=>string;executeNative?:(executable:string,macro:string,folder:string,cwd:string,signal:AbortSignal,execution?:DrawingExecutionLease)=>Promise<void>};
const nativePhases=new Set(['opening_source','source_geometry','creating_page','settling_views_1to1','choosing_layout','settling_scaled_views','building_dimensions','settling_dimensions','exporting_thumbnail','exporting_pdf','closing_drawing','writing_report','closing_owned_documents','completed']);
function nativePhase(value:unknown,verify:boolean){if(typeof value!=='string')return '';const base=verify&&value.startsWith('verify_')?value.slice(7):verify?'':value;return nativePhases.has(base)?value:'';}
/** Keep complete UTF-8 code points, with a strict byte ceiling rather than a character ceiling. */
function nativeTail(value:string,limit=8192){const bytes=Buffer.from(value);let start=Math.max(0,bytes.length-limit);while(start<bytes.length&&(bytes[start]&0xc0)===0x80)start++;return bytes.subarray(start).toString('utf8');}
function nativeSummary(value:unknown){return typeof value==='string'?nativeTail(value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim(),512):'';}
function nativeErrorCode(error:unknown){const code=(error as {system_code?:string})?.system_code??(error as NodeJS.ErrnoException)?.code;return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,31}$/.test(code)?' ('+code+')':'';}
/** The child and all diagnostic paths belong to this one job; never inspect or signal another PID. */
export async function runDrawingNative(executable:string,macro:string,folder:string,cwd:string,signal:AbortSignal,execution?:DrawingExecutionLease){
 const verify=path.basename(macro)==='verify.FCMacro',log=path.join(folder,verify?'native-verify.log':'native-generate.log'),progress=path.join(folder,'progress.json'),reportFile=path.join(folder,verify?'verified.json':'result.json');
 let tail='',logFailure='',progressReady=true;
 const persist=()=>{try{fs.writeFileSync(log,tail,{encoding:'utf8',mode:0o600});}catch(error){logFailure='日志写入失败'+nativeErrorCode(error);}};
 const phase=()=>progressReady?nativePhase(read(progress).phase,verify):'';
 const failure=(why:string,atPhase='')=>{const report=read(reportFile),reported=report.status==='failed'?nativeSummary(report.error):'',at=atPhase||nativePhase(report.phase,verify)||phase()||'尚未进入任务宏';return new Error(why+'；阶段：'+at+(reported?'；任务错误：'+reported:'')+'；诊断日志：'+log+(logFailure?'（'+logFailure+'）':''));};
 persist();try{fs.writeFileSync(progress,JSON.stringify({phase:''}));}catch{progressReady=false;}
 if(signal.aborted)throw failure('任务已取消');const env=buildFreecadChildEnvironment(process.env);delete env.QT_QPA_PLATFORM;
 const lease=execution??acquireDrawingExecution('drawing-native:'+randomUUID());
 try{await new Promise<void>((resolve,reject)=>{let child:ChildProcess;try{child=lease.spawn(executable,['-u',path.join(folder,'user.cfg'),'-s',path.join(folder,'system.cfg'),macro],{cwd,env,stdio:['ignore','pipe','pipe']});}catch(error){reject(failure('FreeCAD子进程启动失败'+nativeErrorCode(error)));return;}
  const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')];
  const append=(text:string)=>{tail=nativeTail(tail+text);persist();};
  child.stdout?.on('data',(chunk:Buffer|string)=>append(decoders[0].write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))));
  child.stderr?.on('data',(chunk:Buffer|string)=>append(decoders[1].write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))));
  let reason='',failedPhase='',killTimer:ReturnType<typeof setTimeout>|undefined;
  const kill=(kind:NodeJS.Signals)=>{try{child.kill(kind);}catch{/* A failed diagnostic/kill attempt must not bypass the child's close event. */}};
  const stop=(why:string)=>{if(reason)return;reason=why;failedPhase=phase()||'尚未进入任务宏';kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);killTimer.unref();};
  const abort=()=>stop('任务已取消'),timer=setTimeout(()=>stop('原生出图超过10分钟，已终止本任务子进程'),600000);timer.unref();signal.addEventListener('abort',abort,{once:true});
  const clear=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',abort);};
  child.once('error',error=>{const why='本任务子进程异常'+nativeErrorCode(error);if(child.pid)stop(why);else if(!reason){reason=why;failedPhase=phase()||'尚未进入任务宏';}});
  child.once('close',code=>{clear();for(const decoder of decoders)append(decoder.end());if(reason)reject(failure(reason,failedPhase));else if(code!==0)reject(failure('FreeCAD子进程退出失败'));else if(read(reportFile).status!=='completed')reject(failure('FreeCAD任务宏未报告完成'));else resolve();});
  child.once('spawn',()=>{try{lease.assertHealthy();const config=path.join(folder,'job.json');fs.writeFileSync(config,JSON.stringify({...read(config),expected_pid:child.pid??-1}));}catch(error){stop('执行身份写入失败'+nativeErrorCode(error));}});
  if(signal.aborted)abort();
 });}finally{if(!execution)lease();}
}
export function startDrawing(input:StartDrawingInput,ports:DrawingExecutionPorts={}):DrawingJob {
 const root=fcstdWorkspace(input.workspace),source=safeFcstdPath(root,input.rel);if(!/\.fcstd$/i.test(source)||/\.drawing\.fcstd$/i.test(source))throw new Error('请选择源模型FCStd');
 const archive=readFcstdBatchArchive(source),selected=sourceNodes(archive.xml).find(n=>n.name===input.node);if(!selected)throw new Error('请选择可用的模型主节点');
 if(/\.assy\.fcstd$/i.test(source)||selected.type==='App::Part'||selected.type.startsWith('Assembly::'))throw new Error('总成研究新稿需人工选择方案；未启动生成');
 const catalog=templateCatalog(input.template_root);if(!catalog.items.some(t=>t.rel===input.template))throw new Error('模板不在所选目录内');const frame=validateDrawingTemplate(catalog.root,input.template,input.paper);
 const scale=input.scale||'auto';if(!['auto','1:1','2:1','5:1','1:2','1:5','1:10','1:20','1:50','1:100','1:200','1:1000'].includes(scale))throw new Error('比例无效');
 const outputPlan=planDrawingOutputs(source,{workspace:root,output:input.output,name_override:input.companion_name,source_node:input.node,explicit_aliases:input.companion_aliases}),output=outputPlan.drawing;
 assertDrawingOutputPlanAbsent(outputPlan);
 const actualGuards=captureDrawingSources(root,input.rel),guards=input.fingerprints||actualGuards;const guardKey=(value:DrawingSourceGuards)=>JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));if(guardKey(guards)!==guardKey(actualGuards)||guards[path.relative(root,source).replace(/\\/g,'/')]!==fcstdFingerprint(archive.bytes))throw new Error('源模型或链依赖已变化，请重新预览');verifyDrawingSources(root,guards);if(input.template_hash&&input.template_hash!==frame.hash)throw new Error('图框模板已变化，请重新预览');
 assertDrawingGenerationSourceSafety(root,guards);
 const reference=input.reference_pdf?safeFcstdPath(root,input.reference_pdf):undefined;const verifyReference=()=>{if(reference&&(!input.reference_hash||fcstdFingerprint(fs.readFileSync(safeFcstdPath(root,input.reference_pdf!)))!==input.reference_hash))throw new Error('参考PDF已变化，请重新预览');};verifyReference();
 const defaults={...resolvedDefaults(root,input.defaults),approval_person:''};
 const id=randomUUID(),release=acquireDrawingExecution('generation:'+id);let executable:string,dir:string;try{executable=(ports.executable??guiExecutable)();dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-drawing-'));}catch(error){release();throw error;}
 const controller=new AbortController(),report=path.join(dir,'result.json'),stage=path.join(path.dirname(output),'.'+id+'.Drawing.FCStd');
 const stageOutputs=drawingOutputPaths(stage),outputPaths=[outputPlan.drawing,outputPlan.pdf,outputPlan.notes];
 const job:Job={id,workspace:root,status:'running',manual_review_required:true,planned_outputs:outputPaths.map(p=>path.relative(root,p).replace(/\\/g,'/'))};jobs.set(id,job);
 for(const [key,value] of jobs)if(jobs.size>100&&value.status!=='running'){jobs.delete(key);controls.delete(key);}
 const completion=(async()=>{const published:string[]=[];try{
  const spec={id,source,source_hash:fcstdFingerprint(archive.bytes),reference_pdf:reference||'',fingerprints:{...Object.fromEntries(Object.entries(guards).map(([rel,digest])=>[safeFcstdPath(root,rel),digest])),...(reference?{[reference]:input.reference_hash}: {})},node:input.node,template:frame.filename,template_hash:frame.hash,output,pdf:outputPlan.pdf,notes:outputPlan.notes,stage,stage_pdf:stageOutputs[1],stage_notes:stageOutputs[2],report,progress:path.join(dir,'progress.json'),verification_report:path.join(dir,'verified.json'),page_svg:path.join(dir,'page.svg'),page_png:path.join(dir,'page.png'),paper:frame.paper,scale,defaults};
  const config=path.join(dir,'job.json'),macro=path.join(dir,'generate.FCMacro');fs.writeFileSync(config,JSON.stringify(spec));fs.writeFileSync(macro,'JOB_PATH = '+JSON.stringify(config)+'\n'+drawingRunner);
  await (ports.executeNative??runDrawingNative)(executable,macro,dir,path.dirname(source),controller.signal,release);const result=read(report);if(result.status!=='completed')throw new Error(String(result.error||'FreeCAD未完成生成'));
  if(result.thumbnail_png!==spec.page_png)throw new Error('原生PNG路径不属于本任务固定输出');const thumbnail=readDrawingThumbnail(spec.page_png,result.thumbnail_sha256);
  const stagedArchive=readFcstdBatchArchive(stage,true);stagedArchive.files['thumbnails/Thumbnail.png']=thumbnail.bytes;stagedArchive.files['Document.xml']=strToU8(makeFcstdIncludedNamesPortable(stagedArchive.files,stagedArchive.xml).xml);fs.writeFileSync(stage,zipSync(stagedArchive.files,{level:6}));
  const verifier=path.join(dir,'verify.FCMacro');fs.writeFileSync(config,JSON.stringify({...spec,stage_hash:fcstdFingerprint(fs.readFileSync(stage)),thumbnail_sha256:thumbnail.sha256}));fs.writeFileSync(verifier,'JOB_PATH = '+JSON.stringify(config)+'\n'+drawingVerificationRunner);
  const stagedHashes=stageOutputs.map(file=>fcstdFingerprint(fs.readFileSync(file)));
  await (ports.executeNative??runDrawingNative)(executable,verifier,dir,path.dirname(source),controller.signal,release);if(read(spec.verification_report).status!=='completed')throw new Error(String(read(spec.verification_report).error||'原生重开验证失败'));
  if(stageOutputs.some((file,index)=>fcstdFingerprint(fs.readFileSync(file))!==stagedHashes[index]))throw new Error('验证后暂存输出变化，未发布');
  let provenance:SidecarProvenance|undefined;
  if(outputPlan.companion){
   const group=outputPlan.companion;
   provenance={schema:'phoenix-cad-companion',version:1,generated_draft:true,source_rel:group.binding.source_rel,source_sha256:spec.source_hash,source_node:input.node,drawing_rel:group.drawing_rel,drawing_sha256:stagedHashes[0],pdf_rel:group.pdf_rel,pdf_sha256:stagedHashes[1],revisionRaw:group.binding.identity.revisionRaw!,variantRaw:group.binding.identity.variantRaw,draft_sequence:group.draft_sequence,reference_pdf:reference?{rel:path.relative(root,reference).replace(/\\/g,'/'),sha256:input.reference_hash!}:null};
   stagedHashes[2]=finalizeDraftNotes(root,stageOutputs[2],stagedHashes[2],provenance).sha256;
  }
  verifyDrawingSources(root,guards);verifyReference();if(validateDrawingTemplate(catalog.root,input.template,frame.paper).hash!==frame.hash)throw new Error('模板已变化，结果未发布');assertDrawingOutputPlanAbsent(outputPlan);if(controller.signal.aborted)throw new Error('任务已取消');
  for(const [index,target] of outputPaths.entries()){const staged=stageOutputs[index];safeFcstdPath(root,path.relative(root,staged));safeFcstdPath(root,path.relative(root,path.dirname(target)));if(fcstdFingerprint(fs.readFileSync(staged))!==stagedHashes[index])throw new Error('验证后暂存输出变化，未发布此项');fs.linkSync(staged,target);published.push(target);}
  if(outputPaths.some((file,index)=>fcstdFingerprint(fs.readFileSync(file))!==stagedHashes[index]))throw new Error('正式输出在发布期间变化，请核对');
  if(provenance&&outputPlan.companion&&!verifySidecarProvenance(root,provenance,outputPlan.companion.binding,{signal:controller.signal}).verified)throw new Error('正式三件输出来源校验失败，请核对');
  if(outputPaths.some((file,index)=>fcstdFingerprint(fs.readFileSync(file))!==stagedHashes[index]))throw new Error('正式输出在最终来源验证期间变化，请核对');
  job.outputs=published.map(p=>path.relative(root,p).replace(/\\/g,'/'));job.warnings=[...(Array.isArray(result.warnings)?result.warnings.map(String):[]),...(outputPlan.legacy_manual?['名称未结构化：保留原始基名，出图来源需人工核对，未捏造编号或版次']:[])];job.dimensions=Array.isArray(result.dimensions)?result.dimensions.map(String):[];job.status='completed';
 }catch(error){job.outputs=published.map(p=>path.relative(root,p).replace(/\\/g,'/'));job.status=controller.signal.aborted?'cancelled':'failed';job.error=(error instanceof Error?error.message:String(error))+(published.length?'；已有部分输出发布，请核对，不会自动回滚或覆盖':'');}
 finally{for(const file of [...stageOutputs,path.join(dir,'page.svg'),path.join(dir,'page.png')])try{fs.unlinkSync(file);}catch{/* Only this job's unique stages/fixed page exports, never source CAD or a directory. */}release();}return job;})();
 controls.set(id,{controller,completion});return job;
}
export function cancelDrawingJob(workspace:string,id:string){const job=drawingJob(workspace,id);if(job.status==='running'){job.cancel_requested=true;controls.get(id)?.controller.abort();}return job;}
export async function waitDrawingJob(workspace:string,id:string,options:{signal?:AbortSignal}={}){const job=drawingJob(workspace,id),control=controls.get(id);if(!control)return job;const abort=()=>cancelDrawingJob(workspace,id);options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();try{return await control.completion;}finally{options.signal?.removeEventListener('abort',abort);}}
