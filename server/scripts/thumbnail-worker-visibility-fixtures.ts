/** Pure-memory QA transform of the independently generated single-Shape GUI
 * fixture only. This is not a production FCStd repairer or a file/path API.
 * Every retained ZIP member keeps its uncompressed bytes; source is untouched. */
import {inflateRawSync} from 'node:zlib';
import {zipSync} from 'fflate';

const MAX_ARCHIVE=16*1024*1024,MAX_XML=2*1024*1024,MAX_TOTAL=32*1024*1024,MAX_MEMBERS=128;
const fail=():never=>{throw new Error('synthetic_visibility_fixture_not_verified');};
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=(bytes:Uint8Array)=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};

/** Complete bounded ZIP verification, including all payload CRCs and exact
 * deflate consumption. No duplicate/aliased members, data gaps or ZIP64. */
function archive(input:Uint8Array):Record<string,Uint8Array>{
  if(!(input instanceof Uint8Array)||input.length<22||input.length>MAX_ARCHIVE)fail();
  const bytes=Buffer.from(input),u16=(at:number)=>{if(at<0||at+2>bytes.length)fail();return bytes.readUInt16LE(at);},u32=(at:number)=>{if(at<0||at+4>bytes.length)fail();return bytes.readUInt32LE(at);};
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557);end--)if(u32(end)===0x06054b50&&end+22+u16(end+20)===bytes.length)break;
  if(end<0||end<bytes.length-65557||u16(end+4)||u16(end+6))fail();
  const count=u16(end+10),start=u32(end+16),size=u32(end+12);
  if(count<2||count>MAX_MEMBERS||count!==u16(end+8)||start+size!==end)fail();
  const files:Record<string,Uint8Array>=Object.create(null),names=new Set<string>(),spans:{start:number;end:number}[]=[];
  let cursor=start,total=0;
  for(let i=0;i<count;i++){
    if(cursor+46>end||u32(cursor)!==0x02014b50)fail();
    const flags=u16(cursor+8),method=u16(cursor+10),crc=u32(cursor+16),compressed=u32(cursor+20),original=u32(cursor+24),nameLength=u16(cursor+28),extra=u16(cursor+30),comment=u16(cursor+32),local=u32(cursor+42);
    const next=cursor+46+nameLength+extra+comment;
    if(next>end||u16(cursor+34)||flags&~(8|2048)||![0,8].includes(method)||compressed===0xffffffff||original===0xffffffff||local===0xffffffff)fail();
    let name:string;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+nameLength));}catch{return fail();}
    if(!name||name.startsWith('/')||/[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))fail();
    const alias=name.normalize('NFC').toLowerCase();if(names.has(alias))fail();names.add(alias);
    if((name.endsWith('.xml')&&original>MAX_XML)||original>MAX_ARCHIVE||(total+=original)>MAX_TOTAL)fail();
    if(local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==nameLength)fail();
    if(!bytes.subarray(local+30,local+30+nameLength).equals(bytes.subarray(cursor+46,cursor+46+nameLength)))fail();
    const body=local+30+nameLength+u16(local+28),finish=body+compressed;
    if(body>start||finish>start||method===0&&original!==compressed)fail();
    if(!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==compressed||u32(local+22)!==original))fail();
    let spanEnd=finish;
    if(flags&8){
      // FreeCAD may stream ZIP entries using a signed or unsigned descriptor.
      const descriptor=finish+(u32(finish)===0x08074b50?4:0);
      if(descriptor+12>start||u32(descriptor)!==crc||u32(descriptor+4)!==compressed||u32(descriptor+8)!==original)fail();
      spanEnd=descriptor+12;
    }
    let output:Buffer;
    try{
      if(method===0)output=Buffer.from(bytes.subarray(body,finish));
      else {
        const result=inflateRawSync(bytes.subarray(body,finish),{maxOutputLength:original+1,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
        if(result.engine.bytesWritten!==compressed)fail();output=result.buffer;
      }
    }catch{return fail();}
    if(output.length!==original||crc32(output)!==crc)fail();
    files[name]=output;spans.push({start:local,end:spanEnd});cursor=next;
  }
  if(cursor!==end)fail();spans.sort((a,b)=>a.start-b.start);let at=0;
  for(const span of spans){if(span.start!==at)fail();at=span.end;}if(at!==start)fail();
  if(!files['Document.xml']?.length||!files['GuiDocument.xml']?.length)fail();
  return files;
}

