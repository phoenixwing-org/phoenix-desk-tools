/** Manual production-orchestration proof on self-created public geometry ONLY.
 * node --import tsx scripts/verify-assembly-update-workflow.ts --allow-native
 * No CAD input, executable override, workspace, gate scope or fake occupancy is accepted.
 * Private artifacts remain outside the repository; no existing GUI is closed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSyntheticAssemblyRefreshFixture } from './verify-assembly-refresh.js';
import { createAssemblyNativePreview } from '../src/features/assembly-maintenance/native-preview.js';
import { createAssemblyUpdateService } from '../src/features/assembly-maintenance/updates.js';
import { inspectFreecadProcessOccupancy } from '../src/features/assembly-maintenance/process-occupancy.js';
import { refreshAssemblyDerivedData } from '../src/features/assembly-maintenance/runtime.js';
import { openGalleryDb, saveRow, tableExists } from '../src/features/part-gallery/storage.js';
import { createGeometryTable, saveGeometry } from '../src/features/part-gallery/geometryStorage.js';
import type { VerifiedPublication } from '../src/features/assembly-maintenance/publication.js';
import type { AssemblyUpdateJob } from '../../shared/assembly-maintenance.js';

const ENGINE = '/Applications/FreeCAD.app';
const SELECTED = ['RigidInstance', 'FlexibleInstance'];
const CAD_FILES = ['Host.FCStd', 'Middle.FCStd', 'Leaf.FCStd'] as const;
const CODE_FILES = [
  'server/scripts/verify-assembly-update-workflow.ts', 'server/scripts/verify-assembly-refresh.ts',
  'server/src/features/assembly-maintenance/updates.ts', 'server/src/features/assembly-maintenance/baseline.ts',
  'server/src/features/assembly-maintenance/native-preview.ts', 'server/src/features/assembly-maintenance/native-archive.ts',
  'server/src/features/assembly-maintenance/native-runner.ts', 'server/src/features/assembly-maintenance/native-preservation.ts',
  'server/src/features/assembly-maintenance/publication.ts', 'server/src/features/assembly-maintenance/process-occupancy.ts',
  'server/src/features/assembly-maintenance/runtime.ts', 'server/src/features/assembly-maintenance/routes.ts',
  'server/src/features/part-gallery/storage.ts', 'server/src/features/part-gallery/geometryStorage.ts',
  'server/src/lib/pnwBomXrefService.ts', 'server/src/lib/pnwBomXrefIndexEngine.ts',
  'server/src/features/drawing-research/executionGate.ts', 'server/src/features/cad-native-measurement/host-barrier.ts',
] as const;
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function requireCheck(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error('Synthetic workflow safety check failed'), { code });
}
function boundedBytes(filename: string, maximum = 64 * 1024 * 1024) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    requireCheck(before.isFile() && before.nlink === 1 && before.size <= maximum, 'unsafe_proof_file');
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length); if (!count) break; length += count;
    }
    const same = (other: fs.Stats) => before.dev === other.dev && before.ino === other.ino && before.size === other.size
      && before.mtimeMs === other.mtimeMs && before.ctimeMs === other.ctimeMs && before.nlink === other.nlink;
    requireCheck(length === before.size && same(fs.fstatSync(fd)) && same(fs.lstatSync(filename)), 'proof_file_changed');
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
function codeDigests() {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  return Object.fromEntries(CODE_FILES.map(rel => [rel, digest(boundedBytes(path.join(repository, rel), 1024 * 1024))]));
}
function sourceDigests(root: string) {
  return Object.fromEntries(CAD_FILES.map(rel => [rel, digest(boundedBytes(path.join(root, rel)))])) as Record<typeof CAD_FILES[number], string>;
}
function dependenciesUnchanged(before: ReturnType<typeof sourceDigests>, after: ReturnType<typeof sourceDigests>) {
  return before['Middle.FCStd'] === after['Middle.FCStd'] && before['Leaf.FCStd'] === after['Leaf.FCStd'];
}
function durableReceipt(directory: string, value: unknown, name: 'workflow-receipt.json' | 'workflow-complete-receipt.json' = 'workflow-receipt.json') {
  const file = path.join(directory, name);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
async function fixture() {
  const seeded = await createSyntheticAssemblyRefreshFixture(), directory = seeded.directory;
  const temp = fs.realpathSync(os.tmpdir()), stat = fs.lstatSync(directory), rel = path.relative(temp, directory);
  requireCheck(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(directory) === directory && (stat.mode & 0o077) === 0
    && rel && !rel.startsWith('..') && !path.isAbsolute(rel) && path.basename(directory).startsWith('desk-assembly-proof-'), 'unsafe_synthetic_workspace');
  requireCheck(seeded.receipt.state === 'seeded' && seeded.receipt.fixture_directory === directory && seeded.proof.actual_close_observed
    && seeded.proof.exit_code === 0 && seeded.proof.signal === null, 'synthetic_fixture_not_verified');
  return { directory, seedProof: seeded.proof };
}
function productionService(observeNativeStart?: () => void) {
  const native = createAssemblyNativePreview(ENGINE), proofs: Array<VerifiedPublication['nativeProof']> = [];
  const service = createAssemblyUpdateService({ refresh: refreshAssemblyDerivedData, native: async input => {
    observeNativeStart?.();
    const result = await native(input); proofs.push(result.nativeProof); return result;
  } });
  return { service, proofs };
}
function noDatabaseRefreshObserved(directory: string, job: AssemblyUpdateJob) {
  return job.warnings.some(message => message.includes('当前索引未包含该文件'))
    && !job.warnings.some(message => message.includes('图册派生缓存未能标记过期'))
    && !fs.existsSync(path.join(directory, '.phoenix', 'phoenix-workspace.sqlite'));
}
async function verifyRealDerivedCacheRefresh(directory: string, target: string) {
  const db = openGalleryDb(directory, true);
  requireCheck(db, 'synthetic_gallery_database_unavailable');
  const rows = [target, 'Unrelated.FCStd'];
  try {
    createGeometryTable(db);
    for (const rel of rows) {
      saveRow(db, { rel, part_number: 'synthetic-cache', part_version: '', part_name: 'Independent derived cache row',
        type_code: '', role: 'assembly', status: 'ready', width: 1, height: 1, image_hash: digest('synthetic-pixel'),
        source_stamp: 'independent-proof-stamp', source_hash: digest('independent-proof-source'), updated_at: new Date().toISOString(), message: '', refs: [] });
      saveGeometry(db, { rel, sources: [{ rel, stamp: 'independent-proof-stamp', hash: digest('independent-proof-source') }],
        kind: 'assembly', box: { x_mm: 23, y_mm: 11, z_mm: 7 }, message: 'independent cached assembly envelope' });
      requireCheck(db.get<{ algorithm_version: number }>('SELECT algorithm_version FROM desk_cad_geometry WHERE rel=?', [rel])?.algorithm_version === 2,
        'synthetic_assembly_geometry_profile_not_seeded');
    }
  } finally { db.close(); }
  const messages = await refreshAssemblyDerivedData(directory, target), observed = openGalleryDb(directory);
  requireCheck(observed, 'synthetic_gallery_database_lost');
  try {
    return messages.some(message => message.includes('当前索引未包含该文件'))
      && !messages.some(message => message.includes('图册派生缓存未能标记过期'))
      && observed.get<{ status: string }>('SELECT status FROM desk_cad_thumbnail WHERE rel=?', [target])?.status === 'stale'
      && !observed.get('SELECT rel FROM desk_cad_geometry WHERE rel=?', [target])
      && observed.get<{ status: string }>('SELECT status FROM desk_cad_thumbnail WHERE rel=?', ['Unrelated.FCStd'])?.status === 'ready'
      && observed.get<{ algorithm_version: number }>('SELECT algorithm_version FROM desk_cad_geometry WHERE rel=?', ['Unrelated.FCStd'])?.algorithm_version === 2
      && !tableExists(observed, 'phoenix_cad_file_asset') && !tableExists(observed, 'phoenix_cad_scan');
  } finally { observed.close(); }
}
function requireReady(job: AssemblyUpdateJob, directory: string, scenario: string, proofs: unknown, code: string) {
  if (job.status === 'ready' && job.can_publish) return;
  durableReceipt(directory, { scenario, state: 'blocked', job, nativeProofs: proofs });
  requireCheck(false, code);
}

/** Runs only independently generated seed-only fixtures. Returning blocked never
 * permits bypassing a barrier, unknown process snapshot, or Native invariant. */
