import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {strToU8,zipSync}from'fflate';
import {afterEach,expect,it,vi}from'vitest';
import {defaultBatchAdapters}from'./adapters.js';
import {taskDraft}from'./model.js';

const keys=['cad.saved-links','cad.saved-drawing'] as const,roots:string[]=[];
const property=(name:string,content:string)=>`<Property name="${name}">${content}</Property>`;
const object=(name:string,type:string,props='')=>`<Object name="${name}" type="${type}"><Properties>${props}</Properties></Object>`;
const document=(objects:string)=>`<Document><ObjectData>${objects}</ObjectData></Document>`;
const linksXml=document(object('SourceLink','App::Link',property('Label','<String value="Saved label"/>')
 +property('LinkedObject','<PropertyXLink><XLink file="parts/A&amp;B.FCStd" label="same"/><XLink file="parts/A&amp;B.FCStd" label="same"/>'
 +'<XLink file="/definitely-missing/absolute.FCStd" label="absolute"/><XLink file="../missing.FCStd" label="relative"/>'
 +'<XLink file="C:\\external\\part.FCStd" label="windows"/><XLink file="https://invalid.example/remote.FCStd" label="url"/>'
 +'<XLink file="" label=""/></PropertyXLink>')));
function fixture(xml=document(object('Body','PartDesign::Body')),name='selected.FCStd'){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'saved-cad-adapters-')));roots.push(root);
 const filename=path.join(root,name);fs.writeFileSync(filename,zipSync({'Document.xml':strToU8(xml)}));
 return {root,filename,subject:{kind:'cad_model' as const,rel:name},bytes:fs.readFileSync(filename)};
}
const adapter=(key:string)=>defaultBatchAdapters().find(item=>item.descriptor.key===key)!;
const run=(key:string,sample:ReturnType<typeof fixture>,signal=new AbortController().signal)=>adapter(key).execute(sample.root,sample.subject,signal);
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('registers two fixed, cancellable collect actions without broadening parameters or effects',()=>{
 const catalog=defaultBatchAdapters().map(item=>item.descriptor);
 for(const key of keys){
  expect(adapter(key).descriptor).toMatchObject({key,version:1,effects:['read_file','write_task_db'],phase:'collect',cancellable:true});
  expect(adapter(key).applicable({kind:'file',rel:'model.FCStd'})).toBeUndefined();
  expect(adapter(key).applicable({kind:'file',rel:'drawing.pdf'})).toBeTruthy();
  const draft={name:'Independent saved observation',subjects:[{kind:'cad_model',rel:'selected.FCStd'}],actions:[{instance_id:'observe',key,version:1,params:{}}]};
  expect(taskDraft(draft,catalog).actions[0].params).toEqual({});
  expect(()=>taskDraft({...draft,actions:[{...draft.actions[0],params:{resolve_targets:true}}]},catalog)).toThrow(/参数|动作/);
 }
});
it('preserves every original link and label, including duplicate, absolute, missing and empty strings',async()=>{
 const source=fixture(linksXml),result=await run('cad.saved-links',source);
 expect(result).toMatchObject({source:'saved_document_xml',target_resolution:'not_attempted',link_count:7,
  links:[{file:'parts/A&B.FCStd',label:'same'},{file:'parts/A&B.FCStd',label:'same'},
   {file:'/definitely-missing/absolute.FCStd',label:'absolute'},{file:'../missing.FCStd',label:'relative'},
   {file:'C:\\external\\part.FCStd',label:'windows'},{file:'https://invalid.example/remote.FCStd',label:'url'},{file:'',label:''}]});
 expect((result.warnings as string[]).join('\n')).toContain('不等于 BOM');
 expect(result).not.toHaveProperty('resolved_targets');expect(result).not.toHaveProperty('quantity');
 expect(fs.readFileSync(source.filename)).toEqual(source.bytes);expect(fs.readdirSync(source.root)).toEqual(['selected.FCStd']);
});
it('declares inherited host display labels rather than presenting them as original target names',async()=>{
 const source=fixture(document(object('LocalCarrier','App::Link',property('Label','<String value="Local visible label"/>')
  +property('LinkedObject','<XLink file="unread.FCStd" name="RemoteInternalBody"/>'))));
 const result=await run('cad.saved-links',source);
 expect(result).toMatchObject({label_semantics:'explicit_xlink_label_or_host_label_fallback',links:[{file:'unread.FCStd',label:'Local visible label'}],target_resolution:'not_attempted'});
 expect((result.warnings as string[]).join('\n')).toContain('不是经核验');
 expect(result).not.toHaveProperty('target_name'); expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
});
it.each(keys)('reads only the selected file, without target scans, Native processes or business cache writes: %s',async key=>{
 const source=fixture(linksXml),read=fs.readFileSync;
 const actualRead=vi.spyOn(fs,'readFileSync').mockImplementation(((file:fs.PathOrFileDescriptor,...args:unknown[])=>{
  if(String(file)!==source.filename)throw new Error('unselected content read');
  return Reflect.apply(read,fs,[file,...args]);
 }) as typeof fs.readFileSync);
 const forbidden=[vi.spyOn(fs,'readdirSync'),vi.spyOn(fs,'opendirSync'),vi.spyOn(fs,'writeFileSync'),vi.spyOn(fs,'appendFileSync'),
  vi.spyOn(fs,'mkdirSync'),vi.spyOn(fs,'renameSync'),vi.spyOn(childProcess,'spawn'),vi.spyOn(childProcess,'spawnSync'),
  vi.spyOn(childProcess,'execFile'),vi.spyOn(childProcess,'execFileSync')];
 for(const spy of forbidden)spy.mockImplementation((()=>{throw new Error('forbidden scope expansion');}) as never);
 await expect(run(key,source)).resolves.toMatchObject({source:'saved_document_xml'});
 expect(actualRead).toHaveBeenCalled();for(const spy of forbidden)expect(spy).not.toHaveBeenCalled();
 vi.restoreAllMocks();expect(fs.readFileSync(source.filename)).toEqual(source.bytes);expect(fs.readdirSync(source.root)).toEqual(['selected.FCStd']);
});
it('counts saved TechDraw types with exact view semantics and preserves unsupported structures as unknown',async()=>{
 const source=fixture(document(object('Page','TechDraw::DrawPage',property('Views','<LinkList><Link value="View"/></LinkList>')+property('Template','<Link value="Template"/>'))
  +object('View','TechDraw::DrawViewPart')+object('Projection','TechDraw::DrawProjGroupItem')+object('Section','TechDraw::DrawViewSection')+object('Detail','TechDraw::DrawViewDetail')
  +object('Dimension','TechDraw::DrawViewDimension',property('References2D','<LinkSubList><Link obj="View" sub="Edge1"/></LinkSubList>'))
  +object('Template','TechDraw::DrawSVGTemplate',property('EditableTexts','<Map><Item key="title" value="Independent title"/></Map>'))
  +object('Annotation','TechDraw::DrawViewAnnotation')+object('Future','TechDraw::FutureView')+object('Body','PartDesign::Body')));
 const result=await run('cad.saved-drawing',source);
 expect(result).toMatchObject({source:'saved_document_xml',verification:'saved_types_only',counts:{techdraw_objects:9,pages:1,views:4,dimensions:1},
  unclassified_types:['TechDraw::FutureView'],structured_fields:{page_view_links:'unknown',template_links:'unknown',editable_texts:'unknown',dimension_references:'unknown'}});
 expect(result.objects).toContainEqual({name:'Future',type:'TechDraw::FutureView',label:'Future'});
 expect(result.types).toContainEqual({type:'TechDraw::DrawViewDimension',count:1});
 expect(result.view_types_counted).toEqual(['TechDraw::DrawViewPart','TechDraw::DrawProjGroupItem','TechDraw::DrawViewSection','TechDraw::DrawViewDetail']);
 expect((result.warnings as string[]).join('\n')).toMatch(/未投影|unknown/);expect((result.warnings as string[]).join('\n')).toContain('未归类');
 expect(result).not.toHaveProperty('templates');expect(result).not.toHaveProperty('valid_dimensions');expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
});
it('reports an ordinary model with zero TechDraw objects, without inventing drawing validity',async()=>{
 const result=await run('cad.saved-drawing',fixture());
 expect(result).toMatchObject({counts:{techdraw_objects:0,pages:0,views:0,dimensions:0},types:[],objects:[],verification:'saved_types_only'});
 expect(Object.values(result.structured_fields as Record<string,unknown>)).toEqual(['unknown','unknown','unknown','unknown']);
 expect(result).not.toHaveProperty('valid');
 expect(await run('cad.saved-links',fixture())).toMatchObject({link_count:0,links:[],target_resolution:'not_attempted'});
});
it('keeps the existing saved-properties payload and physical-material meaning unchanged',async()=>{
 const source=fixture(document(object('Body','PartDesign::Body',property('Label','<String value="Independent body"/>')
  +property('PartNumber','<String value="DEMO42"/>')+property('PartVersion','<String value="007P1"/>')
  +property('PartName','<String value="Bracket"/>')+property('Material','<String value="Saved display material"/>')
  +property('Other','<String value="not in legacy projection"/>'))));
 expect(await run('cad.saved-properties',source)).toEqual({source:'saved_document_xml',physical_material:false,
  objects:[{name:'Body',type:'PartDesign::Body',label:'Independent body',material:'Saved display material',properties:{PartNumber:'DEMO42',PartVersion:'007P1',PartName:'Bracket'}}],warnings:[]});
});
it.each(keys)('rejects pre-cancellation and cancellation before the deferred saved read: %s',async key=>{
 const source=fixture(),first=new AbortController();first.abort();
 await expect(run(key,source,first.signal)).rejects.toMatchObject({code:'cancelled'});
 const second=new AbortController(),pending=run(key,source,second.signal);second.abort();
 await expect(pending).rejects.toMatchObject({code:'cancelled'});expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
});
it.each(keys)('rejects bad ZIP, malformed XML, unknown entities and unsafe XML declarations without empty success: %s',async key=>{
 const badZip=fixture();fs.writeFileSync(badZip.filename,'not a ZIP');
 await expect(run(key,badZip)).rejects.toMatchObject({code:'invalid_fcstd_archive'});
 for(const xml of ['<Document><Broken></Document>',document(object('Body','PartDesign::Body',property('Label','<String value="&unknown;"/>'))),
  '<!DOCTYPE Document [<!ENTITY external SYSTEM "file:///never-read">]><Document/>']){
  const source=fixture(xml);await expect(run(key,source)).rejects.toMatchObject({code:'invalid_document_xml'});expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
 }
});
it.each(keys)('rejects outside selections and symbolic input without following them: %s',async key=>{
 const source=fixture(),outside=fixture();
 await expect(adapter(key).execute(source.root,{kind:'cad_model',rel:outside.filename},new AbortController().signal)).rejects.toMatchObject({code:'path_escape'});
 await expect(adapter(key).execute(source.root,{kind:'cad_model',rel:'../outside.FCStd'},new AbortController().signal)).rejects.toMatchObject({code:'path_escape'});
 const alias=path.join(source.root,'alias.FCStd');fs.symlinkSync(source.filename,alias);
 await expect(adapter(key).execute(source.root,{kind:'cad_model',rel:'alias.FCStd'},new AbortController().signal)).rejects.toMatchObject({code:'path_escape'});
 expect(fs.readFileSync(source.filename)).toEqual(source.bytes);expect(fs.readFileSync(outside.filename)).toEqual(outside.bytes);
});
it.each([...keys,'cad.saved-properties'])('shares the reviewed 500-object limit without truncating: %s',async key=>{
 const source=fixture(document(Array.from({length:501},(_,index)=>object(`Object${index}`,'PartDesign::Body')).join('')));
 await expect(run(key,source)).rejects.toThrow('对象超过500个');expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
});
it('rejects link label amplification over the 256KiB task observation budget',async()=>{
 const label='L'.repeat(1024),source=fixture(document(object('Host','App::Link',property('Label',`<String value="${label}"/>`)
  +property('LinkedObject',`<PropertyXLink>${'<XLink file="missing.FCStd"/>'.repeat(300)}</PropertyXLink>`))));
 await expect(run('cad.saved-links',source)).rejects.toThrow('256KiB');expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
});
it('rejects oversized saved drawing observations instead of dropping labels or structured unknowns',async()=>{
 const source=fixture(document(object('Page','TechDraw::DrawPage',property('Label',`<String value="${'L'.repeat(256*1024)}"/>`))));
 await expect(run('cad.saved-drawing',source)).rejects.toThrow('256KiB');expect(fs.readFileSync(source.filename)).toEqual(source.bytes);
});
