import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {loadPinnedResource,withFrozenResource,type PinnedResource} from './resource.js';
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const folders:string[]=[];
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-mcp-resource-test-')));folders.push(root);
 const contents:Record<string,string>={'addon/InitGui.py':'# Independent test addon\n','addon/package.xml':'<package><version>0.3.2</version></package>','addon/LICENSE':'Independent test license material','addon/NOTICE':'Independent test attribution','addon/README.md':'Independent test installation notes','scripts/install-addon.mjs':"import fs from 'node:fs';\nexport function installAddon() { return fs !== null; }",'dist/server.mjs':'export const fixture = true;'};
 const files:Record<string,string>={};for(const [relative,bytes] of Object.entries(contents)){fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),bytes);files[relative]=digest(bytes);}
 const manifestPath=path.join(root,'release.json');
 const write=(patch:Record<string,unknown>={})=>{const manifest={schema_version:1,plugin_version:'0.3.2',addon_dir:'addon',installer_entry:'scripts/install-addon.mjs',mcp_entry:'dist/server.mjs',files,...patch};const bytes=JSON.stringify(manifest);fs.writeFileSync(manifestPath,bytes);return {PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST:manifestPath,PHOENIX_FREECAD_MCP_RESOURCE_SHA256:digest(bytes)};};
 return {root,files,manifestPath,write,env:write()};
}
afterEach(()=>{for(const root of folders.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('host pinned FreeCAD MCP release resource',()=>{
 it('has no repository, sibling checkout or network fallback',()=>{expect(loadPinnedResource({})).toMatchObject({state:'missing',version:null});expect(loadPinnedResource({PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST:'/not-used'}).state).toBe('invalid');});
 it('validates pinned material and freezes only manifest files',async()=>{
  const f=fixture();fs.writeFileSync(path.join(f.root,'private-unlisted.txt'),'not for installation');const loaded=loadPinnedResource(f.env);expect(loaded.state).toBe('ready');if(loaded.state!=='ready')throw new Error();let frozenRoot='';
  await withFrozenResource(loaded.resource,async frozen=>{frozenRoot=frozen.root;expect(frozen.addonDir).toBe(path.join(frozen.root,'addon'));expect(fs.existsSync(path.join(frozen.root,'private-unlisted.txt'))).toBe(false);expect(fs.readFileSync(path.join(frozen.root,'addon/InitGui.py'),'utf8')).toContain('Independent');});expect(fs.existsSync(frozenRoot)).toBe(false);
 });
 it.each(['wrong_digest','wrong_version','missing_license','traversal','unlisted_addon','external_import','dynamic_import','hardlink','symlink'])('rejects %s',kind=>{
  const f=fixture();let env=f.env;
  if(kind==='wrong_digest')env={...env,PHOENIX_FREECAD_MCP_RESOURCE_SHA256:'a'.repeat(64)};
  if(kind==='wrong_version')env=f.write({plugin_version:'0.3.3'});
  if(kind==='missing_license'){delete f.files['addon/LICENSE'];env=f.write();}
  if(kind==='traversal')env=f.write({addon_dir:'../addon'});
  if(kind==='unlisted_addon')fs.writeFileSync(path.join(f.root,'addon/extra.py'),'x');
  if(kind==='external_import'||kind==='dynamic_import'){const bytes=kind==='external_import'?"import x from 'untrusted';":"await import('node:fs');";fs.writeFileSync(path.join(f.root,'scripts/install-addon.mjs'),bytes);f.files['scripts/install-addon.mjs']=digest(bytes);env=f.write();}
  if(kind==='hardlink')fs.linkSync(path.join(f.root,'addon/LICENSE'),path.join(f.root,'license-link'));
  if(kind==='symlink'){fs.unlinkSync(path.join(f.root,'addon/LICENSE'));fs.symlinkSync(path.join(f.root,'addon/NOTICE'),path.join(f.root,'addon/LICENSE'));}
  expect(loadPinnedResource(env).state).toBe('invalid');
 });
 it('rejects source changes after detection and cleans frozen output on failure',async()=>{
  const f=fixture(),loaded=loadPinnedResource(f.env);if(loaded.state!=='ready')throw new Error();fs.appendFileSync(path.join(f.root,'addon/InitGui.py'),'changed');let called=false;
  await expect(withFrozenResource(loaded.resource,()=>{called=true;})).rejects.toThrow();expect(called).toBe(false);
 });
 it('does not trust a modified private resource descriptor',async()=>{const f=fixture(),loaded=loadPinnedResource(f.env);if(loaded.state!=='ready')throw new Error();await expect(withFrozenResource({...loaded.resource,addonDir:'dist'} as PinnedResource,()=>{})).rejects.toThrow();});
 it('rejects a self-consistent but not yet compatible plugin version',()=>{
  const f=fixture(),xml='<package><version>0.3.3</version></package>';fs.writeFileSync(path.join(f.root,'addon/package.xml'),xml);f.files['addon/package.xml']=digest(xml);
  expect(loadPinnedResource(f.write({plugin_version:'0.3.3'})).state).toBe('invalid');
 });
 it('allows an ordinary empty Python module and preserves it in the frozen whitelist',async()=>{
  const f=fixture();fs.writeFileSync(path.join(f.root,'addon/__init__.py'),'');f.files['addon/__init__.py']=digest('');const loaded=loadPinnedResource(f.write());expect(loaded.state).toBe('ready');if(loaded.state!=='ready')throw new Error();
  await withFrozenResource(loaded.resource,frozen=>{expect(fs.statSync(path.join(frozen.addonDir,'__init__.py')).size).toBe(0);});
 });
 it.each(['addon/InitGui.py','addon/package.xml','addon/LICENSE','addon/NOTICE','addon/README.md','scripts/install-addon.mjs','dist/server.mjs'])('rejects an empty required file: %s',name=>{
  const f=fixture();fs.writeFileSync(path.join(f.root,name),'');f.files[name]=digest('');expect(loadPinnedResource(f.write()).state).toBe('invalid');
 });
});
