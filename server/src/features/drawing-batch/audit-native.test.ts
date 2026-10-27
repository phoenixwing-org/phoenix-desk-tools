import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';import {afterEach,expect,it,vi} from 'vitest';
import type {NativeDrawingInspection} from '../drawing-research/native-inspection.js';
const ports=vi.hoisted(()=>({inspect:vi.fn()}));
vi.mock('../drawing-research/native-inspection.js',()=>({inspectDrawingNative:ports.inspect}));
import {previewDrawingAudit,consumeDrawingAudit} from './audit.js';
import {verifyMaintenancePlan} from '../drawing-research/maintenance.js';
const roots:string[]=[];afterEach(()=>{roots.splice(0).forEach(r=>fs.rmSync(r,{recursive:true,force:true}));ports.inspect.mockReset();});
const prop=(key:string,value:string)=>`<Property name="${key}" type="App::PropertyString"><String value="${value}"/></Property>`;
function save(root:string,rel:string,xml:string,extra:Record<string,Uint8Array>={}){fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),zipSync({'Document.xml':strToU8(xml),...extra}));}
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'independent-native-audit-'));roots.push(root);
 save(root,'Model.FCStd',`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties>${prop('Label','Independent plate')}${prop('PartName','Independent plate')}${prop('PartNumber','DEMO-001')}${prop('PartVersion','A')}${prop('PartMaterial','STEEL-A')}</Properties></Object></ObjectData></Document>`);
 save(root,'drawings/Example.Drawing.FCStd',`<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/><Object name="Template" type="TechDraw::DrawSVGTemplate"/><Object name="Link" type="App::Link"/><Object name="Dimension" type="TechDraw::DrawViewDimension"/></Objects><ObjectData><Object name="Page"><Properties>${prop('Label','Page')}<Property name="Template"><Link value="Template"/></Property><Property name="Scale"><Float value="1"/></Property></Properties></Object><Object name="Template"><Properties><Property name="EditableTexts"><Map><Item key="drawing_number" value=""/><Item key="scale" value="1:1"/></Map></Property><Property name="PageResult"><FileIncluded file="frame.svg"/></Property></Properties></Object><Object name="Link"><Properties>${prop('Label','Link')}<Property name="LinkedObject"><XLink file="../Model.FCStd" name="Body"/></Property></Properties></Object><Object name="Dimension"><Properties>${prop('Type','DistanceX')}<Property name="References2D"><LinkSubList><LinkSub value="Front"><SubElement value="Vertex0"/><SubElement value="Vertex2"/></LinkSub></LinkSubList></Property></Properties></Object></ObjectData></Document>`,{'frame.svg':strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm"/>'),'GuiDocument.xml':strToU8('<Document><ViewProvider name="Dimension"><Properties><Property name="Font"><Font value="Old Font"/></Property><Property name="Fontsize"><Float value="5"/></Property></Properties></ViewProvider></Document>')});
 return root;
}
function report():NativeDrawingInspection{return {status:'completed',native_pid:1,source_fingerprints_unchanged:true,diagnostics:{folder:'independent-fixture',log:'independent-log'},dimensions:[{dimension:'Dimension',type:'DistanceX',status:'valid',actual_value:40,references:[{view:'Front',sub:'Vertex0',status:'valid',geometry:{kind:'Vertex',coordinate_space:'view_projection',point:[-20,-15,0]}},{view:'Front',sub:'Vertex2',status:'valid',geometry:{kind:'Vertex',coordinate_space:'view_projection',point:[20,-15,0]}}]}],facts:{pages:[],templates:[],views:[],dimensions:[]},source_safety:{status:'verified',preferences:{SolveOnRecompute:false,SolveInJointCreation:false},solver_observations:[],source_document_count:1,source_link_count:0,source_joint_count:0,source_poses_and_actual_frames_unchanged:true,existing_unresolved_joint_sides:0,observer_coverage:[]}};}
it('uses actual projected references and values for an explicitly requested native preview, retaining a read-only source',async()=>{
 const root=fixture(),source=fs.readFileSync(path.join(root,'Model.FCStd')),drawing=fs.readFileSync(path.join(root,'drawings/Example.Drawing.FCStd'));ports.inspect.mockResolvedValue(report());
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0];
 expect(ports.inspect).toHaveBeenCalledOnce();expect(row.issues.find(i=>i.field==='References2D')).toMatchObject({status:'ok',current:expect.stringContaining('实际值 40')});expect(row.issues.find(i=>i.field==='NativeSourceSafety')).toMatchObject({status:'ok'});expect(row.issues.find(i=>i.field==='drawing_number')).toMatchObject({status:'ready'});
 const plan=consumeDrawingAudit(root,result.plan_id);expect(plan.entries.get(row.id)?.patches.size).toBeGreaterThan(0);expect(fs.readFileSync(path.join(root,'Model.FCStd'))).toEqual(source);expect(fs.readFileSync(path.join(root,'drawings/Example.Drawing.FCStd'))).toEqual(drawing);
});
it('shows an actually invalid reference as manual, without manufacturing an Edge/Vertex replacement patch',async()=>{
 const root=fixture(),r=report();r.dimensions[0].status='invalid';r.dimensions[0].actual_value=null;r.dimensions[0].references[1]={view:'Front',sub:'Vertex999999',status:'invalid',reason:'No actual projected vertex'};ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0],issue=row.issues.find(i=>i.field==='References2D')!;expect(issue).toMatchObject({status:'manual',current:expect.stringContaining('Vertex999999 (invalid)')});expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.has(issue.id)).toBe(false);
});
it.each(['assembly-safety','native-error','incomplete-coverage','unavailable'])('does not offer automatic writes when native preflight is %s',async(mode)=>{
 const root=fixture(),r=report();if(mode==='assembly-safety')r.source_safety.status='manual';if(mode==='native-error')r.inspection_error='Native inspection incomplete';if(mode==='incomplete-coverage')r.dimensions=[];
 if(mode==='unavailable')ports.inspect.mockRejectedValue(new Error('Owned native startup unavailable'));else ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0];expect(row.issues.filter(i=>i.status==='ready')).toHaveLength(0);expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.size).toBe(0);
});
it('static inspection never silently starts a native process',async()=>{const root=fixture();await previewDrawingAudit(root,{directory:'drawings'});expect(ports.inspect).not.toHaveBeenCalled();});
it('forwards the same internal request signal to native inspection',async()=>{
 const root=fixture(),control=new AbortController();ports.inspect.mockResolvedValue(report());
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true,signal:control.signal});
 expect(ports.inspect.mock.calls[0][1].signal).toBe(control.signal);consumeDrawingAudit(root,result.plan_id);
});
it('starts no native work and returns no preview plan when already aborted',async()=>{
 const root=fixture(),control=new AbortController();control.abort();
 await expect(previewDrawingAudit(root,{directory:'drawings',native_inspection:true,signal:control.signal})).rejects.toThrow('取消');expect(ports.inspect).not.toHaveBeenCalled();
});
it('waits for owned native closure, then rejects cancellation without starting a second file or returning a plan',async()=>{
 const root=fixture(),control=new AbortController();fs.copyFileSync(path.join(root,'drawings/Example.Drawing.FCStd'),path.join(root,'drawings/Second.Drawing.FCStd'));
 let begin!:()=>void,closed!:()=>void;const started=new Promise<void>(resolve=>begin=resolve),exit=new Promise<void>(resolve=>closed=resolve);
 ports.inspect.mockImplementation(async(_plan,options)=>{expect(options.signal).toBe(control.signal);begin();await exit;throw new Error('取消；原生自有进程已退出');});
 let settled=false;const running=previewDrawingAudit(root,{directory:'drawings',native_inspection:true,signal:control.signal});const outcome=running.catch(error=>error).then(result=>{settled=true;return result;});
 await started;control.abort();await Promise.resolve();expect(settled).toBe(false);expect(ports.inspect).toHaveBeenCalledOnce();closed();
 const error=await outcome;expect(error).toBeInstanceOf(Error);expect(error.message).toContain('取消');expect(error).not.toHaveProperty('plan_id');expect(ports.inspect).toHaveBeenCalledOnce();
});
it('does not turn a native AbortError into manual rows and continue to another file',async()=>{
 const root=fixture();fs.copyFileSync(path.join(root,'drawings/Example.Drawing.FCStd'),path.join(root,'drawings/Second.Drawing.FCStd'));const aborted=new DOMException('Owned child closed','AbortError');ports.inspect.mockRejectedValue(aborted);
 await expect(previewDrawingAudit(root,{directory:'drawings',native_inspection:true})).rejects.toBe(aborted);expect(ports.inspect).toHaveBeenCalledOnce();
});
it('rejects a late abort even when native inspection resolves normally after closure',async()=>{
 const root=fixture(),control=new AbortController();ports.inspect.mockImplementation(async()=>{control.abort();return report();});
 await expect(previewDrawingAudit(root,{directory:'drawings',native_inspection:true,signal:control.signal})).rejects.toThrow('取消');expect(ports.inspect).toHaveBeenCalledOnce();
});

