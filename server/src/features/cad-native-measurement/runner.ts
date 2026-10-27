import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {spawn} from 'node:child_process';
import {assertSafeFreecadCommand, buildFreecadChildEnvironment} from '../../lib/freecadProcessSecurity.js';
import {acquireDrawingExecution,type DrawingExecutionLease} from '../drawing-research/executionGate.js';
import {readBoundedFile} from '../cad-companions/filesystem.js';
import {canonicalSingleFeatureManifestPayload, extractSavedShapeSnapshot, prepareSingleFeatureManifest,
  type NativeMeasurementProfile, type SingleFeatureManifest} from './manifest.js';
import {canonicalNativeProfileV3Payload, canonicalPreparedNativeTicketV3Payload, validatePreparedNativeTicketV3,
  type PreparedNativeTicketV3} from '../../../../shared/batch-tasks/native-protocol.js';

const MAX_SOURCE = 64 * 1024 * 1024, MAX_SHAPE = 32 * 1024 * 1024, MAX_BINARY = 256 * 1024 * 1024;
const MAX_REPORT = 16 * 1024, MAX_OUTPUT = 256 * 1024, TIMEOUT_MS = 120_000, GRACE_MS = 1000;
const ALGORITHM = 'single-feature-native-bounds-v1';
const SNAPSHOT_ALGORITHM = 'saved-brep-snapshot-native-bounds-v1';
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const stamp = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

export type NativeMeasurementFailureCode = 'invalid_context' | 'cancelled' | 'gate_busy' | 'manifest_mismatch'
  | 'manifest_not_ready' | 'engine_invalid' | 'engine_changed' | 'source_changed' | 'stage_changed'
  | 'setup_failed' | 'spawn_failed' | 'spawn_receipt_failed' | 'owner_marker_failed' | 'timeout'
  | 'output_limit' | 'report_invalid' | 'native_failed' | 'close_receipt_failed' | 'cleanup_failed' | 'profile_mismatch' | 'host_barrier_uncertain'
  | 'lifecycle_receipt_failed' | 'result_receipt_failed';
const NATIVE_FAILURE_STAGES = ['initialization','owner_handshake','private_environment','staged_bytes','document_restore',
  'entity_validation','shape_import','shape_validation','bounds_measurement','engine_identity','document_close'] as const;
const NATIVE_FAILURE_CODES = ['invalid_job_spec','owner_timeout','owner_marker_invalid','owner_mismatch','private_path_mismatch',
  'unexpected_document','stage_unsafe','stage_limit','stage_identity_mismatch','restored_structure_mismatch','entity_mismatch',
  'placement_not_identity','placement_changed','shape_null','unsupported_shape_type','shape_invalid','shape_not_closed',
  'solid_count_mismatch','volume_invalid','bounds_nonfinite','bounds_invalid','engine_version_mismatch','document_close_unobserved',
  'stage_changed','unexpected_native_failure'] as const;
const NATIVE_SHAPE_TYPES = ['Shape','Vertex','Edge','Wire','Face','Shell','Solid','CompSolid','Compound','unknown'] as const;
export type NativeFailureStage = typeof NATIVE_FAILURE_STAGES[number];
export type NativeFailureCode = typeof NATIVE_FAILURE_CODES[number];
export type NativeFailureShapeType = typeof NATIVE_SHAPE_TYPES[number];
const FAILURE_GUARDS: Record<NativeFailureStage, readonly NativeFailureCode[]> = {
  initialization: ['invalid_job_spec'], owner_handshake: ['owner_timeout','owner_marker_invalid','owner_mismatch'],
  private_environment: ['private_path_mismatch','unexpected_document'],
  staged_bytes: ['stage_unsafe','stage_limit','stage_identity_mismatch','stage_changed'],
  document_restore: ['restored_structure_mismatch'], entity_validation: ['entity_mismatch','placement_not_identity','placement_changed'],
  shape_import: ['unexpected_document'], shape_validation: ['shape_null','unsupported_shape_type','shape_invalid','shape_not_closed','solid_count_mismatch','volume_invalid'],
  bounds_measurement: ['bounds_nonfinite','bounds_invalid'], engine_identity: ['engine_version_mismatch'],
  document_close: ['unexpected_document','document_close_unobserved'],
};
function isNativeFailurePair(stage: unknown, code: unknown, profile: NativeMeasurementProfile): boolean {
  if (typeof stage !== 'string' || !NATIVE_FAILURE_STAGES.includes(stage as NativeFailureStage)
    || typeof code !== 'string' || !NATIVE_FAILURE_CODES.includes(code as NativeFailureCode)) return false;
  if (profile === 'saved_brep_snapshot' ? ['document_restore','entity_validation','document_close'].includes(stage) : stage === 'shape_import') return false;
  return code === 'unexpected_native_failure' || FAILURE_GUARDS[stage as NativeFailureStage].includes(code as NativeFailureCode);
}
type NativeFailureDiagnostic = {
  native_failure_stage: NativeFailureStage; native_failure_code: NativeFailureCode; native_shape_type?: NativeFailureShapeType;
};
/** Fixed codes only. actual_close_observed is NOT a durable host-barrier receipt. */
export class NativeMeasurementError extends Error {
  readonly native_failure_stage?: NativeFailureStage;
  readonly native_failure_code?: NativeFailureCode;
  readonly native_shape_type?: NativeFailureShapeType;
  constructor(readonly code: NativeMeasurementFailureCode, readonly actual_close_observed = false, diagnostic?: NativeFailureDiagnostic) {
    super(code); this.name = 'NativeMeasurementError';
    if (diagnostic) {
      this.native_failure_stage = diagnostic.native_failure_stage;
      this.native_failure_code = diagnostic.native_failure_code;
      if (diagnostic.native_shape_type) this.native_shape_type = diagnostic.native_shape_type;
    }
  }
}
function requireFact(value: unknown, code: NativeMeasurementFailureCode): asserts value {
  if (!value) throw new NativeMeasurementError(code);
}
export type FrozenNativeEngine = {
  command: string; bytes: number; sha256: string;
  app_version: readonly [string, string, string]; occ_version: string;
};
export type NativeSpawnProof = Readonly<{
  owned_pid: number; nonce: string; manifest_sha256: string; execution_sha256: string;
  engine_sha256: string; script_sha256: string; timeout_ms: number; measurement_profile: NativeMeasurementProfile;
}>;
export type NativeCloseProof = NativeSpawnProof & Readonly<{
  actual_close_observed: true; exit_code: number | null; signal: NodeJS.Signals | null;
  owner_acknowledged: boolean; owner_marker_written: boolean;
  output_bytes: number; termination_requests: readonly ('SIGTERM' | 'SIGKILL')[];
}>;
export type NativeLifecycleObservation = Readonly<{type:'cancel_requested'|'timeout'} | {
  type:'kill_result'; signal:'SIGTERM'|'SIGKILL'; result:'returned_true'|'returned_false'|'threw';
}>;
declare const nativeTaskTicketBrand: unique symbol;
/** An in-memory, single-use host object. JSON/imported task data cannot recreate it. */
export type NativeTaskExecutionTicket = {readonly [nativeTaskTicketBrand]:true};
const taskExecutions = new WeakMap<NativeTaskExecutionTicket,{root:string;ticket:PreparedNativeTicketV3;used:boolean}>();
/** Host-only bridge after whole-plan admission. This checks crypto and the builtin,
 * but does not spawn or grant rights to a serialized DTO. The coordinator must
 * durably prepare the exact ticket before passing this private object to run. */
