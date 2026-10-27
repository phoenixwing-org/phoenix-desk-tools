import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {nativeReferenceInspection,nativeSourceAssemblySafety} from './native-drawing-guards.js';
import {maintenanceInspectionRunner} from './maintenance-runner.js';

function check(script:string){const result=spawnSync('python3',['-c',script],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);}
it('never accepts cached geometry from an invalid View or a View with unknown state',()=>check(`
import types
ns={};exec(${JSON.stringify(nativeReferenceInspection)},ns)
class View:
 Name='Front';State=['Up-to-date']
 def isDerivedFrom(self,value):return True
 def getStatusString(self):return 'independent expression failure'
 def getVertexBySelection(self,sub):return types.SimpleNamespace(isNull=lambda:False,isValid=lambda:True,Point=[1,2,0])
v=View();assert ns['native_projected_reference'](v,'Vertex0')['status']=='valid'
v.State=['Touched','Invalid'];row=ns['native_projected_reference'](v,'Vertex0');assert row['status']=='manual' and 'View失效' in row['reason']
for unsupported in ('Invalid',b'Invalid',{'Invalid':True},[1],None):
 v.State=unsupported;assert ns['native_projected_reference'](v,'Vertex0')['status']=='manual'
del v.State;del View.State;assert ns['native_projected_reference'](v,'Vertex0')['status']=='manual'
`));
it('records existing source errors without claiming to fix them and rejects changed failure evidence',()=>check(`
import types,os,copy
ns={'os':os};exec(${JSON.stringify(nativeReferenceInspection+nativeSourceAssemblySafety)},ns)
obj=types.SimpleNamespace(Name='SourceLink',State=['Touched','Invalid'],getStatusString=lambda:'original expression error')
failure=ns['native_object_failure'](obj)
graph={'public.FCStd':{'placements':{},'links':{'SourceLink':{'failure_state':failure}},'joints':{}}}
summary=ns['native_safety_summary'](graph);assert summary['status']=='verified' and len(summary['source_object_errors'])==1 and '未修复' in summary['reason']
ns['native_source_graph']=lambda d:copy.deepcopy(graph);ns['spec']={'source_fingerprints':{}}
ns['native_assert_source_preservation'](graph,None)
before=copy.deepcopy(graph);graph['public.FCStd']['links']['SourceLink']['failure_state']={'states':[],'status':''}
try:ns['native_assert_source_preservation'](before,None)
except RuntimeError as error:assert '故障状态' in str(error)
else:raise AssertionError('disappearing source error accepted')
graph['public.FCStd']['links']['SourceLink']['failure_state']=copy.deepcopy(failure)
graph['public.FCStd']['links']['SourceLink']['failure_state']['status']='different failure'
try:ns['native_assert_source_preservation'](before,None)
except RuntimeError:pass
else:raise AssertionError('changed failure message accepted')
graph['public.FCStd']['links']['SourceLink']['failure_state']={'states':['Error'],'status':'new failure'}
try:ns['native_assert_source_preservation'](before,None)
except RuntimeError:pass
else:raise AssertionError('changed failure flags accepted')
del graph['public.FCStd']['links']['SourceLink']['failure_state'];assert ns['native_safety_summary'](graph)['status']=='manual'
obj.State=['Up-to-date'];assert ns['native_object_failure'](obj)=={'states':[],'status':''}
obj.State=['Touched'];assert ns['native_object_failure'](obj)=={'states':[],'status':''}
`));
it('checks View failure before cached-edge stability and samples actual reference geometry while settling',()=>check(`
import ast,types
tree=ast.parse(${JSON.stringify(maintenanceInspectionRunner)})
fn=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='native_inspection_settle')
calls=[]
view=types.SimpleNamespace(Name='Front',State=['Invalid'],getStatusString=lambda:'cached native error',isDerivedFrom=lambda t:True,getVisibleEdges=lambda: calls.append('cached-edge-read') or [1])
doc=types.SimpleNamespace(Objects=[view],recompute=lambda:None)
ns={'time':types.SimpleNamespace(monotonic=lambda:0),'QtWidgets':types.SimpleNamespace(QApplication=types.SimpleNamespace(processEvents=lambda:None)),'G':types.SimpleNamespace(updateGui=lambda:None),'native_assert_solver_quiet':lambda:None}
exec(${JSON.stringify(nativeReferenceInspection)},ns);exec(compile(ast.Module(body=[fn],type_ignores=[]),'independent-state-settle','exec'),ns)
try:ns['native_inspection_settle'](doc)
except RuntimeError as error:assert 'Front' in str(error) and 'cached native error' in str(error)
else:raise AssertionError('invalid cached View passed settling')
assert not calls
assert 'native_dimension_inspection(d)' in ast.unparse(fn)
`));
it('does not misread ordinary PartDesign length offsets as Joint placement frames',()=>check(`
import ast,types,xml.etree.ElementTree as ET
tree=ast.parse(${JSON.stringify(nativeSourceAssemblySafety)})
initialize=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='native_safety_initialize')
loop=next(n for n in ast.walk(initialize) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='obj')
code=compile(ast.Module(body=[loop],type_ignores=[]),'independent-offset-property-type','exec')
placement='<PropertyPlacement Px="0" Py="0" Pz="0" Q0="0" Q1="0" Q2="0" Q3="1"/>'
def run(text,kind='PartDesign::Pad'):
 xml=ET.fromstring('<Document><ObjectData><Object name="Feature"><Properties>'+text+'</Properties></Object></ObjectData></Document>')
 ns={'xml':xml,'types':{'Feature':kind},'has_assembly':kind=='Assembly::Joint','placements':{},'native_finite':float,'native_matrix':lambda p:[1,0,0,1],'A':types.SimpleNamespace(Vector=lambda *v:v,Rotation=lambda *v:v,Placement=lambda *v:v)}
 exec(code,ns);return ns['placements']
offset='<Property name="Offset2" type="App::PropertyLength"><Float value="0"/></Property>'
assert run(offset)=={}
assert 'Placement' in run('<Property name="Placement" type="App::PropertyPlacement">'+placement+'</Property>'+offset)['Feature']
for text in (offset+'<Property name="Reference1"/>','<Property name="Placement"><Float value="0"/></Property>'):
 try:run(text)
 except RuntimeError:pass
 else:raise AssertionError('unconfirmed real placement accepted')
`));
