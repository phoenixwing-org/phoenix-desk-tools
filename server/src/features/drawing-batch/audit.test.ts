import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';import {afterEach,expect,it,vi} from 'vitest';
import {previewDrawingAudit,consumeDrawingAudit} from './audit.js';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
const prop=(key:string,value:string)=>`<Property name="${key}" type="App::PropertyString"><String value="${value}"/></Property>`;
function save(root:string,rel:string,xml:string,extra:Record<string,Uint8Array>={}){fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),zipSync({'Document.xml':strToU8(xml),...extra}));}
function edit(root:string,rel:string,change:(files:Record<string,Uint8Array>)=>void){const filename=path.join(root,rel),files=unzipSync(fs.readFileSync(filename));change(files);fs.writeFileSync(filename,zipSync(files));}
const hidden='<Property name="Visibility" type="App::PropertyBool"><Bool value="false"/></Property>';
function fixture(material='STEEL-A',templateMaterial='',formatType='Diameter'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drawing-audit-independent-'));roots.push(root);
 save(root,'Model.FCStd',`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties>${prop('Label','Independent model')}${prop('PartName','Independent plate')}${prop('PartNumber','DEMO-001')}${prop('PartVersion','A')}${prop('PartMaterial',material)}</Properties></Object></ObjectData></Document>`);
 const fields={drawing_number:'',revision_index:'',title:'',part_material:templateMaterial,document_type:'零件图'};
 const xml=`<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/><Object name="Template" type="TechDraw::DrawSVGTemplate"/><Object name="Link" type="App::Link"/><Object name="Dim" type="TechDraw::DrawViewDimension"/><Object name="Note" type="TechDraw::DrawViewAnnotation"/></Objects><ObjectData><Object name="Page"><Properties>${prop('Label','Page')}<Property name="Template" type="App::PropertyLink"><Link value="Template"/></Property><Property name="Scale" type="App::PropertyFloat"><Float value="1"/></Property></Properties></Object><Object name="Template"><Properties><Property name="EditableTexts" type="App::PropertyMap"><Map>${Object.entries(fields).map(([key,value])=>`<Item key="${key}" value="${value}"/>`).join('')}</Map></Property><Property name="PageResult" type="App::PropertyFileIncluded"><FileIncluded file="frame.svg"/></Property></Properties></Object><Object name="Link"><Properties>${prop('Label','Link')}<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="../Model.FCStd" name="Body"/></Property></Properties></Object><Object name="Dim"><Properties>${prop('Type',formatType)}${prop('FormatSpec','Ø%.2f ±0.02')}<Property name="References2D" type="App::PropertyLinkSubList"><LinkSubList><LinkSub value="View"><SubElement value="Edge1"/></LinkSub></LinkSubList></Property></Properties></Object><Object name="Note"><Properties>${prop('Font','Old Font')}<Property name="Text" type="App::PropertyStringList"><String value="Independent note"/></Property></Properties></Object></ObjectData></Document>`;
 save(root,'drawings/Example.Drawing.FCStd',xml,{'frame.svg':strToU8('<svg><text>Independent frame</text></svg>'),'GuiDocument.xml':strToU8('<Document><ViewProvider name="Dim"><Properties><Property name="Font" type="App::PropertyFont"><Font value="Old Font"/></Property></Properties></ViewProvider></Document>')});
 return root;
}
it('is read-only and derives empty fields from one proven source without MetadataSource or native startup',async()=>{
 const root=fixture(),before=fs.readFileSync(path.join(root,'drawings/Example.Drawing.FCStd')),source=fs.readFileSync(path.join(root,'Model.FCStd'));
 const preview=await previewDrawingAudit(root,{directory:'drawings',annotation_font:'Annotation Sans'});expect(preview.rows).toHaveLength(1);const row=preview.rows[0];
 expect(row).toMatchObject({source_rel:'Model.FCStd',source_node:'Body'});
 expect(row.issues).toEqual(expect.arrayContaining([expect.objectContaining({field:'part_material',proposed:'STEEL-A',status:'ready'}),expect.objectContaining({field:'drawing_number',proposed:'DEMO-001',status:'ready'}),expect.objectContaining({field:'Label',location:'Page',proposed:'DEMO-001.A-零件图',status:'ready'}),expect.objectContaining({field:'ViewObject.Font',proposed:'osifont',status:'ready'}),expect.objectContaining({field:'FormatSpec',current:'Ø%.2f ±0.02',proposed:'⌀%.2f ±0.02',status:'ready'})]));
 expect(fs.readFileSync(path.join(root,'drawings/Example.Drawing.FCStd'))).toEqual(before);expect(fs.readFileSync(path.join(root,'Model.FCStd'))).toEqual(source);expect(fs.existsSync(path.join(root,'.phoenix'))).toBe(false);
 const internal=consumeDrawingAudit(root,preview.plan_id);row.issues[0].status='ready';expect([...internal.entries.values()][0].row.issues).not.toBe(row.issues);
});
it('preserves explicit human material and treats unknown dimension Type as manual',async()=>{
 const root=fixture('STEEL-A','HUMAN-ALLOY','2');const result=await previewDrawingAudit(root,{directory:'drawings'});
 expect(result.rows[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({kind:'material',current:'HUMAN-ALLOY',proposed:'STEEL-A',status:'conflict'}),expect.objectContaining({field:'FormatSpec',status:'manual'})]));
 expect(result.rows[0].issues.find(i=>i.location==='Note'&&i.kind==='font')?.status).toBe('manual');
});
it.each([['CUSTOM-A','CUSTOM-A','ready'],['','','manual'],['   ','','manual']])('uses only an explicit nonempty workspace material when source PartMaterial is absent (%s)',async(config,expected,status)=>{
 const root=fixture('');fs.mkdirSync(path.join(root,'.phoenix'));fs.writeFileSync(path.join(root,'.phoenix/drawing-defaults.json'),JSON.stringify({material:config}));
 const result=await previewDrawingAudit(root,{directory:'drawings'}),row=result.rows[0],issue=row.issues.find(i=>i.field==='part_material')!;
 expect(issue).toMatchObject({proposed:expected,status,message:expect.stringContaining(status==='ready'?'材料来源：工作空间明确配置':'缺少源材料/明确配置')});
 expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.has(issue.id)).toBe(status==='ready');
});
it('does not infer Q235 without source material or a workspace configuration',async()=>{
 const root=fixture(''),result=await previewDrawingAudit(root,{directory:'drawings'}),row=result.rows[0],issue=row.issues.find(i=>i.field==='part_material')!;
 expect(issue).toMatchObject({current:'',proposed:'',status:'manual',message:expect.stringContaining('需人工确认')});
 expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.has(issue.id)).toBe(false);
});
it('states source PartMaterial provenance and preserves conflicting human material',async()=>{
 const root=fixture('SOURCE-ALLOY','HUMAN-ALLOY'),result=await previewDrawingAudit(root,{directory:'drawings'}),row=result.rows[0],issue=row.issues.find(i=>i.field==='part_material')!;
 expect(issue).toMatchObject({current:'HUMAN-ALLOY',proposed:'SOURCE-ALLOY',status:'conflict',message:expect.stringContaining('材料来源：源模型 PartMaterial')});
 expect(consumeDrawingAudit(root,result.plan_id).entries.get(row.id)?.patches.has(issue.id)).toBe(false);
});
it('binds a plan to its workspace and consumes it once',async()=>{
 const root=fixture(),other=fixture();const result=await previewDrawingAudit(root,{directory:'drawings'});
 expect(()=>consumeDrawingAudit(other,result.plan_id)).toThrow(/工作空间/);consumeDrawingAudit(root,result.plan_id);expect(()=>consumeDrawingAudit(root,result.plan_id)).toThrow(/不存在/);
});
it('repairs only explicitly referenced mojibake resource names at their original archive slot',async()=>{
 const root=fixture(),expected='框.svg',mojibake=Buffer.from(expected).toString('latin1');
 const original=fs.readFileSync(path.join(root,'drawings/Example.Drawing.FCStd'));const {unzipSync,strFromU8}=await import('fflate');const files=unzipSync(original);let xml=strFromU8(files['Document.xml']).replace('file="frame.svg"',`file="${expected}"`);delete files['frame.svg'];
 save(root,'drawings/Example.Drawing.FCStd',xml,{[mojibake]:strToU8('<svg>independent resource</svg>'),'keep.bin':strToU8('opaque independent bytes')});
 const preview=await previewDrawingAudit(root,{directory:'drawings'});const item=preview.rows[0].issues.find(i=>i.kind==='resource'&&i.status==='ready');expect(item).toMatchObject({current:mojibake,proposed:'EmbeddedResource1.svg'});
 const plan=consumeDrawingAudit(root,preview.plan_id);expect(plan.entries.get(preview.rows[0].id)?.patches.get(item!.id)).toMatchObject({kind:'resource',reference:expected,current:mojibake});
});
it('offers separate known-hidden Page/Template/paper-view repairs, never ShowFrames or source Link visibility',async()=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{
  let xml=strFromU8(files['Document.xml']);for(const name of ['Page','Template','Link','Dim'])xml=xml.replace(`<Object name="${name}"><Properties>`,`<Object name="${name}"><Properties>${hidden}`);files['Document.xml']=strToU8(xml);
  files['GuiDocument.xml']=strToU8(`<Document>${['Page','Template','Link','Dim'].map(name=>`<ViewProvider name="${name}"><Properties>${hidden}${name==='Page'?'<Property name="ShowFrames"><Bool value="false"/></Property>':''}</Properties></ViewProvider>`).join('')}</Document>`);
 });
 const preview=await previewDrawingAudit(root,{directory:'drawings'}),issues=preview.rows[0].issues.filter(issue=>issue.field.includes('Visibility')&&issue.status==='ready');
 expect(issues.map(issue=>issue.location)).toEqual(['Page','Template','Dim']);expect(issues.every(issue=>issue.current==='false'&&issue.proposed==='true')).toBe(true);
 expect(preview.rows[0].issues.some(issue=>issue.field==='ShowFrames'||issue.location==='Link'&&['Visibility','ViewObject.Visibility'].includes(issue.field))).toBe(false);
 const plan=consumeDrawingAudit(root,preview.plan_id);expect([...plan.entries.values()][0].patches.size).toBeGreaterThanOrEqual(3);
});
it.each([['app-bool',hidden,'Visibility'],['view-only','','ViewObject.Visibility']])('coalesces Template aliases and prefers %s',async(_name,app,field)=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('<Object name="Template"><Properties>','<Object name="Template"><Properties>'+app));files['GuiDocument.xml']=strToU8(`<Document><ViewProvider name="Template"><Properties>${hidden}</Properties></ViewProvider></Document>`);});
 const result=await previewDrawingAudit(root,{directory:'drawings'}),issues=result.rows[0].issues.filter(issue=>issue.location==='Template'&&['Visibility','ViewObject.Visibility'].includes(issue.field));expect(issues).toHaveLength(1);expect(issues[0]).toMatchObject({field,current:'false',proposed:'true',status:'ready'});
});
it('does not choose between inconsistent serialized Template aliases',async()=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('<Object name="Template"><Properties>','<Object name="Template"><Properties>'+hidden));files['GuiDocument.xml']=strToU8(`<Document><ViewProvider name="Template"><Properties>${hidden.replace('value="false"','value="true"')}</Properties></ViewProvider></Document>`);});
 const result=await previewDrawingAudit(root,{directory:'drawings'});expect(result.rows[0].issues.find(issue=>issue.location==='Template'&&issue.field==='Visibility')).toMatchObject({status:'conflict',proposed:''});
});
it.each([['all-hidden',hidden,'all hidden'],['unknown','','unknown']])('keeps source Body/Tip %s as manual, not global show',async(_name,bodyVisibility,expected)=>{
 const root=fixture();edit(root,'Model.FCStd',files=>{if(bodyVisibility)files['GuiDocument.xml']=strToU8(`<Document><ViewProvider name="Body"><Properties>${bodyVisibility}</Properties></ViewProvider></Document>`);});
 const preview=await previewDrawingAudit(root,{directory:'drawings'});expect(preview.rows[0].issues.find(issue=>issue.field==='SourceBody.Visibility')).toMatchObject({status:'manual',current:expected,proposed:''});
});
it('honors an explicit local MetadataSource instead of guessing among multiple model links',async()=>{
 const root=fixture();const model=unzipSync(fs.readFileSync(path.join(root,'Model.FCStd')));model['Document.xml']=strToU8(strFromU8(model['Document.xml']).replace('STEEL-A','OTHER-A'));fs.writeFileSync(path.join(root,'Other.FCStd'),zipSync(model));
 edit(root,'drawings/Example.Drawing.FCStd',files=>{let xml=strFromU8(files['Document.xml']).replace('<Object name="Note" type="TechDraw::DrawViewAnnotation"/>','<Object name="Note" type="TechDraw::DrawViewAnnotation"/><Object name="Second" type="App::Link"/>');xml=xml.replace('<Object name="Page"><Properties>','<Object name="Page"><Properties><Property name="MetadataSource"><XLink value="Link"/></Property>');xml=xml.replace('</ObjectData>','<Object name="Second"><Properties><Property name="LinkedObject"><XLink file="../Other.FCStd" name="Body"/></Property></Properties></Object></ObjectData>');files['Document.xml']=strToU8(xml);});
 const result=await previewDrawingAudit(root,{directory:'drawings'});expect(result.rows[0]).toMatchObject({source_rel:'Model.FCStd',source_node:'Body'});expect(result.rows[0].issues.find(issue=>issue.field==='part_material')).toMatchObject({proposed:'STEEL-A',status:'ready'});
 edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('value="Link"','value="Unknown"'));});const next=await previewDrawingAudit(root,{directory:'drawings'});expect(next.rows[0].source_rel).toBeUndefined();expect(next.rows[0].issues.find(issue=>issue.field==='part_material')?.status).toBe('manual');
});
it('expires volatile plans and treats explicitly empty font settings as no repair request',async()=>{
 const root=fixture(),preview=await previewDrawingAudit(root,{directory:'drawings',dimension_font:'',annotation_font:''});
 expect(preview.rows[0].issues.filter(issue=>issue.kind==='font').every(issue=>issue.status==='manual'&&issue.proposed==='')).toBe(true);
 vi.useFakeTimers();vi.setSystemTime(Date.now()+11*60*1000);expect(()=>consumeDrawingAudit(root,preview.plan_id)).toThrow(/过期/);
});
it('does not infer overwrite permission from structured labels or a -Link suffix',async()=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('value="Page"','value="HUMAN-002.B-零件图"').replace('value="Link"','value="Manual-Link"'));});
 const result=await previewDrawingAudit(root,{directory:'drawings'});expect(result.rows[0].issues.filter(issue=>issue.kind==='label')).toEqual(expect.arrayContaining([expect.objectContaining({location:'Page',status:'conflict',current:'HUMAN-002.B-零件图'}),expect.objectContaining({location:'Link',status:'conflict',current:'Manual-Link'})]));
});
it.each([['complete','<Enumeration value="1" count="2"><Enum value="Distance"/><Enum value="Diameter"/></Enumeration>','ready'],['incomplete','<Enumeration value="1" count="3"><Enum value="Distance"/><Enum value="Diameter"/></Enumeration>','manual']])('uses the %s saved Enumeration list, never numeric Type assumptions',async(_name,content,status)=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('<String value="Diameter"/>',content));});const result=await previewDrawingAudit(root,{directory:'drawings'});expect(result.rows[0].issues.find(issue=>issue.field==='FormatSpec')?.status).toBe(status);
});
it('does not infer Diameter from a native PropertyEnumeration containing only Integer 5',async()=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('<Property name="Type" type="App::PropertyString"><String value="Diameter"/></Property>','<Property name="Type" type="App::PropertyEnumeration"><Integer value="5"/></Property>'));});const result=await previewDrawingAudit(root,{directory:'drawings'});expect(result.rows[0].issues.find(issue=>issue.field==='FormatSpec')).toMatchObject({status:'manual',proposed:'Ø%.2f ±0.02'});
});
it('binds recommendation values to the same source bytes, not a later baseline read',async()=>{
 const root=fixture(),model=fs.realpathSync(path.join(root,'Model.FCStd')),read=fs.readFileSync.bind(fs);let changed=false;
 vi.spyOn(fs,'readFileSync').mockImplementation((file,options)=>{const value=read(file,options);if(String(file)===model&&!changed){changed=true;const files=unzipSync(Buffer.from(value));files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('STEEL-A','NEW-A'));fs.writeFileSync(model,zipSync(files));}return value;});
 const preview=await previewDrawingAudit(root,{directory:'drawings'});expect(preview.rows[0].issues.filter(issue=>issue.status==='ready')).toHaveLength(0);expect(preview.rows[0].issues.find(issue=>issue.field==='part_material')).toMatchObject({proposed:'STEEL-A',status:'manual',message:expect.stringContaining('源字节已变化')});expect(consumeDrawingAudit(root,preview.plan_id).entries.get(preview.rows[0].id)?.native).toBeUndefined();
});
it('keeps a nameless XLink manual instead of promising a repair without a native Shape/dimension baseline',async()=>{
 const root=fixture();edit(root,'drawings/Example.Drawing.FCStd',files=>{files['Document.xml']=strToU8(strFromU8(files['Document.xml']).replace('<XLink file="../Model.FCStd" name="Body"/>','<XLink file="../Model.FCStd"/>'));});
 const preview=await previewDrawingAudit(root,{directory:'drawings'}),row=preview.rows[0],issue=row.issues.find(issue=>issue.kind==='link'&&issue.location==='Link')!;expect(issue).toMatchObject({status:'manual',proposed:'../Model.FCStd#Body',message:expect.stringContaining('先修引用/人工核对')});expect(consumeDrawingAudit(root,preview.plan_id).entries.get(row.id)?.patches.has(issue.id)).toBe(false);
});
