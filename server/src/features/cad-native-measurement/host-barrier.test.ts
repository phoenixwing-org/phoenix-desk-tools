import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {HOST_NATIVE_ACTIVE_FILE,HOST_NATIVE_BARRIER_LIMITS,HOST_NATIVE_SYSTEM_CODES,HostNativeBarrier,HostNativeBarrierError,type HostNativeLease} from './host-barrier.js';

// Independent temporary scopes and real Node-only children: never FreeCAD or user data.
const roots:string[]=[],leases:HostNativeLease[]=[],children:childProcess.ChildProcess[]=[];
function scope(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-host-barrier-synthetic-')));fs.chmodSync(root,0o700);roots.push(root);return root;}
function reserve(root:string,owner='synthetic-owner'){const lease=new HostNativeBarrier(root).reserve(owner);leases.push(lease);return lease;}
const active=(root:string)=>path.join(root,HOST_NATIVE_ACTIVE_FILE);
const state=(root:string)=>JSON.parse(fs.readFileSync(active(root),'utf8'));
function run(lease:HostNativeLease,program='setTimeout(()=>{},40)'){const child=lease.spawn(process.execPath,['-e',program],{stdio:'ignore'});children.push(child);return child;}
const ended=(child:childProcess.ChildProcess)=>new Promise<[number|null,NodeJS.Signals|null]>(resolve=>child.once('close',(code,signal)=>resolve([code,signal])));
function rejected(call:()=>unknown,code:string){try{call();expect.fail('Expected barrier rejection');}catch(error){expect(error).toBeInstanceOf(HostNativeBarrierError);expect(error).toMatchObject({code});}}
afterEach(async()=>{
  vi.restoreAllMocks();
  for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){const closed=ended(child);try{child.kill('SIGKILL');}catch{}await closed;}
  for(const lease of leases.splice(0))lease.release();
  for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});
});

