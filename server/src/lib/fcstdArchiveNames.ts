/** ZIP entry order is part of the FCStd format: XMLReader::readFiles walks
 * registered resources forwards only. Rename at the original slot, never append. */
function renameInPlace(files:Record<string,Uint8Array>,from:string,to:string){
 const entries=Object.entries(files).map(([name,bytes])=>[name===from?to:name,bytes] as const);
 for(const name of Object.keys(files))delete files[name];
 for(const [name,bytes] of entries)files[name]=bytes;
}

/** FreeCAD can write UTF-8 ZIP member bytes without the UTF-8 flag. fflate
 * then decodes those bytes as Latin-1. Resolve only names explicitly required
 * by FileIncluded, so legitimate Latin-1 filenames are never guessed globally. */
export function repairFcstdIncludedNames(files:Record<string,Uint8Array>,xml:string){
 const decode=(s:string)=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 const repaired:Array<{from:string;to:string}>=[];
 for(const m of xml.matchAll(/<FileIncluded\b[^>]*\bfile="([^"]+)"/g)){
  const expected=decode(m[1]);if(files[expected])continue;
  const matches=Object.keys(files).filter(name=>{
   if([...name].some(c=>c.charCodeAt(0)>255))return false;
   try{return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from([...name].map(c=>c.charCodeAt(0))))===expected;}catch{return false;}
  });
  if(matches.length!==1)throw new Error('FCStd内嵌资源缺失或歧义: '+expected);
  renameInPlace(files,matches[0],expected);repaired.push({from:matches[0],to:expected});
 }
 return repaired;
}

/** Canonical ASCII storage names avoid ambiguous unflagged UTF-8 decoding.
 * Preserve the original member order and all embedded content. */
export function makeFcstdIncludedNamesPortable(files:Record<string,Uint8Array>,xml:string){
 const repairs=repairFcstdIncludedNames(files,xml);
 let serial=0;
 const mappings=new Map<string,string>();
 const updated=xml.replace(/(<FileIncluded\b[^>]*\bfile=")([^"]+)(")/g,(all,prefix,raw,suffix)=>{
  if(!/[^\x00-\x7f]/.test(raw))return all;
  const expected=raw.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  let target=mappings.get(expected);
  if(!target){const ext=expected.match(/\.[A-Za-z0-9]+$/)?.[0]||'.bin';do{target='EmbeddedResource'+(++serial)+ext;}while(files[target]);renameInPlace(files,expected,target);mappings.set(expected,target);}
  return prefix+target+suffix;
 });
 return {xml:updated,repairs:[...repairs,...[...mappings].map(([from,to])=>({from,to}))]};
}