export async function verifyAssemblyUpdateWorkflow() {
  const sources = codeDigests(), artifacts: string[] = [], checks: Record<string, boolean> = {};
  try {

  const copy = await fixture(); artifacts.push(path.basename(copy.directory));
  const copied = productionService(), copyBefore = sourceDigests(copy.directory);
  const copyStart = copied.service.start(copy.directory, 'Host.FCStd', SELECTED), copyReady = await copied.service.wait(copy.directory, copyStart.id);
  requireReady(copyReady, copy.directory, 'verified_copy', copied.proofs, 'synthetic_copy_preview_not_ready');
  const copyResult = await copied.service.publish(copy.directory, copyStart.id, 'verified_copy', { closed: false, notReopened: false });
  requireCheck(copyResult.status === 'published' && !!copyResult.output_rel, 'synthetic_copy_not_published');
  const copyAfter = sourceDigests(copy.directory), copyReconcile = copied.service.reconcile(copy.directory, copyStart.id);
  checks.copy_source_and_dependencies_unchanged = JSON.stringify(copyBefore) === JSON.stringify(copyAfter);
  checks.copy_output_is_distinct = copyResult.output_rel !== 'Host.FCStd'
    && digest(boundedBytes(path.join(copy.directory, copyResult.output_rel))) !== copyBefore['Host.FCStd'];
  checks.copy_reconciled_read_only = copyReconcile.read_only && !copyReconcile.can_publish && copyReconcile.observed_publication === 'published_observed';
  checks.copy_real_refresh_reported_missing_index_without_creating_database = noDatabaseRefreshObserved(copy.directory, copyResult);
  const replay = await copied.service.publish(copy.directory, copyStart.id, 'verified_copy', { closed: false, notReopened: false });
  checks.copy_not_replayed = replay.output_rel === copyResult.output_rel && replay.status === 'published';
  const restarted = productionService();
  checks.restart_only_observes = restarted.service.reconcile(copy.directory, copyStart.id).observed_publication === 'published_observed'
    && restarted.service.history(copy.directory).records.every(row => row.read_only && !row.can_publish);
  let restartRefused = false;
  try { await restarted.service.publish(copy.directory, copyStart.id, 'verified_copy', { closed: false, notReopened: false }); }
  catch { restartRefused = true; }
  checks.restart_write_authority_not_restored = restartRefused;
  checks.real_cache_refresh_scoped_without_fabricated_index = await verifyRealDerivedCacheRefresh(copy.directory, copyResult.output_rel);
  checks.real_cache_refresh_never_rewrites_cad = JSON.stringify(copyBefore) === JSON.stringify(sourceDigests(copy.directory));
  durableReceipt(copy.directory, { scenario: 'verified_copy', before: copyBefore, after: copyAfter, job: copyResult,
    reconcile: copyReconcile, seedProof: copy.seedProof, nativeProofs: copied.proofs, checks });
  requireCheck(Object.values(checks).every(Boolean), 'copy_or_restart_check_failed');

  const changed = await fixture(); artifacts.push(path.basename(changed.directory));
  const changedService = productionService(), changedBefore = sourceDigests(changed.directory);
  const changedStart = changedService.service.start(changed.directory, 'Host.FCStd', SELECTED), changedReady = await changedService.service.wait(changed.directory, changedStart.id);
  requireReady(changedReady, changed.directory, 'changed_dependency', changedService.proofs, 'synthetic_changed_dependency_preview_not_ready');
  fs.appendFileSync(path.join(changed.directory, 'Leaf.FCStd'), Buffer.from('independent workflow concurrent dependency write'));
  let dependencyRejected = false;
  try { await changedService.service.publish(changed.directory, changedStart.id, 'verified_copy', { closed: false, notReopened: false }); }
  catch { dependencyRejected = true; }
  const changedAfter = sourceDigests(changed.directory), changedResult = changedService.service.get(changed.directory, changedStart.id);
  checks.concurrent_dependency_rejected = dependencyRejected && !changedResult.can_publish && changedResult.status === 'blocked';
  checks.concurrent_dependency_host_not_published = changedAfter['Host.FCStd'] === changedBefore['Host.FCStd']
    && changedAfter['Middle.FCStd'] === changedBefore['Middle.FCStd'] && !fs.existsSync(path.join(changed.directory, changedReady.suggested_copy_rel!));
  durableReceipt(changed.directory, { scenario: 'changed_dependency', before: changedBefore, after: changedAfter, job: changedResult,
    seedProof: changed.seedProof, nativeProofs: changedService.proofs, checks });
  requireCheck(checks.concurrent_dependency_rejected && checks.concurrent_dependency_host_not_published, 'changed_dependency_check_failed');

  const cancelled = await fixture(); artifacts.push(path.basename(cancelled.directory));
  const cancelBefore = sourceDigests(cancelled.directory); let entered!: () => void;
  const nativeStarted = new Promise<void>(resolve => { entered = resolve; });
  const cancelService = productionService(entered), cancelStart = cancelService.service.start(cancelled.directory, 'Host.FCStd', SELECTED);
  // Bounded wait also detects a preflight failure without leaving an unhandled
  // Native job. The real owned runner, not a fake Native port, receives abort.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([nativeStarted, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'cancel_native_start_timeout' })), 30_000); })]); }
  catch (error) { cancelService.service.cancel(cancelled.directory, cancelStart.id); await cancelService.service.wait(cancelled.directory, cancelStart.id); throw error; }
  finally { if (timer) clearTimeout(timer); }
  cancelService.service.cancel(cancelled.directory, cancelStart.id);
  const cancelResult = await cancelService.service.wait(cancelled.directory, cancelStart.id), cancelAfter = sourceDigests(cancelled.directory);
  checks.cancel_preview_no_publication = cancelResult.status === 'cancelled' && !cancelResult.can_publish && JSON.stringify(cancelBefore) === JSON.stringify(cancelAfter);
  durableReceipt(cancelled.directory, { scenario: 'cancel_owned_preview', before: cancelBefore, after: cancelAfter, job: cancelResult,
    seedProof: cancelled.seedProof, nativeProofs: cancelService.proofs, checks });
  requireCheck(checks.cancel_preview_no_publication, 'cancellation_check_failed');

  // A new real seed run also demonstrates that the prior cancellation released
  // the fixed host barrier only after its owned process actually closed.
  const replace = await fixture(); artifacts.push(path.basename(replace.directory));
  const replacement = productionService(), replaceBefore = sourceDigests(replace.directory);
  const replaceStart = replacement.service.start(replace.directory, 'Host.FCStd', SELECTED), replaceReady = await replacement.service.wait(replace.directory, replaceStart.id);
  requireReady(replaceReady, replace.directory, 'replace_source_or_real_occupancy_block', replacement.proofs, 'synthetic_replace_preview_not_ready');
  const occupancy = inspectFreecadProcessOccupancy();
  const replaceResult = await replacement.service.publish(replace.directory, replaceStart.id, 'replace_source', { closed: true, notReopened: true });
  const replaceAfter = sourceDigests(replace.directory), replaceReconcile = replacement.service.reconcile(replace.directory, replaceStart.id);
  const replacementObserved = replaceResult.status === 'published';
  checks.replace_dependencies_unchanged = dependenciesUnchanged(replaceBefore, replaceAfter);
  checks.replace_never_bypassed_occupancy = replacementObserved ? occupancy.state === 'clear'
    && replaceAfter['Host.FCStd'] !== replaceBefore['Host.FCStd'] && replaceReconcile.observed_publication === 'published_observed'
    : replaceAfter['Host.FCStd'] === replaceBefore['Host.FCStd'] && !replaceResult.can_publish;
  checks.replace_refresh_matches_actual_publication = replacementObserved ? noDatabaseRefreshObserved(replace.directory, replaceResult)
    : !replaceResult.warnings.some(message => message.includes('当前索引未包含该文件'))
      && !fs.existsSync(path.join(replace.directory, '.phoenix', 'phoenix-workspace.sqlite'));
  durableReceipt(replace.directory, { scenario: 'replace_source_or_real_occupancy_block', before: replaceBefore, after: replaceAfter,
    occupancy, job: replaceResult, reconcile: replaceReconcile, seedProof: replace.seedProof, nativeProofs: replacement.proofs, checks });
  requireCheck(checks.replace_dependencies_unchanged && checks.replace_never_bypassed_occupancy && checks.replace_refresh_matches_actual_publication, 'replace_safety_check_failed');
  checks.production_sources_unchanged = JSON.stringify(sources) === JSON.stringify(codeDigests());
  requireCheck(checks.production_sources_unchanged, 'production_sources_changed_during_proof');
  durableReceipt(copy.directory, { state: 'passed', sources, checks, artifacts, replacement: replacementObserved ? 'published' : 'safely_blocked',
    replacement_reason: replaceResult.error?.code ?? null, real_occupancy: occupancy.state }, 'workflow-complete-receipt.json');
  return { state: 'passed', checks, replacement: replacementObserved ? 'published' : 'safely_blocked',
    replacement_reason: replaceResult.error?.code ?? null, real_occupancy: occupancy.state, artifacts };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('Workflow outcome not verified'), { artifacts });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--allow-native') {
    console.error('Explicit --allow-native is required; only self-created synthetic fixtures are accepted.'); process.exitCode = 2;
  } else verifyAssemblyUpdateWorkflow().then(result => { console.log(JSON.stringify(result)); }).catch(error => {
    const code = typeof error?.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : 'workflow_unverified';
    const artifacts = Array.isArray(error?.artifacts) ? error.artifacts.filter((name: unknown) => typeof name === 'string'
      && /^desk-assembly-proof-[A-Za-z0-9-]+$/.test(name)).slice(0, 10) : [];
    console.error(JSON.stringify({ state: 'blocked', code, artifacts })); process.exitCode = 1;
  });
}
