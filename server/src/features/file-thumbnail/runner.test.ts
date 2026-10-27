import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import childProcess, { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { thumbnailRunner } from './runner.js';
import { renderThumbnail } from './service.js';
import * as executionGate from '../drawing-research/executionGate.js';
import { installPrivateNativeGateForTest } from '../../../test-support/native-gate.js';

vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();const spawn=vi.fn();return {...actual,spawn,default:{...actual,spawn}};});
vi.mock('../drawing-research/jobs.js',()=>({guiExecutable:()=>'/synthetic/freecad'}));
installPrivateNativeGateForTest();
const roots:string[]=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6mcAAAAASUVORK5CYII=','base64');
const options={color:'original' as const,axonometric:true,fit:true};
function source(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'thumbnail-owned-unit-')));roots.push(root);const file=path.join(root,'Independent.FCStd');fs.writeFileSync(file,'independently constructed inert source; mock spawn only');return file;}
type Native={child:EventEmitter&{pid:number;stdout:EventEmitter;stderr:EventEmitter;kill:ReturnType<typeof vi.fn>};folder:string;script:string;args:string[];options:SpawnOptions;
  spec:{source:string;output:string;report:string;owner:string;nonce:string}};
function nativeProcess(run:(native:Native)=>void,killCloses=true){
  const launches:Native[]=[];
  vi.mocked(spawn).mockImplementation((...args:unknown[])=>{
    const child=Object.assign(new EventEmitter(),{pid:50781,stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});
    child.kill.mockImplementation(()=>{if(killCloses)queueMicrotask(()=>child.emit('close',null,'SIGTERM'));return killCloses;});
    const options=args[2] as SpawnOptions,parameters=args[1] as string[],folder=options.cwd as string;
    const native={child,folder,args:parameters,options,script:fs.readFileSync(parameters.at(-1)!,'utf8'),spec:JSON.parse(fs.readFileSync(path.join(folder,'job.json'),'utf8'))};
    launches.push(native);queueMicrotask(()=>{child.emit('spawn');queueMicrotask(()=>run(native));});return child as unknown as ReturnType<typeof spawn>;
  });return launches;
}
function report(native:Native,patch:Record<string,unknown>={}){fs.writeFileSync(native.spec.output,png);fs.writeFileSync(native.spec.report,JSON.stringify({version:1,status:'completed',native_pid:native.child.pid,native_nonce:native.spec.nonce,
  private_paths_checked:true,documents_closed:true,output_sha256:createHash('sha256').update(png).digest('hex'),output_bytes:png.length,...patch}));}
