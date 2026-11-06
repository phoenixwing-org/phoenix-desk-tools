import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';

export const WORKER_PNG_MAX_BYTES = 4 * 1024 * 1024;
export interface WorkerPngExpectation {width:number;height:number;sha256:string;bytes:number}
export class WorkerPngError extends Error {
  readonly code = 'worker_png_invalid';
  constructor(){super('缩略图未通过完整 PNG、尺寸、摘要及元数据边界核验');this.name='WorkerPngError';}
}
const invalid=():never=>{throw new WorkerPngError();};
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const table=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let n=0;n<8;n++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc(bytes:Buffer,start:number,end:number){let value=0xffffffff;for(let n=start;n<end;n++)value=table[(value^bytes[n])&255]^(value>>>8);return (value^0xffffffff)>>>0;}
const colours=new Set(['gAMA','cHRM','sRGB','sBIT','tRNS']);
const srgb=[31270,32900,64000,33000,30000,60000,15000,6000];
function colourField(kind:string,data:Buffer,colour:number){
  if(kind==='gAMA'){if(data.length!==4||!data.readUInt32BE(0)||data.readUInt32BE(0)>0x7fffffff)invalid();}
  else if(kind==='cHRM'){
    if(data.length!==32)invalid();
    for(let n=0;n<32;n+=8){const x=data.readUInt32BE(n),y=data.readUInt32BE(n+4);if(x>100000||y>100000||x+y>100000)invalid();}
  }else if(kind==='sRGB'){if(data.length!==1||data[0]>3)invalid();}
  else if(kind==='sBIT'){if(data.length!==(colour===2?3:4)||data.some(value=>value<1||value>8))invalid();}
  else if(kind==='tRNS'){
    if(colour!==2||data.length!==6)invalid();
    for(let n=0;n<6;n+=2)if(data.readUInt16BE(n)>255)invalid();
  }else invalid();
}
function validate(input:Uint8Array,expected:WorkerPngExpectation):Buffer {
  if(!(input instanceof Uint8Array)||!expected||typeof expected!=='object'
    ||!Number.isSafeInteger(expected.width)||expected.width<1||expected.width>1024
    ||!Number.isSafeInteger(expected.height)||expected.height<1||expected.height>1024
    ||!Number.isSafeInteger(expected.bytes)||expected.bytes<1||expected.bytes>WORKER_PNG_MAX_BYTES
    ||typeof expected.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.sha256)
    ||input.byteLength!==expected.bytes||input.byteLength>WORKER_PNG_MAX_BYTES)invalid();
  const bytes=Buffer.from(input);
  if(bytes.length<45||!bytes.subarray(0,8).equals(signature)
    ||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)invalid();
  const seen=new Set<string>(),fields=new Map<string,Buffer>(),data:Buffer[]=[];
  let offset=8,count=0,idat=false,idatEnded=false,ended=false,rowBytes=0,colour=0;
  while(offset<bytes.length){
    if(++count>4096||bytes.length-offset<12)invalid();
    const length=bytes.readUInt32BE(offset),typeStart=offset+4,payload=offset+8;
    if(length>0x7fffffff||length>bytes.length-offset-12)invalid();
    const payloadEnd=payload+length,end=payloadEnd+4;
    for(let n=typeStart;n<payload;n++)if(!(bytes[n]>=65&&bytes[n]<=90||bytes[n]>=97&&bytes[n]<=122))invalid();
    const kind=bytes.toString('ascii',typeStart,payload);
    if(bytes[typeStart+2]&32||crc(bytes,typeStart,payloadEnd)!==bytes.readUInt32BE(payloadEnd)
      ||!seen.size&&kind!=='IHDR')invalid();
    if(idat&&kind!=='IDAT')idatEnded=true;
    const contents=bytes.subarray(payload,payloadEnd);
    if(kind==='IHDR'){
      if(seen.size||length!==13||contents.readUInt32BE(0)!==expected.width||contents.readUInt32BE(4)!==expected.height
        ||contents[8]!==8||![2,6].includes(contents[9])||contents[10]||contents[11]||contents[12])invalid();
      colour=contents[9];rowBytes=expected.width*(colour===2?3:4)+1;
    }else if(kind==='PLTE'){
      if(seen.has(kind)||idat||seen.has('tRNS')||length<3||length>768||length%3)invalid();
    }else if(kind==='IDAT'){
      if(idatEnded)invalid();idat=true;data.push(contents);
    }else if(kind==='IEND'){
      if(length||!idat||end!==bytes.length)invalid();ended=true;
    }else if(colours.has(kind)){
      if(seen.has(kind)||idat||kind!=='tRNS'&&seen.has('PLTE'))invalid();
      colourField(kind,contents,colour);fields.set(kind,contents);
    }else{
      // The producer promises sanitized output. Metadata, APNG, unknown colour
      // interpretations and unknown critical chunks are refused, not silently
      // discarded after their hash has already been attested.
      invalid();
    }
    seen.add(kind);offset=end;if(ended)break;
  }
  if(!ended||!rowBytes)invalid();
  if(fields.has('sRGB')){
    if(fields.has('gAMA')&&fields.get('gAMA')!.readUInt32BE(0)!==45455)invalid();
    if(fields.has('cHRM')&&srgb.some((value,index)=>fields.get('cHRM')!.readUInt32BE(index*4)!==value))invalid();
  }
  const compressed=Buffer.concat(data),length=rowBytes*expected.height;
  const result=inflateSync(compressed,{info:true,maxOutputLength:length}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
  if(!Buffer.isBuffer(result.buffer)||result.buffer.length!==length||result.engine?.bytesWritten!==compressed.length)invalid();
  for(let n=0;n<length;n+=rowBytes)if(result.buffer[n]>4)invalid();
  return bytes;
}
/** Own the returned bytes and revalidate the fixed sanitized worker profile.
 * This proves PNG structure, not the image's visual or semantic correctness. */
export function validateWorkerPng(input:Uint8Array,expected:WorkerPngExpectation):Buffer {
  try{return validate(input,expected);}catch{throw new WorkerPngError();}
}
