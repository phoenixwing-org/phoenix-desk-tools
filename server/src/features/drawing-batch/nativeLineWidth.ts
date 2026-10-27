import type {NativeDrawingInspection,NativeQuantityFact} from '../drawing-research/native-inspection.js';
import type {DrawingDiagnostic} from './paperTypography.js';

type LineWidthRole='contour'|'dimension';
type LineWidthPatch={kind:'view';object:string;field:'LineWidth';current:string;proposed:string};
type LineWidthDiagnostic={diagnostic:DrawingDiagnostic;patch?:LineWidthPatch};
const contourTypes=new Set(['TechDraw::DrawViewPart','TechDraw::DrawViewSection','TechDraw::DrawViewDetail','TechDraw::DrawProjGroupItem']);
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));

export function drawingLineWidthRole(type:string):LineWidthRole|undefined {
 return type==='TechDraw::DrawViewDimension'?'dimension':contourTypes.has(type)?'contour':undefined;
}

export function drawingLineWidthSettings(config:Record<string,unknown>={}):{contour:number;dimension:number} {
 const contour=config.contour_line_width_mm===undefined?0.5:config.contour_line_width_mm;
 const dimension=config.dimension_line_width_mm===undefined?0.25:config.dimension_line_width_mm;
 if(!positive(contour)||!positive(dimension)||contour>5||dimension>5)throw new Error('contour_line_width_mm / dimension_line_width_mm 必须为不超过 5 mm 的有限正数毫米线宽');
 if(contour<=dimension)throw new Error('轮廓线宽必须大于尺寸/尺寸界线线宽');
 return {contour,dimension};
}

// FreeCAD 1.1's independently probed LineWidth is PropertyLength in this exact
// canonical mm/Length unit. Do not guess Float or an unproven unit spelling.
const millimetreLengthUnit='Unit: mm (1,0,0,0,0,0,0,0) [Length]';
function confirmedMillimetres(q:NativeQuantityFact|null|undefined):number|undefined {
 return q?.property_type==='App::PropertyLength'&&q.unit===millimetreLengthUnit&&positive(q.value)&&q.value<=5?q.value:undefined;
}

/** Recommendations only: the host registers exact patches and users select them.
 * No scale, hidden/centre/section line, dimension reference or other style changes. */
export function nativeLineWidthDiagnostics(report:NativeDrawingInspection,config:Record<string,unknown>={}):LineWidthDiagnostic[] {
 const settings=drawingLineWidthSettings(config),rows:LineWidthDiagnostic[]=[];
 const identities=new Map<string,number>();
 for(const object of [...report.facts.views,...report.facts.dimensions])identities.set(object.name,(identities.get(object.name)||0)+1);
 const add=(name:string,type:string,q:NativeQuantityFact|null|undefined)=>{
  const role=drawingLineWidthRole(type),target=role?settings[role]:undefined,actual=confirmedMillimetres(q);
  const evidence=`property_type=${q?.property_type||'unknown'}；unit=${q?.unit??'unknown'}`;
  const diagnostic:DrawingDiagnostic={kind:'dimension',location:name,field:'ViewObject.LineWidth',current:q?String(q.value):'unknown',proposed:target===undefined?'':String(target)+' mm',status:'manual',message:`${evidence}；原生字段类型/毫米语义/合法范围或对象类别未确证，保留原线宽，不猜测写入`};
  if(identities.get(name)!==1){
   diagnostic.message=`${evidence}；原生对象身份重复或跨视图/尺寸冲突，保留原线宽，不生成可覆盖的修正项`;rows.push({diagnostic});
  }else if(role&&actual!==undefined&&target!==undefined){
   diagnostic.current=String(actual)+' mm';
   diagnostic.status=near(actual,target)?'ok':'ready';
   diagnostic.message=`${evidence}；${role==='contour'?'轮廓':'尺寸/尺寸界线'}线宽 ${target} mm；仅勾选该对象字段后写入，其它角色及未勾选人工样式保留`;
   rows.push({diagnostic,...(diagnostic.status==='ready'?{patch:{kind:'view' as const,object:name,field:'LineWidth' as const,current:String(actual),proposed:String(target)}}:{})});
  }else rows.push({diagnostic});
 };
 for(const view of report.facts.views)add(view.name,view.type,view.line_width);
 for(const dimension of report.facts.dimensions)add(dimension.name,'TechDraw::DrawViewDimension',dimension.line_width);
 return rows;
}
