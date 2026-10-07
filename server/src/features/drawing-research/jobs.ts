import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive, fcstdFingerprint } from '../../lib/fcstdBatchFiles.js';
import { runtimeUserDataDir } from '../../lib/appRuntimePaths.js';
import { buildFreecadChildEnvironment } from '../../lib/freecadProcessSecurity.js';
import { sourceNodes, templateCatalog } from './service.js';
import { drawingRunner } from './runner.js';
export type DrawingDefaults = {template_root: string; template: string; creator: string; approval_person: string; company: string; material: string; tolerances: string};
const empty: DrawingDefaults = {template_root:'',template:'',creator:'',approval_person:'',company:'',material:'',tolerances:''};
function read(file:string): Record<string,unknown> {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
function clean(value:unknown):Partial<DrawingDefaults> {const result:Partial<DrawingDefaults>={};for(const key of Object.keys(empty) as Array<keyof DrawingDefaults>){const v=(value as Record<string,unknown>)?.[key];if(typeof v==='string')result[key]=v.slice(0,4096);}return result;}
function preferencesPath(root:string) {const folder=path.join(root,'.phoenix');if(fs.existsSync(folder))safeFcstdPath(root,'.phoenix');const file=path.join(folder,'drawing-defaults.json');if(fs.existsSync(file))safeFcstdPath(root,path.relative(root,file));return file;}
export function drawingDefaults(workspace:string):DrawingDefaults {const root=fcstdWorkspace(workspace);return {...empty,...clean(read(path.join(runtimeUserDataDir(),'drawing-defaults.json'))),...clean(read(preferencesPath(root)))};}
export function saveDrawingDefaults(workspace:string,scope:string,value:unknown) {const root=fcstdWorkspace(workspace);if(!['workspace','machine'].includes(scope))throw new Error('未知设置范围');const file=scope==='workspace'?preferencesPath(root):path.join(runtimeUserDataDir(),'drawing-defaults.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({...clean(read(file)),...clean(value)},null,2)+'\n');return drawingDefaults(root);}
type Job = {id:string;workspace:string;status:'running'|'completed'|'failed';error?:string;outputs?:string[];warnings?:string[];dimensions?:string[]};
const jobs=new Map<string,Job>();
export function guiExecutable() {const prefs=read(path.join(runtimeUserDataDir(),'launcher-prefs.json'));const home=typeof prefs.freecad_dir==='string'?prefs.freecad_dir:'';const candidates=[home&&path.join(home,'Contents/Resources/bin/freecad'),home&&path.join(home,'bin/FreeCAD.exe'),home&&path.join(home,'bin/freecad'),'/Applications/FreeCAD.app/Contents/Resources/bin/freecad','/usr/bin/freecad'];const executable=candidates.find(p=>p&&fs.existsSync(p)&&fs.statSync(p).isFile());if(!executable)throw new Error('未找到FreeCAD图形程序，请先设置FreeCAD安装目录');return executable;}
export function drawingJob(workspace:string,id:string) {const root=fcstdWorkspace(workspace),job=jobs.get(id);if(!job||job.workspace!==root)throw new Error('出图任务不存在');return job;}
export function startDrawing(input:{workspace:string;rel:string;node:string;template_root:string;template:string;defaults?:unknown}) {
 const root=fcstdWorkspace(input.workspace);if([...jobs.values()].some(j=>j.status==='running'))throw new Error('已有出图任务运行中，请稍后再试');
 const source=safeFcstdPath(root,input.rel);if(!/\.fcstd$/i.test(source)||/\.drawing\.fcstd$/i.test(source))throw new Error('请选择源模型FCStd');
 const archive=readFcstdBatchArchive(source);if(!sourceNodes(archive.xml).some(n=>n.name===input.node))throw new Error('请选择可用的模型主节点');
 const catalog=templateCatalog(input.template_root);if(!catalog.items.some(t=>t.rel===input.template))throw new Error('模板不在所选目录内');const template=safeFcstdPath(catalog.root,input.template);
 const output=source.replace(/(?:\.assy)?\.fcstd$/i,'.Drawing.FCStd');for(const file of [output,output.replace(/\.FCStd$/,'.pdf'),output.replace(/\.FCStd$/,'.ai.md')])if(fs.existsSync(file))throw new Error('同名图纸或输出已存在，保留原文件');
 const executable=guiExecutable(),id=randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'desk-drawing-')),report=path.join(dir,'result.json'),job:Job={id,workspace:root,status:'running'};
 const spec={id,source,source_hash:fcstdFingerprint(archive.bytes),node:input.node,template,output,report,defaults:{...drawingDefaults(root),...clean(input.defaults)}};const config=path.join(dir,'job.json');fs.writeFileSync(config,JSON.stringify(spec));const macro=path.join(dir,'generate.FCMacro');fs.writeFileSync(macro,`JOB_PATH = ${JSON.stringify(config)}\n`+drawingRunner);
 const env=buildFreecadChildEnvironment(process.env);delete env.QT_QPA_PLATFORM;
 jobs.set(id,job);if(jobs.size>100)for(const [key,v] of jobs){if(v.status!=='running'){jobs.delete(key);break;}}
 const child=spawn(executable,['-u',path.join(dir,'user.cfg'),'-s',path.join(dir,'system.cfg'),macro],{cwd:path.dirname(source),env,stdio:'ignore'});
 const timeout=setTimeout(()=>{job.status='failed';job.error='出图超过10分钟，请检查FreeCAD进程';child.kill('SIGTERM');},600000);timeout.unref();
 child.on('error',error=>{clearTimeout(timeout);job.status='failed';job.error=error.message;});
 child.on('close',()=>{clearTimeout(timeout);if(job.status==='failed')return;const result=read(report);if(result.status==='completed'&&Array.isArray(result.outputs)){job.status='completed';job.outputs=result.outputs.map(p=>path.relative(root,String(p)).replace(/\\/g,'/'));job.warnings=Array.isArray(result.warnings)?result.warnings.map(String):[];job.dimensions=Array.isArray(result.dimensions)?result.dimensions.map(String):[];}else{job.status='failed';job.error=String(result.error||'FreeCAD未返回成功结果');}});
 return job;
}
