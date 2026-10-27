import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pnwCreateDb, type PnwDbAdapter } from '@phoenix-wing/db-node';
import {openCadSqliteReadDatabase} from '../../lib/cadSqliteReadLease.js';
import { BATCH_SCHEMA_VERSION, isActiveRun, isTerminalRun, isCurrentPlan, isNativePlan, isExecutablePlan, isBatchPlannedStep, isBatchStep, type BatchTask, type TaskDraft, type BatchPlan,
  type BatchRun, type BatchStep, type BatchEvent, type RunDetail, type RunStatus, type StepStatus } from '../../../../shared/batch-tasks/contracts.js';
import {validateCurrentBatchPlan} from '../../../../shared/batch-tasks/envelope.js';
import {canonicalPlanPayloadV2} from '../../../../shared/batch-tasks/next-protocol.js';
import {BATCH_MIGRATION_WRITE_WORKER} from './migration-worker.js';
import {validateNativeBatchPlanV3,canonicalNativePlanV3Payload} from '../../../../shared/batch-tasks/native-envelope.js';
import {validatePreparedNativeTicketV3,canonicalPreparedNativeTicketV3Payload,canonicalNativePreparedStepV3Payload,type PreparedNativeTicketV3} from '../../../../shared/batch-tasks/native-protocol.js';
import {createNativeAttempt,validateNativeAttempt,applyNativeAttemptEvent,recoverNativeAttempt,importNativeAttemptHistory,canonicalNativeAttemptEventPayload,type NativeAttemptState,type NativeAttemptEvent} from '../../../../shared/batch-tasks/native-attempt.js';

