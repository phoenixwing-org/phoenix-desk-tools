import { describe, expect, it, vi } from 'vitest';
import {
  canonicalNativePreparedStepV3Payload, canonicalNativeProfileV3Payload, canonicalPreparedNativeTicketV3Payload,
  compileNativePreparedStepV3, compilePreparedNativeTicketV3, NATIVE_PROTOCOL_DRAFT_VERSION, NATIVE_SAVED_SHAPE_ACTION_V3,
  NativeProtocolError, validateNativePreparedStepV3, validateNativeProfileV3, validatePreparedNativeTicketV3,
  type NativePreparedStepInputV3, type PreparedNativeTicketInputV3,
} from '../../../../shared/batch-tasks/native-protocol.js';

// Independent inert DTO claims only. There is no FCStd/BRep, engine, native result or personal CAD fixture here.
const DIGEST = { source: '1'.repeat(64), xml: '2'.repeat(64), shape: '3'.repeat(64), manifest: '4'.repeat(64), script: '5'.repeat(64), engine: '6'.repeat(64), profile: '7'.repeat(64), plan: '8'.repeat(64), execution: '9'.repeat(64) };
const UUID = '6e5f1964-df5f-4d25-9a5a-d8e8282cbf15';
function input(): NativePreparedStepInputV3 {
  return { step_id: 'step_a', item_id: 'item_a', subject: { kind: 'file', rel: 'fixtures/Example.FCStd', node: 'ExampleFeature' },
    profile: { key: 'freecad.saved-brep-snapshot', version: 1, measurement_profile: 'saved_brep_snapshot', algorithm_version: 'saved-brep-snapshot-native-bounds-v1',
      script_sha256: DIGEST.script, engine: { key: 'freecadcmd', bytes: 2048, sha256: DIGEST.engine, app_version: ['1', '1', '0'], occ_version: '7.8.1' }, timeout_ms: 120_000 }, profile_sha256: DIGEST.profile,
    manifest: { schema_version: 1, algorithm_version: 'single-feature-saved-manifest-v2', measurement_profile: 'saved_brep_snapshot', source: { rel: 'fixtures/Example.FCStd', bytes: 4096, sha256: DIGEST.source }, document_xml: { bytes: 2500, sha256: DIGEST.xml },
      entity: { node: 'ExampleFeature', type_id: 'Part::Feature', shape_property: 'Shape', shape_property_type: 'Part::PropertyPartShape' },
      shape: { basis: 'serialized_shape_snapshot', member_path: 'ExampleFeature.Shape.brp', bytes: 512, sha256: DIGEST.shape, crc32: '1a2b3c4d', compression: 'deflate' },
      dependencies: [], dependency_check: 'strict_saved_shape_carrier_v1', dependency_scope: 'saved_shape_carrier', engine_asset_dependencies: 'not_attested',
      material: { uuid_raw: UUID, state: 'unresolved_metadata_only', resolution_performed: false, density_kg_m3: null, mass_kg: null }, restored_document: { verified: false }, native_executed: false, manifest_sha256: DIGEST.manifest } };
}
function ticketInput(step = compileNativePreparedStepV3(input())): PreparedNativeTicketInputV3 {
  return { step, execution_digest_claim: DIGEST.execution, binding: {
    attempt_id: 'attempt_a', run_id: 'run_a', step_id: step.step_id, plan_digest: DIGEST.plan, host_id: 'host_a', session_nonce: 'host_session_a', child_nonce: 'child_nonce_a', prepared_at: '2026-01-01T00:00:00.000Z',
    profile: { key: step.profile.key, version: step.profile.version }, profile_sha256: step.profile_sha256, script_sha256: step.profile.script_sha256, engine_sha256: step.profile.engine.sha256,
    source_manifest_sha256: step.manifest.manifest_sha256, result_schema_version: 1, expected_item_ids: [step.item_id],
  } };
}
type Data = Record<string, any>;
function mutable(value: unknown): Data { return structuredClone(value) as Data; }
function invalid(action: () => unknown) { expect(action).toThrow(NativeProtocolError); }
function reverse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverse);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)]));
}

