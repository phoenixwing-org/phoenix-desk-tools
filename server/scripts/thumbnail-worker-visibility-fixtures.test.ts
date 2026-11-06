import {describe,expect,it} from 'vitest';
import {zipSync,unzipSync} from 'fflate';
import {buildSyntheticVisibilityVariants} from './thumbnail-worker-visibility-fixtures.js';

// Independent structural bytes only: no Native, user project, real part list,
// source filesystem path or historical CAD geometry is included in this test.
const document=Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document SchemaVersion="4"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="Plate"/></Property></Properties>
<Objects Count="1"><Object name="Shape" type="Part::Feature" id="1"/></Objects>
<ObjectData Count="1"><Object name="Shape"><Properties Count="3">
<Property name="Label" type="App::PropertyString"><String value="Shape"/></Property>
<Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property>
<Property name="Shape" type="Part::PropertyPartShape"><Part file="Shape.Shape.brp"/></Property>
</Properties></Object></ObjectData></Document>`);
const gui=Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document SchemaVersion="1"><ViewProviderData Count="1"><ViewProvider name="Shape" expanded="0"><Properties Count="2">
<Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property>
<Property name="ShapeColor" type="App::PropertyColor"><PropertyColor value="3419130623"/></Property>
</Properties></ViewProvider></ViewProviderData><Camera settings="independent fixture"/></Document>`);
const fixtureFiles=()=>({'Document.xml':document,'GuiDocument.xml':gui,'Shape.Shape.brp':Buffer.from('Opaque independent BREP bytes; not opened by tests.'),'thumbnails/Thumbnail.png':Buffer.from('Opaque retained thumbnail bytes.')});
const fixture=()=>Buffer.from(zipSync(fixtureFiles(),{level:0}));
const changed=(name:string,text:string)=>Buffer.from(zipSync({...fixtureFiles(),[name]:Buffer.from(text)},{level:0}));
const withNativeMetadata=()=>document.toString()
  .replace('<Properties Count="1">','<Properties Count="1" TransientCount="1"><_Property name="SessionHint" type="App::PropertyString" status="4"/>')
  .replace('<Properties Count="3">','<Properties Count="3" TransientCount="1"><_Property name="MappingHint" type="App::PropertyString"/>')
  .replace('<Objects Count="1">','<Objects Count="1" Dependencies="1"><ObjectDeps Name="Shape" Count="0"/>')
  .replace('<Part file="Shape.Shape.brp"/>','<Part file="Shape.Shape.brp" ElementMap="synthetic-version"/><ElementMap/>');
