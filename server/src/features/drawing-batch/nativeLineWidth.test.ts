import {expect,it} from 'vitest';
import type {NativeDrawingInspection,NativeQuantityFact} from '../drawing-research/native-inspection.js';
import {drawingLineWidthRole,drawingLineWidthSettings,nativeLineWidthDiagnostics} from './nativeLineWidth.js';

const length=(value:number):NativeQuantityFact=>({value,property_type:'App::PropertyLength',unit:'Unit: mm (1,0,0,0,0,0,0,0) [Length]'});
function fixture():NativeDrawingInspection {
 return {status:'completed',native_pid:1,source_fingerprints_unchanged:true,diagnostics:{folder:'independent-fixture',log:'independent-log'},dimensions:[],facts:{pages:[],templates:[],views:[{name:'Front',type:'TechDraw::DrawViewPart',scale:null,scale_type:null,effective_scale:null,effective_scale_method:null}],dimensions:[{name:'Dimension',font_heights:{},font:null,standard_and_style:null}]},source_safety:{status:'verified',preferences:{SolveOnRecompute:false,SolveInJointCreation:false},solver_observations:[],source_document_count:1,source_link_count:0,source_joint_count:0,source_poses_and_actual_frames_unchanged:true,existing_unresolved_joint_sides:0,observer_coverage:[]}};
}