describe('unregistered V3 saved-shape-only pure contract', () => {
  it('exposes one closed file action and exactly four effects, not cache/CAD/output capability', () => {
    expect(NATIVE_PROTOCOL_DRAFT_VERSION).toBe(3);
    expect(NATIVE_SAVED_SHAPE_ACTION_V3).toEqual({ key: 'cad.saved-shape-measurement', version: 1, scope: 'file', source_read_only: true, result_schema_version: 1, effects: ['read_file', 'run_native_readonly', 'write_private_temp', 'write_task_db'] });
    const step = compileNativePreparedStepV3(input());
    expect(step).toMatchObject({ protocol_version: 3, activation: 'draft_unregistered', authority: 'not_authority', native_proof: 'not_attested', crypto_verification: 'not_performed', execution_allowed: false, kill_allowed: false, lease_release_allowed: false });
    expect(step.resources).toEqual({ file: { kind: 'file', rel: step.subject.rel, access: 'read' }, task_db: { kind: 'task_db', key: 'batch_tasks', access: 'write' }, private_temp: { kind: 'owned_private_temp', access: 'write', owner: 'attempt_only', cleanup: 'after_actual_close_or_proven_not_spawned' }, native_process: { kind: 'native_process', access: 'run_native_readonly', owner: 'host_private_ticket_required', profile_key: 'freecad.saved-brep-snapshot', profile_version: 1 } });
    expect(Object.isFrozen(step)).toBe(true); expect(Object.isFrozen(step.manifest.material)).toBe(true); expect(Object.isFrozen(step.profile.engine.app_version)).toBe(true);
    expect(Object.isFrozen(step.action.effects)).toBe(true); expect(validateNativePreparedStepV3(step)).toEqual(step);
  });
  it('retains exact source/XML/Shape/node identity and unresolved material, but proves neither geometry nor hash claims', () => {
    const source = input(), step = compileNativePreparedStepV3(source);
    expect(step.manifest).toEqual(source.manifest); expect(step.manifest.material).toEqual(source.manifest.material);
    expect(step.manifest.engine_asset_dependencies).toBe('not_attested'); expect(step.manifest.dependency_scope).toBe('saved_shape_carrier');
    expect(step.manifest.restored_document.verified).toBe(false); expect(step.manifest.native_executed).toBe(false);
    expect(step.manifest.material.density_kg_m3).toBeNull(); expect(step.manifest.material.mass_kg).toBeNull();
    expect(step.crypto_verification).toBe('not_performed');
    expect(JSON.stringify(step)).not.toContain('Buffer');
  });
  it('allows nil material only as nil metadata, never a default density', () => {
    const v = mutable(input()); v.manifest.material.uuid_raw = '00000000-0000-0000-0000-000000000000'; v.manifest.material.state = 'nil';
    const step = compileNativePreparedStepV3(v); expect(step.manifest.material.state).toBe('nil'); expect(step.manifest.material.mass_kg).toBeNull();
  });
  it('canonicalizes only normalized closed data independently of key insertion order', () => {
    const step = compileNativePreparedStepV3(input());
    expect(canonicalNativePreparedStepV3Payload(reverse(step))).toBe(canonicalNativePreparedStepV3Payload(step));
    expect(canonicalNativeProfileV3Payload(reverse(step.profile))).toBe(canonicalNativeProfileV3Payload(step.profile));
  });
  it('does not retain mutable caller objects as frozen evidence', () => {
    const raw = mutable(input()), step = compileNativePreparedStepV3(raw), before = canonicalNativePreparedStepV3Payload(step);
    raw.manifest.source.sha256 = 'a'.repeat(64); raw.profile.engine.app_version[0] = 'other'; raw.subject.rel = 'Other.FCStd';
    expect(canonicalNativePreparedStepV3Payload(step)).toBe(before);
    const candidate = mutable(ticketInput(step)), ticket = compilePreparedNativeTicketV3(candidate);
    candidate.binding.child_nonce = 'changed'; candidate.step.manifest.material.uuid_raw = '00000000-0000-0000-0000-000000000000';
    expect(ticket.binding.child_nonce).toBe('child_nonce_a'); expect(ticket.step.manifest.material.uuid_raw).toBe(UUID);
  });
  it.each(['script_sha256', 'engine SHA', 'App', 'OCCT', 'timeout'])('includes frozen %s in the profile fingerprint input', change => {
    const p = mutable(input().profile), before = canonicalNativeProfileV3Payload(p);
    if (change === 'script_sha256') p.script_sha256 = 'a'.repeat(64);
    if (change === 'engine SHA') p.engine.sha256 = 'a'.repeat(64);
    if (change === 'App') p.engine.app_version[2] = '1';
    if (change === 'OCCT') p.engine.occ_version = '7.8.2';
    if (change === 'timeout') p.timeout_ms = 1000;
    expect(canonicalNativeProfileV3Payload(p)).not.toBe(before);
  });
  it.each([
    ['unselected source rel', (v: Data) => { v.subject.rel = 'Other.FCStd'; }], ['unselected node', (v: Data) => { v.subject.node = 'OtherFeature'; }],
    ['batch subject', (v: Data) => { v.subject.kind = 'batch'; }], ['missing node', (v: Data) => { delete v.subject.node; }],
    ['restored profile', (v: Data) => { v.profile.measurement_profile = 'restored_document'; }], ['auto profile', (v: Data) => { v.profile.measurement_profile = 'auto'; }],
    ['unknown builtin', (v: Data) => { v.profile.key = 'custom.reader'; }], ['unknown algorithm', (v: Data) => { v.profile.algorithm_version = 'other'; }],
    ['free script', (v: Data) => { v.profile.script = 'print(1)'; }], ['script path', (v: Data) => { v.profile.script_path = '/synthetic-invalid-path/read.py'; }],
    ['engine command', (v: Data) => { v.profile.engine.command = '/synthetic-invalid-path/freecadcmd'; }], ['GUI engine', (v: Data) => { v.profile.engine.key = 'FreeCADGui'; }],
    ['free params', (v: Data) => { v.params = { save: true }; }], ['caller action', (v: Data) => { v.action = { key: 'custom' }; }],
    ['restored manifest', (v: Data) => { v.manifest.measurement_profile = 'restored_document'; }], ['old manifest algo', (v: Data) => { v.manifest.algorithm_version = 'single-feature-saved-manifest-v1'; }],
    ['Body', (v: Data) => { v.manifest.entity.type_id = 'PartDesign::Body'; }], ['Link', (v: Data) => { v.manifest.entity.type_id = 'App::Link'; }],
    ['external dependency', (v: Data) => { v.manifest.dependencies.push({ rel: 'Other.FCStd' }); }], ['engine assets verified', (v: Data) => { v.manifest.engine_asset_dependencies = 'verified'; }],
    ['all dependencies covered', (v: Data) => { v.manifest.dependency_scope = 'all_dependencies'; }], ['material resolved', (v: Data) => { v.manifest.material.resolution_performed = true; }],
    ['material inferred density', (v: Data) => { v.manifest.material.density_kg_m3 = 7850; }], ['saved or inferred mass', (v: Data) => { v.manifest.material.mass_kg = 1; }],
    ['invalid UUID', (v: Data) => { v.manifest.material.uuid_raw = 'some-material-name'; }], ['nil state mismatch', (v: Data) => { v.manifest.material.state = 'nil'; }],
    ['restored verified', (v: Data) => { v.manifest.restored_document.verified = true; }], ['native already executed', (v: Data) => { v.manifest.native_executed = true; }],
    ['embedded BRep', (v: Data) => { v.manifest.shape.data = [1, 2, 3]; }], ['unknown Shape member', (v: Data) => { v.manifest.shape.member_path = '../escaped.brp'; }],
    ['unknown CRC', (v: Data) => { v.manifest.shape.crc32 = 'not-crc'; }], ['missing source SHA', (v: Data) => { delete v.manifest.source.sha256; }],
  ] as const)('rejects %s without fallback or widened effects', (_label, change) => { const v = mutable(input()); change(v); invalid(() => compileNativePreparedStepV3(v)); });
  it.each([0, -1, NaN, Infinity, 64 * 1024 * 1024 + 1])('rejects invalid source byte count %s', bytes => { const v = mutable(input()); v.manifest.source.bytes = bytes; invalid(() => compileNativePreparedStepV3(v)); });
  it.each([undefined, 0, 99, 120001, NaN])('requires an explicit bounded host timeout: %s', timeout => { const p = mutable(input().profile); p.timeout_ms = timeout; invalid(() => validateNativeProfileV3(p)); });
  it.each(['/outside.FCStd', '../outside.FCStd', 'folder/../outside.FCStd', '.hidden/Example.FCStd', 'C:/Example.FCStd', 'folder\\Example.FCStd', 'node_modules/Example.FCStd', 'Example.FCStd\u202e'])('rejects unsafe source paths %s', rel => {
    const v = mutable(input()); v.subject.rel = rel; v.manifest.source.rel = rel; invalid(() => compileNativePreparedStepV3(v));
  });
  it.each([
    ['effects', (v: Data) => { v.action.effects.push('write_cache'); }], ['scope', (v: Data) => { v.action.scope = 'batch'; }],
    ['other action key', (v: Data) => { v.action.key = 'cad.anything'; }], ['unknown action version', (v: Data) => { v.action.version = 2; }],
    ['CAD writes', (v: Data) => { v.resources.file.access = 'write'; }], ['business cache', (v: Data) => { v.resources.cache = { key: 'gallery' }; }],
    ['output path', (v: Data) => { v.resources.private_temp.output_rel = 'Result.FCStd'; }], ['early temp cleanup', (v: Data) => { v.resources.private_temp.cleanup = 'after_exit'; }],
    ['timeout is not close proof', (v: Data) => { v.resources.private_temp.cleanup = 'after_timeout'; }],
    ['caller temp ownership', (v: Data) => { v.resources.private_temp.owner = 'caller'; }], ['authority', (v: Data) => { v.authority = 'host_authority'; }],
    ['execution allowed', (v: Data) => { v.execution_allowed = true; }], ['kill allowed', (v: Data) => { v.kill_allowed = true; }],
    ['crypto attested', (v: Data) => { v.crypto_verification = 'verified'; }], ['V2 version', (v: Data) => { v.protocol_version = 2; }],
  ] as const)('rejects forged prepared-step declaration: %s', (_label, change) => { const v = mutable(compileNativePreparedStepV3(input())); change(v); invalid(() => validateNativePreparedStepV3(v)); });
});