export function bindNativeTaskTicket(root:string,input:PreparedNativeTicketV3):NativeTaskExecutionTicket {
  try{
    const ticket=validatePreparedNativeTicketV3(input);
    requireFact(sha(canonicalPreparedNativeTicketV3Payload({binding:ticket.binding,step:ticket.step}))===ticket.execution_digest_claim,'invalid_context');
    requireFact(sha(canonicalNativeProfileV3Payload(ticket.step.profile))===ticket.step.profile_sha256
      && ticket.step.profile.script_sha256===SAVED_BREP_SNAPSHOT_IDENTITY.script_sha256,'invalid_context');
    requireFact(sha(canonicalSingleFeatureManifestPayload(ticket.step.manifest))===ticket.step.manifest.manifest_sha256,'invalid_context');
    const canonicalRoot=fs.realpathSync(root);
    requireFact(path.isAbsolute(root)&&!fs.lstatSync(root).isSymbolicLink()&&fs.lstatSync(canonicalRoot).isDirectory(),'invalid_context');
    const handle=Object.freeze({}) as NativeTaskExecutionTicket;
    taskExecutions.set(handle,{root:canonicalRoot,ticket,used:false});return handle;
  }catch{throw new NativeMeasurementError('invalid_context');}
}
export type NativeMeasurementContext = {
  signal?: AbortSignal;
  /** Host profile only, never an action parameter. 100..120000 ms. */
  timeout_ms?: number;
  /** Host-owned persistence, not an executable function deserialized from a task. */
  onSpawn: (proof: NativeSpawnProof) => void | Promise<void>;
  /** Failure makes the task ledger uncertain. Host ownership is independent:
   * an already durably observed actual close may still release its barrier. */
  onClose: (proof: NativeCloseProof) => void | Promise<void>;
  /** Observations are serialized after spawn persistence and before close. */
  onLifecycle?: (event:NativeLifecycleObservation)=>void|Promise<void>;
  /** Required with taskTicket; awaited after report/source/engine verification,
   * before returning or releasing. This callback commits only the task ledger. */
  onVerifiedMeasurement?: (result:SavedBrepSnapshotMeasurement)=>void|Promise<void>;
  taskTicket?:NativeTaskExecutionTicket;
};
export type NativeBounds = {
  x_min: number; x_max: number; y_min: number; y_max: number; z_min: number; z_max: number;
  x_length: number; y_length: number; z_length: number;
};
export type SingleFeatureMeasurement = {
  schema_version: 1; status: 'measured'; algorithm_version: typeof ALGORITHM; script_sha256: string;
  measurement_mode: 'restored_document_no_save'; coordinate_system: 'staged_document_xyz';
  manifest_sha256: string; source: {rel: string; bytes: number; sha256: string};
  shape: {basis: 'serialized_shape_snapshot'; member_path: string; bytes: number; sha256: string};
  entity: {node: string; type_id: 'Part::Feature'}; bounds_mm: NativeBounds; volume_mm3: number;
  native_shape_type: 'Solid'; valid: true; closed: true; solid_count: 1; placement_identity: true; placement_unchanged: true;
  loaded_document_count: 1; entity_count: 1; document_closed: true; private_paths_checked: true;
  app_version: [string, string, string]; occ_version: string;
  engine: {bytes: number; sha256: string}; process_proof: NativeCloseProof;
  byte_preservation: {source_before: string; source_after: string; stage_before: string; stage_after: string};
};
/** Saved carrier geometry only: not a restored document, parameter state or frame. */
export type SavedBrepSnapshotMeasurement = {
  schema_version: 1; status: 'measured'; algorithm_version: typeof SNAPSHOT_ALGORITHM; script_sha256: string;
  measurement_mode: 'saved_brep_snapshot_no_document'; coordinate_system: 'serialized_saved_shape_xyz';
  manifest_sha256: string; source: {rel: string; bytes: number; sha256: string};
  shape: {basis: 'serialized_shape_snapshot'; member_path: string; bytes: number; sha256: string};
  saved_entity: {node: string; type_id: 'Part::Feature'}; bounds_mm: NativeBounds; volume_mm3: number;
  native_shape_type: 'Solid'; valid: true; closed: true; solid_count: 1;
  loaded_document_count: 0; document_opened: false; restored_document_verified: false;
  parameter_freshness: 'not_attested'; document_frame: 'not_attested'; private_paths_checked: true;
  app_version: [string,string,string]; occ_version: string; engine: {bytes: number; sha256: string}; process_proof: NativeCloseProof;
  byte_preservation: {source_before: string; source_after: string; staged_shape_before: string; staged_shape_after: string};
};

