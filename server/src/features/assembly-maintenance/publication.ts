import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectFreecadProcessOccupancy, type FreecadProcessOccupancy } from './process-occupancy.js';

export interface PublicationNativeCloseProof {
  nonce: string; pid: number | null; actual_close_observed: boolean;
  exit_code: number | null; signal: string | null;
}
/** Host-internal authority, assembled ONLY after both independently owned Native
 * stages and a user-reviewed frozen plan. Never deserialize this DTO from HTTP. */
export interface VerifiedPublication {
  root: string;
  sourceRel: string;
  stagedFile: string;
  sourceSha256: string;
  stagedSha256: string;
  jobDirectory: string;
  /** Complete frozen dependency closure, excluding sourceRel (separately hashed). */
  dependencyFingerprints: Array<{ rel: string; sha256: string }>;
  planDigest: string;
  mode: 'verified_copy' | 'replace_source';
  targetRel: string;
  nativeProof: { update: PublicationNativeCloseProof; reopen: PublicationNativeCloseProof };
  confirmedClosed?: boolean;
  confirmedNotReopened?: boolean;
}
export interface PublicationReceipt {
  version: 1;
  status: 'published' | 'blocked' | 'rolled_back' | 'unknown';
  code: string;
  mode: VerifiedPublication['mode'];
  sourceRel: string;
  targetRel: string;
  /** True if this attempt ever removed/replaced the source, even after rollback;
   * null if the syscall result and actual disk state cannot be reconciled. */
  sourceWritten: boolean | null;
  /** True if this attempt ever installed the target, even after rollback;
   * null is an unknown write outcome, NEVER a no-write certificate. */
  targetWritten: boolean | null;
  sourceState: 'original' | 'updated' | 'missing' | 'changed' | 'unknown';
  receiptDurable: boolean;
  requiresManualReview: boolean;
  evidenceDirectory: string;
}
export type PublicationCheckpoint = 'before_backup' | 'after_backup' | 'before_intent' | 'after_intent'
  | 'before_claim' | 'after_claim' | 'before_source_claimed_receipt' | 'before_publish'
  | 'after_link' | 'after_publish' | 'before_published_receipt' | 'after_published_receipt'
  | 'before_rollback' | 'before_failure_receipt';
/** Host-only, synchronous test seams; never available as action/HTTP arguments. */
export interface PublicationOptions {
  occupancy?: () => FreecadProcessOccupancy;
  checkpoint?: (point: PublicationCheckpoint) => void;
}
class PublicationFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new PublicationFailure(code); };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const MAX_FILE_BYTES = 64 * 1024 * 1024;
function within(root: string, filename: string) {
  const rel = path.relative(root, filename);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function relativePath(value: string) {
  if (typeof value !== 'string' || !value || /[\x00-\x1f\\:]/.test(value) || path.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..') || !/\.fcstd$/i.test(value)) fail('unsafe_relative_path');
  return value;
}
/** Re-walk every ancestor on every use, including the root spelling. */
function guardAbsolute(filename: string, directory: boolean, missingLeaf = false): string {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || path.resolve(filename) !== filename || /[\x00-\x1f]/.test(filename)) fail('unsafe_path');
  const parsed = path.parse(filename);
  let cursor = parsed.root;
  const parts = filename.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(cursor); }
    catch (error) {
      if (missingLeaf && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return filename;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) fail('unsafe_path');
    if (i === parts.length - 1 && (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) fail('unsafe_file_identity');
  }
  return filename;
}
function location(root: string, rel: string, missing = false) {
  guardAbsolute(root, true);
  const filename = path.resolve(root, relativePath(rel));
  if (!within(root, filename)) fail('path_escape');
  return guardAbsolute(filename, false, missing);
}
const same = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
function readStable(filename: string, allowOwnLink = false) {
  guardAbsolute(path.dirname(filename), true);
  const prior = fs.lstatSync(filename);
  if (!prior.isFile() || prior.isSymbolicLink() || (!allowOwnLink && prior.nlink !== 1)) fail('unsafe_file_identity');
  if (prior.size > MAX_FILE_BYTES) fail('resource_limit');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (!same(prior, opened)) fail('file_changed');
    const bytes = fs.readFileSync(fd);
    if (!same(opened, fs.fstatSync(fd)) || !same(opened, fs.lstatSync(filename))) fail('file_changed');
    return { bytes, sha256: digest(bytes), stat: opened };
  } finally { fs.closeSync(fd); }
}
function syncDirectory(directory: string) {
  guardAbsolute(directory, true);
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function durableFile(filename: string, bytes: Buffer | string) {
  guardAbsolute(path.dirname(filename), true);
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(filename));
}
function requireNative(proof: VerifiedPublication['nativeProof']) {
  const valid = (item: PublicationNativeCloseProof | undefined) => item && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(item.nonce)
    && Number.isSafeInteger(item.pid) && item.pid! > 0 && item.actual_close_observed === true && item.exit_code === 0 && item.signal === null;
  if (!valid(proof?.update) || !valid(proof?.reopen) || proof.update.nonce === proof.reopen.nonce || proof.update.pid === proof.reopen.pid) fail('native_close_proof_missing');
}

