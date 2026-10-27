import {installPrivateNativeGateForTest} from "../../../test-support/native-gate.js";
installPrivateNativeGateForTest();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {strToU8,zipSync} from 'fflate';
import {afterEach,expect,it,vi} from 'vitest';
import {autoPaperPolicyPython,autoPaperRunner,proposeDrawingPaper,type DrawingPaperCandidate} from './autoPaper.js';
import {drawingPaperProjectionSupport} from './runner.js';
import {runMaintenanceNative} from './maintenance.js';
import {acquireDrawingExecution} from './executionGate.js';
import {fcstdFingerprint} from '../../lib/fcstdBatchFiles.js';

vi.mock('./maintenance.js',async original=>({...await original<typeof import('./maintenance.js')>(),runMaintenanceNative:vi.fn()}));

// Independent metadata/rectangle/projection contracts only. No test loads FreeCAD,
// opens a user's CAD document or treats mocked receipts as native visual evidence.
const directories=new Set<string>();
afterEach(()=>{
 vi.mocked(runMaintenanceNative).mockReset();vi.restoreAllMocks();
 for(const directory of directories)fs.rmSync(directory,{recursive:true,force:true});directories.clear();
});
const papers=['A4','A3','A2','A1','A0'] as const;
const sizes:Record<(typeof papers)[number],[number,number]>={A4:[297,210],A3:[420,297],A2:[594,420],A1:[841,594],A0:[1189,841]};
const smallBounds={Front:[-10,10,-10,10],Side:[-10,10,-10,10],Iso:[-10,10,-10,10]};
const jsonPython=(value:unknown)=>`json.loads(${JSON.stringify(JSON.stringify(value))})`;
function contract(script:string){
 const result=spawnSync('python3',['-c',script],{encoding:'utf8'});expect(result.status,result.stderr||result.stdout).toBe(0);return result.stdout;
}
function policyCandidates(){return papers.map(paper=>({paper,rel:`ISO/${paper}_Landscape_ISO5457_advanced.svg`,filename:`/independent-frames/${paper}.svg`,hash:'a'.repeat(64),width:sizes[paper][0],height:sizes[paper][1]}));}
const common=['1:1','1:2','1:5','1:10'];
const normalAttempts=common.flatMap(scale=>['A4','A3','A2'].map(paper=>[paper,scale]));
const fallbackAttempts=common.flatMap(scale=>['A1','A0'].map(paper=>[paper,scale]));