// This fixed program never evaluates job text as code and never saves/recomputes.
// The owner marker is the only permission to open the exact staged document.
const PYTHON = String.raw`
import hashlib, json, math, os, time
from pathlib import Path
import FreeCAD as App
import Part

root = Path.cwd().resolve()
doc = None
result = {'schema_version': 1, 'state': 'failed'}
failure_stage = 'initialization'
failure_shape_type = None
failure_proof = None
class MeasurementFailure(Exception):
    def __init__(self, code):
        self.code = code
def failure_report(code):
    report = {'schema_version': 1, 'state': 'failed', 'proof': failure_proof, 'failure_stage': failure_stage, 'failure_code': code}
    if failure_shape_type is not None:
        report['shape_type'] = failure_shape_type
    return report
def file_identity(filename):
    if filename.is_symlink() or not filename.is_file():
        raise MeasurementFailure('stage_unsafe')
    h = hashlib.sha256()
    count = 0
    with filename.open('rb') as stream:
        while True:
            block = stream.read(65536)
            if not block:
                break
            count += len(block)
            if count > 67108864:
                raise MeasurementFailure('stage_limit')
            h.update(block)
    return {'bytes': count, 'sha256': h.hexdigest()}
try:
    spec_path = root / 'job.json'
    if spec_path.stat().st_size > 16384:
        raise MeasurementFailure('invalid_job_spec')
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    failure_proof = dict(spec['proof'], owned_pid=os.getpid())
    failure_stage = 'owner_handshake'
    deadline = time.monotonic() + 30.0
    owner_path = root / 'owner.json'
    while not owner_path.exists():
        if time.monotonic() >= deadline:
            raise MeasurementFailure('owner_timeout')
        time.sleep(0.02)
    if owner_path.is_symlink() or owner_path.stat().st_size > 4096:
        raise MeasurementFailure('owner_marker_invalid')
    owner = json.loads(owner_path.read_text(encoding='utf-8'))
    expected_owner = dict(spec['proof'], owned_pid=os.getpid())
    if owner != expected_owner or owner['measurement_profile'] != 'restored_document':
        raise MeasurementFailure('owner_mismatch')
    failure_stage = 'private_environment'
    private_paths = {'UserHomePath': 'home', 'UserConfigPath': 'home',
        'UserAppData': 'data', 'UserCachePath': 'temp', 'AppTempPath': 'temp'}
    for key, directory in private_paths.items():
        if Path(App.ConfigGet(key)).resolve() != (root / directory).resolve():
            raise MeasurementFailure('private_path_mismatch')
    if App.listDocuments():
        raise MeasurementFailure('unexpected_document')
    failure_stage = 'staged_bytes'
    stage = root / 'source.FCStd'
    source_before = file_identity(stage)
    if source_before != spec['source']:
        raise MeasurementFailure('stage_identity_mismatch')
    failure_stage = 'document_restore'
    doc = App.openDocument(str(stage))
    if set(App.listDocuments()) != {doc.Name} or len(doc.Objects) != 1:
        raise MeasurementFailure('restored_structure_mismatch')
    failure_stage = 'entity_validation'
    obj = doc.getObject(spec['node'])
    if obj is None or obj.Name != spec['node'] or obj.TypeId != 'Part::Feature':
        raise MeasurementFailure('entity_mismatch')
    placement_before = [float(value) for value in obj.Placement.toMatrix().A]
    identity = [1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.]
    if placement_before != identity:
        raise MeasurementFailure('placement_not_identity')
    failure_stage = 'shape_validation'
    shape = obj.Shape
    if shape.isNull():
        raise MeasurementFailure('shape_null')
    shape_type = shape.ShapeType
    failure_shape_type = shape_type if shape_type in ('Shape','Vertex','Edge','Wire','Face','Shell','Solid','CompSolid','Compound') else 'unknown'
    if shape_type != 'Solid':
        raise MeasurementFailure('unsupported_shape_type')
    if not shape.isValid():
        raise MeasurementFailure('shape_invalid')
    if not shape.isClosed():
        raise MeasurementFailure('shape_not_closed')
    if len(shape.Solids) != 1:
        raise MeasurementFailure('solid_count_mismatch')
    volume = float(shape.Volume)
    if not math.isfinite(volume) or volume <= 0:
        raise MeasurementFailure('volume_invalid')
    failure_stage = 'bounds_measurement'
    box = shape.BoundBox
    bounds = dict(zip(['x_min','x_max','y_min','y_max','z_min','z_max','x_length','y_length','z_length'],
        [float(box.XMin),float(box.XMax),float(box.YMin),float(box.YMax),float(box.ZMin),float(box.ZMax),
         float(box.XLength),float(box.YLength),float(box.ZLength)]))
    if any(not math.isfinite(value) for value in bounds.values()):
        raise MeasurementFailure('bounds_nonfinite')
    for axis in ['x','y','z']:
        length = bounds[axis + '_length']
        if length <= 0 or not math.isclose(bounds[axis + '_max'] - bounds[axis + '_min'], length, rel_tol=1e-10, abs_tol=1e-9):
            raise MeasurementFailure('bounds_invalid')
    failure_stage = 'entity_validation'
    if placement_before != [float(value) for value in obj.Placement.toMatrix().A]:
        raise MeasurementFailure('placement_changed')
    failure_stage = 'engine_identity'
    version = [str(value) for value in list(App.Version())[:3]]
    occ_version = str(Part.OCC_VERSION)
    if version != spec['app_version'] or occ_version != spec['occ_version']:
        raise MeasurementFailure('engine_version_mismatch')
    failure_stage = 'document_close'
    if set(App.listDocuments()) != {doc.Name}:
        raise MeasurementFailure('unexpected_document')
    App.closeDocument(doc.Name)
    doc = None
    if App.listDocuments():
        raise MeasurementFailure('document_close_unobserved')
    failure_stage = 'staged_bytes'
    source_after = file_identity(stage)
    if source_after != source_before:
        raise MeasurementFailure('stage_changed')
    result = {'schema_version': 1, 'state': 'measured', 'proof': owner,
        'source_before': source_before, 'source_after': source_after,
        'node': spec['node'], 'type_id': 'Part::Feature', 'bounds_mm': bounds, 'volume_mm3': volume,
        'shape_type': 'Solid', 'valid': True, 'closed': True, 'solid_count': 1,
        'placement_identity': True, 'placement_unchanged': True,
        'loaded_document_count': 1, 'entity_count': 1, 'document_closed': True,
        'private_paths_checked': True, 'owner_marker_verified': True,
        'app_version': version, 'occ_version': occ_version}
except MeasurementFailure as failure:
    result = failure_report(failure.code)
except Exception:
    # No native exception, source path, arbitrary text or traceback in the DTO.
    result = failure_report('unexpected_native_failure')
finally:
    # Close only the document this invocation opened, never all loaded documents.
    if doc is not None:
        try:
            App.closeDocument(doc.Name)
        except Exception:
            pass
    text = json.dumps(result, ensure_ascii=True, allow_nan=False)
    if len(text.encode('utf-8')) <= 16384:
        (root / 'report.json').write_text(text, encoding='utf-8')
`;

export const NATIVE_MEASUREMENT_IDENTITY = Object.freeze({algorithm_version: ALGORITHM, script_sha256: sha(PYTHON)});