/** Synchronous critical section: no await, no native launch, no broad/recursive
 * changes. The ps observations and explicit user promise are bounded local
 * safeguards, not a universal OS lock. A retained attempt is NEVER replayed. */
export function publishVerifiedAssembly(input: VerifiedPublication, options: PublicationOptions = {}): PublicationReceipt {
  let sourceWritten: boolean | null = false, targetWritten: boolean | null = false;
  let claimed = false, installed = false, mutationOutcomeUnknown = false;
  let evidenceDirectory = '', stageCopy = '', claim = '', target = '', source = '';
  let ownTarget: fs.Stats | undefined;
  let evidenceCreated = false, intentWritten = false, publishedReceiptWritten = false;
  const observations: FreecadProcessOccupancy[] = [];
  const checkpoint = (point: PublicationCheckpoint) => { options.checkpoint?.(point); };
  const occupancy = () => {
    const observed = (options.occupancy ?? inspectFreecadProcessOccupancy)();
    observations.push(observed);
    if (!observed || observed.state !== 'clear' || observed.platform !== 'darwin'
      || observed.scope !== 'current_macos_host_process_snapshot' || !Number.isFinite(Date.parse(observed.checkedAt))
      || Math.abs(Date.now() - Date.parse(observed.checkedAt)) > 10_000) fail(observed?.state === 'busy' ? 'freecad_busy' : 'freecad_occupancy_unknown');
  };
  const sourceState = (): PublicationReceipt['sourceState'] => {
    try {
      const file = location(input.root, input.sourceRel), hash = readStable(file).sha256;
      return hash === input.sourceSha256 ? 'original' : hash === input.stagedSha256 ? 'updated' : 'changed';
    } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown'; }
  };
  const receipt = (status: PublicationReceipt['status'], code: string, receiptDurable: boolean): PublicationReceipt => ({
    version: 1, status, code, mode: input.mode, sourceRel: input.sourceRel, targetRel: input.targetRel,
    sourceWritten, targetWritten, sourceState: sourceState(), receiptDurable,
    requiresManualReview: status === 'unknown', evidenceDirectory,
  });
  const record = (name: string, detail: Record<string, unknown>) => {
    guardAbsolute(input.jobDirectory, true); guardAbsolute(evidenceDirectory, true);
    durableFile(path.join(evidenceDirectory, name + '.json'), JSON.stringify({ version: 1, at: new Date().toISOString(),
      planDigest: input.planDigest, sourceRel: input.sourceRel, targetRel: input.targetRel,
      sourceSha256: input.sourceSha256, stagedSha256: input.stagedSha256, mode: input.mode,
      dependencyFingerprints: input.dependencyFingerprints, nativeProof: input.nativeProof, observations, ...detail }));
  };
  const fingerprints = (sourceExpected: 'original' | 'claimed' | 'published') => {
    guardAbsolute(input.root, true); guardAbsolute(input.jobDirectory, true);
    const sourceFile = sourceExpected === 'claimed' ? guardAbsolute(claim, false) : location(input.root, input.sourceRel);
    const expected = sourceExpected === 'published' ? input.stagedSha256 : input.sourceSha256;
    if (readStable(sourceFile).sha256 !== expected) fail('source_changed');
    let total = 0;
    for (const item of input.dependencyFingerprints) {
      const dependency = readStable(location(input.root, item.rel));
      total += dependency.bytes.length;
      if (total > MAX_FILE_BYTES) fail('resource_limit');
      if (dependency.sha256 !== item.sha256) fail('dependency_changed');
    }
    const stage = readStable(guardAbsolute(input.stagedFile, false));
    if (stage.sha256 !== input.stagedSha256) fail('stage_changed');
    guardAbsolute(path.dirname(target), true);
  };
  try {
    if (!input || !sha(input.sourceSha256) || !sha(input.stagedSha256) || !sha(input.planDigest)
      || !['verified_copy', 'replace_source'].includes(input.mode) || !Array.isArray(input.dependencyFingerprints)
      || input.dependencyFingerprints.length > 99) fail('invalid_verified_publication');
    guardAbsolute(input.root, true);
    source = path.resolve(input.root, relativePath(input.sourceRel));
    relativePath(input.targetRel);
    if (path.posix.dirname(input.sourceRel) !== path.posix.dirname(input.targetRel)
      || (input.mode === 'replace_source' ? input.targetRel !== input.sourceRel : input.targetRel === input.sourceRel)) fail('invalid_publication_target');
    target = path.resolve(input.root, input.targetRel);
    const seen = new Set([input.sourceRel]);
    for (const item of input.dependencyFingerprints) {
      relativePath(item.rel);
      if (!sha(item.sha256) || seen.has(item.rel) || item.rel === input.targetRel) fail('invalid_dependency_fingerprints');
      seen.add(item.rel);
    }
    requireNative(input.nativeProof);
    guardAbsolute(input.stagedFile, false);
    if (input.stagedFile === source || input.stagedFile === target) fail('invalid_stage');
    guardAbsolute(input.jobDirectory, true);
    const jobsRoot = path.join(input.root, '.phoenix', 'assembly-maintenance');
    if (!within(jobsRoot, input.jobDirectory) || input.jobDirectory === jobsRoot) fail('unsafe_job_directory');
    evidenceDirectory = path.join(input.jobDirectory, 'publication');
    // Check the one-shot marker before stale source hashes: a retry after a
    // lost response must be reconciled, not reported as a fresh no-write job.
    if (fs.existsSync(evidenceDirectory)) return receipt('unknown', 'publication_already_started', false);
    source = location(input.root, input.sourceRel);
    if (input.mode === 'replace_source') {
      if (input.confirmedClosed !== true || input.confirmedNotReopened !== true) fail('closed_confirmation_required');
      occupancy();
    } else location(input.root, input.targetRel, true);
    fingerprints('original');
    try { fs.mkdirSync(evidenceDirectory, { mode: 0o700 }); evidenceCreated = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return receipt('unknown', 'publication_already_started', false);
      throw error;
    }
    syncDirectory(input.jobDirectory);
    checkpoint('before_backup');
    fingerprints('original');
    const original = readStable(source);
    if (original.sha256 !== input.sourceSha256) fail('source_changed');
    durableFile(path.join(evidenceDirectory, 'before.FCStd'), original.bytes);
    if (readStable(path.join(evidenceDirectory, 'before.FCStd')).sha256 !== input.sourceSha256) fail('backup_verification_failed');
    stageCopy = path.join(path.dirname(target), '.phoenix-assembly-' + randomUUID() + '.stage');
    durableFile(stageCopy, readStable(input.stagedFile).bytes);
    if (readStable(stageCopy).sha256 !== input.stagedSha256) fail('stage_changed');
    checkpoint('after_backup');
    fingerprints('original');
    checkpoint('before_intent');
    record('publish_intent', { stage: 'publish_intent' }); intentWritten = true;
    checkpoint('after_intent');
    if (input.mode === 'replace_source') {
      occupancy();
      checkpoint('before_claim');
      fingerprints('original');
      claim = path.join(evidenceDirectory, 'source-claimed.FCStd');
      // Unique job evidence directory plus prior lstat means rename never
      // intentionally overwrites evidence. It moves the ACTUAL current bytes.
      if (fs.existsSync(claim)) fail('claim_already_exists');
      const beforeClaim = fs.lstatSync(source);
      try { fs.renameSync(source, claim); claimed = true; sourceWritten = true; }
      catch (error) {
        // A syscall/wrapper may lose its result after the move. Reconcile the
        // ACTUAL filesystem before ever reporting a "no source write" failure.
        try {
          const moved = fs.lstatSync(claim);
          if (moved) { claimed = true; sourceWritten = true; }
        } catch (inspectionError) {
          if ((inspectionError as NodeJS.ErrnoException).code !== 'ENOENT') { sourceWritten = null; mutationOutcomeUnknown = true; }
          else {
            try {
              const current = fs.lstatSync(source);
              if (current.ino !== beforeClaim.ino || current.dev !== beforeClaim.dev) { sourceWritten = null; mutationOutcomeUnknown = true; }
            } catch { sourceWritten = null; mutationOutcomeUnknown = true; }
          }
        }
        throw error;
      }
      syncDirectory(path.dirname(source)); syncDirectory(evidenceDirectory);
      checkpoint('after_claim');
      // CAS is on the moved inode/bytes, not merely on the earlier pathname.
      fingerprints('claimed');
      checkpoint('before_source_claimed_receipt');
      record('source_claimed', { stage: 'source_claimed', actualClaimSha256: readStable(claim).sha256 });
    }
    checkpoint('before_publish');
    fingerprints(claimed ? 'claimed' : 'original');
    if (input.mode === 'replace_source') occupancy();
    guardAbsolute(path.dirname(target), true);
    if (readStable(stageCopy).sha256 !== input.stagedSha256) fail('stage_changed');
    ownTarget = fs.lstatSync(stageCopy);
    try { fs.linkSync(stageCopy, target); installed = true; targetWritten = true; }
    catch (error) {
      try {
        const actual = fs.lstatSync(target);
        if (actual.ino === ownTarget.ino && actual.dev === ownTarget.dev) { installed = true; targetWritten = true; }
        else if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { targetWritten = null; mutationOutcomeUnknown = true; }
      } catch (inspectionError) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
          && (!['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EXDEV', 'EROFS'].includes((error as NodeJS.ErrnoException).code ?? '')
            || (inspectionError as NodeJS.ErrnoException).code !== 'ENOENT')) {
          targetWritten = null; mutationOutcomeUnknown = true;
        }
      }
      throw error;
    }
    checkpoint('after_link');
    fs.unlinkSync(stageCopy); stageCopy = '';
    syncDirectory(path.dirname(target));
    checkpoint('after_publish');
    fingerprints(input.mode === 'replace_source' ? 'published' : 'original');
    const actual = readStable(location(input.root, input.targetRel));
    if (actual.sha256 !== input.stagedSha256 || actual.stat.ino !== ownTarget.ino || actual.stat.dev !== ownTarget.dev) fail('published_target_changed');
    if (input.mode === 'replace_source') occupancy();
    checkpoint('before_published_receipt');
    record('published', { stage: 'published', sourceWritten, targetWritten }); publishedReceiptWritten = true;
    checkpoint('after_published_receipt');
    return receipt('published', 'published', true);
  } catch (error) {
    const code = error instanceof PublicationFailure ? error.code : (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'target_exists' : 'publication_io_failure';
    // Once the published record is durable, a lost response is an unknown
    // outcome to be reconciled, never permission to replay or roll back.
    if (publishedReceiptWritten) return receipt('unknown', 'published_response_lost', true);
    let recoveryUnknown = mutationOutcomeUnknown;
    if (claimed || installed) {
      try {
        checkpoint('before_rollback');
        guardAbsolute(input.root, true); guardAbsolute(path.dirname(target), true);
        if (installed) {
          const owned = ownTarget;
          if (!owned) throw new PublicationFailure('rollback_target_changed');
          const current = readStable(target, true);
          if (current.stat.ino !== owned.ino || current.stat.dev !== owned.dev || current.sha256 !== input.stagedSha256) fail('rollback_target_changed');
          // Claim our installed name before removing it, and compare ACTUAL
          // moved bytes. A concurrent replacement is retained, never destroyed.
          const retained = path.join(evidenceDirectory, 'failed-published.FCStd');
          fs.renameSync(target, retained); installed = false;
          const moved = readStable(retained, true);
          if (moved.stat.ino !== owned.ino || moved.stat.dev !== owned.dev || moved.sha256 !== input.stagedSha256) {
            try { fs.linkSync(retained, target); } catch { /* preserve both names/evidence */ }
            fail('rollback_target_changed');
          }
          syncDirectory(path.dirname(target)); syncDirectory(evidenceDirectory);
        }
        if (claimed) {
          guardAbsolute(claim, false);
          // Restore the ACTUAL moved original even if its CAS failed. Never
          // overwrite a newly-created source or replace it from the backup.
          fs.linkSync(claim, source);
          fs.unlinkSync(claim); claimed = false;
          syncDirectory(path.dirname(source)); syncDirectory(evidenceDirectory);
        }
      } catch { recoveryUnknown = true; }
    }
    // Retain our same-directory temporary artifact inside ignored durable job
    // evidence where possible. Unknown names are never unlinked blindly.
    if (stageCopy && evidenceCreated) {
      try {
        const staged = readStable(stageCopy, true);
        if (staged.sha256 !== input.stagedSha256 || (ownTarget
          && (staged.stat.dev !== ownTarget.dev || staged.stat.ino !== ownTarget.ino))) fail('stage_copy_changed');
        guardAbsolute(evidenceDirectory, true);
        fs.renameSync(stageCopy, path.join(evidenceDirectory, 'unpublished-stage.FCStd'));
        syncDirectory(path.dirname(stageCopy)); syncDirectory(evidenceDirectory); stageCopy = '';
      } catch { recoveryUnknown = true; }
    }
    const status: PublicationReceipt['status'] = recoveryUnknown ? 'unknown' : sourceWritten || targetWritten ? 'rolled_back' : 'blocked';
    const result = receipt(status, code, false);
    if (evidenceCreated && intentWritten) {
      try { checkpoint('before_failure_receipt'); record('failure', { stage: 'failure', result }); result.receiptDurable = true; }
      catch { result.status = 'unknown'; result.code = 'failure_receipt_unavailable'; result.requiresManualReview = true; }
    } else if (evidenceCreated) {
      try { record('failure', { stage: 'failure', result }); result.receiptDurable = true; }
      catch { result.status = 'unknown'; result.code = 'failure_receipt_unavailable'; result.requiresManualReview = true; }
    }
    return result;
  }
}
