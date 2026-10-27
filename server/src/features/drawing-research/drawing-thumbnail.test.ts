import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {crc32,deflateSync} from 'node:zlib';
import {afterEach,expect,it} from 'vitest';
import {fcstdFingerprint} from '../../lib/fcstdBatchFiles.js';
import {readDrawingThumbnail,validateDrawingThumbnail} from './drawing-thumbnail.js';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
// Independent two-pixel PNGs, not drawings/geometric samples. Node's native CRC
// makes the fixture independent of the production portable CRC implementation.
function png(colors:number[][]=[[255,255,255,255],[0,0,0,255]],filter=0){
 const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(colors.length,0);head.writeUInt32BE(1,4);head[8]=8;head[9]=6;
 const pixels=colors.flat(),encoded=pixels.map((value,i)=>{const a=i>=4?pixels[i-4]:0;return (value-(filter===1||filter===4?a:filter===3?Math.floor(a/2):0)+256)%256;});
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.from([filter,...encoded]))),chunk('IEND',Buffer.alloc(0))]);
}
it('validates container/CRC/hash and actual visible nonuniform pixels, not only PNG header dimensions',()=>{const bytes=png();expect(validateDrawingThumbnail(bytes)).toMatchObject({width:2,height:1,sha256:fcstdFingerprint(bytes)});});
it.each([['white',[[255,255,255,255],[255,255,255,255]]],['solid-color',[[4,5,6,255],[4,5,6,255]]],['transparent',[[0,0,0,0],[120,90,2,0]]]])('rejects %s empty paper even when compressed PNG is valid',(_name,colors)=>{expect(()=>validateDrawingThumbnail(png(colors))).toThrow(/单色|空白/);});
it.each(['crc','truncated','trailing'])('rejects %s container corruption',mode=>{let bytes=png();if(mode==='crc')bytes[20]^=1;else if(mode==='truncated')bytes=bytes.subarray(0,-2);else bytes=Buffer.concat([bytes,Buffer.from([1])]);expect(()=>validateDrawingThumbnail(bytes)).toThrow();});
it('refuses unsupported pixel profiles and oversized input before inflation',()=>{const bytes=png();expect(()=>validateDrawingThumbnail(Buffer.alloc(4*1024*1024+1))).toThrow(/4MiB/);bytes[28]=1;expect(()=>validateDrawingThumbnail(bytes)).toThrow();});
it.each([0,1,2,3,4])('decodes PNG filter %s before determining visible page content',filter=>{expect(validateDrawingThumbnail(png([[255,255,255,255],[0,0,0,255]],filter)).width).toBe(2);});
it('reads a fixed regular file, binds exact raw bytes hash and refuses symlinks',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'independent-page-png-'));roots.push(root);const file=path.join(root,'page.png'),bytes=png();fs.writeFileSync(file,bytes);expect(readDrawingThumbnail(file,fcstdFingerprint(bytes)).bytes).toEqual(bytes);expect(()=>readDrawingThumbnail(file,'0'.repeat(64))).toThrow(/散列不符/);const link=path.join(root,'link.png');fs.symlinkSync(file,link);expect(()=>readDrawingThumbnail(link,fcstdFingerprint(bytes))).toThrow();});
