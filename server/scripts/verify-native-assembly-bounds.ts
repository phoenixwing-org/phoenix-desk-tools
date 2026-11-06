/** Manual independent-fixture QA only. No user CAD, workspace, output directory,
 * profile or script is accepted. Native work requires --allow-native and the
 * normal fixed host gate; an occupied/unknown gate is a blocker, never cleared.
 * Receipts and generated fixtures stay in a private temporary directory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildFreecadChildEnvironment,resolveFreecadCommand} from '../src/lib/freecadProcessSecurity.js';
import {deskToolsRegistrationDirectory} from '../src/lib/deskToolsRegistration.js';
import {acquireDrawingExecution,configureDrawingExecutionBarrier} from '../src/features/drawing-research/executionGate.js';
import {readGeometryBatch,type GeometryInput} from '../src/features/part-gallery/geometryRunner.js';
import {geometrySnapshot} from '../src/features/part-gallery/geometryService.js';

const MAX_SOURCE=64*1024*1024,MAX_BINARY=256*1024*1024,MAX_REPORT=512*1024,MAX_OUTPUT=256*1024;
const TOLERANCE=1e-6;
const SOURCE_FILES=['server/scripts/verify-native-assembly-bounds.ts','server/src/features/part-gallery/geometryRunner.ts',
 'server/src/features/part-gallery/geometryService.ts','server/src/features/part-gallery/geometryStorage.ts','server/src/features/part-gallery/storage.ts',
 'server/src/lib/fcstdDocumentXmlService.ts','server/src/lib/fcstdNativeXlinkFiles.ts','server/src/lib/fcstdBatchFiles.ts',
 'server/src/lib/freecadProcessSecurity.ts','server/src/lib/deskToolsRegistration.ts',
 'server/src/features/drawing-research/executionGate.ts','server/src/features/cad-native-measurement/host-barrier.ts'];
class Failure extends Error{constructor(readonly code:string){super(code);}}
function check(value:unknown,code:string):asserts value{if(!value)throw new Failure(code);}
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const stamp=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].join(':');
function fingerprint(filename:string,limit:number){
 const before=fs.lstatSync(filename,{bigint:true});check(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(limit),'unsafe_file');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  check(stamp(fs.fstatSync(fd,{bigint:true}))===stamp(before),'file_changed');
  const bytes=Buffer.alloc(Number(before.size)+1);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!n)break;offset+=n;}
  check(BigInt(offset)===before.size&&stamp(fs.fstatSync(fd,{bigint:true}))===stamp(before)&&stamp(fs.lstatSync(filename,{bigint:true}))===stamp(before),'file_changed');
  return {bytes:offset,sha256:digest(bytes.subarray(0,offset))};
 }finally{fs.closeSync(fd);}
}
function sourceHashes(){const repo=fileURLToPath(new URL('../../',import.meta.url));return Object.fromEntries(SOURCE_FILES.map(rel=>[rel,fingerprint(path.join(repo,rel),1024*1024)]));}
function jsonFile(filename:string):Record<string,unknown>{
 const before=fingerprint(filename,MAX_REPORT),bytes=fs.readFileSync(filename);check(bytes.length===before.bytes&&digest(bytes)===before.sha256,'report_changed');
 const result:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));check(result&&typeof result==='object'&&!Array.isArray(result),'invalid_report');return result as Record<string,unknown>;
}
function environment(folder:string){
 const locations=Object.fromEntries(['home','data','temp','xdg-config','xdg-cache','xdg-data'].map(name=>{const location=path.join(folder,name);fs.mkdirSync(location,{mode:0o700});return[name,location];}));
 return {...buildFreecadChildEnvironment(process.env),FREECAD_USER_HOME:locations.home,FREECAD_USER_DATA:locations.data,FREECAD_USER_TEMP:locations.temp,
  XDG_CONFIG_HOME:locations['xdg-config'],XDG_CACHE_HOME:locations['xdg-cache'],XDG_DATA_HOME:locations['xdg-data'],TMPDIR:locations.temp,TMP:locations.temp,TEMP:locations.temp};
}
const COMMON=String.raw`
import json, math, os, time
from pathlib import Path
import FreeCAD as App
import Part
root = Path.cwd().resolve()
spec = json.loads((root / 'spec.json').read_text(encoding='utf-8'))
if set(spec) != {'nonce'} or not isinstance(spec['nonce'], str) or len(spec['nonce']) != 36:
    raise RuntimeError('invalid own spec')
for key, directory in {'UserHomePath':'home','UserConfigPath':'home','UserAppData':'data','UserCachePath':'temp','AppTempPath':'temp'}.items():
    if Path(App.ConfigGet(key)).resolve() != (root / directory).resolve():
        raise RuntimeError('private path mismatch')
if App.listDocuments():
    raise RuntimeError('unexpected existing documents')
def bounds(box):
    return [float(box.XMin),float(box.YMin),float(box.ZMin),float(box.XMax),float(box.YMax),float(box.ZMax)]
def lengths(box):
    return [box[3]-box[0],box[4]-box[1],box[5]-box[2]]
def union(boxes):
    return [min(b[i] for b in boxes) for i in range(3)] + [max(b[i] for b in boxes) for i in range(3,6)]
def from_points(points):
    return [min(getattr(p,k) for p in points) for k in ('x','y','z')] + [max(getattr(p,k) for p in points) for k in ('x','y','z')]
def corners(p, low, high):
    return from_points([p.multVec(App.Vector(x,y,z)) for x in (low[0],high[0]) for y in (low[1],high[1]) for z in (low[2],high[2])])
def analytic(kind, p):
    if kind == 'box':
        return corners(p,[0,0,0],[12,7,3])
    center=p.multVec(App.Vector(0,0,5.5)); axis=p.Rotation.multVec(App.Vector(0,0,1))
    half=[5.5*abs(getattr(axis,k))+3*math.sqrt(max(0,1-getattr(axis,k)**2)) for k in ('x','y','z')]
    return [getattr(center,k)-half[i] for i,k in enumerate(('x','y','z'))] + [getattr(center,k)+half[i] for i,k in enumerate(('x','y','z'))]
def local_corners(kind,p):
    return corners(p,[0,0,0],[12,7,3]) if kind=='box' else corners(p,[-3,-3,0],[3,3,11])
def placement(axis, angle, xyz):
    return App.Placement(App.Vector(*xyz),App.Rotation(App.Vector(*axis),angle))
def frozen_document(doc):
    return [(o.Name,tuple(str(v) for v in o.State),tuple(o.Placement.toMatrix().A) if hasattr(o,'Placement') else None) for o in doc.Objects]
def poses(doc):
    return [{'name':o.Name,'type':o.TypeId,'matrix':list(o.Placement.toMatrix().A)} for o in doc.Objects if hasattr(o,'Placement')]
`;
export const CREATE_ASSEMBLY_FIXTURES=COMMON+String.raw`
report={'version':1,'state':'failed','nonce':spec['nonce'],'pid':os.getpid()}
doc=None
try:
    cases=[]
    native_available=False
    probe=App.newDocument('IndependentAssemblyApi')
    try:
        native=probe.addObject('Assembly::AssemblyObject','AssemblyProbe')
        native_available=native is not None and native.TypeId=='Assembly::AssemblyObject'
        probe_link=probe.addObject('Assembly::AssemblyLink','AssemblyLinkProbe')
        api={'assembly_type':native.TypeId,'assembly_link_type':probe_link.TypeId,
             'assembly_properties':list(native.PropertiesList),'assembly_link_properties':list(probe_link.PropertiesList),
             'get_shape_doc':str(Part.getShape.__doc__)[:8000],
             'optimal_bbox_available':hasattr(Part.makeBox(1,1,1),'optimalBoundingBox')}
    except Exception:
        api={'assembly_available':False,'get_shape_doc':str(Part.getShape.__doc__)[:8000],
             'optimal_bbox_available':hasattr(Part.makeBox(1,1,1),'optimalBoundingBox')}
    finally:
        App.closeDocument(probe.Name)
    report['api']=api
    def create(name,native_kind=False,nested=False,cylinder=False,hidden=False,helpers=False,ordinary=False):
        global doc
        doc=App.newDocument(name)
        doc.CreatedBy='Independent synthetic assembly QA';doc.LastModifiedBy='Independent synthetic assembly QA';doc.Company=''
        root_obj=doc.addObject('Assembly::AssemblyObject' if native_kind else 'App::Part','FixtureRoot')
        root_obj.Placement=placement((0,0,1),19,(13,-5,2)) if nested else placement((1,1,0),17,(9,4,-2))
        if native_kind:
            root_obj.newObject('Assembly::JointGroup','Joints')
        recipes=[]
        if nested:
            sub=doc.addObject('Assembly::AssemblyObject' if native_kind else 'App::Part','SubDefinition')
            if native_kind: sub.newObject('Assembly::JointGroup','SubJoints')
            sub.Placement=placement((1,0,0),27,(-3,4,6))
            for kind,p in [('box',placement((0,1,0),24,(0,0,0))),('cylinder',placement((1,0,0),50,(-10,0,5)))]:
                f=sub.newObject('Part::Feature','Source'+kind)
                f.Shape=Part.makeBox(12,7,3) if kind=='box' else Part.makeCylinder(3,11)
                f.addProperty('App::PropertyString','FixtureKind');f.FixtureKind=kind
                f.Placement=p
                if hidden and 'Visibility' in f.PropertiesList: f.Visibility=False
            if hidden and 'Visibility' in sub.PropertiesList: sub.Visibility=False
            for i,p in enumerate([placement((0,0,1),0,(0,0,0)),placement((0,0,1),-40,(28,-7,5))]):
                link=root_obj.newObject('Assembly::AssemblyLink' if native_kind else 'App::Link','Instance'+str(i))
                link.LinkedObject=sub
                if 'LinkTransform' in link.PropertiesList: link.LinkTransform=True
                link.Placement=p
                if 'Rigid' in link.PropertiesList: link.Rigid=(i==0)
                if hidden and 'Visibility' in link.PropertiesList: link.Visibility=(i==0)
                for kind,f in [('box',sub.getObject('Sourcebox') if hasattr(sub,'getObject') else doc.getObject('Sourcebox')),('cylinder',doc.getObject('Sourcecylinder'))]:
                    recipes.append((kind,root_obj.Placement.multiply(p).multiply(sub.Placement).multiply(f.Placement)))
        else:
            kind='cylinder' if cylinder else 'box'
            f=root_obj.newObject('Part::Feature','SourceSolid');f.Shape=Part.makeCylinder(3,11) if cylinder else Part.makeBox(12,7,3)
            f.addProperty('App::PropertyString','FixtureKind');f.FixtureKind=kind
            f.Placement=placement((1,2,3),37,(-6,8,1)) if cylinder else placement((0,0,1),33,(2,-3,5))
            recipes.append((kind,root_obj.Placement.multiply(f.Placement)))
        if helpers:
            import Sketcher
            sketch=root_obj.newObject('Sketcher::SketchObject','RemoteSketch')
            sketch.addGeometry(Part.LineSegment(App.Vector(1000,1000,1000),App.Vector(1200,1100,1000)),False)
            datum=root_obj.newObject('PartDesign::Plane','RemoteDatum')
            datum.Placement=placement((0,0,1),0,(2000,2000,2000))
        if ordinary:
            independent=root_obj.newObject('Part::Feature','IndependentSolid');independent.Shape=Part.makeBox(12,7,3)
            independent.addProperty('App::PropertyString','FixtureKind');independent.FixtureKind='box'
            independent.Placement=placement((0,1,0),15,(-20,-10,-3))
            recipes.append(('box',root_obj.Placement.multiply(independent.Placement)))
        # Only construction may recompute/save; the separate reopened read below never does.
        doc.recompute()
        expected=union([analytic(kind,p) for kind,p in recipes]);coarse=union([local_corners(kind,p) for kind,p in recipes])
        source=name+'.FCStd';doc.saveAs(str(root/source));saved_poses=poses(doc);App.closeDocument(doc.Name);doc=None
        cases.append({'name':name,'source':source,'node':'FixtureRoot','native_assembly':native_kind,
                      'expected':expected,'local_corner_envelope':coarse,'instances':len(recipes),
                      'recipes':[{'kind':kind,'matrix':list(p.toMatrix().A)} for kind,p in recipes],'saved_poses':saved_poses,
                      'hidden_definitions':hidden,'has_remote_helpers':helpers,
                      'expected_volume':sum(12*7*3 if kind=='box' else math.pi*9*11 for kind,p in recipes)})
    create('RotatedBox')
    create('RotatedCylinder',cylinder=True)
    create('NestedRepeatedPart',nested=True)
    create('HiddenRepeatedPart',nested=True,hidden=True)
    create('PartWithHelpers',helpers=True)
    if native_available:
        create('NativeAssembly',native_kind=True)
        create('NativeNestedRepeated',native_kind=True,nested=True)
        create('NativeHiddenRepeated',native_kind=True,nested=True,hidden=True)
        create('NativeWithHelpers',native_kind=True,helpers=True)
        create('NativeDerivedHost',native_kind=True,nested=True,ordinary=True)
    def external_case(name,native_kind):
        global doc
        library=App.newDocument(name+'Library')
        definition=library.addObject('Assembly::AssemblyObject' if native_kind else 'App::Part','ExternalRoot')
        f=definition.newObject('Part::Feature','ExternalSolid');f.Shape=Part.makeBox(12,7,3)
        f.addProperty('App::PropertyString','FixtureKind');f.FixtureKind='box';f.Placement=placement((0,0,1),31,(2,4,6));f.Visibility=False
        definition.Visibility=False
        library.recompute();library.saveAs(str(root/(name+'Library.FCStd')))
        doc=App.newDocument(name);doc.CreatedBy='Independent synthetic assembly QA';doc.LastModifiedBy='Independent synthetic assembly QA';doc.Company=''
        host=doc.addObject('Assembly::AssemblyObject' if native_kind else 'App::Part','FixtureRoot');host.Placement=placement((0,1,0),23,(8,3,-4))
        # Cross-document XLinks require both ends to have file identities.
        doc.recompute();doc.saveAs(str(root/(name+'.FCStd')))
        recipes=[]
        for i,p in enumerate([placement((0,0,1),0,(0,0,0)),placement((0,0,1),-37,(25,-8,7))]):
            link=host.newObject('Assembly::AssemblyLink' if native_kind else 'App::Link','ExternalInstance'+str(i));link.LinkedObject=definition
            if 'LinkTransform' in link.PropertiesList: link.LinkTransform=True
            link.Placement=p
            if 'Rigid' in link.PropertiesList: link.Rigid=True
            link.Visibility=(i==0)
            recipes.append(('box',host.Placement.multiply(p).multiply(f.Placement)))
        doc.recompute();doc.saveAs(str(root/(name+'.FCStd')));saved_poses=poses(doc)
        App.closeDocument(doc.Name);doc=None;App.closeDocument(library.Name)
        cases.append({'name':name,'source':name+'.FCStd','node':'FixtureRoot','native_assembly':native_kind,'external':True,
            'expected':union([analytic(kind,p) for kind,p in recipes]),'local_corner_envelope':union([local_corners(kind,p) for kind,p in recipes]),
            'instances':2,'expected_volume':504,'saved_poses':saved_poses,'recipes':[{'kind':kind,'matrix':list(p.toMatrix().A)} for kind,p in recipes]})
    external_case('ExternalPartHost',False)
    if native_available: external_case('ExternalNativeHost',True)
    # The file exists but its first XLink target name is invalid. This independent
    # negative must not be mistaken for a complete non-empty partial assembly.
    import zipfile, xml.etree.ElementTree as ET
    negative=dict(next(c for c in cases if c['name']=='ExternalPartHost'))
    negative.update(name='MissingExternalTarget',source='MissingExternalTarget.FCStd',expected_failure=True)
    with zipfile.ZipFile(root/'ExternalPartHost.FCStd','r') as original:
        files={i.filename:original.read(i.filename) for i in original.infolist()}
    xml=ET.fromstring(files['Document.xml']);links=list(xml.iter('XLink'))
    if not links: raise RuntimeError('missing synthetic external link')
    links[0].set('name','AbsentExternalRoot');files['Document.xml']=ET.tostring(xml,encoding='utf-8')
    with zipfile.ZipFile(root/negative['source'],'x',compression=zipfile.ZIP_DEFLATED) as altered:
        for name,data in files.items(): altered.writestr(name,data)
    cases.append(negative)
    if native_available:
        for name,all_items in [('StaleNativeGroupPartial',False),('StaleNativeGroupEmpty',True)]:
            negative=dict(next(c for c in cases if c['name']=='NativeDerivedHost'))
            negative.update(name=name,source=name+'.FCStd',expected_failure=True)
            with zipfile.ZipFile(root/'NativeDerivedHost.FCStd','r') as original:
                files={i.filename:original.read(i.filename) for i in original.infolist()}
            xml=ET.fromstring(files['Document.xml']);changed=False
            for data in xml.findall('ObjectData/Object'):
                if data.get('name')!='Instance0': continue
                for prop in data.findall('Properties/Property'):
                    if prop.get('name')!='Group': continue
                    sequence=prop.find('LinkList')
                    if sequence is None or not list(sequence): continue
                    for member in list(sequence) if all_items else list(sequence)[:1]: sequence.remove(member)
                    sequence.set('count',str(len(list(sequence))));changed=True
            if not changed: raise RuntimeError('synthetic group carrier missing')
            files['Document.xml']=ET.tostring(xml,encoding='utf-8')
            with zipfile.ZipFile(root/negative['source'],'x',compression=zipfile.ZIP_DEFLATED) as altered:
                for entry,data in files.items(): altered.writestr(entry,data)
            cases.append(negative)
    report.update(state='created',cases=cases,api=api,version_components=[str(v) for v in App.Version()[:3]],occ_version=str(Part.OCC_VERSION),
                  private_paths_checked=True,documents_closed=not bool(App.listDocuments()))
except Exception as error:
    import traceback
    report.update(state='failed',code='fixture_creation_failed',exception_type=type(error).__name__,failure_line=traceback.extract_tb(error.__traceback__)[-1].lineno)
finally:
    for opened in list(App.listDocuments().values()): App.closeDocument(opened.Name)
    report['documents_closed']=not bool(App.listDocuments())
    (root/'creation.json').write_text(json.dumps(report,allow_nan=False),encoding='utf-8')
`;
export const READ_ASSEMBLY_FIXTURES=COMMON+String.raw`
report={'version':1,'state':'failed','nonce':spec['nonce'],'pid':os.getpid()}
cases=json.loads((root/'creation.json').read_text(encoding='utf-8'))['cases']
rows=[]
for case in cases:
    doc=None;before=None;row={'name':case['name'],'state':'failed'}
    try:
        doc=App.openDocument(str(root/case['source']));obj=doc.getObject(case['node'])
        before=frozen_document(doc);ticks=time.perf_counter()
        current_poses=poses(doc);saved_poses=case['saved_poses']
        row['saved_poses_unchanged']=len(current_poses)==len(saved_poses) and all(a['name']==b['name'] and a['type']==b['type'] and max(abs(x-y) for x,y in zip(a['matrix'],b['matrix']))<1e-12 for a,b in zip(current_poses,saved_poses))
        def leaves(current, path, ancestors):
            if current in ancestors: raise RuntimeError('synthetic cycle')
            trail=ancestors+[current]
            if current.TypeId=='App::Link':
                target=current.LinkedObject
                if target is None: raise RuntimeError('synthetic broken link')
                if hasattr(target,'FixtureKind'):
                    return [(path,str(target.FixtureKind),current,target)]
                return [entry for child in getattr(target,'Group',[]) for entry in leaves(child,path+child.Name+'.',trail)]
            if hasattr(current,'FixtureKind'):
                return [(path,str(current.FixtureKind),current,current)]
            if current.TypeId in ('App::Part','Assembly::AssemblyObject','Assembly::AssemblyLink'):
                return [entry for child in getattr(current,'Group',[]) for entry in leaves(child,path+child.Name+'.',trail)]
            return []
        actual_leaves=leaves(obj,'',[]);leaf_rows=[];shapes=[];theories=[]
        for subname,kind,expected_owner,target in actual_leaves:
            ticks=time.perf_counter()
            leaf,matrix,owner=Part.getShape(obj,subname,needSubElement=False,transform=True,retType=1)
            row_time=(time.perf_counter()-ticks)*1000
            theoretical=analytic(kind,App.Placement(matrix));theories.append(theoretical);shapes.append(leaf)
            optimal=bounds(leaf.optimalBoundingBox(False,False))
            leaf_rows.append({'path':subname,'kind':kind,'get_shape_ms':row_time,'owner_name':owner.Name,'owner_type':owner.TypeId,
                'expected_owner_name':expected_owner.Name,'expected_owner_type':expected_owner.TypeId,'owner_exact':owner is expected_owner,
                'target_name':target.Name,'target_type':target.TypeId,'target_matrix':list(target.Placement.toMatrix().A),
                'owner_matrix':list(expected_owner.Placement.toMatrix().A),'accumulated_matrix':list(matrix.A),
                'analytic':theoretical,'optimal':optimal,'solids':len(leaf.Solids),'volume':float(leaf.Volume),
                'matrix_analytic_error_mm':max(abs(x-y) for x,y in zip(theoretical,optimal))})
        row['leaves']=leaf_rows
        if shapes:
            ticks=time.perf_counter()
            compounded=Part.makeCompound(shapes)
            row['leaf_compound_ms']=(time.perf_counter()-ticks)*1000
            ticks=time.perf_counter();row['leaf_optimal']=bounds(compounded.optimalBoundingBox(False,False));row['leaf_optimal_ms']=(time.perf_counter()-ticks)*1000
            row['leaf_theory']=union(theories)
            row['leaf_solids']=len(compounded.Solids);row['leaf_volume']=float(compounded.Volume)
            row['leaf_matrix_analytic_error_mm']=max(abs(x-y) for x,y in zip(row['leaf_optimal'],row['leaf_theory']))
        ticks=time.perf_counter();shape=Part.getShape(obj,'',needSubElement=False,transform=True)
        row['get_shape_ms']=(time.perf_counter()-ticks)*1000
        row.update(shape_class=type(shape).__name__,shape_type=shape.ShapeType,solids=len(shape.Solids),is_null=shape.isNull(),valid=shape.isValid())
        if not shape.isNull():
            ticks=time.perf_counter();row['standard']=bounds(shape.BoundBox);row['standard_ms']=(time.perf_counter()-ticks)*1000
            if hasattr(shape,'optimalBoundingBox'):
                ticks=time.perf_counter();row['optimal']=bounds(shape.optimalBoundingBox(False,False));row['optimal_ms']=(time.perf_counter()-ticks)*1000
            row['volume']=float(shape.Volume)
        row['object_state_unchanged']=before==frozen_document(doc)
        row['root_type']=obj.TypeId;row['group_types']=[o.TypeId for o in getattr(obj,'Group',[])]
        row['link_observations']=[{'name':o.Name,'type':o.TypeId,'rigid':getattr(o,'Rigid',None),'group_count':len(getattr(o,'Group',[])),
             'linked_type':o.LinkedObject.TypeId if getattr(o,'LinkedObject',None) is not None else None} for o in doc.Objects if o.TypeId in ('App::Link','Assembly::AssemblyLink')]
        row['state']='read'
    except Exception:
        row['code']='get_shape_or_bounds_failed'
    finally:
        if doc is not None and before is not None: row['object_state_unchanged']=before==frozen_document(doc)
        for opened in list(App.listDocuments().values()): App.closeDocument(opened.Name)
    rows.append(row)
report.update(state='read',rows=rows,private_paths_checked=True,documents_closed=not bool(App.listDocuments()))
(root/'analysis.json').write_text(json.dumps(report,allow_nan=False),encoding='utf-8')
`;
type CloseProof={nonce:string;pid:number|null;actual_close:boolean;exit_code:number|null;signal:string|null;output_bytes:number;termination_requests:string[];elapsed_ms:number};
async function owned(command:string,folder:string,script:string,name:string,env:NodeJS.ProcessEnv,signal:AbortSignal){
 const started=performance.now(),proof:CloseProof={nonce:randomUUID(),pid:null,actual_close:false,exit_code:null,signal:null,output_bytes:0,termination_requests:[],elapsed_ms:0};
 check(!signal.aborted,'cancelled_before_launch');const lease=acquireDrawingExecution('public-assembly-bounds:'+proof.nonce);
 try{
  fs.writeFileSync(path.join(folder,'spec.json'),JSON.stringify({nonce:proof.nonce}),{mode:0o600});
  const filename=path.join(folder,name+'.py');fs.writeFileSync(filename,script,{flag:'wx',mode:0o600});
  await new Promise<void>((resolve,reject)=>{
   const child=lease.spawn(command,['-u',path.join(folder,'user.cfg'),'-s',path.join(folder,'system.cfg'),filename],{cwd:folder,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
   proof.pid=child.pid??null;let stopped='',closed=false,grace:ReturnType<typeof setTimeout>|undefined;
   const stop=(code:string)=>{if(stopped||closed)return;stopped=code;proof.termination_requests.push('SIGTERM');try{child.kill('SIGTERM');}catch{}
    grace=setTimeout(()=>{proof.termination_requests.push('SIGKILL');try{child.kill('SIGKILL');}catch{}},1000);};
   const timer=setTimeout(()=>stop('native_timeout'),120000),abort=()=>stop('native_cancelled');
   const output=(bytes:Uint8Array)=>{proof.output_bytes=Math.min(MAX_OUTPUT+1,proof.output_bytes+bytes.length);if(proof.output_bytes>MAX_OUTPUT)stop('native_output_limit');};
   child.stdout?.on('data',output);child.stderr?.on('data',output);child.once('error',()=>stop('native_spawn_failed'));
   child.once('close',(code,exitSignal)=>{closed=true;clearTimeout(timer);if(grace)clearTimeout(grace);signal.removeEventListener('abort',abort);
    proof.actual_close=true;proof.exit_code=code;proof.signal=exitSignal;proof.elapsed_ms=performance.now()-started;if(stopped||code!==0||exitSignal)reject(new Failure(stopped||'native_exit_failed'));else resolve();});
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });return proof;
 }finally{lease();}
}
function maximumError(actual:unknown,expected:number[]){check(Array.isArray(actual)&&actual.length===6&&actual.every(v=>typeof v==='number'&&Number.isFinite(v)),'invalid_bounds');return Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));}
export async function verifyNativeAssemblyBounds(){
 const started=performance.now();
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help')return{usage:'pnpm -C server exec tsx scripts/verify-native-assembly-bounds.ts --allow-native --freecadcmd ABSOLUTE_FREECADCMD'};
 check(args.length===3&&args[0]==='--allow-native'&&args[1]==='--freecadcmd','explicit_native_opt_in_required');
 check(!process.env.PHOENIX_DESK_TOOLS_REGISTRY_DIR&&os.homedir()===os.userInfo().homedir,'normal_fixed_host_gate_required');
 check(path.isAbsolute(args[2])&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(args[2]),'invalid_command');
 const command=resolveFreecadCommand('',args[2]);check(command&&/^freecadcmd(?:\.exe)?$/i.test(path.basename(command)),'headless_command_required');
 fs.accessSync(command,fs.constants.X_OK);const binary=fingerprint(command,MAX_BINARY),sources=sourceHashes();
 const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-native-assembly-bounds-')));fs.chmodSync(folder,0o700);
 const receipt:Record<string,unknown>={format:'desk-independent-native-assembly-bounds',version:1,state:'started',artifact:path.basename(folder),sources,command:binary,
  tolerance_mm:TOLERANCE,limitations:['Synthetic self-contained files only; no existing CAD, user GUI, joints solving or dependency upgrade.',
   'Document reopen reads saved state; parameter freshness is not attested. No measurement-time recompute/solve/save.',
   'Part.getShape production reader does not expose PID/private-path receipt; direct analysis child does.']};
 const controller=new AbortController(),abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
 let failed:unknown;
 try{
  configureDrawingExecutionBarrier(path.join(deskToolsRegistrationDirectory(),'native-freecad-v1'));
  const env=environment(folder);
  const creationClose=await owned(command,folder,CREATE_ASSEMBLY_FIXTURES,'create',env,controller.signal);receipt.creation_close=creationClose;
  const creation=jsonFile(path.join(folder,'creation.json'));receipt.creation=creation;
  check(creation.nonce===creationClose.nonce&&creation.pid===creationClose.pid&&creationClose.actual_close&&creation.state==='created'&&creation.private_paths_checked===true&&creation.documents_closed===true&&Array.isArray(creation.cases),'fixture_creation_unverified');
  const cases=creation.cases as Array<{name:string;source:string;node:string;expected:number[];local_corner_envelope:number[];instances:number;expected_volume:number;native_assembly:boolean;expected_failure?:boolean}>;
  check(cases.length>=3&&cases.length<=20&&cases.every(c=>/^[A-Za-z]+\.FCStd$/.test(c.source)&&c.node==='FixtureRoot'),'invalid_fixture_manifest');
  const fixtureFiles=fs.readdirSync(folder).filter(name=>/^[A-Za-z]+\.FCStd$/.test(name));
  const before=Object.fromEntries(fixtureFiles.map(name=>[name,fingerprint(path.join(folder,name),MAX_SOURCE)]));
  receipt.external_preflight=cases.filter(c=>c.name==='ExternalPartHost'||c.name==='ExternalNativeHost').map(c=>{
   const snapshot=geometrySnapshot(folder,c.source,'assembly');
   return{name:c.name,root_node:snapshot.input.node,source_count:snapshot.sources.length,passed:snapshot.input.node==='FixtureRoot'&&snapshot.sources.length===2};
  });
  const analysisClose=await owned(command,folder,READ_ASSEMBLY_FIXTURES,'analyze',env,controller.signal);receipt.analysis_close=analysisClose;
  const analysis=jsonFile(path.join(folder,'analysis.json'));receipt.analysis=analysis;
  check(analysis.nonce===analysisClose.nonce&&analysis.pid===analysisClose.pid&&analysisClose.actual_close&&analysis.state==='read'&&analysis.private_paths_checked===true&&analysis.documents_closed===true&&Array.isArray(analysis.rows),'analysis_unverified');
  receipt.comparison=(analysis.rows as Array<Record<string,unknown>>).map((row,i)=>{
   const c=cases[i];check(row.name===c.name,'analysis_identity_mismatch');
   if(c.expected_failure)return{name:c.name,negative:true,passed:true};
   const standard=row.standard?maximumError(row.standard,c.expected):null,optimal=row.optimal?maximumError(row.optimal,c.expected):null;
   return{name:c.name,recipe_standard_diagnostic_error_mm:standard,recipe_optimal_diagnostic_error_mm:optimal,coarse_corner_error_mm:maximumError(c.local_corner_envelope,c.expected),
    recipe_lengths_mm:[c.expected[3]-c.expected[0],c.expected[4]-c.expected[1],c.expected[5]-c.expected[2]],
    expected_instances:c.instances,actual_solids:row.solids,complete_instances:row.solids===c.instances,
    leaf_solids:row.leaf_solids,leaf_matrix_analytic_error_mm:row.leaf_matrix_analytic_error_mm,
    saved_poses_unchanged:row.saved_poses_unchanged,leaf_owner_exact:Array.isArray(row.leaves)&&row.leaves.every((leaf:Record<string,unknown>)=>leaf.owner_exact===true),
    volume_error_mm3:typeof row.volume==='number'?Math.abs(row.volume-c.expected_volume):null,
    // The original recipe comparison remains diagnostic: Native AssemblyLink
    // owns copied instance placements, unlike App::Link(LinkTransform=True).
    // The independently analytic geometry check uses the official accumulated
    // subname matrices and never adds those matrices to returned shapes again.
    passed:row.leaf_solids===c.instances&&row.object_state_unchanged===true&&row.saved_poses_unchanged===true
     &&typeof row.leaf_matrix_analytic_error_mm==='number'&&row.leaf_matrix_analytic_error_mm<=TOLERANCE
     &&Array.isArray(row.leaves)&&row.leaves.length===c.instances&&row.leaves.every((leaf:Record<string,unknown>)=>leaf.owner_exact===true)};
  });
  // Native aggregation failures are explicit findings, not silently replaced by
  // App::Part results or called a successful complete assembly envelope.
  const inputs:GeometryInput[]=cases.map(c=>({rel:c.source,filename:path.join(folder,c.source),node:c.node,kind:'assembly'}));
  const inherited=process.env,ticks=performance.now();let production;
  try{process.env={...env,PHOENIX_FREECAD_CMD:command};production=await readGeometryBatch(inputs,undefined,{signal:controller.signal});}
  finally{process.env=inherited;}
  const productionChecks=production.map((row,i)=>{
   const direct=(analysis.rows as Array<Record<string,unknown>>)[i],leaf=direct?.leaf_optimal as number[]|undefined;
   if(cases[i]?.expected_failure)return{name:cases[i].name,negative:true,passed:row.bounding_box===null&&row.message==='总成结构或链接暂无法完整确认，未提供整体尺寸'};
   return{name:cases[i]?.name,official_leaf_match:row.bounding_box!==null&&Array.isArray(leaf)
    &&(['x_mm','y_mm','z_mm'] as const).every((axis,n)=>Math.abs(row.bounding_box![axis]-(leaf[n+3]-leaf[n]))<=TOLERANCE),
    passed:row.rel===cases[i]?.source&&row.bounding_box!==null&&Array.isArray(leaf)
     &&(['x_mm','y_mm','z_mm'] as const).every((axis,n)=>Math.abs(row.bounding_box![axis]-(leaf[n+3]-leaf[n]))<=TOLERANCE)};
  });
  receipt.production_reader={elapsed_ms:performance.now()-ticks,rows:production,checks:productionChecks,verified:productionChecks.length===cases.length&&productionChecks.every(c=>c.passed),process_receipt:'not_exposed'};
  const after=Object.fromEntries(fixtureFiles.map(name=>[name,fingerprint(path.join(folder,name),MAX_SOURCE)]));
  check(JSON.stringify(before)===JSON.stringify(after),'source_bytes_changed');receipt.source_fingerprints=after;receipt.sources_unchanged=true;
  check(JSON.stringify(binary)===JSON.stringify(fingerprint(command,MAX_BINARY)),'command_changed');check(JSON.stringify(sources)===JSON.stringify(sourceHashes()),'production_sources_changed');
  receipt.state=(receipt.comparison as Array<{passed:boolean}>).every(c=>c.passed)&&(receipt.external_preflight as Array<{passed:boolean}>).every(c=>c.passed)&&productionChecks.length===cases.length&&productionChecks.every(c=>c.passed)?'passed':'findings';
 }catch(error){failed=error;receipt.state='blocked';receipt.code=error instanceof Failure?error.code:'harness_failed_without_native_diagnostics';}
 finally{
  process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  receipt.total_elapsed_ms=performance.now()-started;
  const bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');check(bytes.length<=MAX_REPORT,'receipt_limit');fs.writeFileSync(path.join(folder,'receipt.json'),bytes,{flag:'wx',mode:0o600});
 }
 if(failed)throw Object.assign(new Failure(String(receipt.code)),{artifact:path.basename(folder)});
 return{state:receipt.state,artifact:path.basename(folder),comparison:receipt.comparison,production_reader:receipt.production_reader};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 void verifyNativeAssemblyBounds().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(error=>{
  process.exitCode=1;process.stdout.write(JSON.stringify({state:'blocked',code:error instanceof Failure?error.code:'unverified',artifact:(error as {artifact?:string}).artifact})+'\n');
 });
}