// FreeCAD 1.1.0 TopoShapePyImp.cpp:508 accepts a UTF-8 filename for importBrep;
// TopoShape.cpp:777 calls BRepTools::Read, without creating an App document.
// https://github.com/FreeCAD/FreeCAD/blob/1.1.0/src/Mod/Part/App/TopoShapePyImp.cpp#L508
const SNAPSHOT_PYTHON = String.raw`
import hashlib, json, math, os, time
from pathlib import Path
import FreeCAD as App
import Part

root = Path.cwd().resolve()
result = {'schema_version': 1, 'state': 'failed'}
failure_stage = 'initialization'
failure_shape_type = None
failure_proof = None
class MeasurementFailure(Exception):
    def __init__(self, code):
        self.code = code
def failure_report(code):
    report = {'schema_version': 1, 'state': 'failed', 'proof': failure_proof, 'failure_stage': failure_stage, 'failure_code': code}
    if failure_shape_type is not None:
        report['shape_type'] = failure_shape_type
    return report
def shape_identity(filename):
    if filename.is_symlink() or not filename.is_file():
        raise MeasurementFailure('stage_unsafe')
    h = hashlib.sha256()
    count = 0
    with filename.open('rb') as stream:
        while True:
            block = stream.read(65536)
            if not block:
                break
            count += len(block)
            if count > 33554432:
                raise MeasurementFailure('stage_limit')
            h.update(block)
    return {'bytes': count, 'sha256': h.hexdigest()}
try:
    spec_path = root / 'job.json'
    if spec_path.stat().st_size > 16384:
        raise MeasurementFailure('invalid_job_spec')
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    failure_proof = dict(spec['proof'], owned_pid=os.getpid())
    failure_stage = 'owner_handshake'
    deadline = time.monotonic() + 30.0
    owner_path = root / 'owner.json'
    while not owner_path.exists():
        if time.monotonic() >= deadline:
            raise MeasurementFailure('owner_timeout')
        time.sleep(0.02)
    if owner_path.is_symlink() or owner_path.stat().st_size > 4096:
        raise MeasurementFailure('owner_marker_invalid')
    owner = json.loads(owner_path.read_text(encoding='utf-8'))
    if owner != dict(spec['proof'], owned_pid=os.getpid()) or owner['measurement_profile'] != 'saved_brep_snapshot':
        raise MeasurementFailure('owner_mismatch')
    failure_stage = 'private_environment'
    private_paths = {'UserHomePath': 'home', 'UserConfigPath': 'home',
        'UserAppData': 'data', 'UserCachePath': 'temp', 'AppTempPath': 'temp'}
    for key, directory in private_paths.items():
        if Path(App.ConfigGet(key)).resolve() != (root / directory).resolve():
            raise MeasurementFailure('private_path_mismatch')
    if App.listDocuments():
        raise MeasurementFailure('unexpected_document')
    failure_stage = 'staged_bytes'
    stage = root / 'shape.brp'
    before = shape_identity(stage)
    if before != spec['shape']:
        raise MeasurementFailure('stage_identity_mismatch')
    failure_stage = 'shape_import'
    shape = Part.Shape()
    shape.importBrep(str(stage))
    if App.listDocuments():
        raise MeasurementFailure('unexpected_document')
    failure_stage = 'shape_validation'
    if shape.isNull():
        raise MeasurementFailure('shape_null')
    shape_type = shape.ShapeType
    failure_shape_type = shape_type if shape_type in ('Shape','Vertex','Edge','Wire','Face','Shell','Solid','CompSolid','Compound') else 'unknown'
    if shape_type != 'Solid':
        raise MeasurementFailure('unsupported_shape_type')
    if not shape.isValid():
        raise MeasurementFailure('shape_invalid')
    if not shape.isClosed():
        raise MeasurementFailure('shape_not_closed')
    if len(shape.Solids) != 1:
        raise MeasurementFailure('solid_count_mismatch')
    volume = float(shape.Volume)
    if not math.isfinite(volume) or volume <= 0:
        raise MeasurementFailure('volume_invalid')
    failure_stage = 'bounds_measurement'
    box = shape.BoundBox
    bounds = dict(zip(['x_min','x_max','y_min','y_max','z_min','z_max','x_length','y_length','z_length'],
        [float(box.XMin),float(box.XMax),float(box.YMin),float(box.YMax),float(box.ZMin),float(box.ZMax),
         float(box.XLength),float(box.YLength),float(box.ZLength)]))
    if any(not math.isfinite(value) for value in bounds.values()):
        raise MeasurementFailure('bounds_nonfinite')
    for axis in ['x','y','z']:
        length = bounds[axis + '_length']
        if length <= 0 or not math.isclose(bounds[axis + '_max'] - bounds[axis + '_min'], length, rel_tol=1e-10, abs_tol=1e-9):
            raise MeasurementFailure('bounds_invalid')
    failure_stage = 'engine_identity'
    version = [str(value) for value in list(App.Version())[:3]]
    occ_version = str(Part.OCC_VERSION)
    if version != spec['app_version'] or occ_version != spec['occ_version']:
        raise MeasurementFailure('engine_version_mismatch')
    failure_stage = 'staged_bytes'
    after = shape_identity(stage)
    if before != after:
        raise MeasurementFailure('stage_changed')
    if App.listDocuments():
        failure_stage = 'shape_import'
        raise MeasurementFailure('unexpected_document')
    result = {'schema_version': 1, 'state': 'measured', 'proof': owner,
        'shape_before': before, 'shape_after': after, 'node': spec['node'], 'type_id': 'Part::Feature',
        'bounds_mm': bounds, 'volume_mm3': volume, 'shape_type': 'Solid', 'valid': True, 'closed': True, 'solid_count': 1,
        'measurement_mode': 'saved_brep_snapshot_no_document', 'coordinate_system': 'serialized_saved_shape_xyz',
        'loaded_document_count': 0, 'document_opened': False,
        'private_paths_checked': True, 'owner_marker_verified': True, 'app_version': version, 'occ_version': occ_version}
except MeasurementFailure as failure:
    result = failure_report(failure.code)
except Exception:
    result = failure_report('unexpected_native_failure')
finally:
    text = json.dumps(result, ensure_ascii=True, allow_nan=False)
    if len(text.encode('utf-8')) <= 16384:
        (root / 'report.json').write_text(text, encoding='utf-8')
`;
export const SAVED_BREP_SNAPSHOT_IDENTITY = Object.freeze({algorithm_version: SNAPSHOT_ALGORITHM, script_sha256: sha(SNAPSHOT_PYTHON)});

