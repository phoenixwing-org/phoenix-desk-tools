import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {describe,expect,it} from 'vitest';
import {validateWorkerPng,WorkerPngError} from './worker-png.js';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function crc(bytes:Buffer){let v=0xffffffff;for(const byte of bytes){v^=byte;for(let n=0;n<8;n++)v=v&1?(v>>>1)^0xedb88320:v>>>1;}return (v^0xffffffff)>>>0;}
function chunk(kind:string,contents:Buffer){const result=Buffer.alloc(contents.length+12);result.writeUInt32BE(contents.length);result.write(kind,4,'ascii');contents.copy(result,8);result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4);return result;}
function png(options:{width?:number;height?:number;colour?:number;pixels?:Buffer;compressed?:Buffer;before?:Buffer[];middle?:Buffer[];after?:Buffer[];extra?:Buffer}={}){
  const {width=2,height=1,colour=6}=options,head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=colour;
  const compressed=options.compressed??deflateSync(options.pixels??Buffer.alloc((width*(colour===2?3:4)+1)*height));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),...(options.before??[]),chunk('IDAT',compressed),...(options.middle??[]),...(options.after??[]),chunk('IEND',Buffer.alloc(0)),...(options.extra?[options.extra]:[])]);
}
const expectation=(bytes:Buffer,width=2,height=1)=>({width,height,sha256:sha(bytes),bytes:bytes.length});
function reject(bytes:Buffer,width=2,height=1){expect(()=>validateWorkerPng(bytes,expectation(bytes,width,height))).toThrow(WorkerPngError);}
describe('fixed sanitized worker PNG boundary',()=>{
  it.each([2,6])('fully validates native truecolour %s without aliasing input',colour=>{const bytes=png({colour}),result=validateWorkerPng(bytes,expectation(bytes));expect(result.equals(bytes)).toBe(true);bytes.fill(0);expect(result[0]).toBe(137);});
  it('accepts the exact maximum dimensions with bounded decompression',()=>{const bytes=png({width:1024,height:1024});expect(validateWorkerPng(bytes,expectation(bytes,1024,1024))).toEqual(bytes);});
  it('preserves valid fixed colour fields',()=>{const bytes=png({before:[chunk('sRGB',Buffer.from([0])),chunk('gAMA',Buffer.from([0,0,177,143])),chunk('sBIT',Buffer.from([8,8,8,8]))]});expect(validateWorkerPng(bytes,expectation(bytes))).toEqual(bytes);});
  it.each(['tEXt','zTXt','iTXt','eXIf','pHYs','iCCP','acTL','fcTL','fdAT','ABCD','abCd'])('rejects non-profile chunk %s even with a valid CRC',kind=>reject(png({before:[chunk(kind,Buffer.from('independent metadata'))]})));
  it('rejects bad CRC despite a matching outer hash',()=>{const bytes=png();bytes[29]^=1;reject(bytes);});
  it('rejects high-bit chunk-name aliases and reserved bits',()=>{const c=chunk('sBIT',Buffer.from([8,8,8,8]));c[4]|=128;c.writeUInt32BE(crc(c.subarray(4,-4)),c.length-4);reject(png({before:[c]}));reject(png({before:[chunk('sBiT',Buffer.from([8,8,8,8]))]}));});
  it.each([0,1,3,4])('rejects unsupported colour type %s',colour=>reject(png({colour})));
  it('rejects malformed, truncated and concatenated zlib streams',()=>{reject(png({compressed:Buffer.from('invalid')}));const compressed=deflateSync(Buffer.alloc(9));reject(png({compressed:compressed.subarray(0,-1)}));reject(png({compressed:Buffer.concat([compressed,compressed])}));reject(png({compressed:Buffer.concat([compressed,Buffer.from([0])])}));});
  it('rejects invalid scanline filters, expanded size mismatch and decompression bombs',()=>{reject(png({pixels:Buffer.from([5,0,0,0,0,0,0,0,0])}));reject(png({pixels:Buffer.alloc(8)}));reject(png({pixels:Buffer.alloc(10)}));reject(png({pixels:Buffer.alloc(1024*1024)}));});
  it('rejects trailing bytes, duplicate header, nonconsecutive IDAT and absent IEND',()=>{reject(png({extra:Buffer.from([0])}));const normal=png();reject(Buffer.concat([normal.subarray(0,33),normal.subarray(8)]));reject(png({middle:[chunk('sBIT',Buffer.from([8,8,8,8])),chunk('IDAT',deflateSync(Buffer.alloc(9)))]}));reject(normal.subarray(0,-12));});
  it('checks claimed dimensions, length and digest independently',()=>{const bytes=png(),e=expectation(bytes);for(const patch of [{width:3},{height:2},{width:1025},{width:0},{bytes:e.bytes+1},{sha256:'0'.repeat(64)},{sha256:'A'.repeat(64)}])expect(()=>validateWorkerPng(bytes,{...e,...patch})).toThrow(WorkerPngError);});
  it('rejects inconsistent colour metadata and invalid transparency',()=>{reject(png({before:[chunk('sRGB',Buffer.from([4]))]}));reject(png({before:[chunk('sRGB',Buffer.from([0])),chunk('gAMA',Buffer.from([0,0,0,1]))]}));reject(png({before:[chunk('tRNS',Buffer.alloc(6))]}));reject(png({before:[chunk('sBIT',Buffer.from([8,8,9,8]))]}));});
  it('uses bounded safe errors for invalid inputs',()=>{for(const input of [null,{},'private provider text'])expect(()=>validateWorkerPng(input as Uint8Array,{width:1,height:1,bytes:1,sha256:'0'.repeat(64)})).toThrow('缩略图未通过');});
});
