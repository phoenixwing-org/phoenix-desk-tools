import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import path from 'node:path';
import {validateWorkerPng} from './worker-png.js';

export interface OwnedWorkerMcpProcess {child:ChildProcessWithoutNullStreams;closed:Promise<void>;close():Promise<void>}
export interface ThumbnailWorkerJobInput {jobId:string;file:string;expectedSha256:string;width?:number;height?:number}
export interface ThumbnailWorkerStatus {
 schema_version:1;worker_id:string;session_id:string;state:'ready'|'busy'|'quarantined'|'stopped';active_job_id:string|null;saves_cad:false;
 render_profile:'native-isometric-white-v1';supported_file_scope:'trusted-native-self-contained';jobs_retained:20;max_jobs:256;
 max_input_bytes:67108864;max_png_bytes:4194304;dimensions:{max_width:1024;max_height:1024;max_pixels:1048576};
}
export type ThumbnailWorkerJobState='queued'|'freezing'|'opening'|'rendering'|'closing'|'done'|'failed'|'cancelled';
export interface ThumbnailWorkerImage {
 png:Buffer;sha256:string;width:number;height:number;bytes:number;camera_restored:true;documents_closed:true;saved_cad:false;worker_reusable:true;render_profile:'native-isometric-white-v1';
}
export interface ThumbnailWorkerJob {
 schema_version:1;worker_id:string;session_id:string;job_id:string;state:ThumbnailWorkerJobState;phase:ThumbnailWorkerJobState;cancel_requested:boolean;
 input_revision:{sha256:string;bytes:number}|null;result:ThumbnailWorkerImage|null;error:{code:string;message:string}|null;
}
export interface ThumbnailWorkerClient {
 status():Promise<ThumbnailWorkerStatus>;render(input:ThumbnailWorkerJobInput):Promise<ThumbnailWorkerJob>;
 get(input:ThumbnailWorkerJobInput):Promise<ThumbnailWorkerJob>;cancel(input:ThumbnailWorkerJobInput):Promise<ThumbnailWorkerJob>;
}
type Identity={workerId:string;sessionId:string};
type Input={process:OwnedWorkerMcpProcess;identity:Identity;timeout_ms?:number;signal?:AbortSignal};
type RecordValue=Record<string,unknown>;
type BoundJob=Required<ThumbnailWorkerJobInput>;
const PROTOCOL='2025-11-25',VERSION='0.3.2',PROFILE='native-isometric-white-v1';
const MAX_MESSAGE=6*1024*1024,MAX_PNG=4*1024*1024,MAX_STDERR=64*1024,MAX_MESSAGES=8192;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const UUID_SCHEMA='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
const TOOLS=['get_thumbnail_worker_status','render_document_thumbnail','get_thumbnail_job','cancel_thumbnail_job'] as const;
const STATES=['queued','freezing','opening','rendering','closing','done','failed','cancelled'] as const;
const REMOTE_CODES=new Set(['INVALID_ARGUMENT','INVALID_RESPONSE','INVALID_REQUEST','INVALID_PARAMS','BRIDGE_TIMEOUT','CONNECTION_FAILED',
 'JOB_RESULT_EXPIRED','JOB_NOT_FOUND','JOB_ID_CONFLICT','WORKER_BUSY','WORKER_UNAVAILABLE','WORKER_SESSION_CHANGED','WORKER_SESSION_LIMIT',
 'WORKER_IDENTITY_INVALID','WORKER_NOT_EMPTY','WORKER_REQUEST_FAILED','WORKER_STARTING_OR_STOPPING','WORKER_GUI_DISPATCH_FAILED',
 'INPUT_REVISION_CHANGED','WORKER_DOCUMENT_OWNERSHIP_LOST','WORKER_DOCUMENT_BUSY','WORKER_CAPTURE_INVALID','WORKER_CLEANUP_UNCERTAIN',
 'WORKER_QUARANTINED','WORKER_JOB_FAILED','WORKER_CAPTURE_MISSING','WORKER_SOURCE_MISMATCH','WORKER_STAGING_UNAVAILABLE','GUI_THREAD_REQUIRED']);
