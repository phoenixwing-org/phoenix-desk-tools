import fs from 'node:fs';
import path from 'node:path';
import childProcess, {type ChildProcess, type SpawnOptions} from 'node:child_process';
import {randomUUID} from 'node:crypto';

/** Host-only, fixed private scope. Never construct this from an HTTP/workspace DTO.
 * An existing active entry is ALWAYS busy, irrespective of PID, age or contents.
 * This barrier owns no CAD semantics and grants no authority to serialized proof.
 * The host-private directory is a prerequisite, not a hostile-OS/path sandbox.
 * Only explicitly spawned ChildProcess objects are owned, not descendant trees.
 * Release is attempted only after all actual closes (or explicit no-spawn facts).
 * If unlink succeeds but the final parent fsync fails, restoration is best effort:
 * the current process is poisoned, but total storage failure cannot guarantee a
 * busy file across restart. At that point no old owned child remains running. */
export const HOST_NATIVE_ACTIVE_FILE='active.v1.json';
export const HOST_NATIVE_BARRIER_LIMITS=Object.freeze({bytes:64*1024,children:32});
export type HostBarrierFailure='storage_failed'|'identity_changed'|'unknown_launch';
export type HostBarrierRelease={released:boolean;pending_children:number;reason?:'pending'|'storage_uncertain'|'unknown_launch'};
export const HOST_NATIVE_SYSTEM_CODES=Object.freeze(['ENOENT','EACCES','EPERM','EAGAIN','EBADF','ENOMEM','ENOTDIR','EINVAL','ENAMETOOLONG','ENOEXEC','EMFILE','ENFILE','ETXTBSY','EIO'] as const);
export type HostNativeSystemCode=typeof HOST_NATIVE_SYSTEM_CODES[number];
export class HostNativeBarrierError extends Error{
  constructor(readonly code:'busy'|'unsafe_scope'|'invalid_owner'|'inactive_lease'|'resource_limit'|'storage_uncertain'|'spawn_failed',readonly system_code?:HostNativeSystemCode){super(code);this.name='HostNativeBarrierError';}
}
export interface HostNativeLease{
  readonly failure_code:HostBarrierFailure|undefined;
  /** An external intent without a subsequent observed spawn remains unknown. */
  beforeSpawn():void;
  /** Host code only. Arguments/options must never come from action JSON. */
  spawn(command:string,args?:readonly string[],options?:SpawnOptions):ChildProcess;
  /** Requests release; never kills and never infers close from exit/timeout/PID. */
  release():HostBarrierRelease;
}
type Identity={dev:number;ino:number};
type Launch={ordinal:number;state:'launching'|'spawned'|'actual_close'|'not_spawned';pid?:number;exit_code?:number|null;signal?:string|null;no_spawn_reason?:'synchronous_throw'|'async_spawn_error'};
type RecordData={format:'desk-host-native-barrier';version:1;nonce:string;owner:string;state:'reserved'|'launching'|'spawned'|'actual_close';launches:Launch[]};
const poisoned=new Set<string>();
const identity=(s:fs.Stats):Identity=>({dev:s.dev,ino:s.ino});
const same=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
const stamp=(s:fs.Stats)=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.nlink].join(':');
const ownUid=(s:fs.Stats)=>typeof process.getuid!=='function'||s.uid===process.getuid();
const privateDirectory=(s:fs.Stats)=>s.isDirectory()&&!s.isSymbolicLink()&&ownUid(s)&&(s.mode&0o077)===0;
const privateFile=(s:fs.Stats)=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&ownUid(s)&&(s.mode&0o077)===0;
function present(file:string):boolean{try{fs.lstatSync(file);return true;}catch(error){if((error as NodeJS.ErrnoException)?.code==='ENOENT')return false;throw error;}}
function entries(scope:string):string[]{const directory=fs.opendirSync(scope,{bufferSize:2});try{const result:string[]=[];for(let i=0;i<2;i++){const entry=directory.readSync();if(!entry)break;result.push(entry.name);}return result;}finally{directory.closeSync();}}
function safeOwner(owner:unknown):owner is string{return typeof owner==='string'&&owner.trim().length>0&&owner.length<=256&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(owner);}
function systemCode(error:unknown):HostNativeSystemCode|undefined{
  if(!error||typeof error!=='object')return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(error,'code');
  return descriptor&&'value'in descriptor&&typeof descriptor.value==='string'&&HOST_NATIVE_SYSTEM_CODES.includes(descriptor.value as HostNativeSystemCode)?descriptor.value as HostNativeSystemCode:undefined;
}

