import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {BATCH_MIGRATION_WRITE_WORKER} from './migration-worker.js';
const roots:string[]=[];
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
function fixture(version:1|2=1){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-batch-migration-worker-')));roots.push(root);fs.mkdirSync(path.join(root,'.phoenix'));
 const identity=(name:string)=>{const s=fs.lstatSync(name,{bigint:true});return [String(s.dev),String(s.ino)];};
 const data={tasks:[],plans:[],runs:[]},backup={format:'desk-batch-tasks-backup',version,schema_version:version,created_at:'2026-01-01T00:00:00.000Z',checksum:hash(JSON.stringify(data)),data},payload=JSON.stringify(backup);
 return {root,payload,spec:{rootIdentity:identity(root),parentIdentity:identity(path.join(root,'.phoenix')),basename:'11111111-1111-4111-8111-111111111111.json',backup,bytes:Buffer.byteLength(payload),sha256:hash(payload)}};
}
function run(root:string,spec:unknown,program=BATCH_MIGRATION_WRITE_WORKER){return JSON.parse(childProcess.execFileSync(process.execPath,['--input-type=commonjs','--eval',program],{cwd:root,env:{},input:JSON.stringify(spec),encoding:'utf8',timeout:10_000,maxBuffer:4096,stdio:['pipe','pipe','pipe']}));}
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('static migration backup write worker',()=>{
 it.each([1,2] as const)('writes a complete verified version%s artifact through pinned child cwd',version=>{const f=fixture(version),response=run(f.root,f.spec),filename=path.join(f.root,'.phoenix','batch-task-migrations',f.spec.basename);expect(response).toMatchObject({ok:true,basename:f.spec.basename,bytes:f.spec.bytes,sha256:f.spec.sha256});expect(fs.readFileSync(filename,'utf8')).toBe(f.payload);expect(fs.lstatSync(filename).mode&0o777).toBe(0o600);});
 it.each(['file','hardlink','symlink'] as const)('never overwrites a pre-existing %s backup leaf',kind=>{const f=fixture(),directory=path.join(f.root,'.phoenix','batch-task-migrations');fs.mkdirSync(directory);const source=path.join(f.root,'synthetic-protected.txt'),target=path.join(directory,f.spec.basename);fs.writeFileSync(source,'keep original');if(kind==='file')fs.writeFileSync(target,'existing');else if(kind==='hardlink')fs.linkSync(source,target);else fs.symlinkSync(source,target);expect(()=>run(f.root,f.spec)).toThrow();expect(fs.readFileSync(source,'utf8')).toBe('keep original');expect(fs.readFileSync(target,'utf8')).toBe(kind==='file'?'existing':'keep original');});
 it.each(['root','parent'] as const)('rejects an unmatched %s inode before creating artifacts',part=>{const f=fixture();if(part==='root')f.spec.rootIdentity=['0','0'];else f.spec.parentIdentity=['0','0'];expect(()=>run(f.root,f.spec)).toThrow();expect(fs.existsSync(path.join(f.root,'.phoenix','batch-task-migrations'))).toBe(false);});
 it('rejects pathname syntax, wrong whole-file digest and wrong logical checksum',()=>{for(const bad of ['path','hash','checksum']){const f=fixture();if(bad==='path')f.spec.basename='../outside.json';if(bad==='hash')f.spec.sha256='0'.repeat(64);if(bad==='checksum'){f.spec.backup.checksum='0'.repeat(64);const payload=JSON.stringify(f.spec.backup);f.spec.bytes=Buffer.byteLength(payload);f.spec.sha256=hash(payload);}expect(()=>run(f.root,f.spec)).toThrow();expect(fs.existsSync(path.join(f.root,'outside.json'))).toBe(false);}});
 it('reads the complete EOF and rejects a real fsync-time trailing append',()=>{const f=fixture(),program=String.raw`const fsHook=require('node:fs'),realSync=fsHook.fsyncSync;let appended=false;fsHook.fsyncSync=fd=>{realSync(fd);const s=fsHook.fstatSync(fd);if(!appended&&s.isFile()){appended=true;fsHook.writeSync(fd,Buffer.from('X'),0,1,s.size);realSync(fd);}};`+BATCH_MIGRATION_WRITE_WORKER;expect(()=>run(f.root,f.spec,program)).toThrow();const artifact=fs.readFileSync(path.join(f.root,'.phoenix','batch-task-migrations',f.spec.basename),'utf8');expect(artifact).toBe(f.payload+'X');expect(()=>JSON.parse(artifact)).toThrow();});
 it('syncs the pinned parent before the backup file and child directory, then closes every owned fd',()=>{
  const f=fixture(),program=String.raw`const fsHook=require('node:fs'),realOpen=fsHook.openSync,realClose=fsHook.closeSync,realSync=fsHook.fsyncSync,write=process.stdout.write.bind(process.stdout),owned=new Set(),order=[];
  fsHook.openSync=function(name,...args){const fd=realOpen(name,...args);owned.add(fd);return fd;};fsHook.closeSync=function(fd){realClose(fd);owned.delete(fd);};
  fsHook.fsyncSync=function(fd){const s=fsHook.fstatSync(fd);order.push(s.isFile()?'file':process.cwd().endsWith('/.phoenix')?'parent':'child');realSync(fd);};
  process.stdout.write=function(text){const result=JSON.parse(text);result.test_order=order;result.test_owned=owned.size;return write(JSON.stringify(result));};`+BATCH_MIGRATION_WRITE_WORKER;
  expect(run(f.root,f.spec,program)).toMatchObject({ok:true,test_order:['parent','file','child'],test_owned:0});
 });
 it('stops on a pinned parent fsync failure before creating a backup file and closes that fd',()=>{
  const f=fixture(),program=String.raw`const fsHook=require('node:fs'),realOpen=fsHook.openSync,realClose=fsHook.closeSync,realSync=fsHook.fsyncSync,write=process.stdout.write.bind(process.stdout),owned=new Set();
  fsHook.openSync=function(name,...args){const fd=realOpen(name,...args);owned.add(fd);return fd;};fsHook.closeSync=function(fd){realClose(fd);owned.delete(fd);};
  fsHook.fsyncSync=function(fd){if(fsHook.fstatSync(fd).isDirectory()&&process.cwd().endsWith('/.phoenix'))throw new Error('Synthetic parent sync failure');realSync(fd);};
  process.stdout.write=function(text){const result=JSON.parse(text);result.test_owned=owned.size;return write(JSON.stringify(result));};`+BATCH_MIGRATION_WRITE_WORKER;
  let response:unknown;try{run(f.root,f.spec,program);expect.fail('Expected sync rejection');}catch(error){response=JSON.parse(String((error as {stdout?:unknown}).stdout));}
  expect(response).toEqual({error:'migration_backup_failed',test_owned:0});expect(fs.readdirSync(path.join(f.root,'.phoenix','batch-task-migrations'))).toEqual([]);
 });
});