export class ThumbnailWorkerClientError extends Error {
 constructor(readonly code:string){super(code==='worker_timeout'||code==='BRIDGE_TIMEOUT'||code==='CONNECTION_FAILED'
  ?'缩略图 worker 请求结果未确认；请使用原身份查询或显式取消，不重发渲染或更换任务。'
  :'缩略图 worker 请求或响应未通过固定协议与安全边界核验；未自动重试或操作其他实例。');this.name='ThumbnailWorkerClientError';}
}
const fail=(code='worker_invalid_response'):never=>{throw new ThumbnailWorkerClientError(code);};
const record=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:RecordValue,expected:readonly string[])=>Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const integer=(value:unknown,min:number,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>=min&&Number(value)<=max;
const safeText=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value);
const terminal=(state:ThumbnailWorkerJobState)=>['done','failed','cancelled'].includes(state);
const safeCode=(value:unknown)=>typeof value==='string'&&REMOTE_CODES.has(value)?value:'worker_remote_error';
function bind(value:ThumbnailWorkerJobInput):BoundJob {
 if(!record(value)||Object.keys(value).some(key=>!['jobId','file','expectedSha256','width','height'].includes(key))
  ||typeof value.jobId!=='string'||!UUID.test(value.jobId)||!safeText(value.file,4096)||!path.isAbsolute(value.file)||value.file!==value.file.trim()
  ||typeof value.expectedSha256!=='string'||!HASH.test(value.expectedSha256))return fail('worker_invalid_argument');
 const width=value.width??512,height=value.height??512;
 if(!integer(width,1,1024)||!integer(height,1,1024)||width*height>1048576)return fail('worker_invalid_argument');
 return {jobId:value.jobId,file:value.file,expectedSha256:value.expectedSha256,width,height};
}
const sameBinding=(left:BoundJob,right:BoundJob)=>left.jobId===right.jobId&&left.file===right.file&&left.expectedSha256===right.expectedSha256&&left.width===right.width&&left.height===right.height;
function workerStatus(value:unknown,identity:Identity):ThumbnailWorkerStatus {
 if(!record(value)||!keys(value,['schema_version','worker_id','session_id','state','active_job_id','saves_cad','render_profile','supported_file_scope','jobs_retained','max_jobs','max_input_bytes','max_png_bytes','dimensions'])
  ||value.schema_version!==1||value.worker_id!==identity.workerId||value.session_id!==identity.sessionId
  ||!['ready','busy','quarantined','stopped'].includes(String(value.state))
  ||value.active_job_id!==null&&(typeof value.active_job_id!=='string'||!UUID.test(value.active_job_id))
  ||value.state==='busy'&&value.active_job_id===null||['ready','stopped'].includes(String(value.state))&&value.active_job_id!==null
  ||value.saves_cad!==false||value.render_profile!==PROFILE||value.supported_file_scope!=='trusted-native-self-contained'
  ||value.jobs_retained!==20||value.max_jobs!==256||value.max_input_bytes!==67108864||value.max_png_bytes!==MAX_PNG
  ||!record(value.dimensions)||!keys(value.dimensions,['max_width','max_height','max_pixels'])
  ||value.dimensions.max_width!==1024||value.dimensions.max_height!==1024||value.dimensions.max_pixels!==1048576)return fail();
 return structuredClone(value) as unknown as ThumbnailWorkerStatus;
}
function workerJob(value:unknown,identity:Identity,expected:BoundJob):ThumbnailWorkerJob {
 if(!record(value)||!keys(value,['schema_version','worker_id','session_id','job_id','state','phase','cancel_requested','input_revision','result','error'])
  ||value.schema_version!==1||value.worker_id!==identity.workerId||value.session_id!==identity.sessionId||value.job_id!==expected.jobId
  ||!STATES.includes(value.state as ThumbnailWorkerJobState)||value.phase!==value.state||typeof value.cancel_requested!=='boolean')return fail();
 const state=value.state as ThumbnailWorkerJobState;
 let revision:ThumbnailWorkerJob['input_revision']=null,result:ThumbnailWorkerImage|null=null,error:ThumbnailWorkerJob['error']=null;
 if(value.input_revision!==null){
  if(!record(value.input_revision)||!keys(value.input_revision,['sha256','bytes'])||value.input_revision.sha256!==expected.expectedSha256||!integer(value.input_revision.bytes,0,67108864))return fail();
  revision={sha256:expected.expectedSha256,bytes:value.input_revision.bytes};
 }
 if(value.error!==null){
  if(!record(value.error)||!keys(value.error,['code','message'])||typeof value.error.code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(value.error.code)||!safeText(value.error.message,512))return fail();
  error={code:safeCode(value.error.code),message:'缩略图 worker 报告任务未完成；请核对原任务状态。'};
 }
 if(value.result!==null){
  const image=value.result;
  if(state!=='done'||!record(image)||!keys(image,['png_base64','sha256','width','height','bytes','camera_restored','documents_closed','saved_cad','worker_reusable','render_profile'])
   ||typeof image.png_base64!=='string'||image.png_base64.length<4||image.png_base64.length>Math.ceil(MAX_PNG/3)*4
   ||image.png_base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/u.test(image.png_base64)
   ||typeof image.sha256!=='string'||!HASH.test(image.sha256)||image.width!==expected.width||image.height!==expected.height
   ||!integer(image.bytes,1,MAX_PNG)||image.camera_restored!==true||image.documents_closed!==true||image.saved_cad!==false||image.worker_reusable!==true||image.render_profile!==PROFILE)return fail();
  const bytes=Buffer.from(image.png_base64,'base64');
  if(bytes.toString('base64')!==image.png_base64)return fail();
  let png:Buffer;try{png=validateWorkerPng(bytes,{width:expected.width,height:expected.height,sha256:image.sha256,bytes:image.bytes});}catch{return fail();}
  result={png,sha256:image.sha256,width:expected.width,height:expected.height,bytes:image.bytes,camera_restored:true,documents_closed:true,saved_cad:false,worker_reusable:true,render_profile:PROFILE};
 }
 if(state==='done'&&(!result||!revision||error)||state!=='done'&&result||state==='failed'&&!error||!['failed','cancelled'].includes(state)&&error)return fail();
 return {schema_version:1,worker_id:identity.workerId,session_id:identity.sessionId,job_id:expected.jobId,state,phase:state,cancel_requested:value.cancel_requested,input_revision:revision,result,error};
}
function resultData(value:unknown):unknown {
 if(!record(value)||Object.keys(value).some(key=>!['content','structuredContent','isError','_meta'].includes(key))
  ||!Array.isArray(value.content)||value.content.length!==1||!record(value.content[0])||!keys(value.content[0],['type','text'])
  ||value.content[0].type!=='text'||typeof value.content[0].text!=='string'||Buffer.byteLength(value.content[0].text)>16*1024
  ||!record(value.structuredContent))return fail();
 // Text is a summary, not a second authoritative payload or a second PNG.
 let summary:unknown;try{summary=JSON.parse(value.content[0].text);}catch{return fail();}
 const inspect=(item:unknown,depth=0):void=>{
  if(depth>12)return fail();
  if(Array.isArray(item)){for(const child of item)inspect(child,depth+1);}
  else if(record(item))for(const [key,child] of Object.entries(item)){
   if(key==='png_base64'&&child!=='[available in structuredContent]')return fail();inspect(child,depth+1);
  }
 };inspect(summary);
 const body=value.structuredContent;
 if(value.isError===true){
  if(!keys(body,['ok','error'])||body.ok!==false||!record(body.error)||!keys(body.error,['code','message'])
   ||typeof body.error.code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(body.error.code)||!safeText(body.error.message,512))return fail();
  return fail(safeCode(body.error.code));
 }
 if(value.isError!==undefined&&value.isError!==false||!keys(body,['ok','source_kind','data'])||body.ok!==true||body.source_kind!=='isolated_thumbnail_worker')return fail();
 return body.data;
}
function validateTools(value:unknown):void {
 if(!record(value)||Object.keys(value).some(key=>!['tools','_meta'].includes(key))||!Array.isArray(value.tools)||value.tools.length!==4)return fail('worker_incompatible_tools');
 const names=new Set<string>();
 for(const tool of value.tools){
  if(!record(tool)||typeof tool.name!=='string'||!(TOOLS as readonly string[]).includes(tool.name)||names.has(tool.name)
   ||!record(tool.inputSchema)||tool.inputSchema.type!=='object'||tool.inputSchema.additionalProperties!==false||!record(tool.inputSchema.properties)||!record(tool.annotations))return fail('worker_incompatible_tools');
  names.add(tool.name);
  const status=tool.name===TOOLS[0],render=tool.name===TOOLS[1],read=status||tool.name===TOOLS[2];
  const fields=status?[]:render?['workerId','sessionId','jobId','file','expectedSha256','width','height']:['workerId','sessionId','jobId'];
  const required=status?[]:render?['workerId','sessionId','jobId','file','expectedSha256']:['workerId','sessionId','jobId'];
  if(!keys(tool.inputSchema.properties,fields)||tool.annotations.readOnlyHint!==read||tool.annotations.destructiveHint!==false||tool.annotations.idempotentHint!==true||tool.annotations.openWorldHint!==false)return fail('worker_incompatible_tools');
  const actualRequired=tool.inputSchema.required??[];
  if(!Array.isArray(actualRequired)||actualRequired.length!==required.length||new Set(actualRequired).size!==required.length||required.some(key=>!actualRequired.includes(key)))return fail('worker_incompatible_tools');
  for(const field of fields){
   const schema=tool.inputSchema.properties[field];
   if(!record(schema)||schema.type!==(['width','height'].includes(field)?'integer':'string'))return fail('worker_incompatible_tools');
   if(['width','height'].includes(field)&&(schema.minimum!==1||schema.maximum!==1024||schema.default!==512))return fail('worker_incompatible_tools');
   if(['workerId','sessionId','jobId'].includes(field)&&schema.pattern!==UUID_SCHEMA||field==='expectedSha256'&&schema.pattern!==HASH.source
    ||field==='file'&&(schema.minLength!==1||schema.maxLength!==4096))return fail('worker_incompatible_tools');
  }
 }
}

