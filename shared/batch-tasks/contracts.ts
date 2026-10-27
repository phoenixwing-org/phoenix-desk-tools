/** Pure shared contracts: no HTTP, Vue, database or CAD runtime dependencies. */
import type {NextEffect,NextPlan} from './next-protocol.js';
import type {NativeDraftEffect} from './native-protocol.js';
import type {NativeBatchPlanV3} from './native-envelope.js';
export type {NativeBatchPlanV3} from './native-envelope.js';
export const BATCH_SCHEMA_VERSION = 3;
export type RunStatus = 'queued'|'running'|'cancel_requested'|'succeeded'|'partial'|'failed'|'cancelled'|'interrupted';
export type StepStatus = 'pending'|'running'|'succeeded'|'failed'|'not_applicable'|'blocked'|'cancelled'|'interrupted';
export type SubjectRef = { kind:'file'|'cad_model'; rel:string; node?:string };
export type ActionSelection = { instance_id:string; key:string; version:number; params:Record<string,never> };
export type ActionDescriptor = { key:string; version:number; title:string; description:string; effects:readonly (NextEffect|NativeDraftEffect)[]; phase:'collect'; cancellable:true;
  scope?:'file'|'batch';source_read_only?:true;cancellation?:'cooperative'|'owned_process';result_schema_version?:number;algorithm_version?:string };
export interface TaskDraft { name:string; subjects:SubjectRef[]; actions:ActionSelection[] }
export interface BatchTask extends TaskDraft { id:string; revision:number; archived:boolean; created_at:string; updated_at:string }
export interface PlannedItem { id:string; subject:SubjectRef; sha256:string; bytes:number; error?:string }
export interface CurrentPlannedItem { id:string; subject:SubjectRef; source_id:string; sha256:string|null; bytes:number|null; error?:string }
export interface FilePlannedStep { id:string; scope?:'file'; item_id:string; action_instance_id:string; applicable:boolean; reason?:string }
export interface WholeBatchPlannedStep { id:string; scope:'batch'; item_ids:string[]; action_instance_id:string; applicable:boolean; reason?:string }
export type PlannedStep = FilePlannedStep|WholeBatchPlannedStep;
interface PlanFields { id:string; task_id:string; task_revision:number; created_at:string; expires_at:string; status:'fresh'|'consumed'|'invalidated'; digest:string; actions:ActionSelection[]; summary:{ files:number; actions:number; executable:number; excluded:number } }
export interface LegacyBatchPlan extends PlanFields { protocol_version?:never;prepared?:never;items:PlannedItem[];steps:FilePlannedStep[];effects:readonly ['read_file','write_task_db'] }
export interface CurrentBatchPlan extends PlanFields { protocol_version:2;prepared:NextPlan;items:CurrentPlannedItem[];steps:PlannedStep[];effects:readonly NextEffect[] }
export type BatchPlan = LegacyBatchPlan|CurrentBatchPlan|NativeBatchPlanV3;
export interface BatchRun { id:string; task_id:string; task_revision:number; task_name:string; plan_id:string; client_request_id:string; status:RunStatus; created_at:string; started_at?:string; finished_at?:string; cancel_requested:boolean; total:number; completed:number; failed:number; active_step_id?:string; message?:string }
interface StepFields { id:string; run_id:string; action_instance_id:string; action_key:string; status:StepStatus; started_at?:string; finished_at?:string; message?:string; result?:Record<string,unknown> }
export interface FileBatchStep extends StepFields { scope?:'file';item_id:string;subject:SubjectRef }
export interface WholeBatchStep extends StepFields { scope:'batch';item_ids:string[];subjects:SubjectRef[] }
export type BatchStep = FileBatchStep|WholeBatchStep;
export interface BatchEvent { seq:number; run_id:string; type:string; created_at:string; message:string }
export interface RunDetail { run:BatchRun; steps:BatchStep[]; events:BatchEvent[] }
export const isActiveRun=(status:RunStatus)=>['queued','running','cancel_requested'].includes(status);
export const isTerminalRun=(status:RunStatus)=>!isActiveRun(status);
export const isBatchPlannedStep=(step:PlannedStep):step is WholeBatchPlannedStep=>step.scope==='batch';
export const isBatchStep=(step:BatchStep):step is WholeBatchStep=>step.scope==='batch';
/** A version discriminator only; validation/admission is deliberately separate. */
const planVersion=(plan:unknown):unknown=>{if(!plan||typeof plan!=='object')return undefined;const d=Object.getOwnPropertyDescriptor(plan,'protocol_version');return d&&'value'in d?d.value:undefined;};
export const isCurrentPlan=(plan:BatchPlan|unknown):plan is CurrentBatchPlan=>planVersion(plan)===2;
/** Discriminators are not validation, admission or Native process capabilities. */
export const isNativePlan=(plan:BatchPlan|unknown):plan is NativeBatchPlanV3=>planVersion(plan)===3;
export const isExecutablePlan=(plan:BatchPlan|unknown):plan is CurrentBatchPlan|NativeBatchPlanV3=>isCurrentPlan(plan)||isNativePlan(plan);