export class HostNativeBarrier{
  readonly scope:string;
  private readonly proof:Identity;
  constructor(scope:string){
    try{
      if(typeof scope!=='string'||!path.isAbsolute(scope)||scope.length>4096||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(scope)||!privateDirectory(fs.lstatSync(scope)))throw new Error();
      this.scope=fs.realpathSync(scope);this.proof=identity(fs.lstatSync(this.scope));this.assertScope();
    }catch{throw new HostNativeBarrierError('unsafe_scope');}
  }
  private assertScope():void{
    const current=fs.lstatSync(this.scope);
    if(!privateDirectory(current)||!same(current,this.proof))throw new HostNativeBarrierError('unsafe_scope');
  }
  private syncScope():void{
    this.assertScope();const fd=fs.openSync(this.scope,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_DIRECTORY);
    try{const before=fs.fstatSync(fd);if(!privateDirectory(before)||!same(before,this.proof))throw new Error();fs.fsyncSync(fd);this.assertScope();if(!same(fs.fstatSync(fd),this.proof))throw new Error();}
    finally{fs.closeSync(fd);}
  }
  /** Health only. Unknown/malformed/symlink/hardlink entries cannot become a lease. */
  inspect():'clear'|'busy'{try{this.assertScope();return poisoned.has(this.scope)||entries(this.scope).length?'busy':'clear';}catch{return 'busy';}}
  reserve(owner:string):HostNativeLease{
    if(!safeOwner(owner))throw new HostNativeBarrierError('invalid_owner');
    const filename=path.join(this.scope,HOST_NATIVE_ACTIVE_FILE);
    try{this.assertScope();if(poisoned.has(this.scope)||entries(this.scope).length)throw new HostNativeBarrierError('busy');}
    catch(error){if(error instanceof HostNativeBarrierError)throw error;throw new HostNativeBarrierError('storage_uncertain');}
    let fd:number;
    try{fd=fs.openSync(filename,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}
    catch(error){if((error as NodeJS.ErrnoException)?.code==='EEXIST')throw new HostNativeBarrierError('busy');throw new HostNativeBarrierError('storage_uncertain');}
    let opened:fs.Stats;
    try{opened=fs.fstatSync(fd);}catch{try{fs.closeSync(fd);}catch{}poisoned.add(this.scope);throw new HostNativeBarrierError('storage_uncertain');}
    const fileProof=identity(opened);
    let expected=Buffer.alloc(0),failure:HostBarrierFailure|undefined,closedFd=false,released=false,releaseRequested=false;
    let pendingIntent:Launch|undefined;
    const children=new Map<ChildProcess,{launch:Launch;closed:boolean;spawned:boolean;error?:NodeJS.ErrnoException}>();
    const data:RecordData={format:'desk-host-native-barrier',version:1,nonce:randomUUID(),owner,state:'reserved',launches:[]};
    const closeFd=()=>{if(!closedFd){closedFd=true;try{fs.closeSync(fd);}catch{failure??='storage_failed';poisoned.add(this.scope);}}};
    const uncertain=(code:HostBarrierFailure)=>{failure??=code;poisoned.add(this.scope);closeFd();};
    const assertOwned=()=>{
      this.assertScope();const named=fs.lstatSync(filename),before=fs.fstatSync(fd);
      const names=entries(this.scope);if(names.length!==1||names[0]!==HOST_NATIVE_ACTIVE_FILE)throw new Error('identity');
      if(!privateFile(named)||!privateFile(before)||!same(named,fileProof)||!same(before,fileProof)||stamp(named)!==stamp(before)||before.size!==expected.length)throw new Error('identity');
      const read=Buffer.alloc(expected.length+1);let offset=0;
      while(offset<read.length){const amount=fs.readSync(fd,read,offset,read.length-offset,offset);if(!amount)break;offset+=amount;}
      if(offset!==expected.length||!read.subarray(0,offset).equals(expected)||stamp(fs.fstatSync(fd))!==stamp(before)||stamp(fs.lstatSync(filename))!==stamp(before))throw new Error('identity');
    };
    const persist=()=>{
      if(failure||closedFd)throw new HostNativeBarrierError('storage_uncertain');
      try{
        assertOwned();const bytes=Buffer.from(JSON.stringify(data));if(bytes.length>HOST_NATIVE_BARRIER_LIMITS.bytes)throw new Error();
        // All updates use the exclusive FD, never a reopened/overwritten pathname.
        fs.ftruncateSync(fd,0);let offset=0;while(offset<bytes.length){const amount=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);if(amount<1)throw new Error();offset+=amount;}
        fs.fsyncSync(fd);expected=bytes;assertOwned();this.syncScope();assertOwned();
      }catch(error){uncertain(error instanceof Error&&error.message==='identity'?'identity_changed':'storage_failed');throw new HostNativeBarrierError('storage_uncertain');}
    };
    try{if(!privateFile(opened))throw new Error();persist();}
    catch{uncertain('storage_failed');throw new HostNativeBarrierError('storage_uncertain');}
    const pendingCount=()=>[...children.values()].filter(child=>!child.closed).length;
    const result=():HostBarrierRelease=>released?{released:true,pending_children:0}:failure?{released:false,pending_children:pendingCount(),reason:failure==='unknown_launch'?'unknown_launch':'storage_uncertain'}:{released:false,pending_children:pendingCount(),reason:pendingIntent?'unknown_launch':'pending'};
    const finishRelease=():HostBarrierRelease=>{
      if(released||failure||pendingCount())return result();
      if(pendingIntent){uncertain('unknown_launch');return result();}
      try{
        // Preflight sync catches a storage failure before removing any owned entry.
        assertOwned();this.syncScope();assertOwned();fs.unlinkSync(filename);this.syncScope();closeFd();if(failure)throw new Error();released=true;return result();
      }catch{
        // If unlink succeeded but directory durability failed, restore a busy entry
        // exclusively. Never overwrite a concurrently reserved new owner's file.
        try{this.assertScope();if(!present(filename)){const replacement=fs.openSync(filename,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(replacement,expected);fs.fsyncSync(replacement);}finally{fs.closeSync(replacement);}this.syncScope();}}catch{/* Scope is poisoned in-process; residual entry is never reclaimed. */}
        uncertain('storage_failed');return result();
      }
    };
    const healthy=()=>{if(released||releaseRequested)throw new HostNativeBarrierError('inactive_lease');if(failure)throw new HostNativeBarrierError('storage_uncertain');};
    const intent=()=>{
      healthy();if(pendingIntent)throw new HostNativeBarrierError('inactive_lease');if(data.launches.length>=HOST_NATIVE_BARRIER_LIMITS.children)throw new HostNativeBarrierError('resource_limit');
      const launch:Launch={ordinal:data.launches.length+1,state:'launching'};data.launches.push(launch);pendingIntent=launch;data.state='launching';persist();
    };
    const observed=()=>{if(failure)return;try{persist();if(releaseRequested)finishRelease();}catch{/* Event callbacks MUST NOT throw or release an uncertain barrier. */}};
    const lease:HostNativeLease={
      get failure_code(){return failure;},beforeSpawn:intent,
      spawn:(command,args=[],options={})=>{
        healthy();if(!pendingIntent)intent();else persist();const launch=pendingIntent!;pendingIntent=undefined;
        let child:ChildProcess;
        try{child=childProcess.spawn(command,[...args],options);}
        catch(error){launch.state='not_spawned';launch.no_spawn_reason='synchronous_throw';data.state=data.launches.some(l=>l.state==='spawned')?'spawned':data.launches.some(l=>l.state==='actual_close')?'actual_close':'reserved';observed();throw new HostNativeBarrierError('spawn_failed',systemCode(error));}
        const observation:{launch:Launch;closed:boolean;spawned:boolean;error?:NodeJS.ErrnoException}={launch,closed:false,spawned:false};children.set(child,observation);
        child.once('spawn',()=>{
          if(failure)return;
          if(!Number.isSafeInteger(child.pid)||Number(child.pid)<1){uncertain('unknown_launch');return;}
          observation.spawned=true;launch.state='spawned';launch.pid=child.pid;data.state='spawned';observed();
        });
        child.on('error',(error:NodeJS.ErrnoException)=>{observation.error=error;});
        child.once('close',(code,signal)=>{
          observation.closed=true;if(failure)return;
          if(observation.spawned){launch.state='actual_close';launch.exit_code=code;launch.signal=signal;}
          else if(child.pid===undefined&&observation.error&&typeof observation.error.syscall==='string'&&observation.error.syscall.startsWith('spawn ')){
            launch.state='not_spawned';launch.no_spawn_reason='async_spawn_error';
          }else{uncertain('unknown_launch');return;}
          data.state=data.launches.some(l=>l.state==='launching')?'launching':data.launches.some(l=>l.state==='spawned')?'spawned':data.launches.some(l=>l.state==='actual_close')?'actual_close':'reserved';observed();
        });
        return child;
      },
      release:()=>{if(released)return result();releaseRequested=true;return finishRelease();},
    };
    return Object.freeze(lease);
  }
}
