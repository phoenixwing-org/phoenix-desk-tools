import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const LIMITS={manifest:256*1024,file:8*1024*1024,total:64*1024*1024,files:512};
// Keep this exact compatibility gate aligned with the independently validated stdio contract.
const COMPATIBLE_PLUGIN_VERSION='0.3.2';
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const safeResourceRelative=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(value)&&!value.startsWith('/')&&value.split('/').length<=24&&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=():never=>{throw new Error('可信 FreeCAD MCP 资源无效或已变化');};
const stamp=(stat:fs.BigIntStats)=>[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,stat.nlink].join(':');
export function checkedDirectory(directory:string):string {
 if(!path.isAbsolute(directory)||directory.length>4096||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(directory))return fail();
 const normalized=path.resolve(directory);let current=path.parse(normalized).root;
 for(const part of normalized.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())return fail();}
 if(fs.realpathSync(normalized)!==normalized)return fail();return normalized;
}
export function checkedBytes(filename:string,maximum=LIMITS.file):Buffer {
 checkedDirectory(path.dirname(filename));
 const before=fs.lstatSync(filename,{bigint:true});
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(maximum))return fail();
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  if(stamp(fs.fstatSync(fd,{bigint:true}))!==stamp(before))return fail();
  const bytes=Buffer.alloc(Number(before.size)+1);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,Math.min(65536,bytes.length-offset),offset);if(!n)break;offset+=n;}
  if(BigInt(offset)!==before.size||stamp(fs.fstatSync(fd,{bigint:true}))!==stamp(before)||stamp(fs.lstatSync(filename,{bigint:true}))!==stamp(before))return fail();
  return bytes.subarray(0,offset);
 }finally{fs.closeSync(fd);}
}
export interface PinnedResource {
 readonly manifestPath:string;readonly manifestSha:string;readonly root:string;readonly version:string;readonly digest:string;
 readonly addonDir:string;readonly installerEntry:string;readonly mcpEntry?:string;readonly files:Readonly<Record<string,string>>;
}
export type ResourceResult={state:'missing'|'invalid';version:null;reason:string;resource?:never}|{state:'ready';version:string;reason:string;resource:PinnedResource};
export interface FrozenResource {root:string;addonDir:string;installerEntry:string;mcpEntry?:string}
function validate(manifestPath:string,manifestSha:string):PinnedResource {
 if(!path.isAbsolute(manifestPath)||!hash(manifestSha))return fail();
 const bytes=checkedBytes(manifestPath,LIMITS.manifest);if(!bytes.length||sha(bytes)!==manifestSha)return fail();
 const data:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!object(data)||Object.keys(data).some(k=>!['schema_version','plugin_version','addon_dir','installer_entry','mcp_entry','files'].includes(k))||data.schema_version!==1
  ||data.plugin_version!==COMPATIBLE_PLUGIN_VERSION
  ||!safeResourceRelative(data.addon_dir)||!safeResourceRelative(data.installer_entry)||path.posix.basename(data.installer_entry)!=='install-addon.mjs'
  ||data.mcp_entry!==undefined&&!safeResourceRelative(data.mcp_entry)||!object(data.files))return fail();
 const manifestFiles=data.files;
 const names=Object.keys(manifestFiles).sort();if(!names.length||names.length>LIMITS.files||names.some(name=>!safeResourceRelative(name)||name.split('/').some(part=>part.startsWith('.')||['node_modules','__pycache__'].includes(part))||!hash(manifestFiles[name])))return fail();
 if(!names.includes(data.installer_entry)||data.mcp_entry!==undefined&&!names.includes(String(data.mcp_entry)))return fail();
 const root=checkedDirectory(path.dirname(manifestPath)),addonPrefix=data.addon_dir+'/';checkedDirectory(path.join(root,data.addon_dir));
 for(const required of ['InitGui.py','package.xml','LICENSE','NOTICE','README.md'])if(!names.includes(addonPrefix+required)||checkedBytes(path.join(root,data.addon_dir,required),2*1024*1024).length===0)return fail();
 let total=0;
 for(const name of names){const contents=checkedBytes(path.join(root,name));total+=contents.length;if(total>LIMITS.total||sha(contents)!==manifestFiles[name])return fail();}
 // A partial list of a development addon must never silently become a release.
 const actual:string[]=[];let entries=0;const walk=(folder:string,prefix:string)=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){const rel=prefix+entry.name;if(++entries>1024||!safeResourceRelative(rel))return fail();if(entry.isDirectory()){checkedDirectory(path.join(root,rel));walk(path.join(root,rel),rel+'/');}else{checkedBytes(path.join(root,rel));actual.push(rel);if(actual.length>LIMITS.files)return fail();}}};
 walk(path.join(root,data.addon_dir),addonPrefix);if(JSON.stringify(actual.sort())!==JSON.stringify(names.filter(name=>name.startsWith(addonPrefix))))return fail();
 const xml=checkedBytes(path.join(root,data.addon_dir,'package.xml'),256*1024).toString('utf8');
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||[...xml.matchAll(/<version>\s*([^<]+)\s*<\/version>/g)].map(m=>m[1].trim()).join('|')!==data.plugin_version)return fail();
 if(data.mcp_entry!==undefined&&!checkedBytes(path.join(root,String(data.mcp_entry))).length)return fail();
 const installer=checkedBytes(path.join(root,data.installer_entry)).toString('utf8');if(!installer.length)return fail();
 if(/\bimport\s*\(|\brequire\s*\(/.test(installer))return fail();
 const imports=[...installer.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);
 if(imports.some(name=>!['node:fs','node:os','node:path','node:crypto','node:url'].includes(name)))return fail();
 return Object.freeze({manifestPath,manifestSha,root,version:data.plugin_version,digest:manifestSha,addonDir:data.addon_dir,installerEntry:data.installer_entry,
  ...(data.mcp_entry===undefined?{}:{mcpEntry:String(data.mcp_entry)}),files:Object.freeze(Object.fromEntries(names.map(name=>[name,String(manifestFiles[name])])))});
}
/** Only the host environment can pin a release resource; no development-tree fallback. */
export function loadPinnedResource(env:NodeJS.ProcessEnv=process.env):ResourceResult {
 const filename=env.PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST,digest=env.PHOENIX_FREECAD_MCP_RESOURCE_SHA256;
 if(!filename&&!digest)return {state:'missing',version:null,reason:'未配置经核验的本地 MCP 发行资源；不会从开发目录复制或下载'};
 try{if(!filename||!digest)return fail();const resource=validate(filename,digest);return {state:'ready',version:resource.version,reason:'本地固定资源的清单及文件摘要已核验；不代表已正式发布',resource};}
 catch{return {state:'invalid',version:null,reason:'本地 MCP 发行资源的固定摘要、文件清单或许可材料未通过核验'};}
}
export function verifyPinnedResource(resource:PinnedResource):PinnedResource {
 const current=validate(resource.manifestPath,resource.manifestSha);
 if(JSON.stringify(current)!==JSON.stringify(resource))return fail();return current;
}
/** Snapshot exactly the pinned whitelist, never the whole sibling checkout. */
export async function withFrozenResource<T>(resource:PinnedResource,callback:(frozen:FrozenResource)=>Promise<T>|T):Promise<T> {
 verifyPinnedResource(resource);
 const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-freecad-mcp-resource-')));fs.chmodSync(folder,0o700);
 try{
  for(const [relative,expected] of Object.entries(resource.files)){
   const bytes=checkedBytes(path.join(resource.root,relative));if(sha(bytes)!==expected)return fail();
   const destination=path.join(folder,relative);fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});
   if(sha(checkedBytes(destination))!==expected)return fail();
  }
  verifyPinnedResource(resource);
  return await callback({root:folder,addonDir:path.join(folder,resource.addonDir),installerEntry:path.join(folder,resource.installerEntry),...(resource.mcpEntry?{mcpEntry:path.join(folder,resource.mcpEntry)}:{})});
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
