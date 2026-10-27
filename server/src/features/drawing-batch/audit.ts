import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {scanDrawingCandidates} from './scan.js';
import type {DrawingAuditPreview,DrawingAuditRow,DrawingIssue} from './types.js';
import {fcstdWorkspace,safeFcstdPath,readFcstdBatchArchive,fcstdFingerprint} from '../../lib/fcstdBatchFiles.js';
import {fcstdXmlObjects,objectString,xmlAttribute,type FcstdXmlObject} from '../../lib/fcstdLinkIdentity.js';
import {inspectFcstdBatchTarget} from '../../lib/fcstdDocumentXmlService.js';
import {makeFcstdIncludedNamesPortable} from '../../lib/fcstdArchiveNames.js';
import {drawingFacts} from '../drawing-research/service.js';
import {planMaintenance,type MaintenancePlan} from '../drawing-research/maintenance.js';
import type {MaintenancePatch} from '../drawing-research/maintenance-runner.js';
import {paperTypographyDiagnostics} from './paperTypography.js';
import {nativePaperTypographyDiagnostics} from './nativePaperTypography.js';
import {drawingLineWidthRole,drawingLineWidthSettings,nativeLineWidthDiagnostics} from './nativeLineWidth.js';
import {inspectDrawingNative} from '../drawing-research/native-inspection.js';

