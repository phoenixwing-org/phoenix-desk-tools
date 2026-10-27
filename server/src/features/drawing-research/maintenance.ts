import {makeFcstdIncludedNamesPortable} from '../../lib/fcstdArchiveNames.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { zipSync, strToU8 } from 'fflate';
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive, fcstdFingerprint } from '../../lib/fcstdBatchFiles.js';
import { fcstdNativeXlinkFiles } from '../../lib/fcstdNativeXlinkFiles.js';
import { fcstdXmlObjects,xmlAttribute } from '../../lib/fcstdLinkIdentity.js';
import { readDrawingThumbnail } from './drawing-thumbnail.js';
import { buildFreecadChildEnvironment } from '../../lib/freecadProcessSecurity.js';
import { guiExecutable, drawingDefaults } from './jobs.js';
import { maintenanceRunner, maintenanceVerificationRunner,type MaintenancePatch } from './maintenance-runner.js';
import {acquireDrawingExecution,type DrawingExecutionLease} from './executionGate.js';
export interface MaintenanceInput { workspace:string; rel:string; destination?:string; material?:string; export_pdf?:boolean }
export interface MaintenancePlan { input:MaintenanceInput; fingerprints:Record<string,string>; outputs:string[]; patches?:MaintenancePatch[]; audit_config?:{path:string;fingerprint:string|null} }
/** Publication/rollback was attempted; a failed operation is not necessarily
 * a no-write result. Paths identify what the user must inspect, not success. */
