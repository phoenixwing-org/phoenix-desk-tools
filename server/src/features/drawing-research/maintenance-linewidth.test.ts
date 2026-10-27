import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { maintenanceRunner } from './maintenance-runner.js';

it('writes only selected native length quantities and preserves all other drawing styles', () => {
  const script = String.raw`
import ast,types,copy
tree=ast.parse(${JSON.stringify(maintenanceRunner)})
names={'snapshot','metadata_snapshot','verify_exact_effects','apply_exact'}
functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
class Quantity:
 def __init__(self,text):self.Value=float(text.split()[0]);self.Unit='Length' if text.endswith(' mm') else 'Angle'
 def __str__(self):return str(self.Value)+' mm'
class Object:
 Name='Front';Label='Manual view';TypeId='TechDraw::DrawViewPart';PropertiesList=['X'];X=40
 def __init__(self):
  self.ViewObject=types.SimpleNamespace(PropertiesList=['LineWidth','HiddenWidth','ExtraWidth','IsoWidth','Font','Fontsize'],LineWidth=Quantity('1 mm'),HiddenWidth=Quantity('.17 mm'),ExtraWidth=Quantity('.19 mm'),IsoWidth=Quantity('.21 mm'),Font='HumanFont',Fontsize=5,getTypeIdOfProperty=lambda name:'App::PropertyLength')
 def isDerivedFrom(self,name):return name=='TechDraw::DrawViewPart'
obj=Object();doc=types.SimpleNamespace(Objects=[obj],getObject=lambda name:obj if name==obj.Name else None)
ns={'A':types.SimpleNamespace(Units=types.SimpleNamespace(Quantity=Quantity))}
exec(compile(ast.Module(body=functions,type_ignores=[]),'independent-line-width','exec'),ns)
def patch(current='1',proposed='.5',kind='view'):
 ns['spec']={'patches':[{'kind':kind,'object':'Front','field':'LineWidth','current':current,'proposed':proposed}]}
before=ns['snapshot'](doc);metadata=ns['metadata_snapshot'](doc);patch()
assert ns['apply_exact'](doc,None)==[]
ns['verify_exact_effects'](before,metadata,doc)
assert obj.ViewObject.LineWidth.Value==.5 and obj.ViewObject.HiddenWidth.Value==.17
assert obj.X==40 and obj.ViewObject.Font=='HumanFont' and obj.ViewObject.Fontsize==5
for name,value in [('HiddenWidth','.17'),('ExtraWidth','.19'),('IsoWidth','.21')]:
 setattr(obj.ViewObject,name,Quantity('.2 mm'))
 try:ns['verify_exact_effects'](before,metadata,doc)
 except RuntimeError:pass
 else:raise AssertionError('unselected style accepted: '+name)
 setattr(obj.ViewObject,name,Quantity(value+' mm'))
for current,proposed in [('1','.5'),('.5','0'),('.5','nan'),('.5','6'),('.5','-.1')]:
 patch(current,proposed)
 try:ns['apply_exact'](doc,None)
 except (RuntimeError,ValueError):pass
 else:raise AssertionError('unsafe numeric patch accepted')
patch('.5','.25','property')
try:ns['apply_exact'](doc,None)
except RuntimeError:pass
else:raise AssertionError('App-side field accepted')
patch('.5','.25');obj.ViewObject.getTypeIdOfProperty=lambda name:'App::PropertyFloat'
try:ns['apply_exact'](doc,None)
except RuntimeError:pass
else:raise AssertionError('unknown property type guessed')
obj.ViewObject.getTypeIdOfProperty=lambda name:'App::PropertyLength';obj.ViewObject.LineWidth=Quantity('.5 deg')
try:ns['apply_exact'](doc,None)
except RuntimeError:pass
else:raise AssertionError('wrong quantity dimension accepted')
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});
