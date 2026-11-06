/** Unwired candidate: the running schema3/BatchPlan/catalog do not consume V4.
 * Pure data validation, digests and history never create a worker/process
 * capability or permit Native admission by themselves. */
export const WORKER_PLAN_V4_LIMITS = Object.freeze({items: 200, bytes: 2 * 1024 * 1024, source_bytes: 64 * 1024 * 1024});
export type WorkerThumbnailEffectV4 = 'read_file' | 'run_owned_worker_job' | 'write_private_temp'
  | 'write_thumbnail_cache' | 'write_workspace_db' | 'write_task_db';
export const WORKER_THUMBNAIL_ACTION_V4 = Object.freeze({
  key: 'cad.worker-thumbnail', version: 1, phase: 'render', scope: 'file', source_read_only: true,
  cancellation: 'owned_worker_job', result_schema_version: 1, algorithm_version: 'owned-worker-thumbnail-v1',
  effects: Object.freeze(['read_file', 'run_owned_worker_job', 'write_private_temp', 'write_thumbnail_cache', 'write_workspace_db', 'write_task_db'] as const),
} as const);
export interface WorkerThumbnailProfileV4 {
  readonly key: 'freecad.thumbnail-worker'; readonly version: 1;
  readonly render_profile: 'native-isometric-white-v1'; readonly width: number; readonly height: number;
  /** This is a claim about one existing host-owned lifetime, not a PID or URL. */
  readonly manager_id: string; readonly configuration_revision: string; readonly resource_sha256: string;
  readonly engine_attestation: 'live_owned_session';
}
export interface WorkerPlanItemV4 {
  readonly id: string; readonly source_id: string; readonly subject: {readonly kind: 'file'; readonly rel: string};
  readonly sha256: string | null; readonly bytes: number | null; readonly error?: string;
}
export interface WorkerPreparedStepV4 {
  readonly id: string; readonly scope: 'file'; readonly item_id: string; readonly action_instance_id: string;
  readonly status: 'ready' | 'blocked'; readonly reason?: string;
}
export interface WorkerPreparedPlanV4 {
  readonly protocol_version: 4; readonly id: string; readonly task_id: string; readonly task_revision: number;
  readonly created_at: string; readonly expires_at: string; readonly action_instance_id: string;
  readonly profile: WorkerThumbnailProfileV4; readonly items: readonly WorkerPlanItemV4[]; readonly steps: readonly WorkerPreparedStepV4[];
}
export type WorkerPlanInputV4 = WorkerPreparedPlanV4;
export type WorkerPlanStatusV4 = 'fresh' | 'consumed' | 'invalidated';
export interface WorkerTaskDraftV4 {
  name: string; subjects: Array<{kind: 'file'; rel: string}>;
  actions: [{instance_id: string; key: 'cad.worker-thumbnail'; version: 1; params: Record<string, never>}];
}
const DECLARATIONS = {
  validation_scope: 'pure_contract', authority: 'not_authority', native_proof: 'not_attested',
  crypto_verification: 'not_performed', execution_allowed: false, kill_allowed: false, lease_release_allowed: false,
} as const;
export type WorkerBatchPlanV4 = typeof DECLARATIONS & {
  protocol_version: 4; prepared: WorkerPreparedPlanV4;
  id: string; task_id: string; task_revision: number; created_at: string; expires_at: string;
  status: WorkerPlanStatusV4; digest: string;
  actions: WorkerTaskDraftV4['actions'];
  items: Array<{id: string; source_id: string; subject: {kind: 'file'; rel: string}; sha256: string | null; bytes: number | null; error?: string}>;
  steps: Array<{id: string; scope: 'file'; item_id: string; action_instance_id: string; applicable: boolean; reason?: string}>;
  effects: WorkerThumbnailEffectV4[];
  summary: {files: number; actions: 1; executable: number; excluded: number};
};
export class WorkerEnvelopeError extends Error {
  readonly code = 'invalid_plan';
  constructor() {super('V4 worker-thumbnail data must exactly reflect its bounded frozen files, profile and steps'); this.name = 'WorkerEnvelopeError';}
}
const invalid = (): never => {throw new WorkerEnvelopeError();};
type Data = Record<string, unknown>;
const PROFILE_KEYS = ['key', 'version', 'render_profile', 'width', 'height', 'manager_id', 'configuration_revision', 'resource_sha256', 'engine_attestation'];
const PREPARED_KEYS = ['protocol_version', 'id', 'task_id', 'task_revision', 'created_at', 'expires_at', 'action_instance_id', 'profile', 'items', 'steps'];
const ENVELOPE_KEYS = [...Object.keys(DECLARATIONS), 'protocol_version', 'prepared', 'id', 'task_id', 'task_revision', 'created_at', 'expires_at', 'status', 'digest', 'actions', 'items', 'steps', 'effects', 'summary'];
function record(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const own = Reflect.ownKeys(value);
  if (own.length > allowed.length || own.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !own.includes(key))) return invalid();
  for (const key of own) {const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d) || !d.enumerable) return invalid();}
  return value as Data;
}
function array(value: unknown, max: number = WORKER_PLAN_V4_LIMITS.items, min = 1): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1 || own.some(key => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length))) return invalid();
  for (let index = 0; index < value.length; index++) {const d = Object.getOwnPropertyDescriptor(value, String(index)); if (!d || !('value' in d) || !d.enumerable) return invalid();}
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) return invalid();
  return value;
}
function identifier(value: unknown): string {const result = text(value, 100); if (!/^[A-Za-z0-9_-]+$/u.test(result)) return invalid(); return result;}
function hash(value: unknown): string {if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) return invalid(); return value;}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return invalid();
  return value;
}
function relativeFile(value: unknown): string {
  const result = text(value, 2048);
  if (result !== result.trim() || /[\\:]/u.test(result) || result.startsWith('/') || !/\.FCStd$/iu.test(result)
    || result.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || ['node_modules', '__pycache__'].includes(part))) return invalid();
  return result;
}
const folded = (value: string): string => value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
function unique<T>(values: readonly T[], key: (value: T) => string): void {if (new Set(values.map(key)).size !== values.length) return invalid();}
function freeze<T>(value: T): T {if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);} return value;}
/** No engine executable, application path, URL, process handle or launch rights
 * can be expressed in this DTO. A host must compare its live private snapshot. */