function complete(native:Native){report(native);native.child.emit('close',0,null);}
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
beforeEach(()=>{vi.mocked(spawn).mockReset();});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('routes all four camera options through the target file 3D view, after clearing overlays', () => {
  const script = String.raw`
import ast,types
tree=ast.parse(${JSON.stringify(thumbnailRunner)})
render=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='render')
body=next(n for n in render.body if isinstance(n,ast.Try)).body
prefix=body[:next(i for i,n in enumerate(body) if isinstance(n,ast.For))]
code=compile(ast.Module(body=prefix,type_ignores=[]),'thumbnail-camera-options','exec')
calls=[]
view=types.SimpleNamespace(setAxisCross=lambda value:calls.append(('axes',value)),setCornerCrossSize=lambda value:calls.append(('corner',value)))
def get_document(name):
 assert name=='OwnedModel';calls.append(('document',name))
 def views(kind):
  assert kind=='Gui::View3DInventor';return [] if missing else [view]
 return types.SimpleNamespace(mdiViewsOfType=views)
def camera(target,iso,fit):
 assert target is view and ('axes',False) in calls and ('corner',0) in calls and ('events',) in calls
 calls.append(('camera',iso,fit));return None
opened=False
def open_document(source):
 global opened
 opened=True;return types.SimpleNamespace(Name='OwnedModel',Objects=[])
ns={'App':types.SimpleNamespace(openDocument=open_document,listDocuments=lambda:{'OwnedModel':types.SimpleNamespace(Name='OwnedModel',Objects=[])} if opened else {}),
 'Gui':types.SimpleNamespace(getDocument=get_document,updateGui=lambda:calls.append(('gui',))),
 'QtWidgets':types.SimpleNamespace(QApplication=types.SimpleNamespace(processEvents=lambda:calls.append(('events',)))),
 'native_configure_camera':camera,'stage':lambda name:None}
missing=False
for iso in (False,True):
 for fit in (False,True):
  calls.clear();opened=False;ns['spec']={'source':'independent.FCStd','options':{'color':'original','axonometric':iso,'fit':fit}}
  exec(code,ns);assert calls.count(('camera',iso,fit))==1
missing=True;opened=False
try:exec(code,ns)
except ValueError as error:assert '3D' in str(error)
else:raise AssertionError('missing target view accepted')
assert 'activeDocument()' not in ${JSON.stringify(thumbnailRunner)}
for node in ast.walk(tree):
 if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute):
  assert node.func.attr not in ('viewAxonometric','fitAll','setCameraOrientation','saveAs')
  if node.func.attr=='save':assert ast.unparse(node.func.value)=='result_image'
loop=next(n for n in ast.walk(render) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='attempt')
names=[ast.unparse(n) for n in loop.body]
assert next(i for i,n in enumerate(names) if 'native_assert_camera_stable' in n)<next(i for i,n in enumerate(names) if 'saveImage' in n)
assert '触及图片边界' in ${JSON.stringify(thumbnailRunner)}
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});

it.each([1001,1017])('includes a detached one-pixel line at x=%s in the full-resolution crop and edge guard', x => {
  const script = String.raw`
import ast
tree=ast.parse(${JSON.stringify(thumbnailRunner)})
helper=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='thumbnail_image_bounds')
render=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='render')
ns={};exec(compile(ast.Module(body=[helper],type_ignores=[]),'thumbnail-full-pixel-bounds','exec'),ns)
class Color:
 def __init__(self,value):self.value=value
 def red(self):return self.value
 green=red
 blue=red
 def alpha(self):return 255
white=Color(255);black=Color(0);gray=Color(128)
class Image:
 calls=0
 def width(self):return 1024
 def height(self):return 1024
 def pixelColor(self,px,py):
  self.calls+=1
  if px==${x} and 411<=py<=615 or (px,py)==(999,1001):return black
  if 100<=px<=196 and 120<=py<=216:return black if py<168 else gray
  return white
 def copy(self,left,top,width,height):return (left,top,left+width,top+height)
image=Image()
colors,bounds=ns['thumbnail_image_bounds'](image)
assert image.calls==1024*1024
assert len(colors)>=3 and bounds==(100,120,${x},1001)
assert ${x}%4!=0 and 1001%4!=0
ns.update(image=image,colors=colors,left=bounds[0],top=bounds[1],right=bounds[2],bottom=bounds[3],spec={'options':{'fit':True}},pad=6)
# Execute the actual render guard and crop expression, not copied algorithms.
guard=next(n for n in ast.walk(render) if isinstance(n,ast.If) and any(isinstance(c,ast.Constant) and isinstance(c.value,str) and '触及图片边界' in c.value for c in ast.walk(n)))
try:exec(compile(ast.Module(body=[guard],type_ignores=[]),'thumbnail-edge-guard','exec'),ns)
except ValueError:assert ${x}==1017
else:assert ${x}==1001
crop=next(n for n in ast.walk(render) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='crop' for t in n.targets))
exec(compile(ast.Module(body=[crop],type_ignores=[]),'thumbnail-detached-crop','exec'),ns)
left,top,right,bottom=ns['crop']
assert left<=${x}<right and top<=411<bottom and top<=615<bottom
assert left<=999<right and top<=1001<bottom
assert any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='thumbnail_image_bounds' for n in ast.walk(render))
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});

