import { createNativeAttempt, type NativeAttemptSpec } from './native-attempt.js';

/** Isolated V3 draft. Nothing here registers an action, launches a child, verifies
 * cryptographic claims, grants authority, or upgrades V1/V2 payload semantics. */
export const NATIVE_PROTOCOL_DRAFT_VERSION = 3 as const;
export const NATIVE_PROTOCOL_LIMITS = Object.freeze({ bytes: 64 * 1024, source_bytes: 64 * 1024 * 1024, xml_bytes: 1024 * 1024, shape_bytes: 32 * 1024 * 1024, engine_bytes: 256 * 1024 * 1024 });
export type NativeDraftEffect = 'read_file' | 'run_native_readonly' | 'write_private_temp' | 'write_task_db';
const AUTHORITY = {
  protocol_version: 3, activation: 'draft_unregistered', validation_scope: 'pure_contract', authority: 'not_authority',
  native_proof: 'not_attested', crypto_verification: 'not_performed', execution_allowed: false, kill_allowed: false, lease_release_allowed: false,
} as const;
export const NATIVE_SAVED_SHAPE_ACTION_V3 = freeze({
  key: 'cad.saved-shape-measurement', version: 1, scope: 'file', source_read_only: true, result_schema_version: 1,
  effects: ['read_file', 'run_native_readonly', 'write_private_temp', 'write_task_db'],
} as const);
/** Hashes are host claims. The future runtime MUST compare the builtin script,
 * executable, App/OCCT versions, private execution ticket and current sources.
 * No command path, script text, callback or user-selected engine is a DTO field. */
export type NativeSnapshotProfileV3 = {
  readonly key: 'freecad.saved-brep-snapshot'; readonly version: 1;
  readonly measurement_profile: 'saved_brep_snapshot'; readonly algorithm_version: 'saved-brep-snapshot-native-bounds-v1';
  readonly script_sha256: string;
  readonly engine: { readonly key: 'freecadcmd'; readonly bytes: number; readonly sha256: string; readonly app_version: readonly [string, string, string]; readonly occ_version: string };
  readonly timeout_ms: number;
};
/** Pure projection of the saved manifest, NOT ZIP/BRep/Native validation.
 * dependencies=[] covers the saved carrier only, never all engine assets. */
export type SavedShapeManifestV3 = {
  readonly schema_version: 1; readonly algorithm_version: 'single-feature-saved-manifest-v2'; readonly measurement_profile: 'saved_brep_snapshot';
  readonly source: { readonly rel: string; readonly bytes: number; readonly sha256: string };
  readonly document_xml: { readonly bytes: number; readonly sha256: string };
  readonly entity: { readonly node: string; readonly type_id: 'Part::Feature'; readonly shape_property: 'Shape'; readonly shape_property_type: 'Part::PropertyPartShape' };
  readonly shape: { readonly basis: 'serialized_shape_snapshot'; readonly member_path: string; readonly bytes: number; readonly sha256: string; readonly crc32: string; readonly compression: 'stored' | 'deflate' };
  readonly dependencies: readonly []; readonly dependency_check: 'strict_saved_shape_carrier_v1'; readonly dependency_scope: 'saved_shape_carrier'; readonly engine_asset_dependencies: 'not_attested';
  readonly material: { readonly uuid_raw: string; readonly state: 'nil' | 'unresolved_metadata_only'; readonly resolution_performed: false; readonly density_kg_m3: null; readonly mass_kg: null };
  readonly restored_document: { readonly verified: false }; readonly native_executed: false; readonly manifest_sha256: string;
};
export type NativePreparedStepInputV3 = {
  readonly step_id: string; readonly item_id: string; readonly subject: { readonly kind: 'file'; readonly rel: string; readonly node: string };
  readonly manifest: SavedShapeManifestV3; readonly profile: NativeSnapshotProfileV3; readonly profile_sha256: string;
};
type NativeResourcesV3 = {
  readonly file: { readonly kind: 'file'; readonly rel: string; readonly access: 'read' };
  readonly task_db: { readonly kind: 'task_db'; readonly key: 'batch_tasks'; readonly access: 'write' };
  readonly private_temp: { readonly kind: 'owned_private_temp'; readonly access: 'write'; readonly owner: 'attempt_only'; readonly cleanup: 'after_actual_close_or_proven_not_spawned' };
  readonly native_process: { readonly kind: 'native_process'; readonly access: 'run_native_readonly'; readonly owner: 'host_private_ticket_required'; readonly profile_key: 'freecad.saved-brep-snapshot'; readonly profile_version: 1 };
};
export type NativePreparedStepV3 = NativePreparedStepInputV3 & typeof AUTHORITY & { readonly action: typeof NATIVE_SAVED_SHAPE_ACTION_V3; readonly resources: NativeResourcesV3 };
export type PreparedNativeTicketCoreV3 = { readonly binding: NativeAttemptSpec; readonly step: NativePreparedStepV3 };
export type PreparedNativeTicketInputV3 = PreparedNativeTicketCoreV3 & { readonly execution_digest_claim: string };
/** A serialized prepared ticket is STILL NOT a capability. Only a future private
 * runtime object may authorize spawn/kill/release after durable host admission. */
