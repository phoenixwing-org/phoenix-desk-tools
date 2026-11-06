import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {expect,it,vi} from 'vitest';
import {CREATE_ASSEMBLY_FIXTURES,READ_ASSEMBLY_FIXTURES,verifyNativeAssemblyBounds} from './verify-native-assembly-bounds.js';

// Static/mock QA only: Python parses the fixed scripts without importing
// FreeCAD. No Native process, user CAD, service or workspace DB is opened.
it('keeps both fixed Python programs syntactically valid and measurements strictly read-only',()=>{
 const program=String.raw`import ast,json,sys
scripts=json.load(sys.stdin)
for name,text in scripts.items():
 tree=ast.parse(text)
 if name=='read':
  forbidden={'recompute','solve','save','saveAs','addObject','newObject','setPropertyStatus'}
  assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in forbidden for n in ast.walk(tree))
print('fixed_programs_valid')
`;
 const result=spawnSync('python3',['-c',program],{input:JSON.stringify({create:CREATE_ASSEMBLY_FIXTURES,read:READ_ASSEMBLY_FIXTURES}),encoding:'utf8',timeout:10000});
 expect(result.status).toBe(0);expect(result.stdout.trim()).toBe('fixed_programs_valid');
});
it('requires explicit opt-in before creating an artifact, resolving Native or acquiring a gate',async()=>{
 const previous=process.argv;
 try{
  process.argv=['node','verify-native-assembly-bounds.ts'];
  await expect(verifyNativeAssemblyBounds()).rejects.toMatchObject({code:'explicit_native_opt_in_required'});
  process.argv=['node','verify-native-assembly-bounds.ts','--help'];
  expect(await verifyNativeAssemblyBounds()).toHaveProperty('usage');
 }finally{process.argv=previous;vi.restoreAllMocks();}
});
it('uses the normal gate, checks bound child receipts and preserves fixed structural cases',()=>{
 const source=fs.readFileSync(fileURLToPath(new URL('./verify-native-assembly-bounds.ts',import.meta.url)),'utf8');
 expect(source).toContain("configureDrawingExecutionBarrier(path.join(deskToolsRegistrationDirectory(),'native-freecad-v1'))");
 expect(source).not.toContain("path.join(folder,'host-native')");
 expect(source).toContain('creation.nonce===creationClose.nonce&&creation.pid===creationClose.pid&&creationClose.actual_close');
 expect(source).toContain('analysis.nonce===analysisClose.nonce&&analysis.pid===analysisClose.pid&&analysisClose.actual_close');
 expect(source).toContain("child.once('close'");expect(source).not.toContain("child.once('exit'");
 for(const name of ['RotatedBox','RotatedCylinder','NestedRepeatedPart','NativeNestedRepeated','HiddenRepeatedPart','NativeHiddenRepeated','PartWithHelpers','NativeWithHelpers','ExternalPartHost','ExternalNativeHost','MissingExternalTarget','StaleNativeGroupPartial','StaleNativeGroupEmpty'])expect(CREATE_ASSEMBLY_FIXTURES).toContain(name);
 expect(READ_ASSEMBLY_FIXTURES).toContain('Part.getShape(obj,subname,needSubElement=False,transform=True,retType=1)');
 expect(READ_ASSEMBLY_FIXTURES).toContain('owner is expected_owner');
 expect(READ_ASSEMBLY_FIXTURES).toContain('for opened in list(App.listDocuments().values()): App.closeDocument(opened.Name)');
 expect(source).toContain("geometrySnapshot(folder,c.source,'assembly')");
 expect(source).toContain("row.bounding_box===null&&row.message==='总成结构或链接暂无法完整确认，未提供整体尺寸'");
});
