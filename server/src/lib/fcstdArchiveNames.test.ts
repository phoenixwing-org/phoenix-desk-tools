import {describe,it,expect} from 'vitest';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {repairFcstdIncludedNames,makeFcstdIncludedNamesPortable} from './fcstdArchiveNames.js';
describe('native FreeCAD embedded filenames',()=>{
 it('repairs unflagged UTF-8 member names before recompressing',()=>{
  const name='测试框.svg',content=strToU8('<svg/>');const raw=zipSync({[name]:content});
  // Simulate the native writer: names contain UTF-8 bytes, flag 11 is clear.
  for(let i=0;i<raw.length-8;i++){const signature=new DataView(raw.buffer).getUint32(i,true);if(signature===0x04034b50)raw[i+7]&=~8;if(signature===0x02014b50)raw[i+9]&=~8;}
  const files=unzipSync(raw);expect(files[name]).toBeUndefined();
  repairFcstdIncludedNames(files,`<FileIncluded file="${name}"/>`);
  const reopened=unzipSync(zipSync(files));expect(reopened[name]).toEqual(content);expect(Object.keys(reopened)).toEqual([name]);
 });
 it('keeps a renamed template before later resources and GUI data',()=>{
  const name='示例框.svg', xml=`<FileIncluded file="${name}"/>`;
  const raw=zipSync({'Document.xml':strToU8(xml),[name]:strToU8('<svg/>'),'Shape.brp':strToU8('shape'),'GuiDocument.xml':strToU8('<gui/>'),'thumbnails/Thumbnail.png':new Uint8Array([1])});
  for(let i=0;i<raw.length-8;i++){const signature=new DataView(raw.buffer).getUint32(i,true);if(signature===0x04034b50)raw[i+7]&=~8;if(signature===0x02014b50)raw[i+9]&=~8;}
  const files=unzipSync(raw), result=makeFcstdIncludedNamesPortable(files,xml);
  expect(Object.keys(unzipSync(zipSync(files)))).toEqual(['Document.xml','EmbeddedResource1.svg','Shape.brp','GuiDocument.xml','thumbnails/Thumbnail.png']);
  expect(result.xml).toBe('<FileIncluded file="EmbeddedResource1.svg"/>');
  expect(files['EmbeddedResource1.svg']).toEqual(strToU8('<svg/>'));
  expect(makeFcstdIncludedNamesPortable(files,result.xml).repairs).toEqual([]);
 });
 it('refuses a missing included template rather than making a blank drawing',()=>{expect(()=>repairFcstdIncludedNames({},'<FileIncluded file="frame.svg"/>')).toThrow(/缺失/);});
});
