/** Manual production-adapter acceptance using independent generated geometry.
 * pnpm -C server exec tsx scripts/verify-assembly-preview.ts --allow-native
 * Never accepts user CAD, a Host scope override, a script or an output directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { createSyntheticAssemblyRefreshFixture } from './verify-assembly-refresh.js';
import { captureSavedAssemblyBaseline } from '../src/features/assembly-maintenance/baseline.js';
import { createAssemblyNativePreview } from '../src/features/assembly-maintenance/native-preview.js';
const hash = (filename: string) => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const PROOF_SOURCES = ['server/scripts/verify-assembly-preview.ts', 'server/scripts/verify-assembly-refresh.ts',
  'server/src/features/assembly-maintenance/native-preview.ts', 'server/src/features/assembly-maintenance/native-archive.ts',
  'server/src/features/assembly-maintenance/native-runner.ts', 'server/src/features/assembly-maintenance/native-preservation.ts',
  'server/src/features/assembly-maintenance/baseline.ts', 'server/src/features/drawing-research/executionGate.ts',
  'server/src/features/cad-native-measurement/host-barrier.ts', 'server/src/lib/freecadProcessSecurity.ts'] as const;
function proofSources() {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  return Object.fromEntries(PROOF_SOURCES.map(name => [name, hash(path.join(repository, name))]));
}

export async function verifyAssemblyPreview() {
  const sources = proofSources();
  const fixture = await createSyntheticAssemblyRefreshFixture();
  const source = path.join(fixture.directory, 'Host.FCStd');
  const archive = unzipSync(fs.readFileSync(source));
  archive['GuiDocument.xml'] = new TextEncoder().encode('<?xml version="1.0"?><GuiDocument SchemaVersion="1"><ViewProviderData Count="3"><ViewProvider name="RigidInstance" expanded="1"><Properties Count="0"></Properties></ViewProvider><ViewProvider name="Loose" expanded="0"><Properties Count="0"></Properties></ViewProvider><ViewProvider name="Loose001" expanded="0"><Properties Count="0"></Properties></ViewProvider></ViewProviderData></GuiDocument>');
  archive['thumbnails/Thumbnail.png'] = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(source, zipSync(archive));
  const selectedObjects = ['RigidInstance', 'FlexibleInstance'];
  const baseline = await captureSavedAssemblyBaseline(fixture.directory, 'Host.FCStd', undefined, { selectedHostObjects: selectedObjects });
  const before = Object.fromEntries(baseline.files.map(file => [file.rel, hash(path.join(fixture.directory, file.rel))]));
  const mirrorRoot = path.join(fixture.directory, 'mirror'); fs.mkdirSync(mirrorRoot, { mode: 0o700 });
  for (const file of baseline.files) fs.copyFileSync(path.join(fixture.directory, file.rel), path.join(mirrorRoot, file.rel), fs.constants.COPYFILE_EXCL);
  const result = await createAssemblyNativePreview('/Applications/FreeCAD.app')({ mirrorRoot, baseline, selectedObjects,
    signal: new AbortController().signal, phase: phase => console.log(JSON.stringify({ phase })) });
  if (result.preview.added.length !== 2 || result.preview.removed.length !== 2) throw new Error('expected_exact_two_branch_changes');
  for (const [rel, digest] of Object.entries(before)) if (hash(path.join(fixture.directory, rel)) !== digest) throw new Error('source_written');
  // The already refreshed host must be honestly reported as unchanged, even
  // though the read-only dependency definition still contains its old copies.
  const noOpBaseline = await captureSavedAssemblyBaseline(mirrorRoot, 'Host.FCStd', undefined, { selectedHostObjects: selectedObjects });
  const noOpRoot = path.join(fixture.directory, 'mirror-noop'); fs.mkdirSync(noOpRoot, { mode: 0o700 });
  for (const file of noOpBaseline.files) fs.copyFileSync(path.join(mirrorRoot, file.rel), path.join(noOpRoot, file.rel), fs.constants.COPYFILE_EXCL);
  const noOp = await createAssemblyNativePreview('/Applications/FreeCAD.app')({ mirrorRoot: noOpRoot, baseline: noOpBaseline, selectedObjects,
    signal: new AbortController().signal, phase: () => {} });
  if (noOp.preview.added.length || noOp.preview.removed.length) throw new Error('no_op_misreported_as_fix');
  const negatives = [];
  for (const kind of ['connected', 'compound'] as const) {
    const item = await createSyntheticAssemblyRefreshFixture(kind);
    const initial = Object.fromEntries(['Host.FCStd', 'Middle.FCStd', 'Leaf.FCStd'].map(rel => [rel, hash(path.join(item.directory, rel))]));
    let reason = '';
    try {
      const input = await captureSavedAssemblyBaseline(item.directory, 'Host.FCStd', undefined, { selectedHostObjects: selectedObjects });
      const negativeMirror = path.join(item.directory, 'mirror'); fs.mkdirSync(negativeMirror, { mode: 0o700 });
      for (const file of input.files) fs.copyFileSync(path.join(item.directory, file.rel), path.join(negativeMirror, file.rel), fs.constants.COPYFILE_EXCL);
      await createAssemblyNativePreview('/Applications/FreeCAD.app')({ mirrorRoot: negativeMirror, baseline: input, selectedObjects, signal: new AbortController().signal, phase: () => {} });
    } catch (error) {
      reason = error && typeof error === 'object' && 'reason' in error ? String(error.reason) : '';
    }
    if (kind === 'compound' && reason !== 'compound_joint_actual_frame_unknown') throw new Error('compound_negative_not_proved:' + reason);
    if (kind === 'connected' && !['saved_disconnected_joint', 'missing_local_link_target', 'stale_copy_is_referenced', 'stale_source_is_referenced', 'unresolved_xlink_identity'].includes(reason)) throw new Error('connected_negative_not_proved:' + reason);
    for (const [rel, digest] of Object.entries(initial)) if (hash(path.join(item.directory, rel)) !== digest) throw new Error('negative_source_written');
    negatives.push({ kind, artifact: path.basename(item.directory), blocked: true, reason, source_unchanged: true });
  }
  for (const [rel, digest] of Object.entries(before)) if (hash(path.join(fixture.directory, rel)) !== digest) throw new Error('source_written_after_complete_workflow');
  fs.writeFileSync(path.join(fixture.directory, 'adapter-complete-receipt.json'), JSON.stringify({ result, noOp, negatives, before,
    source_unchanged: true, code_sources: sources, code_unchanged: JSON.stringify(sources) === JSON.stringify(proofSources()),
    actual_frame_scope: 'saved_stored_frames_and_current_frozen_geometry_not_unavailable_historical_geometry' }, null, 2), { mode: 0o600, flag: 'wx' });
  if (JSON.stringify(sources) !== JSON.stringify(proofSources())) throw new Error('proof_code_changed');
  return { state: 'passed', artifacts: path.basename(fixture.directory), code_unchanged: true, preview: result.preview, no_op_correctly_unchanged: true, negatives };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--allow-native') { console.error('Explicit --allow-native is required.'); process.exitCode = 2; }
  else verifyAssemblyPreview().then(value => console.log(JSON.stringify(value))).catch(error => {
    console.error(JSON.stringify({ state: 'failed', code: error?.code ?? 'unverified_failure', reason: error?.reason ?? null })); process.exitCode = 1;
  });
}
