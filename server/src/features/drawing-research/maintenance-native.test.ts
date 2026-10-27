import {installPrivateNativeGateForTest} from "../../../test-support/native-gate.js";
installPrivateNativeGateForTest();
import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {runMaintenanceNative} from './maintenance.js';
import {maintenanceRunner,maintenanceVerificationRunner} from './maintenance-runner.js';
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>(),mockSpawn=vi.fn();return {...actual,spawn:mockSpawn,default:{...actual,spawn:mockSpawn}};});
vi.mock('./jobs.js',()=>({guiExecutable:()=>'/independent/mock/FreeCAD',drawingDefaults:()=>({material:''})}));
const folders:string[]=[];
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.mocked(spawn).mockReset();for(const folder of folders.splice(0))fs.rmSync(folder,{recursive:true,force:true});});
function fixture(verify=false){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-native-contract-'));folders.push(folder);
 const config=path.join(folder,'job.json');fs.writeFileSync(config,'{}');
 const child=Object.assign(new EventEmitter(),{pid:543210,stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn(()=>true)});
 vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
 const prefix=verify?'native-verify':'native-maintain';
 const spec=()=>JSON.parse(fs.readFileSync(config,'utf8'));
 const record=(value:Record<string,unknown>)=>({...value,native_pid:child.pid,native_nonce:spec().native_nonce});
 const report=path.join(folder,verify?'verified.json':'result.json'),progress=path.join(folder,prefix+'-progress.json'),log=path.join(folder,prefix+'.log');
 const start=(signal?:AbortSignal)=>{const pending=runMaintenanceNative(path.join(folder,verify?'verify.FCMacro':'maintain.FCMacro'),folder,folder,config,signal);if(child.pid&&vi.mocked(spawn).mock.results.at(-1)?.value===child)child.emit('spawn');return pending;};
 return {folder,config,child,report,progress,log,start,spec,record};
}
const caught=(promise:Promise<number>)=>promise.then(()=>new Error('unexpected success'),error=>error as Error);
it.each([false,true])('bounds combined stdout/stderr to valid UTF-8 in fixed %s-stage diagnostics',async verify=>{
 const f=fixture(verify),running=f.start(),bytes=Buffer.from('x'.repeat(20000)+'中文🙂');
 f.child.stdout.emit('data',bytes.subarray(0,bytes.length-2));f.child.stdout.emit('data',bytes.subarray(bytes.length-2));f.child.stderr.emit('data',Buffer.from(' stderr tail'));
 fs.writeFileSync(f.report,JSON.stringify(f.record({status:'completed'})));f.child.emit('close',0,null);expect(await running).toBe(f.child.pid);
 const log=fs.readFileSync(f.log);expect(log.byteLength).toBeLessThanOrEqual(8192);expect(log.toString('utf8')).toMatch(/中文🙂 stderr tail$/);expect(log.toString('utf8')).not.toContain('\ufffd');expect(f.spec().native_progress).toBe(f.progress);expect(f.spec().native_verify).toBe(verify);
});
it.each([['checking_reopen',false,true,'checking_reopen'],['verify_checking_templates',true,true,'verify_checking_templates'],['unknown_secret',false,true,'尚未进入任务宏'],['checking_reopen',false,false,'尚未进入任务宏'],['completed',true,true,'尚未进入任务宏']])('[%#] only reports whitelisted PID+nonce-owned phases (%s)',async(phase,verify,owned,expected)=>{
 const f=fixture(Boolean(verify)),running=caught(f.start());fs.writeFileSync(f.progress,JSON.stringify({...f.record({phase}),...(!owned?{native_nonce:'wrong nonce'}:{})}));f.child.stderr.emit('data',Buffer.from('RAW_ENV_SECRET=not returned'));
 let settled=false;void running.then(()=>settled=true);f.child.emit('error',Object.assign(new Error('RAW_ENV_SECRET=not returned'),{code:'EPIPE'}));await Promise.resolve();expect(settled).toBe(false);expect(f.child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');f.child.emit('close',1,null);
 const error=await running;expect(error.message).toContain('阶段：'+expected);expect(error.message).toContain(f.log);expect(error.message).not.toContain('RAW_ENV_SECRET');expect(error.message).not.toContain('unknown_secret');
});
it('keeps the original 180-second timeout and waits for close after SIGTERM/SIGKILL',async()=>{
 vi.useFakeTimers();const f=fixture(),running=caught(f.start());fs.writeFileSync(f.progress,JSON.stringify(f.record({phase:'settling_initial'})));let settled=false;void running.then(()=>settled=true);
 await vi.advanceTimersByTimeAsync(179999);expect(f.child.kill).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(f.child.kill.mock.calls).toEqual([['SIGTERM']]);await vi.advanceTimersByTimeAsync(2000);expect(f.child.kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);expect(settled).toBe(false);f.child.emit('close',null,'SIGKILL');const error=await running;expect(error.message).toContain('180秒');expect(error.message).toContain('settling_initial');expect(vi.getTimerCount()).toBe(0);
});
it.each(['missing','malformed','wrong-pid','wrong-nonce','finalizing'])('rejects a zero exit with a %s report',async condition=>{
 const f=fixture(),running=caught(f.start());if(condition==='missing')fs.unlinkSync(f.report);else if(condition==='malformed')fs.writeFileSync(f.report,'{');else fs.writeFileSync(f.report,JSON.stringify({...f.record({status:condition==='finalizing'?'finalizing':'completed'}),...(condition==='wrong-pid'?{native_pid:1}:condition==='wrong-nonce'?{native_nonce:'not this invocation'}:{})}));f.child.emit('close',0,null);expect((await running).message).toMatch(/报告缺失|未完成/);
});
it('clears stale stage evidence and returns only a sanitized 512-byte task-error summary',async()=>{
 const f=fixture(true);fs.writeFileSync(f.progress,JSON.stringify({phase:'completed'}));fs.writeFileSync(f.report,JSON.stringify({status:'completed',native_pid:f.child.pid}));const running=caught(f.start());
 fs.writeFileSync(f.report,JSON.stringify(f.record({status:'failed',phase:'verify_checking_links',error:'\x1b[31m\n'+ '合成'.repeat(1000)+'\x00'})));f.child.emit('close',0,null);const message=(await running).message;expect(message).toContain('阶段：verify_checking_links');const summary=message.split('任务错误：')[1].split('；诊断日志：')[0];expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(512);expect(summary).not.toMatch(/[\x00-\x1f\x7f\ufffd]/);
});
it('waits on cancellation even when the child kills throw',async()=>{
 vi.useFakeTimers();const f=fixture(),controller=new AbortController(),running=caught(f.start(controller.signal));f.child.kill.mockImplementation(()=>{throw new Error('not returned');});let settled=false;void running.then(()=>settled=true);controller.abort();await vi.advanceTimersByTimeAsync(2000);expect(settled).toBe(false);expect(f.child.kill).toHaveBeenCalledTimes(2);f.child.emit('close',null,'SIGKILL');expect((await running).message).toContain('取消');
});
it('fails closed on post-spawn log failure and retains ownership until close',async()=>{
 vi.useFakeTimers();const f=fixture(),running=caught(f.start()),write=fs.writeFileSync.bind(fs);vi.spyOn(fs,'writeFileSync').mockImplementation((file,data,options)=>{if(String(file)===f.log)throw Object.assign(new Error('SECRET'),{code:'EACCES'});return write(file,data,options);});f.child.stdout.emit('data',Buffer.from('tail'));let settled=false;void running.then(()=>settled=true);await vi.advanceTimersByTimeAsync(2000);expect(f.child.kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);expect(settled).toBe(false);f.child.emit('close',0,null);const error=await running;expect(error.message).toContain('日志写入失败 (EACCES)');expect(error.message).not.toContain('SECRET');
});
it('does not spawn when the owned log cannot be initialized',async()=>{
 const f=fixture(),write=fs.writeFileSync.bind(fs);vi.spyOn(fs,'writeFileSync').mockImplementation((file,data,options)=>{if(String(file)===f.log)throw Object.assign(new Error('SECRET'),{code:'ENOSPC'});return write(file,data,options);});const error=await caught(f.start());expect(spawn).not.toHaveBeenCalled();expect(error.message).toContain('ENOSPC');expect(error.message).toContain(f.log);expect(error.message).not.toContain('SECRET');
});
it.each(['throw','event'])('handles %s startup failures without trusting exception text or signaling another PID',async kind=>{
 const f=fixture();if(kind==='throw')vi.mocked(spawn).mockImplementation(()=>{throw Object.assign(new Error('SECRET'),{code:'ENOENT'});});else Object.assign(f.child,{pid:undefined});const running=caught(f.start());if(kind==='event'){let settled=false;void running.then(()=>settled=true);f.child.emit('error',Object.assign(new Error('SECRET'),{code:'ENOENT',syscall:'spawn /independent/mock/FreeCAD'}));await Promise.resolve();expect(settled).toBe(false);expect(f.child.kill).not.toHaveBeenCalled();f.child.emit('close',-2,null);}const error=await running;expect(error.message).toContain('ENOENT');expect(error.message).not.toContain('SECRET');expect(error.message).toContain('尚未进入任务宏');
});
it.each([maintenanceRunner,maintenanceVerificationRunner])('[%#] persists failure before cleanup and exits even when individual closes/report writes fail',source=>{
 const script=`import ast,types,json\nsource=${JSON.stringify(source)}\nnames={'mark_progress','cleanup_error','write_report','finish_native'}\nfunctions=[n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in names]\nevents=[]\nclass Handle:\n def __enter__(self):return self\n def __exit__(self,*args):pass\nreport_attempts=[]\ndef opened(file,*args,**kw):\n if file.endswith('report.tmp'):\n  report_attempts.append(file)\n  if len(report_attempts)>1:raise OSError('independent report failure')\n return Handle()\ndef dump(value,handle,**kw):events.append(('report' if 'status' in value else 'phase',dict(value)))\ndef close(name):\n events.append(('close',name))\n if name=='First':raise RuntimeError('independent close failure')\nns={'spec':{'native_nonce':'test','native_progress':'progress','report':'report'},'owned':True,'current_phase':'checking_reopen','os':types.SimpleNamespace(getpid=lambda:7,replace=lambda *x:None),'json':types.SimpleNamespace(dump=dump),'open':opened,'traceback':types.SimpleNamespace(print_exc=lambda:None),'A':types.SimpleNamespace(listDocuments=lambda:{'a':types.SimpleNamespace(Name='First'),'b':types.SimpleNamespace(Name='Second')},closeDocument=close),'QtCore':types.SimpleNamespace(QTimer=types.SimpleNamespace(singleShot=lambda delay,fn:(events.append(('quit',None)),fn()))),'QtWidgets':types.SimpleNamespace(QApplication=types.SimpleNamespace(instance=lambda:types.SimpleNamespace(quit=lambda:None)))}\nexec(compile(ast.Module(body=functions,type_ignores=[]),'independent-cleanup','exec'),ns)\nresult={'status':'failed','error':'original failure'};ns['finish_native'](result,'report')\nassert events[0][0]=='phase' and events[1][0]=='report';assert events[1][1]['error']=='original failure';assert events.index(('close','First'))>1;assert ('close','Second') in events;assert ('quit',None) in events;assert result['status']=='failed' and result['error']=='original failure';assert len(report_attempts)>=2\nns['owned']=False\ntry:ns['mark_progress']('opening_source')\nexcept RuntimeError:pass\nelse:raise AssertionError('unowned progress allowed')\nprint('independent report/cleanup/exit passed')\n`;
 const result=spawnSync('python3',['-c',script],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('exit passed');
});