it('defaults to the requested coarse/fine pair and accepts explicit positive millimetres',()=>{
 expect(drawingLineWidthSettings()).toEqual({contour:0.5,dimension:0.25});
 expect(drawingLineWidthSettings({contour_line_width_mm:0.7,dimension_line_width_mm:0.35})).toEqual({contour:0.7,dimension:0.35});
 expect(drawingLineWidthSettings({contour_line_width_mm:5,dimension_line_width_mm:2.5})).toEqual({contour:5,dimension:2.5});
});
it.each([0,-1,NaN,Infinity,-Infinity,null,'0.5',5.01])('rejects invalid configured line widths before diagnostics (%s)',value=>{
 for(const key of ['contour_line_width_mm','dimension_line_width_mm']){
  const config={[key]:value};expect(()=>drawingLineWidthSettings(config)).toThrow(/有限正数/);expect(()=>nativeLineWidthDiagnostics(fixture(),config)).toThrow(/有限正数/);
 }
});
it.each([[0.25,0.25],[0.2,0.3],[5,5]])('rejects a contour that is not wider than the dimension lines (%s / %s)',(contour,dimension)=>{
 expect(()=>drawingLineWidthSettings({contour_line_width_mm:contour,dimension_line_width_mm:dimension})).toThrow(/必须大于/);
});
it('classifies only explicitly supported drawable views and dimensions',()=>{
 for(const type of ['TechDraw::DrawViewPart','TechDraw::DrawViewSection','TechDraw::DrawViewDetail','TechDraw::DrawProjGroupItem'])expect(drawingLineWidthRole(type)).toBe('contour');
 expect(drawingLineWidthRole('TechDraw::DrawViewDimension')).toBe('dimension');
 for(const type of ['TechDraw::DrawPage','TechDraw::DrawSVGTemplate','TechDraw::DrawViewAnnotation','TechDraw::UnknownView','App::Link'])expect(drawingLineWidthRole(type)).toBeUndefined();
});
it('keeps absent/null line widths manual and does not change any report or unrelated configuration',()=>{
 const report=fixture();Object.assign(report.facts.dimensions[0],{line_width:null});const config={contour_line_width_mm:0.7,dimension_line_width_mm:0.35,dimension_text_height_mm:5};
 const before=structuredClone({report,config}),rows=nativeLineWidthDiagnostics(report,config);
 expect(rows.map(row=>row.diagnostic)).toEqual(expect.arrayContaining([expect.objectContaining({location:'Front',field:'ViewObject.LineWidth',status:'manual',proposed:'0.7 mm'}),expect.objectContaining({location:'Dimension',status:'manual',proposed:'0.35 mm'})]));
 expect(rows.every(row=>!row.patch)).toBe(true);expect({report,config}).toEqual(before);
});
it.each([{value:0.25,property_type:'Independent::Unknown',unit:'mm'},{value:0.25,property_type:'App::PropertyLength',unit:null},{value:0.25,property_type:'App::PropertyLength',unit:'px'},{...length(0.25),unit:'mm'},{...length(0.25),property_type:'App::PropertyFloatConstraint'},{...length(0.25),unit:'Unit: mm (0,0,0,0,0,0,0,0) [Length]'}] as NativeQuantityFact[])('never grants a patch from an unconfirmed type/unit pair (%j)',q=>{
 const report=fixture();Object.assign(report.facts.views[0],{line_width:q});Object.assign(report.facts.dimensions[0],{line_width:q});
 const rows=nativeLineWidthDiagnostics(report);expect(rows.every(row=>row.diagnostic.status==='manual'&&!row.patch)).toBe(true);
 expect(rows.every(row=>row.diagnostic.message.includes('property_type='+q.property_type)&&row.diagnostic.message.includes('unit='+(q.unit??'unknown')))).toBe(true);
});
it('keeps unknown native view types manual rather than treating every TechDraw object as a contour',()=>{
 const report=fixture();report.facts.views[0].type='TechDraw::UnknownView';Object.assign(report.facts.views[0],{line_width:length(0.25)});
 expect(nativeLineWidthDiagnostics(report)[0]).toMatchObject({diagnostic:{status:'manual',proposed:''}});expect(nativeLineWidthDiagnostics(report)[0].patch).toBeUndefined();
});
it.each(['views','dimensions','cross-role'])('keeps every duplicate native identity manual without a patch (%s)',mode=>{
 const report=fixture();
 if(mode==='views')report.facts.views.push({...report.facts.views[0]});
 else if(mode==='dimensions')report.facts.dimensions.push({...report.facts.dimensions[0]});
 else report.facts.dimensions[0].name=report.facts.views[0].name;
 const name=mode==='dimensions'?'Dimension':'Front';
 for(const object of [...report.facts.views,...report.facts.dimensions])Object.assign(object,{line_width:length(0.1)});
 const duplicates=nativeLineWidthDiagnostics(report).filter(row=>row.diagnostic.location===name);
 expect(duplicates).toHaveLength(2);expect(duplicates.every(row=>row.diagnostic.status==='manual'&&!row.patch&&row.diagnostic.message.includes('身份重复'))).toBe(true);
});
it('offers the default coarse/fine pair as numeric exact patches without changing the native report',()=>{
 const report=fixture();report.facts.views[0].line_width=length(0.7);report.facts.dimensions[0].line_width=length(0.35);
 Object.assign(report.facts.views[0],{HiddenWidth:length(0.2),IsoWidth:length(0.1),ExtraWidth:length(0.3)});
 const before=structuredClone(report),rows=nativeLineWidthDiagnostics(report);
 expect(rows.map(row=>row.patch)).toEqual([{kind:'view',object:'Front',field:'LineWidth',current:'0.7',proposed:'0.5'},{kind:'view',object:'Dimension',field:'LineWidth',current:'0.35',proposed:'0.25'}]);
 expect(rows.map(row=>row.diagnostic.current)).toEqual(['0.7 mm','0.35 mm']);
 expect(rows.every(row=>row.diagnostic.kind==='dimension'&&row.diagnostic.status==='ready'&&row.diagnostic.field==='ViewObject.LineWidth'&&row.diagnostic.message.includes('仅勾选'))).toBe(true);
 expect(rows.every(row=>row.diagnostic.message.includes('property_type=App::PropertyLength')&&row.diagnostic.message.includes('unit=Unit: mm'))).toBe(true);
 expect(report).toEqual(before);
});
it('marks equal proven widths ok with no patch',()=>{
 const report=fixture();report.facts.views[0].line_width=length(0.5);report.facts.dimensions[0].line_width=length(0.25);
 const rows=nativeLineWidthDiagnostics(report);expect(rows.every(row=>row.diagnostic.status==='ok'&&!row.patch)).toBe(true);
});
it('uses explicit configured widths and leaves an already matching role unpatched',()=>{
 const report=fixture();report.facts.views[0].line_width=length(0.7);report.facts.dimensions[0].line_width=length(0.25);
 const rows=nativeLineWidthDiagnostics(report,{contour_line_width_mm:0.7,dimension_line_width_mm:0.35});
 expect(rows[0]).toMatchObject({diagnostic:{status:'ok',proposed:'0.7 mm'}});expect(rows[0].patch).toBeUndefined();
 expect(rows[1]).toMatchObject({diagnostic:{status:'ready',proposed:'0.35 mm'},patch:{kind:'view',object:'Dimension',field:'LineWidth',current:'0.25',proposed:'0.35'}});
});
it.each(['TechDraw::DrawViewPart','TechDraw::DrawViewSection','TechDraw::DrawViewDetail','TechDraw::DrawProjGroupItem'])('only offers the LineWidth field of an explicitly supported %s',type=>{
 const report=fixture();report.facts.views[0].type=type;report.facts.views[0].line_width=length(0.35);
 expect(nativeLineWidthDiagnostics(report)[0]).toMatchObject({diagnostic:{status:'ready'},patch:{kind:'view',object:'Front',field:'LineWidth',current:'0.35',proposed:'0.5'}});
});
it.each([0,-0.1,NaN,Infinity,5.01])('keeps an invalid native width manual even with the proven type/unit (%s)',value=>{
 const report=fixture();report.facts.views[0].line_width=length(value);report.facts.dimensions[0].line_width=length(value);
 expect(nativeLineWidthDiagnostics(report).every(row=>row.diagnostic.status==='manual'&&!row.patch)).toBe(true);
});
