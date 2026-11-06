import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {zipSync} from 'fflate';
import type {SpawnOptions} from 'node:child_process';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({acquire:vi.fn(),configure:vi.fn(),spawn:vi.fn(),release:vi.fn(),healthy:vi.fn()}));
vi.mock('../src/features/drawing-research/executionGate.js',()=>({acquireDrawingExecution:mocks.acquire,configureDrawingExecutionBarrier:mocks.configure}));
import {createSyntheticGuiThumbnailFixtures,SYNTHETIC_GUI_THUMBNAIL_MACRO} from './thumbnail-worker-fixtures.js';
import {deskToolsRegistrationDirectory} from '../src/lib/deskToolsRegistration.js';

// Native and the actual barrier are simulated; fixture bytes are independent
// opaque ZIPs in private temp roots, not actual FreeCAD or user documents.
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const roots:string[]=[];
let executable:string,directory:string,child:ReturnType<typeof simulatedChild>,autoClose:boolean,writeReceipt:boolean;
let receiptMutation:((receipt:Record<string,unknown>)=>void)|undefined;
let archiveWithoutGui:boolean;
function simulatedChild(){
  const value=Object.assign(new EventEmitter(),{pid:52001,stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn((_signal:string)=>{if(autoClose)queueMicrotask(()=>value.emit('close',null,'SIGTERM'));return false;})});
  return value;
}
beforeEach(()=>{
  vi.resetAllMocks();directory='';autoClose=true;writeReceipt=true;receiptMutation=undefined;archiveWithoutGui=false;
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-gui-fixture-host-test-')));roots.push(root);fs.chmodSync(root,0o700);
  executable=path.join(root,'synthetic-gui-binary');fs.writeFileSync(executable,'never executed',{mode:0o700});
  mocks.acquire.mockReturnValue(Object.assign(mocks.release,{spawn:mocks.spawn,assertHealthy:mocks.healthy}));
  mocks.spawn.mockImplementation((_command:string,_args:string[],options:SpawnOptions)=>{
    directory=String(options.cwd);roots.push(directory);child=simulatedChild();
    queueMicrotask(()=>{
      child.emit('spawn');
      if(!writeReceipt)return;
      const spec=JSON.parse(fs.readFileSync(path.join(directory,'spec.json'),'utf8'));
      expect(JSON.parse(fs.readFileSync(path.join(directory,'owner.json'),'utf8'))).toEqual({version:1,nonce:spec.nonce,expected_pid:child.pid});
      const files=['Plate.FCStd','Spacer.FCStd'].map(rel=>{
        const gui=Buffer.from('<Document><ViewProviderData Count="1"><ViewProvider name="Shape"><Properties><Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property></Properties></ViewProvider></ViewProviderData></Document>');
        const bytes=zipSync({'Document.xml':Buffer.from('<synthetic/>'),...(archiveWithoutGui?{}:{'GuiDocument.xml':gui})});fs.writeFileSync(path.join(directory,rel),bytes);
        return {rel,sha256:sha(bytes),bytes:bytes.length,guiDocumentSha256:sha(gui)};
      });
      const receipt={version:1,nonce:spec.nonce,pid:child.pid,state:'seeded',documents_closed:true,gui_documents_verified:true,files};receiptMutation?.(receipt);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(receipt),{mode:0o600});
      if(autoClose)child.emit('close',0,null);
    });
    return child;
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const flush=async()=>{for(let n=0;n<20;n++)await Promise.resolve();};

describe.runIf(process.platform==='darwin')('synthetic GUI seed Host ownership without Native',()=>{
  it('uses the one real fixed namespace and returns only after exact close with pinned GUI archives',async()=>{
    vi.stubEnv('NODE_OPTIONS','--require untrusted');vi.stubEnv('PHOENIX_FREECAD_SCOPE','full');vi.stubEnv('PYTHONPATH','untrusted');vi.stubEnv('QT_QPA_PLATFORM','offscreen');
    const kill=vi.spyOn(process,'kill');try{
      const result=await createSyntheticGuiThumbnailFixtures({executable});
      expect(mocks.configure).toHaveBeenCalledExactlyOnceWith(path.join(deskToolsRegistrationDirectory(),'native-freecad-v1'));expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^thumbnail-gui-fixture:[a-f0-9-]{36}$/));
      expect(mocks.spawn).toHaveBeenCalledOnce();const [program,args,options]=mocks.spawn.mock.calls[0];expect(program).toBe(executable);expect(args).toContain('ExeVendor=org.phoenix.desk.thumbnailfixture.'+result.proof.nonce.replaceAll('-',''));expect(args).toContain('ExeName=PhoenixThumbnailFixture');expect(args.at(-1)).toBe(path.join(result.directory,'fixture.FCMacro'));
      expect(options).toMatchObject({shell:false,detached:false,stdio:['ignore','pipe','pipe']});for(const key of ['NODE_OPTIONS','PYTHONPATH','QT_QPA_PLATFORM','PHOENIX_FREECAD_SCOPE'])expect(options.env[key]).toBeUndefined();
      for(const key of ['FREECAD_USER_HOME','FREECAD_USER_DATA','FREECAD_USER_TEMP','XDG_CONFIG_HOME','XDG_CONFIG_DIRS','XDG_CACHE_HOME','XDG_DATA_HOME','TMPDIR'])expect(options.env[key].startsWith(result.directory+path.sep)).toBe(true);
      expect(result.files.map(file=>file.rel)).toEqual(['Plate.FCStd','Spacer.FCStd']);expect(result.proof).toMatchObject({pid:52001,actual_close_observed:true,exit_code:0,signal:null,private_configuration:true,fixed_host_barrier:true});expect(result.receipt).toEqual({state:'seeded',documents_closed:true,gui_documents_verified:true});expect(mocks.release).toHaveBeenCalledOnce();expect(child.kill).not.toHaveBeenCalled();expect(kill).not.toHaveBeenCalled();expect(fs.existsSync(path.join(result.directory,'fixture-proof.json'))).toBe(true);
    }finally{kill.mockRestore();}
  });
  it('retains all files and lease after timeout/SIGKILL until actual close, not exit',async()=>{
    vi.useFakeTimers();autoClose=false;writeReceipt=false;let finished=false;const promise=createSyntheticGuiThumbnailFixtures({executable,timeoutMs:100}).catch(error=>{finished=true;return error;});await flush();
    await vi.advanceTimersByTimeAsync(3100);expect(child.kill).toHaveBeenCalledWith('SIGTERM');expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(mocks.release).not.toHaveBeenCalled();expect(fs.existsSync(directory)).toBe(true);expect(finished).toBe(false);
    child.emit('exit',null,'SIGKILL');await flush();expect(mocks.release).not.toHaveBeenCalled();child.emit('close',null,'SIGKILL');expect(await promise).toMatchObject({code:'timeout'});expect(mocks.release).toHaveBeenCalledOnce();expect(JSON.parse(fs.readFileSync(path.join(directory,'failure-proof.json'),'utf8')).actual_close_observed).toBe(true);
  });
  it('cancels only its own child and waits for close even when kill throws',async()=>{
    vi.useFakeTimers();autoClose=false;writeReceipt=false;const controller=new AbortController();const promise=createSyntheticGuiThumbnailFixtures({executable,signal:controller.signal}).catch(error=>error);await flush();vi.mocked(child.kill).mockImplementation(()=>{throw new Error('synthetic kill failure');});controller.abort();await vi.advanceTimersByTimeAsync(3000);expect(mocks.release).not.toHaveBeenCalled();child.emit('close',null,'SIGKILL');expect(await promise).toMatchObject({code:'cancelled'});expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('does not infer close from a child error',async()=>{
    autoClose=false;writeReceipt=false;const promise=createSyntheticGuiThumbnailFixtures({executable}).catch(error=>error);await flush();child.emit('error',new Error('synthetic child failure'));await flush();expect(mocks.release).not.toHaveBeenCalled();child.emit('close',1,null);expect(await promise).toMatchObject({code:'spawn_failed'});expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each(['pid','nonce','state','documents_closed','gui_documents_verified'])('rejects a mismatched %s receipt after close',async field=>{
    receiptMutation=receipt=>{receipt[field]='unbound';};await expect(createSyntheticGuiThumbnailFixtures({executable})).rejects.toMatchObject({code:'receipt_binding_mismatch'});expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('requires actual GuiDocument.xml rather than just a successful native claim',async()=>{
    archiveWithoutGui=true;await expect(createSyntheticGuiThumbnailFixtures({executable})).rejects.toMatchObject({code:'fixture_bytes_changed'});expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('rejects changed source archive bytes against the native bound digest',async()=>{
    receiptMutation=receipt=>{(receipt.files as {sha256:string}[])[0].sha256='0'.repeat(64);};await expect(createSyntheticGuiThumbnailFixtures({executable})).rejects.toMatchObject({code:'fixture_bytes_changed'});
  });
  it('does not create a profile or spawn when the fixed shared gate is busy',async()=>{
    mocks.acquire.mockImplementationOnce(()=>{throw Object.assign(new Error('busy'),{code:'busy'});});await expect(createSyntheticGuiThumbnailFixtures({executable})).rejects.toMatchObject({code:'busy'});expect(mocks.spawn).not.toHaveBeenCalled();expect(mocks.release).not.toHaveBeenCalled();expect(directory).toBe('');
  });
  it('rejects pre-cancellation and MacOS wrapper binary before reserving',async()=>{
    const controller=new AbortController();controller.abort();await expect(createSyntheticGuiThumbnailFixtures({executable,signal:controller.signal})).rejects.toMatchObject({code:'cancelled'});
    const wrapper=path.join(roots[0],'Synthetic.app/Contents/MacOS/FreeCAD');fs.mkdirSync(path.dirname(wrapper),{recursive:true});fs.writeFileSync(wrapper,'opaque',{mode:0o700});await expect(createSyntheticGuiThumbnailFixtures({executable:wrapper})).rejects.toMatchObject({code:'unsafe_gui_binary'});expect(mocks.acquire).not.toHaveBeenCalled();
  });
  it('has only fixed positive geometry and explicit saved visibility, never user inputs or close-all',()=>{
    expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain('Part.makeBox(12,8,3)');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain('Part.makeCylinder(3,9)');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain('obj.ViewObject.Visibility = True');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain("names.count('GuiDocument.xml') == 1");expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain('view.viewAxonometric()');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain('view.fitAll()');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).not.toContain('openDocument(');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).not.toContain('closeAll');expect(SYNTHETIC_GUI_THUMBNAIL_MACRO).toContain('App.listDocuments().get(name) is document');
  });
});
