import {randomUUID,createHash}from'node:crypto';
import {setImmediate}from'node:timers/promises';
import {isCurrentPlan,isNativePlan,isBatchPlannedStep,type CurrentBatchPlan,type NativeBatchPlanV3,type BatchRun,type RunDetail,type ActionDescriptor}from'../../../../shared/batch-tasks/contracts.js';
import {compilePlanV2,canonicalPlanPayloadV2,type NextDescriptor,type NextEffect,type NextItem,type NextSource,type NextResource,type NextPreparedStep}from'../../../../shared/batch-tasks/next-protocol.js';
import {createCurrentBatchPlan,validateCurrentBatchPlan}from'../../../../shared/batch-tasks/envelope.js';
import {validateNativeBatchPlanV3}from'../../../../shared/batch-tasks/native-envelope.js';
import {NATIVE_SAVED_SHAPE_ACTION_V3}from'../../../../shared/batch-tasks/native-protocol.js';
import {fcstdWorkspace}from'../../lib/fcstdBatchFiles.js';
import {BatchRepository}from'./repository.js';
import {taskDraft,hasNativeTaskAction}from'./model.js';
import {NativeBatchRuntime,type NativeBatchRuntimeOptions}from'./native-runtime.js';
import {defaultBatchAdapters,readSubject,assertActive,type BatchActionAdapter,type BatchCachePreparation}from'./adapters.js';
import {readGeometryCacheSnapshot}from'./geometry-cache.js';
import {buildRetryDrafts}from'./retry-drafts.js';
const reason=(e:unknown)=>(e instanceof Error?e.message:String(e)).replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu,' ').slice(0,2048).trim()||'只读步骤未完成';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const EFFECTS:NextEffect[]=['read_file','read_cache','write_task_db'];
type ReadOnlyDescriptor=Omit<ActionDescriptor,'effects'|'cancellation'>&{effects:readonly NextEffect[];cancellation:'cooperative'};
type ReadOnlyAdapter=Omit<BatchActionAdapter,'descriptor'>&{descriptor:ReadOnlyDescriptor};
function normalizeDescriptor(value:ActionDescriptor):ReadOnlyDescriptor{
 const effects=EFFECTS.filter(effect=>value.effects.includes(effect));
 if(value.key===NATIVE_SAVED_SHAPE_ACTION_V3.key||value.phase!=='collect'||!Number.isSafeInteger(value.version)||value.version<1||value.cancellable!==true
  ||effects.length!==value.effects.length||!effects.includes('read_file')||!effects.includes('write_task_db')
  ||value.source_read_only!==undefined&&value.source_read_only!==true||value.cancellation!==undefined&&value.cancellation!=='cooperative')throw new Error('只开放版本化且可取消的只读采集Adapter');
 return {...value,effects,scope:value.scope??'file',source_read_only:true,cancellation:'cooperative',result_schema_version:value.result_schema_version??1,algorithm_version:value.algorithm_version??value.key+'-v'+value.version};
}
function frozenDescriptor(adapter:ReadOnlyAdapter):NextDescriptor{
 const d=adapter.descriptor;return {key:d.key,version:d.version,scope:d.scope??'file',effects:[...d.effects],source_read_only:true,cancellation:'cooperative',result_schema_version:d.result_schema_version!,algorithm_version:d.algorithm_version!};
}
/** One local coordinator owns each task DB. UI state never controls its lifetime.
 * V2 remains source/cache read-only. An explicit host-only Native profile shares
 * this queue but has separate V3 validation/admission; HTTP never enables it. */
