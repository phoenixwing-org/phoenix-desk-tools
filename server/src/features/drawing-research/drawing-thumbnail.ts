import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {fcstdFingerprint} from '../../lib/fcstdBatchFiles.js';

const MAX_PNG=4*1024*1024,MAX_PIXELS=4*1024*1024;
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}return (crc^0xffffffff)>>>0;}
const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};

/** Native page renderer profile: bounded 8-bit, non-interlaced PNG. This proves
 * container integrity and nonuniform visible pixels, NOT engineering content,
 * frame correctness or visual quality (the native reopen/manual review do that). */
export function validateDrawingThumbnail(input:Uint8Array){
 const bytes=Buffer.from(input);if(bytes.length<45||bytes.length>MAX_PNG||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('图纸缩略图不是有效PNG或超过4MiB');
 let offset=8,width=0,height=0,channels=0,ended=false,dataStarted=false,dataEnded=false;const idat:Buffer[]=[];
 while(offset<bytes.length){
  if(offset+12>bytes.length)throw new Error('PNG块截断');const length=bytes.readUInt32BE(offset);if(length>MAX_PNG||offset+12+length>bytes.length)throw new Error('PNG块长度无效');
  const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,offset+8+length);if(!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(offset+4,offset+8+length))!==bytes.readUInt32BE(offset+8+length))throw new Error('PNG块校验失败');
  if(offset===8&&type!=='IHDR')throw new Error('PNG缺少首IHDR');
  if(type==='IHDR'){
   if(offset!==8||length!==13)throw new Error('PNG IHDR重复或无效');width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=({0:1,2:3,4:2,6:4}as Record<number,number>)[data[9]]||0;
   if(!width||!height||width>4096||height>4096||width*height>MAX_PIXELS||data[8]!==8||!channels||data[10]||data[11]||data[12])throw new Error('PNG不符合有界8-bit原生纸面渲染格式');
  }else if(type==='IDAT'){
   if(!channels||dataEnded)throw new Error('PNG IDAT顺序无效');dataStarted=true;idat.push(data);
  }else if(type==='IEND'){
   if(length||!dataStarted||offset+12!==bytes.length)throw new Error('PNG结束块无效或有尾随数据');ended=true;
  }else{
   if(dataStarted)dataEnded=true;
   // Palette/transparency profiles are not emitted by our ARGB page renderer.
   // Refuse rather than treating invisible pixels as actual drawing content.
   if(type==='PLTE'||type==='tRNS'||type[0]===type[0].toUpperCase())throw new Error('PNG包含未支持的原生渲染块');
  }
  offset+=length+12;if(ended)break;
 }
 if(!ended)throw new Error('PNG缺少结束块');const stride=width*channels,expected=(stride+1)*height;
 let raw:Buffer;try{raw=inflateSync(Buffer.concat(idat),{maxOutputLength:expected+1});}catch{throw new Error('PNG像素压缩流无效');}if(raw.length!==expected)throw new Error('PNG像素长度不符');
 let previous=Buffer.alloc(stride),first:number|undefined,nonuniform=false;
 for(let y=0;y<height;y++){
  const start=y*(stride+1),filter=raw[start];if(filter>4)throw new Error('PNG像素滤波器无效');const line=Buffer.alloc(stride);
  for(let x=0;x<stride;x++){const left=x>=channels?line[x-channels]:0,up=previous[x],corner=x>=channels?previous[x-channels]:0;line[x]=(raw[start+1+x]+(filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,corner):0))&255;}
  for(let x=0;x<stride;x+=channels){const gray=channels<=2,r=line[x],g=gray?r:line[x+1],b=gray?r:line[x+2],alpha=channels===2?line[x+1]:channels===4?line[x+3]:255;
   const composite=(c:number)=>Math.round((c*alpha+255*(255-alpha))/255),pixel=(composite(r)<<16)|(composite(g)<<8)|composite(b);if(first===undefined)first=pixel;else if(first!==pixel)nonuniform=true;
  }previous=line;
 }
 if(!nonuniform)throw new Error('图纸缩略图只有单色/空白纸面；未发布');return {bytes,width,height,sha256:fcstdFingerprint(bytes)};
}
/** Read exactly the fixed job output. No arbitrary report path is read. */
export function readDrawingThumbnail(file:string,expectedSha256:unknown){
 if(typeof expectedSha256!=='string'||!/^[0-9a-f]{64}$/.test(expectedSha256))throw new Error('图纸PNG散列未确认');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd);if(!before.isFile()||before.size>MAX_PNG)throw new Error('图纸PNG不是普通文件或超过4MiB');const bytes=Buffer.alloc(before.size+1);let size=0;
  while(size<bytes.length){const n=fs.readSync(fd,bytes,size,bytes.length-size,size);if(!n)break;size+=n;}const after=fs.fstatSync(fd);if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('图纸PNG在读取中变化');
  const result=validateDrawingThumbnail(bytes.subarray(0,size));if(result.sha256!==expectedSha256)throw new Error('图纸PNG与原生报告散列不符');return result;
 }finally{fs.closeSync(fd);}
}