const MAX_JSON = 2 * 1024 * 1024, MAX_RESULT = 256 * 1024, MAX_BACKUP = 32 * 1024 * 1024;
const ACTIVE = "('queued','running','cancel_requested')";
const TERMINAL_STEPS = new Set<StepStatus>(['succeeded','failed','not_applicable','blocked','cancelled','interrupted']);
type JsonRow = { data_json:string };
type Owner = { host:string; pid:number; nonce:string };
type StorageIdentity = { root:fs.Stats; directory:fs.Stats; file:fs.Stats };
export interface BatchRepositoryOptions { now?:()=>number; id?:()=>string; host?:string; pid?:number; isPidAlive?:(pid:number)=>boolean }
export type NativeAttemptDetail={ticket:PreparedNativeTicketV3;state:NativeAttemptState};
type BackupData = { tasks:BatchTask[]; plans:BatchPlan[]; runs:Array<RunDetail & { plan:BatchPlan }>;native_attempts?:NativeAttemptDetail[] };
export type BatchBackup = { format:'desk-batch-tasks-backup'; version:1|2|3; schema_version:1|2|3; created_at:string; checksum:string; data:BackupData };
export class BatchRepositoryError extends Error {
  constructor(readonly code:string, message:string) { super(message); this.name='BatchRepositoryError'; }
}
function fail(code:string, message:string):never { throw new BatchRepositoryError(code,message); }
function json(value:unknown, limit=MAX_JSON):string {
  const text=JSON.stringify(value); if (!text || Buffer.byteLength(text)>limit) fail('resource_limit','任务数据超过安全上限'); return text;
}
function parse<T>(row:JsonRow|undefined):T|undefined { return row ? JSON.parse(row.data_json) as T : undefined; }
function clone<T>(value:T):T { return JSON.parse(json(value)) as T; }
function text(value:unknown, max=200):value is string { return typeof value==='string' && !!value.trim() && value.length<=max && !/[\u0000-\u001f\u007f]/.test(value); }
function safeRel(value:unknown):value is string {
  return text(value,4096) && !/[\\:]/.test(value) && !value.startsWith('/') && value.split('/').every(part=>part && part!=='.' && part!=='..');
}
function stepCounts(steps:BatchStep[]) { return {total:steps.length,completed:steps.filter(s=>s.status==='succeeded').length,failed:steps.filter(s=>s.status==='failed'||s.status==='blocked').length}; }
function terminalProblem(status:RunStatus,steps:BatchStep[]):string|undefined {
  if(!isTerminalRun(status))return undefined;
  if(steps.some(s=>!TERMINAL_STEPS.has(s.status)))return '仍有未完成步骤';
  if(status==='succeeded'&&steps.some(s=>!['succeeded','not_applicable'].includes(s.status)))return '存在未成功步骤';
  if(status==='partial'&&(!steps.some(s=>s.status==='succeeded')||!steps.some(s=>['failed','blocked','cancelled','interrupted'].includes(s.status))))return '部分完成必须同时保留成功与未完成结果';
  return undefined;
}
function taskDraft(draft:TaskDraft) {
  if (!draft || !text(draft.name,120) || !Array.isArray(draft.subjects) || !draft.subjects.length || draft.subjects.length>200
    || draft.subjects.some(s=>!s || !['file','cad_model'].includes(s.kind) || !safeRel(s.rel)||(s.node!==undefined&&(!text(s.node,128)||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s.node))))
    || new Set(draft.subjects.map(s=>`${s.kind}:${s.rel}:${s.node??''}`)).size!==draft.subjects.length) fail('invalid_arguments','任务需要名称及 1–200 个明确文件');
  if (!Array.isArray(draft.actions) || !draft.actions.length || draft.actions.length>8
    || draft.actions.some(a=>!a || !text(a.instance_id) || !text(a.key) || !Number.isSafeInteger(a.version) || a.version<1 || !a.params || typeof a.params!=='object' || Array.isArray(a.params) || Object.keys(a.params).length)
    || new Set(draft.actions.map(a=>a.instance_id)).size!==draft.actions.length) fail('invalid_arguments','任务需要 1–8 个版本化只读动作');
  json(draft);
}
function sameDefinition(task:BatchTask,draft:TaskDraft):boolean {
  return task.name===draft.name.trim()&&task.subjects.length===draft.subjects.length&&task.actions.length===draft.actions.length
    &&task.subjects.every((subject,index)=>subject.kind===draft.subjects[index].kind&&subject.rel===draft.subjects[index].rel&&subject.node===draft.subjects[index].node)
    &&task.actions.every((action,index)=>{const candidate=draft.actions[index];return action.instance_id===candidate.instance_id&&action.key===candidate.key&&action.version===candidate.version&&JSON.stringify(action.params)===JSON.stringify(candidate.params);});
}
function validatePlan(plan:BatchPlan) {
  if(isNativePlan(plan)){
    try{validateNativeBatchPlanV3(plan);}catch{fail('invalid_arguments','V3 Native 预览与冻结清单不一致');}
    if(createHash('sha256').update(canonicalNativePlanV3Payload(plan.prepared)).digest('hex')!==plan.digest)fail('invalid_arguments','V3 冻结清单摘要不符');
    json(plan);return;
  }
  if(isCurrentPlan(plan)){
    try{validateCurrentBatchPlan(plan);}catch{fail('invalid_arguments','V2 预览与冻结清单不一致');}
    if(createHash('sha256').update(canonicalPlanPayloadV2(plan.prepared)).digest('hex')!==plan.digest)fail('invalid_arguments','V2 冻结清单摘要不符');
    json(plan);return;
  }
  if(plan&&('protocol_version'in plan||'prepared'in plan))fail('invalid_arguments','未知计划版本不能降级为历史计划');
  if (!plan || !text(plan.id) || !text(plan.task_id) || !Number.isSafeInteger(plan.task_revision) || plan.task_revision<1
    || !['fresh','consumed','invalidated'].includes(plan.status) || !/^[a-f0-9]{64}$/.test(plan.digest)
    || !Number.isFinite(Date.parse(plan.created_at)) || !Number.isFinite(Date.parse(plan.expires_at))) fail('invalid_arguments','预览格式无效');
  taskDraft({name:'plan',subjects:plan.items?.map(i=>i.subject),actions:plan.actions});
  if (!Array.isArray(plan.items) || plan.items.some(i=>!text(i.id) || !Number.isSafeInteger(i.bytes) || i.bytes<0
    || (i.error!==undefined ? !text(i.error,2048)||i.sha256!==''||i.bytes!==0 : !/^[a-f0-9]{64}$/.test(i.sha256)))
    || new Set(plan.items.map(i=>i.id)).size!==plan.items.length || !Array.isArray(plan.steps) || plan.steps.length!==plan.items.length*plan.actions.length) fail('invalid_arguments','预览对象或步骤无效');
  const items=new Set(plan.items.map(i=>i.id)), actions=new Set(plan.actions.map(a=>a.instance_id));
  if (plan.steps.some(s=>!s || !text(s.id) || !items.has(s.item_id) || !actions.has(s.action_instance_id) || typeof s.applicable!=='boolean'
      || (s.applicable && plan.items.find(i=>i.id===s.item_id)?.error!==undefined))
    || new Set(plan.steps.map(s=>s.id)).size!==plan.steps.length || new Set(plan.steps.map(s=>`${s.item_id}\0${s.action_instance_id}`)).size!==plan.steps.length
    || !plan.summary || plan.summary.files!==plan.items.length || plan.summary.actions!==plan.actions.length
    || plan.summary.executable!==plan.steps.filter(s=>s.applicable).length || plan.summary.excluded!==plan.steps.filter(s=>!s.applicable).length
    || JSON.stringify(plan.effects)!==JSON.stringify(['read_file','write_task_db'])) fail('invalid_arguments','预览计数或效果声明无效');
  json(plan);
}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function nativeTicket(value:unknown):PreparedNativeTicketV3{
  let ticket:PreparedNativeTicketV3;try{ticket=validatePreparedNativeTicketV3(value);}catch{return fail('invalid_native_attempt','Native ticket 格式或绑定无效');}
  if(sha(canonicalPreparedNativeTicketV3Payload({binding:ticket.binding,step:ticket.step}))!==ticket.execution_digest_claim)fail('invalid_native_attempt','Native ticket 摘要不符');
  return ticket;
}
function nativeRecord(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('invalid_native_result','Native DTO 必须是惰性普通数据');
  const own=Reflect.ownKeys(value);if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)))fail('invalid_native_result','Native DTO 含未知字段');
  for(const key of own){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d)||!d.enumerable)fail('invalid_native_result','Native DTO 不接受访问器');}
}
function exactNative(value:unknown,expected:unknown):boolean{
  if(expected===null||typeof expected!=='object')return value===expected;
  if(Array.isArray(expected)){
    if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length!==expected.length||Reflect.ownKeys(value).length!==value.length+1)return false;
    return expected.every((entry,index)=>{const d=Object.getOwnPropertyDescriptor(value,String(index));return !!d&&'value'in d&&d.enumerable&&exactNative(d.value,entry);});
  }
  nativeRecord(value,Object.keys(expected));return Object.keys(expected).every(key=>exactNative(value[key],(expected as Record<string,unknown>)[key]));
}
/** DTO consistency only, never evidence that a host process actually ran. */
function nativeResult(value:Record<string,unknown>|undefined,detail:NativeAttemptDetail):Record<string,unknown>{
  if(!value)fail('invalid_native_result','Native 成功必须保留完整 measurement DTO');
  nativeRecord(value,['schema_version','status','algorithm_version','script_sha256','measurement_mode','coordinate_system','manifest_sha256','source','shape','saved_entity','bounds_mm','volume_mm3','native_shape_type','valid','closed','solid_count','loaded_document_count','document_opened','restored_document_verified','parameter_freshness','document_frame','private_paths_checked','app_version','occ_version','engine','process_proof','byte_preservation']);
  const result=value,state=detail.state,ticket=detail.ticket,step=ticket.step,profile=step.profile;
  const proof=result.process_proof as Record<string,unknown>|undefined,bounds=result.bounds_mm as Record<string,unknown>|undefined;
  nativeRecord(proof,['owned_pid','nonce','manifest_sha256','execution_sha256','engine_sha256','script_sha256','timeout_ms','measurement_profile','actual_close_observed','exit_code','signal','owner_acknowledged','owner_marker_written','output_bytes','termination_requests']);
  nativeRecord(bounds,['x_min','x_max','y_min','y_max','z_min','z_max','x_length','y_length','z_length']);
  const expectedExecution=ticket.execution_digest_claim;
  const equal=exactNative;
  if(result.schema_version!==1||result.status!=='measured'||result.algorithm_version!==profile.algorithm_version||result.script_sha256!==profile.script_sha256
    ||result.measurement_mode!=='saved_brep_snapshot_no_document'||result.coordinate_system!=='serialized_saved_shape_xyz'
    ||result.manifest_sha256!==step.manifest.manifest_sha256||!equal(result.source,step.manifest.source)
    ||!equal(result.shape,{basis:'serialized_shape_snapshot',member_path:step.manifest.shape.member_path,bytes:step.manifest.shape.bytes,sha256:step.manifest.shape.sha256})
    ||!equal(result.saved_entity,{node:step.subject.node,type_id:'Part::Feature'})||result.native_shape_type!=='Solid'||result.valid!==true||result.closed!==true||result.solid_count!==1
    ||result.loaded_document_count!==0||result.document_opened!==false||result.restored_document_verified!==false||result.parameter_freshness!=='not_attested'||result.document_frame!=='not_attested'||result.private_paths_checked!==true
    ||!equal(result.engine,{bytes:profile.engine.bytes,sha256:profile.engine.sha256})||!equal(result.app_version,profile.engine.app_version)||result.occ_version!==profile.engine.occ_version
    ||!equal(result.byte_preservation,{source_before:step.manifest.source.sha256,source_after:step.manifest.source.sha256,staged_shape_before:step.manifest.shape.sha256,staged_shape_after:step.manifest.shape.sha256})
    ||!proof||proof.owned_pid!==state.child?.pid||proof.nonce!==ticket.binding.child_nonce||proof.actual_close_observed!==true||proof.exit_code!==0||proof.signal!==null
    ||proof.owner_acknowledged!==true||proof.owner_marker_written!==true||proof.manifest_sha256!==step.manifest.manifest_sha256||proof.measurement_profile!=='saved_brep_snapshot'
    ||proof.engine_sha256!==profile.engine.sha256||proof.script_sha256!==profile.script_sha256||proof.timeout_ms!==profile.timeout_ms||proof.execution_sha256!==expectedExecution
    ||!equal(proof.termination_requests,[])||!Number.isSafeInteger(proof.output_bytes)||Number(proof.output_bytes)<0||Number(proof.output_bytes)>MAX_RESULT
    ||!bounds||['x_min','x_max','y_min','y_max','z_min','z_max','x_length','y_length','z_length'].some(key=>typeof bounds[key]!=='number'||!Number.isFinite(bounds[key]))
    ||['x','y','z'].some(axis=>{const length=Number(bounds[`${axis}_length`]),min=Number(bounds[`${axis}_min`]),max=Number(bounds[`${axis}_max`]);return length<=0||max<=min||Math.abs(max-min-length)>Math.max(1e-9,Math.abs(length)*1e-10);})
    ||typeof result.volume_mm3!=='number'||!Number.isFinite(result.volume_mm3)||result.volume_mm3<=0||sha(json(result,MAX_RESULT))!==state.report?.sha256)
    fail('invalid_native_result','Native 结果与完整冻结来源、profile 或关闭声明不一致');
  return clone(result);
}
function processAlive(pid:number):boolean {
  try { process.kill(pid,0); return true; } catch(error) {
    if (error && typeof error==='object' && 'code' in error && error.code==='ESRCH') return false;
    return true; // EPERM and unknown failures are not proof that an owner died.
  }
}
function entryStat(filename:string):fs.Stats|undefined {
  try{return fs.lstatSync(filename);}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT')return undefined;throw error;}
}
function assertJournalPaths(filename:string) {
  // lstat also sees dangling symlinks. SQLite must never truncate an aliased
  // rollback journal or open a WAL/SHM layout behind this DELETE-only adapter.
  if(entryStat(`${filename}-wal`)||entryStat(`${filename}-shm`))fail('unsupported_journal','任务库不支持 WAL/SHM');
  const journal=entryStat(`${filename}-journal`);
  if(journal&&(!journal.isFile()||journal.isSymbolicLink()||journal.nlink!==1))fail('unsafe_path','任务库 journal 不得为别名或特殊文件');
}
function safeDatabase(root:string):{root:string;filename:string;exists:boolean} {
  if (!path.isAbsolute(root) || fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) fail('unsafe_path','工作空间必须是普通目录');
  const canonical=fs.realpathSync(root), directory=path.join(canonical,'.phoenix');
  try { fs.mkdirSync(directory,{mode:0o700}); } catch(error) { if (!(error && typeof error==='object' && 'code' in error && error.code==='EEXIST')) throw error; }
  if (fs.lstatSync(directory).isSymbolicLink() || !fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory)!==directory) fail('unsafe_path','任务库目录不安全');
  const filename=path.join(directory,'batch-tasks.sqlite'); let exists=false;
  try { const stat=fs.lstatSync(filename); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink!==1) fail('unsafe_path','任务库必须是无硬链接的普通文件'); exists=true; }
  catch(error) { if (!(error && typeof error==='object' && 'code' in error && error.code==='ENOENT')) throw error; }
  assertJournalPaths(filename);
  if (exists) {
    const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.nlink!==1)fail('unsafe_path','任务库不得为硬链接'); const header=Buffer.alloc(20); if (fs.readSync(fd,header,0,20,0)===20 && (header[18]===2 || header[19]===2)) fail('unsupported_journal','任务库不支持 WAL'); }
    finally { fs.closeSync(fd); }
  }
  return {root:canonical,filename,exists};
}
/** Provenance guard for existing files, not a complete pathname-race fence.
 * Never initialize/adopt an existing arbitrary SQLite or failed empty artifact.
 * The shared read lease owns its temporary lock; foreign locks are not reclaimed. */