it.each([
 {name:'small',fits:[['A4','1:1']],chosen:['A4','1:1'],attempts:[['A4','1:1']]},
 {name:'medium',fits:[['A3','1:1']],chosen:['A3','1:1'],attempts:[['A4','1:1'],['A3','1:1']]},
 {name:'A2 before an available larger sheet',fits:[['A2','1:2'],['A1','1:1']],chosen:['A2','1:2'],attempts:normalAttempts.slice(0,6)},
 {name:'large fallback',fits:[['A1','1:5']],chosen:['A1','1:5'],attempts:[...normalAttempts,...fallbackAttempts.slice(0,5)]},
 {name:'largest fallback',fits:[['A0','1:10']],chosen:['A0','1:10'],attempts:[...normalAttempts,...fallbackAttempts]},
])('chooses $name using frozen scale-then-paper order with a fake layout oracle',example=>{
 contract(`import json
candidates=${jsonPython(policyCandidates())};bounds=${jsonPython(smallBounds)};example=${jsonPython(example)};calls=[]
paper_by_width={candidate['width']:candidate['paper'] for candidate in candidates}
def choose_owned_draft_layout(width,height,actual,requested):
 assert actual==bounds and requested!='auto'
 pair=[paper_by_width[width],requested];calls.append(pair)
 if pair not in example['fits']:raise RuntimeError('Independent geometry does not fit this candidate')
 a,b=map(float,requested.split(':'))
 return {'scale':a/b,'note_y':90,'positions':{},'rectangles':{},'orientation':'columns'}
exec(${JSON.stringify(autoPaperPolicyPython)})
result=choose_auto_paper(list(reversed(candidates)),bounds,'auto')
assert [result['paper'],result['scale']]==example['chosen']
assert calls==example['attempts'],calls
candidate=next(c for c in candidates if c['paper']==result['paper'])
assert result['template']==candidate['rel'] and result['template_hash']==candidate['hash']
assert result['projection_bounds']==bounds and result['reason']
`);
});
it('requires A4/A3/A2 before trying any layout, including an explicit scale',()=>{
 contract(`import json
candidates=${jsonPython(policyCandidates())};bounds=${jsonPython(smallBounds)};calls=[]
def choose_owned_draft_layout(*args):calls.append(args);raise AssertionError('Missing basic template set reached layout')
exec(${JSON.stringify(autoPaperPolicyPython)})
for missing in ('A4','A3','A2'):
 for requested in ('auto','1:2'):
  try:choose_auto_paper([c for c in candidates if c['paper']!=missing],bounds,requested)
  except RuntimeError as error:assert str(error)
  else:raise AssertionError('Missing basic template was silently skipped')
assert not calls
`);
});
it('rejects oversize projections after common scales without falling through to 1:1000',()=>{
 contract(`import json
candidates=${jsonPython(policyCandidates())};bounds=${jsonPython(smallBounds)};calls=[]
paper_by_width={candidate['width']:candidate['paper'] for candidate in candidates}
def choose_owned_draft_layout(width,height,actual,requested):
 calls.append([paper_by_width[width],requested]);raise RuntimeError('Independent oversize projection')
exec(${JSON.stringify(autoPaperPolicyPython)})
try:choose_auto_paper(candidates,bounds,'auto')
except RuntimeError as error:assert str(error)
else:raise AssertionError('Oversize projection was silently accepted')
assert calls==${jsonPython([...normalAttempts,...fallbackAttempts])}
assert not any(scale in ('1:20','1:50','1:100','1:200','1:1000') for paper,scale in calls)
`);
});
it.each(['2:1','5:1','1:20','1:1000'])('tries only the explicitly requested %s scale, including fallback paper',requested=>{
 contract(`import json
candidates=${jsonPython(policyCandidates())};bounds=${jsonPython(smallBounds)};calls=[]
paper_by_width={candidate['width']:candidate['paper'] for candidate in candidates}
def choose_owned_draft_layout(width,height,actual,scale):
 calls.append([paper_by_width[width],scale])
 if paper_by_width[width]!='A1':raise RuntimeError('Independent explicit-scale fit')
 a,b=map(float,scale.split(':'));return {'scale':a/b}
exec(${JSON.stringify(autoPaperPolicyPython)})
result=choose_auto_paper(candidates,bounds,${JSON.stringify(requested)})
assert result['paper']=='A1' and result['scale']==${JSON.stringify(requested)}
assert calls==${jsonPython(['A4','A3','A2','A1'].map(paper=>[paper,requested]))}
`);
});
it('reuses the generator full-curve layout and keeps an independent small projection at A4 1:1',()=>{
 contract(`import ast,json
support=ast.parse(${JSON.stringify(drawingPaperProjectionSupport)});policy=ast.parse(${JSON.stringify(autoPaperPolicyPython)})
assert not any(isinstance(n,ast.FunctionDef) and n.name=='choose_owned_draft_layout' for n in policy.body)
functions=[n for n in support.body if isinstance(n,ast.FunctionDef) and n.name in ('draft_view_padding','choose_owned_draft_layout')]
assert len(functions)==2
ns={};exec(compile(ast.Module(body=functions,type_ignores=[]),'independent-shared-layout','exec'),ns)
exec(compile(policy,'independent-paper-policy','exec'),ns)
result=ns['choose_auto_paper'](${jsonPython(policyCandidates())},${jsonPython(smallBounds)},'auto')
assert result['paper']=='A4' and result['scale']=='1:1' and result['layout']['scale']==1
assert result['layout']['note_y']>=90 and set(result['layout']['positions'])=={'Front','Side','Iso'}
`);
});
it('keeps the projection macro unsaved and reads actual 1:1 curve projections rather than source box sizes as results',()=>{
 contract(`import ast
tree=ast.parse(${JSON.stringify(autoPaperRunner)})
propose=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='propose_paper')
text=ast.unparse(propose)
assert 'projection_snapshot(projection, names)' in text and 'choose_auto_paper' in text
assert any(isinstance(n,ast.Assign) and any(isinstance(t,ast.Attribute) and t.attr=='Scale' for t in n.targets) and isinstance(n.value,ast.Constant) and n.value.value==1 for n in ast.walk(propose))
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('save','saveAs','exportPageAsPdf','exportPageAsSvg','removeObject') for n in ast.walk(tree))
`);
});
it('copies the effective shape once into a local holder and links only that holder without a second placement',()=>{
 contract(`import ast,types
tree=ast.parse(${JSON.stringify(autoPaperRunner)})
propose=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='propose_paper')
assignments=[n for n in propose.body if isinstance(n,ast.Assign)]
def assignment(target):
 matches=[n for n in assignments if any(ast.unparse(t)==target for t in n.targets)]
 assert len(matches)==1,(target,len(matches))
 return matches[0]
assert ast.unparse(assignment('shape').value)=='Part.getShape(body)'
assert ast.unparse(assignment('bb').value)=='shape.BoundBox'
assert ast.unparse(assignment('holder').value)=="projection.addObject('Part::Feature', 'ProjectedShape')"
assert ast.unparse(assignment('holder.Shape').value)=='shape.copy()'
assert ast.unparse(assignment('link').value)=="projection.addObject('App::Link', 'SourceModel')"
calls=[n for n in ast.walk(propose) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
assert len([n for n in calls if n.func.attr=='copy'])==1
set_link_calls=[n for n in calls if n.func.attr=='setLink']
assert len(set_link_calls)==1 and ast.unparse(set_link_calls[0])=='link.setLink(holder)'
assert not any(n.func.attr in ('transformShape','transformGeometry','translate','rotate') for n in calls)
assert len([n for n in calls if n.func.attr=='addObject' and n.args and isinstance(n.args[0],ast.Constant) and n.args[0].value=='App::Link'])==1
assert not any(isinstance(n,ast.Attribute) and n.attr in ('Placement','Location','LinkTransform','LinkPlacement') for n in ast.walk(propose))
view_sources=[n for n in ast.walk(propose) if isinstance(n,ast.Assign) and any(ast.unparse(t)=='view.Source' for t in n.targets)]
assert len(view_sources)==1 and ast.unparse(view_sources[0].value)=='[link]'
# Execute only the extracted shape/axes/holder/local-link statements with independent
# Python fakes. This is a copy/placement contract, not a native geometry proof.
events=[];location=(7.0,-3.0,11.0)
class EffectiveShape:
 def __init__(self):
  self.Location=location;self.BoundBox=types.SimpleNamespace(XLength=8.0,YLength=2.0,ZLength=5.0)
 def copy(self):
  events.append('copy');return EffectiveShape()
class Body:
 @property
 def Placement(self):raise AssertionError('Body placement must not be applied again')
class Feature:
 def __setattr__(self,key,value):
  assert key=='Shape','Unexpected feature mutation: '+key
  events.append(('set',key));object.__setattr__(self,key,value)
body=Body();effective=EffectiveShape();feature=Feature()
default_transform=object();default_placement=object()
class LocalLink:
 def __init__(self):
  object.__setattr__(self,'LinkTransform',default_transform);object.__setattr__(self,'LinkPlacement',default_placement)
 def __setattr__(self,key,value):raise AssertionError('Unexpected local link mutation: '+key)
 def setLink(self,target):
  assert target is feature and target is not body;events.append(('setLink','holder'));object.__setattr__(self,'LinkedObject',target)
local_link=LocalLink()
def get_shape(target):
 assert target is body;events.append('effective-shape');return effective
def add_object(kind,name):
 if (kind,name)==('Part::Feature','ProjectedShape'):events.append('feature');return feature
 assert (kind,name)==('App::Link','SourceModel');events.append('local-link');return local_link
ns={'Part':types.SimpleNamespace(getShape=get_shape),'body':body,'projection':types.SimpleNamespace(addObject=add_object),'native_finite':float}
targets=['shape','bb','sizes','normal','horizontal','vertical','holder','holder.Shape','link']
selected=[n for n in propose.body if isinstance(n,ast.Assign) and any(ast.unparse(t) in targets for t in n.targets) or isinstance(n,ast.Expr) and ast.unparse(n)=='link.setLink(holder)']
assert len(selected)==len(targets)+1
exec(compile(ast.Module(body=selected,type_ignores=[]),'independent-effective-shape-copy','exec'),ns)
assert ns['holder'] is feature and feature.Shape is not effective
assert ns['link'] is local_link and local_link.LinkedObject is feature
assert local_link.LinkTransform is default_transform and local_link.LinkPlacement is default_placement
assert feature.Shape.Location==effective.Location==location
assert ns['bb'] is effective.BoundBox and ns['sizes']==[8.0,2.0,5.0]
assert (ns['normal'],ns['horizontal'],ns['vertical'])==(1,0,2)
assert events==['effective-shape','feature','copy',('set','Shape'),'local-link',('setLink','holder')],events
`);
});

