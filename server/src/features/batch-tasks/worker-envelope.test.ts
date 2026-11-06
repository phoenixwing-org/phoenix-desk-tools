import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {
  WORKER_PLAN_V4_LIMITS, WORKER_THUMBNAIL_ACTION_V4, WorkerEnvelopeError,
  canonicalWorkerPlanV4Payload, compileWorkerPreparedPlanV4, createWorkerBatchPlanV4,
  validateWorkerBatchPlanV4, validateWorkerThumbnailProfileV4, workerTaskDraft,
  type WorkerPreparedPlanV4,
} from '../../../../shared/batch-tasks/worker-envelope.js';
import {isCurrentPlan, isExecutablePlan, isNativePlan} from '../../../../shared/batch-tasks/contracts.js';
import {compilePlanV2} from '../../../../shared/batch-tasks/next-protocol.js';
import {validateNativeBatchPlanV3} from '../../../../shared/batch-tasks/native-envelope.js';
import {taskDraft} from './model.js';

// Independently constructed inert metadata only: no real CAD, engine, resource,
// source path, process identity or worker capability is provided by these DTOs.
function input(): WorkerPreparedPlanV4 {
  return {protocol_version: 4, id: 'plan_example', task_id: 'task_example', task_revision: 1,
    created_at: '2026-01-01T00:00:00.000Z', expires_at: '2026-01-01T00:05:00.000Z', action_instance_id: 'thumbnail_example',
    profile: {key: 'freecad.thumbnail-worker', version: 1, render_profile: 'native-isometric-white-v1', width: 128, height: 128,
      manager_id: '6d1095fe-5853-4f88-bf3d-89691c6d9fd7', configuration_revision: 'a'.repeat(64), resource_sha256: 'b'.repeat(64), engine_attestation: 'live_owned_session'},
    items: [
      {id: 'item_plate', source_id: 'source_plate', subject: {kind: 'file', rel: 'fixtures/Plate.FCStd'}, sha256: 'c'.repeat(64), bytes: 1024},
      {id: 'item_spacer', source_id: 'source_spacer', subject: {kind: 'file', rel: 'fixtures/Spacer.FCStd'}, sha256: null, bytes: null, error: 'Source unavailable'},
    ],
    steps: [
      {id: 'step_plate', scope: 'file', item_id: 'item_plate', action_instance_id: 'thumbnail_example', status: 'ready'},
      {id: 'step_spacer', scope: 'file', item_id: 'item_spacer', action_instance_id: 'thumbnail_example', status: 'blocked', reason: 'Source unavailable'},
    ]};
}
type Data = Record<string, any>;
const mutable = (value: unknown): Data => structuredClone(value) as Data;
const hostHash = (value: unknown): string => createHash('sha256').update(canonicalWorkerPlanV4Payload(value)).digest('hex');
const envelope = () => {const p = input(); return createWorkerBatchPlanV4(p, hostHash(p));};
const rejects = (operation: () => unknown) => expect(operation).toThrow(WorkerEnvelopeError);
function draft(): Data {return {name: 'Thumbnail example', subjects: input().items.map(item => ({...item.subject})), actions: [{instance_id: 'thumbnail_example', key: 'cad.worker-thumbnail', version: 1, params: {}}]};}
function reverse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverse);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)]));
}

