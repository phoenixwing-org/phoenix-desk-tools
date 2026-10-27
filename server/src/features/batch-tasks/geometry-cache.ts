import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setImmediate as yieldToHost} from 'node:timers/promises';
import {openCadSqliteReadDatabase} from '../../lib/cadSqliteReadLease.js';
import type {BoundingBox, GeometrySource} from '../part-gallery/geometryStorage.js';
import {CadObjectInfoBudget, measureCadObjectInfoJsonBytes} from '../cad-object-info/budget.js';
import {relativeFile} from './model.js';

export const GEOMETRY_CACHE_READ_LIMITS = Object.freeze({databaseBytes:64*1024*1024,recordBytes:256*1024,sources:500});
const DATABASE_REL='.phoenix/phoenix-workspace.sqlite',DATABASE_KEY='workspace_cad_geometry' as const;
type Base={rel:string;freshness:'unverified';database?:{key:typeof DATABASE_KEY;sha256:string}};
type CachedRecord={cached_box:BoundingBox|null;sources:GeometrySource[];algorithm_version:number;updated_at:string};
export type GeometryCacheSnapshot=Base&(
 |{status:'missing';reason:'database_missing'|'table_missing'|'row_missing'}
 |{status:'unknown';reason:'unsupported_schema'}
 |({status:'unknown';reason:'unsupported_algorithm'}&CachedRecord)
 |{status:'invalid';reason:'invalid_record'|'record_too_large'}
 |({status:'record'}&CachedRecord));
