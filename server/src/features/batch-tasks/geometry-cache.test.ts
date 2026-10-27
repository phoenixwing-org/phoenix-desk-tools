import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import childProcess from 'node:child_process';
import {afterEach,expect,it,vi} from 'vitest';
import * as leases from '../../lib/cadSqliteReadLease.js';
import {GEOMETRY_CACHE_READ_LIMITS,readGeometryCacheSnapshot} from './geometry-cache.js';

// The port may import gallery types, never its cache-writing runtime entrypoints.
vi.mock('../part-gallery/geometryStorage.js',()=>{throw new Error('gallery geometry runtime must not load');});
vi.mock('../part-gallery/storage.js',()=>{throw new Error('gallery database runtime must not load');});

const roots:string[]=[],REL='parts/DEMO42.007P1-Bracket.FCStd',DB='.phoenix/phoenix-workspace.sqlite';
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const row=()=>({sources_json:JSON.stringify([{rel:REL,hash:'a'.repeat(64),stamp:'1:40:1000:1000'},{rel:'unselected/Dependency.FCStd',hash:'b'.repeat(64),stamp:'2:50:1000:1000'}]),
 box_json:JSON.stringify({x_mm:10,y_mm:20,z_mm:0}),algorithm_version:1,updated_at:'2026-01-01T00:00:00.000Z'});
function fixture(options:{database?:boolean;table?:boolean;record?:boolean;values?:Partial<ReturnType<typeof row>>}={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'geometry-cache-port-')));roots.push(root);
 fs.mkdirSync(path.join(root,'parts'));fs.writeFileSync(path.join(root,REL),'independent synthetic CAD bytes, never parsed or measured');
 const filename=path.join(root,DB);
 if(options.database!==false){
  fs.mkdirSync(path.dirname(filename));const db=new DatabaseSync(filename);
  if(options.table!==false){
   db.exec('CREATE TABLE desk_cad_geometry(rel TEXT PRIMARY KEY,sources_json TEXT,box_json TEXT,message TEXT,updated_at TEXT,algorithm_version INTEGER)');
   if(options.record!==false){const value={...row(),...options.values};db.prepare('INSERT INTO desk_cad_geometry VALUES(?,?,?,?,?,?)').run(REL,value.sources_json,value.box_json,'not fetched or returned',value.updated_at,value.algorithm_version);}
  }else db.exec('CREATE TABLE unrelated(secret TEXT)');
  db.close();
 }
 return {root,filename,lock:filename+'.lock',cad:path.join(root,REL)};
}
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