/** Own no processes: the caller retains its resource lease and actual-close policy. */
export async function connectThumbnailWorkerClient(input:Input):Promise<ThumbnailWorkerClient> {
 if(!record(input.identity)||!keys(input.identity,['workerId','sessionId'])||typeof input.identity.workerId!=='string'||typeof input.identity.sessionId!=='string'||!UUID.test(input.identity.workerId)||!UUID.test(input.identity.sessionId)
  ||!integer(input.timeout_ms??10000,100,30000))return fail('worker_invalid_argument');
 const identity={...input.identity},timeout=input.timeout_ms??10000,child=input.process.child;
 let fatal:ThumbnailWorkerClientError|undefined,buffer=Buffer.alloc(0),stderrBytes=0,messages=0,nextId=0,calling=false;
 let pending:{id:number;resolve(value:unknown):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}|undefined;
 const late=new Set<number>();
 const poison=(code:string)=>{fatal??=new ThumbnailWorkerClientError(code);if(pending){const old=pending;pending=undefined;clearTimeout(old.timer);old.reject(fatal);}};
 const onClose=()=>{poison('worker_closed');input.signal?.removeEventListener('abort',onAbort);};
 const onAbort=()=>poison('worker_cancelled');
 child.once('close',onClose);input.process.closed.then(onClose,()=>poison('worker_closed'));
 child.on('error',()=>poison('worker_transport_failed'));
 child.stdin.on('error',()=>poison('worker_transport_failed'));child.stdout.on('error',()=>poison('worker_transport_failed'));child.stderr.on('error',()=>poison('worker_transport_failed'));
 child.stderr.on('data',(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>MAX_STDERR)poison('worker_output_budget');});
 child.stdout.on('data',(chunk:Buffer)=>{
  if(fatal)return;
  try{
   let start=0,end:number;
   while((end=chunk.indexOf(10,start))!==-1){
    if(buffer.length+end-start>MAX_MESSAGE||++messages>MAX_MESSAGES)return poison('worker_output_budget');
    const line=Buffer.concat([buffer,chunk.subarray(start,end)]);buffer=Buffer.alloc(0);start=end+1;
    const message:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));
    if(!record(message)||Object.keys(message).some(key=>!['jsonrpc','id','result','error'].includes(key))||message.jsonrpc!=='2.0'||!integer(message.id,1,8192)
     ||!Object.hasOwn(message,'result')||Object.hasOwn(message,'error')||!record(message.result))return poison('worker_invalid_response');
    if(late.delete(message.id))continue;
    if(!pending||pending.id!==message.id)return poison('worker_invalid_response');
    const old=pending;pending=undefined;clearTimeout(old.timer);old.resolve(message.result);
   }
   if(buffer.length+chunk.length-start>MAX_MESSAGE)return poison('worker_output_budget');
   buffer=Buffer.concat([buffer,chunk.subarray(start)]);
  }catch{poison('worker_invalid_response');}
 });
 input.signal?.addEventListener('abort',onAbort,{once:true});if(input.signal?.aborted)onAbort();
 const write=(message:unknown)=>{if(fatal)throw fatal;child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)poison('worker_transport_failed');});};
 const request=(method:string,params:RecordValue)=>new Promise<unknown>((resolve,reject)=>{
  if(fatal){reject(fatal);return;}if(pending){reject(new ThumbnailWorkerClientError('worker_rpc_busy'));return;}
  if(nextId>=8192||late.size>=512){poison('worker_request_budget');reject(fatal!);return;}
  const id=++nextId;
  const timer=setTimeout(()=>{if(pending?.id!==id)return;pending=undefined;late.add(id);reject(new ThumbnailWorkerClientError('worker_timeout'));},timeout);
  pending={id,resolve,reject,timer};
  try{write({jsonrpc:'2.0',id,method,params});}catch{poison('worker_transport_failed');}
 });
 const initialize=await request('initialize',{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:'phoenix-desk-thumbnail-worker',version:'1.0.0'}});
 if(!record(initialize)||initialize.protocolVersion!==PROTOCOL||!record(initialize.serverInfo)||initialize.serverInfo.name!=='phoenix-freecad-mcp'||initialize.serverInfo.version!==VERSION
  ||!record(initialize.capabilities)||!record(initialize.capabilities.tools)||Object.keys(initialize.capabilities).some(key=>key!=='tools'))return fail('worker_incompatible_protocol');
 write({jsonrpc:'2.0',method:'notifications/initialized'});validateTools(await request('tools/list',{}));
 if(fatal)throw fatal;if(buffer.length)return fail('worker_invalid_response');
 // Retain bindings/proofs, never 256 copies of a 4 MiB image.
 const jobs=new Map<string,{input:BoundJob;state?:ThumbnailWorkerJobState;cancelRequested?:boolean;revision?:string;image?:string}>();
 let active:string|undefined,uncertain:string|undefined,workerState='unknown';
 const execute=async<T>(operation:()=>Promise<T>):Promise<T>=>{
  if(fatal)throw fatal;if(calling)return fail('worker_rpc_busy');calling=true;
  try{const result=await operation();if(buffer.length)poison('worker_invalid_response');if(fatal)throw fatal;return result;}finally{calling=false;}
 };
 const call=async(name:typeof TOOLS[number],arguments_:RecordValue)=>{
  const result=await request('tools/call',{name,arguments:arguments_});if(fatal)throw fatal;return resultData(result);
 };
 const track=(expected:BoundJob)=>{
  const prior=jobs.get(expected.jobId);
  if(prior&&!sameBinding(prior.input,expected))return fail('worker_job_conflict');
  if((uncertain&&uncertain!==expected.jobId)||(active&&active!==expected.jobId))return fail('worker_query_original_job');
  if(!prior&&jobs.size>=256)return fail('worker_session_limit');
  return prior;
 };
 const observe=async(method:typeof TOOLS[number],expected:BoundJob)=>{
  try{
   const job=workerJob(await call(method,{...identity,jobId:expected.jobId,...(method===TOOLS[1]?{file:expected.file,expectedSha256:expected.expectedSha256,width:expected.width,height:expected.height}:{})}),identity,expected);
   const prior=jobs.get(expected.jobId),revision=job.input_revision?JSON.stringify(job.input_revision):undefined,image=job.result?JSON.stringify([job.result.sha256,job.result.width,job.result.height,job.result.bytes]):undefined;
   if(prior?.state&&(terminal(prior.state)&&job.state!==prior.state||!terminal(job.state)&&STATES.indexOf(job.state)<STATES.indexOf(prior.state))
    ||prior?.cancelRequested&&!job.cancel_requested||prior?.revision&&revision!==prior.revision||prior?.image&&image!==prior.image)return fail();
   jobs.set(expected.jobId,{input:expected,state:job.state,cancelRequested:job.cancel_requested,revision,image});
   if(terminal(job.state)){if(active===expected.jobId)active=undefined;if(uncertain===expected.jobId)uncertain=undefined;workerState=job.state==='done'?'ready':'unknown';}
   else active=expected.jobId;
   return job;
  }catch(error){uncertain=expected.jobId;active=expected.jobId;if(!(error instanceof ThumbnailWorkerClientError)||['worker_invalid_response','INVALID_RESPONSE'].includes(error.code))poison('worker_invalid_response');throw error instanceof ThumbnailWorkerClientError?error:new ThumbnailWorkerClientError('worker_invalid_response');}
 };
 return {
  status:()=>execute(async()=>{try{const result=workerStatus(await call(TOOLS[0],{}),identity);workerState=result.state;return result;}catch(error){workerState='unknown';if(error instanceof ThumbnailWorkerClientError&&error.code==='worker_invalid_response')poison(error.code);throw error;}}),
  render:value=>execute(async()=>{
   const expected=bind(value),prior=track(expected);
   if(uncertain)return fail('worker_query_original_job');
   if(prior)return fail('worker_render_not_replayed');
   if(active||workerState!=='ready')return fail('worker_not_ready');
   if(jobs.size>=256)return fail('worker_session_limit');
   jobs.set(expected.jobId,{input:expected});return observe(TOOLS[1],expected);
  }),
  get:value=>execute(async()=>{const expected=bind(value);track(expected);return observe(TOOLS[2],expected);}),
  cancel:value=>execute(async()=>{const expected=bind(value);track(expected);return observe(TOOLS[3],expected);}),
 };
}