function readLocal(filename: string, maximum: number, retainData = true): {data: Buffer; bytes: number; sha256: string} {
  const before = fs.lstatSync(filename, {bigint: true});
  requireFact(before.isFile() && !before.isSymbolicLink() && before.size <= BigInt(maximum), 'setup_failed');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    requireFact(stamp(fs.fstatSync(fd, {bigint: true})) === stamp(before), 'setup_failed');
    const chunks: Buffer[] = [], buffer = Buffer.alloc(65536), hash = createHash('sha256'); let bytes = 0;
    while (bytes <= Number(before.size)) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - bytes + 1), bytes);
      if (!count) break;
      bytes += count; requireFact(bytes <= maximum, 'setup_failed'); hash.update(buffer.subarray(0, count));
      if (retainData) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    requireFact(BigInt(bytes) === before.size && stamp(fs.fstatSync(fd, {bigint: true})) === stamp(before)
      && stamp(fs.lstatSync(filename, {bigint: true})) === stamp(before), 'setup_failed');
    return {data: Buffer.concat(chunks), bytes, sha256: hash.digest('hex')};
  } finally {fs.closeSync(fd);}
}
function writeExclusive(filename: string, value: string | Uint8Array) {
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    const data = typeof value === 'string' ? Buffer.from(value) : value; let offset = 0;
    while (offset < data.byteLength) {
      const count = fs.writeSync(fd, data, offset, data.byteLength - offset);
      requireFact(count > 0, 'setup_failed'); offset += count;
    }
    fs.fsyncSync(fd);
  } finally {fs.closeSync(fd);}
}
/** Publish complete authorization bytes, never an observable empty owner.json.
 * link is no-replace on Darwin/Linux/Windows; an existing marker is a failure,
 * even if its contents happen to match. Only our captured temp inode is cleaned.
 */
function publishOwnerMarker(folder: string, proof: NativeSpawnProof) {
  const temporary = path.join(folder, '.owner-' + randomUUID() + '.tmp'), target = path.join(folder, 'owner.json');
  const data = Buffer.from(JSON.stringify(proof)); requireFact(data.byteLength <= 4096, 'owner_marker_failed');
  let fd: number | undefined, identity: {dev: bigint; ino: bigint} | undefined;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const opened = fs.fstatSync(fd, {bigint: true}); identity = {dev: opened.dev, ino: opened.ino};
    requireFact(opened.isFile() && opened.nlink === 1n, 'owner_marker_failed');
    let offset = 0;
    while (offset < data.length) {
      const count = fs.writeSync(fd, data, offset, data.length - offset);
      requireFact(count > 0, 'owner_marker_failed'); offset += count;
    }
    fs.fsyncSync(fd);
    const written = fs.fstatSync(fd, {bigint: true}), entry = fs.lstatSync(temporary, {bigint: true});
    requireFact(written.isFile() && written.nlink === 1n && written.size === BigInt(data.length)
      && stamp(written) === stamp(entry) && readLocal(temporary, 4096).data.equals(data), 'owner_marker_failed');
    fs.linkSync(temporary, target); // Atomic visibility; never replaces a foreign marker.
    const published = fs.lstatSync(target, {bigint: true});
    requireFact(published.isFile() && !published.isSymbolicLink() && published.dev === identity.dev && published.ino === identity.ino, 'owner_marker_failed');
  } finally {
    if (identity) {
      try {
        const entry = fs.lstatSync(temporary, {bigint: true});
        if (entry.isFile() && !entry.isSymbolicLink() && entry.dev === identity.dev && entry.ino === identity.ino) fs.unlinkSync(temporary);
      } catch {/* Keep uncertain temporary evidence; never unlink an unowned inode. */}
    }
    if (fd !== undefined) try {fs.closeSync(fd);} catch {/* Data was fsynced before publication; child lifecycle still owns settlement. */}
  }
}
function privateEnvironment(folder: string): NodeJS.ProcessEnv {
  const directories = Object.fromEntries(['home','data','temp','xdg-config','xdg-cache','xdg-data','xdg-runtime'].map(name => {
    const directory = path.join(folder, name); fs.mkdirSync(directory, {mode: 0o700}); return [name, directory];
  }));
  return {...buildFreecadChildEnvironment(process.env),
    FREECAD_USER_HOME: directories.home, FREECAD_USER_DATA: directories.data, FREECAD_USER_TEMP: directories.temp,
    XDG_CONFIG_HOME: directories['xdg-config'], XDG_CACHE_HOME: directories['xdg-cache'],
    XDG_DATA_HOME: directories['xdg-data'], XDG_RUNTIME_DIR: directories['xdg-runtime'],
    TMPDIR: directories.temp, TMP: directories.temp, TEMP: directories.temp};
}
function engineIdentity(engine: FrozenNativeEngine): FrozenNativeEngine {
  requireFact(engine && typeof engine.command === 'string' && path.isAbsolute(engine.command)
    && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(engine.command) && /^[a-f0-9]{64}$/.test(engine.sha256)
    && Number.isSafeInteger(engine.bytes) && engine.bytes > 0 && engine.bytes <= MAX_BINARY
    && Array.isArray(engine.app_version) && engine.app_version.length === 3
    && engine.app_version.every(value => typeof value === 'string' && /^[0-9A-Za-z.+_-]{1,40}$/.test(value))
    && typeof engine.occ_version === 'string' && /^[0-9A-Za-z.+_()-]{1,64}$/.test(engine.occ_version), 'engine_invalid');
  try {
    const command = assertSafeFreecadCommand(engine.command);
    requireFact(/^freecadcmd(?:\.exe)?$/i.test(path.basename(command)), 'engine_invalid');
    fs.accessSync(command, fs.constants.X_OK);
    const actual = readLocal(command, MAX_BINARY, false);
    requireFact(actual.bytes === engine.bytes && actual.sha256 === engine.sha256, 'engine_changed');
    return {command, bytes: engine.bytes, sha256: engine.sha256,
      app_version: [...engine.app_version] as [string,string,string], occ_version: engine.occ_version};
  } catch (error) {if (error instanceof NativeMeasurementError) throw error; throw new NativeMeasurementError('engine_invalid');}
}
/** Bounded host-side fingerprint check only. Never launches an engine or trusts
 * version claims as a fresh Native observation. Runtime reports must match too. */