it('keeps the no-Fit camera aspect with a viewport fallback and never sets camera fields', () => {
  const script = String.raw`
import ast,types
tree=ast.parse(${JSON.stringify(thumbnailRunner)})
helper=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='thumbnail_render_size')
ns={};exec(compile(ast.Module(body=[helper],type_ignores=[]),'thumbnail-original-framing','exec'),ns)
calls=[]
def view(aspect,viewport):
 return types.SimpleNamespace(getCameraNode=lambda:types.SimpleNamespace(aspectRatio=types.SimpleNamespace(getValue=lambda:aspect)),getSize=lambda:(calls.append('viewport') or viewport))
for aspect,size in ((4/3,(512,384)),(3/4,(384,512)),(1,(512,512))):
 calls.clear();assert ns['thumbnail_render_size'](view(aspect,(300,600)),False)==size
 assert not calls
for aspect in (float('nan'),float('inf'),0,-1,'invalid'):
 calls.clear();assert ns['thumbnail_render_size'](view(aspect,(600,300)),False)==(512,256)
 assert calls==['viewport']
assert ns['thumbnail_render_size'](types.SimpleNamespace(),True)==(1024,1024)
try:ns['thumbnail_render_size'](view(0,(0,300)),False)
except ValueError:pass
else:raise AssertionError('invalid original aspect silently changed framing')
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and (n.func.attr.startswith('set') or n.func.attr in ('fitAll','viewAxonometric')) for n in ast.walk(helper))
render=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='render')
loop=next(n for n in ast.walk(render) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='attempt')
size=next(n for n in loop.body if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='thumbnail_render_size')
save=next(n for n in loop.body if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and n.value.func.attr=='saveImage')
assert size.lineno<save.lineno and [ast.unparse(n) for n in save.value.args[1:3]]==['render_width','render_height']
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});

it.each([[512,384],[384,512]])('letterboxes the entire %sx%s no-Fit frame without cropping any original edge', (width,height) => {
  const script = String.raw`
import ast,types
tree=ast.parse(${JSON.stringify(thumbnailRunner)})
helper=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='thumbnail_letterbox')
events=[];source=object()
class Image:
 def width(self):return ${width}
 def height(self):return ${height}
 def scaled(self,w,h,aspect,filter):
  assert (w,h,aspect,filter)==(512,512,'keep','smooth')
  events.append('entire-frame');return self
class Canvas:
 Format_ARGB32=1
 def __init__(self,w,h,kind):assert (w,h,kind)==(512,512,1)
 def fill(self,color):assert color=='white';events.append('white')
 def save(self,output):assert output=='owned.png';events.append('saved');return True
class Painter:
 def __init__(self,canvas):assert isinstance(canvas,Canvas)
 def drawImage(self,x,y,image):
  assert isinstance(image,Image)
  assert (x,y)==((512-${width})//2,(512-${height})//2)
  # Every original corner, including detached edge pixels, remains in canvas.
  for px,py in ((0,0),(${width}-1,0),(0,${height}-1),(${width}-1,${height}-1)):
   assert 0<=x+px<512 and 0<=y+py<512
  events.append('all-edges')
 def end(self):events.append('ended')
ns={'QtCore':types.SimpleNamespace(Qt=types.SimpleNamespace(KeepAspectRatio='keep',SmoothTransformation='smooth')),'QtGui':types.SimpleNamespace(QImage=Canvas,QColor=lambda value:value,QPainter=Painter)}
exec(compile(ast.Module(body=[helper],type_ignores=[]),'thumbnail-letterbox-full-frame','exec'),ns)
ns['thumbnail_letterbox'](Image(),'owned.png')
assert events==['entire-frame','white','all-edges','ended','saved']
render=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='render')
branch=next(n for n in ast.walk(render) if isinstance(n,ast.If) and any(isinstance(c,ast.Call) and isinstance(c.func,ast.Name) and c.func.id=='thumbnail_letterbox' for c in ast.walk(n)))
assert ast.unparse(branch.test)=="spec['options']['fit'] and right >= left"
assert len(branch.orelse)==1 and isinstance(branch.orelse[0],ast.If) and ast.unparse(branch.orelse[0].test)=="not spec['options']['fit']"
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('copy','fitAll','setValue','setCameraType') for n in ast.walk(helper))
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});

