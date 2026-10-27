import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {
  canonicalNativePlanV3Payload, createNativeBatchPlanV3, NativeEnvelopeError, validateNativeBatchPlanV3,
  type NativePreparedPlanV3,
} from '../../../../shared/batch-tasks/native-envelope.js';
import {compileNativePreparedStepV3, type NativePreparedStepInputV3} from '../../../../shared/batch-tasks/native-protocol.js';
import {validateCurrentBatchPlan} from '../../../../shared/batch-tasks/envelope.js';
import {validatePlanV2} from '../../../../shared/batch-tasks/next-protocol.js';

// Independent inert DTO claims: no actual document, BRep, engine, Native result,
// project metadata or execution capability is created by these fixtures.
const D = {source: '1'.repeat(64), xml: '2'.repeat(64), shape: '3'.repeat(64), manifest: '4'.repeat(64), script: '5'.repeat(64), engine: '6'.repeat(64), profile: '7'.repeat(64)};
function stepInput(): NativePreparedStepInputV3 {
  return {step_id: 'step_example', item_id: 'item_example', subject: {kind: 'file', rel: 'fixtures/Example.FCStd', node: 'ExampleFeature'},
    profile: {key: 'freecad.saved-brep-snapshot', version: 1, measurement_profile: 'saved_brep_snapshot', algorithm_version: 'saved-brep-snapshot-native-bounds-v1',
      script_sha256: D.script, engine: {key: 'freecadcmd', bytes: 2048, sha256: D.engine, app_version: ['1', '1', '0'], occ_version: '7.8.1'}, timeout_ms: 120_000}, profile_sha256: D.profile,
    manifest: {schema_version: 1, algorithm_version: 'single-feature-saved-manifest-v2', measurement_profile: 'saved_brep_snapshot',
      source: {rel: 'fixtures/Example.FCStd', bytes: 4096, sha256: D.source}, document_xml: {bytes: 2500, sha256: D.xml},
      entity: {node: 'ExampleFeature', type_id: 'Part::Feature', shape_property: 'Shape', shape_property_type: 'Part::PropertyPartShape'},
      shape: {basis: 'serialized_shape_snapshot', member_path: 'ExampleFeature.Shape.brp', bytes: 512, sha256: D.shape, crc32: '1a2b3c4d', compression: 'deflate'},
      dependencies: [], dependency_check: 'strict_saved_shape_carrier_v1', dependency_scope: 'saved_shape_carrier', engine_asset_dependencies: 'not_attested',
      material: {uuid_raw: '6e5f1964-df5f-4d25-9a5a-d8e8282cbf15', state: 'unresolved_metadata_only', resolution_performed: false, density_kg_m3: null, mass_kg: null},
      restored_document: {verified: false}, native_executed: false, manifest_sha256: D.manifest}};
}
function input(): NativePreparedPlanV3 {
  return {protocol_version: 3, id: 'plan_example', task_id: 'task_example', task_revision: 2,
    created_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-01-01T00:05:00.000Z', action_instance_id: 'action_example',
    step: compileNativePreparedStepV3(stepInput())};
}
const hostHash = (value: unknown): string => createHash('sha256').update(canonicalNativePlanV3Payload(value)).digest('hex');
const plan = () => {const p = input(); return createNativeBatchPlanV3(p, hostHash(p));};
type Data = Record<string, any>;
const mutable = (value: unknown): Data => structuredClone(value) as Data;
const invalid = (action: () => unknown) => expect(action).toThrow(NativeEnvelopeError);
function reverse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverse);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)]));
}

