import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {HOST_NATIVE_ACTIVE_FILE,HostNativeBarrier,type HostNativeLease} from '../cad-native-measurement/host-barrier.js';
import type {DrawingExecutionLease} from './executionGate.js';

// Separate host-private scopes and process.execPath children only; never CAD Native.
const roots:string[]=[],leases:DrawingExecutionLease[]=[],foreign:HostNativeLease[]=[];
const processes:Array<{child:childProcess.ChildProcess;closed:boolean;done:Promise<void>}>=[];
function fixture(){const parent=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-gate-synthetic-')));roots.push(parent);return {parent,scope:path.join(parent,'host-native-scope')};}
async function gate(){vi.resetModules();return import('./executionGate.js');}
function acquire(api:Awaited<ReturnType<typeof gate>>,owner='synthetic-owner'){const lease=api.acquireDrawingExecution(owner);leases.push(lease);return lease;}
function start(lease:DrawingExecutionLease,program='setTimeout(()=>{},80)'){
  const child=lease.spawn(process.execPath,['-e',program],{stdio:'ignore'});
  const tracked={child,closed:false,done:Promise.resolve()};tracked.done=new Promise<void>(resolve=>child.once('close',()=>{tracked.closed=true;resolve();}));processes.push(tracked);return tracked;
}
function code(call:()=>unknown,expected:string){try{call();expect.fail('Expected gate rejection');}catch(error){expect(error).toMatchObject({code:expected});}}
afterEach(async()=>{
  vi.restoreAllMocks();
  for(const tracked of processes.splice(0)){if(!tracked.closed)try{tracked.child.kill('SIGKILL');}catch{}await tracked.done;}
  for(const lease of leases.splice(0))try{lease();}catch{/* Deliberately poisoned synthetic states stay blocked. */}
  for(const lease of foreign.splice(0))lease.release();
  for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});
});

