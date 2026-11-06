import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {applyInstall,inspectInstallation,prepareInstall} from './installation.js';
import {loadPinnedResource} from './resource.js';
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const roots:string[]=[];
// Independent tiny test implementation of the installer contract, not copied addon code.
const fakeInstaller=String.raw`
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export const ADDON_NAME='PhoenixFreeCADTools';export const INSTALL_MARKER='.phoenix-freecad-tools-install.json';
const scan=root=>Object.fromEntries(fs.readdirSync(root).filter(n=>!['.phoenix-freecad-tools-install.json','.phoenix-freecad-mcp-install.json'].includes(n)).sort().map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex')]));
export function installAddon({modDir,sourceDir,dryRun}){
 const target=path.join(modDir,ADDON_NAME),legacy=['PhoenixMCP','PhoenixFreeCADMCP'].map(name=>path.join(modDir,name)).find(name=>fs.existsSync(name));
 const previous=legacy||target,exists=fs.existsSync(previous),desired=scan(sourceDir),old=exists?scan(previous):{};
 const action=legacy?'migrate':exists?(JSON.stringify(old)===JSON.stringify(desired)?'unchanged':'update'):'install';const migration=legacy?{migratedFrom:legacy}:{};
 if(dryRun)return {modDir,target,action,dryRun:true,...migration};
 let backup;if(action==='update'||action==='migrate'){const parent=path.join(path.dirname(modDir),'.phoenix-freecad-tools');fs.mkdirSync(parent,{recursive:true});backup=path.join(parent,'backup-test');fs.renameSync(previous,backup);}
 if(action!=='unchanged'){fs.mkdirSync(target);for(const name of Object.keys(desired))fs.copyFileSync(path.join(sourceDir,name),path.join(target,name));fs.writeFileSync(path.join(target,INSTALL_MARKER),JSON.stringify({schema_version:1,owner:'phoenix-freecad-tools',addon:ADDON_NAME,files:desired,directories:[]}));}
 return {modDir,target,action,dryRun:false,...migration,...(backup?{backup}:{})};
}`;
function fixture(version='0.3.2',installer=fakeInstaller){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-mcp-install-test-')));roots.push(root);const resourceRoot=path.join(root,'release'),modDir=path.join(root,'FreeCAD/Mod');fs.mkdirSync(resourceRoot);fs.mkdirSync(modDir,{recursive:true});
 const contents:Record<string,string>={'addon/InitGui.py':'# independent test addon\n','addon/package.xml':`<package><version>${version}</version></package>`,'addon/LICENSE':'Independent license test material','addon/NOTICE':'Independent attribution test material','addon/README.md':'Independent installation notes','scripts/install-addon.mjs':installer};
 const files:Record<string,string>={};for(const [name,bytes] of Object.entries(contents)){fs.mkdirSync(path.dirname(path.join(resourceRoot,name)),{recursive:true});fs.writeFileSync(path.join(resourceRoot,name),bytes);files[name]=sha(bytes);}
 const bytes=JSON.stringify({schema_version:1,plugin_version:version,addon_dir:'addon',installer_entry:'scripts/install-addon.mjs',files});const manifest=path.join(resourceRoot,'release.json');fs.writeFileSync(manifest,bytes);
 const loaded=loadPinnedResource({PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST:manifest,PHOENIX_FREECAD_MCP_RESOURCE_SHA256:sha(bytes)});if(loaded.state!=='ready')throw new Error(loaded.reason);
 return {root,resourceRoot,modDir,resource:loaded.resource};
}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('FreeCAD MCP managed install plan',()=>{
 it('previews without creating target, installs and verifies actual marker/files',async()=>{
  const f=fixture();expect(inspectInstallation(f.modDir).installation.state).toBe('absent');const plan=await prepareInstall(f.resource,f.modDir);expect(plan.preview).toMatchObject({state:'ready',operation:'install',source_version:'0.3.2'});expect(fs.readdirSync(f.modDir)).toEqual([]);
  expect(await applyInstall(plan)).toEqual({state:'installed',backup:null});expect(inspectInstallation(f.modDir).installation).toMatchObject({state:'managed',version:'0.3.2'});
  const next=await prepareInstall(f.resource,f.modDir);expect(next.preview.operation).toBe('unchanged');expect(await applyInstall(next)).toEqual({state:'unchanged',backup:null});
 });
 it('updates owned files with an outside-Mod backup',async()=>{
  const old=fixture();await applyInstall(await prepareInstall(old.resource,old.modDir));const target=path.join(old.modDir,'PhoenixFreeCADTools'),filename=path.join(target,'package.xml'),xml='<package><version>0.3.1</version></package>';
  // Construct a neutral older managed state without treating an old distribution as compatible.
  fs.writeFileSync(filename,xml);const markerFile=path.join(target,'.phoenix-freecad-tools-install.json'),marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));marker.files['package.xml']=sha(xml);fs.writeFileSync(markerFile,JSON.stringify(marker));
  const plan=await prepareInstall(old.resource,old.modDir);expect(plan.preview.operation).toBe('update');const result=await applyInstall(plan);expect(result.backup).not.toBeNull();expect(path.dirname(result.backup!)).toBe(path.join(path.dirname(old.modDir),'.phoenix-freecad-tools'));expect(inspectInstallation(old.modDir).installation.version).toBe('0.3.2');
 });
 it.each(['PhoenixMCP','PhoenixFreeCADMCP'])('backs up and migrates an identical managed %s directory with zero file changes',async addon=>{
  const f=fixture();await applyInstall(await prepareInstall(f.resource,f.modDir));const target=path.join(f.modDir,'PhoenixFreeCADTools'),legacy=path.join(f.modDir,addon);fs.renameSync(target,legacy);
  const currentMarker=path.join(legacy,'.phoenix-freecad-tools-install.json'),marker=JSON.parse(fs.readFileSync(currentMarker,'utf8'));marker.owner='phoenix-freecad-mcp';marker.addon=addon;fs.unlinkSync(currentMarker);fs.writeFileSync(path.join(legacy,'.phoenix-freecad-mcp-install.json'),JSON.stringify(marker));
  expect(inspectInstallation(f.modDir).installation.state).toBe('managed');const plan=await prepareInstall(f.resource,f.modDir);expect(plan.preview).toMatchObject({operation:'update',changes:[]});expect(plan.preview.reason).toContain('目录迁移');expect(plan.preview.reason).toContain('备份');
  const result=await applyInstall(plan);expect(result.state).toBe('installed');expect(result.backup).not.toBeNull();expect(fs.existsSync(path.join(result.backup!,'.phoenix-freecad-mcp-install.json'))).toBe(true);expect(fs.existsSync(legacy)).toBe(false);expect(inspectInstallation(f.modDir).installation).toMatchObject({state:'managed',version:'0.3.2'});
 });
 it.each(['manual','modified','extra_file','hardlink','symlink','duplicate'])('never replaces %s installation',async kind=>{
  const f=fixture();await applyInstall(await prepareInstall(f.resource,f.modDir));const target=path.join(f.modDir,'PhoenixFreeCADTools');
  if(kind==='manual')fs.unlinkSync(path.join(target,'.phoenix-freecad-tools-install.json'));
  if(kind==='modified')fs.appendFileSync(path.join(target,'InitGui.py'),'changed');
  if(kind==='extra_file')fs.writeFileSync(path.join(target,'user.txt'),'keep');
  if(kind==='hardlink')fs.linkSync(path.join(target,'LICENSE'),path.join(f.root,'license-hardlink'));
  if(kind==='symlink'){fs.unlinkSync(path.join(target,'LICENSE'));fs.symlinkSync(path.join(target,'NOTICE'),path.join(target,'LICENSE'));}
  if(kind==='duplicate')fs.mkdirSync(path.join(f.modDir,'PhoenixMCP'));
  expect(['unmanaged','modified','invalid']).toContain(inspectInstallation(f.modDir).installation.state);await expect(prepareInstall(f.resource,f.modDir)).rejects.toThrow();expect(fs.existsSync(target)).toBe(true);
 });
 it('rejects target or source changes between preview and apply',async()=>{
  const f=fixture(),plan=await prepareInstall(f.resource,f.modDir);fs.mkdirSync(path.join(f.modDir,'PhoenixFreeCADTools'));await expect(applyInstall(plan)).rejects.toThrow();
  const g=fixture(),other=await prepareInstall(g.resource,g.modDir);fs.appendFileSync(path.join(g.resourceRoot,'addon/InitGui.py'),'changed');await expect(applyInstall(other)).rejects.toThrow();expect(fs.readdirSync(g.modDir)).toEqual([]);
 });
 it('rejects a fake success with no actual installation',async()=>{
  const fake=fakeInstaller.replace("if(action!=='unchanged'){", "if(false){");const f=fixture('0.3.2',fake);const plan=await prepareInstall(f.resource,f.modDir);await expect(applyInstall(plan)).rejects.toThrow();expect(inspectInstallation(f.modDir).installation.state).toBe('absent');
 });
 it('does not create missing Mod directories or follow symlink parents',async()=>{
  const f=fixture();await expect(prepareInstall(f.resource,path.join(f.root,'missing/Mod'))).rejects.toThrow();expect(fs.existsSync(path.join(f.root,'missing'))).toBe(false);const alias=path.join(f.root,'alias');fs.symlinkSync(f.modDir,alias);await expect(prepareInstall(f.resource,alias)).rejects.toThrow();
 });
});
