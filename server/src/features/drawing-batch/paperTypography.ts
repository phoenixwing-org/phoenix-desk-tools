import {xmlAttribute,type FcstdXmlObject} from '../../lib/fcstdLinkIdentity.js';
import type {DrawingIssue} from './types.js';

export type DrawingDiagnostic=Omit<DrawingIssue,'id'>;
const semantic=(xml:string)=>xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
function value(content:string):string {
 const enumeration=content.match(/<Enumeration\b([^>]*)>([\s\S]*?)<\/Enumeration>/);
 if(enumeration){
  const selected=xmlAttribute(enumeration[1],'value'),count=xmlAttribute(enumeration[1],'count');
  const options=[...enumeration[2].matchAll(/<Enum\b[^>]*>/g)].map(([tag])=>xmlAttribute(tag,'value'));
  return /^\d+$/.test(selected)&&/^\d+$/.test(count)&&Number(count)===options.length&&new Set(options).size===options.length&&Number(selected)<options.length?options[Number(selected)]:'';
 }
 const tag=content.match(/<(?:String|Font|Enum|Float|Integer|Bool)\b[^>]*>/)?.[0];
 return tag?xmlAttribute(tag,'value'):'';
}
function property(object:FcstdXmlObject,key:string){return value(object.properties.get(key)?.content||'');}
function guiProperties(xml:string,name:string){
 const rows=[...semantic(xml).matchAll(/<ViewProvider\b([^>]*)>([\s\S]*?)<\/ViewProvider>/g)].filter(match=>xmlAttribute(match[1],'name')===name);
 const fields=new Map<string,string>();
 if(rows.length!==1)return fields;
 for(const match of rows[0][2].matchAll(/<Property\b([^>]*)>([\s\S]*?)<\/Property>/g)){
  const key=xmlAttribute(match[1],'name');if(fields.has(key)){fields.set(key,'');continue;}fields.set(key,value(match[2]));
 }
 return fields;
}
function editable(object:FcstdXmlObject){
 const fields=new Map<string,string>();
 for(const [tag]of (object.properties.get('EditableTexts')?.content||'').matchAll(/<(?:String|Item|Entry)\b[^>]*>/g)){
  const key=xmlAttribute(tag,'key')||xmlAttribute(tag,'name');if(fields.has(key)){fields.set(key,'');continue;}if(key)fields.set(key,xmlAttribute(tag,'value'));
 }
 return fields;
}
const positive=(raw:string)=>raw.trim()!==''&&Number.isFinite(Number(raw))&&Number(raw)>0?Number(raw):undefined;
export function parseDrawingRatio(raw:string):number|undefined {
 const match=raw.trim().match(/^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/);
 if(!match)return undefined;const a=positive(match[1]),b=positive(match[2]);return a&&b?a/b:undefined;
}
const commonScales=[10,5,2,1,0.5,0.2,0.1,0.05,0.02,0.01];
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
export function drawingRatioText(scale:number){
 if(!Number.isFinite(scale)||scale<=0)return '';
 if(scale>=1)return `${Number(scale.toPrecision(8))}:1`;
 return `1:${Number((1/scale).toPrecision(8))}`;
}
function lengthMm(raw:string){
 const match=raw.trim().match(/^(\d+(?:\.\d+)?)\s*(mm|cm|in|pt)$/i);if(!match)return undefined;
 const factors:Record<string,number>={mm:1,cm:10,in:25.4,pt:25.4/72};return Number(match[1])*factors[match[2].toLowerCase()];
}
function paperName(width:number,height:number){
 for(const [name,w,h]of [['A4',210,297],['A3',297,420],['A2',420,594],['A1',594,841],['A0',841,1189]] as const){
  if(Math.abs(Math.min(width,height)-w)<=0.25&&Math.abs(Math.max(width,height)-h)<=0.25)return name+(width>height?' 横向':' 纵向');
 }
 return '';
}
export function paperTypographyDiagnostics(objects:FcstdXmlObject[],types:Map<string,string>,guiXml:string,files:Record<string,Uint8Array>,config:Record<string,unknown>={}):DrawingDiagnostic[] {
 const result:DrawingDiagnostic[]=[];
 const add=(kind:DrawingIssue['kind'],location:string,field:string,current:string,proposed:string,status:DrawingIssue['status'],message:string)=>result.push({kind,location,field,current,proposed,status,message});
 const byName=new Map(objects.map(object=>[object.name,object]));
 const configuredHeight=config.dimension_text_height_mm;
 if(configuredHeight!==undefined&&(typeof configuredHeight!=='number'||!Number.isFinite(configuredHeight)||configuredHeight<=0||configuredHeight>50))throw new Error('dimension_text_height_mm 必须为 0–50 范围内的毫米字高');
 for(const page of objects.filter(object=>types.get(object.name)==='TechDraw::DrawPage')){
  const scale=positive(property(page,'Scale'));add('scale',page.name,'Scale',property(page,'Scale'),'',scale&&commonScales.some(value=>near(value,scale))?'ok':'manual',scale?'校核常用主比例；非常用比例保留原样，需工程确认，不自动重排':'主比例缺失或无效，需要原生/人工核对');
  const templateName=xmlAttribute(page.properties.get('Template')?.content.match(/<Link\b[^>]*>/)?.[0]||'','value'),template=byName.get(templateName);
  if(!template){add('scale',page.name,'PaperSize','','','manual','未能唯一解析本页图框；不猜图幅');continue;}
  const fields=editable(template),titleScaleKeys=['scale','FC-SC','Scale'];
  for(const key of titleScaleKeys){if(!fields.has(key))continue;const current=fields.get(key)!,ratio=parseDrawingRatio(current);add('scale',template.name,key,current,scale?drawingRatioText(scale):'',ratio!==undefined&&scale!==undefined?(near(ratio,scale)?'ok':'conflict'):'manual','比较图框显示比例与Page主比例；已有文字保留，不自动覆盖或改变布局');}
  const member=xmlAttribute(template.properties.get('PageResult')?.content.match(/<FileIncluded\b[^>]*>/)?.[0]||'','file');
  const bytes=files[member];let width:number|undefined,height:number|undefined;
  if(bytes&&bytes.byteLength<=8*1024*1024){const svg=new TextDecoder().decode(bytes);if(!/<!DOCTYPE|<!ENTITY/i.test(svg)){const tag=semantic(svg).match(/<(?:[A-Za-z_][\w.-]*:)?svg\b[^>]*>/)?.[0];if(tag){width=lengthMm(xmlAttribute(tag,'width'));height=lengthMm(xmlAttribute(tag,'height'));}}}
  const name=width&&height?paperName(width,height):'';
  add('scale',template.name,'PaperSize',width&&height?`${width} × ${height} mm`:'','',name?'ok':'manual',name?`内嵌SVG纸幅：${name}；纸面布局和原生Width/Height仍须重开核对`:'内嵌SVG纸幅缺失、单位不明确或不是常用ISO纸幅；保持原图框，需原生/人工确认');
  for(const [key,raw]of fields)if(['paper','paper_size','sheet_size','FC-FMT'].includes(key)){
   const label=raw.trim().toUpperCase();if(!/^A[0-4]$/.test(label))continue;add('scale',template.name,key,raw,name.split(' ')[0],name?(name.startsWith(label+' ')?'ok':'conflict'):'manual','比较图框纸幅文字与实际内嵌SVG，不自动替换已填写字段');
  }
  const nativeWidth=positive(property(template,'Width')),nativeHeight=positive(property(template,'Height'));
  if(nativeWidth&&nativeHeight&&width&&height)add('scale',template.name,'Width/Height',`${nativeWidth} × ${nativeHeight} mm`,`${width} × ${height} mm`,near(nativeWidth,width)&&near(nativeHeight,height)?'ok':'conflict','比较保存的原生图框尺寸与内嵌SVG纸幅；不自动缩放旧图');
  const views=page.properties.get('Views')?.content||'';
  const viewNames=[...views.matchAll(/<Link\b[^>]*>/g)].map(([tag])=>xmlAttribute(tag,'value'));
  for(const viewName of viewNames){const view=byName.get(viewName);if(!view||(types.get(view.name)||'').startsWith('TechDraw::DrawViewDimension')||!view.properties.has('Scale'))continue;
   const mode=property(view,'ScaleType'),own=positive(property(view,'Scale'));
   if(mode==='Page')add('scale',view.name,'ScaleType/Scale',`${mode}: ${property(view,'Scale')}`,scale?drawingRatioText(scale):'',scale!==undefined?'ok':'manual','视图使用Page主比例；不把旧保存Scale缓存当成自定义比例');
   else if(mode==='Custom')add('scale',view.name,'ScaleType/Scale',`${mode}: ${property(view,'Scale')}`,own?drawingRatioText(own):'',own&&commonScales.some(value=>near(value,own))?'ok':'manual','合法局部自定义比例保留；与主比例不同时，检查纸面是否明确标注该视图比例，不自动改回Page或重排');
   else add('scale',view.name,'ScaleType/Scale',`${mode||'unknown'}: ${property(view,'Scale')}`,'','manual','比例模式不能确证或为自动；需原生有效比例与布局核对，不猜枚举索引');
  }
 }
 for(const object of objects){if(types.get(object.name)!=='TechDraw::DrawViewDimension')continue;
  const gui=guiProperties(guiXml,object.name),present=['Fontsize','FontSize'].filter(key=>gui.has(key));
  const values=present.map(key=>positive(gui.get(key)!));const actual=values.length&&values.every(value=>value!==undefined)&&values.every(value=>near(value!,values[0]!))?values[0]:undefined;
  const field=present.length?present.map(key=>'ViewObject.'+key).join(' / '):'ViewObject.Fontsize';
  const conventional=actual!==undefined&&[2.5,3.5,5,7,10].some(height=>near(height,actual));
  const status=actual===undefined?'manual':configuredHeight!==undefined?!near(actual,configuredHeight)?'conflict':'ok':conventional?'ok':'manual';
  add('font',object.name,field,present.map(key=>`${key}=${gui.get(key)}`).join(', '),configuredHeight===undefined?'':String(configuredHeight),status,actual===undefined?'字高缺失、别名冲突或无效；需原生毫米值核对，不自动改字号':configuredHeight!==undefined?'比较工作空间明确毫米字高；不覆盖人工值。设置字体族不等于字号已通过':'记录常用毫米字高；同页排版、打印可读性仍需审查，不自动强制统一字高');
  if(property(object,'Type')==='Diameter'){
   const style=gui.get('StandardAndStyle')||'';
   add('dimension',object.name,'ViewObject.StandardAndStyle',style,'ISO Referencing',style==='ISO Referencing'?'ok':'manual','直径引线独立校核：目标ISO Referencing；保留原格式、公差与引用，仅换字体不能替代引线样式');
  }
 }
 return result;
}