describe('callable drawing lease with a fixed durable host barrier',()=>{
  it('keeps pure reservation compatibility before configuration, but every spawn/marker check fails closed',async()=>{
    const api=await gate(),spawn=vi.spyOn(childProcess,'spawn'),first=acquire(api,'one');
    code(()=>acquire(api,'two'),'busy');code(()=>first.assertHealthy(),'uninitialized');code(()=>first.spawn(process.execPath,['-e','process.exit(0)']),'uninitialized');expect(spawn).not.toHaveBeenCalled();
    first();const second=acquire(api,'two');first();code(()=>acquire(api,'three'),'busy');second();acquire(api,'three')();
  });
  it('creates one private fixed scope; same-scope configure is idempotent and a different scope is rejected',async()=>{
    const api=await gate(),f=fixture();expect(fs.existsSync(f.scope)).toBe(false);api.configureDrawingExecutionBarrier(f.scope);
    expect(fs.lstatSync(f.scope).isDirectory()).toBe(true);expect(fs.lstatSync(f.scope).mode&0o077).toBe(0);
    api.configureDrawingExecutionBarrier(f.scope);api.configureDrawingExecutionBarrier(path.join(f.scope,'.'));
    code(()=>api.configureDrawingExecutionBarrier(path.join(f.parent,'different-scope')),'configuration_conflict');expect(fs.existsSync(path.join(f.parent,'different-scope'))).toBe(false);
    const lease=acquire(api);expect(()=>lease.assertHealthy()).not.toThrow();lease();
  });
  it('rejects configure while an uninitialized pure lease is still active',async()=>{
    const api=await gate(),f=fixture(),lease=acquire(api);code(()=>api.configureDrawingExecutionBarrier(f.scope),'configuration_conflict');expect(fs.existsSync(f.scope)).toBe(false);
    lease();api.configureDrawingExecutionBarrier(f.scope);acquire(api)();
  });
  it('holds an early release busy through real child exit and only clears after its actual close',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const lease=acquire(api),tracked=start(lease);
    let busyAtExit=false;tracked.child.once('exit',()=>{try{api.acquireDrawingExecution('exit-window');}catch(error){busyAtExit=(error as {code?:string}).code==='busy';}});
    lease();code(()=>lease.assertHealthy(),'released');code(()=>lease.spawn(process.execPath,['-e','process.exit(0)']),'released');code(()=>acquire(api,'second-workspace'),'busy');
    expect(new HostNativeBarrier(f.scope).inspect()).toBe('busy');await tracked.done;expect(busyAtExit).toBe(true);expect(new HostNativeBarrier(f.scope).inspect()).toBe('clear');acquire(api,'next-after-close')();
  });
  it('does not treat an explicit kill request as a released gate',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const lease=acquire(api),tracked=start(lease,'setTimeout(()=>{},1000)');
    tracked.child.kill('SIGTERM');lease();code(()=>acquire(api,'while-killing'),'busy');await tracked.done;acquire(api,'after-close')();
  });
  it('checks durable ownership across separate coordinators in the same fixed scope',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const other=new HostNativeBarrier(f.scope).reserve('synthetic-other-service');foreign.push(other);
    code(()=>acquire(api,'workspace-one'),'busy');code(()=>acquire(api,'workspace-two'),'busy');expect(other.release().released).toBe(true);acquire(api,'after-other-release')();
  });
  it('reloads the service against the same live record without resetting or reclaiming ownership',async()=>{
    const original=await gate(),f=fixture();original.configureDrawingExecutionBarrier(f.scope);const lease=acquire(original,'original-service'),tracked=start(lease,'setTimeout(()=>{},180)');
    const reloaded=await gate();reloaded.configureDrawingExecutionBarrier(f.scope);code(()=>acquire(reloaded,'new-service'),'busy');
    await tracked.done;code(()=>acquire(reloaded,'closed-but-not-released'),'busy');lease();acquire(reloaded,'after-live-owner-release')();
  });
  it('keeps an unknown pre-spawn intent busy after service reload, without PID or TTL recovery',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const other=new HostNativeBarrier(f.scope).reserve('synthetic-departed-host');foreign.push(other);
    other.beforeSpawn();expect(other.release()).toMatchObject({released:false,reason:'unknown_launch'});const before=fs.readFileSync(path.join(f.scope,HOST_NATIVE_ACTIVE_FILE));
    const reloaded=await gate();reloaded.configureDrawingExecutionBarrier(f.scope);code(()=>acquire(reloaded,'different-workspace'),'busy');expect(fs.readFileSync(path.join(f.scope,HOST_NATIVE_ACTIVE_FILE))).toEqual(before);
  });
  it('treats malformed/unknown durable state as busy without granting an imported release capability',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const active=path.join(f.scope,HOST_NATIVE_ACTIVE_FILE);
    fs.writeFileSync(active,JSON.stringify({version:999,pid:999999,created_at:'1970-01-01',actual_close_observed:true,released:true}),{mode:0o600});const before=fs.readFileSync(active);
    code(()=>acquire(api),'busy');expect(fs.readFileSync(active)).toEqual(before);
  });
  it('an old callable release cannot unlock or edit a newer durable owner',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const old=acquire(api,'old');old();const next=acquire(api,'new'),active=path.join(f.scope,HOST_NATIVE_ACTIVE_FILE),bytes=fs.readFileSync(active);
    old();expect(fs.readFileSync(active)).toEqual(bytes);code(()=>acquire(api,'third'),'busy');code(()=>old.assertHealthy(),'released');next();acquire(api,'third')();
  });
  it('makes assertHealthy reject owner-marker permission after the real spawn PID cannot be persisted',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const lease=acquire(api),active=path.join(f.scope,HOST_NATIVE_ACTIVE_FILE),sync=fs.fsyncSync;
    const tracked=start(lease);let markerPermitted=false,markerError:unknown;
    vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{if(fs.fstatSync(fd).isFile()&&JSON.parse(fs.readFileSync(active,'utf8')).state==='spawned')throw new Error('synthetic PID persistence failure');sync(fd);});
    tracked.child.once('spawn',()=>{try{lease.assertHealthy();markerPermitted=true;}catch(error){markerError=error;}});
    await tracked.done;expect(markerPermitted).toBe(false);expect(markerError).toMatchObject({code:'storage_uncertain'});code(()=>lease.assertHealthy(),'storage_uncertain');
    code(()=>lease(),'storage_uncertain');code(()=>acquire(api,'next'),'busy');expect(fs.existsSync(active)).toBe(true);
  });
  it('never calls Node spawn if launch-intent persistence fails first',async()=>{
    const api=await gate(),f=fixture();api.configureDrawingExecutionBarrier(f.scope);const lease=acquire(api),spy=vi.spyOn(childProcess,'spawn');vi.spyOn(fs,'fsyncSync').mockImplementation(()=>{throw new Error('synthetic intent sync failure');});
    code(()=>lease.spawn(process.execPath,['-e','process.exit(0)']),'storage_uncertain');expect(spy).not.toHaveBeenCalled();code(()=>lease.assertHealthy(),'storage_uncertain');code(()=>lease(),'storage_uncertain');
  });
});
