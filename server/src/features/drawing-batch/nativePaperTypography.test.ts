import {expect,it} from 'vitest';
import type {NativeDrawingInspection,NativeQuantityFact} from '../drawing-research/native-inspection.js';
import {nativePaperTypographyDiagnostics} from './nativePaperTypography.js';
const scalar=(value:number):NativeQuantityFact=>({value,property_type:'App::PropertyFloatConstraint',unit:null});
const length=(value:number):NativeQuantityFact=>({value,property_type:'App::PropertyLength',unit:'Unit: mm (1,0,0,0,0,0,0,0) [Length]'});
function fixture():NativeDrawingInspection{return {status:'completed',native_pid:1,source_fingerprints_unchanged:true,diagnostics:{folder:'independent-fixture',log:'independent-log'},dimensions:[{dimension:'Diameter',type:'Diameter',status:'valid',actual_value:10,references:[{view:'Front',sub:'Edge4',status:'valid',geometry:{kind:'Edge',coordinate_space:'view_projection'}}]}],facts:{pages:[{name:'Page',scale:scalar(1),template:'Template'}],templates:[{name:'Template',width:length(420),height:length(297),editable_texts:{scale:'1:1'}}],views:[{name:'Front',type:'TechDraw::DrawViewPart',scale:scalar(99),scale_type:'Page',effective_scale:1,effective_scale_method:'native getScale()'},{name:'Iso',type:'TechDraw::DrawViewPart',scale:scalar(.5),scale_type:'Custom',effective_scale:.5,effective_scale_method:'native getScale()'}],dimensions:[{name:'Diameter',font_heights:{Fontsize:length(5)},font:'osifont',standard_and_style:'ISO Referencing'}]},source_safety:{status:'verified',preferences:{SolveOnRecompute:false,SolveInJointCreation:false},solver_observations:[],source_document_count:1,source_link_count:0,source_joint_count:0,source_poses_and_actual_frames_unchanged:true,existing_unresolved_joint_sides:0,observer_coverage:[]}};}
const paper={kind:'scale' as const,location:'Template',field:'PaperSize',current:'420 × 297 mm',proposed:'',status:'ok' as const,message:'independent embedded SVG'};
it('checks actual native millimetre dimensions, aliases, title ratio and effective scales without creating patches',()=>{
 const report=fixture(),before=structuredClone(report),rows=nativePaperTypographyDiagnostics(report,[paper],{dimension_text_height_mm:5});
 expect(rows.find(r=>r.field==='Native.Width/Height')).toMatchObject({status:'ok'});
 expect(rows.find(r=>r.location==='Front'&&r.field==='Native.EffectiveScale')).toMatchObject({status:'ok',proposed:'1:1'});
 expect(rows.find(r=>r.location==='Iso'&&r.field==='Native.EffectiveScale')).toMatchObject({status:'ok',proposed:'1:2'});
 expect(rows.find(r=>r.field==='Native.FontHeight')).toMatchObject({status:'ok'});
 expect(rows.find(r=>r.field==='Native.StandardAndStyle')).toMatchObject({status:'ok'});
 expect(rows.every(r=>r.status!=='ready')).toBe(true);expect(report).toEqual(before);
});
it('keeps unknown units, conflicting aliases and unavailable native getScale manual instead of guessing',()=>{
 const report=fixture();report.facts.templates[0].width=scalar(420);report.facts.dimensions[0].font_heights.FontSize=length(3.5);report.facts.views[0].effective_scale=null;report.facts.views[0].effective_scale_method=null;
 const rows=nativePaperTypographyDiagnostics(report,[paper]);
 for(const field of ['Native.Width/Height','Native.FontHeight','Native.EffectiveScale'])expect(rows.find(r=>r.field===field)).toMatchObject({status:'manual'});
});
it('reports wrong paper, title ratio, actual scale and requested font height as conflicts, leaving leader style manual',()=>{
 const report=fixture();report.facts.templates[0].width=length(297);report.facts.templates[0].editable_texts.scale='1:2';report.facts.views[0].effective_scale=.5;report.facts.dimensions[0].standard_and_style='ISO Oriented';
 const rows=nativePaperTypographyDiagnostics(report,[paper],{dimension_text_height_mm:3.5});
 for(const field of ['Native.Width/Height','Native.scale','Native.EffectiveScale','Native.FontHeight'])expect(rows.find(r=>r.field===field)).toMatchObject({status:'conflict'});
 expect(rows.find(r=>r.field==='Native.StandardAndStyle')).toMatchObject({status:'manual',proposed:'ISO Referencing'});
});
it('includes each native projection-group item and never assumes automatic mode uses Page scale',()=>{
 const report=fixture();report.facts.views.push({name:'Left',type:'TechDraw::DrawProjGroupItem',scale:scalar(1),scale_type:'Page',effective_scale:1,effective_scale_method:'native getScale()'});report.facts.views[0].scale_type='Automatic';
 const rows=nativePaperTypographyDiagnostics(report,[paper]);expect(rows.find(r=>r.location==='Left')).toMatchObject({status:'ok'});expect(rows.find(r=>r.location==='Front')).toMatchObject({status:'manual'});
});
