import {installPrivateNativeGateForTest} from "../../../test-support/native-gate.js";
installPrivateNativeGateForTest();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {afterEach,expect,it,vi} from 'vitest';
import {acquireDrawingExecution} from './executionGate.js';
const mocks=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();return {...actual,spawn:mocks.spawn,default:{...actual,spawn:mocks.spawn}};});
vi.mock('./jobs.js',()=>({guiExecutable:()=>'/synthetic/freecad'}));
import {previewTitleblock} from './sync.js';
const folders:string[]=[];
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sync-owned-test-'));folders.push(root);fs.writeFileSync(path.join(root,'Sheet.Drawing.FCStd'),'synthetic file path only');const child=Object.assign(new EventEmitter(),{pid:654321,kill:vi.fn(()=>true)});mocks.spawn.mockReturnValue(child);return {root,child};}
afterEach(()=>{vi.restoreAllMocks();mocks.spawn.mockReset();folders.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true}));});
it('kills only its own child on owner-file write failure, holds the gate until close, and does not treat PID error as exit',async()=>{const {root,child}=fixture(),write=fs.writeFileSync;vi.spyOn(fs,'writeFileSync').mockImplementation((...args)=>{if(String(args[0]).endsWith('job.json')&&String(args[1]).includes('expected_pid'))throw new Error('synthetic owner-file failure');return write(...args);});let settled=false;const task=previewTitleblock(root,'Sheet.Drawing.FCStd');child.emit('spawn');const result=task.catch(error=>{settled=true;return error;});await Promise.resolve();expect(child.kill).toHaveBeenCalledWith('SIGTERM');expect(settled).toBe(false);expect(()=>acquireDrawingExecution('other')).toThrow('已有');child.emit('error',new Error('synthetic child PID error'));await Promise.resolve();expect(settled).toBe(false);child.emit('close',1);expect((await result).message).toContain('synthetic owner-file failure');acquireDrawingExecution('after-close')();});
it('prepends the process guard before the bridge that can open or close native documents',async()=>{const {root,child}=fixture();const task=previewTitleblock(root,'Sheet.Drawing.FCStd');child.emit('spawn');const result=task.catch(error=>error);const args=mocks.spawn.mock.calls[0][1] as string[],macro=args[args.length-1],text=fs.readFileSync(macro,'utf8');expect(text.indexOf("_owner_spec.get('expected_pid') != _owner_os.getpid()")).toBeLessThan(text.indexOf('import FreeCAD as A'));expect(text.indexOf("_owner_spec.get('expected_pid') != _owner_os.getpid()")).toBeLessThan(text.indexOf('A.openDocument('));child.emit('close',1);await result;acquireDrawingExecution('after-guard-test')();});
it('waits for close after an asynchronous no-PID spawn error and never signals an unknown PID',async()=>{
 const {root,child}=fixture();Object.assign(child,{pid:undefined});let settled=false;
 const result=previewTitleblock(root,'Sheet.Drawing.FCStd').catch(error=>{settled=true;return error;});
 child.emit('error',Object.assign(new Error('synthetic missing command ENOENT'),{code:'ENOENT',syscall:'spawn /synthetic/freecad'}));
 await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);expect(child.kill).not.toHaveBeenCalled();expect(()=>acquireDrawingExecution('before-no-spawn-close')).toThrow('已有');
 child.emit('close',-2,null);expect(await result).toBeInstanceOf(Error);acquireDrawingExecution('after-no-spawn-close')();
});
