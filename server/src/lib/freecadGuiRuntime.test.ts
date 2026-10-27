import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resolveFreecadGuiRuntime} from './freecadGuiRuntime.js';
import {templateCatalog} from '../features/drawing-research/service.js';
import {guiExecutable} from '../features/drawing-research/jobs.js';

let root:string,data:string,systemInstallation='';
beforeEach(()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'independent-freecad-runtime-')));data=path.join(root,'runtime-data');fs.mkdirSync(data);vi.stubEnv('PHOENIX_USER_DATA_DIR',data);systemInstallation='';
 // Map only the resolver's fixed system lookup to independent ordinary files.
 // No installed FreeCAD executable or real launcher preference is read or run.
 const realpath=fs.realpathSync;
 vi.spyOn(fs,'realpathSync').mockImplementation(file=>{
  const name=String(file),system='/Applications/FreeCAD.app';
  if(name===system||name.startsWith(system+path.sep)){
   if(systemInstallation)return realpath(path.join(systemInstallation,path.relative(system,name)));
   throw new Error('Independent fixture has no system installation');
  }
  if(name==='/usr')throw new Error('Independent fixture has no Linux system installation');
  return realpath(file);
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();fs.rmSync(root,{recursive:true,force:true});});
function write(base:string,rel:string,bytes='Independent fixture; never executed\n'){
 const file=path.join(base,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);return file;
}
function executable(base:string,rel='Contents/Resources/bin/freecad'){const file=write(base,rel);fs.chmodSync(file,0o755);return file;}
function templates(base:string,rel='Contents/Resources/share/Mod/TechDraw/Templates'){
 const folder=path.join(base,rel);write(folder,'ISO/A4_Landscape_ISO5457_advanced.svg','<svg width="297mm" height="210mm"><rect width="280" height="190"/></svg>');return folder;
}
function preference(installation:string){fs.writeFileSync(path.join(data,'launcher-prefs.json'),JSON.stringify({freecad_dir:installation}));}
it('binds the GUI and implicit stock catalog to the same canonical usable configured installation',()=>{
 const installation=path.join(root,'Configured.app'),binary=executable(installation),frames=templates(installation);preference(installation);
 expect(resolveFreecadGuiRuntime()).toEqual({executable:binary,installationRoot:installation,templates:frames});expect(guiExecutable()).toBe(binary);expect(templateCatalog().root).toBe(frames);expect(templateCatalog().items.map(item=>item.rel)).toEqual(['ISO/A4_Landscape_ISO5457_advanced.svg']);
});
it('does not call a templates-only preference stock, even when the GUI falls back to another installation',()=>{
 const preferred=path.join(root,'TemplatesOnly.app'),unrelated=templates(preferred);preference(preferred);
 systemInstallation=path.join(root,'IndependentSystem.app');const binary=executable(systemInstallation),stock=templates(systemInstallation);
 expect(guiExecutable()).toBe(binary);expect(templateCatalog().root).toBe(stock);expect(templateCatalog().root).not.toBe(unrelated);expect(templateCatalog(unrelated).root).toBe(unrelated);
});
it('returns no implicit templates when no GUI is usable, while preserving explicit custom browsing',()=>{
 const installation=path.join(root,'TemplatesOnly.app'),frames=templates(installation);preference(installation);
 expect(()=>guiExecutable()).toThrow('未找到FreeCAD');expect(templateCatalog()).toEqual({root:'',items:[]});expect(templateCatalog(frames).root).toBe(frames);
});
it('never borrows another installation templates when the selected GUI has none',()=>{
 const selected=path.join(root,'BinaryOnly.app'),binary=executable(selected);preference(selected);
 systemInstallation=path.join(root,'IndependentSystem.app');executable(systemInstallation);templates(systemInstallation);
 expect(resolveFreecadGuiRuntime()).toEqual({executable:binary,installationRoot:selected,templates:''});expect(templateCatalog()).toEqual({root:'',items:[]});
});
it.each([
 ['bin/FreeCAD.exe','data/Mod/TechDraw/Templates'],
 ['bin/freecad','Mod/TechDraw/Templates'],
])('preserves configured GUI layout %s with its own %s stock directory',(binaryRel,templateRel)=>{
 const installation=path.join(root,'Configured'),binary=executable(installation,binaryRel),frames=templates(installation,templateRel);preference(installation);
 expect(resolveFreecadGuiRuntime()).toEqual({executable:binary,installationRoot:installation,templates:frames});
});
it('does not bind a preference templates directory to an executable symlink escaping that installation',()=>{
 const installation=path.join(root,'Alias.app');templates(installation);const other=executable(path.join(root,'Other.app'));
 const alias=path.join(installation,'Contents/Resources/bin/freecad');fs.mkdirSync(path.dirname(alias),{recursive:true});fs.symlinkSync(other,alias);preference(installation);
 expect(()=>resolveFreecadGuiRuntime()).toThrow('未找到FreeCAD');expect(templateCatalog()).toEqual({root:'',items:[]});
});
it('does not bless stock template symlinks escaping the selected executable installation',()=>{
 const installation=path.join(root,'Configured.app'),binary=executable(installation),outside=templates(path.join(root,'Other.app'));
 const alias=path.join(installation,'Contents/Resources/share/Mod/TechDraw/Templates');fs.mkdirSync(path.dirname(alias),{recursive:true});fs.symlinkSync(outside,alias);preference(installation);
 expect(resolveFreecadGuiRuntime()).toEqual({executable:binary,installationRoot:installation,templates:''});expect(templateCatalog()).toEqual({root:'',items:[]});expect(templateCatalog(outside).root).toBe(outside);
});
it('accepts a canonical installation alias only when both GUI and templates remain in the resolved same root',()=>{
 const installation=path.join(root,'Actual.app'),binary=executable(installation),frames=templates(installation),alias=path.join(root,'InstallationAlias.app');fs.symlinkSync(installation,alias);preference(alias);
 expect(resolveFreecadGuiRuntime()).toEqual({executable:binary,installationRoot:installation,templates:frames});
});
it('does not select directories or non-executable files as a GUI program',()=>{
 const installation=path.join(root,'Invalid.app'),binary=write(installation,'Contents/Resources/bin/freecad');fs.chmodSync(binary,0o600);templates(installation);preference(installation);
 expect(()=>resolveFreecadGuiRuntime()).toThrow('未找到FreeCAD');fs.unlinkSync(binary);fs.mkdirSync(binary);expect(()=>resolveFreecadGuiRuntime()).toThrow('未找到FreeCAD');
});
