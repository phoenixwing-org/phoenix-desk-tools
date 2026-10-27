import {
  NATIVE_SAVED_SHAPE_ACTION_V3, validateNativePreparedStepV3,
  type NativeDraftEffect, type NativePreparedStepV3,
} from './native-protocol.js';

/** Single-file V3 envelope only: no action registration, crypto, I/O, Native
 * proof, admission or historical execution authority is supplied here. */
export const NATIVE_PLAN_V3_LIMITS = Object.freeze({bytes: 96 * 1024});
export type NativePlanStatusV3 = 'fresh' | 'consumed' | 'invalidated';
export type NativePreparedPlanV3 = {
  readonly protocol_version: 3;
  readonly id: string; readonly task_id: string; readonly task_revision: number;
  readonly created_at: string; readonly expires_at: string;
  readonly action_instance_id: string;
  readonly step: NativePreparedStepV3;
};
const DECLARATIONS = {
  validation_scope: 'pure_contract', authority: 'not_authority', native_proof: 'not_attested',
  crypto_verification: 'not_performed', execution_allowed: false, kill_allowed: false, lease_release_allowed: false,
} as const;
/** The familiar plan projection is derived, never a second selectable scope.
 * V3's explicit subject.node must NOT relax V2 subject validation. The mutable
 * lifecycle status is excluded from the frozen prepared payload and digest. */
export type NativeBatchPlanV3 = typeof DECLARATIONS & {
  protocol_version: 3; prepared: NativePreparedPlanV3;
  id: string; task_id: string; task_revision: number; created_at: string; expires_at: string;
  status: NativePlanStatusV3; digest: string;
  actions: [{instance_id: string; key: 'cad.saved-shape-measurement'; version: 1; params: Record<string, never>}];
  items: [{id: string; subject: NativePreparedStepV3['subject']; source_id: string; sha256: string; bytes: number}];
  steps: [{id: string; scope: 'file'; item_id: string; action_instance_id: string; applicable: true}];
  effects: NativeDraftEffect[];
  summary: {files: 1; actions: 1; executable: 1; excluded: 0};
};
export class NativeEnvelopeError extends Error {
  readonly code = 'invalid_plan';
  constructor() {super('V3 envelope must exactly reflect one frozen saved-shape step'); this.name = 'NativeEnvelopeError';}
}
function invalid(): never {throw new NativeEnvelopeError();}
type Data = Record<string, unknown>;
const PREPARED_KEYS = ['protocol_version', 'id', 'task_id', 'task_revision', 'created_at', 'expires_at', 'action_instance_id', 'step'];
const ENVELOPE_KEYS = [...Object.keys(DECLARATIONS), 'protocol_version', 'prepared', 'id', 'task_id', 'task_revision', 'created_at', 'expires_at', 'status', 'digest', 'actions', 'items', 'steps', 'effects', 'summary'];
function record(value: unknown, keys: readonly string[]): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
  for (const key of own) {const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d) || !d.enumerable) invalid();}
  return value as Data;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100 || !/^[A-Za-z0-9_-]+$/u.test(value)) invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
function prepared(value: unknown): NativePreparedPlanV3 {
  const p = record(value, PREPARED_KEYS);
  if (p.protocol_version !== 3 || !Number.isSafeInteger(p.task_revision) || Number(p.task_revision) < 1) invalid();
  const created = timestamp(p.created_at), expires = timestamp(p.expires_at);
  if (expires <= created) invalid();
  let step: NativePreparedStepV3;
  try {step = validateNativePreparedStepV3(p.step);} catch {return invalid();}
  return Object.freeze({protocol_version: 3, id: identifier(p.id), task_id: identifier(p.task_id), task_revision: Number(p.task_revision),
    created_at: created, expires_at: expires, action_instance_id: identifier(p.action_instance_id), step});
}
/** Only a normalized, bounded single-step DTO reaches this serializer. Raw
 * arrays/objects are never stringified to discover their shape or byte budget. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Data)[key])}`).join(',')}}`;
}
function canonical(value: NativePreparedPlanV3): string {
  const result = stable(value);
  if (new TextEncoder().encode(result).byteLength > NATIVE_PLAN_V3_LIMITS.bytes) invalid();
  return result;
}
/** Accepts PREPARED only, not an envelope/ticket. Host must compute SHA256 of
 * this complete payload; digest/status are deliberately excluded. Neither
 * hashing nor successful pure validation grants a spawn/kill/release right. */
export function canonicalNativePlanV3Payload(value: unknown): string {return canonical(prepared(value));}

/** Host supplies the digest claim. This function checks syntax, NOT its SHA,
 * source bytes, engine identity, current time/expiry or runtime authority. */
export function createNativeBatchPlanV3(value: unknown, digest: string, status: NativePlanStatusV3 = 'fresh'): NativeBatchPlanV3 {
  const p = prepared(value); canonical(p);
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest) || !['fresh', 'consumed', 'invalidated'].includes(status)) invalid();
  const s = p.step;
  return {...DECLARATIONS, protocol_version: 3, prepared: p, id: p.id, task_id: p.task_id, task_revision: p.task_revision,
    created_at: p.created_at, expires_at: p.expires_at, status, digest,
    actions: [{instance_id: p.action_instance_id, key: NATIVE_SAVED_SHAPE_ACTION_V3.key, version: NATIVE_SAVED_SHAPE_ACTION_V3.version, params: {}}],
    items: [{id: s.item_id, subject: {...s.subject}, source_id: s.item_id, sha256: s.manifest.source.sha256, bytes: s.manifest.source.bytes}],
    steps: [{id: s.step_id, scope: 'file', item_id: s.item_id, action_instance_id: p.action_instance_id, applicable: true}],
    effects: [...NATIVE_SAVED_SHAPE_ACTION_V3.effects], summary: {files: 1, actions: 1, executable: 1, excluded: 0}};
}
function same(value: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== 'object') {if (value !== expected) invalid(); return;}
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length || Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== expected.length + 1) invalid();
    for (let i = 0; i < expected.length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !('value' in d) || !d.enumerable) invalid();
      same(d.value, expected[i]);
    }
    return;
  }
  const keys = Object.keys(expected), v = record(value, keys);
  for (const key of keys) same(v[key], (expected as Data)[key]);
}
/** All wrapper fields must match the single frozen step exactly. Consumed,
 * invalidated, restored or imported plans remain data, never capabilities. */
export function validateNativeBatchPlanV3(value: unknown): NativeBatchPlanV3 {
  const v = record(value, ENVELOPE_KEYS);
  const expected = createNativeBatchPlanV3(v.prepared, v.digest as string, v.status as NativePlanStatusV3);
  same(value, expected); return expected;
}