it('reports a missing database without creating .phoenix, a database or a lock',async()=>{
 const source=fixture({database:false}),before=fs.readdirSync(source.root);
 expect(await readGeometryCacheSnapshot(source.root,REL)).toEqual({rel:REL,freshness:'unverified',status:'missing',reason:'database_missing'});
 expect(fs.readdirSync(source.root)).toEqual(before);expect(fs.existsSync(source.filename)).toBe(false);expect(fs.existsSync(source.lock)).toBe(false);
});
it.each([{options:{table:false},reason:'table_missing'},{options:{record:false},reason:'row_missing'}] as const)('does not initialize a missing $reason',async({options,reason})=>{
 const source=fixture(options),before=hash(source.filename),names=fs.readdirSync(path.dirname(source.filename));
 expect(await readGeometryCacheSnapshot(source.root,REL)).toMatchObject({status:'missing',reason,freshness:'unverified'});
 expect(hash(source.filename)).toBe(before);expect(fs.readdirSync(path.dirname(source.filename))).toEqual(names);
});
it('reads exactly the selected cache row and preserves raw hashes/stamps without calling them fresh',async()=>{
 const source=fixture(),databaseHash=hash(source.filename),cadHash=hash(source.cad),names=fs.readdirSync(path.dirname(source.filename));
 const result=await readGeometryCacheSnapshot(source.root,REL);
 expect(result).toEqual({rel:REL,status:'record',freshness:'unverified',cached_box:{x_mm:10,y_mm:20,z_mm:0},sources:JSON.parse(row().sources_json),algorithm_version:1,updated_at:row().updated_at,database:{key:'workspace_cad_geometry',sha256:databaseHash}});
 expect(JSON.stringify(result)).not.toContain(source.root);expect(result).not.toHaveProperty('message');
 expect(hash(source.filename)).toBe(databaseHash);expect(hash(source.cad)).toBe(cadHash);expect(fs.readdirSync(path.dirname(source.filename))).toEqual(names);expect(fs.existsSync(source.lock)).toBe(false);
});
it('does not open or stat CAD/dependencies, scan directories, initialize cache tables or start processes',async()=>{
 const source=fixture(),lstat=fs.lstatSync,stat=fs.statSync,read=fs.readFileSync,open=fs.openSync;
 const permitted=new Set([source.root,path.dirname(source.filename),source.filename,source.lock,source.filename+'-wal',source.filename+'-shm',source.filename+'-journal']);
 vi.spyOn(fs,'lstatSync').mockImplementation(((file:fs.PathLike,...args:unknown[])=>{if(!permitted.has(String(file)))throw new Error('unselected stat');return Reflect.apply(lstat,fs,[file,...args]);}) as typeof fs.lstatSync);
 vi.spyOn(fs,'statSync').mockImplementation(((file:fs.PathLike,...args:unknown[])=>{if(!permitted.has(String(file)))throw new Error('unselected stat');return Reflect.apply(stat,fs,[file,...args]);}) as typeof fs.statSync);
 vi.spyOn(fs,'openSync').mockImplementation(((file:fs.PathLike,...args:unknown[])=>{if(String(file)!==source.filename)throw new Error('unselected open');return Reflect.apply(open,fs,[file,...args]);}) as typeof fs.openSync);
 vi.spyOn(fs,'readFileSync').mockImplementation(((file:fs.PathOrFileDescriptor,...args:unknown[])=>{if(String(file)!==source.filename)throw new Error('unselected content');return Reflect.apply(read,fs,[file,...args]);}) as typeof fs.readFileSync);
 const scans=[vi.spyOn(fs,'readdirSync'),vi.spyOn(fs,'opendirSync')];for(const scan of scans)scan.mockImplementation((()=>{throw new Error('directory scan forbidden');}) as never);
 const processes=[vi.spyOn(childProcess,'spawn'),vi.spyOn(childProcess,'spawnSync'),vi.spyOn(childProcess,'execFile'),vi.spyOn(childProcess,'execFileSync')];
 for(const process of processes)process.mockImplementation((()=>{throw new Error('process execution forbidden');}) as never);
 expect(await readGeometryCacheSnapshot(source.root,REL)).toMatchObject({status:'record',freshness:'unverified'});
 for(const operation of [...scans,...processes])expect(operation).not.toHaveBeenCalled();
});
it('returns old algorithms as unknown and keeps null/planar boxes distinct from invalid dimensions',async()=>{
 const old=fixture({values:{algorithm_version:0}});expect(await readGeometryCacheSnapshot(old.root,REL)).toMatchObject({status:'unknown',reason:'unsupported_algorithm',algorithm_version:0,cached_box:{x_mm:10,y_mm:20,z_mm:0},freshness:'unverified'});
 const empty=fixture({values:{box_json:'null'}});expect(await readGeometryCacheSnapshot(empty.root,REL)).toMatchObject({status:'record',cached_box:null});
 const invalid=fixture({values:{box_json:JSON.stringify({x_mm:0,y_mm:0,z_mm:0})}});expect(await readGeometryCacheSnapshot(invalid.root,REL)).toMatchObject({status:'invalid',reason:'invalid_record'});
});
it.each([
 {values:{sources_json:'not JSON'}},{values:{sources_json:'[]'}},{values:{box_json:'{}'}},{values:{updated_at:'not a date'}},
 {values:{sources_json:JSON.stringify([{rel:REL,hash:'bad',stamp:'1:2:3:4'}])}},
 {values:{sources_json:JSON.stringify([{rel:'../outside.FCStd',hash:'a'.repeat(64),stamp:'1:2:3:4'}])}},
 {values:{sources_json:JSON.stringify([{rel:REL,hash:'a'.repeat(64),stamp:'/private/path'}])}},
 {values:{sources_json:JSON.stringify([{rel:REL,hash:'a'.repeat(64),stamp:'1:2:3:4',extra:'not returned'}])}},
 {values:{sources_json:JSON.stringify([{rel:REL,hash:'a'.repeat(64),stamp:'1:2:3:4'},{rel:REL,hash:'b'.repeat(64),stamp:'2:3:4:5'}])}},
 {values:{sources_json:JSON.stringify([{rel:REL,hash:'a'.repeat(64),stamp:'1:2:3:4'},{rel:'unselected/\u202ehidden.FCStd',hash:'b'.repeat(64),stamp:'2:3:4:5'}])}},
 {values:{sources_json:JSON.stringify([{rel:REL,hash:'a'.repeat(64),stamp:'1:2:3:4'},{rel:'unselected/\ud800.FCStd',hash:'b'.repeat(64),stamp:'2:3:4:5'}])}},
])('rejects malformed cached fields without exposing raw row data',async({values})=>{
 const source=fixture({values}),before=hash(source.filename),result=await readGeometryCacheSnapshot(source.root,REL);
 expect(result).toMatchObject({status:'invalid',reason:'invalid_record'});expect(result).not.toHaveProperty('sources_json');expect(hash(source.filename)).toBe(before);
});
it('classifies unknown table schemas without migrations',async()=>{
 const source=fixture({table:false}),db=new DatabaseSync(source.filename);db.exec('CREATE TABLE desk_cad_geometry(rel TEXT PRIMARY KEY,old_box TEXT)');db.close();
 const before=hash(source.filename);expect(await readGeometryCacheSnapshot(source.root,REL)).toMatchObject({status:'unknown',reason:'unsupported_schema'});expect(hash(source.filename)).toBe(before);
});
it('refuses a view instead of querying its rows and ignores oversized unselected cache records',async()=>{
 const view=fixture({table:false}),db=new DatabaseSync(view.filename);db.exec('CREATE VIEW desk_cad_geometry AS SELECT * FROM unrelated');db.close();
 expect(await readGeometryCacheSnapshot(view.root,REL)).toMatchObject({status:'unknown',reason:'unsupported_schema'});
 const selected=fixture(),rows=new DatabaseSync(selected.filename);
 rows.prepare('INSERT INTO desk_cad_geometry VALUES(?,?,?,?,?,?)').run('unselected/Other.FCStd','secret'.repeat(50000),'{}','never returned','invalid date',1);rows.close();
 expect(await readGeometryCacheSnapshot(selected.root,REL)).toMatchObject({status:'record',sources:JSON.parse(row().sources_json)});
});
it('uses SQL byte/type gates before retrieving oversized or non-text JSON',async()=>{
 for(const json of [' '.repeat(GEOMETRY_CACHE_READ_LIMITS.recordBytes+1), '界'.repeat(100000)]){
  const source=fixture({values:{sources_json:json}});expect(await readGeometryCacheSnapshot(source.root,REL)).toMatchObject({status:'invalid',reason:'record_too_large'});
 }
 const blob=fixture(),db=new DatabaseSync(blob.filename);db.prepare('UPDATE desk_cad_geometry SET sources_json=?').run(Buffer.from('[]'));db.close();
 expect(await readGeometryCacheSnapshot(blob.root,REL)).toMatchObject({status:'invalid',reason:'invalid_record'});
});
it('never reclaims an existing lock or WAL/SHM/journal sidecar',async()=>{
 const locked=fixture();fs.mkdirSync(locked.lock);fs.writeFileSync(path.join(locked.lock,'owner.txt'),'other owner');
 await expect(readGeometryCacheSnapshot(locked.root,REL)).rejects.toMatchObject({code:'busy'});expect(fs.readFileSync(path.join(locked.lock,'owner.txt'),'utf8')).toBe('other owner');
 for(const suffix of ['-wal','-shm','-journal']){const source=fixture();fs.writeFileSync(source.filename+suffix,'protected');await expect(readGeometryCacheSnapshot(source.root,REL)).rejects.toMatchObject({code:'unsupported_journal'});expect(fs.readFileSync(source.filename+suffix,'utf8')).toBe('protected');expect(fs.existsSync(source.lock)).toBe(false);}
});
it('refuses a persistent WAL header without creating WAL/SHM or changing database bytes',async()=>{
 const source=fixture(),fd=fs.openSync(source.filename,'r+');fs.writeSync(fd,Buffer.from([2,2]),0,2,18);fs.closeSync(fd);
 const before=hash(source.filename);await expect(readGeometryCacheSnapshot(source.root,REL)).rejects.toMatchObject({code:'unsupported_journal'});
 expect(hash(source.filename)).toBe(before);expect(fs.readdirSync(path.dirname(source.filename))).toEqual(['phoenix-workspace.sqlite']);
});
it('rejects symlink database/parent, unsafe selections and databases over the fixed 64MiB budget',async()=>{
 const source=fixture(),outside=fixture();fs.unlinkSync(source.filename);fs.symlinkSync(outside.filename,source.filename);
 await expect(readGeometryCacheSnapshot(source.root,REL)).rejects.toMatchObject({code:'unsafe'});
 const parent=fixture({database:false});fs.symlinkSync(path.dirname(outside.filename),path.join(parent.root,'.phoenix'));
 await expect(readGeometryCacheSnapshot(parent.root,REL)).rejects.toMatchObject({code:'unsafe'});
 const valid=fixture();for(const rel of ['../outside.FCStd','/absolute.FCStd','plain.txt','parts\\Other.FCStd','parts/\u202ehidden.FCStd','parts/\ud800.FCStd'])await expect(readGeometryCacheSnapshot(valid.root,rel)).rejects.toMatchObject({code:'unsafe'});
 const large=fixture();fs.truncateSync(large.filename,GEOMETRY_CACHE_READ_LIMITS.databaseBytes+1);await expect(readGeometryCacheSnapshot(large.root,REL)).rejects.toMatchObject({code:'resource_limit'});expect(fs.existsSync(large.lock)).toBe(false);
});
it('rejects a hard-linked database before acquiring a pathname lease without changing either alias',async()=>{
 const source=fixture(),alias=path.join(source.root,'database-alias.sqlite');fs.linkSync(source.filename,alias);
 const databaseHash=hash(source.filename),aliasHash=hash(alias),names=fs.readdirSync(path.dirname(source.filename)),rootNames=fs.readdirSync(source.root);
 expect(fs.lstatSync(source.filename).nlink).toBe(2);expect(fs.lstatSync(alias).ino).toBe(fs.lstatSync(source.filename).ino);
 await expect(readGeometryCacheSnapshot(source.root,REL)).rejects.toMatchObject({code:'unsafe'});
 expect(hash(source.filename)).toBe(databaseHash);expect(hash(alias)).toBe(aliasHash);
 expect(fs.readdirSync(path.dirname(source.filename))).toEqual(names);expect(fs.readdirSync(source.root)).toEqual(rootNames);
 expect(fs.existsSync(source.lock)).toBe(false);expect(fs.existsSync(alias+'.lock')).toBe(false);
});
it('cooperatively cancels a bounded database fingerprint and releases only its own lease',async()=>{
 const source=fixture(),controller=new AbortController();fs.truncateSync(source.filename,8*1024*1024);
 const before=hash(source.filename),names=fs.readdirSync(path.dirname(source.filename));
 const cancellation=setImmediate(()=>controller.abort());
 try{await expect(readGeometryCacheSnapshot(source.root,REL,controller.signal)).rejects.toMatchObject({code:'cancelled'});}finally{clearImmediate(cancellation);}
 expect(hash(source.filename)).toBe(before);expect(fs.readdirSync(path.dirname(source.filename))).toEqual(names);expect(fs.existsSync(source.lock)).toBe(false);
});
it('detects a database mutation after its first real bounded fingerprint and releases its own lock',async()=>{
 const source=fixture(),read=fs.readSync;let changed=false;
 vi.spyOn(fs,'readSync').mockImplementation(((...args:Parameters<typeof fs.readSync>)=>{
  const result=Reflect.apply(read,fs,args),values=args as unknown[];
  if(!changed&&Buffer.isBuffer(values[1])&&values[1].length===65536){changed=true;fs.appendFileSync(source.filename,'external edit');}
  return result;
 }) as typeof fs.readSync);
 await expect(readGeometryCacheSnapshot(source.root,REL)).rejects.toMatchObject({code:'changed'});expect(changed).toBe(true);expect(fs.existsSync(source.lock)).toBe(false);
});
it('honors pre-cancellation and retains a lease on close failure instead of deleting another owner marker',async()=>{
 const source=fixture(),controller=new AbortController();controller.abort();await expect(readGeometryCacheSnapshot(source.root,REL,controller.signal)).rejects.toMatchObject({code:'cancelled'});expect(fs.existsSync(source.lock)).toBe(false);
 const open=leases.openCadSqliteReadDatabase;let retained:ReturnType<typeof open>|undefined;
 vi.spyOn(leases,'openCadSqliteReadDatabase').mockImplementation(filename=>{retained=open(filename);return {...retained,close:()=>{throw new Error('synthetic private close token');}};});
 await expect(readGeometryCacheSnapshot(source.root,REL)).rejects.toMatchObject({code:'close_failed'});expect(fs.existsSync(source.lock)).toBe(true);
 retained!.close();expect(fs.existsSync(source.lock)).toBe(false);
});