type Attribute={value:string;start:number;end:number};
type Node={tag:string;attrs:Record<string,Attribute>;children:Node[];start:number;openEnd:number;closeStart:number;end:number};
function decoded(value:string):string {
  for(const c of value){const n=c.codePointAt(0)!;if(!(n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff))fail();}
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return value.replace(/&([^;]*);|&/g,(_all,key:string|undefined)=>{
    if(!key) return fail();if(Object.hasOwn(entities,key))return entities[key];
    const m=/^(?:#([0-9]+)|#x([0-9a-fA-F]+))$/.exec(key);if(!m) return fail();const n=Number.parseInt(m[1]??m[2],m[1]?10:16);
    if(!(n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff))return fail();return String.fromCodePoint(n);
  });
}
function xml(bytes:Uint8Array):{text:string;root:Node}{
  if(bytes.length>MAX_XML)fail();let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return fail();}
  // This fixed native fixture has no DTD, CDATA, processing instructions or
  // custom encodings. Refuse these instead of attempting general XML repair.
  if(/<!\s*(?:DOCTYPE|ENTITY)|<!\[CDATA\[/i.test(text))fail();decoded(text.replace(/&[^;]*;/g,''));
  const tokens=/<!--[\s\S]*?-->|<\?xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])UTF-8\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/gi;
  const stack:Node[]=[];let root:Node|undefined,at=0,count=0,declaration=false;
  for(const match of text.matchAll(tokens)){
    if(++count>10000)fail();const index=match.index!,gap=text.slice(at,index);if(gap.includes('<')||gap.includes(']]>')||!stack.length&&gap.trim())fail();decoded(gap);
    const token=match[0];at=index+token.length;
    if(token.startsWith('<!--')){if(token.slice(4,-3).includes('--')||token.slice(4,-3).endsWith('-'))fail();continue;}
    if(token.startsWith('<?')){if(index!==0||declaration||root)fail();declaration=true;continue;}
    const tag=/^<\/?([\w:.-]+)/.exec(token)![1];
    if(token.startsWith('</')){if(!/^<\/[\w:.-]+\s*>$/.test(token))fail();const node=stack.pop();if(!node||node.tag!==tag)fail();node!.closeStart=index;node!.end=at;continue;}
    const attrs:Record<string,Attribute>=Object.create(null);
    for(const attr of token.matchAll(/\s([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)){
      if(Object.hasOwn(attrs,attr[1]))fail();const valueAt=index+attr.index!+attr[0].indexOf(attr[2])+1;
      attrs[attr[1]]={value:decoded(attr[3]),start:valueAt,end:valueAt+attr[3].length};
    }
    const node:Node={tag,attrs,children:[],start:index,openEnd:at,closeStart:at,end:at};
    if(stack.length)stack.at(-1)!.children.push(node);else {if(root)fail();root=node;}
    if(!token.endsWith('/>'))stack.push(node);if(stack.length>64)fail();
  }
  if(!root||stack.length||text.slice(at).trim())fail();
  const walk=(node:Node)=>{if(node.tag==='Properties'){
    const count=node.attrs.Count?.value,transient=node.attrs.TransientCount?.value??'0';
    if(!count||!/^\d+$/.test(count)||!/^\d+$/.test(transient)||Number(count)!==node.children.filter(n=>n.tag==='Property').length
      ||Number(transient)!==node.children.filter(n=>n.tag==='_Property').length||node.children.some(n=>!['Property','_Property'].includes(n.tag)))fail();
    for(const child of node.children)if(child.tag==='_Property'&&(child.children.length||text.slice(child.openEnd,child.closeStart).trim()
      ||!child.attrs.name?.value||!child.attrs.type?.value||Object.keys(child.attrs).some(key=>!['name','type','status'].includes(key))
      ||child.attrs.status&&!/^\d+$/.test(child.attrs.status.value)))fail();
    const names=node.children.map(n=>n.attrs.name?.value);if(names.some(n=>!n)||new Set(names).size!==names.length)fail();
  }for(const child of node.children)walk(child);};walk(root!);
  return {text,root:root!};
}
function one(node:Node,tag:string):Node{const found=node.children.filter(n=>n.tag===tag);if(found.length!==1)fail();return found[0];}
function visibility(properties:Node):Node{
  const found=properties.children.filter(n=>n.tag==='Property'&&n.attrs.name?.value==='Visibility');
  if(found.length!==1||found[0].attrs.type?.value!=='App::PropertyBool'||found[0].children.length!==1)fail();
  const bool=one(found[0],'Bool');if(!['true','1'].includes(bool.attrs.value?.value))fail();return found[0];
}
function replaced(text:string,at:{start:number;end:number},value:string){return text.slice(0,at.start)+value+text.slice(at.end);}
function packed(files:Record<string,Uint8Array>,name?:string,replacement?:string):Buffer{
  const result:Record<string,Uint8Array>=Object.create(null);
  for(const [key,bytes] of Object.entries(files)){
    if(key===name){if(replacement!==undefined)result[key]=Buffer.from(replacement);}
    else result[key]=bytes;
  }
  return Buffer.from(zipSync(result,{level:6}));
}

export function buildSyntheticVisibilityVariants(guiVisible:Uint8Array):{
  withoutGui:Buffer;guiHidden:Buffer;missingVisibility:Buffer;invalidVisibility:Buffer;
}{
  const files=archive(guiVisible),document=xml(files['Document.xml']),gui=xml(files['GuiDocument.xml']);
  if(document.root.tag!=='Document'||!['Document','GuiDocument'].includes(gui.root.tag))fail();
  const objects=one(document.root,'Objects'),data=one(document.root,'ObjectData');
  if(objects.attrs.Count?.value!=='1'||data.attrs.Count?.value!=='1'||data.children.length!==1)fail();
  const deps=objects.children.filter(n=>n.tag==='ObjectDeps');
  if(objects.children.some(n=>!['Object','ObjectDeps'].includes(n.tag))||deps.length>1
    ||objects.attrs.Dependencies&&(objects.attrs.Dependencies.value!==String(deps.length))
    ||deps.some(n=>n.attrs.Name?.value!=='Shape'||n.attrs.Count?.value!=='0'||n.children.length
      ||document.text.slice(n.openEnd,n.closeStart).trim()||Object.keys(n.attrs).some(key=>!['Name','Count'].includes(key))))fail();
  const declaration=one(objects,'Object'),object=one(data,'Object');
  if(declaration.attrs.name?.value!=='Shape'||declaration.attrs.type?.value!=='Part::Feature'||object.attrs.name?.value!=='Shape')fail();
  const properties=one(object,'Properties'),visible=visibility(properties),bool=one(visible,'Bool');
  const shapes=properties.children.filter(n=>n.attrs.name?.value==='Shape');
  if(shapes.length!==1||shapes[0].attrs.type?.value!=='Part::PropertyPartShape'||shapes[0].children.some(n=>!['Part','ElementMap'].includes(n.tag)))fail();
  const maps=shapes[0].children.filter(n=>n.tag==='ElementMap');
  if(maps.length>1||maps.some(n=>Object.keys(n.attrs).length||n.children.length||document.text.slice(n.openEnd,n.closeStart).trim()))fail();
  const brp=one(shapes[0],'Part').attrs.file?.value;
  if(!brp||!/^[A-Za-z0-9_.-]+\.brp$/.test(brp)||!files[brp]?.length)fail();
  const providers=one(gui.root,'ViewProviderData');
  if(providers.attrs.Count?.value!=='1'||providers.children.length!==1)fail();
  const provider=one(providers,'ViewProvider');if(provider.attrs.name?.value!=='Shape')fail();
  const guiBool=one(visibility(one(provider,'Properties')),'Bool');
  const withoutGui=packed(files,'GuiDocument.xml'),guiHidden=packed(files,'GuiDocument.xml',replaced(gui.text,guiBool.attrs.value,'false'));
  const noGuiFiles={...files};delete noGuiFiles['GuiDocument.xml'];
  // Edit from right to left so Count's original range remains bound even when
  // the removed Visibility property follows it by many unrelated properties.
  const missingText=replaced(replaced(document.text,{start:visible.start,end:visible.end},''),properties.attrs.Count,String(Number(properties.attrs.Count.value)-1));
  return {withoutGui,guiHidden,missingVisibility:packed(noGuiFiles,'Document.xml',missingText),
    invalidVisibility:packed(noGuiFiles,'Document.xml',replaced(document.text,bool.attrs.value,'not-a-bool'))};
}
