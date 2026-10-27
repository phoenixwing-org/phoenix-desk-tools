/** Static, private Node helper. Darwin has no traversable /dev/fd directory and
 * Node has no portable openat: all writes stay relative to child-local pinned CWD. */
export const BATCH_MIGRATION_WRITE_WORKER=String.raw`
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const max=32*1024*1024;
const issue=()=>{throw new Error('migration_backup_failed');};
const stat=name=>fs.lstatSync(name,{bigint:true});
const identity=s=>[String(s.dev),String(s.ino)];
const stamp=s=>[...identity(s),String(s.size),String(s.mtimeNs),String(s.ctimeNs),String(s.nlink)];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const same=(a,b)=>equal(stamp(a),stamp(b));
const safeDirectory=s=>s.isDirectory()&&!s.isSymbolicLink();
let fd,dirfd,parentfd;
try{
 const raw=fs.readFileSync(0,'utf8');if(Buffer.byteLength(raw)>max+4096)issue();
 const spec=JSON.parse(raw);
 if(!spec||Object.keys(spec).some(key=>!['rootIdentity','parentIdentity','basename','backup','bytes','sha256'].includes(key))
  ||!Array.isArray(spec.rootIdentity)||!Array.isArray(spec.parentIdentity)||typeof spec.basename!=='string'
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(spec.basename)
  ||!Number.isSafeInteger(spec.bytes)||spec.bytes<1||spec.bytes>max||!/^[a-f0-9]{64}$/.test(spec.sha256))issue();
 const root=stat('.');if(!safeDirectory(root)||!equal(identity(root),spec.rootIdentity))issue();
 const parent=stat('.phoenix');if(!safeDirectory(parent)||!equal(identity(parent),spec.parentIdentity))issue();
 process.chdir('.phoenix');if(!equal(identity(stat('.')),spec.parentIdentity))issue();
 try{fs.mkdirSync('batch-task-migrations',{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const directory=stat('batch-task-migrations');if(!safeDirectory(directory))issue();
 // Persist the new directory entry while still pinned in its parent. Syncing
 // only the child directory cannot make its name durable in .phoenix.
 parentfd=fs.openSync('.',fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_DIRECTORY);
 const durableParent=fs.fstatSync(parentfd,{bigint:true});
 if(!durableParent.isDirectory()||!equal(identity(durableParent),spec.parentIdentity))issue();
 fs.fsyncSync(parentfd);
 if(!equal(identity(fs.fstatSync(parentfd,{bigint:true})),spec.parentIdentity)||!equal(identity(stat('.')),spec.parentIdentity))issue();
 fs.closeSync(parentfd);parentfd=undefined;
 process.chdir('batch-task-migrations');if(!equal(identity(stat('.')),identity(directory)))issue();
 const backup=spec.backup;
 if(!backup||backup.format!=='desk-batch-tasks-backup'||![1,2].includes(backup.version)||backup.schema_version!==backup.version||!/^[a-f0-9]{64}$/.test(backup.checksum))issue();
 const payload=JSON.stringify(backup),bytes=Buffer.from(payload,'utf8');
 if(bytes.length!==spec.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==spec.sha256
  ||crypto.createHash('sha256').update(JSON.stringify(backup.data)).digest('hex')!==backup.checksum)issue();
 fd=fs.openSync(spec.basename,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW|fs.constants.O_RDWR,0o600);
 const opened=fs.fstatSync(fd,{bigint:true});if(!opened.isFile()||opened.nlink!==1n)issue();
 fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);
 const before=fs.fstatSync(fd,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size!==BigInt(spec.bytes))issue();
 const data=Buffer.alloc(spec.bytes+1);let length=0;
 while(length<data.length){const amount=fs.readSync(fd,data,length,Math.min(65536,data.length-length),length);if(!amount)break;length+=amount;}
 const after=fs.fstatSync(fd,{bigint:true}),named=stat(spec.basename);
 if(length!==spec.bytes||!same(before,after)||!same(after,named)||named.isSymbolicLink()||named.nlink!==1n
  ||!data.subarray(0,length).equals(bytes)||crypto.createHash('sha256').update(data.subarray(0,length)).digest('hex')!==spec.sha256)issue();
 const verified=JSON.parse(data.subarray(0,length).toString('utf8'));
 if(crypto.createHash('sha256').update(JSON.stringify(verified.data)).digest('hex')!==backup.checksum)issue();
 dirfd=fs.openSync('.',fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_DIRECTORY);fs.fsyncSync(dirfd);
 if(!equal(identity(fs.fstatSync(dirfd,{bigint:true})),identity(directory))||!same(after,fs.fstatSync(fd,{bigint:true}))||!same(after,stat(spec.basename)))issue();
 fs.closeSync(fd);fd=undefined;fs.closeSync(dirfd);dirfd=undefined;
 process.stdout.write(JSON.stringify({ok:true,basename:spec.basename,sha256:spec.sha256,bytes:spec.bytes,directoryIdentity:identity(directory),fileStamp:stamp(after)}));
}catch{
 try{if(fd!==undefined)fs.closeSync(fd);}catch{}
 try{if(dirfd!==undefined)fs.closeSync(dirfd);}catch{}
 try{if(parentfd!==undefined)fs.closeSync(parentfd);}catch{}
 process.stdout.write(JSON.stringify({error:'migration_backup_failed'}));process.exitCode=1;
}
`;
