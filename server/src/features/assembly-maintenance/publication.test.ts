import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishVerifiedAssembly, type VerifiedPublication, type PublicationCheckpoint } from './publication.js';
import type { FreecadProcessOccupancy } from './process-occupancy.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const original = Buffer.from('independently constructed opaque original bytes');
const updated = Buffer.from('independently constructed opaque updated bytes');
const dependent = Buffer.from('independently constructed opaque dependency bytes');
const concurrent = Buffer.from('independent concurrent author bytes');
const roots: string[] = [];
const occupancy = (state: FreecadProcessOccupancy['state'] = 'clear'): FreecadProcessOccupancy => ({
  state, checkedAt: new Date().toISOString(), platform: 'darwin', scope: 'current_macos_host_process_snapshot', reason: 'synthetic_observation',
});
const clear = () => occupancy();
function fixture(mode: VerifiedPublication['mode'] = 'replace_source') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'assembly-publication-'))); roots.push(root);
  const sourceRel = 'models/Host.FCStd', targetRel = mode === 'replace_source' ? sourceRel : 'models/Verified.FCStd';
  const jobDirectory = path.join(root, '.phoenix', 'assembly-maintenance', 'independent-job');
  fs.mkdirSync(path.join(root, 'models')); fs.mkdirSync(jobDirectory, { recursive: true });
  const source = path.join(root, sourceRel), target = path.join(root, targetRel), dependency = path.join(root, 'models/Dependency.FCStd');
  const stagedFile = path.join(jobDirectory, 'stage.FCStd');
  fs.writeFileSync(source, original); fs.writeFileSync(stagedFile, updated); fs.writeFileSync(dependency, dependent);
  const input: VerifiedPublication = { root, sourceRel, targetRel, stagedFile, jobDirectory, mode,
    sourceSha256: hash(original), stagedSha256: hash(updated), planDigest: hash('independent frozen plan'),
    dependencyFingerprints: [{ rel: 'models/Dependency.FCStd', sha256: hash(dependent) }],
    confirmedClosed: true, confirmedNotReopened: true,
    nativeProof: {
      update: { nonce: '00000000-0000-4000-a000-000000000001', pid: 81001, actual_close_observed: true, exit_code: 0, signal: null },
      reopen: { nonce: '00000000-0000-4000-a000-000000000002', pid: 81002, actual_close_observed: true, exit_code: 0, signal: null },
    },
  };
  return { root, input, source, target, dependency, jobDirectory, evidence: path.join(jobDirectory, 'publication') };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('single-host, no-replace verified publication using opaque /tmp bytes only', () => {
  it('replaces one host only, preserving persistent original backup and the ordered durable receipts', () => {
    const f = fixture(); const snapshots = vi.fn(clear);
    const result = publishVerifiedAssembly(f.input, { occupancy: snapshots });
    expect(result).toMatchObject({ status: 'published', sourceWritten: true, targetWritten: true, sourceState: 'updated', receiptDurable: true });
    expect(snapshots.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fs.readFileSync(f.source)).toEqual(updated); expect(fs.statSync(f.source).nlink).toBe(1);
    expect(fs.readFileSync(f.dependency)).toEqual(dependent);
    expect(fs.readFileSync(path.join(f.evidence, 'before.FCStd'))).toEqual(original);
    expect(fs.readFileSync(path.join(f.evidence, 'source-claimed.FCStd'))).toEqual(original);
    for (const stage of ['publish_intent', 'source_claimed', 'published']) expect(JSON.parse(fs.readFileSync(path.join(f.evidence, stage + '.json'), 'utf8')).stage).toBe(stage);
  });
  it('copy mode never claims or writes the original, even with no GUI-closed promise', () => {
    const f = fixture('verified_copy'); f.input.confirmedClosed = false; f.input.confirmedNotReopened = false;
    const oldStat = fs.statSync(f.source); const snapshots = vi.fn(() => occupancy('busy'));
    const result = publishVerifiedAssembly(f.input, { occupancy: snapshots });
    expect(result).toMatchObject({ status: 'published', sourceWritten: false, targetWritten: true, sourceState: 'original' });
    expect(snapshots).not.toHaveBeenCalled(); expect(fs.readFileSync(f.source)).toEqual(original);
    expect(fs.statSync(f.source).ino).toBe(oldStat.ino); expect(fs.statSync(f.source).mtimeMs).toBe(oldStat.mtimeMs);
    expect(fs.readFileSync(f.target)).toEqual(updated); expect(fs.existsSync(path.join(f.evidence, 'source-claimed.FCStd'))).toBe(false);
  });
  it.each(['busy', 'unknown'] as const)('rejects %s occupancy before any source/target write', state => {
    const f = fixture();
    expect(publishVerifiedAssembly(f.input, { occupancy: () => occupancy(state) })).toMatchObject({ status: 'blocked', sourceWritten: false, targetWritten: false });
    expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it('requires both user confirmations and both actual Native-close proofs', () => {
    for (const field of ['confirmedClosed', 'confirmedNotReopened'] as const) {
      const f = fixture(); f.input[field] = false;
      expect(publishVerifiedAssembly(f.input, { occupancy: clear }).code).toBe('closed_confirmation_required');
      expect(fs.readFileSync(f.source)).toEqual(original);
    }
    const f = fixture(); f.input.nativeProof.reopen.actual_close_observed = false;
    expect(publishVerifiedAssembly(f.input, { occupancy: clear }).code).toBe('native_close_proof_missing');
  });
  it.each(['source', 'dependency', 'stage'] as const)('rejects a stale %s before claim', which => {
    const f = fixture(); fs.writeFileSync(which === 'source' ? f.source : which === 'dependency' ? f.dependency : f.input.stagedFile, concurrent);
    const result = publishVerifiedAssembly(f.input, { occupancy: clear });
    expect(result).toMatchObject({ status: 'blocked', sourceWritten: false, targetWritten: false });
    expect(fs.readFileSync(f.source)).toEqual(which === 'source' ? concurrent : original);
  });
  it.each(['before_claim', 'before_publish'] as const)('rechecks concurrent dependency changes at %s', point => {
    const f = fixture();
    const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: current => { if (current === point) fs.writeFileSync(f.dependency, concurrent); } });
    expect(result.status).toBe(point === 'before_claim' ? 'blocked' : 'rolled_back');
    expect(result.code).toBe('dependency_changed'); expect(fs.readFileSync(f.source)).toEqual(original);
    expect(fs.readFileSync(f.dependency)).toEqual(concurrent);
  });
  it('CASes the actual moved source bytes, preserving a late writer instead of restoring the frozen backup', () => {
    const f = fixture(); const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === f.source && String(to).endsWith('source-claimed.FCStd')) fs.writeFileSync(f.source, concurrent);
      return rename(from, to);
    });
    const result = publishVerifiedAssembly(f.input, { occupancy: clear });
    expect(result).toMatchObject({ status: 'rolled_back', code: 'source_changed', sourceWritten: true, targetWritten: false, sourceState: 'changed' });
    expect(fs.readFileSync(f.source)).toEqual(concurrent); expect(fs.statSync(f.source).nlink).toBe(1);
    expect(fs.readFileSync(path.join(f.evidence, 'before.FCStd'))).toEqual(original);
  });
  it('does not overwrite a concurrently created copy target', () => {
    const f = fixture('verified_copy');
    const result = publishVerifiedAssembly(f.input, { checkpoint: point => { if (point === 'before_publish') fs.writeFileSync(f.target, concurrent); } });
    expect(result).toMatchObject({ status: 'blocked', code: 'target_exists', sourceWritten: false, targetWritten: false });
    expect(fs.readFileSync(f.target)).toEqual(concurrent); expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it('retains the claimed original without overwriting a concurrent source created in the claim window', () => {
    const f = fixture();
    const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: point => { if (point === 'before_publish') fs.writeFileSync(f.source, concurrent); } });
    expect(result).toMatchObject({ status: 'unknown', sourceWritten: true, targetWritten: false, requiresManualReview: true });
    expect(fs.readFileSync(f.source)).toEqual(concurrent);
    expect(fs.readFileSync(path.join(f.evidence, 'source-claimed.FCStd'))).toEqual(original);
  });
  it.each(['after_claim', 'before_source_claimed_receipt', 'before_publish', 'after_link', 'after_publish', 'before_published_receipt'] as PublicationCheckpoint[])(
    'recovers from injected failure at %s and reports the actual write history', point => {
      const f = fixture();
      const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: current => { if (current === point) throw new Error('independent failure'); } });
      expect(result).toMatchObject({ status: 'rolled_back', sourceWritten: true, targetWritten: ['after_link', 'after_publish', 'before_published_receipt'].includes(point), sourceState: 'original' });
      expect(fs.readFileSync(f.source)).toEqual(original); expect(fs.readFileSync(f.dependency)).toEqual(dependent);
    });
  it('busy observed after the publish rolls back instead of returning success', () => {
    const f = fixture(); let count = 0;
    const result = publishVerifiedAssembly(f.input, { occupancy: () => occupancy(++count >= 4 ? 'busy' : 'clear') });
    expect(result).toMatchObject({ status: 'rolled_back', code: 'freecad_busy', sourceWritten: true, targetWritten: true });
    expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it('preserves a concurrently replaced target rather than erasing it during rollback', () => {
    const f = fixture();
    const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: point => {
      if (point === 'after_publish') { fs.unlinkSync(f.target); fs.writeFileSync(f.target, concurrent); throw new Error('race'); }
    } });
    expect(result.status).toBe('unknown'); expect(result.sourceWritten).toBe(true); expect(result.targetWritten).toBe(true);
    expect(fs.readFileSync(f.source)).toEqual(concurrent);
    expect(fs.readFileSync(path.join(f.evidence, 'source-claimed.FCStd'))).toEqual(original);
  });
  it('a durable publish followed by response loss is unknown and is never replayed', () => {
    const f = fixture();
    const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: point => { if (point === 'after_published_receipt') throw new Error('response loss'); } });
    expect(result).toMatchObject({ status: 'unknown', code: 'published_response_lost', sourceWritten: true, targetWritten: true, receiptDurable: true });
    expect(fs.readFileSync(f.source)).toEqual(updated);
    expect(publishVerifiedAssembly(f.input, { occupancy: clear })).toMatchObject({ status: 'unknown', code: 'publication_already_started' });
  });
  it('receipt failure after claim cannot masquerade as no-write', () => {
    const f = fixture();
    const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: point => {
      if (point === 'before_source_claimed_receipt' || point === 'before_failure_receipt') throw new Error('receipt unavailable');
    } });
    expect(result).toMatchObject({ status: 'unknown', code: 'failure_receipt_unavailable', sourceWritten: true, targetWritten: false, sourceState: 'original', receiptDurable: false });
  });
  it('reconciles a rename that moved source bytes but lost its return result', () => {
    const f = fixture(); const rename = fs.renameSync.bind(fs); let lost = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to);
      if (!lost && String(from) === f.source && String(to).endsWith('source-claimed.FCStd')) { lost = true; throw new Error('independent lost syscall result'); }
    });
    const result = publishVerifiedAssembly(f.input, { occupancy: clear });
    expect(result).toMatchObject({ status: 'rolled_back', sourceWritten: true, targetWritten: false, sourceState: 'original' });
    expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it('reconciles a link that installed the target but lost its return result', () => {
    const f = fixture(); const link = fs.linkSync.bind(fs); let lost = false;
    vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => {
      link(from, to);
      if (!lost && String(to) === f.target && String(from).endsWith('.stage')) { lost = true; throw new Error('independent lost syscall result'); }
    });
    const result = publishVerifiedAssembly(f.input, { occupancy: clear });
    expect(result).toMatchObject({ status: 'rolled_back', sourceWritten: true, targetWritten: true, sourceState: 'original' });
    expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it('reports null, not false, when a lost rename result cannot be reconciled from disk', () => {
    const f = fixture(); const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === f.source && String(to).endsWith('source-claimed.FCStd')) {
        rename(from, path.join(f.root, 'opaque-unlocated-by-publisher.FCStd'));
        throw new Error('independent unreconciled syscall result');
      }
      return rename(from, to);
    });
    const result = publishVerifiedAssembly(f.input, { occupancy: clear });
    expect(result).toMatchObject({ status: 'unknown', sourceWritten: null, targetWritten: false, sourceState: 'missing', requiresManualReview: true });
    expect(fs.readFileSync(path.join(f.evidence, 'before.FCStd'))).toEqual(original);
    expect(publishVerifiedAssembly(f.input, { occupancy: clear })).toMatchObject({ status: 'unknown', code: 'publication_already_started' });
  });
  it.each(['after_intent', 'before_published_receipt'] as const)('fsync failure armed at %s reports the actual source/target mutations', point => {
    const f = fixture();
    const result = publishVerifiedAssembly(f.input, { occupancy: clear, checkpoint: current => {
      if (current === point) vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => { throw new Error('independent fsync failure'); });
    } });
    expect(result).toMatchObject({ status: 'rolled_back', sourceWritten: true, targetWritten: point === 'before_published_receipt', sourceState: 'original' });
    expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it('fsync failure before source claim does not write source or target', () => {
    const f = fixture(); vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('independent fsync failure'); });
    const result = publishVerifiedAssembly(f.input, { occupancy: clear });
    expect(result).toMatchObject({ status: 'unknown', sourceWritten: false, targetWritten: false, receiptDurable: false });
    expect(fs.readFileSync(f.source)).toEqual(original);
  });
  it.each(['source', 'dependency', 'stage'] as const)('rejects hardlinked %s files', which => {
    const f = fixture(); const file = which === 'source' ? f.source : which === 'dependency' ? f.dependency : f.input.stagedFile;
    fs.linkSync(file, path.join(f.root, 'independent-hardlink'));
    expect(publishVerifiedAssembly(f.input, { occupancy: clear })).toMatchObject({ status: 'blocked', sourceWritten: false, targetWritten: false });
  });
  it('rejects symlink source, dependency ancestor, escaped target and non-private evidence paths', () => {
    const symlink = fixture(); fs.renameSync(symlink.source, path.join(symlink.root, 'independent-file')); fs.symlinkSync('../independent-file', symlink.source);
    expect(publishVerifiedAssembly(symlink.input, { occupancy: clear }).status).toBe('blocked');
    const escaped = fixture('verified_copy'); escaped.input.targetRel = '../Outside.FCStd';
    expect(publishVerifiedAssembly(escaped.input, { occupancy: clear }).status).toBe('blocked');
    const evidence = fixture(); evidence.input.jobDirectory = evidence.root;
    expect(publishVerifiedAssembly(evidence.input, { occupancy: clear }).code).toBe('unsafe_job_directory');
  });
});