function assertExistingTaskDatabase(filename:string):void{
  let probe:ReturnType<typeof openCadSqliteReadDatabase>|undefined;
  try{
    probe=openCadSqliteReadDatabase(filename);
    const meta=probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='desk_batch_meta'").get();
    if(!meta)fail('schema_mismatch','既有文件缺少可识别任务库元数据，未接管');
    // Only numeric projections are read until the exact schema marker is known
    // to be a unique bounded TEXT scalar. Never materialize an unknown large value.
    const shape=probe.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN typeof(value)='text' AND LENGTH(value)<=16 THEN 1 ELSE 0 END),0) AS bounded FROM desk_batch_meta WHERE key='schema_version'").get() as {n:number;bounded:number};
    if(shape.n!==1||shape.bounded!==1)fail('schema_mismatch','既有任务库版本标记缺失或不安全，未接管');
    const version=probe.prepare("SELECT value FROM desk_batch_meta WHERE key='schema_version' AND typeof(value)='text' AND LENGTH(value)<=16").get() as {value?:unknown}|undefined;
    if(!version||typeof version.value!=='string'||!['1','2','3'].includes(version.value))fail('schema_mismatch','既有任务库版本不兼容，未接管');
    probe.assertLeaseOwner();
  }catch{fail('schema_mismatch','无法只读识别既有任务库，未接管或修改其内容');}
  finally{if(probe)try{probe.close();}catch{fail('schema_mismatch','既有任务库只读租约未能安全关闭，未接管');}}
}

