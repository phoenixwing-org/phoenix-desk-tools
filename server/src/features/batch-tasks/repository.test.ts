import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it,vi } from 'vitest';
import { pnwCreateDb } from '@phoenix-wing/db-node';
import { BatchRepository, type BatchBackup } from './repository.js';
import {isCurrentPlan,isBatchStep,type CurrentBatchPlan,type LegacyBatchPlan,type BatchTask,type BatchRun,type BatchStep,type TaskDraft} from '../../../../shared/batch-tasks/contracts.js';
import {compilePlanV2,canonicalPlanPayloadV2,type NextPlan,type NextPlanInput} from '../../../../shared/batch-tasks/next-protocol.js';
import {createCurrentBatchPlan} from '../../../../shared/batch-tasks/envelope.js';
import {BATCH_MIGRATION_WRITE_WORKER} from './migration-worker.js';

const roots:string[]=[],repositories:BatchRepository[]=[];
const clock={value:Date.parse('2026-01-01T00:00:00.000Z')};let sequence=0;
function fixture(options:Parameters<typeof open>[1]={}) {const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-batch-repository-')));roots.push(root);return open(root,options);}
function open(root:string,options:ConstructorParameters<typeof BatchRepository>[1]={}) {const repo=new BatchRepository(root,{now:()=>clock.value,id:()=>`synthetic-${++sequence}`,...options});repositories.push(repo);return repo;}
const draft=(name='Synthetic read task'):TaskDraft=>({name,subjects:[{kind:'file',rel:'public-fixture.txt'}],actions:[{instance_id:'inspect-a',key:'file.inspect',version:1,params:{}}]});
function legacyPlanFor(task:BatchTask):LegacyBatchPlan {
  const items=task.subjects.map((subject,i)=>({id:`item-${i}`,subject,sha256:'a'.repeat(64),bytes:10}));
  const steps=items.flatMap(item=>task.actions.map(action=>({id:`${item.id}:${action.instance_id}`,item_id:item.id,action_instance_id:action.instance_id,applicable:true})));
  return {id:`plan-${++sequence}`,task_id:task.id,task_revision:task.revision,created_at:new Date(clock.value).toISOString(),expires_at:new Date(clock.value+60_000).toISOString(),status:'fresh',digest:'b'.repeat(64),items,actions:task.actions,steps,summary:{files:items.length,actions:task.actions.length,executable:steps.length,excluded:0},effects:['read_file','write_task_db']};
}
function wrap(prepared:NextPlan):CurrentBatchPlan{return createCurrentBatchPlan(prepared,createHash('sha256').update(canonicalPlanPayloadV2(prepared)).digest('hex'));}
function planFor(task:BatchTask,scope:'file'|'batch'='file'):CurrentBatchPlan {
  const items=task.subjects.map((subject,i)=>({id:`item-${i}`,subject,source_id:`source-${i}`}));
  return wrap(compilePlanV2({id:`plan-${++sequence}`,task_id:task.id,task_revision:task.revision,created_at:new Date(clock.value).toISOString(),expires_at:new Date(clock.value+60_000).toISOString(),
    items,actions:task.actions,descriptors:task.actions.map(action=>({key:action.key,version:action.version,scope,effects:['read_file','write_task_db'] as const,source_read_only:true,cancellation:'cooperative',result_schema_version:1,algorithm_version:'synthetic-v1'})),
    sources:items.map((item,i)=>({id:item.source_id,kind:'file',resource_id:`file-${i}`,rel:item.subject.rel,sha256:'a'.repeat(64),bytes:10})),
    resources:[...items.map((item,i)=>({id:`file-${i}`,kind:'file' as const,rel:item.subject.rel,access:'read' as const})),{id:'ledger',kind:'task_db',key:'batch_tasks',access:'write'}],
    steps:task.actions.flatMap<NextPlanInput['steps'][number]>(action=>scope==='batch'?[{id:`all-${action.instance_id}`,action_instance_id:action.instance_id,target:{scope:'batch' as const,item_ids:items.map(item=>item.id)},source_ids:items.map(item=>item.source_id),resource_ids:[...items.map((_,i)=>`file-${i}`),'ledger'],status:'ready' as const}]:items.map((item,i)=>({id:`${item.id}-${action.instance_id}`,action_instance_id:action.instance_id,target:{scope:'file' as const,item_id:item.id},source_ids:[item.source_id],resource_ids:[`file-${i}`,'ledger'],status:'ready' as const}))),
  }));
}
function accepted(repo:BatchRepository) {const task=repo.saveTask(draft()),plan=repo.savePlan(planFor(task));return {task,plan,detail:repo.acceptRun(plan.id,plan.digest,`request-${++sequence}`)};}
function code(operation:()=>unknown,expected:string) {try{operation();expect.fail('Expected repository rejection');}catch(error){expect(error).toMatchObject({code:expected});}}
function checksum(backup:BatchBackup) {backup.checksum=createHash('sha256').update(JSON.stringify(backup.data)).digest('hex');return backup;}
function legacyState(status:'queued'|'running'|'succeeded'='queued',owner?:{host:string;pid:number;nonce:string}){
  const repo=fixture(),task=repo.saveTask(draft()),plan=legacyPlanFor(task),preview=legacyPlanFor(task);repo.savePlan(plan);repo.savePlan(preview);repo.close();
  const stamp=new Date(clock.value).toISOString(),run:BatchRun={id:`legacy-run-${++sequence}`,task_id:task.id,task_revision:task.revision,task_name:task.name,plan_id:plan.id,client_request_id:`legacy-request-${sequence}`,status,created_at:stamp,cancel_requested:false,total:1,completed:status==='succeeded'?1:0,failed:0,...(status==='running'?{started_at:stamp,active_step_id:plan.steps[0].id}:{}),...(status==='succeeded'?{started_at:stamp,finished_at:stamp}:{})};
  const step:BatchStep={id:plan.steps[0].id,run_id:run.id,item_id:plan.items[0].id,subject:plan.items[0].subject,action_instance_id:plan.actions[0].instance_id,action_key:plan.actions[0].key,status:status==='succeeded'?'succeeded':status==='running'?'running':'pending',...(status==='running'?{started_at:stamp}:{}),...(status==='succeeded'?{started_at:stamp,finished_at:stamp,result:{synthetic:true}}:{})};
  const event={seq:1,run_id:run.id,type:'accepted',created_at:stamp,message:'Synthetic legacy event'},consumed={...plan,status:'consumed' as const};
  const db=pnwCreateDb(repo.path);db.exec('BEGIN IMMEDIATE');db.run("UPDATE desk_batch_meta SET value='1' WHERE key='schema_version'");
  if(owner)db.run("INSERT OR REPLACE INTO desk_batch_meta VALUES('owner',?)",[JSON.stringify(owner)]);
  for(const saved of [consumed,preview])db.run('UPDATE desk_batch_plan SET status=?,data_json=? WHERE id=?',[saved.status,JSON.stringify(saved),saved.id]);
  db.run('INSERT INTO desk_batch_run VALUES(?,?,?,?,?,?,?)',[run.id,task.id,run.status,run.client_request_id,plan.digest,JSON.stringify(run),JSON.stringify(plan)]);
  db.run('INSERT INTO desk_batch_step VALUES(?,?,?,?,?)',[run.id,step.id,step.status,0,JSON.stringify(step)]);db.run('INSERT INTO desk_batch_event VALUES(?,?,?)',[run.id,1,JSON.stringify(event)]);db.exec('COMMIT');db.close();
  const backup=checksum({format:'desk-batch-tasks-backup',version:1,schema_version:1,created_at:stamp,checksum:'',data:{tasks:[task],plans:[consumed,preview],runs:[{run,steps:[step],events:[event],plan}]}});
  return {repo,task,plan,preview,run,step,backup};
}
function version2State(status:'queued'|'running'|'succeeded'='queued'){
  const repo=fixture(),saved=accepted(repo);if(status!=='queued'){repo.claimQueuedRun();repo.startStep(saved.detail.run.id,saved.detail.steps[0].id);if(status==='succeeded'){repo.finishStep(saved.detail.run.id,saved.detail.steps[0].id,'succeeded',{synthetic:true});repo.finishRun(saved.detail.run.id,'succeeded');}}
  const backup=repo.exportBackup();backup.version=2;backup.schema_version=2;delete backup.data.native_attempts;checksum(backup);repo.close();
  const db=pnwCreateDb(repo.path);db.exec('BEGIN IMMEDIATE; DROP TABLE desk_batch_native_event; DROP TABLE desk_batch_native_attempt;');db.run("UPDATE desk_batch_meta SET value='2' WHERE key='schema_version'");
  for(const plan of backup.data.plans)db.run('UPDATE desk_batch_plan SET status=?,data_json=? WHERE id=?',[plan.status,JSON.stringify(plan),plan.id]);
  for(const detail of backup.data.runs){db.run('UPDATE desk_batch_run SET status=?,data_json=?,plan_json=? WHERE id=?',[detail.run.status,JSON.stringify(detail.run),JSON.stringify(detail.plan),detail.run.id]);for(const step of detail.steps)db.run('UPDATE desk_batch_step SET status=?,data_json=? WHERE run_id=? AND id=?',[step.status,JSON.stringify(step),detail.run.id,step.id]);db.run('DELETE FROM desk_batch_event WHERE run_id=?',[detail.run.id]);for(const event of detail.events)db.run('INSERT INTO desk_batch_event VALUES(?,?,?)',[detail.run.id,event.seq,JSON.stringify(event)]);}
  db.exec('COMMIT');db.close();return {repo,...saved,backup};
}
afterEach(()=>{vi.restoreAllMocks();for(const repo of repositories.splice(0)){try{repo.close();}catch{/* ownership intentionally displaced by a synthetic test */}}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});clock.value=Date.parse('2026-01-01T00:00:00.000Z');});

