import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcess,SpawnOptions} from 'node:child_process';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({acquire:vi.fn(),configure:vi.fn(),spawn:vi.fn(),release:vi.fn(),healthy:vi.fn(),connect:vi.fn(),status:vi.fn()}));
vi.mock('../drawing-research/executionGate.js',()=>({acquireDrawingExecution:mocks.acquire,configureDrawingExecutionBarrier:mocks.configure}));
vi.mock('./worker-client.js',()=>({connectThumbnailWorkerClient:mocks.connect}));
import {loadPinnedResource,type PinnedResource} from './resource.js';
import {withOwnedThumbnailWorker,type OwnedThumbnailWorkerHost,type OwnedThumbnailWorkerInput} from './worker-session.js';

// Independent opaque resources and simulated ChildProcess objects only. No
// FreeCAD, GUI, shell, process adoption, real gate or CAD document is used.
const ids={owner:'11111111-1111-4111-8111-111111111111',launch:'22222222-2222-4222-8222-222222222222',worker:'33333333-3333-4333-8333-333333333333',session:'44444444-4444-4444-8444-444444444444'};
const devOwner='phoenix-freecad-tools-development';
const url='http://127.0.0.1:32109/';
const roots:string[]=[];
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const json=(filename:string,value:unknown)=>fs.writeFileSync(filename,JSON.stringify(value)+'\n',{mode:0o600});
type Prepared={launch:Record<string,any>;environment:Record<string,string>};
type FakeChild=ChildProcess&{finish:(code?:number)=>void;stdout:PassThrough;stderr:PassThrough;stdin:PassThrough;autoClose:boolean};
type Fixture={input:OwnedThumbnailWorkerInput;host:OwnedThumbnailWorkerHost;frozenRoot:string;prepared?:Prepared;mutate?:(prepared:Prepared)=>void;afterPrepare?:()=>void;ready?:(receipt:Record<string,unknown>)=>void;writeReady:boolean;children:FakeChild[];events:string[]};
let current:Fixture;