export function verifyFrozenNativeEngine(engine:FrozenNativeEngine):FrozenNativeEngine{return engineIdentity(engine);}
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}
function wireReport(value: unknown, proof: NativeSpawnProof, manifest: SingleFeatureManifest, engine: FrozenNativeEngine,
  profile: NativeMeasurementProfile): {bounds: NativeBounds; volume: number} {
  const expectedProof: NativeSpawnProof = {owned_pid: proof.owned_pid, nonce: proof.nonce, manifest_sha256: proof.manifest_sha256,
    execution_sha256: proof.execution_sha256, engine_sha256: proof.engine_sha256, script_sha256: proof.script_sha256,
    timeout_ms: proof.timeout_ms, measurement_profile: profile};
  const matchesProof = (candidate: unknown) => exactKeys(candidate, Object.keys(expectedProof))
    && Object.entries(expectedProof).every(([key, expected]) => candidate[key] === expected);
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).state === 'failed') {
    const failure = value as Record<string, unknown>, hasShape = Object.hasOwn(failure, 'shape_type');
    requireFact(exactKeys(failure, ['schema_version','state','proof','failure_stage','failure_code', ...(hasShape ? ['shape_type'] : [])])
      && failure.schema_version === 1 && matchesProof(failure.proof)
      && isNativeFailurePair(failure.failure_stage, failure.failure_code, profile)
      && (!hasShape || typeof failure.shape_type === 'string' && NATIVE_SHAPE_TYPES.includes(failure.shape_type as NativeFailureShapeType)), 'report_invalid');
    throw new NativeMeasurementError('native_failed', true, {
      native_failure_stage: failure.failure_stage as NativeFailureStage, native_failure_code: failure.failure_code as NativeFailureCode,
      ...(hasShape ? {native_shape_type: failure.shape_type as NativeFailureShapeType} : {}),
    });
  }
  const snapshot = profile === 'saved_brep_snapshot';
  const profileKeys = snapshot ? ['shape_before','shape_after','measurement_mode','coordinate_system','document_opened']
    : ['source_before','source_after','placement_identity','placement_unchanged','entity_count','document_closed'];
  requireFact(exactKeys(value, ['schema_version','state','proof','node','type_id','bounds_mm','shape_type','valid','closed','solid_count',
    'loaded_document_count','private_paths_checked','owner_marker_verified','app_version','occ_version','volume_mm3', ...profileKeys]), 'report_invalid');
  requireFact(value.schema_version === 1 && value.state === 'measured' && value.node === manifest.entity.node
    && value.type_id === 'Part::Feature' && value.shape_type === 'Solid' && value.valid === true && value.closed === true && value.solid_count === 1
    && value.loaded_document_count === (snapshot ? 0 : 1) && value.private_paths_checked === true && value.owner_marker_verified === true
    && JSON.stringify(value.app_version) === JSON.stringify(engine.app_version) && value.occ_version === engine.occ_version, 'report_invalid');
  requireFact(snapshot ? value.measurement_mode === 'saved_brep_snapshot_no_document'
    && value.coordinate_system === 'serialized_saved_shape_xyz' && value.document_opened === false
    : value.placement_identity === true && value.placement_unchanged === true && value.entity_count === 1 && value.document_closed === true, 'report_invalid');
  requireFact(matchesProof(value.proof), 'report_invalid');
  const savedIdentity = snapshot ? manifest.shape : manifest.source;
  for (const identity of snapshot ? [value.shape_before, value.shape_after] : [value.source_before, value.source_after]) {
    requireFact(exactKeys(identity, ['bytes','sha256']) && identity.bytes === savedIdentity.bytes && identity.sha256 === savedIdentity.sha256, 'report_invalid');
  }
  const bounds = value.bounds_mm;
  requireFact(exactKeys(bounds, ['x_min','x_max','y_min','y_max','z_min','z_max','x_length','y_length','z_length'])
    && Object.values(bounds).every(number => typeof number === 'number' && Number.isFinite(number)), 'report_invalid');
  for (const axis of ['x','y','z']) {
    const min = bounds[axis + '_min'] as number, max = bounds[axis + '_max'] as number, length = bounds[axis + '_length'] as number;
    requireFact(length > 0 && max > min && Math.abs(max - min - length) <= Math.max(1e-9, Math.abs(length) * 1e-10), 'report_invalid');
  }
  requireFact(typeof value.volume_mm3 === 'number' && Number.isFinite(value.volume_mm3) && value.volume_mm3 > 0, 'report_invalid');
  return {bounds: {...bounds} as NativeBounds, volume: value.volume_mm3};
}

/**
 * Unregistered, single saved Part::Feature read port. No cache write or native
 * authorization is granted by serialized data. The configured fixed host barrier
 * persists launch intent, PID and actual close; callbacks persist task facts.
 * The selected executable SHA does not attest dynamic libraries or hostile OS
 * replacement. All callbacks must settle; a pending persistence callback keeps
 * this invocation/gate pending even after child close, rather than reordering it.
 */
export async function measureSingleFeature(root: string, requested: SingleFeatureManifest, inputEngine: FrozenNativeEngine,
  context: NativeMeasurementContext): Promise<SingleFeatureMeasurement> {
  return measureOwned(root, requested, inputEngine, context, 'restored_document');
}
/** Explicit saved-BRep entry. Never falls back from failed document restoration. */
export async function measureSavedBrepSnapshot(root: string, requested: SingleFeatureManifest, inputEngine: FrozenNativeEngine,
  context: NativeMeasurementContext): Promise<SavedBrepSnapshotMeasurement> {
  return measureOwned(root, requested, inputEngine, context, 'saved_brep_snapshot');
}
async function measureOwned(root: string, requested: SingleFeatureManifest, engine: FrozenNativeEngine,
  context: NativeMeasurementContext, profile: 'restored_document'): Promise<SingleFeatureMeasurement>;
async function measureOwned(root: string, requested: SingleFeatureManifest, engine: FrozenNativeEngine,
  context: NativeMeasurementContext, profile: 'saved_brep_snapshot'): Promise<SavedBrepSnapshotMeasurement>;