function numericDiameterFixture(){
 const root=fixture(),file=path.join(root,'drawings/Example.Drawing.FCStd'),archive=unzipSync(fs.readFileSync(file));
 const xml=strFromU8(archive['Document.xml']).replace(prop('Type','DistanceX'),'<Property name="Type" type="App::PropertyEnumeration"><Integer value="5"/></Property>'+prop('FormatSpec','3x Ø%.3w'));
 archive['Document.xml']=strToU8(xml);fs.writeFileSync(file,zipSync(archive));return root;
}
it('promotes a saved numeric enum only with actual native Diameter and valid references, preserving the format around the symbol',async()=>{
 const root=numericDiameterFixture(),r=report();r.dimensions[0].type='Diameter';ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0],format=row.issues.find(i=>i.field==='FormatSpec')!;
 expect(format).toMatchObject({status:'ready',current:'3x Ø%.3w',proposed:'3x ⌀%.3w'});
 expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.get(format.id)).toEqual({kind:'property',object:'Dimension',field:'FormatSpec',current:'3x Ø%.3w',proposed:'3x ⌀%.3w'});
});
it.each(['DistanceX','Radius',''])('does not infer Diameter from saved Integer 5 when native Type is %s',async(type)=>{
 const root=numericDiameterFixture(),r=report();r.dimensions[0].type=type;ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0],format=row.issues.find(i=>i.field==='FormatSpec')!;
 expect(format.status).toBe('manual');expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.has(format.id)).toBe(false);
});
it('keeps a numeric enum manual in static-only inspection',async()=>{
 const root=numericDiameterFixture(),result=await previewDrawingAudit(root,{directory:'drawings'}),row=result.rows[0],format=row.issues.find(i=>i.field==='FormatSpec')!;
 expect(format.status).toBe('manual');expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.has(format.id)).toBe(false);expect(ports.inspect).not.toHaveBeenCalled();
});
it.each(['invalid-reference','unresolved-frames'])('offers no selected writes after native Diameter proof if %s',async(mode)=>{
 const root=numericDiameterFixture(),r=report();r.dimensions[0].type='Diameter';
 if(mode==='invalid-reference')r.dimensions[0].status='invalid';else r.source_safety.status='manual';ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0];
 expect(row.issues.filter(i=>i.status==='ready')).toHaveLength(0);expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.size).toBe(0);
});
it('withdraws unrelated font and title-block writes when a projected reference is invalid',async()=>{
 const root=fixture(),r=report();r.dimensions[0].status='invalid';ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0];
 expect(row.issues.find(i=>i.field==='ViewObject.Font')?.status).toBe('manual');expect(row.issues.find(i=>i.field==='drawing_number')?.status).toBe('manual');expect(row.issues.find(i=>i.field==='NativeDimensionSafety')?.status).toBe('manual');expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.size).toBe(0);
});
it('exposes preserved existing source errors without claiming to repair them or blocking verified unrelated Drawing fields',async()=>{
 const root=fixture(),r=report();r.source_safety.source_object_errors=[{file:'Model.FCStd',object:'ExistingLink',kind:'link',states:['Invalid'],status:'independent existing expression error'}];r.source_safety.reason='已有源故障保留、未修复';ports.inspect.mockResolvedValue(r);
 const result=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=result.rows[0];
 expect(row.issues.find(i=>i.field==='NativeSourceObjectState')).toMatchObject({location:'Model.FCStd:ExistingLink',status:'manual',current:expect.stringContaining('Invalid'),message:expect.stringContaining('未修复')});
 expect(row.issues.find(i=>i.field==='ViewObject.Font')?.status).toBe('ready');expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.size).toBeGreaterThan(0);
});

