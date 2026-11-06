/** Manual Native acceptance helper, not a service/API. It has no existing CAD,
 * workspace, profile, script, environment, or gate-scope input. All artifacts are
 * newly generated under os.tmpdir() and deliberately retained for local proof. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {ChildProcess} from 'node:child_process';
import {unzipSync} from 'fflate';
import {acquireDrawingExecution,configureDrawingExecutionBarrier} from '../src/features/drawing-research/executionGate.js';
import {deskToolsRegistrationDirectory} from '../src/lib/deskToolsRegistration.js';
import {checkedBytes,checkedDirectory} from '../src/features/freecad-mcp/resource.js';

export interface SyntheticGuiThumbnailFixtureOptions {
  /** Exact raw GUI binary from the already resolved host runtime; no .app wrapper. */
  executable:string;
  timeoutMs?:number;
  signal?:AbortSignal;
}
export interface SyntheticGuiThumbnailFixtureFile {
  rel:'Plate.FCStd'|'Spacer.FCStd';sha256:string;bytes:number;guiDocumentSha256:string;
}
export interface SyntheticGuiThumbnailFixtureProof {
  version:1;nonce:string;pid:number|null;actual_close_observed:boolean;
  exit_code:number|null;signal:NodeJS.Signals|null;output_bytes:number;
  termination_requests:string[];private_configuration:true;fixed_host_barrier:true;
}
export interface SyntheticGuiThumbnailFixtureResult {
  directory:string;files:SyntheticGuiThumbnailFixtureFile[];
  receipt:{state:'seeded';documents_closed:true;gui_documents_verified:true};
  proof:SyntheticGuiThumbnailFixtureProof;
}
class SyntheticGuiThumbnailFixtureError extends Error {
  constructor(readonly code:string){super('独立 GUI 样件尚未安全验收：'+code);this.name='SyntheticGuiThumbnailFixtureError';}
}
const fail=(code:string):never=>{throw new SyntheticGuiThumbnailFixtureError(code);};
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function writeNew(filename:string,bytes:string){
  const fd=fs.openSync(filename,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function environment(root:string):NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1'};
  for(const key of ['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','LC_CTYPE','TZ','DISPLAY']){
    const value=process.env[key];if(value!==undefined&&value.length<=8192&&!value.includes('\0'))env[key]=value;
  }
  return {...env,FREECAD_USER_HOME:path.join(root,'profile'),FREECAD_USER_DATA:path.join(root,'data'),FREECAD_USER_TEMP:path.join(root,'temp'),
    XDG_CONFIG_HOME:path.join(root,'config/qt'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_DATA_HOME:path.join(root,'xdg-data'),
    TMPDIR:path.join(root,'temp'),TMP:path.join(root,'temp'),TEMP:path.join(root,'temp')};
}

// Fixed, host-authored GUI macro. It never reads a CAD path. Qt callbacks are
// closures in one entry function because FreeCAD macro globals/locals differ.
export const SYNTHETIC_GUI_THUMBNAIL_MACRO=String.raw`
def _desk_fixture_entry():
    import os, json, time, hashlib, zipfile, xml.etree.ElementTree as ET
    from pathlib import Path
    import FreeCAD as App
    import FreeCADGui as Gui
    from PySide import QtCore
    root = Path.cwd()
    spec = json.loads((root / 'spec.json').read_text())
    nonce = spec['nonce']
    owned = {}
    files = []
    application = QtCore.QCoreApplication.instance()
    window = Gui.getMainWindow()
    def finish(payload):
        payload.update({'version':1, 'nonce':nonce, 'pid':os.getpid()})
        with (root / 'result.json').open('x') as output:
            json.dump(payload, output, separators=(',',':'))
            output.flush()
            os.fsync(output.fileno())
        QtCore.QTimer.singleShot(0, application.quit)
    def blocked(error):
        # Close only exact document wrappers created below, never close-all.
        for name, document in tuple(owned.items()):
            try:
                if App.listDocuments().get(name) is document:
                    App.closeDocument(name)
            except Exception:
                pass
        try:
            (root / 'native-exception.log').write_text(type(error).__name__ + '\n' + str(error))
            finish({'state':'blocked','reason':'gui_fixture_not_verified'})
        except Exception:
            QtCore.QTimer.singleShot(0, application.quit)
    try:
        assert set(spec) == {'version','nonce'} and spec['version'] == 1
        assert App.GuiUp and application is not None and window is not None, 'gui_required'
        assert not App.listDocuments(), 'unexpected_document'
        for key in ('FREECAD_USER_HOME','FREECAD_USER_DATA','FREECAD_USER_TEMP'):
            location = Path(os.environ[key])
            assert location.resolve().is_relative_to(root) and location.is_dir() and not location.is_symlink()
        for key, name in (('UserParameter','user.cfg'),('SystemParameter','system.cfg')):
            assert Path(App.ConfigGet(key)).resolve() == root / name, 'actual_configuration_mismatch'
        assert Path(App.getUserAppDataDir()).resolve().is_relative_to(root), 'actual_data_directory_mismatch'
        assert App.ConfigGet('ExeVendor') == 'org.phoenix.desk.thumbnailfixture.' + nonce.replace('-',''), 'qt_identity_mismatch'
        assert App.ConfigGet('ExeName') == 'PhoenixThumbnailFixture', 'qt_identity_mismatch'
        deadline = time.monotonic() + 10
        while not (root / 'owner.json').exists():
            assert time.monotonic() < deadline, 'owner_timeout'
            time.sleep(0.01)
        owner = json.loads((root / 'owner.json').read_text())
        assert owner == {'version':1,'nonce':nonce,'expected_pid':os.getpid()}, 'owner_mismatch'
        import Part
        import PartGui
        window.showNormal()
    except Exception as error:
        blocked(error)
        return
    def create(index):
        try:
            assert not App.listDocuments(), 'unexpected_document'
            name = ('Plate','Spacer')[index]
            document = App.newDocument(name)
            owned[document.Name] = document
            obj = document.addObject('Part::Feature','Shape')
            obj.Shape = Part.makeBox(12,8,3) if index == 0 else Part.makeCylinder(3,9)
            document.recompute()
            assert not obj.Shape.isNull() and obj.Shape.Volume > 0
            assert obj.ViewObject is not None
            obj.ViewObject.Visibility = True
            assert obj.ViewObject.Visibility is True
            assert App.ActiveDocument is document and Gui.activeDocument() is Gui.getDocument(document.Name)
            view = Gui.getDocument(document.Name).activeView()
            view.viewAxonometric()
            view.fitAll()
            # Let only this new GUI's normal event loop settle its own view.
            QtCore.QTimer.singleShot(250, lambda: save_close(index, document, obj))
        except Exception as error:
            blocked(error)
    def save_close(index, document, obj):
        try:
            assert App.listDocuments() == {document.Name:document}, 'document_identity_changed'
            assert owned.get(document.Name) is document and obj.Document is document
            assert obj.ViewObject.Visibility is True, 'fixture_not_visible'
            rel = ('Plate.FCStd','Spacer.FCStd')[index]
            target = root / rel
            assert not target.exists(), 'fixture_target_exists'
            document.saveAs(str(target))
            with zipfile.ZipFile(target) as archive:
                names = archive.namelist()
                assert len(names) <= 128 and names.count('GuiDocument.xml') == 1 and names.count('Document.xml') == 1
                assert archive.getinfo('GuiDocument.xml').file_size <= 2*1024*1024
                gui_xml = archive.read('GuiDocument.xml')
            gui_root = ET.fromstring(gui_xml)
            providers = [item for item in gui_root.findall('.//ViewProvider') if item.get('name') == obj.Name]
            assert len(providers) == 1, 'gui_view_provider_missing'
            visibility = providers[0].find("./Properties/Property[@name='Visibility']/Bool")
            assert visibility is not None and visibility.get('value') in ('true','1'), 'saved_visibility_missing'
            content = target.read_bytes()
            files.append({'rel':rel,'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),
                          'guiDocumentSha256':hashlib.sha256(gui_xml).hexdigest()})
            name = document.Name
            App.closeDocument(name)
            owned.pop(name)
            assert not App.listDocuments(), 'fixture_document_not_closed'
            if index == 0:
                QtCore.QTimer.singleShot(0, lambda: create(1))
            else:
                finish({'state':'seeded','documents_closed':True,'gui_documents_verified':True,'files':files})
        except Exception as error:
            blocked(error)
    QtCore.QTimer.singleShot(0, lambda: create(0))
_desk_fixture_entry()
`;

function checkedFixtures(root:string,receipt:Record<string,unknown>):SyntheticGuiThumbnailFixtureFile[] {
  const claimedFiles=receipt.files;
  if(!Array.isArray(claimedFiles)||claimedFiles.length!==2)return fail('invalid_fixture_receipt');
  return (['Plate.FCStd','Spacer.FCStd'] as const).map((rel,index)=>{
    const claimed=claimedFiles[index];if(!record(claimed))return fail('invalid_fixture_receipt');
    const bytes=checkedBytes(path.join(root,rel),16*1024*1024);let count=0;
    const files=unzipSync(bytes,{filter:entry=>{if(++count>128||entry.name==='GuiDocument.xml'&&entry.originalSize>2*1024*1024)fail('invalid_fixture_archive');return entry.name==='GuiDocument.xml';}});
    const gui=files['GuiDocument.xml'];
    if(!gui?.length||Object.keys(files).length!==1||claimed.rel!==rel||claimed.bytes!==bytes.length||claimed.sha256!==sha(bytes)||claimed.guiDocumentSha256!==sha(gui))return fail('fixture_bytes_changed');
    return {rel,sha256:sha(bytes),bytes:bytes.length,guiDocumentSha256:sha(gui)};
  });
}

/** Uses the production fixed host reservation; errors and timeouts are not exit
 * proof. Until the exact child emits close, both the lease and all files remain. */
export async function createSyntheticGuiThumbnailFixtures(options:SyntheticGuiThumbnailFixtureOptions):Promise<SyntheticGuiThumbnailFixtureResult> {
  if(process.platform!=='darwin')fail('unsupported_platform');
  const timeoutMs=options.timeoutMs??120_000;
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>180_000)fail('invalid_timeout');
  if(options.signal?.aborted)fail('cancelled');
  const executable=path.resolve(options.executable);checkedDirectory(path.dirname(executable));const stat=fs.lstatSync(executable);
  if(executable!==options.executable||fs.realpathSync(executable)!==executable||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||/\/Contents\/MacOS\/FreeCAD$/i.test(executable))fail('unsafe_gui_binary');
  fs.accessSync(executable,fs.constants.X_OK);
  configureDrawingExecutionBarrier(path.join(deskToolsRegistrationDirectory(),'native-freecad-v1'));
  const lease=acquireDrawingExecution('thumbnail-gui-fixture:'+randomUUID());
  const proof:SyntheticGuiThumbnailFixtureProof={version:1,nonce:randomUUID(),pid:null,actual_close_observed:false,exit_code:null,signal:null,output_bytes:0,termination_requests:[],private_configuration:true,fixed_host_barrier:true};
  let root='';
  try{
    lease.assertHealthy();root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-thumbnail-gui-fixture-')));fs.chmodSync(root,0o700);
    for(const rel of ['profile','profile/Mod','data','data/Mod','temp','config','config/qt','config/qt-system','cache','xdg-data'])fs.mkdirSync(path.join(root,rel),{mode:0o700});
    writeNew(path.join(root,'spec.json'),JSON.stringify({version:1,nonce:proof.nonce}));
    writeNew(path.join(root,'fixture.FCMacro'),SYNTHETIC_GUI_THUMBNAIL_MACRO);
    writeNew(path.join(root,'user.cfg'),'<?xml version="1.0"?><FCParameters><FCParamGroup Name="Root"><FCParamGroup Name="BaseApp"><FCParamGroup Name="Preferences"><FCParamGroup Name="General"><FCText Name="AutoloadModule">PartWorkbench</FCText></FCParamGroup></FCParamGroup></FCParamGroup></FCParamGroup></FCParameters>');
    writeNew(path.join(root,'system.cfg'),'<?xml version="1.0"?><FCParameters><FCParamGroup Name="Root"/></FCParameters>');
    const env=environment(root);env.XDG_CONFIG_DIRS=path.join(root,'config/qt-system');
    const vendor='org.phoenix.desk.thumbnailfixture.'+proof.nonce.replaceAll('-','');
    await new Promise<void>((resolve,reject)=>{
      let child:ChildProcess,reason:string|undefined,hardTimer:ReturnType<typeof setTimeout>|undefined,closed=false;
      const stop=(code:string)=>{
        if(closed)return;reason??=code;proof.termination_requests.push('SIGTERM');try{child.kill('SIGTERM');}catch{proof.termination_requests.push('SIGTERM_failed');}
        hardTimer??=setTimeout(()=>{if(!closed){proof.termination_requests.push('SIGKILL');try{child.kill('SIGKILL');}catch{proof.termination_requests.push('SIGKILL_failed');}}},3000);
      };
      child=lease.spawn(executable,['--set-config','ExeVendor='+vendor,'ExeName=PhoenixThumbnailFixture','--user-cfg',path.join(root,'user.cfg'),'--system-cfg',path.join(root,'system.cfg'),path.join(root,'fixture.FCMacro')],{cwd:root,env,shell:false,detached:false,stdio:['ignore','pipe','pipe']});
      const timer=setTimeout(()=>stop('timeout'),timeoutMs),abort=()=>stop('cancelled');options.signal?.addEventListener('abort',abort,{once:true});
      const output:Buffer[]=[];
      for(const stream of [child.stdout,child.stderr]){
        stream?.on('error',()=>stop('stdio_failed'));
        stream?.on('data',(chunk:Buffer)=>{proof.output_bytes+=chunk.length;if(proof.output_bytes<=1024*1024)output.push(Buffer.from(chunk));else stop('output_limit');});
      }
      child.once('spawn',()=>{
        try{lease.assertHealthy();if(!Number.isSafeInteger(child.pid)||Number(child.pid)<1)fail('pid_missing');proof.pid=Number(child.pid);writeNew(path.join(root,'owner.json'),JSON.stringify({version:1,nonce:proof.nonce,expected_pid:proof.pid}));}
        catch{stop('ownership_failed');}
      });
      child.on('error',()=>{reason??='spawn_failed';});
      child.once('close',(code,signal)=>{
        closed=true;proof.actual_close_observed=true;proof.exit_code=code;proof.signal=signal;clearTimeout(timer);if(hardTimer)clearTimeout(hardTimer);options.signal?.removeEventListener('abort',abort);
        try{writeNew(path.join(root,'native-diagnostic.log'),Buffer.concat(output).toString('utf8'));}catch{/* Not an ownership proof. */}
        if(reason||code!==0||signal)reject(new SyntheticGuiThumbnailFixtureError(reason??'native_failed'));else resolve();
      });
      if(options.signal?.aborted)abort();
    });
    lease.assertHealthy();
    const receipt:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(checkedBytes(path.join(root,'result.json'),32*1024)));
    if(!record(receipt)||receipt.version!==1||receipt.nonce!==proof.nonce||receipt.pid!==proof.pid||!proof.actual_close_observed||receipt.state!=='seeded'||receipt.documents_closed!==true||receipt.gui_documents_verified!==true)return fail('receipt_binding_mismatch');
    const files=checkedFixtures(root,receipt);writeNew(path.join(root,'fixture-proof.json'),JSON.stringify({proof,files}));
    return {directory:root,files,receipt:{state:'seeded',documents_closed:true,gui_documents_verified:true},proof};
  }catch(error){
    if(root)try{writeNew(path.join(root,'failure-proof.json'),JSON.stringify(proof));}catch{/* Retain all available evidence. */}
    throw error instanceof SyntheticGuiThumbnailFixtureError?error:new SyntheticGuiThumbnailFixtureError('gui_fixture_unverified');
  }finally{lease();}
}