const values=(bytes:Uint8Array)=>Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name,value])=>[name,Buffer.from(value)]));
const replaceName=(bytes:Buffer,from:string,to:string)=>{
  if(from.length!==to.length)throw new Error('equal name lengths required');
  const output=Buffer.from(bytes),needle=Buffer.from(from),replacement=Buffer.from(to);
  for(let at=0;(at=output.indexOf(needle,at))>=0;at+=needle.length)replacement.copy(output,at);
  return output;
};
function appendedFirstPayload(input:Buffer,append:Buffer,descriptor=false){
  const oldEnd=input.length-22,oldCentral=input.readUInt32LE(oldEnd+16),count=input.readUInt16LE(oldEnd+10);
  const firstBody=30+input.readUInt16LE(26)+input.readUInt16LE(28),payloadEnd=firstBody+input.readUInt32LE(18);
  const output=Buffer.concat([input.subarray(0,payloadEnd),append,input.subarray(payloadEnd)]);
  const end=oldEnd+append.length;output.writeUInt32LE(oldCentral+append.length,end+16);
  let cursor=oldCentral+append.length;
  for(let i=0;i<count;i++){
    if(i===0){
      if(descriptor)output.writeUInt16LE(output.readUInt16LE(cursor+8)|8,cursor+8);
      else output.writeUInt32LE(output.readUInt32LE(cursor+20)+append.length,cursor+20);
    }else output.writeUInt32LE(output.readUInt32LE(cursor+42)+append.length,cursor+42);
    cursor+=46+output.readUInt16LE(cursor+28)+output.readUInt16LE(cursor+30)+output.readUInt16LE(cursor+32);
  }
  if(descriptor){output.writeUInt16LE(output.readUInt16LE(6)|8,6);output.fill(0,14,26);}
  else output.writeUInt32LE(output.readUInt32LE(18)+append.length,18);
  return output;
}
describe('pure synthetic visibility variants',()=>{
  it('changes only the intended uncompressed members, and never mutates source bytes',()=>{
    const source=fixture(),before=Buffer.from(source),base=values(source),variants=buildSyntheticVisibilityVariants(source);
    expect(source.equals(before)).toBe(true);
    const absent=values(variants.withoutGui);expect(Object.keys(absent).sort()).toEqual(Object.keys(base).filter(n=>n!=='GuiDocument.xml').sort());
    for(const [name,bytes] of Object.entries(absent))expect(bytes.equals(base[name])).toBe(true);
    const hidden=values(variants.guiHidden);expect(hidden['Document.xml'].equals(document)).toBe(true);
    expect(hidden['GuiDocument.xml'].toString()).toBe(gui.toString().replace('Bool value="true"','Bool value="false"'));
    for(const kind of ['missingVisibility','invalidVisibility'] as const){
      const files=values(variants[kind]);expect(files['GuiDocument.xml']).toBeUndefined();
      for(const name of ['Shape.Shape.brp','thumbnails/Thumbnail.png'])expect(files[name].equals(base[name])).toBe(true);
    }
    const missing=values(variants.missingVisibility)['Document.xml'].toString();
    expect(missing).toBe(document.toString().replace('<Properties Count="3">','<Properties Count="2">').replace('<Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property>',''));
    expect(values(variants.invalidVisibility)['Document.xml'].toString()).toBe(document.toString().replace('Bool value="true"','Bool value="not-a-bool"'));
  });
  it('accepts numeric true and single quotes without changing unrelated attributes or text',()=>{
    const input=Buffer.from(zipSync({...fixtureFiles(),'Document.xml':Buffer.from(document.toString().replace('value="true"',"value='1'")),'GuiDocument.xml':Buffer.from(gui.toString().replace('value="true"',"value='1'"))}));
    const result=buildSyntheticVisibilityVariants(input);
    expect(values(result.guiHidden)['GuiDocument.xml'].toString()).toContain("<Bool value='false'/>");
    expect(values(result.invalidVisibility)['Document.xml'].toString()).toContain("<Bool value='not-a-bool'/>");
  });
  it('accepts well-formed neutral XML entities without reparsing/rewriting other bytes',()=>{
    const input=changed('Document.xml',document.toString().replace('value="Plate"','value="Independent &amp; neutral &#x50;late"'));
    expect(values(buildSyntheticVisibilityVariants(input).withoutGui)['Document.xml']).toEqual(values(input)['Document.xml']);
  });
  it('keeps independently counted transient metadata, empty dependencies and empty shape map unchanged',()=>{
    const text=withNativeMetadata(),input=changed('Document.xml',text),result=buildSyntheticVisibilityVariants(input);
    expect(values(result.withoutGui)['Document.xml'].toString()).toBe(text);
    expect(values(result.guiHidden)['Document.xml'].toString()).toBe(text);
    const missing=values(result.missingVisibility)['Document.xml'].toString();
    expect(missing).toContain('<Properties Count="2" TransientCount="1"><_Property name="MappingHint"');
    expect(missing).toContain('<Properties Count="1" TransientCount="1"><_Property name="SessionHint"');
    expect(missing).toContain('<ObjectDeps Name="Shape" Count="0"/>');expect(missing).toContain('<ElementMap/>');
    expect(missing).not.toContain('name="Visibility"');
  });
  it.each([
    (s:string)=>s.replace('TransientCount="1"','TransientCount="0"'),
    (s:string)=>s.replace('TransientCount="1"','TransientCount="2"'),
    (s:string)=>s.replace('type="App::PropertyString" status="4"/>','type="App::PropertyString" status="no"/>'),
    (s:string)=>s.replace('name="SessionHint"','name="Label"'),
    (s:string)=>s.replace('<_Property name="MappingHint" type="App::PropertyString"/>','<_Property name="MappingHint" type="App::PropertyString"><String value="not metadata"/></_Property>'),
    (s:string)=>s.replace('Dependencies="1"','Dependencies="0"'),
    (s:string)=>s.replace('<ObjectDeps Name="Shape" Count="0"/>','<ObjectDeps Name="Shape" Count="1"/>'),
    (s:string)=>s.replace('<ObjectDeps Name="Shape" Count="0"/>','<ObjectDeps Name="Other" Count="0"/>'),
    (s:string)=>s.replace('<ObjectDeps Name="Shape" Count="0"/>','<ObjectDeps Name="Shape" Count="0"><Dependency/></ObjectDeps>'),
    (s:string)=>s.replace('<ObjectDeps Name="Shape" Count="0"/>','<ObjectDeps Name="Shape" Count="0"/><ObjectDeps Name="Shape" Count="0"/>'),
    (s:string)=>s.replace('<ElementMap/>','<ElementMap value="nonempty"/>'),
    (s:string)=>s.replace('<ElementMap/>','<ElementMap><Entry/></ElementMap>'),
    (s:string)=>s.replace('<ElementMap/>','<ElementMap>mapping</ElementMap>'),
    (s:string)=>s.replace('<ElementMap/>','<ElementMap/><ElementMap/>'),
    (s:string)=>s.replace('<Part file="Shape.Shape.brp" ElementMap="synthetic-version"/>','<Part file="Shape.Shape.brp"/><Part file="Shape.Shape.brp"/>'),
  ])('does not generalize native metadata compatibility to nonempty or inconsistent state case %#',edit=>{
    expect(()=>buildSyntheticVisibilityVariants(changed('Document.xml',edit(withNativeMetadata())))).toThrow();
  });
  it.each([true,false])('fully checks a native streamed ZIP descriptor, signature=%s',signed=>{
    const source=fixture(),descriptor=Buffer.alloc(signed?16:12),offset=signed?4:0;
    if(signed)descriptor.writeUInt32LE(0x08074b50,0);source.copy(descriptor,offset,14,26);
    const streamed=appendedFirstPayload(source,descriptor,true);
    const variant=values(buildSyntheticVisibilityVariants(streamed).withoutGui);
    expect(variant['Document.xml']).toEqual(document);expect(variant['Shape.Shape.brp']).toEqual(fixtureFiles()['Shape.Shape.brp']);
    descriptor[offset]^=1;expect(()=>buildSyntheticVisibilityVariants(appendedFirstPayload(source,descriptor,true))).toThrow();
  });
  it('rejects trailing compressed bytes even when output size and CRC still match',()=>{
    const source=Buffer.from(zipSync(fixtureFiles(),{level:6}));
    expect(()=>buildSyntheticVisibilityVariants(appendedFirstPayload(source,Buffer.from([0])))).toThrow();
  });
  it.each([
    ['Document.xml',(s:string)=>s.replace('Part::Feature','App::Link')],
    ['Document.xml',(s:string)=>s.replace('name="Shape" type="Part::Feature"','name="Other" type="Part::Feature"')],
    ['Document.xml',(s:string)=>s.replace('<ObjectData Count="1">','<ObjectData Count="2">')],
    ['Document.xml',(s:string)=>s.replace('<Objects Count="1">','<Objects Count="2">')],
    ['Document.xml',(s:string)=>s.replace('<Properties Count="3">','<Properties Count="4">')],
    ['Document.xml',(s:string)=>s.replace('file="Shape.Shape.brp"','file="missing.brp"')],
    ['Document.xml',(s:string)=>s.replace('name="Shape" type="Part::PropertyPartShape"','name="Shape" type="App::PropertyLink"')],
    ['Document.xml',(s:string)=>s.replace('Bool value="true"','Bool value="false"')],
    ['Document.xml',(s:string)=>s.replace('Bool value="true"','Bool value="TRUE"')],
    ['Document.xml',(s:string)=>s.replace('Bool value="true"','Bool value="bad"')],
    ['Document.xml',(s:string)=>s.replace('name="Visibility"','name="NotVisibility"')],
    ['Document.xml',(s:string)=>s.replace('<Bool value="true"/>','<Bool value="true"/><Bool value="true"/>')],
    ['GuiDocument.xml',(s:string)=>s.replace('<ViewProviderData Count="1">','<ViewProviderData Count="2">')],
    ['GuiDocument.xml',(s:string)=>s.replace('name="Shape" expanded="0"','name="Other" expanded="0"')],
    ['GuiDocument.xml',(s:string)=>s.replace('<Properties Count="2">','<Properties Count="3">')],
    ['GuiDocument.xml',(s:string)=>s.replace('Bool value="true"','Bool value="false"')],
    ['GuiDocument.xml',(s:string)=>s.replace('name="ShapeColor"','name="Visibility"')],
  ])('rejects non-fixed structure: %s case %#',(name,edit)=>{
    const original=name==='Document.xml'?document:gui;
    expect(()=>buildSyntheticVisibilityVariants(changed(name,edit(original.toString())))).toThrow('synthetic_visibility_fixture_not_verified');
  });
  it.each([
    (s:string)=>s.replace('<Document SchemaVersion="4">','<!DOCTYPE Document [<!ENTITY x SYSTEM "file:///unread">]><Document SchemaVersion="4">'),
    (s:string)=>s.replace('value="Plate"','value="&unknown;"'),
    (s:string)=>s.replace('value="Plate"','value="&#0;"'),
    (s:string)=>s.replace('value="Plate"','value="unterminated &"'),
    (s:string)=>s.replace('value="Plate"','value="Plate" value="Other"'),
    (s:string)=>s.replace('</ObjectData>','</ObjectDataX>'),
    (s:string)=>s+'<Other/>',
    (s:string)=>s.replace('UTF-8','GBK'),
    (s:string)=>s.replace('value="Plate"','value="\u0001"'),
    (s:string)=>s.replace('<Objects Count="1">','<Objects Count="1"><![CDATA[unnecessary]]>'),
  ])('rejects malformed or unsupported XML case %#',edit=>{
    expect(()=>buildSyntheticVisibilityVariants(changed('Document.xml',edit(document.toString())))).toThrow();
  });
  it('requires a complete ZIP and both unique canonical XML members',()=>{
    const base=fixtureFiles();
    for(const name of ['Document.xml','GuiDocument.xml']){const files={...base};delete files[name as keyof typeof files];expect(()=>buildSyntheticVisibilityVariants(zipSync(files))).toThrow();}
    const duplicate=zipSync({...base,'document.xml':document});expect(()=>buildSyntheticVisibilityVariants(duplicate)).toThrow();
    const alias=replaceName(fixture(),'GuiDocument.xml','GUiDocument.xml');expect(()=>buildSyntheticVisibilityVariants(alias)).toThrow();
    expect(()=>buildSyntheticVisibilityVariants(fixture().subarray(0,-1))).toThrow();
    expect(()=>buildSyntheticVisibilityVariants(Buffer.concat([fixture(),Buffer.from('junk')]))).toThrow();
  });
  it('rejects duplicate exact names before an unzip map can overwrite them',()=>{
    const input=zipSync({...fixtureFiles(),'Document.xmZ':document},{level:0});
    expect(()=>buildSyntheticVisibilityVariants(replaceName(Buffer.from(input),'Document.xmZ','Document.xml'))).toThrow();
  });
  it('verifies every member CRC, not just the edited XML payloads',()=>{
    const input=fixture(),output=Buffer.from(input),at=output.indexOf(Buffer.from('Opaque independent BREP bytes;'));
    expect(at).toBeGreaterThan(0);output[at]^=1;expect(()=>buildSyntheticVisibilityVariants(output)).toThrow();
  });
  it('rejects traversal, overlarge compressed/uncompressed budgets and excessive member counts',()=>{
    expect(()=>buildSyntheticVisibilityVariants(zipSync({...fixtureFiles(),'../other':Buffer.from('x')}))).toThrow();
    expect(()=>buildSyntheticVisibilityVariants(Buffer.alloc(16*1024*1024+1))).toThrow();
    expect(()=>buildSyntheticVisibilityVariants(changed('Document.xml',' '.repeat(2*1024*1024+1)))).toThrow();
    const many=Object.fromEntries(Array.from({length:129},(_,i)=>['a'+i,Buffer.from('x')]));
    expect(()=>buildSyntheticVisibilityVariants(zipSync({...fixtureFiles(),...many}))).toThrow();
  });
  it('rejects overlapping local records rather than reusing one payload twice',()=>{
    const input=fixture(),end=input.length-22,start=input.readUInt32LE(end+16),output=Buffer.from(input);
    const second=start+46+input.readUInt16LE(start+28)+input.readUInt16LE(start+30)+input.readUInt16LE(start+32);
    output.writeUInt32LE(input.readUInt32LE(start+42),second+42);
    expect(()=>buildSyntheticVisibilityVariants(output)).toThrow();
  });
});