export function validateWorkerThumbnailProfileV4(value: unknown): WorkerThumbnailProfileV4 {
  const p = record(value, PROFILE_KEYS);
  if (p.key !== 'freecad.thumbnail-worker' || p.version !== 1 || p.render_profile !== 'native-isometric-white-v1'
    || p.engine_attestation !== 'live_owned_session' || typeof p.manager_id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(p.manager_id)
    || !Number.isSafeInteger(p.width) || Number(p.width) < 1 || Number(p.width) > 1024
    || !Number.isSafeInteger(p.height) || Number(p.height) < 1 || Number(p.height) > 1024 || Number(p.width) * Number(p.height) > 1048576) return invalid();
  return freeze({key: 'freecad.thumbnail-worker', version: 1, render_profile: 'native-isometric-white-v1', width: Number(p.width), height: Number(p.height),
    manager_id: p.manager_id, configuration_revision: hash(p.configuration_revision), resource_sha256: hash(p.resource_sha256), engine_attestation: 'live_owned_session'});
}
/** A strict task definition is still data only; host opt-in and a current live
 * manager are separate requirements at preview, admission and execution. */
export function workerTaskDraft(value: unknown): WorkerTaskDraftV4 {
  const input = record(value, ['name', 'subjects', 'actions']), name = text(input.name, 120).trim();
  const subjects = array(input.subjects).map(value => {const subject = record(value, ['kind', 'rel']); if (subject.kind !== 'file') return invalid(); return {kind: 'file' as const, rel: relativeFile(subject.rel)};});
  unique(subjects, subject => folded(subject.rel));
  const action = record(array(input.actions, 1)[0], ['instance_id', 'key', 'version', 'params']);
  if (action.key !== WORKER_THUMBNAIL_ACTION_V4.key || action.version !== 1) return invalid();
  record(action.params, []);
  return {name, subjects, actions: [{instance_id: identifier(action.instance_id), key: 'cad.worker-thumbnail', version: 1, params: {}}]};
}
/** Bounded, exact V4 compilation. Ordering is the explicit file order, and
 * blocked files remain visible rather than being silently dropped. */