describe('host durable Native barrier (real synthetic Node processes only)',()=>{
  it('exclusively reserves a private fixed scope and persists an inert bounded record',()=>{
    const root=scope(),barrier=new HostNativeBarrier(root);expect(barrier.inspect()).toBe('clear');const lease=reserve(root);
    expect(state(root)).toMatchObject({format:'desk-host-native-barrier',version:1,owner:'synthetic-owner',state:'reserved',launches:[]});
    expect(fs.lstatSync(active(root)).mode&0o077).toBe(0);expect(fs.lstatSync(active(root)).nlink).toBe(1);
    expect(barrier.inspect()).toBe('busy');rejected(()=>new HostNativeBarrier(root).reserve('other'),'busy');
    expect(lease.release()).toEqual({released:true,pending_children:0});expect(barrier.inspect()).toBe('clear');
  });
  it('cannot grant release/spawn authority through a JSON/import round trip',()=>{
    const lease=reserve(scope());expect(JSON.parse(JSON.stringify(lease))).toEqual({});expect(Object.isFrozen(lease)).toBe(true);
    expect(lease).not.toHaveProperty('nonce');expect(lease).not.toHaveProperty('attachChild');
  });
  it('persists launch intent before invoking the host spawn primitive',async()=>{
    const root=scope(),lease=reserve(root),original=childProcess.spawn,seen:string[]=[];
    vi.spyOn(childProcess,'spawn').mockImplementation(((...args:Parameters<typeof childProcess.spawn>)=>{seen.push(state(root).state);return original(...args);}) as typeof childProcess.spawn);
    const child=run(lease);await ended(child);expect(seen).toEqual(['launching']);expect(state(root)).toMatchObject({state:'actual_close',launches:[{state:'actual_close',pid:child.pid,exit_code:0,signal:null}]});
    expect(lease.release().released).toBe(true);
  });
  it('keeps beforeSpawn without a known spawn permanently unknown, not inferred absent',()=>{
    const root=scope(),lease=reserve(root);lease.beforeSpawn();expect(state(root).state).toBe('launching');
    expect(lease.release()).toEqual({released:false,pending_children:0,reason:'unknown_launch'});expect(lease.failure_code).toBe('unknown_launch');
    expect(new HostNativeBarrier(root).inspect()).toBe('busy');rejected(()=>new HostNativeBarrier(root).reserve('next'),'busy');
  });
  it('rechecks an explicit intent immediately before spawn, so stale path identity never launches',()=>{
    const root=scope(),lease=reserve(root);lease.beforeSpawn();fs.writeFileSync(active(root),'changed');
    const spy=vi.spyOn(childProcess,'spawn');rejected(()=>run(lease),'storage_uncertain');expect(spy).not.toHaveBeenCalled();expect(lease.failure_code).toBe('identity_changed');
  });
  it('holds a pending release until every registered child really closes',async()=>{
    const root=scope(),lease=reserve(root),one=run(lease,'setTimeout(()=>{},40)'),two=run(lease,'setTimeout(()=>{},180)');
    const last=ended(two);expect(lease.release()).toEqual({released:false,pending_children:2,reason:'pending'});
    await ended(one);expect(new HostNativeBarrier(root).inspect()).toBe('busy');expect(lease.release()).toMatchObject({released:false,pending_children:1});
    await last;expect(lease.release()).toEqual({released:true,pending_children:0});expect(new HostNativeBarrier(root).inspect()).toBe('clear');
  });
  it('does not treat a kill request or an exit event as actual close',async()=>{
    const root=scope(),lease=reserve(root),child=run(lease,'setTimeout(()=>{},1000)');await once(child,'spawn');
    let atExit:ReturnType<HostNativeLease['release']>|undefined;child.once('exit',()=>{atExit=lease.release();});
    expect(child.kill('SIGTERM')).toBe(true);expect(lease.release()).toEqual({released:false,pending_children:1,reason:'pending'});expect(fs.existsSync(active(root))).toBe(true);
    await ended(child);expect(atExit).toMatchObject({released:false,pending_children:1});expect(lease.release().released).toBe(true);
  });
  it('records only an explicit host synchronous no-spawn fact after Node validation throws',()=>{
    const root=scope(),lease=reserve(root);rejected(()=>lease.spawn(''),'spawn_failed');
    expect(state(root)).toMatchObject({state:'reserved',launches:[{state:'not_spawned',no_spawn_reason:'synchronous_throw'}]});expect(lease.release().released).toBe(true);
  });
  it.each(HOST_NATIVE_SYSTEM_CODES)('preserves only the fixed synchronous spawn errno %s, never original diagnostics',errno=>{
    const root=scope(),lease=reserve(root),original=Object.assign(new Error('PRIVATE_ORIGINAL_MESSAGE'),{code:errno,cause:'PRIVATE_CAUSE',stack:'PRIVATE_ORIGINAL_STACK'});
    vi.spyOn(childProcess,'spawn').mockImplementation(()=>{throw original;});let error:unknown;
    try{lease.spawn('/synthetic/unused');}catch(caught){error=caught;}
    expect(error).toBeInstanceOf(HostNativeBarrierError);expect(error).toMatchObject({code:'spawn_failed',system_code:errno,message:'spawn_failed'});
    expect(error).not.toHaveProperty('cause');expect((error as Error).stack).not.toContain('PRIVATE_ORIGINAL_STACK');expect(JSON.stringify(error)).not.toContain('PRIVATE_');
    expect(state(root).launches[0]).toMatchObject({state:'not_spawned'});expect(lease.release().released).toBe(true);
  });
  it.each(['UNTRUSTED_CUSTOM_CODE','enoent','SECRET PATH /synthetic'])('does not preserve an unknown synchronous spawn code %s',errno=>{
    const lease=reserve(scope());vi.spyOn(childProcess,'spawn').mockImplementation(()=>{throw Object.assign(new Error('PRIVATE'),{code:errno});});let error:unknown;
    try{lease.spawn('/synthetic/unused');}catch(caught){error=caught;}
    expect(error).toMatchObject({code:'spawn_failed',system_code:undefined});expect(JSON.stringify(error)).not.toContain(errno);expect(lease.release().released).toBe(true);
  });
  it('never invokes an error-code getter while preparing fixed spawn diagnostics',()=>{
    const lease=reserve(scope()),getter=vi.fn(()=>{throw new Error('PRIVATE');}),original=new Error('PRIVATE');Object.defineProperty(original,'code',{get:getter});
    vi.spyOn(childProcess,'spawn').mockImplementation(()=>{throw original;});rejected(()=>lease.spawn('/synthetic/unused'),'spawn_failed');expect(getter).not.toHaveBeenCalled();expect(lease.release().released).toBe(true);
  });
  it('waits for close after an actual asynchronous OS spawn error, without fake child-close proof',async()=>{
    const root=scope(),lease=reserve(root),child=lease.spawn(path.join(root,'does-not-exist'),[],{stdio:'ignore'});children.push(child);
    expect(lease.release()).toMatchObject({released:false,pending_children:1});await ended(child);
    expect(lease.release().released).toBe(true);expect(lease.failure_code).toBeUndefined();
  });
  it('persists asynchronous no-spawn as no_spawn, never actual_close',async()=>{
    const root=scope(),lease=reserve(root),child=lease.spawn(path.join(root,'missing'),[],{stdio:'ignore'});children.push(child);await ended(child);
    expect(state(root).launches).toEqual([{ordinal:1,state:'not_spawned',no_spawn_reason:'async_spawn_error'}]);expect(state(root).state).toBe('reserved');
  });
  it('supports sequential owned children under one live lease without dropping the barrier',async()=>{
    const root=scope(),lease=reserve(root);await ended(run(lease));expect(new HostNativeBarrier(root).inspect()).toBe('busy');await ended(run(lease));
    expect(state(root).launches.map((l:{state:string})=>l.state)).toEqual(['actual_close','actual_close']);expect(lease.release().released).toBe(true);
  });
  it('never lets an idempotent late release remove a newer owner',()=>{
    const root=scope(),old=reserve(root);expect(old.release().released).toBe(true);const next=reserve(root,'new-owner'),bytes=fs.readFileSync(active(root));
    expect(old.release().released).toBe(true);expect(fs.readFileSync(active(root))).toEqual(bytes);expect(state(root).owner).toBe('new-owner');expect(next.release().released).toBe(true);
    rejected(()=>old.beforeSpawn(),'inactive_lease');rejected(()=>run(old),'inactive_lease');
  });
  it.each(['malformed','unknown_version','future_filename','directory','symlink','hardlink'] as const)('treats %s residual state as busy without interpreting/reclaiming it',kind=>{
    const root=scope(),other=scope(),source=path.join(other,'synthetic-source.txt');fs.writeFileSync(source,'independent data');const before=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    if(kind==='directory')fs.mkdirSync(active(root));else if(kind==='symlink')fs.symlinkSync(source,active(root));else if(kind==='hardlink')fs.linkSync(source,active(root));
    else fs.writeFileSync(kind==='future_filename'?path.join(root,'active.v99.json'):active(root),kind==='unknown_version'?JSON.stringify({version:999,pid:999999,created_at:'1970-01-01'}):'not json',{mode:0o600});
    expect(new HostNativeBarrier(root).inspect()).toBe('busy');rejected(()=>reserve(root),'busy');expect(createHash('sha256').update(fs.readFileSync(source)).digest('hex')).toBe(before);
  });
  it.each(['relative','symlink','public','file'] as const)('rejects an unsafe %s scope without creating state',kind=>{
    const root=scope();let selected=root;
    if(kind==='relative')selected='relative-scope';if(kind==='public')fs.chmodSync(root,0o755);
    if(kind==='file'){selected=path.join(root,'file');fs.writeFileSync(selected,'data');}
    if(kind==='symlink'){selected=path.join(root,'link');fs.symlinkSync(scope(),selected);}
    rejected(()=>new HostNativeBarrier(selected),'unsafe_scope');expect(fs.existsSync(active(root))).toBe(false);
  });
  it.each(['','\u200b','x'.repeat(257)])('rejects an invalid owner before reserving: %j',owner=>{const root=scope();rejected(()=>reserve(root,owner),'invalid_owner');expect(fs.readdirSync(root)).toEqual([]);});
  it('retains an active record after file fsync fails during reservation',()=>{
    const root=scope();vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw new Error('synthetic failure');});rejected(()=>reserve(root),'storage_uncertain');
    expect(fs.existsSync(active(root))).toBe(true);expect(new HostNativeBarrier(root).inspect()).toBe('busy');
  });
  it('retains active state if parent directory fsync fails before a child can spawn',()=>{
    const root=scope(),original=fs.fsyncSync;vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(fs.fstatSync(fd).isDirectory())throw new Error('synthetic parent sync');original(fd);});
    rejected(()=>reserve(root),'storage_uncertain');expect(fs.existsSync(active(root))).toBe(true);
  });
  it('fails closed on short/failed launch writes before calling any child primitive',()=>{
    const root=scope(),lease=reserve(root),spawn=vi.spyOn(childProcess,'spawn');vi.spyOn(fs,'writeSync').mockImplementation(()=>0);
    rejected(()=>run(lease),'storage_uncertain');expect(spawn).not.toHaveBeenCalled();expect(lease.release()).toMatchObject({released:false,reason:'storage_uncertain'});expect(fs.existsSync(active(root))).toBe(true);
  });
  it('turns close-persistence failure into a fixed failure code, never uncaught or unlocked',async()=>{
    const root=scope(),lease=reserve(root),child=run(lease);await once(child,'spawn');const original=fs.fsyncSync;
    vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(fs.fstatSync(fd).isFile())throw new Error('synthetic close sync');original(fd);});
    await ended(child);expect(lease.failure_code).toBe('storage_failed');expect(lease.release()).toEqual({released:false,pending_children:0,reason:'storage_uncertain'});expect(new HostNativeBarrier(root).inspect()).toBe('busy');
  });
  it('checks owned inode and nonce bytes instead of removing a replaced active file',()=>{
    const root=scope(),lease=reserve(root);fs.renameSync(active(root),path.join(root,'old.json'));fs.writeFileSync(active(root),'new owner',{mode:0o600});
    expect(lease.release()).toMatchObject({released:false,reason:'storage_uncertain'});expect(fs.readFileSync(active(root),'utf8')).toBe('new owner');
  });
  it('never releases through a swapped scope directory',()=>{
    const root=scope(),lease=reserve(root),moved=root+'-moved';fs.renameSync(root,moved);roots.push(moved);fs.mkdirSync(root,{mode:0o700});fs.writeFileSync(active(root),'unrelated',{mode:0o600});
    expect(lease.release().released).toBe(false);expect(fs.readFileSync(active(root),'utf8')).toBe('unrelated');expect(fs.existsSync(active(moved))).toBe(true);
  });
  it('does not create recovery state inside a replacement empty scope directory',()=>{
    const root=scope(),lease=reserve(root),moved=root+'-moved';fs.renameSync(root,moved);roots.push(moved);fs.mkdirSync(root,{mode:0o700});
    expect(lease.release().released).toBe(false);expect(fs.readdirSync(root)).toEqual([]);expect(fs.existsSync(active(moved))).toBe(true);
  });
  it('retains active if release preflight directory sync fails',()=>{
    const root=scope(),lease=reserve(root);vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw new Error('synthetic release sync');});
    expect(lease.release()).toEqual({released:false,pending_children:0,reason:'storage_uncertain'});expect(fs.existsSync(active(root))).toBe(true);
  });
  it('restores a busy entry after post-unlink directory sync fails without replacing a new owner',()=>{
    const root=scope(),lease=reserve(root),original=fs.fsyncSync;let calls=0;
    vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(fs.fstatSync(fd).isDirectory()&&++calls===2)throw new Error('synthetic post-unlink sync');original(fd);});
    expect(lease.release()).toMatchObject({released:false,reason:'storage_uncertain'});expect(fs.existsSync(active(root))).toBe(true);expect(new HostNativeBarrier(root).inspect()).toBe('busy');
  });
  it('never overwrites another owner that appears after a failed post-unlink sync',()=>{
    const root=scope(),lease=reserve(root),original=fs.fsyncSync;let calls=0;
    vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(fs.fstatSync(fd).isDirectory()&&++calls===2){fs.writeFileSync(active(root),'different live owner',{flag:'wx',mode:0o600});throw new Error('synthetic post-unlink sync');}original(fd);});
    expect(lease.release()).toMatchObject({released:false,reason:'storage_uncertain'});expect(fs.readFileSync(active(root),'utf8')).toBe('different live owner');
  });
  it('honestly limits post-close total-storage-failure recovery to best effort and process poison',async()=>{
    const root=scope(),lease=reserve(root);await ended(run(lease));expect(state(root).state).toBe('actual_close');
    const sync=fs.fsyncSync,open=fs.openSync;let directorySyncs=0,postUnlinkFailure=false;
    vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(fs.fstatSync(fd).isDirectory()&&++directorySyncs===2){postUnlinkFailure=true;throw new Error('synthetic disk failure');}sync(fd);});
    vi.spyOn(fs,'openSync').mockImplementation(((file,flags,...rest)=>{if(postUnlinkFailure&&file===active(root))throw new Error('synthetic cannot restore');return open(file,flags,...rest);}) as typeof fs.openSync);
    expect(lease.release()).toEqual({released:false,pending_children:0,reason:'storage_uncertain'});
    expect(fs.existsSync(active(root))).toBe(false);expect(new HostNativeBarrier(root).inspect()).toBe('busy');
    rejected(()=>reserve(root),'busy'); // In-process poison is NOT advertised as cross-restart persistence.
  });
  it('bounds the child ledger rather than allowing an unbounded launch history',()=>{
    const lease=reserve(scope());for(let i=0;i<HOST_NATIVE_BARRIER_LIMITS.children;i++)rejected(()=>lease.spawn(''),'spawn_failed');rejected(()=>lease.spawn(''),'resource_limit');expect(lease.release().released).toBe(true);
  });
  it('arbitrates independent Node coordinators and keeps a dead owner busy without PID/TTL reclaim',async()=>{
    const root=scope(),loader=createRequire(import.meta.url).resolve('tsx/esm'),moduleUrl=pathToFileURL(path.resolve('src/features/cad-native-measurement/host-barrier.ts')).href;
    const code=`import {HostNativeBarrier} from ${JSON.stringify(moduleUrl)};try{new HostNativeBarrier(${JSON.stringify(root)}).reserve('synthetic-external');console.log('reserved');}catch(error){console.log(error.code);}`;
    const launch=()=>new Promise<string>((resolve,reject)=>{const child=childProcess.spawn(process.execPath,['--import',loader,'--input-type=module','--eval',code],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',code=>code===0?resolve(out.trim()):reject(new Error(err)));});
    expect((await Promise.all([launch(),launch()])).sort()).toEqual(['busy','reserved']);expect(new HostNativeBarrier(root).inspect()).toBe('busy');rejected(()=>reserve(root),'busy');
  });
});