export class BatchTaskService {
 readonly repository:BatchRepository;readonly root:string;
 private readonly adapters:Map<string,ReadOnlyAdapter>;
 private readonly native:NativeBatchRuntime|undefined;
 private pump:Promise<void>|undefined;private stopped=false;
 private retryTimer:ReturnType<typeof setTimeout>|undefined;private retries=0;
 private schedulerError='';private uncertainRun:string|undefined;
 private active:{id:string;controller:AbortController}|undefined;
 private admissions=new Map<string,{planId:string;digest:string;protocol:2|3;controller:AbortController;promise:Promise<BatchRun>}>();
 constructor(workspace:string,options:{adapters?:BatchActionAdapter[];repository?:BatchRepository;native?:NativeBatchRuntimeOptions}={}){
  this.root=fcstdWorkspace(workspace);
  const adapters=(options.adapters??defaultBatchAdapters()).map(a=>({...a,descriptor:normalizeDescriptor(a.descriptor)}));this.adapters=new Map(adapters.map(a=>[a.descriptor.key,a]));
  if(this.adapters.size!==adapters.length||adapters.some(a=>(a.descriptor.scope==='batch')!==Boolean(a.executeBatch)||Boolean(a.prepare)!==a.descriptor.effects.includes('read_cache')||a.descriptor.scope==='batch'&&Boolean(a.prepare)))throw new Error('动作范围或缓存读取端口声明不一致');
  this.repository=options.repository??new BatchRepository(this.root);
  try{this.native=options.native===undefined?undefined:new NativeBatchRuntime(this.root,this.repository,options.native);}
  catch(error){if(!options.repository)this.repository.close();throw error;}
 }
 catalog():ActionDescriptor[]{const catalog:ActionDescriptor[]=[...this.adapters.values()].map(a=>structuredClone(a.descriptor));if(this.native)catalog.push(structuredClone(this.native.descriptor));return catalog;}
 save(value:unknown,id?:string,revision?:number,creationId?:string){
  const draft=hasNativeTaskAction(value)?this.requireNative().validateDraft(value):taskDraft(value,this.catalog());
  return this.repository.saveTask(draft,id,revision,creationId);
 }
 private requireNative():NativeBatchRuntime{if(!this.native)throw new Error('Native动作尚未由宿主显式配置，未开放原生执行');return this.native;}
 listTasks(){return this.repository.listTasks(true);}
 private adapter(key:string,version:number){const a=this.adapters.get(key);if(!a||a.descriptor.version!==version)throw new Error('动作版本已不可用，请重新编辑和预览');return a;}
 async preview(id:string,revision:number,signal?:AbortSignal):Promise<CurrentBatchPlan|NativeBatchPlanV3>{
  const task=this.repository.getTask(id);if(!task||task.archived||task.revision!==revision)throw new Error('任务版本已变化或已归档，请重新读取');
  if(hasNativeTaskAction(task)){
   const plan=await this.requireNative().preview(task,signal);
   if(signal)assertActive(signal);if(this.repository.getTask(id)?.revision!==revision)throw new Error('任务在预览期间变化，请重新预览');
   this.repository.savePlan(plan);return structuredClone(plan);
  }
  const draft=taskDraft({name:task.name,subjects:task.subjects,actions:task.actions},this.catalog());
  const items:NextItem[]=[],sources:NextSource[]=[],resources:NextResource[]=[{id:'task-ledger',kind:'task_db',key:'batch_tasks',access:'write'}],steps:NextPreparedStep[]=[];
  const controller=new AbortController();if(signal?.aborted)controller.abort();const aborted=()=>controller.abort();signal?.addEventListener('abort',aborted,{once:true});
  try{
  for(const subject of draft.subjects){
   await setImmediate();assertActive(controller.signal);const itemId=randomUUID(),sourceId='source-'+itemId,resourceId='file-'+itemId;
   resources.push({id:resourceId,kind:'file',rel:subject.rel,access:'read'});
   let source:NextSource;try{const value=readSubject(this.root,subject,controller.signal);source={id:sourceId,kind:'file',resource_id:resourceId,rel:subject.rel,sha256:value.sha256,bytes:value.bytes};}
   catch(e){assertActive(controller.signal);source={id:sourceId,kind:'file',resource_id:resourceId,rel:subject.rel,sha256:null,bytes:null,error:reason(e)};}
   sources.push(source);items.push({id:itemId,subject:{...subject},source_id:sourceId,...(source.error?{error:source.error}:{})});
  }
  const cacheSources=new Map<string,NextSource>();
  for(const action of draft.actions){const adapter=this.adapter(action.key,action.version);
   const groups=adapter.descriptor.scope==='batch'?[items]:items.map(item=>[item]);
   for(const input of groups){
    await setImmediate();assertActive(controller.signal);
    const selected=input[0],inputError=input.find(item=>item.error)?.error;
    const applicable=adapter.descriptor.scope==='batch'?undefined:adapter.applicable(selected.subject);
    let status:NextPreparedStep['status']=inputError?'blocked':applicable?'not_applicable':'ready',message=inputError??applicable;
    const sourceIds=input.map(item=>item.source_id);
    if(status==='ready'&&adapter.prepare){
     const cacheKey='cache-'+selected.id;let prepared:BatchCachePreparation|undefined,cacheError:string|undefined;
     try{prepared=await adapter.prepare(this.root,{...selected.subject},controller.signal);if(prepared.key!=='workspace_cad_geometry'||prepared.selector!==selected.subject.rel||prepared.schema_version!==1||prepared.algorithm_version!=='geometry-cache-snapshot-v1')throw new Error('缓存投影不属于注册的精确读取端口');}
     catch(error){assertActive(controller.signal);cacheError=reason(error);status='blocked';message=cacheError;}
     if(!resources.some(resource=>resource.id==='geometry-cache'))resources.push({id:'geometry-cache',kind:'cache',key:'workspace_cad_geometry',access:'read',lease:{mode:'host_read_only',temporary_coordination:true,ownership:'own_lock_only',reclaim:false}});
     const source:NextSource={id:cacheKey,kind:'cache',resource_id:'geometry-cache',selector:selected.subject.rel,schema_version:1,algorithm_version:'geometry-cache-snapshot-v1',...(cacheError?{sha256:null,error:cacheError}:{sha256:hash(prepared!.value)})};
     const prior=cacheSources.get(cacheKey);if(prior&&JSON.stringify(prior)!==JSON.stringify(source))throw new Error('缓存投影在预览期间变化，请重新预览');
     if(!prior){cacheSources.set(cacheKey,source);sources.push(source);}sourceIds.push(cacheKey);
    }
    const sourceResources=sourceIds.map(sourceId=>sources.find(source=>source.id===sourceId)!.resource_id);
    steps.push({id:randomUUID(),action_instance_id:action.instance_id,target:adapter.descriptor.scope==='batch'?{scope:'batch',item_ids:items.map(item=>item.id)}:{scope:'file',item_id:selected.id},source_ids:sourceIds,resource_ids:[...new Set([...sourceResources,'task-ledger'])],status,...(message?{reason:message}:{})});
   }
  }
  assertActive(controller.signal);if(this.repository.getTask(id)?.revision!==revision)throw new Error('任务在预览期间变化，请重新预览');
  const created_at=new Date().toISOString(),expires_at=new Date(Date.now()+15*60_000).toISOString();
  const descriptors=[...new Map(draft.actions.map(action=>{const value=frozenDescriptor(this.adapter(action.key,action.version));return [value.key+'@'+value.version,value] as const;})).values()];
  const prepared=compilePlanV2({id:randomUUID(),task_id:id,task_revision:revision,created_at,expires_at,items,actions:draft.actions,descriptors,sources,resources,steps});
  const digest=createHash('sha256').update(canonicalPlanPayloadV2(prepared)).digest('hex'),plan=createCurrentBatchPlan(prepared,digest);
  this.repository.savePlan(plan);return structuredClone(plan);
  }finally{signal?.removeEventListener('abort',aborted);}
 }
 private verifyDescriptors(plan:CurrentBatchPlan){for(const descriptor of plan.prepared.descriptors){const adapter=this.adapter(descriptor.key,descriptor.version);if(JSON.stringify(frozenDescriptor(adapter))!==JSON.stringify(descriptor))throw new Error('动作实现或效果版本已变化，请重新预览');}}
 private async verifySources(plan:CurrentBatchPlan,signal:AbortSignal,ids?:readonly string[]){
  const preparations=new Map<string,BatchCachePreparation>();
  for(const source of plan.prepared.sources){if(ids&&!ids.includes(source.id)||source.error)continue;await setImmediate();assertActive(signal);
   if(source.kind==='file'){const current=readSubject(this.root,{kind:'file',rel:source.rel},signal);if(current.sha256!==source.sha256||current.bytes!==source.bytes)throw new Error('源文件在预览后变化，未继续本次冻结计划');}
   else{const resource=plan.prepared.resources.find(resource=>resource.id===source.resource_id);if(resource?.kind!=='cache'||resource.key!=='workspace_cad_geometry'||source.schema_version!==1||source.algorithm_version!=='geometry-cache-snapshot-v1'||!plan.items.some(item=>item.subject.rel===source.selector))throw new Error('缓存来源不属于冻结的白名单读取范围');
    const value=await readGeometryCacheSnapshot(this.root,source.selector,signal);if(hash(value)!==source.sha256)throw new Error('尺寸缓存投影在预览后变化，请重新预览');
    preparations.set(source.selector,{key:'workspace_cad_geometry',selector:source.selector,schema_version:1,algorithm_version:'geometry-cache-snapshot-v1',value});}
  }
  return preparations;
 }
 accept(planId:string,digest:string,requestId:string,declaredProtocol:2|3=2):Promise<BatchRun>{
  if(declaredProtocol!==2&&declaredProtocol!==3)return Promise.reject(new Error('请显式确认冻结计划的协议版本2或3'));
  const pending=this.admissions.get(requestId);
  if(pending)return pending.planId===planId&&pending.digest===digest&&pending.protocol===declaredProtocol?pending.promise:Promise.reject(new Error('相同请求标识不能用于不同计划或协议'));
  if(declaredProtocol===3&&!this.native)return Promise.reject(new Error('Native动作尚未由宿主显式配置，未开放原生执行'));
  if(this.stopped)return Promise.reject(new Error('服务正在关闭'));
  if(this.admissions.size>=32)return Promise.reject(new Error('正在核对的接纳请求超过32个，请稍后重试原请求'));
  const controller=new AbortController();
  // Repeated HTTP responses join the same live operation: a transient 4xx/404
  // from a second verification cannot prove no *first* request will commit.
  const promise=this.acceptOne(planId,digest,requestId,controller.signal,declaredProtocol).finally(()=>{if(this.admissions.get(requestId)?.promise===promise)this.admissions.delete(requestId);});
  this.admissions.set(requestId,{planId,digest,protocol:declaredProtocol,controller,promise});return promise;
 }
 private async acceptOne(planId:string,digest:string,requestId:string,signal:AbortSignal,declaredProtocol:2|3):Promise<BatchRun>{
  if(this.stopped)throw new Error('服务正在关闭');
  const prior=this.repository.findRunByRequest(requestId);
  if(prior){const old=this.repository.getRunPlan(prior.id);if(prior.plan_id!==planId||old?.digest!==digest||!old||(isNativePlan(old)?3:isCurrentPlan(old)?2:undefined)!==declaredProtocol)throw new Error('相同请求标识不能用于不同计划或协议');if(prior.status==='queued')this.wake();return prior;}
  const plan=this.repository.getPlan(planId);if(!plan||plan.status!=='fresh'||plan.digest!==digest||Date.parse(plan.expires_at)<=Date.now())throw new Error('预览已失效，请重新预览');
  if(isNativePlan(plan)){
   if(declaredProtocol!==3)throw new Error('V3 Native预览必须显式使用协议3确认，不能按V2接纳');
   await this.requireNative().verify(validateNativeBatchPlanV3(plan),signal);
  }else{
  if(declaredProtocol!==2)throw new Error('本预览不是V3 Native计划，请按协议2重新确认');
  if(!isCurrentPlan(plan))throw new Error('旧版预览仅供历史查看，请重新生成V2预览');validateCurrentBatchPlan(plan);
  if(!plan.summary.executable)throw new Error('本计划没有可执行步骤');
  this.verifyDescriptors(plan);await this.verifySources(plan,signal);
  }
  assertActive(signal);
  if(this.stopped)throw new Error('服务正在关闭');
  const detail=this.repository.acceptRun(planId,digest,requestId);this.wake();return detail.run;
 }
 detail(id:string,after=0):RunDetail{const value=this.repository.getRun(id,after);if(!value)throw new Error('任务运行不存在或不属于当前工作空间');return value;}
 retryDrafts(id:string){return buildRetryDrafts(this.detail(id),this.repository.getRunPlan(id),this.catalog());}
 cancel(id:string){const run=this.repository.requestCancel(id);if(this.active?.id===id)this.active.controller.abort();return run;}
 listRuns(){if(this.schedulerError&&!this.pump&&!this.retryTimer)throw new Error('队列调度已停止，请检查任务库后用原请求重试：'+this.schedulerError);return this.repository.listRuns();}
 private wake(){
  if(this.pump||this.stopped)return;
  if(this.retryTimer){clearTimeout(this.retryTimer);this.retryTimer=undefined;}
  this.pump=(async()=>{await setImmediate();while(!this.stopped){
   if(this.uncertainRun){const old=this.detail(this.uncertainRun).run;if(['queued','running','cancel_requested'].includes(old.status))this.repository.finishRun(old.id,'interrupted','任务记录提交未确认；只读步骤不自动重放，请重新预览');this.uncertainRun=undefined;}
   const run=this.repository.claimQueuedRun();this.schedulerError='';this.retries=0;if(!run)break;await this.execute(run);
  }})().catch(error=>{this.schedulerError=reason(error);}).finally(()=>{
   this.pump=undefined;if(this.stopped)return;
   if(this.schedulerError){
    if(/database is (?:locked|busy)|SQLITE_BUSY|SQLITE_LOCKED/i.test(this.schedulerError)&&this.retries++<8){this.retryTimer=setTimeout(()=>{this.retryTimer=undefined;this.wake();},Math.min(2000,100*2**this.retries));this.retryTimer.unref();}
    return;
   }
   try{if(this.repository.listRuns().some(run=>run.status==='queued'))this.wake();}catch(error){this.schedulerError=reason(error);}
  });
 }
 private async execute(run:BatchRun){
  const controller=new AbortController();this.active={id:run.id,controller};
  let nativeExecution=false;
  try{
   const stored=this.repository.getRunPlan(run.id);nativeExecution=isNativePlan(stored);
   if(isNativePlan(stored)){
    if(this.stopped||this.detail(run.id).run.cancel_requested)controller.abort();
    await this.requireNative().execute(run,validateNativeBatchPlanV3(stored),controller.signal);return;
   }
   if(!stored||!isCurrentPlan(stored))throw new Error('运行缺少可执行的V2冻结计划；旧历史不会自动升级');
   const plan=validateCurrentBatchPlan(stored);this.verifyDescriptors(plan);
   for(const step of plan.steps){
    // Excluded steps were recorded as not_applicable atomically at admission.
    if(!step.applicable)continue;
    await setImmediate();if(this.stopped||this.detail(run.id).run.cancel_requested)controller.abort();
    if(controller.signal.aborted){this.repository.finishStep(run.id,step.id,this.stopped?'interrupted':'cancelled',undefined,this.stopped?'后台服务停止，未继续只读步骤':'尚未执行：取消请求已确认');continue;}
    const action=plan.actions.find(a=>a.instance_id===step.action_instance_id)!,preparedStep=plan.prepared.steps.find(s=>s.id===step.id)!;
    this.repository.startStep(run.id,step.id);
    try{
     const adapter=this.adapter(action.key,action.version);
     const preparations=await this.verifySources(plan,controller.signal,preparedStep.source_ids);
     let result:Record<string,unknown>;
     if(isBatchPlannedStep(step)){
      const selected=step.item_ids.map(id=>plan.items.find(item=>item.id===id)!);if(!adapter.executeBatch||adapter.descriptor.scope!=='batch')throw new Error('整批执行端口或范围已变化');
      result=await adapter.executeBatch(this.root,structuredClone(selected),controller.signal);
     }else{
      const item=plan.items.find(item=>item.id===step.item_id)!;if(adapter.descriptor.scope!=='file')throw new Error('单文件执行端口范围已变化');
      result=await adapter.execute(this.root,{...item.subject},controller.signal,{preparation:preparations.get(item.subject.rel)});
     }
     assertActive(controller.signal);await this.verifySources(plan,controller.signal,preparedStep.source_ids);
     if(Buffer.byteLength(JSON.stringify(result))>256*1024)throw new Error('观察结果超过256KiB安全上限');
     this.repository.finishStep(run.id,step.id,'succeeded',result);
    }catch(e){this.repository.finishStep(run.id,step.id,this.stopped?'interrupted':controller.signal.aborted?'cancelled':'failed',undefined,reason(e));}
   }
   const detail=this.detail(run.id),success=detail.steps.filter(s=>s.status==='succeeded').length,failures=detail.steps.filter(s=>['failed','blocked','cancelled'].includes(s.status)).length;
   const status=this.stopped?'interrupted':success&&failures?'partial':controller.signal.aborted?'cancelled':failures?'failed':'succeeded';
   this.repository.finishRun(run.id,status);
  }catch(e){try{this.repository.finishRun(run.id,nativeExecution?'interrupted':'failed',nativeExecution?'Native运行未确认，保留记录且不自动重放':reason(e));}catch(persistence){this.uncertainRun=run.id;throw persistence;}}
  finally{this.active=undefined;}
 }
 async settled(){while(this.pump||this.retryTimer){if(this.pump)await this.pump;else await new Promise(resolve=>setTimeout(resolve,25));}}
 async close(){this.stopped=true;if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=undefined;this.active?.controller.abort();for(const value of this.admissions.values())value.controller.abort();await this.pump;await Promise.allSettled([...this.admissions.values()].map(value=>value.promise));this.repository.close();}
}
const services=new Map<string,BatchTaskService>();
let hostShuttingDown=false;
/** Host exit only; ordinary test/service cleanup must not close admission. */
export function beginBatchTaskShutdown(){hostShuttingDown=true;}
export function batchTaskService(workspace:string){if(hostShuttingDown)throw new Error('宿主正在关闭，不再接收批量任务服务请求');const root=fcstdWorkspace(workspace);let service=services.get(root);if(!service){if(services.size>=16)throw new Error('本地批量任务工作空间超过16个，请重启服务释放空闲宿主');service=new BatchTaskService(root);services.set(root,service);}return service;}
export async function closeBatchTaskServices(){await Promise.all([...services.values()].map(s=>s.close()));services.clear();}
