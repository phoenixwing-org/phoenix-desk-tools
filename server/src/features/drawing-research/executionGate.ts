import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {ChildProcess, SpawnOptions} from 'node:child_process';
import {HostNativeBarrier, type HostNativeLease} from '../cad-native-measurement/host-barrier.js';

let active: { owner: string; token: symbol } | undefined;
let hostBarrier: HostNativeBarrier | undefined;
let hostScope: string | undefined;

export class DrawingExecutionGateError extends Error {
  constructor(readonly code:'busy'|'uninitialized'|'configuration_conflict'|'storage_uncertain'|'released'|'invalid_owner') {
    super(code==='busy'?'已有原生任务运行中或归属待核对，请等待或检查日志':
      code==='uninitialized'?'原生执行持久门禁尚未初始化，未启动程序':
      code==='storage_uncertain'?'原生执行记录未能确认，保留门禁，请检查日志':'原生执行门禁状态无效');
    this.name='DrawingExecutionGateError';
  }
}
export interface DrawingExecutionLease {
  ():void;
  /** Check after the host's spawn observer, before publishing a native owner marker. */
  assertHealthy():void;
  /** The only native spawn path: the durable lease records launch intent first. */
  spawn(command:string,args:readonly string[],options?:SpawnOptions):ChildProcess;
}

/** Host startup only. The scope is fixed for this process, never supplied by a workspace/action. */
export function configureDrawingExecutionBarrier(scope:string):void {
  if(typeof scope!=='string'||!path.isAbsolute(scope))throw new DrawingExecutionGateError('configuration_conflict');
  const normalized=path.resolve(scope);
  if(hostBarrier){if(hostScope===normalized)return;throw new DrawingExecutionGateError('configuration_conflict');}
  if(active)throw new DrawingExecutionGateError('configuration_conflict');
  try{
    const parent=path.dirname(normalized);
    if(fs.realpathSync(parent)!==parent||!fs.lstatSync(parent).isDirectory())throw new Error();
    try{fs.mkdirSync(normalized,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException)?.code!=='EEXIST')throw error;}
  }catch{throw new DrawingExecutionGateError('storage_uncertain');}
  hostBarrier=new HostNativeBarrier(normalized);hostScope=normalized;
}

/** Same-process reservation + fixed host barrier. Pure reservation tests can run
 * before host initialization, but spawn is always fail-closed until configured.
 * No PID probing, lock expiry, imported receipt or release boolean clears it. */
export function acquireDrawingExecution(owner: string): DrawingExecutionLease {
  if(typeof owner!=='string'||!owner||owner.length>8192)throw new DrawingExecutionGateError('invalid_owner');
  if(active)throw new DrawingExecutionGateError('busy');
  const token = Symbol(owner);
  let durable:HostNativeLease|undefined;
  if(hostBarrier)try{durable=hostBarrier.reserve('cad:'+createHash('sha256').update(owner).digest('hex'));}
  catch{throw new DrawingExecutionGateError('busy');}
  active = { owner, token };
  let requested=false,finished=false;
  const settle=()=>{
    if(finished||active?.token!==token)return;
    if(!durable){finished=true;active=undefined;return;}
    const result=durable.release();
    if(result.released){finished=true;active=undefined;return;}
    if(result.pending_children===0)throw new DrawingExecutionGateError('storage_uncertain');
  };
  return Object.assign(()=>{requested=true;settle();},{
    assertHealthy(){
      if(finished||requested||active?.token!==token)throw new DrawingExecutionGateError('released');
      if(!durable)throw new DrawingExecutionGateError('uninitialized');
      if(durable.failure_code)throw new DrawingExecutionGateError('storage_uncertain');
    },
    spawn(command:string,args:readonly string[],options?:SpawnOptions){
      if(finished||requested||active?.token!==token)throw new DrawingExecutionGateError('released');
      if(!durable)throw new DrawingExecutionGateError('uninitialized');
      const child=durable.spawn(command,[...args],options);
      // The barrier's own close observer runs first. A caller that requested an
      // early release still cannot let another child start before actual close.
      child.once('close',()=>{if(requested)try{settle();}catch{/* Persistent unknown stays blocked. */}});
      return child;
    },
  });
}