describe('BatchRepository: durable read-only task ledger',()=>{
  it('uses its own DELETE-journal database, guards revisions, and retains history after reopening',()=>{
    const repo=fixture(),task=repo.saveTask(draft());
    expect(fs.existsSync(path.join(repo.root,'.phoenix','phoenix-workspace.sqlite'))).toBe(false);
    const inspect=pnwCreateDb(repo.path);expect(inspect.get('PRAGMA journal_mode')).toEqual({journal_mode:'delete'});inspect.close();
    const updated=repo.saveTask({...draft(),name:'Edited synthetic task'},task.id,task.revision);
    expect(updated.revision).toBe(2);code(()=>repo.saveTask(draft(),task.id,1),'revision_conflict');
    repo.close();const reopened=open(repo.root);expect(reopened.getTask(task.id)).toEqual(updated);
    const archived=reopened.archiveTask(task.id,2,true);expect(reopened.listTasks()).toEqual([]);expect(reopened.listTasks(true)).toEqual([archived]);
  });
  it('accepts once for lost responses and refuses request-ID collisions without consuming another plan',()=>{
    const repo=fixture(),{plan,detail}=accepted(repo);
    expect(repo.acceptRun(plan.id,plan.digest,detail.run.client_request_id)).toEqual(detail);
    expect(repo.findRunByRequest(detail.run.client_request_id)).toEqual(detail.run);
    const next=repo.savePlan(planFor(repo.getTask(detail.run.task_id)!));
    code(()=>repo.acceptRun(next.id,next.digest,detail.run.client_request_id),'idempotency_conflict');
    expect(repo.getPlan(next.id)?.status).toBe('fresh');expect(repo.listRuns()).toHaveLength(1);
    code(()=>repo.acceptRun(plan.id,plan.digest,'second-request'),'plan_invalid');
  });
  it('rejects stale/expired plans and freezes the accepted scope when a task is edited',()=>{
    const repo=fixture(),{task,plan,detail}=accepted(repo);
    repo.saveTask({...draft(),subjects:[{kind:'file',rel:'other-fixture.txt'}]},task.id,1);
    expect(repo.getRunPlan(detail.run.id)?.items).toEqual(plan.items);
    expect(repo.getRun(detail.run.id)?.run.task_revision).toBe(1);
    const pending=repo.savePlan(planFor(repo.getTask(task.id)!));clock.value+=60_001;
    code(()=>repo.acceptRun(pending.id,pending.digest,'expired-request'),'plan_invalid');
    expect(repo.getPlan(pending.id)?.status).toBe('fresh');
  });
  it('rolls back run, steps, events and plan consumption together after an injected SQL failure',()=>{
    const repo=fixture(),task=repo.saveTask(draft()),plan=repo.savePlan(planFor(task));
    const injection=pnwCreateDb(repo.path);injection.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON desk_batch_step BEGIN SELECT RAISE(ABORT,'synthetic insert failure'); END");injection.close();
    expect(()=>repo.acceptRun(plan.id,plan.digest,'atomic-request')).toThrow(/synthetic insert failure/);
    expect(repo.getPlan(plan.id)?.status).toBe('fresh');expect(repo.listRuns()).toEqual([]);
    const clear=pnwCreateDb(repo.path);expect(clear.get('SELECT COUNT(*) n FROM desk_batch_event')).toEqual({n:0});clear.exec('DROP TRIGGER synthetic_failure');clear.close();
    expect(repo.acceptRun(plan.id,plan.digest,'atomic-request').run.status).toBe('queued');
  });
  it('claims a single queued run, persists step results and monotonic events, and rejects late progress',()=>{
    const repo=fixture(),{detail}=accepted(repo);accepted(repo);
    const run=repo.claimQueuedRun()!;expect(run.id).toBe(detail.run.id);expect(repo.claimQueuedRun()).toBeUndefined();
    const step=detail.steps[0];repo.startStep(run.id,step.id);repo.finishStep(run.id,step.id,'succeeded',{bytes:10});
    const result=repo.finishRun(run.id,'succeeded');expect(result).toMatchObject({completed:1,failed:0,total:1});
    expect(repo.requestCancel(run.id)).toEqual(result);code(()=>repo.finishStep(run.id,step.id,'failed'),'state_conflict');
    code(()=>repo.finishRun(run.id,'failed'),'state_conflict');
    const events=repo.getRun(run.id)!.events;expect(events.map(e=>e.seq)).toEqual([1,2,3,4,5]);expect(repo.getRun(run.id,3)!.events.map(e=>e.seq)).toEqual([4,5]);
    expect(repo.claimQueuedRun()).toBeDefined();
  });
  it('cancels queued work immediately but does not turn an in-flight cancellation into completion',()=>{
    const repo=fixture(),queued=accepted(repo).detail;expect(repo.requestCancel(queued.run.id)).toMatchObject({status:'cancelled',cancel_requested:true,completed:0});
    expect(repo.getRun(queued.run.id)!.steps[0].status).toBe('cancelled');
    const running=accepted(repo).detail;repo.claimQueuedRun();repo.startStep(running.run.id,running.steps[0].id);
    expect(repo.requestCancel(running.run.id).status).toBe('cancel_requested');expect(repo.getRun(running.run.id)!.steps[0].status).toBe('running');
    code(()=>repo.startStep(running.run.id,running.steps[0].id),'state_conflict');
    repo.finishStep(running.run.id,running.steps[0].id,'succeeded',{read:true});
    expect(repo.finishRun(running.run.id,'cancelled')).toMatchObject({status:'cancelled',completed:1});
  });
  it('rejects oversized results before mutating step state or event history',()=>{
    const repo=fixture(),{detail}=accepted(repo);repo.claimQueuedRun();repo.startStep(detail.run.id,detail.steps[0].id);
    const before=repo.getRun(detail.run.id);code(()=>repo.finishStep(detail.run.id,detail.steps[0].id,'succeeded',{large:'x'.repeat(256*1024)}),'resource_limit');
    expect(repo.getRun(detail.run.id)).toEqual(before);
  });
  it('requires a proven dead same-host owner; no heartbeat timeout or cross-host takeover',()=>{
    const repo=fixture({host:'synthetic-host',pid:123456});const {detail}=accepted(repo);
    code(()=>open(repo.root,{host:'synthetic-host',isPidAlive:()=>true}),'owner_busy');
    code(()=>open(repo.root,{host:'other-host',isPidAlive:()=>false}),'owner_busy');
    const next=open(repo.root,{host:'synthetic-host',isPidAlive:()=>false});
    expect(next.getRun(detail.run.id)?.run.status).toBe('interrupted');expect(next.claimQueuedRun()).toBeUndefined();
    expect(next.getRun(detail.run.id)?.steps[0].status).toBe('interrupted');code(()=>repo.listRuns(),'owner_conflict');
  });
  it('interrupts all active work on orderly close and invalidates unconsumed previews',()=>{
    const repo=fixture(),{detail,task}=accepted(repo);const fresh=repo.savePlan(planFor(task));repo.close();
    const next=open(repo.root);expect(next.getRun(detail.run.id)?.run.status).toBe('interrupted');expect(next.getPlan(fresh.id)?.status).toBe('invalidated');
    code(()=>next.acceptRun(fresh.id,fresh.digest,'after-restart'),'plan_invalid');
  });
  it('round-trips logical backups only into empty ledgers and never restores execution authorization',()=>{
    const source=fixture(),{detail,task}=accepted(source);const fresh=source.savePlan(planFor(task));source.claimQueuedRun();source.startStep(detail.run.id,detail.steps[0].id);
    const backup=source.exportBackup();const target=fixture();expect(target.restoreBackup(backup)).toEqual({tasks:1,runs:1});
    expect(target.getRun(detail.run.id)?.run).toMatchObject({status:'interrupted',completed:0});
    expect(target.getPlan(fresh.id)?.status).toBe('invalidated');expect(target.getRunPlan(detail.run.id)?.status).toBe('invalidated');expect(target.claimQueuedRun()).toBeUndefined();
    code(()=>target.restoreBackup(backup),'restore_conflict');
    const corrupt=structuredClone(backup);corrupt.data.tasks[0].name='corrupted';code(()=>fixture().restoreBackup(corrupt),'invalid_backup');
    const unsafe=structuredClone(backup);unsafe.data.tasks[0].subjects[0].rel='../outside.txt';code(()=>fixture().restoreBackup(checksum(unsafe)),'invalid_arguments');
  });
  it('rejects unsafe database paths, WAL sidecars, and stale SQLite locks without deleting anything',()=>{
    const repo=fixture(),root=repo.root,dbPath=repo.path;repo.close();
    fs.mkdirSync(`${dbPath}.lock`);expect(()=>open(root)).toThrow();expect(fs.statSync(`${dbPath}.lock`).isDirectory()).toBe(true);fs.rmdirSync(`${dbPath}.lock`);
    fs.writeFileSync(`${dbPath}-wal`,'synthetic');code(()=>open(root),'unsupported_journal');expect(fs.readFileSync(`${dbPath}-wal`,'utf8')).toBe('synthetic');fs.unlinkSync(`${dbPath}-wal`);
    const alias=path.join(root,'aliased-root');fs.symlinkSync(root,alias);code(()=>open(alias),'unsafe_path');
  });
  it.each(['sentinel','empty-sqlite','zero-bytes'] as const)('refuses an existing %s file before read-write initialization and preserves every source byte',kind=>{
    const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'desk-batch-unrecognized-')));roots.push(root);const directory=path.join(root,'.phoenix'),filename=path.join(directory,'batch-tasks.sqlite');fs.mkdirSync(directory);
    if(kind==='zero-bytes')fs.writeFileSync(filename,Buffer.alloc(0));
    else{const db=pnwCreateDb(filename);if(kind==='sentinel')db.exec("CREATE TABLE synthetic_sentinel(value TEXT NOT NULL); INSERT INTO synthetic_sentinel VALUES('independent preserved marker');");else db.exec('VACUUM');db.close();}
    const before=fs.readFileSync(filename),digest=createHash('sha256').update(before).digest('hex'),entries=fs.readdirSync(directory).sort(),stat=fs.lstatSync(filename);
    code(()=>open(root),'schema_mismatch');
    expect(fs.readFileSync(filename)).toEqual(before);expect(createHash('sha256').update(fs.readFileSync(filename)).digest('hex')).toBe(digest);expect(fs.lstatSync(filename).ino).toBe(stat.ino);expect(fs.readdirSync(directory).sort()).toEqual(entries);
    if(kind==='empty-sqlite')expect(before.subarray(0,16).toString()).toBe('SQLite format 3\u0000');
    if(kind!=='zero-bytes'){const check=pnwCreateDb(filename);expect(check.all("SELECT name FROM sqlite_master WHERE name LIKE 'desk_batch_%'")).toEqual([]);if(kind==='sentinel')expect(check.get('SELECT value FROM synthetic_sentinel')).toEqual({value:'independent preserved marker'});check.close();expect(fs.readFileSync(filename)).toEqual(before);}
  });
  it('validates bounded explicit file selections and rejects incomplete step expansion',()=>{
    const repo=fixture();code(()=>repo.saveTask({...draft(),subjects:[{kind:'file',rel:'../escape'}]}),'invalid_arguments');
    code(()=>repo.saveTask({...draft(),subjects:Array.from({length:201},(_,i)=>({kind:'file',rel:`synthetic-${i}.txt`}))}),'invalid_arguments');
    const task=repo.saveTask(draft()),plan=planFor(task);plan.steps=[];code(()=>repo.savePlan(plan),'invalid_arguments');
  });
  it('freezes missing-file exclusions without making them executable or reporting them as successful',()=>{
    const repo=fixture(),task=repo.saveTask({...draft(),subjects:[{kind:'file',rel:'public-fixture.txt'},{kind:'file',rel:'missing-fixture.txt'}]});
    let plan=planFor(task);plan.items[1]={...plan.items[1],sha256:null,bytes:null,error:'File unavailable'};
    code(()=>repo.savePlan(plan),'invalid_arguments');
    const {protocol_version:_v,effects:_e,summary:_s,completeness:_c,...input}=JSON.parse(JSON.stringify(plan.prepared)) as NextPlan;
    const failed=input.sources[1];if(failed.kind!=='file')throw new Error('Synthetic fixture');
    const prepared=compilePlanV2({...input,items:input.items.map((item,i)=>i===1?{...item,error:'File unavailable'}:item),sources:input.sources.map((source,i)=>i===1?{id:source.id,kind:'file',resource_id:source.resource_id,rel:failed.rel,sha256:null,bytes:null,error:'File unavailable'}:source),steps:input.steps.map((step,i)=>i===1?{...step,status:'blocked',reason:'File unavailable'}:step)});
    plan=wrap(prepared);
    repo.savePlan(plan);const detail=repo.acceptRun(plan.id,plan.digest,'with-excluded-file');
    expect(detail.steps.map(s=>s.status)).toEqual(['pending','blocked']);expect(detail.run.completed).toBe(0);expect(detail.run.failed).toBe(1);
    repo.claimQueuedRun();repo.startStep(detail.run.id,detail.steps[0].id);repo.finishStep(detail.run.id,detail.steps[0].id,'succeeded');
    code(()=>repo.finishRun(detail.run.id,'succeeded'),'state_conflict');expect(repo.finishRun(detail.run.id,'partial')).toMatchObject({total:2,completed:1,failed:1});
  });
  it('paginates events for the API while retaining all events in logical backups',()=>{
    const repo=fixture(),{detail}=accepted(repo),injection=pnwCreateDb(repo.path);
    injection.exec('BEGIN IMMEDIATE');for(let seq=2;seq<=300;seq++)injection.run('INSERT INTO desk_batch_event VALUES(?,?,?)',[detail.run.id,seq,JSON.stringify({seq,run_id:detail.run.id,type:'synthetic',created_at:new Date(clock.value).toISOString(),message:'Synthetic event'})]);injection.exec('COMMIT');injection.close();
    expect(repo.getRun(detail.run.id)?.events).toHaveLength(256);expect(repo.getRun(detail.run.id,256)?.events).toHaveLength(44);
    const backup=repo.exportBackup();expect(backup.data.runs[0].events).toHaveLength(300);
    const restored=fixture();restored.restoreBackup(backup);expect(restored.getRun(detail.run.id,300)?.events[0].type).toBe('restored');
  });
  it('checks the open task database identity before performing another read or mutation',()=>{
    const repo=fixture(),original=repo.path,moved=`${repo.path}.synthetic-moved`;fs.renameSync(original,moved);fs.writeFileSync(original,'synthetic replacement');
    code(()=>repo.listTasks(),'unsafe_path');code(()=>repo.saveTask(draft()),'unsafe_path');
    fs.unlinkSync(original);fs.renameSync(moved,original);expect(repo.listTasks()).toEqual([]);
  });
  it('refuses a hard-linked source SQLite database before creating any task schema or changing its bytes',()=>{
    const target=fixture();target.close();fs.unlinkSync(target.path);
    const source=path.join(target.root,'synthetic-source.sqlite'),db=pnwCreateDb(source);
    db.exec("CREATE TABLE synthetic_source(value TEXT); INSERT INTO synthetic_source VALUES('original')");db.close();
    const before=createHash('sha256').update(fs.readFileSync(source)).digest('hex');fs.linkSync(source,target.path);
    code(()=>open(target.root),'unsafe_path');
    expect(createHash('sha256').update(fs.readFileSync(source)).digest('hex')).toBe(before);
    const inspect=pnwCreateDb(source);expect(inspect.get("SELECT name FROM sqlite_master WHERE name LIKE 'desk_batch_%' LIMIT 1")).toBeUndefined();inspect.close();
    expect(createHash('sha256').update(fs.readFileSync(source)).digest('hex')).toBe(before);
  });
  it('rejects journal hard links, symlinks and dangling aliases before SQLite can truncate their targets',()=>{
    const target=fixture();target.close();const source=path.join(target.root,'synthetic-journal-source.sqlite'),db=pnwCreateDb(source);
    db.exec("CREATE TABLE synthetic_source(value TEXT); INSERT INTO synthetic_source VALUES('keep')");db.close();
    const sourceHash=createHash('sha256').update(fs.readFileSync(source)).digest('hex'),targetHash=createHash('sha256').update(fs.readFileSync(target.path)).digest('hex');
    const journal=`${target.path}-journal`;
    for(const alias of ['hard','symbolic','dangling'] as const){
      if(alias==='hard')fs.linkSync(source,journal);else fs.symlinkSync(alias==='symbolic'?source:path.join(target.root,'missing-journal-target'),journal);
      code(()=>open(target.root),'unsafe_path');expect(createHash('sha256').update(fs.readFileSync(source)).digest('hex')).toBe(sourceHash);
      expect(createHash('sha256').update(fs.readFileSync(target.path)).digest('hex')).toBe(targetHash);expect(fs.lstatSync(journal)).toBeDefined();fs.unlinkSync(journal);
    }
    fs.symlinkSync(path.join(target.root,'missing-wal-target'),`${target.path}-wal`);code(()=>open(target.root),'unsupported_journal');
  });
  it('rechecks hard-link counts and journal aliases on an already open repository',()=>{
    const repo=fixture(),before=createHash('sha256').update(fs.readFileSync(repo.path)).digest('hex'),alias=path.join(repo.root,'synthetic-hard-alias.sqlite');
    fs.linkSync(repo.path,alias);code(()=>repo.saveTask(draft()),'unsafe_path');code(()=>repo.listTasks(),'unsafe_path');
    expect(createHash('sha256').update(fs.readFileSync(alias)).digest('hex')).toBe(before);fs.unlinkSync(alias);
    const source=path.join(repo.root,'synthetic-journal.txt');fs.writeFileSync(source,'must remain unchanged');fs.linkSync(source,`${repo.path}-journal`);
    code(()=>repo.saveTask(draft()),'unsafe_path');expect(fs.readFileSync(source,'utf8')).toBe('must remain unchanged');
    expect(createHash('sha256').update(fs.readFileSync(repo.path)).digest('hex')).toBe(before);fs.unlinkSync(`${repo.path}-journal`);expect(repo.listTasks()).toEqual([]);
  });
  it('rejects re-signed backups with impossible terminal outcomes, counts or revision links without importing rows',()=>{
    const source=fixture(),{detail,task}=accepted(source);source.claimQueuedRun();source.startStep(detail.run.id,detail.steps[0].id);source.finishStep(detail.run.id,detail.steps[0].id,'succeeded',{read:true});
    code(()=>source.finishRun(detail.run.id,'partial'),'state_conflict');source.finishRun(detail.run.id,'succeeded');
    // An older, immutable run remains valid after its mutable definition advances.
    source.saveTask({...draft('Edited synthetic task'),subjects:[{kind:'file',rel:'new-fixture.txt'}]},task.id,task.revision);
    const backup=source.exportBackup(),valid=fixture();expect(valid.restoreBackup(backup)).toEqual({tasks:1,runs:1});expect(valid.getRun(detail.run.id)?.run).toMatchObject({status:'succeeded',task_revision:1,completed:1,failed:0});
    const mutations:Array<(value:BatchBackup)=>void>=[
      value=>{const d=value.data.runs[0];d.steps[0].status='failed';d.run.completed=0;d.run.failed=1;},
      value=>{value.data.runs[0].run.completed=0;},
      value=>{value.data.runs[0].run.status='partial';},
      value=>{const d=value.data.runs[0];d.run.task_revision=3;d.plan.task_revision=3;value.data.plans[0].task_revision=3;},
      value=>{value.data.runs[0].run.active_step_id='nonexistent-step';},
      value=>{value.data.runs[0].run.plan_id='missing-plan';},
    ];
    for(const mutate of mutations){const broken=structuredClone(backup);mutate(broken);const target=fixture();code(()=>target.restoreBackup(checksum(broken)),'invalid_backup');expect(target.listTasks(true)).toEqual([]);expect(target.listRuns()).toEqual([]);}
  });
  it('deduplicates a lost new-task response by a stable creation ID without advancing its revision',()=>{
    const repo=fixture(),creationId='07e8875e-386a-45a2-b2be-e527c13cda66',task=repo.saveTask(draft(),undefined,undefined,creationId);
    clock.value+=1000;expect(repo.saveTask(draft(),undefined,undefined,creationId)).toEqual(task);
    expect(task.id).toBe(creationId);expect(repo.listTasks()).toEqual([task]);
    repo.close();const reopened=open(repo.root);expect(reopened.saveTask(draft(),undefined,undefined,creationId)).toEqual(task);
  });
  it('rejects a creation ID reused for a different definition, an edited revision or an archived task',()=>{
    const repo=fixture(),creationId='synthetic-create-key',task=repo.saveTask(draft(),undefined,undefined,creationId);
    const changed:TaskDraft[]=[{...draft(),name:'Different task'},{...draft(),subjects:[{kind:'file',rel:'different-fixture.txt'}]},
      {...draft(),actions:[{instance_id:'inspect-b',key:'file.inspect',version:1,params:{}}]}];
    for(const value of changed)code(()=>repo.saveTask(value,undefined,undefined,creationId),'creation_conflict');
    code(()=>repo.saveTask(draft(),task.id,task.revision,creationId),'invalid_arguments');
    code(()=>repo.saveTask(draft(),undefined,undefined,'../invalid-key'),'invalid_arguments');expect(repo.listTasks()).toEqual([task]);
    const updated=repo.saveTask(draft(),task.id,task.revision);expect(updated.revision).toBe(2);
    code(()=>repo.saveTask(draft(),undefined,undefined,creationId),'creation_conflict');
    const archived=repo.saveTask(draft('Archive candidate'),undefined,undefined,'archive-create-key');repo.archiveTask(archived.id,1,true);
    code(()=>repo.saveTask(draft('Archive candidate'),undefined,undefined,'archive-create-key'),'creation_conflict');
    expect(repo.listTasks(true)).toHaveLength(2);
  });
  it('rejects repeated restoration of colliding creation IDs rather than overwriting existing definitions',()=>{
    const source=fixture(),task=source.saveTask(draft(),undefined,undefined,'restore-create-key'),backup=source.exportBackup(),target=fixture();target.restoreBackup(backup);
    code(()=>target.restoreBackup(backup),'restore_conflict');expect(target.getTask(task.id)).toEqual(task);
    const other=fixture();other.saveTask(draft('Existing target'),undefined,undefined,task.id);code(()=>other.restoreBackup(backup),'restore_conflict');expect(other.getTask(task.id)?.name).toBe('Existing target');
  });
  it('accepts a whole-batch action once, persists all subjects and never fabricates a single-file target',()=>{
    const repo=fixture(),task=repo.saveTask({...draft(),subjects:[{kind:'file',rel:'public-alpha.txt'},{kind:'file',rel:'public-bravo.txt'}]}),plan=repo.savePlan(planFor(task,'batch'));
    const detail=repo.acceptRun(plan.id,plan.digest,'batch-request');expect(detail.steps).toHaveLength(1);expect(detail.run.total).toBe(1);
    expect(isBatchStep(detail.steps[0])).toBe(true);expect(detail.steps[0]).toMatchObject({scope:'batch',item_ids:['item-0','item-1'],subjects:task.subjects});
    expect(detail.steps[0]).not.toHaveProperty('item_id');expect(detail.steps[0]).not.toHaveProperty('subject');
    expect(repo.acceptRun(plan.id,plan.digest,'batch-request')).toEqual(detail);repo.claimQueuedRun();repo.startStep(detail.run.id,detail.steps[0].id);repo.finishStep(detail.run.id,detail.steps[0].id,'succeeded',{members:2});repo.finishRun(detail.run.id,'succeeded');
    const target=fixture();target.restoreBackup(repo.exportBackup());expect(target.getRun(detail.run.id)?.steps).toEqual(repo.getRun(detail.run.id)?.steps);
  });
  it('freezes explicit cache-read effects, owned temporary lease metadata and projection hash',()=>{
    const repo=fixture(),task=repo.saveTask(draft()),base=planFor(task,'batch').prepared,{protocol_version:_v,effects:_e,summary:_s,completeness:_c,...input}=base;
    const prepared=compilePlanV2({...input,
      descriptors:input.descriptors.map(descriptor=>({...descriptor,effects:['read_file','read_cache','write_task_db']})),
      sources:[...input.sources,{id:'cache-source',kind:'cache',resource_id:'cache-resource',selector:'synthetic-exact-row',sha256:'c'.repeat(64),schema_version:1,algorithm_version:'synthetic-cache-v1'}],
      resources:[...input.resources,{id:'cache-resource',kind:'cache',key:'synthetic_geometry',access:'read',lease:{mode:'host_read_only',temporary_coordination:true,ownership:'own_lock_only',reclaim:false}}],
      steps:input.steps.map(step=>({...step,source_ids:[...step.source_ids,'cache-source'],resource_ids:[...step.resource_ids,'cache-resource']}))});
    const plan=repo.savePlan(wrap(prepared)),detail=repo.acceptRun(plan.id,plan.digest,'cache-request');
    expect(repo.getRunPlan(detail.run.id)).toMatchObject({protocol_version:2,effects:['read_file','read_cache','write_task_db'],prepared:{sources:expect.arrayContaining([expect.objectContaining({kind:'cache',sha256:'c'.repeat(64)})])}});
    const backup=repo.exportBackup();expect(backup).toMatchObject({version:3,schema_version:3,data:{native_attempts:[]}});const target=fixture();target.restoreBackup(backup);expect(target.getRun(detail.run.id)?.run.status).toBe('interrupted');
  });
  it('rejects wrapper/digest tampering both on save and again inside admission',()=>{
    const repo=fixture(),task=repo.saveTask(draft()),plan=planFor(task);plan.digest='0'.repeat(64);code(()=>repo.savePlan(plan),'invalid_arguments');
    const valid=repo.savePlan(planFor(task)),changed=structuredClone(valid);changed.summary.files=3;
    const db=pnwCreateDb(repo.path);db.run('UPDATE desk_batch_plan SET data_json=? WHERE id=?',[JSON.stringify(changed),valid.id]);db.close();
    code(()=>repo.acceptRun(valid.id,valid.digest,'tampered'),'invalid_arguments');expect(repo.listRuns()).toEqual([]);
  });
  it('can retain a v1 plan for history but never accepts it as current authority',()=>{
    const repo=fixture(),task=repo.saveTask(draft()),plan=repo.savePlan(legacyPlanFor(task));expect(isCurrentPlan(plan)).toBe(false);
    code(()=>repo.acceptRun(plan.id,plan.digest,'legacy-admission'),'plan_invalid');expect(repo.listRuns()).toEqual([]);
    expect(repo.getPlan(plan.id)).toEqual(plan);
  });
  it.each(['queued','running','succeeded'] as const)('preserves a pre-migration logical v1 backup before handling old %s history',status=>{
    const legacy=legacyState(status),repo=open(legacy.repo.root),db=pnwCreateDb(repo.path);
    expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'3'});
    const saved=db.get<{value:string}>("SELECT value FROM desk_batch_meta WHERE key='migration_backup'")!;db.close();
    expect(saved.value).toMatch(/^\.phoenix\/batch-task-migrations\/[a-f0-9-]+\.json$/u);
    const filename=path.join(repo.root,saved.value),backup=JSON.parse(fs.readFileSync(filename,'utf8')) as BatchBackup;
    expect(backup).toMatchObject({version:1,schema_version:1,data:legacy.backup.data});expect(checksum(structuredClone(backup)).checksum).toBe(backup.checksum);
    expect(fs.lstatSync(filename).nlink).toBe(1);expect(fs.lstatSync(filename).mode&0o777).toBe(0o600);
    expect(repo.getPlan(legacy.preview.id)?.status).toBe('invalidated');
    expect(repo.getRun(legacy.run.id)?.run.status).toBe(status==='succeeded'?'succeeded':'interrupted');expect(repo.claimQueuedRun()).toBeUndefined();
    expect(repo.getRunPlan(legacy.run.id)).toEqual(legacy.plan);expect(repo.getRunPlan(legacy.run.id)?.digest).toBe(legacy.plan.digest);
    if(status==='succeeded')expect(repo.getRun(legacy.run.id)?.run).toEqual(legacy.run);
    code(()=>repo.acceptRun(legacy.plan.id,legacy.plan.digest,legacy.run.client_request_id),'plan_invalid');
    const target=fixture();target.restoreBackup(backup);expect(target.getRun(legacy.run.id)?.run.status).toBe(status==='succeeded'?'succeeded':'interrupted');
  });
  it.each(['queued','running','succeeded'] as const)('migrates real six-table schema2 %s history only after an exact version2 backup',status=>{
    const old=version2State(status),repo=open(old.repo.root),db=pnwCreateDb(repo.path),saved=db.get<{value:string}>("SELECT value FROM desk_batch_meta WHERE key='migration_backup'")!;
    expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'3'});expect(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'desk_batch_native_%'")).toHaveLength(2);db.close();
    const preserved=JSON.parse(fs.readFileSync(path.join(repo.root,saved.value),'utf8')) as BatchBackup;expect(preserved).toMatchObject({version:2,schema_version:2,data:old.backup.data});expect(checksum(structuredClone(preserved)).checksum).toBe(preserved.checksum);
    expect(repo.getRunPlan(old.detail.run.id)).toEqual(old.backup.data.runs[0].plan);expect(repo.getRun(old.detail.run.id)?.run.status).toBe(status==='succeeded'?'succeeded':'interrupted');expect(repo.claimQueuedRun()).toBeUndefined();
    const target=fixture();target.restoreBackup(preserved);expect(target.getRun(old.detail.run.id)?.run.status).toBe(status==='succeeded'?'succeeded':'interrupted');
  });
  it('rejects an unknown schema before creating schema3 tables or migration artifacts',()=>{
    const old=version2State(),db=pnwCreateDb(old.repo.path);db.run("UPDATE desk_batch_meta SET value='999' WHERE key='schema_version'");db.close();code(()=>open(old.repo.root),'schema_mismatch');
    const inspect=pnwCreateDb(old.repo.path);expect(inspect.all("SELECT name FROM sqlite_master WHERE name LIKE 'desk_batch_native_%'")).toEqual([]);expect(inspect.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'999'});inspect.close();expect(fs.existsSync(path.join(old.repo.root,'.phoenix','batch-task-migrations'))).toBe(false);
  });
  it('rolls back new native tables and metadata together if the schema3 marker fails after backup',()=>{
    const old=version2State(),db=pnwCreateDb(old.repo.path);db.exec("CREATE TRIGGER schema3_insert_failure BEFORE INSERT ON desk_batch_meta WHEN NEW.key='schema_version' AND NEW.value='3' BEGIN SELECT RAISE(ABORT,'synthetic schema3 marker failure'); END");db.close();
    expect(()=>open(old.repo.root)).toThrow(/synthetic schema3 marker failure/);const inspect=pnwCreateDb(old.repo.path);expect(inspect.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'2'});expect(inspect.all("SELECT name FROM sqlite_master WHERE name LIKE 'desk_batch_native_%'")).toEqual([]);expect(inspect.get('SELECT status FROM desk_batch_run WHERE id=?',[old.detail.run.id])).toEqual({status:'queued'});expect(inspect.get("SELECT value FROM desk_batch_meta WHERE key='migration_backup'")).toBeUndefined();inspect.close();
    const names=fs.readdirSync(path.join(old.repo.root,'.phoenix','batch-task-migrations'));expect(names).toHaveLength(1);expect(JSON.parse(fs.readFileSync(path.join(old.repo.root,'.phoenix','batch-task-migrations',names[0]),'utf8'))).toMatchObject({version:2,data:old.backup.data});
  });
  it('checks a live legacy owner before producing any backup or changing the schema marker',()=>{
    const legacy=legacyState('queued',{host:'synthetic-host',pid:123456,nonce:'legacy-owner'});
    code(()=>open(legacy.repo.root,{host:'synthetic-host',isPidAlive:()=>true}),'owner_busy');
    expect(fs.existsSync(path.join(legacy.repo.root,'.phoenix','batch-task-migrations'))).toBe(false);
    const db=pnwCreateDb(legacy.repo.path);expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'1'});expect(db.get('SELECT status FROM desk_batch_run WHERE id=?',[legacy.run.id])).toEqual({status:'queued'});db.close();
    const repo=open(legacy.repo.root,{host:'synthetic-host',isPidAlive:()=>false});expect(repo.getRun(legacy.run.id)?.run.status).toBe('interrupted');
  });
  it.each(['symlink','file'] as const)('does not migrate or interrupt records when the backup directory is an unsafe %s',kind=>{
    const legacy=legacyState(),directory=path.join(legacy.repo.root,'.phoenix','batch-task-migrations'),outside=fs.mkdtempSync(path.join(os.tmpdir(),'desk-batch-backup-target-'));roots.push(outside);
    if(kind==='symlink')fs.symlinkSync(outside,directory);else fs.writeFileSync(directory,'preserve');
    code(()=>open(legacy.repo.root),'migration_backup_failed');expect(fs.readdirSync(outside)).toEqual([]);
    const db=pnwCreateDb(legacy.repo.path);expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'1'});expect(db.get('SELECT status FROM desk_batch_run WHERE id=?',[legacy.run.id])).toEqual({status:'queued'});expect(db.get('SELECT status FROM desk_batch_plan WHERE id=?',[legacy.preview.id])).toEqual({status:'fresh'});db.close();
  });
  it('verifies original v1 backup bytes/checksum first and restores only read-only historical capability',()=>{
    const legacy=legacyState('succeeded'),target=fixture();const corrupt=structuredClone(legacy.backup);corrupt.data.runs[0].plan.digest='c'.repeat(64);
    code(()=>target.restoreBackup(corrupt),'invalid_backup');expect(target.listTasks(true)).toEqual([]);
    target.restoreBackup(legacy.backup);expect(target.getRun(legacy.run.id)?.run).toEqual(legacy.run);expect(target.getRunPlan(legacy.run.id)).toEqual(legacy.plan);expect(target.claimQueuedRun()).toBeUndefined();
    code(()=>target.acceptRun(legacy.plan.id,legacy.plan.digest,legacy.run.client_request_id),'plan_invalid');
    const upgraded=structuredClone(legacy.backup);upgraded.data.runs=[];upgraded.data.plans=[planFor(legacy.task)];code(()=>fixture().restoreBackup(checksum(upgraded)),'invalid_backup');
  });
  it('rejects a re-signed v2 batch backup with omitted subjects or a fake first-file target',()=>{
    const repo=fixture(),task=repo.saveTask({...draft(),subjects:[{kind:'file',rel:'alpha.txt'},{kind:'file',rel:'bravo.txt'}]}),plan=repo.savePlan(planFor(task,'batch'));repo.acceptRun(plan.id,plan.digest,'batch-backup');
    for(const mutation of ['omit','fake'] as const){const backup=repo.exportBackup(),step=backup.data.runs[0].steps[0];if(!isBatchStep(step))throw new Error('Synthetic fixture');
      if(mutation==='omit')step.subjects.pop();else Object.assign(step,{item_id:step.item_ids[0],subject:step.subjects[0]});
      code(()=>fixture().restoreBackup(checksum(backup)),'invalid_backup');
    }
  });
  it('keeps schema1 and old queue intact after a real migration-worker trailing append',()=>{
    const legacy=legacyState(),actual=childProcess.execFileSync;
    const prefix=String.raw`const fsHook=require('node:fs'),realSync=fsHook.fsyncSync;let appended=false;fsHook.fsyncSync=fd=>{realSync(fd);const s=fsHook.fstatSync(fd);if(!appended&&s.isFile()){appended=true;fsHook.writeSync(fd,Buffer.from('X'),0,1,s.size);realSync(fd);}};`;
    vi.spyOn(childProcess,'execFileSync').mockImplementation((file,args,options)=>actual(file,(args??[]).map(arg=>arg===BATCH_MIGRATION_WRITE_WORKER?prefix+arg:arg),options));
    code(()=>open(legacy.repo.root),'migration_backup_failed');
    const db=pnwCreateDb(legacy.repo.path);expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'1'});expect(db.get('SELECT status FROM desk_batch_run WHERE id=?',[legacy.run.id])).toEqual({status:'queued'});db.close();
    const directory=path.join(legacy.repo.root,'.phoenix','batch-task-migrations'),names=fs.readdirSync(directory);expect(names).toHaveLength(1);expect(()=>JSON.parse(fs.readFileSync(path.join(directory,names[0]),'utf8'))).toThrow();
  });
  it('does not follow a backup-parent symlink swapped after child CWD pinning',()=>{
    const legacy=legacyState(),actual=childProcess.execFileSync,outside=path.join(legacy.repo.root,'synthetic-outside');fs.mkdirSync(outside);
    const prefix=String.raw`const fsHook=require('node:fs'),realChdir=process.chdir;process.chdir=function(part){realChdir(part);if(part==='batch-task-migrations'){fsHook.renameSync('../batch-task-migrations','../moved-migrations');fsHook.symlinkSync('../../synthetic-outside','../batch-task-migrations');}};`;
    vi.spyOn(childProcess,'execFileSync').mockImplementation((file,args,options)=>actual(file,(args??[]).map(arg=>arg===BATCH_MIGRATION_WRITE_WORKER?prefix+arg:arg),options));
    code(()=>open(legacy.repo.root),'migration_backup_failed');expect(fs.readdirSync(outside)).toEqual([]);
    const db=pnwCreateDb(legacy.repo.path);expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'1'});expect(db.get('SELECT status FROM desk_batch_run WHERE id=?',[legacy.run.id])).toEqual({status:'queued'});db.close();
    expect(fs.readdirSync(path.join(legacy.repo.root,'.phoenix','moved-migrations'))).toHaveLength(1);
  });
  it('launches only the fixed Node worker with bounded stdin/output and no inherited NODE_OPTIONS',()=>{
    const legacy=legacyState(),actual=childProcess.execFileSync;let invoked=false;
    vi.spyOn(childProcess,'execFileSync').mockImplementation((file,args,options)=>{invoked=true;expect(file).toBe(process.execPath);expect(args).toEqual(['--input-type=commonjs','--eval',BATCH_MIGRATION_WRITE_WORKER]);expect(options).toMatchObject({cwd:legacy.repo.root,timeout:10_000,maxBuffer:4096});expect(options?.env).not.toHaveProperty('NODE_OPTIONS');return actual(file,args,options);});
    const repo=open(legacy.repo.root);expect(invoked).toBe(true);expect(repo.getRun(legacy.run.id)?.run.status).toBe('interrupted');
  });
  it('preserves schema1, original records and ownership when the backup-parent fsync fails',()=>{
    const legacy=legacyState(),actual=childProcess.execFileSync;
    const prefix=String.raw`const fsHook=require('node:fs'),realSync=fsHook.fsyncSync;fsHook.fsyncSync=function(fd){if(fsHook.fstatSync(fd).isDirectory()&&process.cwd().endsWith('/.phoenix'))throw new Error('Synthetic parent sync failure');return realSync(fd);};`;
    vi.spyOn(childProcess,'execFileSync').mockImplementation((file,args,options)=>actual(file,(args??[]).map(arg=>arg===BATCH_MIGRATION_WRITE_WORKER?prefix+arg:arg),options));
    code(()=>open(legacy.repo.root),'migration_backup_failed');
    const db=pnwCreateDb(legacy.repo.path);expect(db.get("SELECT value FROM desk_batch_meta WHERE key='schema_version'")).toEqual({value:'1'});
    expect(db.get("SELECT value FROM desk_batch_meta WHERE key='owner'")).toBeUndefined();expect(db.get("SELECT value FROM desk_batch_meta WHERE key='migration_backup'")).toBeUndefined();
    expect(JSON.parse(db.get<{data_json:string}>('SELECT data_json FROM desk_batch_run WHERE id=?',[legacy.run.id])!.data_json)).toEqual(legacy.run);
    expect(JSON.parse(db.get<{data_json:string}>('SELECT data_json FROM desk_batch_plan WHERE id=?',[legacy.preview.id])!.data_json)).toEqual(legacy.preview);db.close();
    expect(fs.readdirSync(path.join(legacy.repo.root,'.phoenix','batch-task-migrations'))).toEqual([]);
  });
});