describe('prepared execution-ticket claims, never serialized capabilities', () => {
  it('freezes full step/manifest and ledger binding without granting spawn/kill/release authority', () => {
    const ticket = compilePreparedNativeTicketV3(ticketInput());
    expect(ticket.kind).toBe('prepared_execution_ticket_draft'); expect(ticket.authority).toBe('not_authority');
    expect(ticket.execution_allowed).toBe(false); expect(ticket.kill_allowed).toBe(false); expect(ticket.lease_release_allowed).toBe(false);
    expect(ticket.crypto_verification).toBe('not_performed'); expect(ticket.native_proof).toBe('not_attested');
    expect(ticket.binding).toMatchObject({ attempt_id: 'attempt_a', run_id: 'run_a', step_id: 'step_a', plan_digest: DIGEST.plan, host_id: 'host_a', session_nonce: 'host_session_a', child_nonce: 'child_nonce_a', profile_sha256: DIGEST.profile });
    expect(ticket.step.manifest).toEqual(input().manifest); expect(Object.isFrozen(ticket.binding.expected_item_ids)).toBe(true);
    expect(validatePreparedNativeTicketV3(reverse(ticket))).toEqual(ticket);
  });
  it('canonical execution payload accepts only {binding,step}; execution digest claims are excluded, never self-authorizing', () => {
    const source = ticketInput(), a = compilePreparedNativeTicketV3(source), b = compilePreparedNativeTicketV3({ ...source, execution_digest_claim: 'a'.repeat(64) });
    const coreA = { binding: a.binding, step: a.step }, coreB = { binding: b.binding, step: b.step };
    expect(canonicalPreparedNativeTicketV3Payload(coreA)).toBe(canonicalPreparedNativeTicketV3Payload(coreB));
    expect(canonicalPreparedNativeTicketV3Payload(coreA)).not.toContain('execution_digest_claim');
    invalid(() => canonicalPreparedNativeTicketV3Payload(a));
    expect(b.crypto_verification).toBe('not_performed'); expect(b.execution_allowed).toBe(false);
  });
  it.each(['attempt_id', 'run_id', 'plan_digest', 'host_id', 'session_nonce', 'child_nonce', 'prepared_at'])('freezes %s into execution canonical data', field => {
    const source = ticketInput(), before = canonicalPreparedNativeTicketV3Payload({ binding: source.binding, step: source.step }), changed = mutable(source);
    changed.binding[field] = field === 'plan_digest' ? 'a'.repeat(64) : field === 'prepared_at' ? '2026-01-02T00:00:00.000Z' : 'different_id';
    expect(canonicalPreparedNativeTicketV3Payload({ binding: changed.binding, step: changed.step })).not.toBe(before);
  });
  it.each(['step_id', 'profile key', 'profile version', 'profile_sha256', 'script_sha256', 'engine_sha256', 'source_manifest_sha256', 'result_schema_version', 'expected_item_ids'])('requires exact binding to the prepared step: %s', field => {
    const v = mutable(ticketInput());
    if (field === 'profile key') v.binding.profile.key = 'another.profile';
    else if (field === 'profile version') v.binding.profile.version = 2;
    else if (field === 'expected_item_ids') v.binding.expected_item_ids = ['other_item'];
    else if (field === 'result_schema_version') v.binding.result_schema_version = 2;
    else v.binding[field] = field === 'step_id' ? 'other_step' : 'a'.repeat(64);
    invalid(() => compilePreparedNativeTicketV3(v));
  });
  it('retains XML/Shape/member/node/material and engine App/OCCT in execution input, not just source SHA', () => {
    const source = ticketInput(), payload = JSON.parse(canonicalPreparedNativeTicketV3Payload({ binding: source.binding, step: source.step }));
    expect(payload.step.manifest).toEqual(source.step.manifest); expect(payload.step.profile.engine).toEqual(source.step.profile.engine);
    expect(payload.step.manifest.document_xml.sha256).toBe(DIGEST.xml); expect(payload.step.manifest.shape.sha256).toBe(DIGEST.shape);
    expect(payload.step.manifest.material.uuid_raw).toBe(UUID); expect(payload.step.profile.timeout_ms).toBe(120000);
  });
  it.each(['execution_allowed', 'kill_allowed', 'lease_release_allowed'])('rejects a forged %s capability', field => {
    const v = mutable(compilePreparedNativeTicketV3(ticketInput())); v[field] = true; invalid(() => validatePreparedNativeTicketV3(v));
  });
  it('rejects missing/unknown/V2 ticket fields and does not upgrade old data', () => {
    for (const value of [{}, { protocol_version: 2 }, { ...mutable(ticketInput()), command: '/synthetic-invalid-path' }]) invalid(() => compilePreparedNativeTicketV3(value));
    const v = mutable(compilePreparedNativeTicketV3(ticketInput())); v.protocol_version = 2; invalid(() => validatePreparedNativeTicketV3(v));
  });
  it.each(['host_id', 'session_nonce', 'child_nonce', 'profile key', 'multi-item'])('rejects oversized/widened binding claims before general attempt normalization: %s', field => {
    const v = mutable(ticketInput());
    if (field === 'profile key') v.binding.profile.key = 'PRIVATE'.repeat(100000);
    else if (field === 'multi-item') v.binding.expected_item_ids = ['item_a', 'item_b'];
    else v.binding[field] = 'PRIVATE'.repeat(100000);
    try { compilePreparedNativeTicketV3(v); throw new Error('expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(NativeProtocolError); expect(String(error)).not.toContain('PRIVATE'); }
  });
});

describe('inert/bounded pure inputs and public errors', () => {
  it('rejects accessors before reading them, including nested profile and manifest records', () => {
    for (const target of ['step', 'profile', 'manifest'] as const) {
      const v = mutable(input()), getter = vi.fn(() => 'PRIVATE exception text');
      const object = target === 'step' ? v : target === 'profile' ? v.profile : v.manifest.material;
      Object.defineProperty(object, target === 'step' ? 'step_id' : target === 'profile' ? 'script_sha256' : 'uuid_raw', { get: getter, enumerable: true });
      invalid(() => compileNativePreparedStepV3(v)); expect(getter).not.toHaveBeenCalled();
    }
  });
  it('rejects custom prototypes, sparse/accessor/extra-key arrays, symbol and hidden properties', () => {
    const custom = Object.assign(Object.create({}), input()); invalid(() => compileNativePreparedStepV3(custom));
    for (const mutate of [(v: Data) => { delete v.profile.engine.app_version[1]; }, (v: Data) => { v.profile.engine.app_version.extra = 1; },
      (v: Data) => { Object.defineProperty(v.profile.engine.app_version, '1', { get() { throw new Error('PRIVATE'); }, enumerable: true }); },
      (v: Data) => { v.manifest.dependencies.extra = true; }, (v: Data) => { Object.defineProperty(v, Symbol('PRIVATE'), { value: true, enumerable: true }); },
      (v: Data) => { Object.defineProperty(v, 'extra', { value: true }); }]) { const v = mutable(input()); mutate(v); invalid(() => compileNativePreparedStepV3(v)); }
  });
  it('rejects obviously oversized strings without stringifying or echoing raw values', () => {
    const v = mutable(input()); v.manifest.material.uuid_raw = 'PRIVATE'.repeat(100000);
    const spy = vi.spyOn(JSON, 'stringify'); const before = spy.mock.calls.length;
    try { compileNativePreparedStepV3(v); throw new Error('expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(NativeProtocolError); expect(String(error)).not.toContain('PRIVATE'); expect(spy.mock.calls.length).toBe(before); }
    finally { spy.mockRestore(); }
  });
  it('bounds canonical data even for a long safe UTF-8 relative identity', () => {
    const v = mutable(input()), rel = '示'.repeat(4000) + '.FCStd'; v.subject.rel = rel; v.manifest.source.rel = rel;
    const step = compileNativePreparedStepV3(v), source = ticketInput(step);
    expect(new TextEncoder().encode(canonicalPreparedNativeTicketV3Payload({ binding: source.binding, step })).byteLength).toBeLessThan(64 * 1024);
  });
});