describe('V4 worker-thumbnail pure contract, not runtime authority', () => {
  it('projects explicit ordered files and blocked reads without dropping scope', () => {
    const result = envelope();
    expect(result).toMatchObject({protocol_version: 4, summary: {files: 2, actions: 1, executable: 1, excluded: 1}});
    expect(result.actions).toEqual(draft().actions);
    expect(result.items).toEqual(input().items);
    expect(result.steps).toEqual([
      {id: 'step_plate', scope: 'file', item_id: 'item_plate', action_instance_id: 'thumbnail_example', applicable: true},
      {id: 'step_spacer', scope: 'file', item_id: 'item_spacer', action_instance_id: 'thumbnail_example', applicable: false, reason: 'Source unavailable'},
    ]);
    expect(result.effects).toEqual(WORKER_THUMBNAIL_ACTION_V4.effects);
    expect(validateWorkerBatchPlanV4(result)).toEqual(result);
    expect(result).toMatchObject({validation_scope: 'pure_contract', authority: 'not_authority', native_proof: 'not_attested',
      crypto_verification: 'not_performed', execution_allowed: false, kill_allowed: false, lease_release_allowed: false});
    // The candidate is intentionally not wired into the running schema3 union.
    expect(isExecutablePlan(result)).toBe(false);
    expect(isCurrentPlan(result)).toBe(false); expect(isNativePlan(result)).toBe(false);
  });
  it('freezes its copied prepared data, but permits mutable lifecycle projection', () => {
    const raw = mutable(input()), result = createWorkerBatchPlanV4(raw, hostHash(raw)), canonical = canonicalWorkerPlanV4Payload(result.prepared);
    expect(Object.isFrozen(result.prepared)).toBe(true); expect(Object.isFrozen(result.prepared.items[0].subject)).toBe(true); expect(Object.isFrozen(result.prepared.profile)).toBe(true);
    expect(Object.isFrozen(raw)).toBe(false); raw.items[0].subject.rel = 'Other.FCStd'; raw.profile.width = 256;
    expect(canonicalWorkerPlanV4Payload(result.prepared)).toBe(canonical);
    result.status = 'consumed'; expect(validateWorkerBatchPlanV4(result).status).toBe('consumed');
    result.items[0].subject.rel = 'Other.FCStd'; rejects(() => validateWorkerBatchPlanV4(result));
  });
  it('canonicalizes object insertion order, not file/step order; excludes envelope claims', () => {
    const p = input(); expect(canonicalWorkerPlanV4Payload(reverse(p))).toBe(canonicalWorkerPlanV4Payload(p));
    expect(validateWorkerBatchPlanV4(reverse(envelope()))).toEqual(envelope());
    const switched = mutable(p); switched.items.reverse(); switched.steps.reverse(); expect(hostHash(switched)).not.toBe(hostHash(p));
    rejects(() => canonicalWorkerPlanV4Payload(envelope()));
    expect(canonicalWorkerPlanV4Payload(p)).not.toContain('"digest"'); expect(canonicalWorkerPlanV4Payload(p)).not.toContain('"status":"fresh"');
  });
  it.each(['fresh', 'consumed', 'invalidated'] as const)('keeps %s data non-authoritative and does not invent SHA verification', status => {
    const result = createWorkerBatchPlanV4(input(), 'f'.repeat(64), status);
    expect(result.digest).not.toBe(hostHash(input())); expect(validateWorkerBatchPlanV4(result)).toEqual(result);
    expect(result.execution_allowed).toBe(false); expect(result.crypto_verification).toBe('not_performed');
  });
  it.each([
    ['plan id', (v: Data) => {v.id = 'other_plan';}], ['task id', (v: Data) => {v.task_id = 'other_task';}],
    ['revision', (v: Data) => {v.task_revision++;}], ['expiry', (v: Data) => {v.expires_at = '2026-01-01T00:06:00.000Z';}],
    ['width', (v: Data) => {v.profile.width = 512;}], ['height', (v: Data) => {v.profile.height = 512;}],
    ['manager', (v: Data) => {v.profile.manager_id = '7d1095fe-5853-4f88-bf3d-89691c6d9fd7';}],
    ['configuration', (v: Data) => {v.profile.configuration_revision = 'e'.repeat(64);}], ['resource', (v: Data) => {v.profile.resource_sha256 = 'e'.repeat(64);}],
    ['source SHA', (v: Data) => {v.items[0].sha256 = 'e'.repeat(64);}], ['bytes', (v: Data) => {v.items[0].bytes++;}],
    ['source id', (v: Data) => {v.items[0].source_id = 'source_other';}], ['file', (v: Data) => {v.items[0].subject.rel = 'Other.FCStd';}],
    ['step id', (v: Data) => {v.steps[0].id = 'step_other';}], ['blocked reason', (v: Data) => {v.steps[1].reason = 'Changed reason';}],
  ] as const)('includes frozen %s in complete host hash input', (_label, mutate) => {
    const p = input(), changed = mutable(p); mutate(changed); expect(hostHash(changed)).not.toBe(hostHash(p));
  });
  it.each(['id', 'task_id', 'task_revision', 'created_at', 'expires_at', 'items', 'actions', 'steps', 'effects', 'summary'] as const)('rejects changed %s wrapper projection', field => {
    const changed = mutable(envelope()); changed[field] = field === 'task_revision' ? 2 : []; rejects(() => validateWorkerBatchPlanV4(changed));
  });
  it.each([
    ['wrong version', (v: Data) => {v.protocol_version = 2;}], ['extra field', (v: Data) => {v.spawn = true;}],
    ['no files', (v: Data) => {v.items = []; v.steps = [];}], ['extra files', (v: Data) => {v.items = Array(201).fill(v.items[0]);}],
    ['duplicate item', (v: Data) => {v.items[1].id = v.items[0].id;}], ['duplicate source', (v: Data) => {v.items[1].source_id = v.items[0].source_id;}],
    ['duplicate path', (v: Data) => {v.items[1].subject.rel = v.items[0].subject.rel.toUpperCase();}],
    ['node input', (v: Data) => {v.items[0].subject.node = 'Body';}], ['CAD model expansion', (v: Data) => {v.items[0].subject.kind = 'cad_model';}],
    ['missing step', (v: Data) => {v.steps.pop();}], ['extra step', (v: Data) => {v.steps.push(v.steps[0]);}],
    ['duplicate step id', (v: Data) => {v.steps[1].id = v.steps[0].id;}], ['reordered steps', (v: Data) => {v.steps.reverse();}],
    ['wrong action', (v: Data) => {v.steps[0].action_instance_id = 'other_action';}], ['batch step', (v: Data) => {v.steps[0].scope = 'batch';}],
    ['blocked without reason', (v: Data) => {delete v.steps[1].reason;}], ['ready with reason', (v: Data) => {v.steps[0].reason = 'Unexplained';}],
    ['unavailable ready', (v: Data) => {v.steps[1].status = 'ready'; delete v.steps[1].reason;}],
    ['unavailable claimed SHA', (v: Data) => {v.items[1].sha256 = 'e'.repeat(64);}], ['unavailable claimed bytes', (v: Data) => {v.items[1].bytes = 1024;}],
    ['unavailable empty error', (v: Data) => {v.items[1].error = '';}], ['incomplete source', (v: Data) => {v.items[0].sha256 = null;}],
    ['empty FCStd', (v: Data) => {v.items[0].bytes = 0;}], ['over-budget source', (v: Data) => {v.items[0].bytes = WORKER_PLAN_V4_LIMITS.source_bytes + 1;}],
    ['unsafe SHA', (v: Data) => {v.items[0].sha256 = 'C'.repeat(64);}], ['fraction bytes', (v: Data) => {v.items[0].bytes = 0.5;}],
    ['invalid revision', (v: Data) => {v.task_revision = 0;}], ['noncanonical time', (v: Data) => {v.created_at = '2026-01-01T00:00:00Z';}],
    ['same expiry', (v: Data) => {v.expires_at = v.created_at;}], ['impossible date', (v: Data) => {v.created_at = '2026-02-30T00:00:00.000Z';}],
  ] as const)('rejects %s before serialization/admission', (_label, mutate) => {const v = mutable(input()); mutate(v); rejects(() => compileWorkerPreparedPlanV4(v));});
  it.each(['../Plate.FCStd', '/Plate.FCStd', 'C:/Plate.FCStd', 'folder\\Plate.FCStd', '.hidden/Plate.FCStd', 'folder/.Plate.FCStd',
    'node_modules/Plate.FCStd', '__pycache__/Plate.FCStd', 'folder//Plate.FCStd', 'folder/./Plate.FCStd', 'Plate.stp', 'Plate.FCStd1', 'Plate.FCStd ', ' Plate.FCStd', 'Plate\u0000.FCStd'])('rejects unsafe or non-FCStd file %s', rel => {
    const v = mutable(input()); v.items[0].subject.rel = rel; rejects(() => compileWorkerPreparedPlanV4(v));
  });
  it('accepts neutral Unicode filenames, but rejects normalized duplicates', () => {
    const p = mutable(input()); p.items[0].subject.rel = 'fixtures/圆柱.FCStd'; expect(compileWorkerPreparedPlanV4(p).items[0].subject.rel).toBe('fixtures/圆柱.FCStd');
    p.items[0].subject.rel = 'fixtures/caf\u00e9.FCStd'; p.items[1].subject.rel = 'fixtures/cafe\u0301.FCStd'; rejects(() => compileWorkerPreparedPlanV4(p));
  });
  it('preserves valid fingerprints for host-blocked supported scope', () => {
    const p = mutable(input()); p.steps[0].status = 'blocked'; p.steps[0].reason = 'Host preflight unavailable';
    const result = createWorkerBatchPlanV4(p, hostHash(p)); expect(result.items[0].sha256).toBe('c'.repeat(64)); expect(result.summary).toEqual({files: 2, actions: 1, executable: 0, excluded: 2});
  });
  it('accepts the exact upper bound of 200 distinct files with 200 file steps', () => {
    const p = mutable(input()); p.items = Array.from({length: 200}, (_, n) => ({id: `item_${n}`, source_id: `source_${n}`, subject: {kind: 'file', rel: `fixtures/Shape${n}.FCStd`}, sha256: 'c'.repeat(64), bytes: 1024}));
    p.steps = p.items.map((item: Data, n: number) => ({id: `step_${n}`, scope: 'file', item_id: item.id, action_instance_id: p.action_instance_id, status: 'ready'}));
    const result = createWorkerBatchPlanV4(p, hostHash(p)); expect(result.summary).toEqual({files: 200, actions: 1, executable: 200, excluded: 0});
  });
  it.each([
    ['unknown profile field', (p: Data) => {p.exe = '/not/a/capability';}], ['wrong profile', (p: Data) => {p.key = 'other.profile';}],
    ['wrong version', (p: Data) => {p.version = 2;}], ['different renderer', (p: Data) => {p.render_profile = 'other';}],
    ['binary claim', (p: Data) => {p.engine_attestation = 'binary_verified';}], ['bad manager UUID', (p: Data) => {p.manager_id = 'manager';}],
    ['bad revision', (p: Data) => {p.configuration_revision = '';}], ['bad resource SHA', (p: Data) => {p.resource_sha256 = 'bad';}],
    ['zero width', (p: Data) => {p.width = 0;}], ['fraction height', (p: Data) => {p.height = 2.5;}],
    ['oversize width', (p: Data) => {p.width = 1025;}], ['nonfinite height', (p: Data) => {p.height = Infinity;}],
  ] as const)('rejects %s in fixed host profile', (_label, mutate) => {const p = mutable(input().profile); mutate(p); rejects(() => validateWorkerThumbnailProfileV4(p));});
  it('rejects executable values and hidden/extra fields without reading them', () => {
    const getter = vi.fn(() => 4), p = mutable(input()); Object.defineProperty(p, 'protocol_version', {get: getter, enumerable: true}); rejects(() => compileWorkerPreparedPlanV4(p));
    const e = mutable(envelope()); Object.defineProperty(e, 'prepared', {get: getter, enumerable: true}); rejects(() => validateWorkerBatchPlanV4(e));
    const profile = mutable(input().profile); Object.defineProperty(profile, 'width', {get: getter, enumerable: true}); rejects(() => validateWorkerThumbnailProfileV4(profile));
    const hidden = mutable(input()); Object.defineProperty(hidden, 'id', {value: 'plan_example', enumerable: false}); rejects(() => compileWorkerPreparedPlanV4(hidden));
    rejects(() => compileWorkerPreparedPlanV4({...input(), [Symbol('extra')]: true})); expect(getter).not.toHaveBeenCalled();
  });
  it('rejects sparse/accessor/custom/oversized arrays before hooks or per-entry allocation', () => {
    const getter = vi.fn(() => input().items[0]);
    for (const kind of ['sparse', 'accessor', 'custom', 'oversized', 'extra'] as const) {
      const p = mutable(input());
      if (kind === 'sparse') delete p.items[0];
      if (kind === 'accessor') Object.defineProperty(p.items, '0', {get: getter, enumerable: true});
      if (kind === 'custom') Object.setPrototypeOf(p.items, Object.assign(Object.create(Array.prototype), {map: getter}));
      if (kind === 'oversized') p.items.length = 100_000;
      if (kind === 'extra') p.items.extra = true;
      rejects(() => compileWorkerPreparedPlanV4(p));
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('accepts only the single empty-param worker task; V2/V3 validators remain closed', () => {
    expect(workerTaskDraft(draft())).toEqual(draft());
    expect(() => taskDraft(draft(), [])).toThrow();
    expect(() => validateNativeBatchPlanV3(envelope())).toThrow();
    expect(() => compilePlanV2(envelope() as never)).toThrow();
    const variant = draft(); variant.actions.push({...variant.actions[0], instance_id: 'another'}); rejects(() => workerTaskDraft(variant));
  });
  it.each([
    ['params', (d: Data) => {d.actions[0].params = {width: 512};}], ['foreign action', (d: Data) => {d.actions[0].key = 'file.metadata';}],
    ['action version', (d: Data) => {d.actions[0].version = 2;}], ['node selection', (d: Data) => {d.subjects[0].node = 'Body';}],
    ['directory scan', (d: Data) => {d.subjects[0].kind = 'directory';}], ['no files', (d: Data) => {d.subjects = [];}],
    ['duplicate filename', (d: Data) => {d.subjects[1].rel = d.subjects[0].rel;}], ['unknown task field', (d: Data) => {d.run = true;}],
    ['empty title', (d: Data) => {d.name = '  ';}], ['hidden action param', (d: Data) => {Object.defineProperty(d.actions[0].params, 'width', {value: 512});}],
  ] as const)('rejects task %s without enabling a worker', (_label, mutate) => {const d = draft(); mutate(d); rejects(() => workerTaskDraft(d));});
});