export function compileWorkerPreparedPlanV4(value: unknown): WorkerPreparedPlanV4 {
  const p = record(value, PREPARED_KEYS);
  if (p.protocol_version !== 4 || !Number.isSafeInteger(p.task_revision) || Number(p.task_revision) < 1) return invalid();
  const created = timestamp(p.created_at), expires = timestamp(p.expires_at), actionId = identifier(p.action_instance_id);
  if (expires <= created) return invalid();
  const profile = validateWorkerThumbnailProfileV4(p.profile);
  const items: WorkerPlanItemV4[] = array(p.items).map(value => {
    const item = record(value, ['id', 'source_id', 'subject', 'sha256', 'bytes', 'error'], ['id', 'source_id', 'subject', 'sha256', 'bytes']);
    const subject = record(item.subject, ['kind', 'rel']); if (subject.kind !== 'file') return invalid();
    const base = {id: identifier(item.id), source_id: identifier(item.source_id), subject: {kind: 'file' as const, rel: relativeFile(subject.rel)}};
    if (Object.hasOwn(item, 'error')) {if (item.sha256 !== null || item.bytes !== null) return invalid(); return {...base, sha256: null, bytes: null, error: text(item.error, 2048)};}
    if (!Number.isSafeInteger(item.bytes) || Number(item.bytes) < 1 || Number(item.bytes) > WORKER_PLAN_V4_LIMITS.source_bytes) return invalid();
    return {...base, sha256: hash(item.sha256), bytes: Number(item.bytes)};
  });
  unique(items, item => item.id); unique(items, item => item.source_id); unique(items, item => folded(item.subject.rel));
  const steps: WorkerPreparedStepV4[] = array(p.steps).map((value, index) => {
    const step = record(value, ['id', 'scope', 'item_id', 'action_instance_id', 'status', 'reason'], ['id', 'scope', 'item_id', 'action_instance_id', 'status']);
    const item = items[index];
    if (!item || step.scope !== 'file' || step.item_id !== item.id || step.action_instance_id !== actionId || !['ready', 'blocked'].includes(String(step.status))) return invalid();
    const reason = Object.hasOwn(step, 'reason') ? text(step.reason, 2048) : undefined;
    if (step.status === 'ready' && (item.error !== undefined || reason !== undefined) || step.status === 'blocked' && reason === undefined || item.error !== undefined && step.status !== 'blocked') return invalid();
    return {id: identifier(step.id), scope: 'file', item_id: item.id, action_instance_id: actionId, status: step.status as 'ready' | 'blocked', ...(reason === undefined ? {} : {reason})};
  });
  if (steps.length !== items.length) return invalid(); unique(steps, step => step.id);
  const result: WorkerPreparedPlanV4 = {protocol_version: 4, id: identifier(p.id), task_id: identifier(p.task_id), task_revision: Number(p.task_revision),
    created_at: created, expires_at: expires, action_instance_id: actionId, profile, items, steps};
  canonical(result); return freeze(result);
}
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Data)[key])}`).join(',')}}`;
}
function canonical(value: WorkerPreparedPlanV4): string {
  const result = stable(value); if (new TextEncoder().encode(result).byteLength > WORKER_PLAN_V4_LIMITS.bytes) return invalid(); return result;
}
/** The complete prepared payload is the only host digest input. Lifecycle
 * status/digest claims are excluded; no hashing or admission occurs here. */
export function canonicalWorkerPlanV4Payload(value: unknown): string {return canonical(compileWorkerPreparedPlanV4(value));}
export function createWorkerBatchPlanV4(value: unknown, digest: string, status: WorkerPlanStatusV4 = 'fresh'): WorkerBatchPlanV4 {
  const p = compileWorkerPreparedPlanV4(value); hash(digest);
  if (!['fresh', 'consumed', 'invalidated'].includes(status)) return invalid();
  const ready = p.steps.filter(step => step.status === 'ready').length;
  return {...DECLARATIONS, protocol_version: 4, prepared: p, id: p.id, task_id: p.task_id, task_revision: p.task_revision, created_at: p.created_at, expires_at: p.expires_at, status, digest,
    actions: [{instance_id: p.action_instance_id, key: 'cad.worker-thumbnail', version: 1, params: {}}],
    items: p.items.map(item => ({...item, subject: {...item.subject}})),
    steps: p.steps.map(step => ({id: step.id, scope: 'file', item_id: step.item_id, action_instance_id: step.action_instance_id, applicable: step.status === 'ready', ...(step.reason === undefined ? {} : {reason: step.reason})})),
    effects: [...WORKER_THUMBNAIL_ACTION_V4.effects], summary: {files: p.items.length, actions: 1, executable: ready, excluded: p.items.length - ready}};
}
function same(value: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== 'object') {if (value !== expected) return invalid(); return;}
  if (Array.isArray(expected)) {const actual = array(value, Math.max(expected.length, 1), expected.length); if (actual.length !== expected.length) return invalid(); for (let index = 0; index < expected.length; index++) same(actual[index], expected[index]); return;}
  const v = record(value, Object.keys(expected)); for (const key of Object.keys(expected)) same(v[key], (expected as Data)[key]);
}
/** Validates exact wrapper projections only. It does not verify claimed SHA,
 * expiry, host resource/config identity or a live session capability. */
export function validateWorkerBatchPlanV4(value: unknown): WorkerBatchPlanV4 {
  const v = record(value, ENVELOPE_KEYS), expected = createWorkerBatchPlanV4(v.prepared, v.digest as string, v.status as WorkerPlanStatusV4);
  same(value, expected); return expected;
}
