import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { maintenanceRunner, maintenanceVerificationRunner, maintenanceInspectionRunner } from './maintenance-runner.js';

it('does not touch the camera for exact patches, including an empty selection', () => {
  const script = String.raw`
import ast,types
tree=ast.parse(${JSON.stringify(maintenanceRunner)})
run=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
branch=next(n for n in run.body if isinstance(n,ast.If) and any(isinstance(x,ast.Call) and isinstance(x.func,ast.Name) and x.func.id=='native_configure_camera' for x in ast.walk(n)))
assert ast.unparse(branch.test)=='not exact'
code=compile(ast.Module(body=[branch],type_ignores=[]),'maintenance-camera-boundary','exec')
calls=[];missing=False;view=types.SimpleNamespace(getSize=lambda:(400,300))
def document(name):
 calls.append('mdi-document');assert name=='OwnedDrawing'
 def views(kind):assert kind=='Gui::View3DInventor';return [] if missing else [view]
 return types.SimpleNamespace(mdiViewsOfType=views)
def configure(target,iso,fit,aspect):
 assert target is view and iso is True and fit is True and aspect==4/3;calls.append('camera');return {'stable':True}
ns={'d':types.SimpleNamespace(Name='OwnedDrawing'),'G':types.SimpleNamespace(getDocument=document,updateGui=lambda:None),
 'QtWidgets':types.SimpleNamespace(QApplication=types.SimpleNamespace(processEvents=lambda:None)),
 'native_configure_camera':configure}
for patches in ([],[{'kind':'view','field':'Font'}]):
 ns['exact']='patches' in {'patches':patches};exec(code,ns);assert not calls
ns['exact']=False;exec(code,ns);assert calls==['mdi-document','camera']
missing=True
try:exec(code,ns)
except RuntimeError as error:assert '3D' in str(error)
else:raise AssertionError('missing drawing 3D view accepted')
for node in ast.walk(run):
 if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute):assert node.func.attr not in ('viewAxonometric','fitAll','setCameraOrientation','saveImage')
assert 'TechDrawGui.exportPageAsSvg' in ${JSON.stringify(maintenanceRunner)}
assert 'if not exact:native_assert_camera_stable(view,expected_camera)' in ${JSON.stringify(maintenanceRunner)}
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  for (const readonly of [maintenanceInspectionRunner, maintenanceVerificationRunner]) {
    expect(readonly).not.toContain('def native_configure_camera');
  }
});