export class GeometryCacheReadError extends Error {
 constructor(readonly code:'unsafe'|'busy'|'unsupported_journal'|'changed'|'resource_limit'|'cancelled'|'close_failed'|'io_error',message:string){super(message);}
}
type Location={root:string;parent:string;filename:string;rootStat:fs.BigIntStats;parentStat:fs.BigIntStats;fileStat:fs.BigIntStats};
const sameIdentity=(a:fs.BigIntStats,b:fs.BigIntStats)=>a.dev===b.dev&&a.ino===b.ino;
const sameFile=(a:fs.BigIntStats,b:fs.BigIntStats)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const active=(signal?:AbortSignal)=>{if(signal?.aborted)throw new GeometryCacheReadError('cancelled','尺寸缓存查询已取消');};
function issue(code:GeometryCacheReadError['code'],message:string):never{throw new GeometryCacheReadError(code,message);}
function optionalStat(filename:string):fs.BigIntStats|undefined{
 try{return fs.lstatSync(filename,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}
function location(workspace:string):Location|undefined{
 if(typeof workspace!=='string'||!path.isAbsolute(workspace)||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(workspace))issue('unsafe','尺寸缓存需要明确的安全工作空间');
 const root=fs.realpathSync(workspace),rootStat=fs.lstatSync(root,{bigint:true});
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||root===path.parse(root).root)issue('unsafe','工作空间不是安全的普通目录');
 const parent=path.join(root,'.phoenix'),parentStat=optionalStat(parent);
 if(!parentStat)return undefined;
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink())issue('unsafe','缓存目录不是安全的普通目录');
 const filename=path.join(root,DATABASE_REL),fileStat=optionalStat(filename);
 if(!fileStat)return undefined;
 if(!fileStat.isFile()||fileStat.isSymbolicLink()||fileStat.nlink!==1n||fs.realpathSync(filename)!==filename)issue('unsafe','尺寸缓存数据库不是安全的单链接普通文件');
 if(fileStat.size>BigInt(GEOMETRY_CACHE_READ_LIMITS.databaseBytes))issue('resource_limit','尺寸缓存数据库超过64MiB读取上限');
 return {root,parent,filename,rootStat,parentStat,fileStat};
}
function assertLocation(expected:Location):void{
 const current=location(expected.root);
 if(!current||!sameIdentity(expected.rootStat,current.rootStat)||!sameIdentity(expected.parentStat,current.parentStat)||!sameFile(expected.fileStat,current.fileStat))issue('changed','尺寸缓存数据库或父目录在读取期间变化');
}
function assertNoForeignSidecars(source:Location):void{
 if(optionalStat(`${source.filename}.lock`))issue('busy','尺寸缓存正被其他宿主使用；没有删除已有锁');
 if(['-wal','-shm','-journal'].some(suffix=>optionalStat(source.filename+suffix)))issue('unsupported_journal','尺寸缓存日志布局不受支持；未初始化或修复数据库');
}
async function fingerprint(source:Location,signal?:AbortSignal):Promise<string>{
 active(signal);assertLocation(source);
 const fd=fs.openSync(source.filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const opened=fs.fstatSync(fd,{bigint:true});
  if(!opened.isFile()||!sameFile(source.fileStat,opened))issue('changed','尺寸缓存数据库在打开前变化');
  const hash=createHash('sha256'),buffer=Buffer.alloc(64*1024);let total=0,blocks=0;
  while(total<=Number(opened.size)){
   active(signal);const amount=fs.readSync(fd,buffer,0,Math.min(buffer.length,Number(opened.size)-total+1),total);
   if(!amount)break;hash.update(buffer.subarray(0,amount));total+=amount;
   if(total>GEOMETRY_CACHE_READ_LIMITS.databaseBytes)issue('resource_limit','尺寸缓存数据库超过64MiB读取上限');
   if(++blocks%64===0){await yieldToHost();active(signal);}
  }
  if(BigInt(total)!==opened.size||!sameFile(opened,fs.fstatSync(fd,{bigint:true})))issue('changed','尺寸缓存数据库在读取期间变化');
  assertLocation(source);return hash.digest('hex');
 }finally{fs.closeSync(fd);}
}
type ReadDb=ReturnType<typeof openCadSqliteReadDatabase>;
const columnNames=['rel','sources_json','box_json','algorithm_version','updated_at'];
function validCachedBox(value:unknown):value is BoundingBox{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['x_mm','y_mm','z_mm'].includes(key)))return false;
 const box=value as BoundingBox,numbers=[box.x_mm,box.y_mm,box.z_mm];
 return numbers.every(number=>typeof number==='number'&&Number.isFinite(number)&&number>=0)&&numbers.some(number=>number>0);
}
function readRecord(db:ReadDb,rel:string):GeometryCacheSnapshot{
 const base:Base={rel,freshness:'unverified'};
 // Metadata also remains a bounded scalar projection: no raw schema strings or
 // arbitrary column names leave SQLite, and virtual/shadow/view tables are not read.
 const table=db.prepare("SELECT CASE WHEN type='table' THEN 1 ELSE 0 END AS supported FROM pragma_table_list WHERE schema='main' AND name='desk_cad_geometry'").get();
 if(!table)return {...base,status:'missing',reason:'table_missing'};
 if(table.supported!==1)return {...base,status:'unknown',reason:'unsupported_schema'};
 const columns=db.prepare(`SELECT COUNT(DISTINCT name) AS known FROM pragma_table_info('desk_cad_geometry') WHERE name IN (${columnNames.map(name=>`'${name}'`).join(',')})`).get();
 if(columns?.known!==columnNames.length)return {...base,status:'unknown',reason:'unsupported_schema'};
 // Compute byte/type gates inside SQLite before transferring any JSON column.
 // Never fetch message, other cache rows, or raw database/schema text into a DTO.
 const textFields=['rel','sources_json','box_json','updated_at'];
 const types=textFields.map(name=>`typeof(${name})='text'`).join(' AND ');
 const bytes=textFields.map(name=>`COALESCE(length(CAST(${name} AS BLOB)),0)`).join('+');
 const safe=`(${types}) AND (${bytes})<=${GEOMETRY_CACHE_READ_LIMITS.recordBytes}`;
 const rows=db.prepare(`SELECT CASE WHEN (${types}) THEN 1 ELSE 0 END AS types_ok,(${bytes}) AS field_bytes,
  ${textFields.map(name=>`CASE WHEN ${safe} THEN ${name} ELSE NULL END AS ${name}`).join(',')},
  CASE WHEN typeof(algorithm_version)='integer' AND algorithm_version BETWEEN 0 AND 2147483647 THEN algorithm_version ELSE NULL END AS algorithm_version
  FROM desk_cad_geometry WHERE rel=? COLLATE BINARY LIMIT 2`).all(rel);
 if(!rows.length)return {...base,status:'missing',reason:'row_missing'};
 const row=rows[0];
 if(rows.length!==1||row.types_ok!==1)return {...base,status:'invalid',reason:'invalid_record'};
 if(typeof row.field_bytes!=='number'||row.field_bytes>GEOMETRY_CACHE_READ_LIMITS.recordBytes)return {...base,status:'invalid',reason:'record_too_large'};
 if(row.rel!==rel||typeof row.sources_json!=='string'||typeof row.box_json!=='string'||typeof row.updated_at!=='string'
  ||!row.updated_at||!Number.isFinite(Date.parse(row.updated_at))||typeof row.algorithm_version!=='number')return {...base,status:'invalid',reason:'invalid_record'};
 let sources:unknown,box:unknown;
 try{sources=JSON.parse(row.sources_json);box=JSON.parse(row.box_json);}catch{return {...base,status:'invalid',reason:'invalid_record'};}
 if(!Array.isArray(sources)||!sources.length||sources.length>GEOMETRY_CACHE_READ_LIMITS.sources)return {...base,status:'invalid',reason:'invalid_record'};
 const projected:GeometrySource[]=[],seen=new Set<string>();
 for(const value of sources){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['rel','hash','stamp'].includes(key))
   ||typeof value.rel!=='string'||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.rel)||typeof value.hash!=='string'||!/^[a-f0-9]{64}$/u.test(value.hash)||typeof value.stamp!=='string'||!value.stamp
   ||value.stamp.length>512||/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value.stamp))return {...base,status:'invalid',reason:'invalid_record'};
  try{if(relativeFile(value.rel)!==value.rel||seen.has(value.rel))throw new Error();}catch{return {...base,status:'invalid',reason:'invalid_record'};}
  seen.add(value.rel);projected.push({rel:value.rel,hash:value.hash,stamp:value.stamp});
 }
 if(!seen.has(rel)||box!==null&&!validCachedBox(box))return {...base,status:'invalid',reason:'invalid_record'};
 const record:CachedRecord={sources:projected,cached_box:box===null?null:{x_mm:(box as BoundingBox).x_mm,y_mm:(box as BoundingBox).y_mm,z_mm:(box as BoundingBox).z_mm},algorithm_version:row.algorithm_version,updated_at:row.updated_at};
 return row.algorithm_version===1?{...base,status:'record',...record}:{...base,status:'unknown',reason:'unsupported_algorithm',...record};
}
function safeFailure(error:unknown):GeometryCacheReadError{
 if(error instanceof GeometryCacheReadError)return error;
 if((error as {code?:unknown})?.code==='cancelled')return new GeometryCacheReadError('cancelled','尺寸缓存查询已取消');
 const message=error instanceof Error?error.message:'';
 if(/busy|owns the lock|lock directory/i.test(message))return new GeometryCacheReadError('busy','尺寸缓存正被其他宿主使用；没有删除已有锁');
 if(/WAL|journal layout/i.test(message))return new GeometryCacheReadError('unsupported_journal','尺寸缓存日志布局不受支持；未初始化或修复数据库');
 if(/identity changed|changed while|database changed/i.test(message))return new GeometryCacheReadError('changed','尺寸缓存数据库或读租约身份变化');
 return new GeometryCacheReadError('io_error','尺寸缓存快照不可读取，未初始化或修改缓存');
}