it('spawns only through the durable gate into private roots and accepts only the matching owned PNG receipt',async()=>{
  const file=source(),before=fs.readFileSync(file);vi.stubEnv('FREECAD_USER_HOME','/synthetic/never-read-user-profile');vi.stubEnv('PYTHONPATH','PRIVATE');vi.stubEnv('NODE_OPTIONS','PRIVATE');
  const launches=nativeProcess(native=>{
    expect(JSON.parse(fs.readFileSync(native.spec.owner,'utf8'))).toEqual({pid:native.child.pid,nonce:native.spec.nonce});
    for(const key of ['FREECAD_USER_HOME','FREECAD_USER_DATA','FREECAD_USER_TEMP','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR','TMPDIR','TMP','TEMP']){
      const location=native.options.env?.[key]!;expect(path.dirname(location)).toBe(native.folder);expect(fs.statSync(location).mode&0o777).toBe(0o700);expect(fs.readdirSync(location)).toEqual([]);
    }
    expect(native.options.env).not.toHaveProperty('PYTHONPATH');expect(native.options.env).not.toHaveProperty('NODE_OPTIONS');expect(native.options.env).not.toHaveProperty('QT_QPA_PLATFORM');
    expect(native.folder).not.toBe(path.dirname(file));expect(native.script.indexOf('thumbnail macro does not belong')).toBeLessThan(native.script.indexOf('import FreeCAD as App'));
    expect(native.script).toContain('for opened in owned_documents:');expect(native.script).not.toContain('for opened in list(App.listDocuments().values()):');
    complete(native);
  });
  expect(childProcess.spawn).toBe(spawn);expect(await renderThumbnail(file,options)).toEqual(png);
  expect(launches).toHaveLength(1);expect(launches[0].child.kill).not.toHaveBeenCalled();expect(fs.existsSync(launches[0].folder)).toBe(false);expect(fs.readFileSync(file)).toEqual(before);
});

it('guards a forwarded macro before importing GUI code or running private preferences/document actions',()=>{
  const script=String.raw`
import ast,json,os,tempfile,pathlib
tree=ast.parse(${JSON.stringify(thumbnailRunner)})
boundary=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Import) and any(a.name=='FreeCAD' for a in n.names))
prefix=ast.Module(body=tree.body[:boundary],type_ignores=[])
with tempfile.TemporaryDirectory(prefix='independent-thumbnail-guard-') as folder:
 root=pathlib.Path(folder);job=root/'job.json';owner=root/'owner.json';report=root/'result.json'
 job.write_text(json.dumps({'nonce':'independent-nonce','owner':str(owner),'report':str(report)}))
 owner.write_text(json.dumps({'pid':os.getpid()+1,'nonce':'independent-nonce'}))
 try:exec(compile(prefix,'owned-thumbnail-prefix','exec'),{'JOB_PATH':str(job)})
 except RuntimeError:pass
 else:raise AssertionError('foreign GUI accepted owner marker')
 result=json.loads(report.read_text());assert result['status']=='failed' and result['reason']=='owner_mismatch'
 assert 'traceback' not in result and 'error' not in result
`;
  const result=spawnSync('python3',['-c',script],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);
});

