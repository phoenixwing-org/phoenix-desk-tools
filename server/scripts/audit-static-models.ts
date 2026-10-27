import fs from 'node:fs';import path from 'node:path';
import {readFcstdBatchArchive,fcstdFingerprint,fcstdWorkspace,safeFcstdPath} from '../src/lib/fcstdBatchFiles.js';
const [workspace,scope,output]=process.argv.slice(2);if(!output)throw new Error('workspace scope output.json required');
const root=fcstdWorkspace(workspace),folder=safeFcstdPath(root,scope);
const decode=(s:string)=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const rows=[];
for(const name of fs.readdirSync(folder).sort()){
 if(!/\.fcstd$/i.test(name)||/\.drawing\.fcstd$/i.test(name)||name.startsWith('.'))continue;
 const file=path.join(folder,name),{xml,bytes}=readFcstdBatchArchive(file);
 const objects=new Map<string,{type:string;body:string;label:string}>();
 for(const m of xml.matchAll(/<Object\b[^>]*\/>/g)){const name=m[0].match(/\bname="([^"]+)"/)?.[1],type=m[0].match(/\btype="([^"]+)"/)?.[1];if(name&&type)objects.set(name,{type,body:'',label:name});}
 const data=xml.match(/<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/)?.[1]||'';
 for(const m of data.matchAll(/<Object\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/Object>/g)){
  const o=objects.get(m[1]);if(!o)continue;o.body=m[2];o.label=decode(m[2].match(/<Property name="Label"[^>]*>\s*<String value="([^"]*)"/)?.[1]||m[1]);
 }
 const plugin=[...objects].filter(([,o])=>/module="[^"]*(?:fastener|screw)/i.test(o.body)).map(([n])=>n);
 const sketches=[...objects].filter(([,o])=>o.type==='Sketcher::SketchObject').map(([n])=>n);
 const staticNodes=[...objects].filter(([,o])=>['Part::Feature','PartDesign::Feature','PartDesign::FeatureBase'].includes(o.type)).map(([n,o])=>({name:n,type:o.type,label:o.label}));
 const bodies=[...objects].filter(([,o])=>o.type==='PartDesign::Body').map(([n,o])=>({name:n,tip:o.body.match(/<Property name="Tip"[^>]*>\s*<Link value="([^"]*)"/)?.[1]||'',base:o.body.match(/<Property name="BaseFeature"[^>]*>\s*<Link value="([^"]*)"/)?.[1]||''}));
 const importedBodies=bodies.filter(b=>b.base||staticNodes.some(s=>s.name===b.tip));
 const reference=/参考|焊缝|虚拟/.test(name);
 const candidate=!plugin.length&&(importedBodies.length>0||(staticNodes.length>0&&sketches.length===0));
 rows.push({file:path.relative(root,file),sha256:fcstdFingerprint(bytes),sketch_count:sketches.length,bodies,static_nodes:staticNodes,plugin_nodes:plugin,needs_review:candidate,category:plugin.length?'已有参数插件，保持':candidate?(reference?'参考/过程静态几何，单列核对用途':'静态导入或BaseFeature依赖，待转换核对'):sketches.length?'已有Sketch，未在本次结构检查中发现导入依赖':'装配/其他结构',origin_evidence:'读取保存的节点类型、Body BaseFeature/Tip与Proxy；静态特征不单独证明STEP来源。未重算或保存。'});
}
fs.writeFileSync(output,JSON.stringify({scope,method:'read-only saved XML',count:rows.length,candidates:rows.filter(r=>r.needs_review).length,rows},null,2)+'\n');console.log(rows.length,rows.filter(r=>r.needs_review).length);