export type PreparedNativeTicketV3 = PreparedNativeTicketInputV3 & typeof AUTHORITY & { readonly kind: 'prepared_execution_ticket_draft' };
export class NativeProtocolError extends Error {
  constructor(readonly code: 'invalid_data' | 'unsupported' | 'binding_mismatch' | 'limit') { super(code); this.name = 'NativeProtocolError'; }
}
function fail(code: NativeProtocolError['code'] = 'invalid_data'): never { throw new NativeProtocolError(code); }
type Data = Record<string, unknown>;
function record(value: unknown, keys: readonly string[]): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) fail();
  for (const k of own) { const d = Object.getOwnPropertyDescriptor(value, k); if (!d || !('value' in d) || !d.enumerable) fail(); }
  return value as Data;
}
function array(value: unknown, length: number): unknown[] {
  if (!Array.isArray(value) || value.length !== length || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== length + 1) fail();
  for (let i = 0; i < length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !('value' in d) || !d.enumerable) fail(); }
  return value;
}
function text(value: unknown, max = 100): string { if (typeof value !== 'string' || value.length > max || !value.trim() || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail(); return value; }
function id(value: unknown): string { const s = text(value); if (!/^[A-Za-z0-9_-]+$/.test(s)) fail(); return s; }
function sha(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(); return value; }
function positive(value: unknown, max: number): number { if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) fail(); return Number(value); }
function relative(value: unknown): string {
  const s = text(value, 4096);
  if (/[\\:]/u.test(s) || s.startsWith('/') || s.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.') || ['node_modules', '__pycache__'].includes(p)) || !/\.FCStd$/i.test(s)) fail();
  return s;
}
function node(value: unknown): string { const s = text(value, 128); if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s)) fail(); return s; }
function member(value: unknown): string {
  const s = text(value, 255);
  if (s !== s.normalize('NFC') || /[\\/:]/u.test(s) || s.startsWith('.') || !/\.brp$/i.test(s) || new TextEncoder().encode(s).byteLength > 255) fail(); return s;
}
function same(value: unknown, expected: unknown): void {
  if (expected === null || typeof expected !== 'object') { if (value !== expected) fail('binding_mismatch'); return; }
  if (Array.isArray(expected)) { const entries = array(value, expected.length); expected.forEach((entry, i) => same(entries[i], entry)); return; }
  const keys = Object.keys(expected), input = record(value, keys);
  for (const k of keys) same(input[k], (expected as Data)[k]);
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
/** Only normalized, fixed-size DTOs reach this serializer. Arbitrary raw JSON is
 * never serialized to discover whether it exceeded a budget. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Data)[k])}`).join(',')}}`;
}
function canonical(value: object): string { const s = stable(value); if (new TextEncoder().encode(s).byteLength > NATIVE_PROTOCOL_LIMITS.bytes) fail('limit'); return s; }

export function validateNativeProfileV3(value: unknown): NativeSnapshotProfileV3 {
  const p = record(value, ['key', 'version', 'measurement_profile', 'algorithm_version', 'script_sha256', 'engine', 'timeout_ms']);
  if (p.key !== 'freecad.saved-brep-snapshot' || p.version !== 1 || p.measurement_profile !== 'saved_brep_snapshot' || p.algorithm_version !== 'saved-brep-snapshot-native-bounds-v1') fail('unsupported');
  const e = record(p.engine, ['key', 'bytes', 'sha256', 'app_version', 'occ_version']); if (e.key !== 'freecadcmd') fail('unsupported');
  const parts = array(e.app_version, 3).map(v => { const s = text(v, 40); if (!/^[0-9A-Za-z.+_-]+$/.test(s)) fail(); return s; });
  const occ = text(e.occ_version, 64); if (!/^[0-9A-Za-z.+_()-]+$/.test(occ)) fail();
  const timeout = positive(p.timeout_ms, 120_000); if (timeout < 100) fail();
  return freeze({ key: 'freecad.saved-brep-snapshot', version: 1, measurement_profile: 'saved_brep_snapshot', algorithm_version: 'saved-brep-snapshot-native-bounds-v1',
    script_sha256: sha(p.script_sha256), engine: { key: 'freecadcmd', bytes: positive(e.bytes, NATIVE_PROTOCOL_LIMITS.engine_bytes), sha256: sha(e.sha256), app_version: parts as [string, string, string], occ_version: occ }, timeout_ms: timeout });
}
export function canonicalNativeProfileV3Payload(value: unknown): string { return canonical(validateNativeProfileV3(value)); }

function manifest(value: unknown): SavedShapeManifestV3 {
  const m = record(value, ['schema_version', 'algorithm_version', 'measurement_profile', 'source', 'document_xml', 'entity', 'shape', 'dependencies', 'dependency_check', 'dependency_scope', 'engine_asset_dependencies', 'material', 'restored_document', 'native_executed', 'manifest_sha256']);
  if (m.schema_version !== 1 || m.algorithm_version !== 'single-feature-saved-manifest-v2' || m.measurement_profile !== 'saved_brep_snapshot'
    || m.dependency_check !== 'strict_saved_shape_carrier_v1' || m.dependency_scope !== 'saved_shape_carrier' || m.engine_asset_dependencies !== 'not_attested' || m.native_executed !== false) fail('unsupported');
  array(m.dependencies, 0); same(m.restored_document, { verified: false });
  const s = record(m.source, ['rel', 'bytes', 'sha256']), x = record(m.document_xml, ['bytes', 'sha256']);
  const e = record(m.entity, ['node', 'type_id', 'shape_property', 'shape_property_type']);
  if (e.type_id !== 'Part::Feature' || e.shape_property !== 'Shape' || e.shape_property_type !== 'Part::PropertyPartShape') fail('unsupported');
  const sh = record(m.shape, ['basis', 'member_path', 'bytes', 'sha256', 'crc32', 'compression']);
  if (sh.basis !== 'serialized_shape_snapshot' || !['stored', 'deflate'].includes(sh.compression as string) || typeof sh.crc32 !== 'string' || !/^[a-f0-9]{8}$/.test(sh.crc32)) fail();
  const mat = record(m.material, ['uuid_raw', 'state', 'resolution_performed', 'density_kg_m3', 'mass_kg']), uuid = text(mat.uuid_raw, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid) || mat.state !== (uuid === '00000000-0000-0000-0000-000000000000' ? 'nil' : 'unresolved_metadata_only') || mat.resolution_performed !== false || mat.density_kg_m3 !== null || mat.mass_kg !== null) fail();
  return freeze({ schema_version: 1, algorithm_version: 'single-feature-saved-manifest-v2', measurement_profile: 'saved_brep_snapshot',
    source: { rel: relative(s.rel), bytes: positive(s.bytes, NATIVE_PROTOCOL_LIMITS.source_bytes), sha256: sha(s.sha256) }, document_xml: { bytes: positive(x.bytes, NATIVE_PROTOCOL_LIMITS.xml_bytes), sha256: sha(x.sha256) },
    entity: { node: node(e.node), type_id: 'Part::Feature', shape_property: 'Shape', shape_property_type: 'Part::PropertyPartShape' },
    shape: { basis: 'serialized_shape_snapshot', member_path: member(sh.member_path), bytes: positive(sh.bytes, NATIVE_PROTOCOL_LIMITS.shape_bytes), sha256: sha(sh.sha256), crc32: sh.crc32, compression: sh.compression as 'stored' | 'deflate' },
    dependencies: [], dependency_check: 'strict_saved_shape_carrier_v1', dependency_scope: 'saved_shape_carrier', engine_asset_dependencies: 'not_attested',
    material: { uuid_raw: uuid, state: mat.state as 'nil' | 'unresolved_metadata_only', resolution_performed: false, density_kg_m3: null, mass_kg: null }, restored_document: { verified: false }, native_executed: false, manifest_sha256: sha(m.manifest_sha256) });
}
const STEP_INPUT = ['step_id', 'item_id', 'subject', 'manifest', 'profile', 'profile_sha256'];
export function compileNativePreparedStepV3(input: unknown): NativePreparedStepV3 {
  const v = record(input, STEP_INPUT), subject = record(v.subject, ['kind', 'rel', 'node']), saved = manifest(v.manifest), profile = validateNativeProfileV3(v.profile);
  if (subject.kind !== 'file') fail('unsupported'); const rel = relative(subject.rel), selected = node(subject.node);
  if (rel !== saved.source.rel || selected !== saved.entity.node) fail('binding_mismatch');
  const step: NativePreparedStepV3 = { ...AUTHORITY, step_id: id(v.step_id), item_id: id(v.item_id), subject: { kind: 'file', rel, node: selected }, manifest: saved, profile, profile_sha256: sha(v.profile_sha256), action: NATIVE_SAVED_SHAPE_ACTION_V3,
    resources: { file: { kind: 'file', rel, access: 'read' }, task_db: { kind: 'task_db', key: 'batch_tasks', access: 'write' },
      private_temp: { kind: 'owned_private_temp', access: 'write', owner: 'attempt_only', cleanup: 'after_actual_close_or_proven_not_spawned' },
      native_process: { kind: 'native_process', access: 'run_native_readonly', owner: 'host_private_ticket_required', profile_key: 'freecad.saved-brep-snapshot', profile_version: 1 } } };
  canonical(step); return freeze(step);
}
export function validateNativePreparedStepV3(value: unknown): NativePreparedStepV3 {
  const v = record(value, [...Object.keys(AUTHORITY), ...STEP_INPUT, 'action', 'resources']);
  const step = compileNativePreparedStepV3({ step_id: v.step_id, item_id: v.item_id, subject: v.subject, manifest: v.manifest, profile: v.profile, profile_sha256: v.profile_sha256 } as NativePreparedStepInputV3);
  for (const k of [...Object.keys(AUTHORITY), 'action', 'resources']) same(v[k], (step as unknown as Data)[k]); return step;
}
export function canonicalNativePreparedStepV3Payload(value: unknown): string { return canonical(validateNativePreparedStepV3(value)); }

function core(value: unknown): PreparedNativeTicketCoreV3 {
  const v = record(value, ['binding', 'step']), step = validateNativePreparedStepV3(v.step); let binding: NativeAttemptSpec;
  // This file-only draft needs one item. Reject oversized raw binding scalars
  // before delegating normalization to the more general pure attempt model.
  const raw = record(v.binding, ['attempt_id', 'run_id', 'step_id', 'plan_digest', 'host_id', 'session_nonce', 'child_nonce', 'prepared_at', 'profile', 'profile_sha256', 'script_sha256', 'engine_sha256', 'source_manifest_sha256', 'result_schema_version', 'expected_item_ids']);
  for (const key of ['attempt_id', 'run_id', 'step_id', 'plan_digest', 'host_id', 'session_nonce', 'child_nonce', 'prepared_at', 'profile_sha256', 'script_sha256', 'engine_sha256', 'source_manifest_sha256']) text(raw[key]);
  const profile = record(raw.profile, ['key', 'version']); text(profile.key); id(array(raw.expected_item_ids, 1)[0]);
  try { binding = createNativeAttempt(raw).spec; } catch { return fail(); }
  if (binding.step_id !== step.step_id || binding.profile.key !== step.profile.key || binding.profile.version !== step.profile.version || binding.profile_sha256 !== step.profile_sha256
    || binding.script_sha256 !== step.profile.script_sha256 || binding.engine_sha256 !== step.profile.engine.sha256 || binding.source_manifest_sha256 !== step.manifest.manifest_sha256
    || binding.result_schema_version !== step.action.result_schema_version || binding.expected_item_ids.length !== 1 || binding.expected_item_ids[0] !== step.item_id) fail('binding_mismatch');
  return freeze({ binding, step });
}
/** Core only, deliberately excluding every execution-digest claim. Host crypto is
 * a separate future boundary; hashing this string alone does NOT grant authority. */
export function canonicalPreparedNativeTicketV3Payload(value: PreparedNativeTicketCoreV3): string {
  return canonical({ ...AUTHORITY, kind: 'prepared_execution_ticket_draft', ...core(value) });
}
export function compilePreparedNativeTicketV3(input: unknown): PreparedNativeTicketV3 {
  const v = record(input, ['binding', 'step', 'execution_digest_claim']), checked = core({ binding: v.binding, step: v.step });
  const ticket: PreparedNativeTicketV3 = { ...AUTHORITY, kind: 'prepared_execution_ticket_draft', ...checked, execution_digest_claim: sha(v.execution_digest_claim) };
  canonical(ticket); return freeze(ticket);
}
export function validatePreparedNativeTicketV3(value: unknown): PreparedNativeTicketV3 {
  const v = record(value, [...Object.keys(AUTHORITY), 'kind', 'binding', 'step', 'execution_digest_claim']);
  const ticket = compilePreparedNativeTicketV3({ binding: v.binding, step: v.step, execution_digest_claim: v.execution_digest_claim } as PreparedNativeTicketInputV3);
  for (const k of [...Object.keys(AUTHORITY), 'kind']) same(v[k], (ticket as unknown as Data)[k]); return ticket;
}
