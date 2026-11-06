import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ChildProcess,ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {acquireDrawingExecution} from '../drawing-research/executionGate.js';
import {checkedBytes,checkedDirectory,withFrozenResource,type PinnedResource} from './resource.js';
import {runtimeRepoRoot} from '../../lib/appRuntimePaths.js';
import {connectThumbnailWorkerClient,type OwnedWorkerMcpProcess,type ThumbnailWorkerClient} from './worker-client.js';

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const DEV_OWNER='phoenix-freecad-tools-development';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const present=(filename:string)=>{try{fs.lstatSync(filename);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
const fail=(code:string):never=>{throw new OwnedThumbnailWorkerError(code);};
export class OwnedThumbnailWorkerError extends Error {
 constructor(readonly code:string){super('独立开发缩略图实例未能安全完成：'+code+'；不会接管未知实例、重放任务或更换门禁范围');this.name='OwnedThumbnailWorkerError';}
}
export interface OwnedThumbnailWorkerInput {
 resource:PinnedResource;
 /** Host-selected, previously absent path under an owned 0700 directory; never an HTTP field. */
 profile:string;
 /** Exact resolved GUI binary, not a shell/CLI/app launcher. */
 executable:string;
 forbidden_roots?:readonly string[];
 signal?:AbortSignal;
 startup_timeout_ms?:number;
 client_timeout_ms?:number;
}
export interface OwnedThumbnailWorkerIdentity {workerId:string;sessionId:string;nativePid:number;url:string}
export interface OwnedThumbnailWorkerSession {identity:OwnedThumbnailWorkerIdentity;client:ThumbnailWorkerClient;signal:AbortSignal}
/** Host construction/test seams only, never request data. Neither child launch
 * nor the fixed shared Native barrier can be replaced through these hooks. */
export interface OwnedThumbnailWorkerHost {
 platform?:NodeJS.Platform;
 loadLauncher?:(filename:string)=>Promise<unknown>;
 /** Observation only: this callback cannot supply or replace a close proof. */
 onChildClose?:(kind:'native'|'mcp',proof:{pid:number|null;exitCode:number|null;signal:string|null})=>void;
}
type Prepared={launch:Record<string,unknown>;environment:Record<string,unknown>};
const inside=(root:string,candidate:string)=>{const relative=path.relative(root,candidate);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
function privateDirectory(directory:string):string {
 const root=checkedDirectory(directory),stat=fs.lstatSync(root);
 if(typeof process.getuid!=='function'||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700)return fail('unsafe_profile');return root;
}
function privateJson(filename:string,maximum=16*1024):Record<string,unknown> {
 const stat=fs.lstatSync(filename);
 if(typeof process.getuid!=='function'||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)return fail('unsafe_receipt');
 const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(checkedBytes(filename,maximum)));
 if(!record(data))return fail('invalid_receipt');return data;
}
function exact(value:Record<string,unknown>,expected:Record<string,unknown>):boolean {
 return Object.keys(value).length===Object.keys(expected).length&&Object.entries(expected).every(([key,item])=>value[key]===item);
}
function argumentsFor(profile:string,ownerId:string):string[] {
 return ['--set-config','ExeVendor=org.phoenix.freecadtools.development.'+ownerId.replaceAll('-',''),'ExeName=PhoenixFreeCADDevelopment',
  '--user-cfg',path.join(profile,'config/user.cfg'),'--system-cfg',path.join(profile,'config/system.cfg'),path.join(profile,'thumbnail-worker.FCMacro')];
}
const BASE_ENV=['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','TZ','TMPDIR','DISPLAY'];
function guiEnvironment(prepared:Prepared,profile:string,ownerId:string,workerId:string,sessionId:string):NodeJS.ProcessEnv {
 const fixed:Record<string,string>={FREECAD_USER_HOME:profile,FREECAD_USER_DATA:profile,FREECAD_USER_TEMP:path.join(profile,'temp'),PFT_DEVELOPMENT:'1',PFT_DEVELOPMENT_PORT:'9877',
  PFT_DEVELOPMENT_PROFILE:profile,PFT_DEVELOPMENT_RECEIPT:String(prepared.launch.readiness_receipt),PFT_DEVELOPMENT_OWNER_ID:ownerId,PYTHONDONTWRITEBYTECODE:'1',
  PFT_THUMBNAIL_WORKER_ID:workerId,PFT_THUMBNAIL_WORKER_SESSION:sessionId};
 if(Object.keys(prepared.environment).some(key=>!BASE_ENV.includes(key)&&!Object.hasOwn(fixed,key))||Object.entries(fixed).some(([key,value])=>prepared.environment[key]!==value))return fail('unsafe_environment');
 const environment:NodeJS.ProcessEnv={...fixed};for(const key of BASE_ENV){const value=prepared.environment[key];if(value!==undefined){if(typeof value!=='string'||value.length>8192||value.includes('\0'))return fail('unsafe_environment');environment[key]=value;}}
 return environment;
}
function mcpEnvironment(url:string):NodeJS.ProcessEnv {
 const result:NodeJS.ProcessEnv={PHOENIX_FREECAD_URL:url,PHOENIX_FREECAD_SCOPE:'worker',PHOENIX_TIMEOUT_MS:'5000'};
 for(const key of ['HOME','USERPROFILE','SYSTEMROOT','WINDIR','LOCALAPPDATA','APPDATA','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE','TZ']){const value=process.env[key];if(value!==undefined&&value.length<=8192&&!value.includes('\0'))result[key]=value;}
 return result;
}
type OwnedProcess=OwnedWorkerMcpProcess&{isClosed():boolean};
/** No timeout is accepted as a close proof: after escalation, keep this promise
 * and its resource/barrier alive until the exact ChildProcess emits close. */
function own(child:ChildProcess,stdio=false,onClose?:(proof:{pid:number|null;exitCode:number|null;signal:string|null})=>void):OwnedProcess {
 let closed=false,closing:Promise<void>|undefined,resolve!:()=>void;
 const didClose=new Promise<void>(done=>{resolve=done;});
 child.once('close',(exitCode:number|null,signal:NodeJS.Signals|null)=>{
  closed=true;
  try{void Promise.resolve(onClose?.({pid:Number.isSafeInteger(child.pid)&&Number(child.pid)>0?Number(child.pid):null,exitCode,signal})).catch(()=>{});}catch{/* Observation must not prevent owned cleanup. */}
  resolve();
 });child.on('error',()=>{/* Actual close, not error/exit, releases ownership. */});
 const wait=async(ms:number)=>{if(closed)return;let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([didClose,new Promise<void>(done=>{timer=setTimeout(done,ms);})]);if(timer)clearTimeout(timer);};
 return {child:child as ChildProcessWithoutNullStreams,closed:didClose,isClosed:()=>closed,close(){return closing??=(async()=>{
  if(stdio)try{child.stdin?.end();}catch{/* Reap the same child below. */}
  if(stdio)await wait(100);
  if(!closed){try{child.kill('SIGTERM');}catch{/* Wait for the actual observer. */}await wait(500);}
  if(!closed){try{child.kill('SIGKILL');}catch{/* Never infer exit from a kill return value. */}}
  await didClose;
 })();}};
}
async function waitSpawn(child:ChildProcess,owned:OwnedProcess,signal:AbortSignal):Promise<number> {
 if(signal.aborted)return fail('cancelled_before_spawn');
 return await new Promise<number>((resolve,reject)=>{
  const clear=()=>{child.off('spawn',spawned);child.off('error',error);signal.removeEventListener('abort',abort);};
  const spawned=()=>{clear();if(!Number.isSafeInteger(child.pid)||Number(child.pid)<1)reject(new OwnedThumbnailWorkerError('invalid_native_pid'));else resolve(Number(child.pid));};
  const error=()=>{clear();reject(new OwnedThumbnailWorkerError('spawn_failed'));};
  const abort=()=>{clear();reject(new OwnedThumbnailWorkerError('cancelled_during_spawn'));};
  child.once('spawn',spawned);child.once('error',error);signal.addEventListener('abort',abort,{once:true});
  if(owned.isClosed()){clear();reject(new OwnedThumbnailWorkerError('closed_before_spawn'));}
 });
}
async function readiness(filename:string,expected:{workerId:string;sessionId:string;nativePid:number},owned:OwnedProcess,signal:AbortSignal,timeout:number):Promise<string> {
 const deadline=Date.now()+timeout;
 while(true){
  if(signal.aborted)return fail('startup_cancelled');if(owned.isClosed())return fail('native_closed_before_ready');
  if(present(filename)){
   const value=privateJson(filename,4096),url=value.url;
   const address=typeof url==='string'?/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/$/.exec(url):null;
   if(!address||Number(address[1])>65535)return fail('invalid_ready_address');
   if(!exact(value,{schema_version:1,owner:'phoenix-thumbnail-worker',worker_id:expected.workerId,session_id:expected.sessionId,pid:expected.nativePid,protocol_version:1,addon_version:'0.3.2',url,ready:true}))return fail('ready_identity_mismatch');
   return url as string;
  }
  if(Date.now()>=deadline)return fail('startup_timeout');await new Promise<void>(resolve=>setTimeout(resolve,20));
 }
}

/** Host-only macOS candidate primitive. The settings wrapper requires a
 * separate explicit test gate; no automatic queue, installed launcher or user
 * Mod is used. One fixed host Native reservation covers BOTH actual children. */
export async function withOwnedThumbnailWorker<T>(input:OwnedThumbnailWorkerInput,operation:(session:OwnedThumbnailWorkerSession)=>Promise<T>,host:OwnedThumbnailWorkerHost={}):Promise<T> {
 if((host.platform??process.platform)!=='darwin')return fail('unsupported_platform');
 const startupTimeout=input.startup_timeout_ms??120_000,clientTimeout=input.client_timeout_ms??10_000;
 if(!Number.isSafeInteger(startupTimeout)||startupTimeout<100||startupTimeout>120_000||!Number.isSafeInteger(clientTimeout)||clientTimeout<100||clientTimeout>30_000)return fail('invalid_deadline');
 if(input.signal?.aborted)return fail('cancelled_before_launch');
 if(!path.isAbsolute(input.profile)||path.resolve(input.profile)!==input.profile||present(input.profile))return fail('profile_already_exists_or_invalid');
 const profile=path.join(privateDirectory(path.dirname(input.profile)),path.basename(input.profile));
 if([runtimeRepoRoot(),input.resource.root,...(input.forbidden_roots??[])].some(root=>inside(path.resolve(root),profile)))return fail('profile_inside_source_or_project');
 const executable=path.resolve(input.executable);checkedDirectory(path.dirname(executable));const executableStat=fs.lstatSync(executable);
 if(executable!==input.executable||!executableStat.isFile()||executableStat.isSymbolicLink()||executableStat.nlink!==1||/\/Contents\/MacOS\/FreeCAD$/i.test(executable))return fail('unsafe_gui_binary');fs.accessSync(executable,fs.constants.X_OK);
 const controller=new AbortController(),abort=()=>controller.abort();
 const lease=acquireDrawingExecution('thumbnail-worker:'+randomUUID());
 input.signal?.addEventListener('abort',abort,{once:true});
 try{
  lease.assertHealthy();
  return await withFrozenResource(input.resource,async frozen=>{
   let native:OwnedProcess|undefined,mcp:OwnedProcess|undefined;
   try{
    if(controller.signal.aborted)return fail('cancelled_before_prepare');
    if(input.resource.addonDir!=='addon/PhoenixFreeCADTools'||!frozen.mcpEntry||!input.resource.files['scripts/thumbnail-worker.mjs']||!input.resource.files['scripts/dev-freecad.mjs']||!input.resource.files['addon/PhoenixFreeCADTools/pft_thumbnail_worker.py'])return fail('worker_resource_missing');
    const filename=path.join(frozen.root,'scripts/thumbnail-worker.mjs');
    const module:unknown=await (host.loadLauncher??(async file=>await import(pathToFileURL(file).href)))(filename);
    if(!record(module)||typeof module.prepareThumbnailWorker!=='function')return fail('worker_launcher_missing');
    if(present(profile))return fail('profile_appeared_before_prepare');
    const prepared:unknown=module.prepareThumbnailWorker({profile,app:executable,repository:frozen.root});
    if(!record(prepared)||!record(prepared.launch)||!record(prepared.environment))return fail('invalid_prepared_launch');
    const launch=prepared.launch,worker=launch.worker;
    if(!record(worker)||typeof launch.owner_id!=='string'||!UUID.test(launch.owner_id)||typeof launch.launch_id!=='string'||!UUID.test(launch.launch_id)
     ||typeof worker.worker_id!=='string'||!UUID.test(worker.worker_id)||typeof worker.session_id!=='string'||!UUID.test(worker.session_id)
     ||launch.schema_version!==1||launch.owner!==DEV_OWNER||launch.source!==frozen.addonDir||launch.profile!==profile||launch.program!==executable||launch.cwd!==profile||launch.shell!==false||launch.prepared!==true||launch.launched!==false
     ||JSON.stringify(launch.args)!==JSON.stringify(argumentsFor(profile,launch.owner_id)))return fail('prepared_identity_mismatch');
    const identityBase={workerId:worker.worker_id,sessionId:worker.session_id},ready=path.join(profile,'runtime','thumbnail-worker-'+worker.session_id+'.json');
    if(!exact(worker,{schema_version:1,worker_id:worker.worker_id,session_id:worker.session_id,readiness_receipt:ready,profile_scope:'owned-development-worker',port_policy:'os-assigned-loopback',saves_cad:false})
     ||launch.worker_launch_record!==path.join(profile,'runtime','thumbnail-launch-'+worker.session_id+'.json')||launch.readiness_receipt!==path.join(profile,'runtime','readiness-'+launch.launch_id+'.json')
     ||launch.process_record!==path.join(profile,'runtime','instance.json'))return fail('prepared_path_mismatch');
    for(const relative of ['', 'Mod','temp','runtime','config','config/qt','config/qt-system'])privateDirectory(path.join(profile,relative));
    if(!exact(privateJson(path.join(profile,'.phoenix-thumbnail-worker.json'),4096),{schema_version:1,owner:'phoenix-thumbnail-worker',development_owner_id:launch.owner_id,source:frozen.addonDir,worker_id:worker.worker_id}))return fail('worker_marker_mismatch');
    const development=privateJson(path.join(profile,'.phoenix-development-profile.json'),4096);
    if(!exact(development,{schema_version:1,owner:DEV_OWNER,uid:process.getuid!(),owner_id:launch.owner_id,repository:frozen.root,source:frozen.addonDir}))return fail('development_marker_mismatch');
    if(JSON.stringify(privateJson(String(launch.worker_launch_record)))!==JSON.stringify(launch)||present(ready)||present(String(launch.process_record))||present(path.join(profile,'runtime','launch.lock'))||present(path.join(profile,'runtime','thumbnail-worker.lock'))||present(path.join(profile,'runtime','thumbnail-input')))return fail('profile_runtime_not_fresh');
    const addonLink=path.join(profile,'Mod','PhoenixFreeCADTools');if(!fs.lstatSync(addonLink).isSymbolicLink()||fs.realpathSync(addonLink)!==frozen.addonDir)return fail('profile_addon_mismatch');
    const environment=guiEnvironment(prepared as Prepared,profile,launch.owner_id,worker.worker_id,worker.session_id);
    fs.writeFileSync(path.join(profile,'.desk-thumbnail-worker-owner.json'),JSON.stringify({schema_version:1,owner:'phoenix-desk-thumbnail-worker-development',resource_digest:input.resource.digest,owner_id:launch.owner_id,...identityBase})+'\n',{flag:'wx',mode:0o600});
    lease.assertHealthy();if(controller.signal.aborted)return fail('cancelled_before_native');
    const nativeChild=lease.spawn(executable,launch.args as string[],{cwd:profile,env:environment,shell:false,detached:false,stdio:['ignore','pipe','pipe']});native=own(nativeChild,false,proof=>host.onChildClose?.('native',proof));
    let output=0;for(const stream of [nativeChild.stdout,nativeChild.stderr]){
     stream?.on('error',()=>controller.abort());
     stream?.on('data',(chunk:Uint8Array)=>{output+=chunk.length;if(output>256*1024)controller.abort();});
    }
    native.closed.then(()=>controller.abort());
    const pid=await waitSpawn(nativeChild,native,controller.signal);lease.assertHealthy();
    fs.writeFileSync(String(launch.process_record),JSON.stringify({owner:DEV_OWNER,owner_id:launch.owner_id,source:frozen.addonDir,launch_id:launch.launch_id,pid,program:executable,started_at:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
    const url=await readiness(ready,{...identityBase,nativePid:pid},native,controller.signal,startupTimeout);lease.assertHealthy();
    if(controller.signal.aborted)return fail('cancelled_before_mcp');
    const child=lease.spawn(process.execPath,[frozen.mcpEntry],{cwd:path.dirname(frozen.mcpEntry),env:mcpEnvironment(url),shell:false,detached:false,stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;
    mcp=own(child,true,proof=>host.onChildClose?.('mcp',proof));mcp.closed.then(()=>controller.abort());
    const client=await connectThumbnailWorkerClient({process:mcp,identity:identityBase,timeout_ms:clientTimeout,signal:controller.signal});
    const status:unknown=await client.status();if(!record(status)||status.worker_id!==identityBase.workerId||status.session_id!==identityBase.sessionId||status.state!=='ready'||controller.signal.aborted)return fail('worker_not_ready');
    lease.assertHealthy();return await operation({identity:{...identityBase,nativePid:pid,url},client,signal:controller.signal});
   }finally{
    // A child that ignores signals retains the resource and existing barrier;
    // no timeout, PID check or new profile is a substitute for actual close.
    await mcp?.close();await native?.close();
   }
  });
 }finally{input.signal?.removeEventListener('abort',abort);try{lease();}finally{controller.abort();}}
}