export class MaintenancePublicationError extends Error {
 constructor(message:string,readonly outputs:string[],readonly backup:string){super(message);this.name='MaintenancePublicationError';}
}
const running=new Set<string>();
const hash=(file:string)=>fcstdFingerprint(fs.readFileSync(file));
function assertJointSafeDrawing(xml:string){
 const semantic=xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,value=>' '.repeat(value.length));
 const objectTags=[...semantic.matchAll(/<Object\b(?:[^"'>]|"[^"]*"|'[^']*')*>/g)];
 const assemblyTypes=new Set(['Assembly::AssemblyObject','Assembly::AssemblyLink','Assembly::JointGroup','Assembly::Joint']);
 // Normalize only the read-only probe so even an empty/self-closing unknown
 // Reference property reaches the shared structured object-property reader.
 const probe=semantic.replace(/<Property\b(?:[^"'>]|"[^"]*"|'[^']*')*\/>/g,tag=>tag.slice(0,-2)+'></Property>');
 if(objectTags.some(([tag])=>assemblyTypes.has(xmlAttribute(tag,'type')))||fcstdXmlObjects(probe).some(object=>object.properties.has('Reference1')||object.properties.has('Reference2')))throw new Error('目标图纸包含装配/Joint或关节引用属性，可能受关节引用影响；暂不自动整理，保持原件；请在FreeCAD中确认，不自动删除或重绑');
}
export function planMaintenance(input:MaintenanceInput,options:{patches?:MaintenancePatch[];audit_config?:MaintenancePlan['audit_config']}={}):MaintenancePlan {
 const root=fcstdWorkspace(input.workspace),source=safeFcstdPath(root,input.rel);
 const destination=input.destination||input.rel;
 if(!/\.fcstd$/i.test(source)||!/\.drawing\.fcstd$/i.test(destination))throw new Error('请选择独立 Drawing.FCStd');
 const parent=safeFcstdPath(root,path.dirname(destination));
 const target=path.join(parent,path.basename(destination));
 if(target!==source&&fs.existsSync(target))throw new Error('目标图纸已存在，未覆盖');
 const fingerprints:Record<string,string>={},queue=[source];
 while(queue.length){
  const file=queue.shift()!;const rel=path.relative(root,file);
  if(rel in fingerprints)continue;
  if(Object.keys(fingerprints).length>=500)throw new Error('外链超过500个，请缩小范围');
  const archive=readFcstdBatchArchive(file);fingerprints[rel]=fcstdFingerprint(archive.bytes);
  if(file===source){
   if(!archive.xml.includes('TechDraw::DrawPage'))throw new Error('没有图纸页面');
   assertJointSafeDrawing(archive.xml);
  }
  for(const dependency of fcstdNativeXlinkFiles(archive.xml)){
   const p=safeFcstdPath(root,path.relative(root,path.resolve(path.dirname(file),dependency)));
   if(!/\.fcstd$/i.test(p))throw new Error('引用不是FCStd');queue.push(p);
  }
 }
 const outputs=[destination];
 const sourcePdf=source.replace(/\.fcstd$/i,'.pdf');
 if(input.export_pdf!==false){
  const pdf=target.replace(/\.fcstd$/i,'.pdf');
  if(target!==source&&fs.existsSync(pdf))throw new Error('目标PDF已存在，未覆盖');
  outputs.push(path.relative(root,pdf));
  if(fs.existsSync(sourcePdf)){safeFcstdPath(root,path.relative(root,sourcePdf));fingerprints[path.relative(root,sourcePdf)]=hash(sourcePdf);}
 }
 if(options.patches!==undefined){
  if(!Array.isArray(options.patches)||options.patches.length<1||options.patches.length>100)throw new Error('请选择1–100个精确修正项');
  const seen=new Set<string>();for(const patch of options.patches){
   if(!patch||!['label','text','property','view','link','resource'].includes(patch.kind))throw new Error('修正类型无效');
   if('object'in patch&&!/^[A-Za-z_]\w*$/.test(patch.object))throw new Error('修正对象身份无效');
   const key=JSON.stringify([patch.kind,'object'in patch?patch.object:patch.current,'field'in patch?patch.field:'']);if(seen.has(key))throw new Error('重复修正字段');seen.add(key);
   for(const value of Object.values(patch))if(typeof value!=='string'||value.length>4096||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw new Error('修正值无效');
  }
 }
 if(options.audit_config){
  if(options.audit_config.path!=='.phoenix/drawing-defaults.json')throw new Error('校核配置路径无效');
  const file=path.join(root,options.audit_config.path);let actual:string|null=null;
  if(fs.existsSync(file)){safeFcstdPath(root,options.audit_config.path);if(fs.statSync(file).size>1024*1024)throw new Error('校核配置过大');actual=hash(file);}
  if(actual!==options.audit_config.fingerprint)throw new Error('图纸空间配置已变化，请重新预览');
 }
 return {input:{workspace:root,rel:path.relative(root,source),destination:path.relative(root,target),material:input.material??drawingDefaults(root).material,export_pdf:input.export_pdf},fingerprints,outputs,...(options.patches!==undefined?{patches:structuredClone(options.patches)}:{}),...(options.audit_config?{audit_config:{...options.audit_config}}:{})};
}
export function verifyMaintenancePlan(plan:MaintenancePlan) {
 const next=planMaintenance(plan.input,{patches:plan.patches,audit_config:plan.audit_config});
 if(JSON.stringify(next.fingerprints)!==JSON.stringify(plan.fingerprints)||JSON.stringify(next.outputs)!==JSON.stringify(plan.outputs))throw new Error('文件或引用已变化，请重新预览');
}
const maintenancePhases=new Set(['opening_source','reading_archive','settling_initial','applying_patches','checking_preservation','exporting_pdf','exporting_thumbnail','saving_stage','rebinding_links','closing_before_reopen','reopening_stage','checking_reopen','writing_report','closing_owned_documents','completed']);
const verificationPhases=new Set(['opening_stage','checking_templates','checking_links','settling_views','checking_preservation','writing_report','closing_owned_documents','completed']);
function diagnosticTail(value:string,limit=8192){const bytes=Buffer.from(value);let start=Math.max(0,bytes.length-limit);while(start<bytes.length&&(bytes[start]&0xc0)===0x80)start++;return bytes.subarray(start).toString('utf8');}
function diagnosticSummary(value:unknown){return typeof value==='string'?diagnosticTail(value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim(),512):'';}
function diagnosticCode(error:unknown){const code=(error as {system_code?:string})?.system_code??(error as NodeJS.ErrnoException)?.code;return typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,31}$/.test(code)?' ('+code+')':'';}
function diagnosticJson(file:string):Record<string,unknown>{try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
/** Fixed diagnostics belong to this invocation; only an owned PID+nonce may report a phase. */
export async function runMaintenanceNative(macro:string,folder:string,root:string,config:string,signal?:AbortSignal,execution?:DrawingExecutionLease){
 const verify=path.basename(macro)==='verify.FCMacro',prefix=verify?'native-verify':'native-maintain',log=path.join(folder,prefix+'.log'),progress=path.join(folder,prefix+'-progress.json'),report=path.join(folder,verify?'verified.json':'result.json');
 const nonce=randomUUID(),ownerFile=path.join(folder,'native-owner-'+nonce+'.json');let pid:number|undefined,tail='',logFailure='';
 const owned=(value:Record<string,unknown>)=>!!pid&&value.native_pid===pid&&value.native_nonce===nonce;
 const phase=(value:Record<string,unknown>)=>{if(!owned(value)||typeof value.phase!=='string')return '';const base=verify&&value.phase.startsWith('verify_')?value.phase.slice(7):verify?'':value.phase;return (verify?verificationPhases:maintenancePhases).has(base)?value.phase:'';};
 const currentPhase=()=>phase(diagnosticJson(progress));
 const failure=(why:string,at='')=>{const result=diagnosticJson(report),summary=owned(result)&&result.status==='failed'?diagnosticSummary(result.error):'';return new Error(why+'；阶段：'+(at||phase(result)||currentPhase()||'尚未进入任务宏')+(summary?'；任务错误：'+summary:'')+'；诊断日志：'+log+(logFailure?'（'+logFailure+'）':''));};
 const persist=()=>{try{fs.writeFileSync(log,tail,{encoding:'utf8',mode:0o600});}catch(error){logFailure='日志写入失败'+diagnosticCode(error);}};
 persist();
 if(signal?.aborted)throw failure('任务已取消；未启动原生程序');
 if(logFailure)throw failure('原生诊断初始化失败；未启动原生程序');
 try{const spec=JSON.parse(fs.readFileSync(config,'utf8'));spec.native_nonce=nonce;spec.native_owner_file=ownerFile;spec.native_progress=progress;spec.native_verify=verify;fs.writeFileSync(config,JSON.stringify(spec));fs.writeFileSync(progress,'{}',{mode:0o600});fs.writeFileSync(report,'{}',{mode:0o600});}catch(error){throw failure('原生任务配置/诊断初始化失败'+diagnosticCode(error));}
 const env=buildFreecadChildEnvironment(process.env);delete env.QT_QPA_PLATFORM;
 const lease=execution??acquireDrawingExecution('maintenance-native:'+randomUUID());
 try{return await new Promise<number>((resolve,reject)=>{
   let child:ChildProcess;try{child=lease.spawn(guiExecutable(),['-u',path.join(folder,'user.cfg'),'-s',path.join(folder,'system.cfg'),macro],{cwd:root,env,stdio:['ignore','pipe','pipe']});}catch(error){reject(failure('FreeCAD子进程启动失败'+diagnosticCode(error)));return;}
   pid=child.pid;let reason='',failedPhase='',closed=false,killTimer:ReturnType<typeof setTimeout>|undefined;
   const kill=(kind:NodeJS.Signals)=>{if(!child.pid)return;try{child.kill(kind);}catch{/* Never release before the owned child's close event. */}};
   const stop=(message:string)=>{if(reason||closed)return;reason=message;failedPhase=currentPhase()||'尚未进入任务宏';kill('SIGTERM');if(child.pid){killTimer=setTimeout(()=>kill('SIGKILL'),2000);killTimer.unref();}};
   const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')],append=(value:string)=>{tail=diagnosticTail(tail+value);persist();if(logFailure)stop('原生诊断日志写入失败；源文件保留');};
   child.stdout?.on('data',(chunk:Buffer|string)=>append(decoders[0].write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))));
   child.stderr?.on('data',(chunk:Buffer|string)=>append(decoders[1].write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))));
   const aborted=()=>stop('任务已取消；源文件保留');signal?.addEventListener('abort',aborted,{once:true});
   const timer=setTimeout(()=>stop('整理超过180秒，源文件保留'),180000);timer.unref();
   const cleanup=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal?.removeEventListener('abort',aborted);};
   child.once('error',error=>{if(child.pid)stop('本任务原生进程异常'+diagnosticCode(error));else if(!reason){reason='FreeCAD子进程启动失败'+diagnosticCode(error);failedPhase='尚未进入任务宏';}});
   child.once('close',(code,exitSignal)=>{closed=true;cleanup();for(const decoder of decoders)append(decoder.end());const result=diagnosticJson(report);if(reason)reject(failure(reason,failedPhase));else if(logFailure)reject(failure('原生诊断日志写入失败；源文件保留'));else if(code!==0||exitSignal)reject(failure('原生进程未正常退出，源文件保留'));else if(!pid||!owned(result))reject(failure('原生报告缺失/损坏或进程归属不匹配'));else if(result.status!=='completed')reject(failure('FreeCAD未完成本任务；源文件保留'));else resolve(pid);});
   // Marker setup is part of the owned child lifecycle: after spawn no setup
   // failure may reject/release the lease before that child has actually closed.
   child.once('spawn',()=>{try{lease.assertHealthy();if(!child.pid)throw new Error();const temporary=ownerFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify({pid:child.pid,nonce}),{flag:'wx',mode:0o600});fs.linkSync(temporary,ownerFile);fs.unlinkSync(temporary);}catch{stop('原生进程归属文件无法建立；等待自有进程退出，源文件保留');}});
   if(signal?.aborted)aborted();
  });}finally{if(!execution)lease();}
}
export async function applyMaintenance(plan:MaintenancePlan,options:{signal?:AbortSignal}={}) {
 const root=plan.input.workspace,source=safeFcstdPath(root,plan.input.rel),target=path.resolve(root,plan.input.destination!);
 if(options.signal?.aborted)throw new Error('任务已取消');
 if(running.has(source))throw new Error('图纸正在整理');const release=acquireDrawingExecution('maintenance:'+randomUUID());running.add(source);
 let folder='',repairedInput:string|undefined,repairedInputHash:string|undefined,stageHash:string|undefined,pdfStage:string|undefined,pdfStageHash:string|undefined;
 const stage=path.join(path.dirname(target),'.'+path.basename(target)+'.'+randomUUID()+'.FCStd');
 let published=false;
 try{
  folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-drawing-maintain-'));
  const report=path.join(folder,'result.json');
  verifyMaintenancePlan(plan);
  let nativeSource=source;
  if(plan.patches?.some(p=>p.kind==='resource')){
   const before=readFcstdBatchArchive(source,true);const files=before.files;let xml=before.xml;
   for(const patch of plan.patches.filter((p):p is Extract<MaintenancePatch,{kind:'resource'}>=>p.kind==='resource')){
    if(!files[patch.current]||files[patch.proposed]&&patch.proposed!==patch.current)throw new Error('内嵌资源已变化或目标重名');
    if(!/^[A-Za-z0-9_.-]+$/.test(patch.proposed))throw new Error('资源目标必须为安全ASCII内部名');
    const entries=Object.entries(files).map(([name,bytes])=>[name===patch.current?patch.proposed:name,bytes]as const);for(const name of Object.keys(files))delete files[name];for(const [name,bytes]of entries)files[name]=bytes;
    const encoded=patch.reference.replaceAll('&','&amp;').replaceAll('"','&quot;');const replacement=patch.proposed_reference.replaceAll('&','&amp;').replaceAll('"','&quot;');
    let found=0;xml=xml.replace(/<FileIncluded\b[^>]*>/g,tag=>{if(!tag.includes('file="'+encoded+'"'))return tag;found++;return tag.replace('file="'+encoded+'"','file="'+replacement+'"');});if(!found)throw new Error('内嵌资源XML引用已变化');
   }
   files['Document.xml']=strToU8(xml);nativeSource=path.join(path.dirname(source),'.'+randomUUID()+'.repair-input.FCStd');const inputBytes=zipSync(files);fs.writeFileSync(nativeSource,inputBytes,{flag:'wx'});repairedInput=nativeSource;repairedInputHash=fcstdFingerprint(inputBytes);
  }
  const config=path.join(folder,'job.json'),macro=path.join(folder,'maintain.FCMacro');
  fs.writeFileSync(config,JSON.stringify({source:nativeSource,source_fingerprints:Object.fromEntries(Object.entries(plan.fingerprints).map(([rel,digest])=>[safeFcstdPath(root,rel),digest])),stage,report,verification_report:path.join(folder,'verified.json'),material:plan.input.material,export_pdf:plan.input.export_pdf,pdf:path.join(folder,'page.pdf'),svg:path.join(folder,'page.svg'),png:path.join(folder,'page.png'),...(plan.patches?{patches:plan.patches}:{})}));
  fs.writeFileSync(macro,'JOB_PATH = '+JSON.stringify(config)+'\n'+maintenanceRunner);
  const nativePid=await runMaintenanceNative(macro,folder,root,config,options.signal,release);
  const result=JSON.parse(fs.readFileSync(report,'utf8'));
  if(result.status!=='completed'||result.native_pid!==nativePid)throw new Error(result.error||'FreeCAD未完成整理或进程归属不匹配');
  if(options.signal?.aborted)throw new Error('任务已取消；未发布');
  const archive=readFcstdBatchArchive(stage,true);
  stageHash=fcstdFingerprint(archive.bytes);
  if(!plan.patches)archive.files['Document.xml']=strToU8(makeFcstdIncludedNamesPortable(archive.files,archive.xml).xml);
  const thumbnail=readDrawingThumbnail(path.join(folder,'page.png'),result.thumbnail_sha256);
  archive.files['thumbnails/Thumbnail.png']=thumbnail.bytes;
  const bytes=zipSync(archive.files,{level:6});
  verifyMaintenancePlan(plan);
  // Backups are workspace-local cache, never published engineering samples.
  const cacheRel='.phoenix/cache/drawing-maintenance';
  for(const part of ['.phoenix','.phoenix/cache',cacheRel]){const dir=path.join(root,part);if(fs.existsSync(dir))safeFcstdPath(root,part);else fs.mkdirSync(dir);}
  const backup=path.join(root,cacheRel,randomUUID());fs.mkdirSync(backup,{mode:0o700});
  const sourcePdf=source.replace(/\.fcstd$/i,'.pdf'),targetPdf=target.replace(/\.fcstd$/i,'.pdf');
  fs.copyFileSync(source,path.join(backup,'before.FCStd'),fs.constants.COPYFILE_EXCL);
  if(plan.input.export_pdf!==false&&fs.existsSync(sourcePdf))fs.copyFileSync(sourcePdf,path.join(backup,'before.pdf'),fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(backup,'plan.json'),JSON.stringify(plan,null,2));
  fs.writeFileSync(stage,bytes);
  stageHash=fcstdFingerprint(bytes);
  fs.writeFileSync(config,JSON.stringify({...JSON.parse(fs.readFileSync(config,'utf8')),stage_hash:stageHash,thumbnail_sha256:thumbnail.sha256}));
  const verifier=path.join(folder,'verify.FCMacro');
  fs.writeFileSync(verifier,'JOB_PATH = '+JSON.stringify(config)+'\n'+maintenanceVerificationRunner);
  const verifierPid=await runMaintenanceNative(verifier,folder,root,config,options.signal,release);
  const verified=JSON.parse(fs.readFileSync(path.join(folder,'verified.json'),'utf8'));
  if(verified.status!=='completed'||verified.native_pid!==verifierPid)throw new Error(verified.error||'最终图框重开校验失败或进程归属不匹配');
  if(options.signal?.aborted)throw new Error('任务已取消；未发布');
  if(hash(stage)!==stageHash)throw new Error('最终重开后暂存图纸变化；未发布');
  verifyMaintenancePlan(plan);
  const created=new Map<string,string>();
  const claimed:Array<{file:string;retained:string;digest:string}>=[];
  const claim=(file:string,digest:string|undefined,name:string)=>{
   if(!fs.existsSync(file)){if(digest)throw new Error('发布前原文件已移除，未发布旧内容');return;}
   if(!digest)throw new Error('发布前出现未确认文件，未覆盖');
   safeFcstdPath(root,path.relative(root,file));
   const retained=path.join(backup,name);if(fs.existsSync(retained))throw new Error('保留原件路径已占用');
   fs.renameSync(file,retained);claimed.push({file,retained,digest});
   if(hash(retained)!==digest)throw new Error('发布前原文件变化；保留并恢复，不覆盖');
  };
  const publish=(from:string,to:string,digest:string)=>{
   if(options.signal?.aborted)throw new Error('任务已取消；未发布');
   // Same-directory staged files are fully written before an atomic no-replace
   // publication. Never rename over a path concurrently created by the user.
   fs.linkSync(from,to);created.set(to,digest);
   if(hash(to)!==digest)throw new Error('发布内容已变化');
  };
  try{
   if(plan.input.export_pdf!==false){
    pdfStage=targetPdf+'.'+randomUUID()+'.tmp';fs.copyFileSync(path.join(folder,'page.pdf'),pdfStage,fs.constants.COPYFILE_EXCL);pdfStageHash=hash(pdfStage);
   }
   verifyMaintenancePlan(plan);
   claim(source,plan.fingerprints[plan.input.rel],'claimed-before.FCStd');
   if(plan.input.export_pdf!==false)claim(sourcePdf,plan.fingerprints[path.relative(root,sourcePdf)],'claimed-before.pdf');
   publish(stage,target,fcstdFingerprint(bytes));
   if(pdfStage&&pdfStageHash)publish(pdfStage,targetPdf,pdfStageHash);
   for(const [rel,digest]of Object.entries(plan.fingerprints)){
    if(rel===plan.input.rel||path.resolve(root,rel)===sourcePdf)continue;
    if(hash(safeFcstdPath(root,rel))!==digest)throw new Error('源3D依赖在发布期间变化，未确认成功');
   }
   published=true;
  }catch(error){
   let preserved=false;
   // Never hash a public path then unlink it: an editor can atomically replace
   // it in between. Retain the actual moved bytes first; restore external saves
   // without replacement, or leave them in the private backup if occupied.
   for(const [file,digest]of created)if(fs.existsSync(file)){
    const retained=path.join(backup,'rollback-'+randomUUID()+path.extname(file));
    try{fs.renameSync(file,retained);if(hash(retained)===digest)fs.unlinkSync(retained);else{preserved=true;try{fs.linkSync(retained,file);}catch{}}}catch{preserved=true;}
   }
   for(const old of claimed)try{fs.linkSync(old.retained,old.file);}catch{preserved=true;}
   if(preserved){
    const outputs=[...created.keys()].filter(file=>fs.existsSync(file)).map(file=>path.relative(root,file));
    throw new MaintenancePublicationError((error instanceof Error?error.message:String(error))+'；输出或回滚结果未完全确认，并发新内容未覆盖。请核对目标，保留原件见 '+path.relative(root,backup),outputs,path.relative(root,backup));
   }
   throw error;
  }
  // Publication has already happened. A bookkeeping failure must not turn an
  // actual write into a false "no outputs" failure or initiate a blind retry.
  const warnings:string[]=[];
  for(const failure of result.source_safety?.source_object_errors||[])warnings.push('既有源对象故障保留、未修复：'+failure.file+':'+failure.object+' ('+failure.states.join('/')+')；'+failure.status);
  const outputs=plan.outputs.map(rel=>({path:rel,sha256:created.get(path.resolve(root,rel))!}));
  for(const output of outputs)try{if(hash(safeFcstdPath(root,output.path))!==output.sha256)warnings.push('已发布输出随后变化；请核对目标，不要盲目重试');}catch{warnings.push('已发布输出当前无法核对；请检查目标，不要盲目重试');}
  const done={...result,final_archive_verified:true,final_native_verification:{native_pid:verified.native_pid,native_references:verified.native_references,source_graph_before:verified.source_graph_before,source_graph_after:verified.source_graph_after,source_safety:verified.source_safety},outputs,backup:path.relative(root,backup),source_files_unchanged:true,visual_review_required:true};
  try{fs.writeFileSync(path.join(backup,'result.json'),JSON.stringify(done,null,2),{flag:'wx',mode:0o600});}catch{warnings.push('图纸/PDF已经发布，但本地验收记录写入失败；请核对输出和备份');}
  return {...done,...(warnings.length?{warnings}:{})};
 }finally{
  running.delete(source);release();
  const cleanupOwned=(file:string|undefined,digest:string|undefined)=>{
   if(!file||!digest)return;
   // Cleanup cannot conceal a successful publication or an incomplete receipt.
   // Unreadable/changed temporary evidence is retained, never blindly removed.
   try{if(fs.existsSync(file)&&hash(file)===digest)fs.unlinkSync(file);}catch{}
  };
  cleanupOwned(stage,stageHash);cleanupOwned(pdfStage,pdfStageHash);cleanupOwned(repairedInput,repairedInputHash);
  // Keep failed diagnostics for local troubleshooting; no logs leave the host.
  if(published&&folder)try{fs.rmSync(folder,{recursive:true,force:true});}catch{}
 }
}