function fakeChild(name:string,pid:number):FakeChild {
 let closed=false;
 const child=Object.assign(new EventEmitter(),{pid,stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),autoClose:true,
  finish(code=0){if(closed)return;closed=true;current.events.push(name+':close');child.emit('close',code,null);},
  kill:vi.fn((signal:string)=>{current.events.push(name+':'+signal);if(child.autoClose)queueMicrotask(()=>child.finish());return false;})});
 child.stdin.on('finish',()=>{current.events.push(name+':stdin-end');if(child.autoClose)queueMicrotask(()=>child.finish());});
 return child as unknown as FakeChild;
}
function fixture():Fixture {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-worker-session-test-')));fs.chmodSync(root,0o700);roots.push(root);
 const source=path.join(root,'resource');fs.mkdirSync(source,{mode:0o700});
 const contents:Record<string,string>={
  'addon/PhoenixFreeCADTools/InitGui.py':'# Independent synthetic addon\n',
  'addon/PhoenixFreeCADTools/package.xml':'<package><version>0.3.2</version></package>',
  'addon/PhoenixFreeCADTools/LICENSE':'Independent synthetic license',
  'addon/PhoenixFreeCADTools/NOTICE':'Independent synthetic attribution',
  'addon/PhoenixFreeCADTools/README.md':'Independent synthetic notes',
  'addon/PhoenixFreeCADTools/pft_thumbnail_worker.py':'# Never executed\n',
  'scripts/install-addon.mjs':'export const synthetic=true;',
  'scripts/thumbnail-worker.mjs':'export const synthetic=true;',
  'scripts/dev-freecad.mjs':'export const synthetic=true;',
  'dist/server.mjs':'export const synthetic=true;',
 };
 const files:Record<string,string>={};for(const [relative,bytes]of Object.entries(contents)){const target=path.join(source,relative);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{mode:0o600});files[relative]=sha(bytes);}
 const manifestPath=path.join(source,'release.json');const manifest=JSON.stringify({schema_version:1,plugin_version:'0.3.2',addon_dir:'addon/PhoenixFreeCADTools',installer_entry:'scripts/install-addon.mjs',mcp_entry:'dist/server.mjs',files});fs.writeFileSync(manifestPath,manifest);
 const loaded=loadPinnedResource({PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST:manifestPath,PHOENIX_FREECAD_MCP_RESOURCE_SHA256:sha(manifest)});if(loaded.state!=='ready')throw new Error('synthetic resource invalid');
 const executable=path.join(root,'synthetic-freecad');fs.writeFileSync(executable,'not an executable program',{mode:0o700});
 const input:OwnedThumbnailWorkerInput={resource:loaded.resource,profile:path.join(root,'profile'),executable,startup_timeout_ms:100,client_timeout_ms:100};
 const f:Fixture={input,host:{platform:'darwin'},frozenRoot:'',writeReady:true,children:[],events:[]};
 f.host.loadLauncher=async filename=>{
  f.frozenRoot=path.dirname(path.dirname(filename));
  expect(filename).toBe(path.join(f.frozenRoot,'scripts/thumbnail-worker.mjs'));
  return {prepareThumbnailWorker:({profile,app,repository}:{profile:string;app:string;repository:string})=>{
   expect(profile).toBe(input.profile);expect(app).toBe(executable);expect(repository).toBe(f.frozenRoot);
   for(const relative of ['', 'Mod','temp','runtime','config','config/qt','config/qt-system'])fs.mkdirSync(path.join(profile,relative),{mode:0o700});
   const source=path.join(repository,'addon/PhoenixFreeCADTools');fs.symlinkSync(source,path.join(profile,'Mod/PhoenixFreeCADTools'));
   const ready=path.join(profile,'runtime','readiness-'+ids.launch+'.json');
   const launch:Prepared['launch']={schema_version:1,owner:devOwner,owner_id:ids.owner,launch_id:ids.launch,source,profile,program:app,cwd:profile,shell:false,prepared:true,launched:false,
    args:['--set-config','ExeVendor=org.phoenix.freecadtools.development.'+ids.owner.replaceAll('-',''),'ExeName=PhoenixFreeCADDevelopment','--user-cfg',path.join(profile,'config/user.cfg'),'--system-cfg',path.join(profile,'config/system.cfg'),path.join(profile,'thumbnail-worker.FCMacro')],
    worker:{schema_version:1,worker_id:ids.worker,session_id:ids.session,readiness_receipt:path.join(profile,'runtime','thumbnail-worker-'+ids.session+'.json'),profile_scope:'owned-development-worker',port_policy:'os-assigned-loopback',saves_cad:false},
    worker_launch_record:path.join(profile,'runtime','thumbnail-launch-'+ids.session+'.json'),readiness_receipt:ready,process_record:path.join(profile,'runtime/instance.json')};
   const environment={FREECAD_USER_HOME:profile,FREECAD_USER_DATA:profile,FREECAD_USER_TEMP:path.join(profile,'temp'),PFT_DEVELOPMENT:'1',PFT_DEVELOPMENT_PORT:'9877',PFT_DEVELOPMENT_PROFILE:profile,PFT_DEVELOPMENT_RECEIPT:ready,PFT_DEVELOPMENT_OWNER_ID:ids.owner,PYTHONDONTWRITEBYTECODE:'1',PFT_THUMBNAIL_WORKER_ID:ids.worker,PFT_THUMBNAIL_WORKER_SESSION:ids.session,HOME:os.homedir()};
   const prepared={launch,environment};f.prepared=prepared;
   const record=String(launch.worker_launch_record);f.mutate?.(prepared);
   json(path.join(profile,'.phoenix-thumbnail-worker.json'),{schema_version:1,owner:'phoenix-thumbnail-worker',development_owner_id:ids.owner,source,worker_id:ids.worker});
   json(path.join(profile,'.phoenix-development-profile.json'),{schema_version:1,owner:devOwner,uid:process.getuid!(),owner_id:ids.owner,repository,source});
   json(record,launch);f.afterPrepare?.();return prepared;
  }};
 };
 return f;
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
beforeEach(()=>{
 vi.resetAllMocks();current=fixture();
 mocks.acquire.mockReturnValue(Object.assign(mocks.release,{spawn:mocks.spawn,assertHealthy:mocks.healthy}));
 mocks.release.mockImplementation(()=>{current.events.push('lease:released');});
 mocks.status.mockResolvedValue({worker_id:ids.worker,session_id:ids.session,state:'ready'});
 mocks.connect.mockResolvedValue({status:mocks.status});
 mocks.spawn.mockImplementation((_command:string,_args:string[],_options:SpawnOptions)=>{
  const native=current.children.length===0,child=fakeChild(native?'native':'mcp',native?41001:41002);current.children.push(child);
  queueMicrotask(()=>{
   child.emit('spawn');
   if(native&&current.writeReady){const receipt={schema_version:1,owner:'phoenix-thumbnail-worker',worker_id:ids.worker,session_id:ids.session,pid:41001,protocol_version:1,addon_version:'0.3.2',url,ready:true};current.ready?.(receipt);json(String(current.prepared!.launch.worker.readiness_receipt),receipt);}
  });return child;
 });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const run=(operation:Parameters<typeof withOwnedThumbnailWorker>[1]=async()=>42)=>withOwnedThumbnailWorker(current.input,operation,current.host);

describe('owned thumbnail worker Host lifecycle without Native execution',()=>{
 it('uses one preconfigured shared lease, an explicit worker URL and only two owned children',async()=>{
  vi.stubEnv('NODE_OPTIONS','--require untrusted');vi.stubEnv('PHOENIX_FREECAD_SCOPE','full');vi.stubEnv('SYNTHETIC_SECRET','never-inherit');
  const kill=vi.spyOn(process,'kill');try{
   expect(await run(async session=>{expect(session.identity).toEqual({workerId:ids.worker,sessionId:ids.session,nativePid:41001,url});expect(session.signal.aborted).toBe(false);return 42;})).toBe(42);
   expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^thumbnail-worker:[a-f0-9-]{36}$/));expect(mocks.configure).not.toHaveBeenCalled();expect(mocks.spawn).toHaveBeenCalledTimes(2);
   const [program,args,native]=mocks.spawn.mock.calls[0];expect(program).toBe(current.input.executable);expect(args).toEqual(current.prepared!.launch.args);expect(native).toMatchObject({cwd:current.input.profile,shell:false,detached:false,stdio:['ignore','pipe','pipe']});
   const [node,mcpArgs,mcp]=mocks.spawn.mock.calls[1];expect(node).toBe(process.execPath);expect(mcpArgs).toEqual([path.join(current.frozenRoot,'dist/server.mjs')]);expect(mcp).toMatchObject({shell:false,detached:false,stdio:['pipe','pipe','pipe']});
   expect(mcp.env).toMatchObject({PHOENIX_FREECAD_URL:url,PHOENIX_FREECAD_SCOPE:'worker',PHOENIX_TIMEOUT_MS:'5000'});
   for(const env of [native.env,mcp.env])for(const key of ['NODE_OPTIONS','SYNTHETIC_SECRET','PHOENIX_WING_ROOT'])expect(env[key]).toBeUndefined();
   expect(native.env.PHOENIX_FREECAD_SCOPE).toBeUndefined();expect(mcp.env.PATH).toBeUndefined();expect(kill).not.toHaveBeenCalled();
   expect(current.events.indexOf('mcp:close')).toBeLessThan(current.events.indexOf('native:SIGTERM'));expect(current.events.at(-1)).toBe('lease:released');expect(fs.existsSync(current.frozenRoot)).toBe(false);
   expect(JSON.parse(fs.readFileSync(path.join(current.input.profile,'runtime/instance.json'),'utf8')).pid).toBe(41001);
  }finally{kill.mockRestore();}
 });

 it('retains frozen resource and the same lease through both actual closes, regardless of kill returns',async()=>{
  vi.useFakeTimers();let finished=false;
  const promise=run(async()=>{for(const child of current.children)child.autoClose=false;return 'done';}).then(value=>{finished=true;return value;});
  await flush();expect(current.children).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(600);expect(current.events).toContain('mcp:SIGKILL');expect(current.events).not.toContain('native:SIGTERM');expect(finished).toBe(false);expect(fs.existsSync(current.frozenRoot)).toBe(true);expect(mocks.release).not.toHaveBeenCalled();
  // Even exit is not a close proof (stdio may still be owned and open).
  current.children[1].emit('exit',0,null);await flush();expect(mocks.release).not.toHaveBeenCalled();
  current.children[1].finish();await flush();await vi.advanceTimersByTimeAsync(500);
  expect(current.events).toContain('native:SIGKILL');expect(fs.existsSync(current.frozenRoot)).toBe(true);expect(mocks.release).not.toHaveBeenCalled();expect(finished).toBe(false);
  current.children[0].finish();expect(await promise).toBe('done');expect(fs.existsSync(current.frozenRoot)).toBe(false);expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('cleans owned children in MCP-before-Native order after operation error',async()=>{
  await expect(run(async()=>{throw new Error('synthetic operation failure');})).rejects.toThrow('synthetic operation failure');
  expect(current.events.indexOf('mcp:close')).toBeLessThan(current.events.indexOf('native:SIGTERM'));expect(mocks.release).toHaveBeenCalledOnce();expect(fs.existsSync(current.frozenRoot)).toBe(false);
 });

 it('observes exact close events while resources remain held and ignores observer exceptions',async()=>{
  const proofs:unknown[]=[];current.host.onChildClose=(kind,proof)=>{proofs.push({kind,...proof,resourceAlive:fs.existsSync(current.frozenRoot),leaseHeld:mocks.release.mock.calls.length===0});throw new Error('synthetic observer error');};
  expect(await run()).toBe(42);
  expect(proofs).toEqual([{kind:'mcp',pid:41002,exitCode:0,signal:null,resourceAlive:true,leaseHeld:true},{kind:'native',pid:41001,exitCode:0,signal:null,resourceAlive:true,leaseHeld:true}]);expect(mocks.release).toHaveBeenCalledOnce();
 });
 it('also isolates an accidentally asynchronous close observer rejection',async()=>{
  current.host.onChildClose=async()=>{throw new Error('synthetic async observer rejection');};expect(await run()).toBe(42);expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('cleans both children if the MCP connection fails instead of retrying or spawning another',async()=>{
  mocks.connect.mockRejectedValue(new Error('synthetic connection failure'));await expect(run()).rejects.toThrow('synthetic connection failure');
  expect(mocks.spawn).toHaveBeenCalledTimes(2);expect(current.events.indexOf('mcp:close')).toBeLessThan(current.events.indexOf('native:SIGTERM'));expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('keeps ownership after kill throws and still requires the same two actual closes',async()=>{
  vi.useFakeTimers();const promise=run(async()=>{for(const child of current.children){child.autoClose=false;vi.mocked(child.kill).mockImplementation(()=>{throw new Error('synthetic kill failure');});}});
  await flush();await vi.advanceTimersByTimeAsync(600);expect(mocks.release).not.toHaveBeenCalled();expect(fs.existsSync(current.frozenRoot)).toBe(true);
  current.children[1].finish();await flush();await vi.advanceTimersByTimeAsync(500);expect(mocks.release).not.toHaveBeenCalled();current.children[0].finish();await promise;expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('treats a naturally closed Native child as cancellation, without killing a replacement PID',async()=>{
  const promise=run(async session=>{await new Promise<void>(resolve=>session.signal.addEventListener('abort',()=>resolve(),{once:true}));});await flush();current.children[0].finish(1);await promise;
  expect(current.children[0].kill).not.toHaveBeenCalled();expect(mocks.spawn).toHaveBeenCalledTimes(2);expect(current.events).toContain('mcp:close');expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('propagates cancellation but does not return or release on termination signals alone',async()=>{
  vi.useFakeTimers();const cancellation=new AbortController();current.input.signal=cancellation.signal;let observed=false;
  const promise=run(async session=>{for(const child of current.children)child.autoClose=false;await new Promise<void>(resolve=>session.signal.addEventListener('abort',()=>{observed=true;resolve();},{once:true}));}).catch(error=>error);
  await flush();cancellation.abort();await flush();await vi.advanceTimersByTimeAsync(600);expect(observed).toBe(true);expect(mocks.release).not.toHaveBeenCalled();expect(fs.existsSync(current.frozenRoot)).toBe(true);
  current.children[1].finish();await flush();await vi.advanceTimersByTimeAsync(500);expect(mocks.release).not.toHaveBeenCalled();current.children[0].finish();await promise;expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('cancels during readiness and closes only the exact Native child',async()=>{
  vi.useFakeTimers();current.writeReady=false;const controller=new AbortController();current.input.signal=controller.signal;
  const promise=run().catch(error=>error);await flush();current.children[0].autoClose=false;controller.abort();await vi.advanceTimersByTimeAsync(520);
  expect(current.children).toHaveLength(1);expect(mocks.release).not.toHaveBeenCalled();current.children[0].finish();expect(await promise).toMatchObject({code:'startup_cancelled'});expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('treats Native stdio errors as cancellation instead of unhandled stream failures',async()=>{
  current.writeReady=false;const promise=run().catch(error=>error);await flush();current.children[0].stderr.emit('error',new Error('synthetic pipe failure'));
  expect(await promise).toMatchObject({code:'startup_cancelled'});expect(mocks.spawn).toHaveBeenCalledOnce();expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('requires actual close after a spawn error and never accepts an error as exit proof',async()=>{
  vi.useFakeTimers();mocks.spawn.mockImplementationOnce(()=>{const child=fakeChild('native',41001);child.autoClose=false;current.children.push(child);queueMicrotask(()=>child.emit('error',new Error('synthetic spawn failure')));return child;});
  const promise=run().catch(error=>error);await flush();await vi.advanceTimersByTimeAsync(500);expect(mocks.release).not.toHaveBeenCalled();expect(fs.existsSync(current.frozenRoot)).toBe(true);current.children[0].finish(1);expect(await promise).toMatchObject({code:'spawn_failed'});expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('times out readiness without launching MCP or relinquishing Native ownership early',async()=>{
  vi.useFakeTimers();current.writeReady=false;const promise=run().catch(error=>error);await flush();current.children[0].autoClose=false;await vi.advanceTimersByTimeAsync(600);expect(mocks.spawn).toHaveBeenCalledOnce();expect(mocks.release).not.toHaveBeenCalled();current.children[0].finish();expect(await promise).toMatchObject({code:'startup_timeout'});expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('does not start MCP if cancellation arrives after ready validation',async()=>{
  const c=new AbortController();current.input.signal=c.signal;mocks.healthy.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementationOnce(()=>c.abort());
  await expect(run()).rejects.toMatchObject({code:'cancelled_before_mcp'});expect(mocks.spawn).toHaveBeenCalledOnce();expect(mocks.connect).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();
 });

 it('never takes over existing profiles or user children',async()=>{
  fs.mkdirSync(current.input.profile,{mode:0o700});await expect(run()).rejects.toMatchObject({code:'profile_already_exists_or_invalid'});expect(mocks.acquire).not.toHaveBeenCalled();expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).not.toHaveBeenCalled();
 });
 it('rejects a profile that appears while the trusted launcher is being loaded',async()=>{
  const load=current.host.loadLauncher!;current.host.loadLauncher=async filename=>{const module=await load(filename);fs.mkdirSync(current.input.profile,{mode:0o700});return module;};
  await expect(run()).rejects.toMatchObject({code:'profile_appeared_before_prepare'});expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();
 });
 it('rejects project-contained profiles and GUI wrapper executables before acquiring the gate',async()=>{
  current.input.forbidden_roots=[path.dirname(current.input.profile)];await expect(run()).rejects.toMatchObject({code:'profile_inside_source_or_project'});current.input.forbidden_roots=[];
  const wrapper=path.join(path.dirname(current.input.profile),'Synthetic.app/Contents/MacOS/FreeCAD');fs.mkdirSync(path.dirname(wrapper),{recursive:true,mode:0o700});fs.writeFileSync(wrapper,'opaque',{mode:0o700});current.input.executable=wrapper;
  await expect(run()).rejects.toMatchObject({code:'unsafe_gui_binary'});expect(mocks.acquire).not.toHaveBeenCalled();
 });
 it('does not attach an abort listener or attempt release when the shared gate is busy',async()=>{
  const controller=new AbortController();current.input.signal=controller.signal;const add=vi.spyOn(controller.signal,'addEventListener');
  mocks.acquire.mockImplementationOnce(()=>{throw Object.assign(new Error('busy'),{code:'busy'});});await expect(run()).rejects.toMatchObject({code:'busy'});expect(add).not.toHaveBeenCalled();expect(mocks.release).not.toHaveBeenCalled();expect(current.frozenRoot).toBe('');
 });
 it('does not bypass an unhealthy preconfigured lease',async()=>{
  mocks.healthy.mockImplementationOnce(()=>{throw Object.assign(new Error('uninitialized'),{code:'uninitialized'});});await expect(run()).rejects.toMatchObject({code:'uninitialized'});expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();expect(mocks.configure).not.toHaveBeenCalled();
 });
 it('rejects cancellation and non-validated platforms before reserving anything',async()=>{
  const c=new AbortController();c.abort();current.input.signal=c.signal;await expect(run()).rejects.toMatchObject({code:'cancelled_before_launch'});current.input.signal=undefined;current.host.platform='linux';await expect(run()).rejects.toMatchObject({code:'unsupported_platform'});expect(mocks.acquire).not.toHaveBeenCalled();
 });

 it.each(['pid','worker_id','session_id','protocol_version','addon_version','owner','extra','url_external','url_named_host','url_port','url_path'])('rejects unbound or non-loopback readiness: %s',kind=>{
  current.ready=receipt=>{if(kind==='extra')receipt.extra=true;else if(kind.startsWith('url_'))receipt.url=({url_external:'http://192.0.2.1:32109/',url_named_host:'http://localhost:32109/',url_port:'http://127.0.0.1:65536/',url_path:'http://127.0.0.1:32109/other'} as Record<string,string>)[kind];else receipt[kind]=kind==='pid'?99999:'untrusted';};
  return expect(run()).rejects.toMatchObject({code:kind.startsWith('url_')?'invalid_ready_address':'ready_identity_mismatch'}).then(()=>{expect(mocks.spawn).toHaveBeenCalledOnce();expect(current.events).toContain('native:close');expect(mocks.connect).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();});
 });

 it.each(['wrong_worker','wrong_session','not_ready'])('refuses mismatched live MCP status: %s',kind=>{
  mocks.status.mockResolvedValue({worker_id:kind==='wrong_worker'?ids.owner:ids.worker,session_id:kind==='wrong_session'?ids.owner:ids.session,state:kind==='not_ready'?'busy':'ready'});
  return expect(run()).rejects.toMatchObject({code:'worker_not_ready'}).then(()=>{expect(current.events).toContain('mcp:close');expect(current.events).toContain('native:close');expect(mocks.release).toHaveBeenCalledOnce();});
 });

 it.each(['program','owner','worker','args','path','scope','saves','env_extra','env_fixed','env_type'])('rejects prepared authority/environment tampering before spawn: %s',kind=>{
  current.mutate=prepared=>{
   const l=prepared.launch;if(kind==='program')l.program=process.execPath;if(kind==='owner')l.owner='unknown';if(kind==='worker')l.worker.worker_id='not-a-uuid';if(kind==='args')l.args.push('--untrusted');if(kind==='path')l.worker.readiness_receipt=path.join(current.input.profile,'other.json');if(kind==='scope')l.worker.profile_scope='shared';if(kind==='saves')l.worker.saves_cad=true;
   if(kind==='env_extra')prepared.environment.NODE_OPTIONS='--require untrusted';if(kind==='env_fixed')prepared.environment.FREECAD_USER_HOME=os.homedir();if(kind==='env_type')(prepared.environment as Record<string,unknown>).HOME=42;
  };
  return expect(run()).rejects.toMatchObject({code:kind.startsWith('env_')?'unsafe_environment':['path','scope','saves'].includes(kind)?'prepared_path_mismatch':'prepared_identity_mismatch'}).then(()=>{expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();expect(fs.existsSync(current.frozenRoot)).toBe(false);});
 });

 it.each(['ready','process','launch_lock','worker_lock','input','worker_marker','development_marker','addon_link','public_mode'])('rejects non-fresh or non-owned prepared profile material: %s',kind=>{
  current.afterPrepare=()=>{
   const profile=current.input.profile,runtime=path.join(profile,'runtime');
   if(kind==='ready')json(String(current.prepared!.launch.worker.readiness_receipt),{});if(kind==='process')json(path.join(runtime,'instance.json'),{});if(kind==='launch_lock')fs.mkdirSync(path.join(runtime,'launch.lock'));if(kind==='worker_lock')fs.mkdirSync(path.join(runtime,'thumbnail-worker.lock'));if(kind==='input')fs.mkdirSync(path.join(runtime,'thumbnail-input'));
   if(kind==='worker_marker')json(path.join(profile,'.phoenix-thumbnail-worker.json'),{});if(kind==='development_marker')json(path.join(profile,'.phoenix-development-profile.json'),{});
   if(kind==='addon_link'){fs.unlinkSync(path.join(profile,'Mod/PhoenixFreeCADTools'));fs.symlinkSync(path.join(current.frozenRoot,'dist'),path.join(profile,'Mod/PhoenixFreeCADTools'));}
   if(kind==='public_mode')fs.chmodSync(path.join(profile,'runtime'),0o755);
  };
  const code=kind==='worker_marker'?'worker_marker_mismatch':kind==='development_marker'?'development_marker_mismatch':kind==='addon_link'?'profile_addon_mismatch':kind==='public_mode'?'unsafe_profile':'profile_runtime_not_fresh';
  return expect(run()).rejects.toMatchObject({code}).then(()=>{expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();});
 });

 it('checks the pinned whitelist rather than trusting a caller resource descriptor',async()=>{
  current.input.resource={...current.input.resource,files:{}} as PinnedResource;await expect(run()).rejects.toThrow();expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).toHaveBeenCalledOnce();
 });
});