it('refuses documents that arrive during the GUI timer gap without opening or closing them',()=>{
  const script=String.raw`
import ast,json,types,pathlib,tempfile
tree=ast.parse(${JSON.stringify(thumbnailRunner)})
render=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='render')
calls=[];foreign=types.SimpleNamespace(Name='ArrivedDuringTimer',Objects=[])
with tempfile.TemporaryDirectory(prefix='independent-thumbnail-doc-gap-') as folder:
 report=pathlib.Path(folder)/'report.json'
 ns={'App':types.SimpleNamespace(listDocuments=lambda:{foreign.Name:foreign},openDocument=lambda source:calls.append('open'),closeDocument=lambda name:calls.append(('close',name))),
  'stage':lambda name:None,'spec':{'source':'independent.FCStd','report':str(report)},'Path':pathlib.Path,'json':json,
  '_proof':{'version':1,'native_pid':1,'native_nonce':'independent'},
  'QtCore':types.SimpleNamespace(QTimer=types.SimpleNamespace(singleShot=lambda *args:None)),
  'QtWidgets':types.SimpleNamespace(QApplication=types.SimpleNamespace(quit=lambda:None))}
 exec(compile(ast.Module(body=[render],type_ignores=[]),'thumbnail-timer-gap','exec'),ns);ns['render']()
 assert not calls and ns['App'].listDocuments()=={foreign.Name:foreign}
 assert json.loads(report.read_text())['status']=='failed'
`;
  const result=spawnSync('python3',['-c',script],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);
});

it.each(['cancel','timeout','error','stdout','stderr'] as const)('does not settle, clean temp, or release the gate after %s until actual close',async mode=>{
  vi.useFakeTimers();const file=source(),abort=new AbortController(),launches=nativeProcess(()=>{},false),pending=renderThumbnail(file,options,{signal:abort.signal});
  let settled=false;void pending.then(()=>{settled=true;},()=>{settled=true;});await flush();const native=launches[0];
  if(mode==='cancel')abort.abort();else if(mode==='timeout')await vi.advanceTimersByTimeAsync(120000);
  else if(mode==='error')native.child.emit('error',new Error('PRIVATE native exception /synthetic/source'));
  else native.child[mode].emit('data',Buffer.alloc(256*1024+1));
  await vi.advanceTimersByTimeAsync(1000);expect(native.child.kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);expect(settled).toBe(false);
  expect(fs.existsSync(native.folder)).toBe(true);expect(()=>executionGate.acquireDrawingExecution('must-still-own-native')).toThrow();
  native.child.emit('exit',null,'SIGKILL');await flush();expect(settled).toBe(false);native.child.emit('close',null,'SIGKILL');
  const error=await pending.catch(cause=>cause);expect(error).toBeInstanceOf(Error);expect(String(error)).not.toMatch(/PRIVATE|synthetic\/source/);expect(fs.existsSync(native.folder)).toBe(false);
  executionGate.acquireDrawingExecution('after-actual-close')();
});

it('checks host PID-record health before publishing owner permission and still waits for close on failure',async()=>{
  const file=source(),acquire=executionGate.acquireDrawingExecution;
  vi.spyOn(executionGate,'acquireDrawingExecution').mockImplementation(owner=>{const lease=acquire(owner);return Object.assign(()=>lease(),{spawn:lease.spawn,assertHealthy:()=>{throw new Error('PRIVATE persistent PID failure');}});});
  const launches=nativeProcess(()=>{},false),pending=renderThumbnail(file,options);let settled=false;void pending.catch(()=>{settled=true;});await flush();
  expect(fs.existsSync(launches[0].spec.owner)).toBe(false);expect(launches[0].child.kill).toHaveBeenCalledWith('SIGTERM');expect(settled).toBe(false);
  launches[0].child.emit('close',null,'SIGTERM');await expect(pending).rejects.toThrow('归属记录未确认');
});