async function measureOwned(root: string, requested: SingleFeatureManifest, inputEngine: FrozenNativeEngine,
  context: NativeMeasurementContext, profile: NativeMeasurementProfile): Promise<SingleFeatureMeasurement | SavedBrepSnapshotMeasurement> {
  requireFact(context && typeof context.onSpawn === 'function' && typeof context.onClose === 'function', 'invalid_context');
  const {signal, onSpawn, onClose} = context;
  const task=context.taskTicket===undefined?undefined:taskExecutions.get(context.taskTicket);
  requireFact(context.taskTicket===undefined||task&&!task.used&&profile==='saved_brep_snapshot'
    &&typeof context.onVerifiedMeasurement==='function'&&typeof context.onLifecycle==='function','invalid_context');
  if(task){
    task.used=true;
    try{requireFact(fs.realpathSync(root)===task.root,'invalid_context');}
    catch{throw new NativeMeasurementError('invalid_context');}
  }
  const timeoutMs = context.timeout_ms ?? task?.ticket.step.profile.timeout_ms ?? TIMEOUT_MS;
  requireFact(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= TIMEOUT_MS, 'invalid_context');
  if(task)requireFact(timeoutMs===task.ticket.step.profile.timeout_ms,'invalid_context');
  if (signal?.aborted) throw new NativeMeasurementError('cancelled');
  let release: DrawingExecutionLease;
  try {release = acquireDrawingExecution('single-feature-native:' + randomUUID());}
  catch {throw new NativeMeasurementError('gate_busy');}
  let folder: string | undefined, actualClose = false;
  try {
    requireFact(requested?.measurement_profile === profile, 'profile_mismatch');
    const snapshot = profile === 'saved_brep_snapshot';
    const identity = snapshot ? SAVED_BREP_SNAPSHOT_IDENTITY : NATIVE_MEASUREMENT_IDENTITY;
    const engine = engineIdentity(inputEngine);
    if(task){
      const expected=task.ticket.step.profile;
      requireFact(expected.script_sha256===identity.script_sha256&&expected.algorithm_version===identity.algorithm_version
        &&expected.engine.bytes===engine.bytes&&expected.engine.sha256===engine.sha256
        &&JSON.stringify(expected.engine.app_version)===JSON.stringify(engine.app_version)&&expected.engine.occ_version===engine.occ_version,'invalid_context');
    }
    let manifest: SingleFeatureManifest;
    try {
      requireFact(requested && requested.source && requested.entity && /^[a-f0-9]{64}$/.test(requested.manifest_sha256), 'manifest_mismatch');
      const checked = await prepareSingleFeatureManifest(root, {rel: requested.source.rel, node: requested.entity.node, profile, signal});
      requireFact(checked.status === 'ready', 'manifest_not_ready'); manifest = checked.manifest;
      requireFact(manifest.measurement_profile === profile, 'profile_mismatch');
      const payload = canonicalSingleFeatureManifestPayload(requested);
      requireFact(sha(payload) === requested.manifest_sha256
        && requested.manifest_sha256 === manifest.manifest_sha256
        && payload === canonicalSingleFeatureManifestPayload(manifest), 'manifest_mismatch');
      if(task)requireFact(task.ticket.step.manifest.manifest_sha256===manifest.manifest_sha256
        &&canonicalSingleFeatureManifestPayload(task.ticket.step.manifest)===payload,'manifest_mismatch');
    } catch (error) {if (error instanceof NativeMeasurementError) throw error; throw new NativeMeasurementError(signal?.aborted ? 'cancelled' : 'manifest_mismatch');}
    const source = readBoundedFile(root, manifest.source.rel, MAX_SOURCE, signal);
    requireFact(source.bytes === manifest.source.bytes && source.sha256 === manifest.source.sha256, 'source_changed');
    let stageData = source.data;
    if (snapshot) {
      const extracted = await extractSavedShapeSnapshot(root, manifest, {signal});
      requireFact(extracted.status === 'ready', 'manifest_not_ready');
      requireFact(extracted.manifest.measurement_profile === profile && extracted.manifest.manifest_sha256 === manifest.manifest_sha256
        && canonicalSingleFeatureManifestPayload(extracted.manifest) === canonicalSingleFeatureManifestPayload(manifest), 'manifest_mismatch');
      requireFact(Buffer.isBuffer(extracted.shape) && extracted.shape.byteLength > 0 && extracted.shape.byteLength <= MAX_SHAPE
        && extracted.shape.byteLength === manifest.shape.bytes && sha(extracted.shape) === manifest.shape.sha256, 'stage_changed');
      stageData = Buffer.from(extracted.shape);
    }
    if (signal?.aborted) throw new NativeMeasurementError('cancelled');
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-native-measure-'))); fs.chmodSync(folder, 0o700);
    const environment = privateEnvironment(folder), stage = path.join(folder, snapshot ? 'shape.brp' : 'source.FCStd');
    writeExclusive(stage, stageData); fs.chmodSync(stage, 0o400);
    const stageBudget = snapshot ? MAX_SHAPE : MAX_SOURCE, stageIdentity = snapshot ? manifest.shape : source;
    const stageBefore = readLocal(stage, stageBudget, false);
    requireFact(stageBefore.bytes === stageIdentity.bytes && stageBefore.sha256 === stageIdentity.sha256, 'stage_changed');
    const nonce = task?.ticket.binding.child_nonce??randomUUID(), executionDigest = task?.ticket.execution_digest_claim??sha(JSON.stringify({manifest_sha256: manifest.manifest_sha256,
      measurement_profile: profile, ...identity, timeout_ms: timeoutMs,
      engine: {bytes: engine.bytes, sha256: engine.sha256, app_version: engine.app_version, occ_version: engine.occ_version}}));
    const baseProof = {nonce, manifest_sha256: manifest.manifest_sha256, execution_sha256: executionDigest,
      engine_sha256: engine.sha256, script_sha256: identity.script_sha256, timeout_ms: timeoutMs, measurement_profile: profile};
    writeExclusive(path.join(folder, 'job.json'), JSON.stringify({proof: baseProof, source: {bytes: source.bytes, sha256: source.sha256},
      shape: {bytes: manifest.shape.bytes, sha256: manifest.shape.sha256},
      node: manifest.entity.node, app_version: engine.app_version, occ_version: engine.occ_version}));
    writeExclusive(path.join(folder, 'read.py'), snapshot ? SNAPSHOT_PYTHON : PYTHON);
    if (signal?.aborted) throw new NativeMeasurementError('cancelled');
    const ownedFolder = folder;
    const closeProof = await new Promise<NativeCloseProof>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {child = release.spawn(engine.command, ['-u',path.join(ownedFolder,'user.cfg'),'-s',path.join(ownedFolder,'system.cfg'),path.join(ownedFolder,'read.py')],
        {cwd: ownedFolder, env: environment, stdio: ['ignore','pipe','pipe'], windowsHide: true});}
      catch {reject(new NativeMeasurementError('spawn_failed')); return;}
      let stopped: NativeMeasurementFailureCode | undefined, closed = false, ownerAcknowledged = false, ownerWritten = false;
      let proof: NativeSpawnProof | undefined, outputBytes = 0, grace: ReturnType<typeof setTimeout> | undefined;
      let persistSpawn: Promise<void> = Promise.resolve(); const termination: ('SIGTERM' | 'SIGKILL')[] = [];
      let lifecycle=Promise.resolve(),lifecycleFailed=false;
      const observe=(event:NativeLifecycleObservation)=>{
        if(!context.onLifecycle)return;
        lifecycle=lifecycle.then(async()=>{await persistSpawn;await context.onLifecycle!(Object.freeze(event));})
          .catch(()=>{lifecycleFailed=true;if(!closed)stop('lifecycle_receipt_failed');});
      };
      const requestKill=(killSignal:'SIGTERM'|'SIGKILL')=>{
        termination.push(killSignal);let result:'returned_true'|'returned_false'|'threw';
        try{result=child.kill(killSignal)?'returned_true':'returned_false';}catch{result='threw';}
        observe({type:'kill_result',signal:killSignal,result});
      };
      const stop = (code: NativeMeasurementFailureCode) => {
        if (closed || stopped) return; stopped = code;
        if(code==='cancelled')observe({type:'cancel_requested'});
        if(code==='timeout')observe({type:'timeout'});
        grace = setTimeout(() => {if(!closed)requestKill('SIGKILL');}, GRACE_MS);
        grace.unref();requestKill('SIGTERM');
      };
      const aborted = () => stop('cancelled');
      const output = (chunk: Uint8Array) => {outputBytes = Math.min(MAX_OUTPUT + 1, outputBytes + chunk.byteLength); if (outputBytes > MAX_OUTPUT) stop('output_limit');};
      const timer = setTimeout(() => stop('timeout'), timeoutMs); timer.unref();
      child.stdout?.on('data', output); child.stderr?.on('data', output);
      child.once('error', () => stop('spawn_failed'));
      child.once('spawn', () => {
        if (!Number.isSafeInteger(child.pid) || Number(child.pid) <= 0) {stop('spawn_failed'); return;}
        proof = Object.freeze({owned_pid: child.pid!, ...baseProof});
        persistSpawn = (async () => {
          try {release.assertHealthy();await onSpawn(proof!);release.assertHealthy(); ownerAcknowledged = true;}
          catch {if (closed) stopped ??= 'spawn_receipt_failed'; else stop('spawn_receipt_failed'); return;}
          if (closed || stopped || signal?.aborted) return;
          try {publishOwnerMarker(ownedFolder, proof!); ownerWritten = true;}
          catch {stop('owner_marker_failed');}
        })();
      });
      child.once('close', (code: number | null, exitSignal: NodeJS.Signals | null) => {
        // A failed OS spawn can emit close for its pipes without an owned PID.
        // Do not turn that into a native-process/host-barrier close receipt.
        closed = true; actualClose = proof !== undefined; clearTimeout(timer); if (grace) clearTimeout(grace);
        signal?.removeEventListener('abort', aborted); child.stdout?.removeListener('data', output); child.stderr?.removeListener('data', output);
        void (async () => {
          await persistSpawn;
          let pending:Promise<void>;do{pending=lifecycle;await pending;}while(pending!==lifecycle);
          const receipt = proof ? Object.freeze({...proof, actual_close_observed: true as const, exit_code: code, signal: exitSignal ?? null,
            owner_acknowledged: ownerAcknowledged, owner_marker_written: ownerWritten, output_bytes: outputBytes,
            termination_requests: Object.freeze([...termination])}) : undefined;
          if (receipt) {
            try {await onClose(receipt);} catch {reject(new NativeMeasurementError('close_receipt_failed', true)); return;}
          }
          if (stopped || lifecycleFailed || signal?.aborted || code !== 0 || exitSignal || !receipt || !ownerWritten) {
            reject(new NativeMeasurementError(lifecycleFailed?'lifecycle_receipt_failed':stopped ?? (signal?.aborted ? 'cancelled' : 'native_failed'), true)); return;
          }
          resolve(receipt);
        })().catch(() => reject(new NativeMeasurementError('close_receipt_failed', true)));
      });
      signal?.addEventListener('abort', aborted, {once: true}); if (signal?.aborted) aborted();
    });
    if (signal?.aborted) throw new NativeMeasurementError('cancelled', true);
    let report: unknown;
    try {
      const raw = readLocal(path.join(folder, 'report.json'), MAX_REPORT).data;
      requireFact(!raw.includes(0), 'report_invalid'); report = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw));
    } catch {throw new NativeMeasurementError('report_invalid', true);}
    const measurement = wireReport(report, closeProof, manifest, engine, profile);
    const after = readBoundedFile(root, manifest.source.rel, MAX_SOURCE, signal), stageAfter = readLocal(stage, stageBudget, false);
    requireFact(after.bytes === source.bytes && after.sha256 === source.sha256, 'source_changed');
    requireFact(stageAfter.bytes === stageIdentity.bytes && stageAfter.sha256 === stageIdentity.sha256, 'stage_changed');
    engineIdentity(engine);
    if (signal?.aborted) throw new NativeMeasurementError('cancelled', true);
    const common = {schema_version: 1 as const, status: 'measured' as const,
      manifest_sha256: manifest.manifest_sha256, source: {...manifest.source},
      shape: {basis: 'serialized_shape_snapshot' as const, member_path: manifest.shape.member_path, bytes: manifest.shape.bytes, sha256: manifest.shape.sha256},
      bounds_mm: measurement.bounds, volume_mm3: measurement.volume,
      native_shape_type: 'Solid' as const, valid: true as const, closed: true as const, solid_count: 1 as const, private_paths_checked: true as const,
      app_version: [...engine.app_version] as [string,string,string], occ_version: engine.occ_version,
      engine: {bytes: engine.bytes, sha256: engine.sha256}, process_proof: closeProof};
    if (snapshot) {
      const result:SavedBrepSnapshotMeasurement={...common, ...SAVED_BREP_SNAPSHOT_IDENTITY,
      measurement_mode: 'saved_brep_snapshot_no_document', coordinate_system: 'serialized_saved_shape_xyz',
      saved_entity: {node: manifest.entity.node, type_id: 'Part::Feature'}, loaded_document_count: 0, document_opened: false,
      restored_document_verified: false, parameter_freshness: 'not_attested', document_frame: 'not_attested',
      byte_preservation: {source_before: source.sha256, source_after: after.sha256, staged_shape_before: stageBefore.sha256, staged_shape_after: stageAfter.sha256}};
      try{await context.onVerifiedMeasurement?.(result);}catch{throw new NativeMeasurementError('result_receipt_failed',true);}
      return result;
    }
    return {...common, ...NATIVE_MEASUREMENT_IDENTITY,
      measurement_mode: 'restored_document_no_save', coordinate_system: 'staged_document_xyz',
      entity: {node: manifest.entity.node, type_id: 'Part::Feature'}, placement_identity: true, placement_unchanged: true,
      loaded_document_count: 1, entity_count: 1, document_closed: true,
      byte_preservation: {source_before: source.sha256, source_after: after.sha256, stage_before: stageBefore.sha256, stage_after: stageAfter.sha256}};
  } catch (error) {
    const diagnostic = error instanceof NativeMeasurementError && error.native_failure_stage && error.native_failure_code
      ? {native_failure_stage: error.native_failure_stage, native_failure_code: error.native_failure_code,
        ...(error.native_shape_type ? {native_shape_type: error.native_shape_type} : {})} : undefined;
    throw new NativeMeasurementError(error instanceof NativeMeasurementError ? error.code : signal?.aborted ? 'cancelled' : 'setup_failed', actualClose, diagnostic);
  } finally {
    try {if (folder) fs.rmSync(folder, {recursive: true, force: true});}
    catch {throw new NativeMeasurementError('cleanup_failed', actualClose);}
    finally {try{release();}catch{throw new NativeMeasurementError('host_barrier_uncertain',actualClose);}} // Actual close AND ordered host callbacks precede release.
  }
}