describe('single-file V3 saved-shape plan envelope, not execution authority', () => {
  it('derives exactly one explicit file/node, fixed action and file step using the familiar plan shape', () => {
    const result = plan();
    expect(result).toMatchObject({protocol_version: 3, id: 'plan_example', task_id: 'task_example', task_revision: 2, status: 'fresh',
      created_at: input().created_at, expires_at: input().expires_at, summary: {files: 1, actions: 1, executable: 1, excluded: 0}});
    expect(result.actions).toEqual([{instance_id: 'action_example', key: 'cad.saved-shape-measurement', version: 1, params: {}}]);
    expect(result.items).toEqual([{id: 'item_example', subject: {kind: 'file', rel: 'fixtures/Example.FCStd', node: 'ExampleFeature'}, source_id: 'item_example', sha256: D.source, bytes: 4096}]);
    expect(result.steps).toEqual([{id: 'step_example', scope: 'file', item_id: 'item_example', action_instance_id: 'action_example', applicable: true}]);
    expect(result.effects).toEqual(['read_file', 'run_native_readonly', 'write_private_temp', 'write_task_db']);
    expect(validateNativeBatchPlanV3(result)).toEqual(result);
  });
  it('leaves all authority and verification declarations false even for a well-formed fresh plan', () => {
    const result = plan();
    expect(result).toMatchObject({validation_scope: 'pure_contract', authority: 'not_authority', native_proof: 'not_attested', crypto_verification: 'not_performed', execution_allowed: false, kill_allowed: false, lease_release_allowed: false});
    expect(result.prepared.step.manifest.material).toMatchObject({state: 'unresolved_metadata_only', resolution_performed: false, density_kg_m3: null, mass_kg: null});
    expect(result.prepared.step.manifest.engine_asset_dependencies).toBe('not_attested');
    expect(result.prepared.step.activation).toBe('draft_unregistered');
  });
  it('uses complete prepared-only canonical data; insertion order does not affect host hashing', () => {
    const p = input(), result = createNativeBatchPlanV3(p, hostHash(p));
    expect(canonicalNativePlanV3Payload(reverse(p))).toBe(canonicalNativePlanV3Payload(p));
    expect(validateNativeBatchPlanV3(reverse(result))).toEqual(result);
    const serialized = canonicalNativePlanV3Payload(p);
    expect(JSON.parse(serialized)).toEqual(p);
    expect(serialized).not.toContain('"digest"'); expect(serialized).not.toContain('"status"');
    invalid(() => canonicalNativePlanV3Payload(result));
  });
  it.each(['fresh', 'consumed', 'invalidated'] as const)('keeps %s history pure and preserves the digest across lifecycle changes', status => {
    const p = input(), digest = hostHash(p), result = createNativeBatchPlanV3(p, digest, status);
    expect(validateNativeBatchPlanV3(result).status).toBe(status); expect(result.digest).toBe(digest);
    expect(hostHash(result.prepared)).toBe(digest); expect(result.execution_allowed).toBe(false);
  });
  it('does not claim crypto verification: syntactically valid false digest still requires host rejection', () => {
    const p = input(), wrong = 'a'.repeat(64), result = createNativeBatchPlanV3(p, wrong);
    expect(wrong).not.toBe(hostHash(p)); expect(validateNativeBatchPlanV3(result).digest).toBe(wrong);
    expect(result.crypto_verification).toBe('not_performed'); expect(result.execution_allowed).toBe(false);
  });
  it('copies and freezes prepared evidence without freezing the caller or conflating mutable lifecycle status', () => {
    const raw = mutable(input()), result = createNativeBatchPlanV3(raw, hostHash(raw)), before = canonicalNativePlanV3Payload(result.prepared);
    raw.step.manifest.source.sha256 = 'a'.repeat(64); raw.action_instance_id = 'changed'; raw.step.profile.engine.app_version[0] = 'other';
    expect(canonicalNativePlanV3Payload(result.prepared)).toBe(before); expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(result.prepared)).toBe(true); expect(Object.isFrozen(result.prepared.step.manifest.material)).toBe(true);
    result.status = 'consumed'; expect(validateNativeBatchPlanV3(result).status).toBe('consumed');
    result.items[0].subject = {...result.items[0].subject, node: 'OtherFeature'};
    invalid(() => validateNativeBatchPlanV3(result)); expect(result.prepared.step.subject.node).toBe('ExampleFeature');
  });
  it.each([
    ['plan id', (p: Data) => {p.id = 'other_plan';}], ['task id', (p: Data) => {p.task_id = 'other_task';}], ['revision', (p: Data) => {p.task_revision++;}],
    ['creation time', (p: Data) => {p.created_at = '2026-01-01T00:00:01.000Z';}], ['expiration', (p: Data) => {p.expires_at = '2026-01-01T00:06:00.000Z';}],
    ['action instance', (p: Data) => {p.action_instance_id = 'another_action';}], ['item identity', (p: Data) => {p.step.item_id = 'other_item';}], ['step identity', (p: Data) => {p.step.step_id = 'other_step';}],
    ['source SHA', (p: Data) => {p.step.manifest.source.sha256 = 'a'.repeat(64);}], ['source bytes', (p: Data) => {p.step.manifest.source.bytes++;}],
    ['XML SHA', (p: Data) => {p.step.manifest.document_xml.sha256 = 'a'.repeat(64);}], ['XML bytes', (p: Data) => {p.step.manifest.document_xml.bytes++;}],
    ['Shape SHA', (p: Data) => {p.step.manifest.shape.sha256 = 'a'.repeat(64);}], ['Shape CRC', (p: Data) => {p.step.manifest.shape.crc32 = 'abcdef12';}],
    ['Shape member', (p: Data) => {p.step.manifest.shape.member_path = 'Another.Shape.brp';}], ['Shape bytes', (p: Data) => {p.step.manifest.shape.bytes++;}],
    ['selected node', (p: Data) => {p.step.subject.node = 'OtherFeature'; p.step.manifest.entity.node = 'OtherFeature';}],
    ['source rel', (p: Data) => {p.step.subject.rel = 'fixtures/Other.FCStd'; p.step.manifest.source.rel = 'fixtures/Other.FCStd'; p.step.resources.file.rel = 'fixtures/Other.FCStd';}],
    ['material raw UUID', (p: Data) => {p.step.manifest.material.uuid_raw = '9cf20a65-2d53-41c7-aef5-9a632efbb730';}], ['manifest digest', (p: Data) => {p.step.manifest.manifest_sha256 = 'a'.repeat(64);}],
    ['profile fingerprint', (p: Data) => {p.step.profile_sha256 = 'a'.repeat(64);}], ['script SHA', (p: Data) => {p.step.profile.script_sha256 = 'a'.repeat(64);}],
    ['engine SHA', (p: Data) => {p.step.profile.engine.sha256 = 'a'.repeat(64);}], ['engine App', (p: Data) => {p.step.profile.engine.app_version[2] = '1';}],
    ['engine OCCT', (p: Data) => {p.step.profile.engine.occ_version = '7.8.2';}], ['host timeout', (p: Data) => {p.step.profile.timeout_ms = 1000;}],
  ] as const)('includes %s in the complete host digest input', (_label, change) => {
    const a = input(), b = mutable(a); change(b); expect(hostHash(b)).not.toBe(hostHash(a));
  });
  it.each([
    ['plan id', (v: Data) => {v.id = 'other_plan';}], ['task id', (v: Data) => {v.task_id = 'other_task';}], ['revision', (v: Data) => {v.task_revision++;}],
    ['creation', (v: Data) => {v.created_at = '2026-01-01T00:00:01.000Z';}], ['expiry', (v: Data) => {v.expires_at = '2026-01-01T00:06:00.000Z';}],
    ['action key', (v: Data) => {v.actions[0].key = 'cad.other';}], ['action version', (v: Data) => {v.actions[0].version = 2;}], ['action instance', (v: Data) => {v.actions[0].instance_id = 'other_action';}],
    ['free params', (v: Data) => {v.actions[0].params = {write: true};}], ['item id', (v: Data) => {v.items[0].id = 'other_item';}],
    ['source id', (v: Data) => {v.items[0].source_id = 'other_source';}], ['subject rel', (v: Data) => {v.items[0].subject.rel = 'Other.FCStd';}], ['subject node', (v: Data) => {v.items[0].subject.node = 'OtherFeature';}],
    ['missing node', (v: Data) => {delete v.items[0].subject.node;}], ['BOM root kind', (v: Data) => {v.items[0].subject.kind = 'cad_model';}],
    ['source SHA', (v: Data) => {v.items[0].sha256 = 'a'.repeat(64);}], ['source bytes', (v: Data) => {v.items[0].bytes++;}],
    ['step id', (v: Data) => {v.steps[0].id = 'other_step';}], ['step item', (v: Data) => {v.steps[0].item_id = 'other_item';}], ['step action', (v: Data) => {v.steps[0].action_instance_id = 'other_action';}],
    ['batch scope', (v: Data) => {v.steps[0].scope = 'batch';}], ['inapplicable step', (v: Data) => {v.steps[0].applicable = false;}],
    ['file count', (v: Data) => {v.summary.files = 2;}], ['action count', (v: Data) => {v.summary.actions = 2;}], ['step count', (v: Data) => {v.summary.executable = 2;}], ['excluded count', (v: Data) => {v.summary.excluded = 1;}],
    ['read cache effect', (v: Data) => {v.effects.push('read_cache');}], ['CAD write effect', (v: Data) => {v.effects[0] = 'write_cad';}], ['effect order', (v: Data) => {v.effects.reverse();}],
    ['authority', (v: Data) => {v.authority = 'host_authority';}], ['execution right', (v: Data) => {v.execution_allowed = true;}], ['kill right', (v: Data) => {v.kill_allowed = true;}], ['release right', (v: Data) => {v.lease_release_allowed = true;}],
    ['Native proof', (v: Data) => {v.native_proof = 'native_verified';}], ['crypto proof', (v: Data) => {v.crypto_verification = 'verified';}], ['scope declaration', (v: Data) => {v.validation_scope = 'runtime';}],
  ] as const)('rejects mismatched or authority-granting projection: %s', (_label, change) => {
    const v = mutable(plan()); change(v); invalid(() => validateNativeBatchPlanV3(v));
  });
  it.each(['items', 'actions', 'steps'] as const)('rejects zero/multiple %s rather than expanding into a general batch platform', field => {
    for (const mode of ['empty', 'extra']) {const v = mutable(plan()); v[field] = mode === 'empty' ? [] : [...v[field], structuredClone(v[field][0])]; invalid(() => validateNativeBatchPlanV3(v));}
  });
  it.each([1, 2, 4, undefined, '3'])('rejects non-explicit-V3 version %s without V1/V2 fallback', version => {
    const p = mutable(input()); p.protocol_version = version; invalid(() => canonicalNativePlanV3Payload(p));
    const v = mutable(plan()); v.protocol_version = version; invalid(() => validateNativeBatchPlanV3(v));
  });
  it('does not make V2 validators accept Native data', () => {
    const v = plan(); expect(() => validateCurrentBatchPlan(v)).toThrow(); expect(() => validatePlanV2(v.prepared)).toThrow();
  });
  it.each(['id', 'task_id', 'action_instance_id'] as const)('requires bounded inert %s', field => {
    for (const candidate of ['', ' ', '../x', 'x\n', 'x\u202e', 'x'.repeat(101), 1, null]) {const v = mutable(input()); v[field] = candidate; invalid(() => canonicalNativePlanV3Payload(v));}
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2'])('rejects invalid task revision %s', task_revision => {
    invalid(() => canonicalNativePlanV3Payload({...input(), task_revision}));
  });
  it.each(['', 'not-date', '2026-02-30T00:00:00.000Z', '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00', '2026-01-01T00:00:00.000Z\n'])('rejects noncanonical or invalid time %s', created_at => {
    invalid(() => canonicalNativePlanV3Payload({...input(), created_at}));
  });
  it('rejects reversed or zero-length validity windows without using a mutable wall clock', () => {
    const p = input(); invalid(() => canonicalNativePlanV3Payload({...p, expires_at: p.created_at}));
    invalid(() => canonicalNativePlanV3Payload({...p, expires_at: '2025-12-31T23:59:59.999Z'}));
    expect(validateNativeBatchPlanV3(plan()).expires_at).toBe('2026-01-01T00:05:00.000Z');
  });
  it.each(['', 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(65), null, 1])('rejects invalid digest syntax %s', digest => {
    invalid(() => createNativeBatchPlanV3(input(), digest as string));
  });
  it.each(['queued', 'running', 'succeeded', 'restored', null, true])('rejects unsupported lifecycle status %s', status => {
    const v = mutable(plan()); v.status = status; invalid(() => validateNativeBatchPlanV3(v));
  });
  it('rejects unknown fields before reading nested accessors or serializing large values', () => {
    const getter = vi.fn(() => {throw new Error('must not execute');});
    const top = mutable(plan()); top.unknown = 'x'.repeat(100_000); Object.defineProperty(top, 'prepared', {enumerable: true, get: getter});
    invalid(() => validateNativeBatchPlanV3(top)); expect(getter).not.toHaveBeenCalled();
    const p = mutable(input()); p.unknown = true; Object.defineProperty(p, 'step', {enumerable: true, get: getter});
    invalid(() => canonicalNativePlanV3Payload(p)); expect(getter).not.toHaveBeenCalled();
  });
  it('rejects accessors at wrapper, array and manifest boundaries without invoking them', () => {
    const getter = vi.fn(() => {throw new Error('must not execute');});
    for (const path of ['top', 'array', 'subject', 'manifest', 'prepared']) {
      const v = mutable(plan());
      if (path === 'top') Object.defineProperty(v, 'digest', {enumerable: true, get: getter});
      if (path === 'array') Object.defineProperty(v.items, '0', {enumerable: true, get: getter});
      if (path === 'subject') Object.defineProperty(v.items[0].subject, 'node', {enumerable: true, get: getter});
      if (path === 'manifest') Object.defineProperty(v.prepared.step.manifest.source, 'sha256', {enumerable: true, get: getter});
      if (path === 'prepared') Object.defineProperty(v.prepared, 'step', {enumerable: true, get: getter});
      invalid(() => validateNativeBatchPlanV3(v));
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects sparse/huge/extra-key arrays, prototypes, symbols, hidden properties and toJSON', () => {
    for (const change of [
      (v: Data) => {v.items = new Array(1);}, (v: Data) => {v.steps.length = 0xffffffff;},
      (v: Data) => {v.actions.extra = true;}, (v: Data) => {Object.setPrototypeOf(v.effects, {bad: true});},
      (v: Data) => {Object.setPrototypeOf(v.summary, {bad: true});}, (v: Data) => {(v as Record<PropertyKey, unknown>)[Symbol('extra')] = true;},
      (v: Data) => {Object.defineProperty(v, 'hidden', {value: true});}, (v: Data) => {v.items[0].toJSON = () => {throw new Error('never');};},
    ]) {const v = mutable(plan()); change(v); invalid(() => validateNativeBatchPlanV3(v));}
  });
  it('accepts inert null-prototype records but clones them into normalized plain data', () => {
    const p = Object.assign(Object.create(null), input()), result = createNativeBatchPlanV3(p, hostHash(p));
    const v = Object.assign(Object.create(null), result); expect(validateNativeBatchPlanV3(v)).toEqual(result);
    expect(Object.getPrototypeOf(result.prepared)).toBe(Object.prototype);
  });
  it('reuses strict Native step validation rather than accepting scripts, dependencies, restoration or writes', () => {
    for (const change of [
      (v: Data) => {v.step.profile.measurement_profile = 'restored_document';}, (v: Data) => {v.step.profile.script = 'arbitrary';},
      (v: Data) => {v.step.manifest.dependencies.push({rel: 'Other.FCStd'});}, (v: Data) => {v.step.resources.file.access = 'write';},
      (v: Data) => {v.step.manifest.material.density_kg_m3 = 7850;}, (v: Data) => {v.step.manifest.shape.data = [1, 2, 3];},
      (v: Data) => {v.step.subject.node = 'OtherFeature';}, (v: Data) => {v.steps = [v.step];},
    ]) {const v = mutable(input()); change(v); invalid(() => canonicalNativePlanV3Payload(v));}
  });
});
