/** Static program, not assembled from document content. The private child pins
 * each parent using its process-local CWD before reading a leaf. Node lacks a
 * portable openat API, and Darwin /dev/fd directories cannot be traversed. */
export const COMPANION_READ_WORKER = String.raw`
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const {TextDecoder} = require('node:util');
const issue = code => { const error = new Error(code); error.safeCode = code; throw error; };
const identity = stat => [String(stat.dev), String(stat.ino)];
const sameIdentity = (a,b) => identity(a).join(':') === identity(b).join(':');
const stamp = stat => [String(stat.dev),String(stat.ino),String(stat.size),String(stat.mtimeNs),String(stat.ctimeNs)];
const sameStamp = (a,b) => stamp(a).join(':') === stamp(b).join(':');
const stat = name => fs.lstatSync(name,{bigint:true});
try {
  const input = fs.readFileSync(0,'utf8');
  if(Buffer.byteLength(input)>32768)issue('limit');
  const spec = JSON.parse(input);
  if(!spec || !['read','list'].includes(spec.mode) || typeof spec.rel!=='string')issue('unsafe');
  const root = stat('.');
  if(!root.isDirectory() || !Array.isArray(spec.rootIdentity) || identity(root).join(':')!==spec.rootIdentity.join(':'))issue('changed');
  if(root.ino===0n)issue('unsafe');
  const parts = spec.rel===''?[]:spec.rel.split('/');
  if(parts.some(part=>!part || part==='.' || part==='..' || part.startsWith('.') || ['node_modules','__pycache__'].includes(part) || /[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(part)))issue('unsafe');
  const parents = spec.mode==='read'?parts.slice(0,-1):parts;
  for(const part of parents){
    const before = stat(part);
    if(!before.isDirectory() || before.isSymbolicLink())issue('unsafe');
    process.chdir(part);
    const pinned = stat('.');
    if(!pinned.isDirectory() || !sameIdentity(before,pinned))issue('changed');
  }
  if(spec.mode==='list'){
    if(!Number.isSafeInteger(spec.limit) || spec.limit<0 || spec.limit>2000)issue('limit');
    const before = stat('.'), dir=fs.opendirSync('.',{encoding:'buffer'}), names=[], seen=new Set();let complete=true;
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    try{
      let entry;
      while((entry=dir.readSync())){
        if(names.length>=spec.limit){complete=false;break;}
        // Never let Node's default replacement decoding collapse distinct
        // on-disk byte names into one discovered candidate.
        if(!Buffer.isBuffer(entry.name))issue('invalid_encoding');
        let name;
        try{name=decoder.decode(entry.name);}catch{issue('invalid_encoding');}
        if(!Buffer.from(name,'utf8').equals(entry.name))issue('invalid_encoding');
        if(seen.has(name))issue('unsafe');
        seen.add(name);names.push(name);
      }
    }finally{dir.closeSync();}
    if(!sameStamp(before,stat('.')))issue('changed');
    names.sort();
    const proof=crypto.createHash('sha256').update(JSON.stringify([stamp(before),complete,names])).digest('hex');
    process.stdout.write(JSON.stringify({names,complete,proof}));
  }else{
    if(!parts.length || !Number.isSafeInteger(spec.maxBytes) || spec.maxBytes<0 || spec.maxBytes>67108864)issue('limit');
    const leaf=parts[parts.length-1], before=stat(leaf);
    if(!before.isFile() || before.isSymbolicLink())issue('unsafe');
    if(before.size>BigInt(spec.maxBytes))issue('limit');
    const fd=fs.openSync(leaf,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      if(!sameStamp(before,fs.fstatSync(fd,{bigint:true})))issue('changed');
      const data=Buffer.alloc(Number(before.size)+1);let length=0;
      while(length<data.length){const amount=fs.readSync(fd,data,length,Math.min(65536,data.length-length),length);if(!amount)break;length+=amount;}
      if(BigInt(length)!==before.size || !sameStamp(before,fs.fstatSync(fd,{bigint:true})) || !sameStamp(before,stat(leaf)))issue('changed');
      const bytes=data.subarray(0,length);
      process.stdout.write(JSON.stringify({bytes:length,data:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
    }finally{fs.closeSync(fd);}
  }
}catch(error){
  const code=['unsafe','unreadable','invalid_encoding','changed','cancelled','limit'].includes(error.safeCode)?error.safeCode:'unreadable';
  process.stdout.write(JSON.stringify({error:code}));process.exitCode=1;
}
`;