function lineWidthFixture(){
 const root=fixture(),file=path.join(root,'drawings/Example.Drawing.FCStd'),archive=unzipSync(fs.readFileSync(file));
 archive['Document.xml']=strToU8(strFromU8(archive['Document.xml']).replace('</Objects>','<Object name="Front" type="TechDraw::DrawViewPart"/></Objects>').replace('</ObjectData>','<Object name="Front"><Properties><Property name="Scale"><Float value="1"/></Property></Properties></Object></ObjectData>'));
 fs.writeFileSync(file,zipSync(archive));return root;
}
it('offers line widths only as manual suggestions in static inspection and leaves all source bytes unchanged',async()=>{
 const root=lineWidthFixture(),file=path.join(root,'drawings/Example.Drawing.FCStd'),before=fs.readFileSync(file);
 const preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],widths=row.issues.filter(issue=>issue.field==='ViewObject.LineWidth');
 expect(widths).toHaveLength(2);expect(widths.map(issue=>[issue.location,issue.status,issue.proposed])).toEqual([['Dimension','manual','0.25 mm'],['Front','manual','0.5 mm']]);
 const plan=consumeDrawingAudit(root,preview.plan_id);expect([...plan.entries.get(row.id)!.patches.values()].filter(patch=>'field'in patch&&patch.field==='LineWidth')).toHaveLength(0);
 expect(ports.inspect).not.toHaveBeenCalled();expect(fs.readFileSync(file)).toEqual(before);
});
it.each(['missing','unknown-type','unknown-unit'] as const)('keeps native %s line-width evidence manual without creating a patch',async mode=>{
 const root=lineWidthFixture(),r=report();
 const evidence=mode==='missing'?{}:{line_width:{value:.35,property_type:mode==='unknown-type'?'Independent::UnknownWidth':'App::PropertyLength',unit:mode==='unknown-unit'?'independent-unit':null}};
 r.facts.views=[{name:'Front',type:'TechDraw::DrawViewPart',scale:null,scale_type:null,effective_scale:null,effective_scale_method:null,...evidence}];
 r.facts.dimensions=[{name:'Dimension',font_heights:{},font:null,standard_and_style:null,...evidence}];ports.inspect.mockResolvedValue(r);
 const preview=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=preview.rows[0];
 expect(row.issues.filter(issue=>issue.field==='ViewObject.LineWidth').map(issue=>issue.status)).toEqual(['manual','manual']);
 const plan=consumeDrawingAudit(root,preview.plan_id);expect([...plan.entries.get(row.id)!.patches.values()].filter(patch=>'field'in patch&&patch.field==='LineWidth')).toHaveLength(0);
});
it.each([0,-1,5.01,'0.5',null])('refuses an invalid contour width configuration before native inspection (%s)',async contour=>{
 const root=lineWidthFixture();fs.mkdirSync(path.join(root,'.phoenix'));fs.writeFileSync(path.join(root,'.phoenix/drawing-defaults.json'),JSON.stringify({contour_line_width_mm:contour,dimension_line_width_mm:.25}));
 await expect(previewDrawingAudit(root,{directory:'drawings',native_inspection:true})).rejects.toThrow(/contour_line_width_mm/);expect(ports.inspect).not.toHaveBeenCalled();
});
const nativeWidth=(value:number)=>({value,property_type:'App::PropertyLength',unit:'Unit: mm (1,0,0,0,0,0,0,0) [Length]'});
function lineWidthReport(){
 const r=report();
 r.facts.views=[{name:'Front',type:'TechDraw::DrawViewPart',scale:null,scale_type:null,effective_scale:null,effective_scale_method:null,line_width:nativeWidth(.7)}];
 r.facts.dimensions=[{name:'Dimension',font_heights:{},font:null,standard_and_style:null,line_width:nativeWidth(.35)}];return r;
}
it('registers separate native millimetre exact patches only for existing drawable objects, never writing during preview',async()=>{
 const root=lineWidthFixture(),file=path.join(root,'drawings/Example.Drawing.FCStd'),before=fs.readFileSync(file),native=lineWidthReport(),nativeBefore=structuredClone(native);ports.inspect.mockResolvedValue(native);
 const preview=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=preview.rows[0],widths=row.issues.filter(issue=>issue.field==='ViewObject.LineWidth');
 expect(widths).toEqual(expect.arrayContaining([expect.objectContaining({location:'Front',current:'0.7 mm',proposed:'0.5 mm',status:'ready'}),expect.objectContaining({location:'Dimension',current:'0.35 mm',proposed:'0.25 mm',status:'ready'})]));
 const entry=consumeDrawingAudit(root,preview.plan_id).entries.get(row.id)!;
 expect(widths.map(issue=>entry.patches.get(issue.id))).toEqual([{kind:'view',object:'Dimension',field:'LineWidth',current:'0.35',proposed:'0.25'},{kind:'view',object:'Front',field:'LineWidth',current:'0.7',proposed:'0.5'}]);
 const selected=[widths.find(issue=>issue.location==='Front')!.id];expect(selected.map(id=>entry.patches.get(id))).toEqual([{kind:'view',object:'Front',field:'LineWidth',current:'0.7',proposed:'0.5'}]);
 expect(fs.readFileSync(file)).toEqual(before);expect(native).toEqual(nativeBefore);
});
it('uses explicit coarse/fine configuration and retains its fingerprint in the selected repair plan',async()=>{
 const root=lineWidthFixture(),config=path.join(root,'.phoenix/drawing-defaults.json');fs.mkdirSync(path.dirname(config));fs.writeFileSync(config,JSON.stringify({contour_line_width_mm:.6,dimension_line_width_mm:.2}));ports.inspect.mockResolvedValue(lineWidthReport());
 const preview=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=preview.rows[0],widths=row.issues.filter(issue=>issue.field==='ViewObject.LineWidth');
 expect(widths.map(issue=>issue.proposed)).toEqual(['0.2 mm','0.6 mm']);
 const native=consumeDrawingAudit(root,preview.plan_id).entries.get(row.id)!.native!;verifyMaintenancePlan(native);
 fs.writeFileSync(config,JSON.stringify({contour_line_width_mm:.8,dimension_line_width_mm:.4}));expect(()=>verifyMaintenancePlan(native)).toThrow(/配置已变化/);
});
it.each(['invalid-reference','unresolved-source'] as const)('withdraws line-width patches with all other writes after %s evidence',async mode=>{
 const root=lineWidthFixture(),r=lineWidthReport();if(mode==='invalid-reference')r.dimensions[0].status='invalid';else r.source_safety.status='manual';ports.inspect.mockResolvedValue(r);
 const preview=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=preview.rows[0];
 expect(row.issues.filter(issue=>issue.field==='ViewObject.LineWidth').every(issue=>issue.status==='manual')).toBe(true);expect(consumeDrawingAudit(root,preview.plan_id).entries.get(row.id)!.patches.size).toBe(0);
});
it('never authorizes a line-width object supplied only by a native receipt rather than the guarded drawing',async()=>{
 const root=lineWidthFixture(),r=lineWidthReport();r.facts.views[0].name='ReceiptOnly';ports.inspect.mockResolvedValue(r);
 const preview=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=preview.rows[0];
 expect(row.issues.some(issue=>issue.location==='ReceiptOnly'&&issue.field==='ViewObject.LineWidth')).toBe(false);expect(row.issues.find(issue=>issue.location==='Front'&&issue.field==='ViewObject.LineWidth')?.status).toBe('manual');
 expect([...consumeDrawingAudit(root,preview.plan_id).entries.get(row.id)!.patches.values()].some(patch=>'object'in patch&&patch.object==='ReceiptOnly')).toBe(false);
});
it('keeps a native line-width role inconsistent with the guarded drawing manual',async()=>{
 const root=lineWidthFixture(),r=lineWidthReport();r.facts.views[0].type='TechDraw::DrawViewDimension';ports.inspect.mockResolvedValue(r);
 const preview=await previewDrawingAudit(root,{directory:'drawings',native_inspection:true}),row=preview.rows[0],front=row.issues.find(issue=>issue.location==='Front'&&issue.field==='ViewObject.LineWidth')!;
 expect(front).toMatchObject({status:'manual',proposed:'0.5 mm',message:expect.stringContaining('类别不一致')});expect(consumeDrawingAudit(root,preview.plan_id).entries.get(row.id)!.patches.has(front.id)).toBe(false);
});
