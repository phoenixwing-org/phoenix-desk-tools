import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import type {FreecadMcpInstallPlan,FreecadMcpStatus} from '../../../../shared/freecad-mcp/contracts.js';
import {checkedBytes,checkedDirectory,safeResourceRelative,verifyPinnedResource,withFrozenResource,type PinnedResource} from './resource.js';

const ADDON='PhoenixFreeCADTools',MARKER='.phoenix-freecad-tools-install.json';
const identities=[{addon:ADDON,marker:MARKER,owner:'phoenix-freecad-tools'},...['PhoenixFreeCADMCP','PhoenixMCP'].map(addon=>({addon,marker:'.phoenix-freecad-mcp-install.json',owner:'phoenix-freecad-mcp'}))];
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const present=(filename:string)=>{try{fs.lstatSync(filename);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}};
const fail=():never=>{throw new Error('MCP 安装来源、目标或计划已变化；保留现有插件，请重新检测与预览');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const sorted=(files:Record<string,string>)=>Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
type Snapshot={files:Record<string,string>;directories:string[]};
function snapshot(root:string,marker:string):Snapshot {
 checkedDirectory(root);const files:Record<string,string>={},directories:string[]=[];let total=0,count=0;
 const walk=(folder:string,prefix='')=>{
  for(const name of fs.readdirSync(folder).sort()){
   const relative=prefix?prefix+'/'+name:name;if(!safeResourceRelative(relative)||++count>1024)return fail();
   const filename=path.join(folder,name),stat=fs.lstatSync(filename);
   if(stat.isSymbolicLink())return fail();
   if(relative===marker){checkedBytes(filename,1024*1024);continue;}
   if(stat.isDirectory()&&name==='__pycache__'){
    checkedDirectory(filename);for(const cached of fs.readdirSync(filename)){if(!cached.endsWith('.pyc'))return fail();const contents=checkedBytes(path.join(filename,cached));total+=contents.length;if(total>64*1024*1024||++count>1024)return fail();}continue;
   }
   if(stat.isDirectory()){checkedDirectory(filename);directories.push(relative);walk(filename,relative);}
   else{const bytes=checkedBytes(filename);total+=bytes.length;if(total>64*1024*1024)return fail();files[relative]=sha(bytes);}
  }
 };walk(root);return {files:sorted(files),directories:directories.sort()};
}
export interface InstallationInspection {
 installation:FreecadMcpStatus['installation'];fingerprint:string;target:string;files:Record<string,string>;
}
/** Observes only the exact known addon names inside the selected, existing Mod directory. */
export function inspectInstallation(modDir:string):InstallationInspection {
 const target=path.join(modDir,ADDON),result=(state:FreecadMcpStatus['installation']['state'],reason:string,version:string|null=null,files:Record<string,string>={},fingerprint='invalid'):InstallationInspection=>({installation:{state,version,reason},fingerprint,target,files});
 try{
  const root=checkedDirectory(modDir),stat=fs.lstatSync(root),base=[root,stat.dev,stat.ino];
  const found=identities.filter(identity=>present(path.join(root,identity.addon)));
  if(!found.length)return result('absent','所选 Mod 目录未发现 Phoenix 插件',null,{},sha(JSON.stringify([...base,'absent'])));
  if(found.length!==1)return result('invalid','存在多个新旧插件目录，未选择安装目标');
  const identity=found[0],folder=checkedDirectory(path.join(root,identity.addon)),markerFile=path.join(folder,identity.marker);
  if(!present(markerFile))return result('unmanaged','已有插件不带受管安装标记，不会覆盖');
  const markerBytes=checkedBytes(markerFile,1024*1024),marker:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(markerBytes));
  if(!object(marker)||marker.schema_version!==1||marker.owner!==identity.owner||marker.addon!==identity.addon||!object(marker.files)||!Object.keys(marker.files).length||Object.keys(marker.files).length>512
   ||Object.entries(marker.files).some(([name,hash])=>!safeResourceRelative(name)||identities.some(i=>i.marker===name)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))
   ||!Array.isArray(marker.directories)||marker.directories.length>512||marker.directories.some(d=>!safeResourceRelative(d))||new Set(marker.directories).size!==marker.directories.length)return result('invalid','安装标记无效，未授权覆盖');
  const actual=snapshot(folder,identity.marker),expected={files:sorted(marker.files as Record<string,string>),directories:[...marker.directories].sort()};
  if(JSON.stringify(actual)!==JSON.stringify(expected))return result('modified','插件存在手工修改、新增或缺失文件；不会覆盖');
  let version:string|null=null;try{const xml=checkedBytes(path.join(folder,'package.xml'),256*1024).toString('utf8');const versions=[...xml.matchAll(/<version>\s*([^<]+)\s*<\/version>/g)];if(versions.length===1&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(versions[0][1].trim()))version=versions[0][1].trim();}catch{/* Marker ownership does not invent package metadata. */}
  return result('managed',identity.addon===ADDON?'受管插件文件与安装标记一致':'已核验旧版受管插件，更新将迁移为当前目录名',version,actual.files,sha(JSON.stringify([...base,identity.addon,sha(markerBytes),actual])));
 }catch{return result('invalid','插件目录、文件类型或安装标记未通过核验');}
}
export interface FrozenInstallPlan {readonly preview:FreecadMcpInstallPlan;readonly resource:PinnedResource;readonly modDir:string;readonly targetFingerprint:string;readonly operation:'install'|'update'|'unchanged';readonly migratedFrom?:string}
type Installer={ADDON_NAME:string;INSTALL_MARKER:string;installAddon:(options:{modDir:string;sourceDir:string;dryRun:boolean})=>unknown};
async function installer(entry:string):Promise<Installer>{
 const module:unknown=await import(pathToFileURL(entry).href);if(!object(module)||module.ADDON_NAME!==ADDON||module.INSTALL_MARKER!==MARKER||typeof module.installAddon!=='function')return fail();return module as unknown as Installer;
}
function backupDirectory(modDir:string):string {
 const folder=path.join(path.dirname(modDir),'.phoenix-freecad-tools');
 if(present(folder))checkedDirectory(folder);return folder;
}
const operation=(value:unknown):'install'|'update'|'unchanged'=>{if(value==='install'||value==='unchanged')return value;if(value==='update'||value==='migrate')return 'update';return fail();};
export async function prepareInstall(resource:PinnedResource,modDir:string):Promise<FrozenInstallPlan> {
 try{
  verifyPinnedResource(resource);const root=checkedDirectory(modDir),before=inspectInstallation(root);
  if(!['absent','managed'].includes(before.installation.state))return fail();
  const backupParent=backupDirectory(root);
  const action=await withFrozenResource(resource,async frozen=>{
   const loaded=await installer(frozen.installerEntry),preview=await loaded.installAddon({modDir:root,sourceDir:frozen.addonDir,dryRun:true});
   if(!object(preview)||preview.dryRun!==true||preview.modDir!==root||preview.target!==before.target)return fail();
   const selectedOperation=operation(preview.action);
   if(preview.action==='migrate'){
    if(typeof preview.migratedFrom!=='string'||!identities.slice(1).some(identity=>preview.migratedFrom===path.join(root,identity.addon))||!present(preview.migratedFrom)||present(before.target))return fail();
    return {operation:selectedOperation,migratedFrom:preview.migratedFrom};
   }
   if(preview.migratedFrom!==undefined)return fail();return {operation:selectedOperation};
  });
  if(inspectInstallation(root).fingerprint!==before.fingerprint)return fail();
  const prefix=resource.addonDir+'/',desired=Object.fromEntries(Object.entries(resource.files).filter(([name])=>name.startsWith(prefix)).map(([name,hash])=>[name.slice(prefix.length),hash]));
  const changes:NonNullable<FreecadMcpInstallPlan['changes']>=[...new Set([...Object.keys(before.files),...Object.keys(desired)])].sort().flatMap(name=>before.files[name]===desired[name]?[]:[{path:name,kind:!before.files[name]?'add' as const:!desired[name]?'remove' as const:'change' as const}]);
  if(action.operation==='unchanged'&&changes.length||action.operation!=='unchanged'&&!changes.length&&!action.migratedFrom)return fail();
  const preview:FreecadMcpInstallPlan={state:'ready',reason:action.migratedFrom
   ?'将旧版受管插件目录迁移为 PhoenixFreeCADTools，旧目录先在 Mod 目录之外备份；即使文件无差异也需迁移。不启动或重启 FreeCAD。'
   :'仅安装插件文件，不启动或重启 FreeCAD；运行中插件仍须另行检查连接',operation:action.operation,source_version:resource.version,source_digest:resource.digest,target:before.target,backup_parent:backupParent,changes};
  return Object.freeze({preview:Object.freeze(preview),resource,modDir:root,targetFingerprint:before.fingerprint,operation:action.operation,...(action.migratedFrom?{migratedFrom:action.migratedFrom}:{})});
 }catch{return fail();}
}
export async function applyInstall(plan:FrozenInstallPlan):Promise<{state:'installed'|'unchanged';backup:string|null}> {
 try{
  verifyPinnedResource(plan.resource);if(inspectInstallation(plan.modDir).fingerprint!==plan.targetFingerprint)return fail();
  const fresh=await prepareInstall(plan.resource,plan.modDir);
  if(fresh.targetFingerprint!==plan.targetFingerprint||fresh.operation!==plan.operation||fresh.migratedFrom!==plan.migratedFrom||JSON.stringify(fresh.preview)!==JSON.stringify(plan.preview))return fail();
  const result=await withFrozenResource(plan.resource,async frozen=>{
   if(inspectInstallation(plan.modDir).fingerprint!==plan.targetFingerprint)return fail();
   const loaded=await installer(frozen.installerEntry);return await loaded.installAddon({modDir:plan.modDir,sourceDir:frozen.addonDir,dryRun:false});
  });
  if(!object(result)||result.dryRun!==false||result.modDir!==plan.modDir||result.target!==plan.preview.target||operation(result.action)!==plan.operation||result.migratedFrom!==plan.migratedFrom)return fail();
  const installed=inspectInstallation(plan.modDir),prefix=plan.resource.addonDir+'/',desired=sorted(Object.fromEntries(Object.entries(plan.resource.files).filter(([name])=>name.startsWith(prefix)).map(([name,hash])=>[name.slice(prefix.length),hash])));
  if(installed.installation.state!=='managed'||installed.installation.version!==plan.resource.version||JSON.stringify(installed.files)!==JSON.stringify(desired))return fail();
  let backup:string|null=null;
  if(result.backup!==undefined){if(typeof result.backup!=='string'||path.dirname(result.backup)!==backupDirectory(plan.modDir))return fail();checkedDirectory(result.backup);backup=result.backup;}
  if(plan.operation==='update'&&!backup)return fail();
  return {state:plan.operation==='unchanged'?'unchanged':'installed',backup};
 }catch{return fail();}
}