it('publishes owner.json atomically only after a complete write and fsync',async()=>{
  const file=source(),open=fs.openSync,write=fs.writeSync,fsync=fs.fsyncSync,link=fs.linkSync;let fd:number|undefined,temp='',partial=false,synced=false,published=false;
  vi.spyOn(fs,'openSync').mockImplementation((...args:unknown[])=>{const result=Reflect.apply(open,fs,args) as number;
    if(/^\.owner-.+\.tmp$/.test(path.basename(String(args[0])))&&(Number(args[1])&fs.constants.O_CREAT)!==0){fd=result;temp=String(args[0]);expect(fs.existsSync(path.join(path.dirname(temp),'owner.json'))).toBe(false);}return result;});
  vi.spyOn(fs,'writeSync').mockImplementation((...args:unknown[])=>{if(args[0]===fd&&!partial){partial=true;expect(fs.existsSync(path.join(path.dirname(temp),'owner.json'))).toBe(false);const shortened=[...args];shortened[3]=5;return Reflect.apply(write,fs,shortened) as number;}return Reflect.apply(write,fs,args) as number;});
  vi.spyOn(fs,'fsyncSync').mockImplementation(value=>{fsync(value);if(value===fd)synced=true;});
  vi.spyOn(fs,'linkSync').mockImplementation((from,to)=>{if(path.basename(String(to))==='owner.json'){expect(synced).toBe(true);expect(JSON.parse(fs.readFileSync(from,'utf8'))).toMatchObject({pid:50781});link(from,to);published=true;}else link(from,to);});
  nativeProcess(complete);expect(await renderThumbnail(file,options)).toEqual(png);expect([partial,synced,published]).toEqual([true,true,true]);
});

const badReports:Array<[string,(native:Native)=>void]>=[
  ['wrong PID',n=>report(n,{native_pid:1})],['wrong nonce',n=>report(n,{native_nonce:'foreign'})],['unverified private path',n=>report(n,{private_paths_checked:false})],
  ['unclosed docs',n=>report(n,{documents_closed:false})],['extra raw exception',n=>report(n,{error:'PRIVATE exception'})],['wrong PNG hash',n=>report(n,{output_sha256:'0'.repeat(64)})],
  ['wrong PNG length',n=>report(n,{output_bytes:1})],['unknown status',n=>report(n,{status:'unknown'})],
  ['oversize JSON',n=>fs.writeFileSync(n.spec.report,Buffer.alloc(16385))],['bad UTF8',n=>fs.writeFileSync(n.spec.report,Buffer.from([0xff]))],
  ['symlink report',n=>fs.symlinkSync(n.spec.source,n.spec.report)],['missing report',()=>{}],
  ['symlink PNG',n=>{report(n);fs.unlinkSync(n.spec.output);fs.symlinkSync(n.spec.source,n.spec.output);}],
];
it.each(badReports)('rejects %s instead of returning a publishable PNG',async(_label,change)=>{
  const file=source(),before=fs.readFileSync(file);nativeProcess(native=>{change(native);native.child.emit('close',0,null);});
  const error=await renderThumbnail(file,options).catch(cause=>cause);expect(error).toBeInstanceOf(Error);expect(String(error)).not.toContain('PRIVATE');expect(fs.readFileSync(file)).toEqual(before);
});

it('blocks another renderer across workspaces without spawning while the owned child is still running',async()=>{
  const first=source(),launches=nativeProcess(()=>{},false),pending=renderThumbnail(first,options);await flush();
  await expect(renderThumbnail(source(),options)).rejects.toThrow(/原生|归属/);expect(spawn).toHaveBeenCalledTimes(1);complete(launches[0]);await pending;
});

it('waits for asynchronous no-PID spawn failure close, and records it as not-started rather than leaving a false ownership claim',async()=>{
  const file=source();let child:EventEmitter;
  vi.mocked(spawn).mockImplementation(()=>{child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),kill:vi.fn()});
    queueMicrotask(()=>child.emit('error',Object.assign(new Error('PRIVATE spawn error'),{syscall:'spawn /synthetic/freecad'})));return child as unknown as ReturnType<typeof spawn>;});
  const pending=renderThumbnail(file,options);let settled=false;void pending.catch(()=>{settled=true;});await flush();expect(settled).toBe(false);
  child!.emit('close',-2,null);await expect(pending).rejects.toThrow(/无法启动/);executionGate.acquireDrawingExecution('after-no-spawn-close')();
});