/**
 * Read one exact existing cache row. This never creates cache tables, measures
 * CAD, reads/stats dependencies or claims hash freshness for a cached box.
 * The shared SQLite read lease creates/removes its OWN temporary .lock directory;
 * that coordination lifecycle is not a business database/cache write. A failed
 * close retains that lease and is reported, never reclaimed by this port.
 */
export async function readGeometryCacheSnapshot(workspace:string,rel:string,signal?:AbortSignal):Promise<GeometryCacheSnapshot>{
 let db:ReadDb|undefined,result:GeometryCacheSnapshot|undefined,source:Location|undefined,failure:unknown;
 try{
  active(signal);
  try{if(relativeFile(rel)!==rel||/[\p{Cc}\p{Cf}\p{Cs}]/u.test(rel)||!/\.fcstd$/iu.test(rel))throw new Error();}catch{issue('unsafe','尺寸缓存只接受明确的安全 FCStd 相对路径');}
  source=location(workspace);
  if(!source)return {rel,freshness:'unverified',status:'missing',reason:'database_missing'};
  assertNoForeignSidecars(source);db=openCadSqliteReadDatabase(source.filename);db.assertLeaseOwner();assertLocation(source);
  db.exec('PRAGMA trusted_schema=OFF');
  const before=await fingerprint(source,signal);db.assertLeaseOwner();active(signal);
  result=readRecord(db,rel);db.assertLeaseOwner();
  const after=await fingerprint(source,signal);db.assertLeaseOwner();
  if(before!==after)issue('changed','尺寸缓存数据库字节在查询期间变化');
  result={...result,database:{key:DATABASE_KEY,sha256:after}};
  try{await measureCadObjectInfoJsonBytes(result,new CadObjectInfoBudget(signal,{bytes:GEOMETRY_CACHE_READ_LIMITS.recordBytes}));}
  catch(error){if((error as {code?:unknown})?.code==='resource_limit')result={rel,freshness:'unverified',status:'invalid',reason:'record_too_large',database:{key:DATABASE_KEY,sha256:after}};else throw error;}
  active(signal);
 }catch(error){failure=error;}
 if(db){try{db.close();}catch{throw new GeometryCacheReadError('close_failed','尺寸缓存读连接关闭失败；保留读租约，未删除锁');}}
 if(failure)throw safeFailure(failure);
 if(source){try{assertLocation(source);}catch(error){throw safeFailure(error);}}
 return result!;
}