/** Desk-only schema. Every mutation and its event are committed in one short synchronous transaction. */
export class BatchRepository {
  readonly root:string;
  readonly path:string;
  private readonly db:PnwDbAdapter;
  private readonly owner:Owner;
  private readonly now:()=>number;
  private readonly id:()=>string;
  private readonly storage:StorageIdentity;
  private closed=false;
  constructor(root:string, options:BatchRepositoryOptions={}) {
    const location=safeDatabase(root); this.root=location.root; this.path=location.filename;
    this.now=options.now??Date.now; this.id=options.id??randomUUID;
    this.owner={host:options.host??os.hostname(),pid:options.pid??process.pid,nonce:randomUUID()};
    if(location.exists)assertExistingTaskDatabase(this.path);
    this.db=pnwCreateDb(this.path);
    this.storage={root:fs.lstatSync(this.root),directory:fs.lstatSync(path.dirname(this.path)),file:fs.lstatSync(this.path)};
    try {
      this.assertStorage();
      if (!location.exists) fs.chmodSync(this.path,0o600);
      const mode=this.db.get<{journal_mode:string}>('PRAGMA journal_mode');
      if (mode?.journal_mode!=='delete') fail('unsupported_journal','任务库必须使用 DELETE journal');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0; PRAGMA synchronous=FULL;');
      this.transaction(()=>{
        const hasMeta=!!this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='desk_batch_meta'");
        if(location.exists&&!hasMeta)fail('schema_mismatch','既有文件缺少明确任务库元数据，未接管');
        const version=hasMeta?this.db.get<{value:string}>("SELECT value FROM desk_batch_meta WHERE key='schema_version'"):undefined;
        if(hasMeta&&!version)fail('schema_mismatch','任务库缺少明确版本，未迁移数据');
        if(version&&!['1','2','3'].includes(version.value))fail('schema_mismatch','任务库版本不兼容，未迁移数据');
        const raw=hasMeta?this.db.get<{value:string}>("SELECT value FROM desk_batch_meta WHERE key='owner'"):undefined;
        if (raw) {
          const owner=JSON.parse(raw.value) as Owner;
          if (!owner || owner.host!==this.owner.host || !Number.isSafeInteger(owner.pid) || owner.pid<=0 || (options.isPidAlive??processAlive)(owner.pid)) fail('owner_busy','任务库已有存活或归属未知的服务');
        }
        const backup=version&&version.value!=='3'?this.writeMigrationBackup(Number(version.value) as 1|2):undefined;
        this.db.exec(`CREATE TABLE IF NOT EXISTS desk_batch_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desk_batch_task(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,archived INTEGER NOT NULL,data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desk_batch_plan(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES desk_batch_task(id),status TEXT NOT NULL,data_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desk_batch_run(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES desk_batch_task(id),status TEXT NOT NULL,client_request_id TEXT NOT NULL UNIQUE,digest TEXT NOT NULL,data_json TEXT NOT NULL,plan_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desk_batch_step(run_id TEXT NOT NULL REFERENCES desk_batch_run(id),id TEXT NOT NULL,status TEXT NOT NULL,ordinal INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(run_id,id));
        CREATE TABLE IF NOT EXISTS desk_batch_event(run_id TEXT NOT NULL REFERENCES desk_batch_run(id),seq INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(run_id,seq));
        CREATE TABLE IF NOT EXISTS desk_batch_native_attempt(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES desk_batch_run(id),step_id TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(run_id,step_id));
        CREATE TABLE IF NOT EXISTS desk_batch_native_event(attempt_id TEXT NOT NULL REFERENCES desk_batch_native_attempt(id),id TEXT NOT NULL,ordinal INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(attempt_id,id),UNIQUE(attempt_id,ordinal));
        CREATE INDEX IF NOT EXISTS desk_batch_run_status ON desk_batch_run(status);`);
        if(backup)this.db.run("INSERT OR REPLACE INTO desk_batch_meta(key,value) VALUES('migration_backup',?)",[backup]);
        this.db.run("INSERT OR REPLACE INTO desk_batch_meta(key,value) VALUES('schema_version',?)",[String(BATCH_SCHEMA_VERSION)]);
        this.db.run("INSERT OR REPLACE INTO desk_batch_meta(key,value) VALUES('owner',?)",[json(this.owner)]);
        this.recoverNativeAttempts();
        this.interruptActive('后台会话已更换，旧任务不会自动重放');
        this.invalidatePlans();
      },false);
    } catch(error) { this.db.close(); throw error; }
  }
  private stamp() { return new Date(this.now()).toISOString(); }
  private assertStorage() {
    const locations=[this.root,path.dirname(this.path),this.path],proofs=[this.storage.root,this.storage.directory,this.storage.file];
    for(const [index,location] of locations.entries()) {
      let current:fs.Stats;try{current=fs.lstatSync(location);}catch{fail('unsafe_path','任务库或工作空间目录身份已变化');}
      if(current.isSymbolicLink()||current.dev!==proofs[index].dev||current.ino!==proofs[index].ino||(index===2&&(!current.isFile()||current.nlink!==1)))fail('unsafe_path','任务库或工作空间目录身份已变化，或出现硬链接');
    }
    assertJournalPaths(this.path);
  }
  private assertOwner() {
    if (this.closed) fail('inactive','任务库已关闭');
    this.assertStorage();
    const raw=this.db.get<{value:string}>("SELECT value FROM desk_batch_meta WHERE key='owner'");
    if (!raw || JSON.parse(raw.value).nonce!==this.owner.nonce) fail('owner_conflict','任务库服务归属已变化');
  }
  private transaction<T>(operation:()=>T, checkOwner=true):T {
    if (this.closed) fail('inactive','任务库已关闭');
    this.assertStorage();
    this.db.exec('BEGIN IMMEDIATE');
    try { if(checkOwner) this.assertOwner(); const result=operation(); this.assertStorage();this.db.exec('COMMIT'); return result; }
    catch(error) { if(this.db.inTransaction) this.db.exec('ROLLBACK'); throw error; }
  }
  private event(runId:string,type:string,message:string) {
    const seq=Number(this.db.get<{seq:number}>('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM desk_batch_event WHERE run_id=?',[runId])!.seq);
    const event:BatchEvent={seq,run_id:runId,type,created_at:this.stamp(),message:message.slice(0,2048)};
    this.db.run('INSERT INTO desk_batch_event(run_id,seq,data_json) VALUES(?,?,?)',[runId,seq,json(event)]);
  }
  private writeRun(run:BatchRun) { this.db.run('UPDATE desk_batch_run SET status=?,data_json=? WHERE id=?',[run.status,json(run),run.id]); }
  private writeStep(step:BatchStep) { this.db.run('UPDATE desk_batch_step SET status=?,data_json=? WHERE run_id=? AND id=?',[step.status,json(step),step.run_id,step.id]); }
  private run(id:string):BatchRun { const run=parse<BatchRun>(this.db.get<JsonRow>('SELECT data_json FROM desk_batch_run WHERE id=?',[id])); return run??fail('not_found','运行不存在'); }
  private steps(id:string):BatchStep[] { return this.db.all<JsonRow>('SELECT data_json FROM desk_batch_step WHERE run_id=? ORDER BY ordinal',[id]).map(row=>parse<BatchStep>(row)!); }
  private recount(run:BatchRun) {Object.assign(run,stepCounts(this.steps(run.id)));}
  private native(id:string):NativeAttemptDetail{
    const row=this.db.get<JsonRow&{id:string;run_id:string;step_id:string}>('SELECT id,run_id,step_id,data_json FROM desk_batch_native_attempt WHERE id=?',[id]);
    const detail=parse<NativeAttemptDetail>(row)??fail('not_found','Native attempt 不存在');
    const ticket=nativeTicket(detail.ticket),state=validateNativeAttempt(detail.state);
    if(JSON.stringify(ticket.binding)!==JSON.stringify(state.spec)||row!.id!==state.spec.attempt_id||row!.run_id!==state.spec.run_id||row!.step_id!==state.spec.step_id)fail('invalid_native_attempt','Native attempt 与 ticket 不一致');
    const events=this.db.all<JsonRow>('SELECT data_json FROM desk_batch_native_event WHERE attempt_id=? ORDER BY ordinal',[id]).map(row=>JSON.parse(row.data_json));
    if(events.length!==state.events.length||events.some((event,index)=>canonicalNativeAttemptEventPayload(event)!==canonicalNativeAttemptEventPayload(state.events[index])))fail('invalid_native_attempt','Native 稳定事件与状态不一致');
    return {ticket,state};
  }
  private writeNative(detail:NativeAttemptDetail){this.db.run('UPDATE desk_batch_native_attempt SET data_json=? WHERE id=?',[json(detail),detail.state.spec.attempt_id]);}
  private recoverNativeAttempts(){
    for(const row of this.db.all<{id:string}>('SELECT id FROM desk_batch_native_attempt')){const detail=this.native(row.id);detail.state=recoverNativeAttempt(detail.state);this.writeNative(detail);}
  }
  /** Historical read projection only: it never restores execution, kill or host-lease rights. */
  getNativeAttempt(id:string):NativeAttemptDetail|undefined{
    this.assertOwner();if(!this.db.get('SELECT id FROM desk_batch_native_attempt WHERE id=?',[id]))return undefined;
    const detail=this.native(id);return {ticket:detail.ticket,state:recoverNativeAttempt(detail.state)};
  }
  listNativeAttempts(runId?:string):NativeAttemptDetail[]{
    this.assertOwner();return this.db.all<{id:string}>(`SELECT id FROM desk_batch_native_attempt${runId?' WHERE run_id=?':''} ORDER BY rowid DESC LIMIT 200`,runId?[runId]:undefined).map(row=>this.getNativeAttempt(row.id)!);
  }
  prepareNativeAttempt(value:PreparedNativeTicketV3):NativeAttemptState{
    const ticket=nativeTicket(value),binding=ticket.binding;
    return this.transaction(()=>{
      const run=this.run(binding.run_id),plan=this.getRunPlan(run.id),step=this.steps(run.id).find(step=>step.id===binding.step_id);
      if(run.status!=='running'||run.cancel_requested||run.active_step_id!==binding.step_id||step?.status!=='running'||!isNativePlan(plan))fail('state_conflict','Native attempt 必须绑定当前运行中的 V3 步骤');
      validatePlan(plan);
      if(binding.plan_digest!==plan.digest||canonicalNativePreparedStepV3Payload(ticket.step)!==canonicalNativePreparedStepV3Payload(plan.prepared.step))fail('invalid_native_attempt','Native ticket 与冻结运行计划不一致');
      if(this.db.get('SELECT id FROM desk_batch_native_attempt WHERE id=?',[binding.attempt_id])){
        const old=this.native(binding.attempt_id);if(json(old.ticket)!==json(ticket))fail('idempotency_conflict','Native attempt ID 已用于不同 ticket');
        if(old.state.projection!=='live_model')fail('state_conflict','历史 Native attempt 不能重新 prepare');return old.state;
      }
      if(this.db.get('SELECT id FROM desk_batch_native_attempt WHERE run_id=? AND step_id=?',[run.id,step.id]))fail('state_conflict','同一步骤不能创建第二个 Native attempt');
      const state=createNativeAttempt(binding);this.db.run('INSERT INTO desk_batch_native_attempt VALUES(?,?,?,?)',[binding.attempt_id,run.id,step.id,json({ticket,state})]);
      this.event(run.id,'native_prepared','Native attempt 已持久化；账本数据不授予进程权限');return state;
    });
  }
  private appendNative(detail:NativeAttemptDetail,event:NativeAttemptEvent):NativeAttemptState{
    const canonical=canonicalNativeAttemptEventPayload(event),previous=detail.state.events.find(saved=>saved.id===event.id);
    if(previous){if(canonicalNativeAttemptEventPayload(previous)!==canonical)fail('event_conflict','Native 稳定事件 ID 内容冲突');return detail.state;}
    const run=this.run(detail.state.spec.run_id),step=this.steps(run.id).find(step=>step.id===detail.state.spec.step_id);
    if(!['running','cancel_requested'].includes(run.status)||!step||run.active_step_id!==step.id||step.status!=='running')fail('state_conflict','运行已停止，拒绝迟到 Native 事件');
    const state=applyNativeAttemptEvent(detail.state,event);
    this.db.run('INSERT INTO desk_batch_native_event VALUES(?,?,?,?)',[state.spec.attempt_id,event.id,state.events.length-1,canonical]);
    detail.state=state;this.writeNative(detail);this.event(run.id,`native_${event.type}`,'Native host 声明已记录（非运行能力）');return state;
  }
  appendNativeEvent(attemptId:string,event:NativeAttemptEvent):NativeAttemptState{
    canonicalNativeAttemptEventPayload(event);
    if(event.type==='host_outcome')fail('invalid_native_event','Native 终态必须与步骤结果原子提交');
    return this.transaction(()=>this.appendNative(this.native(attemptId),event));
  }
  commitNativeMeasurement(attemptId:string,event:NativeAttemptEvent,result?:Record<string,unknown>,message?:string):BatchStep{
    canonicalNativeAttemptEventPayload(event);if(event.type!=='host_outcome')fail('invalid_native_event','Native 提交需要 host_outcome 事件');
    return this.transaction(()=>{
      const detail=this.native(attemptId),run=this.run(detail.state.spec.run_id),step=this.steps(run.id).find(step=>step.id===detail.state.spec.step_id)??fail('not_found','Native 步骤不存在');
      const previous=detail.state.events.find(saved=>saved.id===event.id);
      if(previous){if(canonicalNativeAttemptEventPayload(previous)!==canonicalNativeAttemptEventPayload(event)||json(step.result??null)!==json(result??null))fail('event_conflict','Native 提交重试内容冲突');return step;}
      if(run.cancel_requested&&event.outcome==='succeeded')fail('state_conflict','取消后不能提交 Native 成功');
      const state=applyNativeAttemptEvent(detail.state,event),checked=event.outcome==='succeeded'?nativeResult(result,{ticket:detail.ticket,state}):undefined;
      if(event.outcome!=='succeeded'&&result!==undefined)fail('invalid_native_result','失败或取消不能附带成功 measurement');
      this.appendNative(detail,event);
      step.status=event.outcome;step.finished_at=this.stamp();if(checked)step.result=checked;if(message)step.message=message.slice(0,2048);
      this.writeStep(step);if(run.active_step_id===step.id)delete run.active_step_id;this.recount(run);this.writeRun(run);this.event(run.id,'step_finished',message??`${step.id}: ${step.status}`);return step;
    });
  }
  private invalidatePlans(taskId?:string) {
    const rows=this.db.all<JsonRow>(`SELECT data_json FROM desk_batch_plan WHERE status='fresh'${taskId?' AND task_id=?':''}`,taskId?[taskId]:undefined);
    for(const row of rows) { const plan=parse<BatchPlan>(row)!; plan.status='invalidated'; this.db.run('UPDATE desk_batch_plan SET status=?,data_json=? WHERE id=?',[plan.status,json(plan),plan.id]); }
  }
  private interruptActive(message:string) {
    for(const row of this.db.all<JsonRow>(`SELECT data_json FROM desk_batch_run WHERE status IN ${ACTIVE}`)) {
      const run=parse<BatchRun>(row)!; run.status='interrupted'; run.finished_at=this.stamp(); run.message=message; delete run.active_step_id;
      for(const step of this.steps(run.id)) if(step.status==='pending'||step.status==='running') { step.status='interrupted'; step.finished_at=run.finished_at; step.message=message; this.writeStep(step); }
      this.recount(run); this.writeRun(run); this.event(run.id,'interrupted',message);
    }
  }
  saveTask(draft:TaskDraft,id?:string,expectedRevision?:number,creationId?:string):BatchTask {
    taskDraft(draft);
    if(creationId!==undefined&&(id!==undefined||!text(creationId,100)||!/^[A-Za-z0-9_-]+$/.test(creationId)))fail('invalid_arguments','新建幂等标识无效，或与编辑任务 ID 冲突');
    return this.transaction(()=>{
      if(creationId!==undefined){const existing=this.getTask(creationId);if(existing){
        if(existing.revision===1&&!existing.archived&&sameDefinition(existing,draft))return existing;
        fail('creation_conflict','相同新建标识已用于其它定义或后续版本，请重新读取任务');
      }}
      const prior=id?this.getTask(id):undefined;
      if(id && !prior) fail('not_found','任务不存在');
      if(prior && prior.revision!==expectedRevision) fail('revision_conflict','任务已变化，请刷新后编辑');
      const task:BatchTask={...clone(draft),name:draft.name.trim(),id:prior?.id??creationId??this.id(),revision:(prior?.revision??0)+1,archived:prior?.archived??false,created_at:prior?.created_at??this.stamp(),updated_at:this.stamp()};
      this.db.run('INSERT INTO desk_batch_task(id,revision,archived,data_json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,archived=excluded.archived,data_json=excluded.data_json',[task.id,task.revision,task.archived?1:0,json(task)]);
      this.invalidatePlans(task.id); return task;
    });
  }
  archiveTask(id:string,revision:number,archived:boolean):BatchTask {
    return this.transaction(()=>{ const task=this.getTask(id)??fail('not_found','任务不存在'); if(task.revision!==revision) fail('revision_conflict','任务已变化');
      task.revision++;task.archived=archived;task.updated_at=this.stamp(); this.db.run('UPDATE desk_batch_task SET revision=?,archived=?,data_json=? WHERE id=?',[task.revision,archived?1:0,json(task),id]);this.invalidatePlans(id);return task; });
  }
  listTasks(includeArchived=false):BatchTask[] { this.assertOwner();return this.db.all<JsonRow>(`SELECT data_json FROM desk_batch_task${includeArchived?'':' WHERE archived=0'} ORDER BY rowid DESC`).map(row=>parse<BatchTask>(row)!); }
  getTask(id:string):BatchTask|undefined { this.assertOwner();return parse<BatchTask>(this.db.get<JsonRow>('SELECT data_json FROM desk_batch_task WHERE id=?',[id])); }
  savePlan(plan:BatchPlan):BatchPlan {
    validatePlan(plan); if(plan.status!=='fresh') fail('invalid_arguments','只能保存新的预览');
    return this.transaction(()=>{const task=this.getTask(plan.task_id)??fail('not_found','任务不存在');
      if(task.archived || task.revision!==plan.task_revision) fail('revision_conflict','任务已变化');
      if(Date.parse(plan.expires_at)<=this.now() || JSON.stringify(task.actions)!==JSON.stringify(plan.actions)
        || plan.items.some(i=>!task.subjects.some(s=>s.kind===i.subject.kind&&s.rel===i.subject.rel))
        ||(isExecutablePlan(plan)&&JSON.stringify(plan.items.map(item=>item.subject))!==JSON.stringify(task.subjects))) fail('plan_invalid','预览范围、动作或期限无效');
      this.db.run('INSERT INTO desk_batch_plan(id,task_id,status,data_json) VALUES(?,?,?,?)',[plan.id,plan.task_id,plan.status,json(plan)]);return clone(plan);});
  }
  getPlan(id:string):BatchPlan|undefined { this.assertOwner();return parse<BatchPlan>(this.db.get<JsonRow>('SELECT data_json FROM desk_batch_plan WHERE id=?',[id])); }
  acceptRun(planId:string,digest:string,clientRequestId:string):RunDetail {
    if(!text(clientRequestId,128)||!/^[a-f0-9]{64}$/.test(digest)) fail('invalid_arguments','运行请求标识或摘要无效');
    return this.transaction(()=>{
      const old=this.db.get<{id:string;digest:string}>('SELECT id,digest FROM desk_batch_run WHERE client_request_id=?',[clientRequestId]);
      if(old) { const detail=this.getRun(old.id)!;if(old.digest!==digest||detail.run.plan_id!==planId) fail('idempotency_conflict','相同请求标识不能提交不同内容');const frozen=this.getRunPlan(old.id);if(!isExecutablePlan(frozen))fail('plan_invalid','历史运行只能读取，不授予执行权限');validatePlan(frozen);return detail; }
      const plan=this.getPlan(planId)??fail('not_found','预览不存在'),task=this.getTask(plan.task_id)??fail('not_found','任务不存在');
      if(!isExecutablePlan(plan))fail('plan_invalid','历史计划只能读取，请用当前协议重新预览');validatePlan(plan);
      if(plan.status!=='fresh'||Date.parse(plan.expires_at)<=this.now()||plan.digest!==digest) fail('plan_invalid','预览已失效、使用或摘要不符');
      if(task.archived||task.revision!==plan.task_revision) fail('revision_conflict','任务定义已变化');
      if(!plan.summary.executable) fail('no_executable_steps','没有可执行步骤');
      if(Number(this.db.get<{n:number}>(`SELECT COUNT(*) n FROM desk_batch_run WHERE status IN ${ACTIVE}`)!.n)>=32) fail('queue_full','批量任务队列已满');
      if(JSON.stringify(plan.actions)!==JSON.stringify(task.actions)||JSON.stringify(plan.items.map(item=>item.subject))!==JSON.stringify(task.subjects))fail('plan_invalid','冻结计划与当前任务清单不一致');
      const run:BatchRun={id:this.id(),task_id:task.id,task_revision:task.revision,task_name:task.name,plan_id:plan.id,client_request_id:clientRequestId,status:'queued',created_at:this.stamp(),cancel_requested:false,total:plan.steps.length,completed:0,failed:isCurrentPlan(plan)?plan.prepared.summary.blocked:0};
      this.db.run('INSERT INTO desk_batch_run(id,task_id,status,client_request_id,digest,data_json,plan_json) VALUES(?,?,?,?,?,?,?)',[run.id,task.id,run.status,clientRequestId,digest,json(run),json(plan)]);
      for(const [ordinal,s] of plan.steps.entries()) {
        const action=plan.actions.find(a=>a.instance_id===s.action_instance_id)!,preparation=isCurrentPlan(plan)?plan.prepared.steps[ordinal].status:'ready';
        const target=isBatchPlannedStep(s)?{scope:'batch' as const,item_ids:[...s.item_ids],subjects:s.item_ids.map(id=>plan.items.find(item=>item.id===id)!.subject)}:{scope:'file' as const,item_id:s.item_id,subject:plan.items.find(i=>i.id===s.item_id)!.subject};
        const step:BatchStep={id:s.id,run_id:run.id,...target,action_instance_id:action.instance_id,action_key:action.key,status:preparation==='ready'?'pending':preparation,...(!s.applicable?{message:s.reason,finished_at:run.created_at}:{})};
        this.db.run('INSERT INTO desk_batch_step(run_id,id,status,ordinal,data_json) VALUES(?,?,?,?,?)',[run.id,step.id,step.status,ordinal,json(step)]);
      }
      plan.status='consumed';this.db.run('UPDATE desk_batch_plan SET status=?,data_json=? WHERE id=?',[plan.status,json(plan),plan.id]);this.event(run.id,'accepted','运行已接纳并排队');return this.getRun(run.id)!;
    });
  }
  listRuns():BatchRun[] {this.assertOwner();return this.db.all<JsonRow>('SELECT data_json FROM desk_batch_run ORDER BY rowid DESC LIMIT 200').map(row=>parse<BatchRun>(row)!);}
  findRunByRequest(clientRequestId:string):BatchRun|undefined {this.assertOwner();return parse<BatchRun>(this.db.get<JsonRow>('SELECT data_json FROM desk_batch_run WHERE client_request_id=?',[clientRequestId]));}
  getRun(id:string,afterSeq=0):RunDetail|undefined {
    this.assertOwner();const run=parse<BatchRun>(this.db.get<JsonRow>('SELECT data_json FROM desk_batch_run WHERE id=?',[id]));if(!run)return undefined;
    return {run,steps:this.steps(id),events:this.db.all<JsonRow>('SELECT data_json FROM desk_batch_event WHERE run_id=? AND seq>? ORDER BY seq LIMIT 256',[id,afterSeq]).map(row=>parse<BatchEvent>(row)!)};
  }
  getRunPlan(id:string):BatchPlan|undefined {this.assertOwner();const row=this.db.get<{plan_json:string}>('SELECT plan_json FROM desk_batch_run WHERE id=?',[id]);return row?JSON.parse(row.plan_json) as BatchPlan:undefined;}
  claimQueuedRun():BatchRun|undefined {
    return this.transaction(()=>{if(this.db.get(`SELECT id FROM desk_batch_run WHERE status IN ('running','cancel_requested') LIMIT 1`))return undefined;
      const run=parse<BatchRun>(this.db.get<JsonRow>("SELECT data_json FROM desk_batch_run WHERE status='queued' ORDER BY rowid LIMIT 1"));if(!run)return undefined;
      const plan=this.getRunPlan(run.id);if(!isExecutablePlan(plan))fail('plan_invalid','历史运行不可执行');validatePlan(plan);
      run.status='running';run.started_at=this.stamp();this.writeRun(run);this.event(run.id,'started','后台开始运行');return run;});
  }
  startStep(runId:string,stepId:string):BatchStep {
    return this.transaction(()=>{const run=this.run(runId);if(run.status!=='running'||run.active_step_id)fail('state_conflict','运行不允许启动新步骤');
      const step=this.steps(runId).find(s=>s.id===stepId)??fail('not_found','步骤不存在');if(step.status!=='pending')fail('state_conflict','步骤已开始或完成');
      step.status='running';step.started_at=this.stamp();run.active_step_id=step.id;this.writeStep(step);this.writeRun(run);this.event(runId,'step_started',stepId);return step;});
  }
  finishStep(runId:string,stepId:string,status:StepStatus,result?:Record<string,unknown>,message?:string):BatchStep {
    if(!TERMINAL_STEPS.has(status))fail('invalid_arguments','步骤结果必须是终态');if(result!==undefined)json(result,MAX_RESULT);
    return this.transaction(()=>{const run=this.run(runId);if(!['running','cancel_requested'].includes(run.status))fail('state_conflict','运行已停止，拒绝迟到结果');
      const step=this.steps(runId).find(s=>s.id===stepId)??fail('not_found','步骤不存在');if(TERMINAL_STEPS.has(step.status))fail('state_conflict','步骤已完成');
      if(isNativePlan(this.getRunPlan(runId)))fail('native_attempt_required','Native 步骤必须通过持久 attempt 提交，不接受普通步骤结果');
      step.status=status;step.finished_at=this.stamp();if(result!==undefined)step.result=clone(result);if(message)step.message=message.slice(0,2048);
      this.writeStep(step);if(run.active_step_id===step.id)delete run.active_step_id;this.recount(run);this.writeRun(run);this.event(runId,'step_finished',message??`${stepId}: ${status}`);return step;});
  }
  finishRun(runId:string,status:RunStatus,message?:string):BatchRun {
    if(!isTerminalRun(status))fail('invalid_arguments','运行结果必须是终态');
    return this.transaction(()=>{const run=this.run(runId);if(isTerminalRun(run.status))fail('state_conflict','运行已完成，拒绝迟到状态');
      const steps=this.steps(runId);
      if(isNativePlan(this.getRunPlan(runId))&&status!=='interrupted'&&steps.some(step=>step.status==='running'))fail('native_attempt_required','进行中的 Native 步骤必须先原子提交关闭结果');
      if((status==='succeeded'||status==='partial')&&steps.some(s=>!TERMINAL_STEPS.has(s.status)))fail('state_conflict','仍有未完成步骤');
      if(status==='succeeded'&&steps.some(s=>!['succeeded','not_applicable'].includes(s.status)))fail('state_conflict','存在未成功步骤');
      const ended=this.stamp();for(const step of steps)if(!TERMINAL_STEPS.has(step.status)){step.status=status==='cancelled'?'cancelled':status==='interrupted'?'interrupted':'blocked';step.finished_at=ended;this.writeStep(step);}
      if(status==='interrupted'||status==='failed')for(const row of this.db.all<{id:string}>('SELECT id FROM desk_batch_native_attempt WHERE run_id=?',[runId])){
        const detail=this.native(row.id);if(!detail.state.host_claimed_outcome){detail.state=recoverNativeAttempt(detail.state);this.writeNative(detail);}
      }
      const problem=terminalProblem(status,steps);if(problem)fail('state_conflict',problem);
      run.status=status;run.finished_at=ended;delete run.active_step_id;if(message)run.message=message.slice(0,2048);this.recount(run);this.writeRun(run);this.event(runId,'finished',message??status);return run;});
  }
  requestCancel(id:string):BatchRun {
    return this.transaction(()=>{const run=this.run(id);if(isTerminalRun(run.status)||run.cancel_requested)return run;
      run.cancel_requested=true;
      if(run.status==='queued') {run.status='cancelled';run.finished_at=this.stamp();for(const step of this.steps(id))if(step.status==='pending'){step.status='cancelled';step.finished_at=run.finished_at;this.writeStep(step);}this.recount(run);}
      else run.status='cancel_requested';this.writeRun(run);this.event(id,'cancel_requested',run.status==='cancelled'?'排队任务已取消':'已请求取消，等待当前安全边界');return run;});
  }
  private logicalBackup(version:1|2|3):BatchBackup {
      const total=this.db.get<{bytes:number}>(`SELECT COALESCE(SUM(bytes),0) bytes FROM (
        SELECT LENGTH(CAST(data_json AS BLOB)) bytes FROM desk_batch_task UNION ALL SELECT LENGTH(CAST(data_json AS BLOB)) FROM desk_batch_plan
        UNION ALL SELECT LENGTH(CAST(data_json AS BLOB))+LENGTH(CAST(plan_json AS BLOB)) FROM desk_batch_run
        UNION ALL SELECT LENGTH(CAST(data_json AS BLOB)) FROM desk_batch_step UNION ALL SELECT LENGTH(CAST(data_json AS BLOB)) FROM desk_batch_event
        ${version===3?'UNION ALL SELECT LENGTH(CAST(data_json AS BLOB)) FROM desk_batch_native_attempt UNION ALL SELECT LENGTH(CAST(data_json AS BLOB)) FROM desk_batch_native_event':''})`);
      if(Number(total?.bytes)>MAX_BACKUP)fail('resource_limit','任务账本超过逻辑备份安全上限');
      const data:BackupData={tasks:this.db.all<JsonRow>('SELECT data_json FROM desk_batch_task ORDER BY rowid DESC').map(row=>parse<BatchTask>(row)!),plans:this.db.all<JsonRow>('SELECT data_json FROM desk_batch_plan ORDER BY rowid').map(r=>parse<BatchPlan>(r)!),
        runs:this.db.all<{id:string;data_json:string;plan_json:string}>('SELECT id,data_json,plan_json FROM desk_batch_run ORDER BY rowid').map(row=>({run:JSON.parse(row.data_json) as BatchRun,steps:this.steps(row.id),
          events:this.db.all<JsonRow>('SELECT data_json FROM desk_batch_event WHERE run_id=? ORDER BY seq',[row.id]).map(r=>parse<BatchEvent>(r)!),plan:JSON.parse(row.plan_json) as BatchPlan})),
        ...(version===3?{native_attempts:this.db.all<{id:string}>('SELECT id FROM desk_batch_native_attempt ORDER BY rowid').map(row=>this.native(row.id))}:{})};
      const backup:BatchBackup={format:'desk-batch-tasks-backup',version,schema_version:version,created_at:this.stamp(),checksum:createHash('sha256').update(json(data,MAX_BACKUP)).digest('hex'),data};json(backup,MAX_BACKUP);return backup;
  }
  /** Private ignored artifact, created exclusively before the migration marker or any history invalidation. */
  private writeMigrationBackup(version:1|2):string {
    const backup=this.logicalBackup(version),payload=json(backup,MAX_BACKUP),directory=path.join(path.dirname(this.path),'batch-task-migrations');
    try{
      this.assertStorage();
      const root=fs.lstatSync(this.root,{bigint:true}),parent=fs.lstatSync(path.dirname(this.path),{bigint:true});
      const basename=`${randomUUID()}.json`,sha256=createHash('sha256').update(payload).digest('hex'),bytes=Buffer.byteLength(payload),env:NodeJS.ProcessEnv={};
      for(const key of ['SystemRoot','WINDIR','TMPDIR','TMP','TEMP','LANG','LC_ALL'])if(process.env[key]!==undefined)env[key]=process.env[key];
      const output=childProcess.execFileSync(process.execPath,['--input-type=commonjs','--eval',BATCH_MIGRATION_WRITE_WORKER],{cwd:this.root,env,
        input:JSON.stringify({rootIdentity:[String(root.dev),String(root.ino)],parentIdentity:[String(parent.dev),String(parent.ino)],basename,backup,bytes,sha256}),
        encoding:'utf8',timeout:10_000,maxBuffer:4096,killSignal:'SIGKILL',windowsHide:true,stdio:['pipe','pipe','pipe']});
      const response=JSON.parse(output) as {ok?:boolean;basename?:string;sha256?:string;bytes?:number;directoryIdentity?:string[];fileStamp?:string[]};
      if(response.ok!==true||response.basename!==basename||response.sha256!==sha256||response.bytes!==bytes)fail('migration_backup_failed','迁移备份报告无效');
      this.assertStorage();
      const savedDirectory=fs.lstatSync(directory,{bigint:true}),saved=fs.lstatSync(path.join(directory,basename),{bigint:true});
      if(savedDirectory.isSymbolicLink()||!savedDirectory.isDirectory()||JSON.stringify([String(savedDirectory.dev),String(savedDirectory.ino)])!==JSON.stringify(response.directoryIdentity)
        ||saved.isSymbolicLink()||!saved.isFile()||saved.nlink!==1n||saved.size!==BigInt(bytes)
        ||JSON.stringify([String(saved.dev),String(saved.ino),String(saved.size),String(saved.mtimeNs),String(saved.ctimeNs),String(saved.nlink)])!==JSON.stringify(response.fileStamp))fail('migration_backup_failed','迁移备份身份或完整字节数变化');
      return `.phoenix/batch-task-migrations/${basename}`;
    }catch{return fail('migration_backup_failed','无法安全保全原始逻辑备份，未迁移任务库');}
  }
  exportBackup():BatchBackup {
    return this.transaction(()=>this.logicalBackup(3));
  }
  restoreBackup(payload:unknown):{tasks:number;runs:number} {
    json(payload,MAX_BACKUP);const backup=payload as BatchBackup;
    if(!backup||backup.format!=='desk-batch-tasks-backup'||![1,2,3].includes(backup.version)||backup.schema_version!==backup.version||!backup.data
      ||!Array.isArray(backup.data.tasks)||!Array.isArray(backup.data.plans)||!Array.isArray(backup.data.runs)
      ||createHash('sha256').update(json(backup.data,MAX_BACKUP)).digest('hex')!==backup.checksum)fail('invalid_backup','任务备份格式、版本或校验和无效');
    if(backup.version===3?!Array.isArray(backup.data.native_attempts):backup.data.native_attempts!==undefined)fail('invalid_backup','Native 历史只允许明确的 schema3 备份');
    // Validate before touching the empty target; no arbitrary SQL or executable values are imported.
    for(const task of backup.data.tasks){taskDraft(task);if(!text(task.id)||!Number.isSafeInteger(task.revision)||task.revision<1||typeof task.archived!=='boolean')fail('invalid_backup','任务备份定义无效');}
    const tasks=new Map(backup.data.tasks.map(task=>[task.id,task])),plans=new Map(backup.data.plans.map(plan=>[plan.id,plan]));
    if(tasks.size!==backup.data.tasks.length||plans.size!==backup.data.plans.length
      ||new Set(backup.data.runs.map(d=>d.run?.id)).size!==backup.data.runs.length
      ||new Set(backup.data.runs.map(d=>d.run?.client_request_id)).size!==backup.data.runs.length)fail('invalid_backup','任务备份包含重复身份');
    const planTask=(plan:BatchPlan)=>{
      if(backup.version===1&&isCurrentPlan(plan)||backup.version<3&&isNativePlan(plan))fail('invalid_backup','旧备份不能包含更高协议计划');
      try{validatePlan(plan);}catch{fail('invalid_backup','备份计划或冻结清单不一致');}const task=tasks.get(plan.task_id);
      if(!task||plan.task_revision>task.revision)fail('invalid_backup','计划所属任务或 revision 无效');
      if(plan.task_revision===task.revision&&(JSON.stringify(plan.actions)!==JSON.stringify(task.actions)
        ||plan.items.some(item=>!task.subjects.some(subject=>subject.kind===item.subject.kind&&subject.rel===item.subject.rel))
        ||(isExecutablePlan(plan)&&JSON.stringify(plan.items.map(item=>item.subject))!==JSON.stringify(task.subjects))))fail('invalid_backup','计划与同 revision 定义不一致');
    };
    for(const plan of backup.data.plans)planTask(plan);
    for(const detail of backup.data.runs){planTask(detail.plan);if(!detail.run||!text(detail.run.id)||!text(detail.run.client_request_id,128)||!Array.isArray(detail.steps)||!Array.isArray(detail.events)
      ||detail.steps.length!==detail.plan.steps.length||detail.run.total!==detail.steps.length||detail.run.plan_id!==detail.plan.id||detail.run.task_id!==detail.plan.task_id
      ||detail.steps.some((step,index)=>step?.id!==detail.plan.steps[index].id)
      ||detail.run.task_revision!==detail.plan.task_revision||typeof detail.run.cancel_requested!=='boolean'
      ||!['queued','running','cancel_requested','succeeded','partial','failed','cancelled','interrupted'].includes(detail.run.status))fail('invalid_backup','任务备份运行无效');
      planTask(detail.plan);const savedPlan=plans.get(detail.run.plan_id),task=tasks.get(detail.run.task_id)!;
      if(!savedPlan||JSON.stringify({...savedPlan,status:'invalidated'})!==JSON.stringify({...detail.plan,status:'invalidated'})
        ||(task.revision===detail.run.task_revision&&task.name!==detail.run.task_name))fail('invalid_backup','运行与冻结计划或任务 revision 不一致');
      for(const step of detail.steps) {
        const planned=detail.plan.steps.find(s=>s.id===step?.id),action=detail.plan.actions.find(a=>a.instance_id===planned?.action_instance_id);
        if(!step||step.run_id!==detail.run.id||!planned||!action||step.action_instance_id!==action.instance_id||step.action_key!==action.key
          ||!['pending','running',...TERMINAL_STEPS].includes(step.status))fail('invalid_backup','任务备份步骤无效');
        if(isBatchPlannedStep(planned)){
          const subjects=planned.item_ids.map(id=>detail.plan.items.find(item=>item.id===id)!.subject);
          if(!isBatchStep(step)||'item_id'in step||'subject'in step||JSON.stringify(step.item_ids)!==JSON.stringify(planned.item_ids)||JSON.stringify(step.subjects)!==JSON.stringify(subjects))fail('invalid_backup','整批步骤不能伪装单文件或遗漏输入');
        }else{
          const item=detail.plan.items.find(item=>item.id===planned.item_id)!;
          if(isBatchStep(step)||'subjects'in step||'item_ids'in step||step.item_id!==item.id||JSON.stringify(step.subject)!==JSON.stringify(item.subject))fail('invalid_backup','任务备份文件步骤无效');
        }
        const preparation=isCurrentPlan(detail.plan)?detail.plan.prepared.steps.find(prepared=>prepared.id===planned.id)!.status:planned.applicable?'ready':'not_applicable';
        if(preparation!=='ready'&&step.status!==preparation)fail('invalid_backup','阻断或排除步骤不能具有执行结果');
        if(step.result!==undefined)json(step.result,MAX_RESULT);
      }
      const counts=stepCounts(detail.steps),problem=terminalProblem(detail.run.status,detail.steps),running=detail.steps.filter(step=>step.status==='running');
      if(problem||detail.run.completed!==counts.completed||detail.run.failed!==counts.failed||detail.run.total!==counts.total
        ||running.length>1||running[0]?.id!==detail.run.active_step_id
        ||(detail.run.status==='queued'&&(detail.run.cancel_requested||detail.steps.some(step=>!['pending','not_applicable','blocked'].includes(step.status))))
        ||(detail.run.status==='cancel_requested'&&!detail.run.cancel_requested)
        ||(detail.run.status==='running'&&detail.run.cancel_requested))fail('invalid_backup','任务备份包含不一致状态或统计');
      if(new Set(detail.steps.map(s=>s.id)).size!==detail.steps.length||detail.events.some((e,i)=>e.run_id!==detail.run.id||e.seq!==i+1||!text(e.type)||typeof e.message!=='string'||e.message.length>2048))fail('invalid_backup','任务备份事件无效');
    }
    const attempts=backup.data.native_attempts??[],attemptIds=new Set<string>(),attemptSteps=new Set<string>();
    for(const detail of attempts){
      try{
        const ticket=nativeTicket(detail.ticket),state=validateNativeAttempt(detail.state),binding=state.spec;
        const run=backup.data.runs.find(saved=>saved.run.id===binding.run_id),plan=run?.plan,step=run?.steps.find(step=>step.id===binding.step_id);
        if(json(ticket.binding)!==json(binding)||!run||!isNativePlan(plan)||!step||isBatchStep(step)||step.item_id!==ticket.step.item_id||binding.plan_digest!==plan.digest
          ||canonicalNativePreparedStepV3Payload(ticket.step)!==canonicalNativePreparedStepV3Payload(plan.prepared.step)
          ||attemptIds.has(binding.attempt_id)||attemptSteps.has(`${binding.run_id}:${binding.step_id}`))fail('invalid_backup','Native attempt 身份或冻结计划不一致');
        attemptIds.add(binding.attempt_id);attemptSteps.add(`${binding.run_id}:${binding.step_id}`);
        if(state.host_claimed_outcome&&(step.status!==state.host_claimed_outcome||step.status==='succeeded'&&!step.result))fail('invalid_backup','Native attempt 与步骤终态不一致');
        if(['failed','cancelled'].includes(step.status)&&state.host_claimed_outcome!==step.status)fail('invalid_backup','Native 失败或取消缺少原子关闭终态');
        if(step.status==='succeeded'){if(state.host_claimed_outcome!=='succeeded')fail('invalid_backup','Native 成功缺少完整关闭事件');nativeResult(step.result,{ticket,state});}
        else if(step.result!==undefined)fail('invalid_backup','未成功 Native 步骤不能含 measurement');
      }catch{fail('invalid_backup','Native 备份状态、事件或结果不一致');}
    }
    for(const detail of backup.data.runs)if(isNativePlan(detail.plan)&&detail.steps.some(step=>(['succeeded','failed'].includes(step.status)||step.status==='cancelled'&&step.started_at!==undefined)&&!attemptSteps.has(`${detail.run.id}:${step.id}`)))fail('invalid_backup','Native 执行结果缺少 attempt 历史');
    return this.transaction(()=>{
      if(this.db.get('SELECT id FROM desk_batch_task LIMIT 1')||this.db.get('SELECT id FROM desk_batch_plan LIMIT 1')||this.db.get('SELECT id FROM desk_batch_run LIMIT 1'))fail('restore_conflict','只能恢复到空任务库，不覆盖现有记录');
      for(const task of backup.data.tasks)this.db.run('INSERT INTO desk_batch_task VALUES(?,?,?,?)',[task.id,task.revision,task.archived?1:0,json(task)]);
      for(const source of backup.data.plans){const plan=clone(source);if(plan.status==='fresh')plan.status='invalidated';this.db.run('INSERT INTO desk_batch_plan VALUES(?,?,?,?)',[plan.id,plan.task_id,plan.status,json(plan)]);}
      for(const detail of backup.data.runs){const run=clone(detail.run),plan=clone(detail.plan);if(isExecutablePlan(plan)||isActiveRun(run.status))plan.status='invalidated';
        if(isActiveRun(run.status)){run.status='interrupted';run.finished_at=this.stamp();run.message='已从备份恢复，不自动重放';delete run.active_step_id;}
        this.db.run('INSERT INTO desk_batch_run VALUES(?,?,?,?,?,?,?)',[run.id,run.task_id,run.status,run.client_request_id,plan.digest,json(run),json(plan)]);
        for(const [i,source] of detail.steps.entries()){const step=clone(source);if(step.status==='pending'||step.status==='running'){step.status='interrupted';step.finished_at=this.stamp();}this.db.run('INSERT INTO desk_batch_step VALUES(?,?,?,?,?)',[run.id,step.id,step.status,i,json(step)]);}
        for(const event of detail.events)this.db.run('INSERT INTO desk_batch_event VALUES(?,?,?)',[run.id,event.seq,json(event)]);
        this.recount(run);this.writeRun(run);this.event(run.id,'restored','历史已恢复；旧预览与执行许可失效');
      }
      for(const detail of attempts){const ticket=nativeTicket(detail.ticket),state=importNativeAttemptHistory(detail.state),binding=state.spec;
        this.db.run('INSERT INTO desk_batch_native_attempt VALUES(?,?,?,?)',[binding.attempt_id,binding.run_id,binding.step_id,json({ticket,state})]);
        for(const [ordinal,event]of state.events.entries())this.db.run('INSERT INTO desk_batch_native_event VALUES(?,?,?,?)',[binding.attempt_id,event.id,ordinal,canonicalNativeAttemptEventPayload(event)]);
      }
      return {tasks:backup.data.tasks.length,runs:backup.data.runs.length};
    });
  }
  close():void {
    if(this.closed)return;
    try {this.transaction(()=>{this.recoverNativeAttempts();this.interruptActive('后台服务已关闭，任务不会自动重放');this.invalidatePlans();this.db.run("DELETE FROM desk_batch_meta WHERE key='owner'");});}
    finally {this.closed=true;this.db.close();}
  }
}
