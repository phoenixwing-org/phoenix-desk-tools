import type {NativeDrawingInspection,NativeQuantityFact} from '../drawing-research/native-inspection.js';
import {drawingRatioText,parseDrawingRatio,type DrawingDiagnostic} from './paperTypography.js';

const near=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const mm=(q:NativeQuantityFact|null|undefined)=>q?.property_type==='App::PropertyLength'&&q.unit!==null&&/\bmm\b/.test(q.unit)&&/\[Length\]/.test(q.unit)&&positive(q.value)?q.value:undefined;
const common=(value:number)=>[10,5,2,1,.5,.2,.1,.05,.02,.01].some(v=>near(v,value));

/** Real native facts augment the static scan; all of these are diagnostics.
 * They do not authorize rewriting font height, scale, layout or leader style. */
export function nativePaperTypographyDiagnostics(report:NativeDrawingInspection,staticRows:DrawingDiagnostic[],config:Record<string,unknown>={}):DrawingDiagnostic[]{
 const rows:DrawingDiagnostic[]=[];
 const add=(kind:DrawingDiagnostic['kind'],location:string,field:string,current:string,proposed:string,status:DrawingDiagnostic['status'],message:string)=>rows.push({kind,location,field,current,proposed,status,message});
 const {facts}=report;
 for(const page of facts.pages){
  const scale=page.scale?.value;
  add('scale',page.name,'Native.PageScale',scale===undefined?'':String(scale),'',positive(scale)&&common(scale)?'ok':'manual','原生Page实际主比例；只校核，不改变旧图布局');
  const template=facts.templates.find(t=>t.name===page.template);
  if(!template)continue;
  const width=mm(template.width),height=mm(template.height);
  const saved=staticRows.find(r=>r.location===template.name&&r.field==='PaperSize');
  const size=saved?.current.match(/^(\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) mm$/);
  const known=width!==undefined&&height!==undefined&&size!==null&&size!==undefined;
  add('scale',template.name,'Native.Width/Height',width&&height?`${width} × ${height} mm`:'',saved?.current||'',known?(near(width!,Number(size![1]))&&near(height!,Number(size![2]))?'ok':'conflict'):'manual','原生毫米纸幅与内嵌SVG比较；缺失/单位未知保持人工核对');
  for(const key of ['scale','FC-SC','Scale']){
   if(!(key in template.editable_texts))continue;const raw=template.editable_texts[key],ratio=parseDrawingRatio(raw);
   add('scale',template.name,'Native.'+key,raw,positive(scale)?drawingRatioText(scale):'',ratio!==undefined&&positive(scale)?near(ratio,scale)?'ok':'conflict':'manual','原生图框文字与Page实际比例核对；已有文字不自动覆盖');
  }
 }
 const singlePageScale=facts.pages.length===1?facts.pages[0].scale?.value:undefined;
 for(const view of facts.views){
  const actual=view.effective_scale,own=view.scale?.value;
  let status:DrawingDiagnostic['status']='manual';
  if(positive(actual)&&view.effective_scale_method==='native getScale()'){
   if(view.scale_type==='Page'&&positive(singlePageScale))status=near(actual,singlePageScale)?'ok':'conflict';
   else if(view.scale_type==='Custom'&&positive(own))status=near(actual,own)?common(actual)?'ok':'manual':'conflict';
  }
  add('scale',view.name,'Native.EffectiveScale',`${view.scale_type||'unknown'}: ${actual===null?'unknown':actual}`,positive(actual)?drawingRatioText(actual):'',status,status==='ok'?'原生有效比例已核对；投影组子视图也逐个读取，合法局部比例保留，比例文字和布局仍需纸面审查':view.effective_scale_reason||'有效比例、所属页或模式不能确证/不一致；不从保存Scale缓存猜有效比例');
 }
 const requested=config.dimension_text_height_mm;
 if(requested!==undefined&&(!positive(requested)||requested>50))throw new Error('dimension_text_height_mm 必须为 0–50 范围内的毫米字高');
 const types=new Map(report.dimensions.map(d=>[d.dimension,d.type]));
 for(const dimension of facts.dimensions){
  const heights=Object.entries(dimension.font_heights),values=heights.map(([,q])=>mm(q));
  const actual=values.length&&values.every(v=>v!==undefined)&&values.every(v=>near(v!,values[0]!))?values[0]:undefined;
  const conventional=actual!==undefined&&[2.5,3.5,5,7,10].some(v=>near(v,actual));
  const status:DrawingDiagnostic['status']=actual===undefined?'manual':positive(requested)?near(actual,requested)?'ok':'conflict':conventional?'ok':'manual';
  add('font',dimension.name,'Native.FontHeight',heights.map(([key,q])=>`${key}=${q.value}${mm(q)===undefined?'（单位未确认）':' mm'}`).join(' / '),positive(requested)?String(requested)+' mm':'',status,'读取Fontsize/FontSize实际属性类型和毫米单位；未知或冲突不猜测。字体族修正保留字高；实际打印可读性仍需审查');
  if(types.get(dimension.name)==='Diameter')add('dimension',dimension.name,'Native.StandardAndStyle',dimension.standard_and_style||'','ISO Referencing',dimension.standard_and_style==='ISO Referencing'?'ok':'manual','原生直径引线样式单独校核；不自动覆盖人工格式、公差和位置');
 }
 return rows;
}
