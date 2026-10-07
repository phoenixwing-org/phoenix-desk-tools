import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fcstdWorkspace, safeFcstdPath} from '../../lib/fcstdBatchFiles.js';
import {buildFreecadChildEnvironment} from '../../lib/freecadProcessSecurity.js';
import {guiExecutable} from './jobs.js';
import {syncPython} from './sync-runner.js';
export interface FieldChange {field:string;current:string;proposed:string}
export interface PageReview {page:string;label:string;changed:string[];changes:FieldChange[];conflicts:FieldChange[];unmapped:string[]}
export interface Review {fingerprints:Record<string,string>;pages:PageReview[]}
interface Ticket {root:string;target:string;review:Review;created:number}
const tickets=new Map<string,Ticket>();
const running=new Set<string>();
async function execute(root:string,target:string,review?:Review):Promise<{review?:Review;pdf_stale?:boolean}> {
 if(running.has(target))throw new Error('此图纸正在同步，请稍后再试');
 running.add(target);
 try {
  const id=randomUUID(),folder=fs.mkdtempSync(path.join(os.tmpdir(),'desk-titleblock-'));
  const report=path.join(folder,'result.json'),config=path.join(folder,'job.json'),macro=path.join(folder,'sync.FCMacro');
  fs.writeFileSync(config,JSON.stringify({id,target,report,mode:review?'apply':'preview',review}));
  fs.writeFileSync(macro,`JOB_PATH = ${JSON.stringify(config)}\n`+syncPython);
  const env=buildFreecadChildEnvironment(process.env);delete env.QT_QPA_PLATFORM;
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(guiExecutable(),['-u',path.join(folder,'user.cfg'),'-s',path.join(folder,'system.cfg'),macro],{cwd:root,env,stdio:'ignore'});
   let expired=false;
   const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},120000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('close',()=>{clearTimeout(timer);if(expired)reject(new Error('同步超时，请检查图纸后重新预览'));else resolve();});
  });
  const result=JSON.parse(fs.readFileSync(report,'utf8'));
  if(result.status!=='completed')throw new Error(result.error||'标题栏同步失败');
  return result;
 } finally {running.delete(target);}
}
export async function previewTitleblock(workspace:string,rel:string) {
 const root=fcstdWorkspace(workspace),target=safeFcstdPath(root,rel);
 if(!/\.fcstd$/i.test(target))throw new Error('请选择FCStd图纸');
 const result=await execute(root,target);const review=result.review;
 if(!review?.pages.length)throw new Error('文件没有TechDraw图纸页面');
 const id=randomUUID();tickets.set(id,{root,target,review,created:Date.now()});
 for(const [key,ticket] of tickets)if(Date.now()-ticket.created>30*60*1000)tickets.delete(key);
 if(tickets.size>100)tickets.delete(tickets.keys().next().value!);
 return {id,pages:review.pages};
}
export async function applyTitleblock(workspace:string,rel:string,id:string) {
 const root=fcstdWorkspace(workspace),target=safeFcstdPath(root,rel),ticket=tickets.get(id);
 if(!ticket||ticket.root!==root||ticket.target!==target||Date.now()-ticket.created>30*60*1000)throw new Error('预览已失效，请重新预览');
 if(!ticket.review.pages.some(p=>p.changes.length))throw new Error('没有可安全更新的字段');
 const result=await execute(root,target,ticket.review);tickets.delete(id);return result;
}
