import {makeFcstdIncludedNamesPortable} from '../../lib/fcstdArchiveNames.js';
import fs from 'node:fs';import path from 'node:path';import {zipSync,strToU8} from 'fflate';
import {fcstdWorkspace,safeFcstdPath,readFcstdBatchArchive,fcstdFingerprint} from '../../lib/fcstdBatchFiles.js';
import {fcstdNativeXlinkFiles} from '../../lib/fcstdNativeXlinkFiles.js';
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
/** Preserve geometry and embedded content while rebasing native XLinks. Never overwrite. */
export function relocateDrawing(workspace:string,rel:string,destination:string){
 const root=fcstdWorkspace(workspace),source=safeFcstdPath(root,rel);
 if(!/\.drawing\.fcstd$/i.test(source)||!/\.drawing\.fcstd$/i.test(destination))throw new Error('只迁移Drawing.FCStd');
 const parent=safeFcstdPath(root,path.dirname(destination)),target=path.join(parent,path.basename(destination));
 if(fs.existsSync(target))throw new Error('目标已存在');
 const a=readFcstdBatchArchive(source,true),before=fcstdFingerprint(a.bytes);
 const targets=fcstdNativeXlinkFiles(a.xml).map(f=>safeFcstdPath(root,path.relative(root,path.resolve(path.dirname(source),f))));
 const xml=a.xml.replace(/<XLink\b(?:"[^"]*"|'[^']*'|[^'">])*>/g,tag=>{
  const [file]=fcstdNativeXlinkFiles(tag);if(!file)return tag;
  const absolute=path.resolve(path.dirname(source),file);const next=path.relative(parent,absolute).replace(/\\/g,'/');
  return tag.replace(/(\bfile\s*=\s*)(["'])(.*?)\2/,(all,prefix,quote)=>prefix+quote+escape(next)+quote);
 });
 const rebased=fcstdNativeXlinkFiles(xml).map(f=>path.resolve(parent,f));
 if(JSON.stringify(targets)!==JSON.stringify(rebased))throw new Error('外链重定位校验失败');
 a.files['Document.xml']=strToU8(makeFcstdIncludedNamesPortable(a.files,xml).xml);const bytes=zipSync(a.files,{level:6});
 if(fcstdFingerprint(fs.readFileSync(source))!==before)throw new Error('源文件变化');
 fs.writeFileSync(target,bytes,{flag:'wx'});
 try{if(fcstdFingerprint(fs.readFileSync(source))!==before)throw new Error('源文件变化');fs.unlinkSync(source);}
 catch(e){fs.unlinkSync(target);throw e;}
 return {from:rel,to:destination,sha256:fcstdFingerprint(bytes),links:rebased.length};
}