function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'independent-auto-paper-')));directories.add(root);
 const frameRoot=path.join(root,'frames');fs.mkdirSync(path.join(frameRoot,'ISO'),{recursive:true});
 const source=path.join(root,'Model.FCStd');fs.writeFileSync(source,zipSync({'Document.xml':strToU8('<Document><Objects Count="1"><Object name="Main" type="PartDesign::Body"/></Objects><ObjectData Count="1"><Object name="Main"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="Independent shape"/></Property></Properties></Object></ObjectData></Document>')}));
 const candidates:DrawingPaperCandidate[]=papers.map(paper=>{
  const [width,height]=sizes[paper],rel=`ISO/${paper}_Landscape_ISO5457_advanced.svg`,filename=path.join(frameRoot,rel);
  const bytes=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:freecad="http://www.freecad.org/wiki/index.php?title=Svg_Namespace" width="${width}mm" height="${height}mm"><rect x="10" y="10" width="${width-20}" height="${height-20}" fill="none" stroke="black"/><text freecad:editable="drawing_number"/><text freecad:editable="revision_index"/><text freecad:editable="title"/><text freecad:editable="part_material"/><text freecad:editable="scale"/></svg>`);
  fs.writeFileSync(filename,bytes);return {paper,rel,filename,hash:fcstdFingerprint(bytes),width,height};
 });
 return {root,source,candidates};
}
function receipt(candidates:DrawingPaperCandidate[]){
 const candidate=candidates.find(c=>c.paper==='A4')!;
 return {status:'completed',native_pid:123,source_fingerprints_unchanged:true,source_safety:{status:'verified',preferences:{SolveOnRecompute:false,SolveInJointCreation:false},solver_observations:[],source_poses_and_actual_frames_unchanged:true,existing_unresolved_joint_sides:0},proposal:{paper:'A4',scale:'1:1',template:candidate.rel,template_hash:candidate.hash,reason:'Independent full-curve projection contract',projection_bounds:structuredClone(smallBounds),layout:{scale:1,note_y:90,positions:{Front:[40,150],Side:[100,150],Iso:[160,150]},rectangles:{Front:[20,60,120,180],Side:[80,120,120,180],Iso:[140,180,120,180]},orientation:'columns'}}};
}
function native(f:ReturnType<typeof fixture>,change?:(result:ReturnType<typeof receipt>,spec:Record<string,any>)=>void){
 vi.mocked(runMaintenanceNative).mockImplementation(async(macro,folder,root,config)=>{
  directories.add(folder);const spec=JSON.parse(fs.readFileSync(config,'utf8'));
  expect(path.basename(macro)).toBe('inspect.FCMacro');expect(root).toBe(f.root);expect(spec.source).toBe(f.source);expect(spec.node).toBe('Main');expect(spec.source_fingerprints[f.source]).toBe(fcstdFingerprint(fs.readFileSync(f.source)));
  expect(path.resolve(spec.report)).toBe(path.join(folder,'result.json'));expect(spec.stage).toBeUndefined();expect(spec.output).toBeUndefined();
  const result=receipt(f.candidates);change?.(result,spec);fs.writeFileSync(spec.report,JSON.stringify(result));return 123;
 });
}
function inventory(root:string){
 const rows:Record<string,string>={};
 const visit=(directory:string)=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isDirectory())visit(file);else rows[path.relative(root,file)]=fcstdFingerprint(fs.readFileSync(file));}};
 visit(root);return rows;
}
it('returns a guarded proposal without workspace outputs, backups, preference writes or source changes',async()=>{
 const f=fixture(),before=inventory(f.root);native(f);
 const result=await proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto');
 expect(result).toEqual(receipt(f.candidates).proposal);expect(runMaintenanceNative).toHaveBeenCalledOnce();expect(inventory(f.root)).toEqual(before);expect(fs.existsSync(path.join(f.root,'.phoenix'))).toBe(false);
 const release=acquireDrawingExecution('independent-after-paper-preview');release();
});
it('rejects an existing template changing before native startup',async()=>{
 const f=fixture();fs.appendFileSync(f.candidates[0].filename,'<!-- Independent external edit -->');
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto')).rejects.toThrow(/模板已变化/);expect(runMaintenanceNative).not.toHaveBeenCalled();
});
it.each(['missing-basic','wrong-family','wrong-size','wrong-rel'])('refuses an unproved candidate set before native (%s)',mode=>{
 const f=fixture();let candidates=structuredClone(f.candidates);
 if(mode==='missing-basic')candidates=candidates.filter(c=>c.paper!=='A3');
 if(mode==='wrong-family'){const moved=path.join(f.root,'other-frames','ISO',path.basename(candidates[0].filename));fs.mkdirSync(path.dirname(moved),{recursive:true});fs.copyFileSync(candidates[0].filename,moved);candidates[0].filename=moved;}
 if(mode==='wrong-size')candidates[0].width=420;
 if(mode==='wrong-rel')candidates[0].rel='ISO/A4_LandscapeTD.svg';
 return expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',candidates,'auto')).rejects.toThrow(/人工确认/).then(()=>expect(runMaintenanceNative).not.toHaveBeenCalled());
});
it('preserves a concurrent source save and rejects the stale proposal',async()=>{
 const f=fixture(),changed=zipSync({'Document.xml':strToU8('<Document><Objects Count="1"><Object name="Main" type="PartDesign::Body"/></Objects><ObjectData Count="1"><Object name="Main"><Properties Count="0"/></Object></ObjectData></Document>')});native(f,()=>fs.writeFileSync(f.source,changed));
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto')).rejects.toThrow(/变化/);expect(fs.readFileSync(f.source)).toEqual(Buffer.from(changed));
});
it('rejects template drift while the owned native proposal is running',async()=>{
 const f=fixture();native(f,()=>fs.appendFileSync(f.candidates[0].filename,'<!-- Independent concurrent template edit -->'));
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto')).rejects.toThrow(/模板已变化/);
});
it('does not start a pre-cancelled proposal',async()=>{
 const f=fixture(),control=new AbortController();control.abort();
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto',control.signal)).rejects.toThrow(/取消/);expect(runMaintenanceNative).not.toHaveBeenCalled();
});
it('holds the shared lease until the owned native lifecycle closes after cancellation',async()=>{
 const f=fixture(),control=new AbortController();let begin!:()=>void,close!:()=>void;const started=new Promise<void>(resolve=>begin=resolve),closed=new Promise<void>(resolve=>close=resolve);
 vi.mocked(runMaintenanceNative).mockImplementation(async(_macro,folder,_root,_config,signal)=>{directories.add(folder);expect(signal).toBe(control.signal);begin();await closed;throw new Error('Independent owned child closed after cancellation');});
 let settled=false;const pending=proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto',control.signal).catch(error=>error).then(result=>{settled=true;return result;});
 await started;control.abort();await Promise.resolve();expect(settled).toBe(false);expect(()=>acquireDrawingExecution('independent-concurrent-paper')).toThrow(/运行中/);close();expect((await pending).message).toContain('child closed');
 const release=acquireDrawingExecution('independent-after-paper-close');release();
});
it.each(['wrong-pid','false-source-proof','unsafe-preferences','solver-call','unresolved-frames','unknown-paper','auto-too-small-scale','wrong-template-hash','invalid-bounds','overlapping-layout','outside-note-band','nonfinite-position'])('rejects incomplete or inconsistent synthetic native receipts (%s)',async mode=>{
 const f=fixture();native(f,result=>{
  if(mode==='wrong-pid')result.native_pid=124;
  if(mode==='false-source-proof')result.source_fingerprints_unchanged=false;
  if(mode==='unsafe-preferences')result.source_safety.preferences.SolveOnRecompute=true;
  if(mode==='solver-call')(result.source_safety.solver_observations as unknown[]).push({kind:'solve',object:'IndependentAssembly'});
  if(mode==='unresolved-frames')result.source_safety.existing_unresolved_joint_sides=1;
  if(mode==='unknown-paper')result.proposal.paper='A5';
  if(mode==='auto-too-small-scale'){result.proposal.scale='1:1000';result.proposal.layout.scale=0.001;}
  if(mode==='wrong-template-hash')result.proposal.template_hash='b'.repeat(64);
  if(mode==='invalid-bounds')result.proposal.projection_bounds.Front=[0,0,0,0];
  if(mode==='overlapping-layout')result.proposal.layout.rectangles.Iso=[...result.proposal.layout.rectangles.Front];
  if(mode==='outside-note-band')result.proposal.layout.rectangles.Front[2]=100;
  if(mode==='nonfinite-position')result.proposal.layout.positions.Front[0]=Infinity;
 });
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto')).rejects.toThrow(/人工确认/);
});
it('rejects a receipt whose scale differs from an explicitly requested scale',async()=>{
 const f=fixture();native(f);
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'1:2')).rejects.toThrow(/允许比例/);
});
it('uses only the fixed report file, never an extra path supplied by native result data',async()=>{
 const f=fixture();native(f,(result,spec)=>{const alternate=path.join(path.dirname(spec.report),'independent-alternate.json');fs.writeFileSync(alternate,JSON.stringify(result));Object.assign(result,{report:alternate});result.proposal.template='outside-confirmed-candidates.svg';});
 await expect(proposeDrawingPaper(f.root,'Model.FCStd','Main',f.candidates,'auto')).rejects.toThrow(/确认模板/);
});