const TTL=10*60*1000;
type AuditEntry={row:DrawingAuditRow;patches:Map<string,MaintenancePatch>;native?:MaintenancePlan};
export type DrawingAuditPlan={root:string;expires:number;entries:Map<string,AuditEntry>};
const plans=new Map<string,DrawingAuditPlan>();
const semantic=(xml:string)=>xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
const scalar=(object:FcstdXmlObject,key:string)=>{
 const content=object.properties.get(key)?.content||'';
 // Native PropertyEnumeration stores a selected index plus an explicit list.
 // Resolve only that complete saved list, never hardcode FreeCAD enum numbers.
 const enumeration=content.match(/<Enumeration\b([^>]*)>([\s\S]*?)<\/Enumeration>/);
 if(enumeration){
  const value=xmlAttribute(enumeration[1],'value'),count=xmlAttribute(enumeration[1],'count');
  const options=[...enumeration[2].matchAll(/<Enum\b[^>]*>/g)].map(([tag])=>xmlAttribute(tag,'value'));
  if(/^\d+$/.test(value)&&/^\d+$/.test(count)&&Number(count)===options.length&&new Set(options).size===options.length&&Number(value)<options.length)return options[Number(value)];
  return '';
 }
 const tag=content.match(/<(?:String|Font|Enum|Float|Integer|Bool)\b[^>]*>/)?.[0];
 return tag?xmlAttribute(tag,'value'):'';
};
function texts(object:FcstdXmlObject){
 const content=object.properties.get('EditableTexts')?.content||'', result=new Map<string,string>();
 for(const [tag] of content.matchAll(/<(?:String|Item|Entry)\b[^>]*>/g)){
  const key=xmlAttribute(tag,'key')||xmlAttribute(tag,'name'); if(!key)continue;
  if(result.has(key))throw new Error('图框字段重复，需人工确认'); result.set(key,xmlAttribute(tag,'value'));
 }
 return result;
}
function typeNames(xml:string){
 const declarations=semantic(xml).match(/<Objects\b[^>]*>([\s\S]*?)<\/Objects>/)?.[1]||'';
 return new Map([...declarations.matchAll(/<Object\b[^>]*>/g)].map(([tag])=>[xmlAttribute(tag,'name'),xmlAttribute(tag,'type')]));
}
function defaults(root:string){
 const rel='.phoenix/drawing-defaults.json';
 if(!fs.existsSync(path.join(root,rel)))return {values:{} as Record<string,unknown>,proof:{path:rel,fingerprint:null}};
 const file=safeFcstdPath(root,rel);if(fs.statSync(file).size>1024*1024)throw new Error('图纸空间配置过大');
 const bytes=fs.readFileSync(file),parsed:unknown=JSON.parse(bytes.toString('utf8'));if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('图纸空间配置无效');
 return {values:parsed as Record<string,unknown>,proof:{path:rel,fingerprint:fcstdFingerprint(bytes)}};
}
function fontOption(value:unknown,fallback:string){
 if(value===undefined)return fallback;
 if(typeof value!=='string'||value.length>128||/[\x00-\x1f]/.test(value))throw new Error('字体请求必须为有效名称');
 return value.trim();
}
function guiFonts(xml:string){
 const result=new Map<string,string>();
 for(const match of semantic(xml).matchAll(/<ViewProvider\b([^>]*)>([\s\S]*?)<\/ViewProvider>/g)){
  const name=xmlAttribute(match[1],'name');const field=match[2].match(/<Property\b[^>]*name=["']Font["'][^>]*>([\s\S]*?)<\/Property>/)?.[1];
  const tag=field?.match(/<(?:Font|String)\b[^>]*>/)?.[0];if(name&&tag)result.set(name,xmlAttribute(tag,'value'));
 }
 return result;
}
function viewVisibility(xml:string,name:string){
 const block=[...semantic(xml).matchAll(/<ViewProvider\b([^>]*)>([\s\S]*?)<\/ViewProvider>/g)].find(match=>xmlAttribute(match[1],'name')===name)?.[2];
 const field=block?.match(/<Property\b[^>]*name=["']Visibility["'][^>]*>([\s\S]*?)<\/Property>/)?.[1];const tag=field?.match(/<Bool\b[^>]*>/)?.[0];
 return tag?xmlAttribute(tag,'value').toLowerCase():'';
}
function safeMembers(files:Record<string,Uint8Array>){
 for(const name of Object.keys(files)){
  const parts=name.replace(/\\/g,'/').split('/');
  if(name.startsWith('/')||/^[A-Za-z]:/.test(name)||/[\x00-\x1f]/.test(name)||parts.some(p=>p==='..'))throw new Error('FCStd 内部路径不安全');
 }
}
function inspectRow(root:string,rel:string,settings:{material:string;dimensionFont:string;annotationFont:string;config:NonNullable<MaintenancePlan['audit_config']>;values:Record<string,unknown>}):AuditEntry|null{
 const archive=readFcstdBatchArchive(safeFcstdPath(root,rel),true);safeMembers(archive.files);
 if(/<!DOCTYPE|<!ENTITY/i.test(semantic(archive.xml)))throw new Error('不读取带外部实体的图纸');
 const facts=drawingFacts(archive.xml);if(!facts.pages.length)return null;
 const objects=fcstdXmlObjects(archive.xml), types=typeNames(archive.xml), byName=new Map(objects.map(o=>[o.name,o]));
 const row:DrawingAuditRow={id:randomUUID(),rel,fingerprint:fcstdFingerprint(archive.bytes),issues:[]};
 const projectionHashes:Record<string,string>={[rel]:row.fingerprint};
 const patches=new Map<string,MaintenancePatch>();
 const issue=(kind:DrawingIssue['kind'],location:string,field:string,current:string,proposed:string,status:DrawingIssue['status'],message:string,patch?:MaintenancePatch)=>{
  const item:DrawingIssue={id:randomUUID(),kind,location,field,current,proposed,status,message};row.issues.push(item);
  if(patch&&status==='ready')patches.set(item.id,patch);
 };
 if(facts.pages.length!==1)issue('source','Document','Pages',String(facts.pages.length),'','manual','当前原生修正仅支持单页；多页保留原样');
 const sourceCandidates=new Map<string,{rel:string;node:string;object:FcstdXmlObject}>();
 const links:Array<{object:FcstdXmlObject;file:string;node:string;sourceRel?:string;sourceNode?:string;sourceObject?:FcstdXmlObject}>=[];
 for(const object of objects){
  if(types.get(object.name)!=='App::Link')continue;
  const tags=[...(object.properties.get('LinkedObject')?.content||'').matchAll(/<XLink\b[^>]*>/g)];
  if(tags.length!==1){issue('source',object.name,'LinkedObject','','','manual','源引用缺失或多目标，不能猜测');continue;}
  const file=xmlAttribute(tags[0][0],'file'),node=xmlAttribute(tags[0][0],'name');const link={object,file,node} as typeof links[number]; links.push(link);
  try{
   if(!file)throw new Error('源引用没有文件路径');
   const filename=safeFcstdPath(root,path.relative(root,path.resolve(root,path.posix.dirname(rel),file.replace(/\\/g,'/'))));
   const source=readFcstdBatchArchive(filename,true),selected=inspectFcstdBatchTarget(source.xml);safeMembers(source.files);
   if(node&&node!==selected.objectName)throw new Error('引用不是可证明唯一的源主节点');
   const actual=fcstdXmlObjects(source.xml).filter(o=>o.name===selected.objectName);if(actual.length!==1)throw new Error('源主节点不唯一');
   link.sourceRel=path.relative(root,filename).replace(/\\/g,'/');link.sourceNode=selected.objectName;link.sourceObject=actual[0];
   const digest=fcstdFingerprint(source.bytes);if(projectionHashes[link.sourceRel]&&projectionHashes[link.sourceRel]!==digest)throw new Error('校核期间源文件发生变化');projectionHashes[link.sourceRel]=digest;
   sourceCandidates.set(link.sourceRel+'\0'+link.sourceNode,{rel:link.sourceRel,node:link.sourceNode,object:actual[0]});
   const bodyNames=[...typeNames(source.xml)].filter(([,type])=>type==='PartDesign::Body').map(([name])=>name);
   const gui=source.files['GuiDocument.xml']?new TextDecoder().decode(source.files['GuiDocument.xml']):'';
   const visibility=new Map<string,boolean>();
   for(const match of semantic(gui).matchAll(/<ViewProvider\b([^>]*)>([\s\S]*?)<\/ViewProvider>/g)){
    const field=match[2].match(/<Property\b[^>]*name=["']Visibility["'][^>]*>([\s\S]*?)<\/Property>/)?.[1];const tag=field?.match(/<Bool\b[^>]*>/)?.[0];
    if(tag){const value=xmlAttribute(tag,'value');if(['true','false','0','1'].includes(value))visibility.set(xmlAttribute(match[1],'name'),value==='true'||value==='1');}
   }
   if(bodyNames.length&&bodyNames.every(name=>visibility.get(name)===false))issue('source',object.name,'SourceBody.Visibility','all hidden','','manual','源主Body可能全部隐藏；需检查Body/Tip及实际Shape/投影边，禁止自动显全部历史对象或保存源3D');
   else if(bodyNames.some(name=>!visibility.has(name)))issue('source',object.name,'SourceBody.Visibility','unknown','','manual','源GuiDocument或主Body可见性缺资料；外层Drawing Link隐藏不等于空图，需原生及人工校核');
   const proposed=path.posix.relative(path.posix.dirname(rel),link.sourceRel);
   if(!node)issue('link',object.name,'LinkedObject',file+'#'+node,proposed+'#'+selected.objectName,'manual','缺少源节点名：原生源对象无法确证，先修引用/人工核对；不绕过Shape及原尺寸基线');
   else if(file!==proposed)issue('link',object.name,'LinkedObject',file+'#'+node,proposed+'#'+selected.objectName,'ready','精确相对路径；只绑定相同且已确认的源主节点',{kind:'link',object:object.name,current_file:file,current_node:node,proposed_file:proposed,proposed_node:selected.objectName});
   else issue('link',object.name,'LinkedObject',file+'#'+node,file+'#'+node,'ok','相对引用及源主节点一致');
  }catch(error){delete link.sourceObject;delete link.sourceRel;delete link.sourceNode;issue('source',object.name,'LinkedObject',file+'#'+node,'','manual',error instanceof Error?error.message:String(error));}
 }
 // Explicit Page.MetadataSource wins only if it points to an already resolved
 // local App::Link. Otherwise only a unique actual source is acceptable.
 const metadataProperty=facts.pages.length===1?byName.get(facts.pages[0])?.properties.get('MetadataSource'):undefined;
 const metadataTag=metadataProperty?.content.match(/<(?:Link|XLink)\b[^>]*>/)?.[0];
 const metadataName=metadataTag?(xmlAttribute(metadataTag,'value')||xmlAttribute(metadataTag,'name')):'';
 const metadataFile=metadataTag?xmlAttribute(metadataTag,'file'):'';
 const explicit=metadataProperty&&metadataName&&!metadataFile?links.find(link=>link.object.name===metadataName&&link.sourceObject):undefined;
 const source=metadataProperty?(explicit?{rel:explicit.sourceRel!,node:explicit.sourceNode!,object:explicit.sourceObject!}:undefined):sourceCandidates.size===1?[...sourceCandidates.values()][0]:undefined;
 if(source){row.source_rel=source.rel;row.source_node=source.node;}
 else issue('source','Document','MetadataSource',metadataName,'','manual',metadataProperty?'显式MetadataSource不能安全解析到本文件已确认的源Link；不以其它模型替代':sourceCandidates.size?'多个源主节点，不能统一推荐标题栏':'未找到唯一可读源主节点');
 const sourceMaterial=source?objectString(source.object,'PartMaterial').trim():'';
 const materialSource=sourceMaterial?'源模型 PartMaterial':settings.material?'工作空间明确配置':'';
 const metadata=source?{number:objectString(source.object,'PartNumber').trim(),revision:objectString(source.object,'PartVersion').trim(),title:objectString(source.object,'PartName').trim()||objectString(source.object,'Label').trim(),material:sourceMaterial||settings.material}:undefined;
 const notes=objects.filter(o=>types.get(o.name)==='TechDraw::DrawViewAnnotation').map(o=>o.properties.get('Text')?.content||'').join('\n');
 const materialConflict=/(?:材料|材质|material).*(?:或|待确认|冲突|alternative)/i.test(notes);
 const roleAliases:Record<string,'number'|'revision'|'title'|'material'>={drawing_number:'number',Drawing_number:'number',revision_index:'revision',revision:'revision',title:'title','FC-Title':'title',part_material:'material',material:'material'};
 const guiXml=archive.files['GuiDocument.xml']?new TextDecoder().decode(archive.files['GuiDocument.xml']):'';
 for(const object of objects.filter(o=>['TechDraw::DrawSVGTemplate','TechDraw::DrawPage'].includes(types.get(o.name)||'')||(types.get(o.name)||'').startsWith('TechDraw::DrawView'))){
  const app=scalar(object,'Visibility'),view=viewVisibility(guiXml,object.name),bool=(value:string)=>value==='false'||value==='0'?'false':value==='true'||value==='1'?'true':'';
  let fields:Array<readonly ['property'|'view',string]>=[['property',app],['view',view]];
  if(object.properties.get('Visibility')?.type==='App::PropertyBool'||types.get(object.name)==='TechDraw::DrawSVGTemplate'){
   // Paper object App/VP visibility may share one native Bool alias. Prefer an
   // explicit App Bool; native must prove both endpoints after the one write.
   const appBool=object.properties.get('Visibility')?.type==='App::PropertyBool'&&bool(app);
   if(appBool&&bool(view)&&appBool!==bool(view)){
    issue('resource',object.name,'Visibility',`App=${appBool}, View=${bool(view)}`,'','conflict','纸面可见性别名序列化不一致；保留原样并人工确认');continue;
   }
   fields=appBool?[['property',app]]:[['view',view]];
  }
  for(const [where,value]of fields){
   if(value==='false'||value==='0')issue('resource',object.name,where==='view'?'ViewObject.Visibility':'Visibility','false','true','ready','仅恢复所选页面/图框/纸面视图可见性；未选项保留，Page.ShowFrames及源Link/历史节点不修改',{kind:where,object:object.name,field:'Visibility',current:'false',proposed:'true'});
  }
 }
 for(const template of objects.filter(o=>types.get(o.name)==='TechDraw::DrawSVGTemplate')){
  const values=texts(template);
  if(!values.size)issue('titleblock',template.name,'EditableTexts','','','manual','图框可编辑字段缺失或序列化不可识别；不新增猜测字段');
  for(const [field,role] of Object.entries(roleAliases)){
   if(!values.has(field))continue;const current=values.get(field)!,proposed=metadata?.[role]||'';
   const kind=role==='material'?'material':'titleblock';
   const status=!proposed?'manual':current===proposed?'ok':current.trim()||role==='material'&&materialConflict?'conflict':'ready';
   const explanation=status==='conflict'?'已有人工值或材料说明，保留并人工核对':status==='manual'?'缺少可信源字段，不猜测':status==='ok'?'与推荐来源一致':'仅补全空白字段；不写源3D';
   const message=role==='material'?proposed?`材料来源：${materialSource}；${explanation}`:'缺少源材料/明确配置，需人工确认；保留原图材料，不采用隐式缺省牌号':explanation;
   issue(kind,template.name,field,current,proposed,status,message,{kind:'text',object:template.name,field,current,proposed});
  }
 }
 for(const link of links)if(link.sourceObject){
  const current=objectString(link.object,'Label'),proposed=objectString(link.sourceObject,'Label')+'-Link';
  const status=current===proposed?'ok':!current||current===link.object.name?'ready':'conflict';
  issue('label',link.object.name,'Label',current,proposed,status,status==='conflict'?'保留人工引用标签':'只修改该引用对象的显示标签',{kind:'label',object:link.object.name,current,proposed});
 }
 for(const pageName of facts.pages){
  const page=byName.get(pageName);if(!page)continue;
  const current=objectString(page,'Label');const templateName=xmlAttribute(page.properties.get('Template')?.content.match(/<Link\b[^>]*>/)?.[0]||'','value');
  const values=byName.has(templateName)?texts(byName.get(templateName)!):new Map<string,string>();
  const kind=values.get('document_type')?.includes('装配')?'装配图':values.get('document_type')?.includes('下料')?'下料图':'零件图';
  const proposed=metadata?.number&&metadata.revision?metadata.number+'.'+metadata.revision+'-'+kind:'';
  const status=!proposed?'manual':current===proposed?'ok':!current||current===pageName?'ready':'conflict';
  issue('label',pageName,'Label',current,proposed,status,status==='conflict'?'保留人工页面标签':status==='manual'?'图号或版本缺失，不猜测页面名':'图号、版本和图纸类别生成页面显示名',{kind:'label',object:pageName,current,proposed});
 }
 for(const diagnostic of paperTypographyDiagnostics(objects,types,guiXml,archive.files,settings.values)){
  issue(diagnostic.kind,diagnostic.location,diagnostic.field,diagnostic.current,diagnostic.proposed,diagnostic.status,diagnostic.message);
 }
 const lineWidths=drawingLineWidthSettings(settings.values);
 for(const object of objects){
  const role=drawingLineWidthRole(types.get(object.name)||'');if(!role)continue;
  issue('dimension',object.name,'ViewObject.LineWidth','未获取原生值',String(lineWidths[role])+' mm','manual','线宽仅在原生字段、属性类型和毫米单位确证后提供逐项修正；保留未勾选的人工样式，不修改隐藏线或逐Edge覆盖');
 }
 const fonts=guiFonts(guiXml);
 for(const object of objects){
  const dimension=types.get(object.name)==='TechDraw::DrawViewDimension',annotation=types.get(object.name)==='TechDraw::DrawViewAnnotation';
  if(!dimension&&!annotation)continue;
  const current=dimension?fonts.get(object.name):scalar(object,'Font');const proposed=dimension?settings.dimensionFont:settings.annotationFont;
  const field=dimension?'ViewObject.Font':'Font';
  const status=current===undefined?'manual':!proposed?'manual':current===proposed?'ok':'ready';
  issue('font',object.name,field,current||'',proposed,status,status==='manual'?'字体位置或明确字体请求缺失，仅建议人工核对':'执行前原生核对字体家族；缺失或fallback整文件保留原样',{kind:dimension?'view':'property',object:object.name,field:'Font',current:current||'',proposed});
  if(dimension){
   const references=object.properties.get('References2D')?.content||'';
   issue('dimension',object.name,'References2D',references.slice(0,1000),'','manual',!references||/corrupt|invalid/i.test(references)?'尺寸引用缺失或已报损坏，需核对真实Edge/Vertex；禁止猜测或改固定文字':'静态仅识别引用结构；真实Edge/Vertex及尺寸值仍需原生/人工校核');
   const format=scalar(object,'FormatSpec'),type=scalar(object,'Type');
   if(format.includes('Ø'))issue('dimension',object.name,'FormatSpec',format,type==='Diameter'?format.replaceAll('Ø','⌀'):format,type==='Diameter'?'ready':'manual',type==='Diameter'?'确证Diameter；仅替换直径符号，保留公差/引用/布局':'Type语义未确证，不能猜测数值枚举',{kind:'property',object:object.name,field:'FormatSpec',current:format,proposed:format.replaceAll('Ø','⌀')});
  }
 }
 try{
  const clone=Object.fromEntries(Object.entries(archive.files));const portable=makeFcstdIncludedNamesPortable(clone,archive.xml);
  const chain=new Map(portable.repairs.map(p=>[p.from,p.to]));const used=new Set<string>();
  for(const {from} of portable.repairs){if(!archive.files[from]||used.has(from))continue;let to=chain.get(from)!;const seen=new Set([from]);while(chain.has(to)&&!seen.has(to)){seen.add(to);to=chain.get(to)!;}
   const reference=[...archive.xml.matchAll(/<FileIncluded\b[^>]*>/g)].map(([tag])=>xmlAttribute(tag,'file')).find(name=>name===from||seen.has(name))||to;
   used.add(from);issue('resource','Archive',reference,from,to,'ready','仅修复所选FileIncluded成员；保持原位置、内容与其它成员顺序',{kind:'resource',current:from,proposed:to,reference,proposed_reference:to});
  }
 }catch(error){
  const detail=error instanceof Error?error.message:String(error);
  issue('resource','Archive','FileIncluded','','','manual',detail.startsWith('FCStd内嵌资源缺失或歧义:')
   ?'内嵌资源名称无法安全匹配：可能缺失、歧义或本版不支持的编码链；未猜测替换。'+detail
   :detail);
 }
 let native:MaintenancePlan|undefined;
 try{if(facts.pages.length!==1)throw new Error('当前仅支持单页原生修正');native=planMaintenance({workspace:root,rel,destination:rel,export_pdf:true,material:''},{audit_config:settings.config});
  for(const [file,digest]of Object.entries(projectionHashes))if(native.fingerprints[file]!==digest)throw new Error('用于推荐的图纸/源字节已变化，请重新校核');
 }
 catch(error){native=undefined;const reason=error instanceof Error?error.message:String(error);for(const item of row.issues)if(item.status==='ready'){item.status='manual';item.message+='；无法建立全依赖保护：'+reason;}patches.clear();}
 return {row,patches,native};
}
function assertNotAborted(signal?:AbortSignal){if(signal?.aborted)throw new Error('图纸校核预览已取消；未保存预览计划');}
export async function previewDrawingAudit(workspace:string,input:{directory:string;recursive?:boolean;dimension_font?:string;annotation_font?:string;native_inspection?:boolean;signal?:AbortSignal}):Promise<DrawingAuditPreview>{
 if(!input||typeof input!=='object'||typeof input.directory!=='string'||input.recursive!==undefined&&typeof input.recursive!=='boolean')throw new Error('校核参数无效');
 assertNotAborted(input.signal);
 const scan=await scanDrawingCandidates(workspace,input.directory,input.recursive||false),configuration=defaults(scan.root),config=configuration.values;
 drawingLineWidthSettings(config);
 const settings={material:typeof config.material==='string'?config.material.trim():'',dimensionFont:fontOption(input.dimension_font,typeof config.dimension_font==='string'?config.dimension_font:'osifont'),annotationFont:fontOption(input.annotation_font,typeof config.annotation_font==='string'?config.annotation_font:''),config:configuration.proof,values:config};
 const entries=new Map<string,AuditEntry>();const rows:DrawingAuditRow[]=[];
 for(const rel of scan.files){assertNotAborted(input.signal);try{
  const item=inspectRow(scan.root,rel,settings);if(!item)continue;
  if(input.native_inspection===true&&item.native){
   try{
    const inspected=await inspectDrawingNative(item.native,{signal:input.signal});
    assertNotAborted(input.signal);
    if(inspected.inspection_error)throw new Error(inspected.inspection_error);
    const expected=item.row.issues.filter(issue=>issue.field==='References2D').map(issue=>issue.location).sort();
    const actual=inspected.dimensions.map(dimension=>dimension.dimension).sort();
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('原生尺寸校核覆盖不完整；保持原件');
    for(const diagnostic of nativePaperTypographyDiagnostics(inspected,item.row.issues,config))item.row.issues.push({id:randomUUID(),...diagnostic});
    for(const {diagnostic,patch} of nativeLineWidthDiagnostics(inspected,config)){
     const issue=item.row.issues.find(value=>value.location===diagnostic.location&&value.field==='ViewObject.LineWidth');
     if(!issue)continue; // Never authorize a receipt-only or unsupported object.
     if(diagnostic.proposed&&diagnostic.proposed!==issue.proposed){
      issue.current=diagnostic.current;issue.status='manual';issue.message='原生线宽对象类别与保存的轮廓/尺寸类别不一致；保持原线宽，不生成修正项';continue;
     }
     Object.assign(issue,diagnostic);
     if(patch&&issue.status==='ready')item.patches.set(issue.id,patch);
    }
    for(const dimension of inspected.dimensions){
     const diagnostic=item.row.issues.find(issue=>issue.location===dimension.dimension&&issue.field==='References2D');
     if(!diagnostic)continue;
     diagnostic.current=`实际值 ${dimension.actual_value===null?'未知':Number(dimension.actual_value.toPrecision(8))}；`+dimension.references.map(reference=>`${reference.view}.${reference.sub} (${reference.status})`).join('；');
     diagnostic.status=dimension.status==='valid'?'ok':'manual';
     diagnostic.message=dimension.status==='valid'?'原生实际投影引用有效；保存/重开仍比较真实几何，不只比较编号或数值':dimension.reason||'原生引用失效或不能确认；保留并人工重绑，不猜Edge/Vertex';
     const format=item.row.issues.find(issue=>issue.location===dimension.dimension&&issue.field==='FormatSpec');
     if(format&&dimension.status==='valid'&&dimension.type==='Diameter'&&format.current.includes('Ø')){
      format.proposed=format.current.replaceAll('Ø','⌀');format.status='ready';
      format.message='原生确证Diameter及真实引用；仅替换直径符号，保留公差/引用/布局';
      item.patches.set(format.id,{kind:'property',object:dimension.dimension,field:'FormatSpec',current:format.current,proposed:format.proposed});
     }
    }
    if(inspected.dimensions.some(dimension=>dimension.status!=='valid')){
     item.row.issues.push({id:randomUUID(),kind:'dimension',location:'Document',field:'NativeDimensionSafety',current:'manual',proposed:'',status:'manual',message:'存在失效或未确认的原生尺寸引用；执行器会保留整文件，修好引用后重新预览'});
     for(const issue of item.row.issues)if(issue.status==='ready'){issue.status='manual';issue.message+='；原生尺寸引用尚未确证，未开放整文件自动修改';}item.patches.clear();
    }
    item.row.issues.push({id:randomUUID(),kind:'source',location:'Document',field:'NativeSourceSafety',current:`${inspected.source_safety.status}; ${inspected.source_safety.source_document_count}源文档/${inspected.source_safety.source_link_count}链接/${inspected.source_safety.source_joint_count}连接`,proposed:'',status:inspected.source_safety.status==='verified'?'ok':'manual',message:inspected.source_safety.reason||'私有配置及实际源组件/连接Frames守护已验证；不宣称整个源装配工程健康'});
    for(const failure of inspected.source_safety.source_object_errors||[])item.row.issues.push({id:randomUUID(),kind:'source',location:failure.file+':'+failure.object,field:'NativeSourceObjectState',current:failure.states.join('/')+'；'+failure.status,proposed:'',status:'manual',message:'既有源对象故障保留、未修复；只有故障状态、目标、Frames及位姿前后保持时才允许所选图纸字段修改，不代表源工程健康'});
    if(inspected.source_safety.status!=='verified'){
     for(const issue of item.row.issues)if(issue.status==='ready'){issue.status='manual';issue.message+='；源装配保护尚未确证，未开放自动修改';}item.patches.clear();
    }
   }catch(error){
    if(input.signal?.aborted||error instanceof Error&&error.name==='AbortError')throw error;
    const reason=error instanceof Error?error.message:String(error);
    item.row.issues.push({id:randomUUID(),kind:'source',location:'Document',field:'NativeInspection',current:'unavailable',proposed:'',status:'manual',message:reason});
    for(const issue of item.row.issues)if(issue.status==='ready'){issue.status='manual';issue.message+='；原生预检未完成，保持原件';}item.patches.clear();
   }
  }
  entries.set(item.row.id,item);rows.push(structuredClone(item.row));
 }catch(error){if(input.signal?.aborted||error instanceof Error&&error.name==='AbortError')throw error;rows.push({id:randomUUID(),rel,fingerprint:'',issues:[],error:error instanceof Error?error.message:String(error)});}}

 assertNotAborted(input.signal);
 const plan_id=randomUUID(),expires=Date.now()+TTL;plans.set(plan_id,{root:scan.root,expires,entries});
 for(const [id,p]of plans)if(p.expires<Date.now()||plans.size>20)plans.delete(id);
 return {plan_id,workspace:scan.root,directory:scan.directory,recursive:scan.recursive,expires_at:new Date(expires).toISOString(),scanned:scan.scanned,rows,warnings:scan.warnings};
}
export function consumeDrawingAudit(workspace:string,id:string,validate?:(plan:DrawingAuditPlan)=>void){
 const root=fcstdWorkspace(workspace),plan=plans.get(id);
 if(!plan||plan.root!==root||plan.expires<=Date.now())throw new Error('图纸校核计划不存在、过期或不属于当前工作空间');
 validate?.(plan);plans.delete(id);return plan;
}
