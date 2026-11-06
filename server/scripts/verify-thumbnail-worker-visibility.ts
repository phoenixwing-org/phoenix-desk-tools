/** Manual, independent visibility QA only. Inject a fixed candidate into this
 * process and pass exactly --allow-native. No CAD/workspace/URL/script/profile
 * input is accepted; all source files and receipts are newly created locally. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {inflateSync} from 'node:zlib';
import {unzipSync} from 'fflate';
import {pnwCreateDb} from '@phoenix-wing/db-node';
import {createSyntheticGuiThumbnailFixtures} from './thumbnail-worker-fixtures.js';
import {buildSyntheticVisibilityVariants} from './thumbnail-worker-visibility-fixtures.js';
import {ASSEMBLY_NATIVE_BOOTSTRAP, runOwnedAssemblyNative} from '../src/features/assembly-maintenance/native-runner.js';
import {loadPinnedResource, checkedBytes} from '../src/features/freecad-mcp/resource.js';
import {withOwnedThumbnailWorker} from '../src/features/freecad-mcp/worker-session.js';
import type {ThumbnailWorkerClient, ThumbnailWorkerJobInput} from '../src/features/freecad-mcp/worker-client.js';
import {publishWorkerThumbnail} from '../src/features/freecad-mcp/thumbnail-publication.js';
import {thumbnailBytes} from '../src/features/part-gallery/service.js';
import {resolveFreecadGuiRuntime} from '../src/lib/freecadGuiRuntime.js';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const SOURCES = ['server/scripts/verify-thumbnail-worker-visibility.ts', 'server/scripts/thumbnail-worker-visibility-fixtures.ts',
  'server/scripts/thumbnail-worker-fixtures.ts', 'server/src/features/assembly-maintenance/native-runner.ts',
  ...['resource', 'worker-session', 'worker-client', 'worker-png', 'thumbnail-publication'].map(name => `server/src/features/freecad-mcp/${name}.ts`),
  ...['freecadGuiRuntime', 'freecadProcessSecurity', 'appRuntimePaths', 'deskToolsRegistration'].map(name => `server/src/lib/${name}.ts`),
  'server/src/features/drawing-research/executionGate.ts', 'server/src/features/cad-native-measurement/host-barrier.ts'];
function sourceHashes() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return Object.fromEntries(SOURCES.map(rel => [rel, sha(fs.readFileSync(path.join(root, rel)))]));
}
function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error('Independent visibility QA not verified'), {code});
}
function writeNew(filename: string, bytes: Uint8Array | string) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
const CMD_SEED = ASSEMBLY_NATIVE_BOOTSTRAP + String.raw`
import hashlib, zipfile, xml.etree.ElementTree as ET
import Part
assert spec['payload'] == {}, 'unexpected_seed_input'
files = []
for name, cylinder, visible in [('CmdPlate',False,True),('CmdSpacer',True,True),('CmdHiddenPlate',False,False),('CmdHiddenSpacer',True,False)]:
    document = App.newDocument(name)
    obj = document.addObject('Part::Feature','Shape')
    obj.Shape = Part.makeCylinder(3,9) if cylinder else Part.makeBox(12,8,3)
    document.recompute()
    assert obj.Shape.Volume > 0 and not obj.Shape.isNull(), 'seed_shape_invalid'
    assert obj.getTypeIdOfProperty('Visibility') == 'App::PropertyBool', 'seed_visibility_missing'
    obj.Visibility = visible
    target = root / (name + '.FCStd')
    assert not target.exists(), 'seed_target_exists'
    document.saveAs(str(target))
    with zipfile.ZipFile(target) as archive:
        assert 'GuiDocument.xml' not in archive.namelist(), 'cmd_unexpected_gui'
        xml = ET.fromstring(archive.read('Document.xml'))
        objects = [item for item in xml.findall('./ObjectData/Object') if item.get('name') == 'Shape']
        assert len(objects) == 1, 'seed_object_identity'
        value = objects[0].find("./Properties/Property[@name='Visibility']/Bool")
        assert value is not None and value.get('value') in (('true','1') if visible else ('false','0')), 'seed_visibility_not_saved'
    content = target.read_bytes()
    files.append({'rel':target.name,'sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),'visible':visible})
    assert App.listDocuments() == {document.Name:document}, 'seed_document_identity'
    App.closeDocument(document.Name)
    assert not App.listDocuments(), 'seed_document_not_closed'
finish({'state':'seeded','documents_closed':True,'files':files})
`;

/** Only these primitive, white-background fixtures use this visual predicate.
 * A hidden result is state-preservation evidence, NOT a useful thumbnail. */
function fixtureImageContent(png: Buffer): {visiblePixels: number; foregroundSha: string} {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), bpp = png[25] === 6 ? 4 : 3, chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const stride = width * bpp, raw = inflateSync(Buffer.concat(chunks), {maxOutputLength: (stride + 1) * height}), pixels = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  let count = 0;
  const foreground = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x >= bpp ? pixels[at - bpp] : 0, b = y ? pixels[at - stride] : 0, c = y && x >= bpp ? pixels[at - stride - bpp] : 0;
      pixels[at] = (raw[y * (stride + 1) + 1 + x] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 255;
    }
    for (let x = 0; x < stride; x += bpp) if ((bpp === 3 || pixels[y * stride + x + 3] > 0) && Math.min(...pixels.subarray(y * stride + x, y * stride + x + 3)) < 240) {
      foreground[y * width + x / bpp] = 1; count++;
    }
  }
  return {visiblePixels: count, foregroundSha: sha(foreground)};
}
async function terminal(client: ThumbnailWorkerClient, input: ThumbnailWorkerJobInput) {
  let result;
  try { result = await client.render(input); } catch (error) {
    assert(['worker_timeout', 'BRIDGE_TIMEOUT', 'CONNECTION_FAILED'].includes(String((error as {code?: string})?.code)), 'render_not_observed');
    result = await client.get(input); // Never resubmit the render.
  }
  const deadline = Date.now() + 120_000;
  while (!['done', 'failed', 'cancelled'].includes(result.state)) {
    assert(Date.now() < deadline, 'job_observation_timeout'); await delay(75); result = await client.get(input);
  }
  return result;
}

export async function verifyThumbnailWorkerVisibility() {
  assert(process.argv.slice(2).join(' ') === '--allow-native', 'explicit_native_required');
  assert(process.env.PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST && process.env.PHOENIX_FREECAD_MCP_RESOURCE_SHA256, 'explicit_candidate_required');
  assert(!process.env.PHOENIX_DESK_TOOLS_REGISTRY_DIR && os.homedir() === os.userInfo().homedir, 'normal_host_scope_required');
  const sources = sourceHashes(), loaded = loadPinnedResource(); assert(loaded.state === 'ready', 'candidate_not_verified');
  const runtime = resolveFreecadGuiRuntime(), artifact = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-worker-visibility-proof-')));
  fs.chmodSync(artifact, 0o700);
  const checks: Record<string, boolean> = {}, results: unknown[] = [], imageHashes: Record<string, string> = {}, published: string[] = [];
  const silhouettes: Record<string, string> = {};
  const bindings: Array<{rel: string; workerId: string; sessionId: string; jobId: string; source: string; image: string}> = [];
  const closeEvents: Array<{kind: string; pid: number | null; resource_present: boolean}> = [];
  let workspace = '', frozenRoot = '', identity: {nativePid: number} | undefined, failure: unknown;
  const seedEvidence: Record<string, unknown> = {};
  let phase = 'gui_seed', before: Record<string, string> = {}, hiddenFiles: string[] = [], rejectedFiles: string[] = [];
  try {
    const gui = await createSyntheticGuiThumbnailFixtures({executable: runtime.executable});
    workspace = gui.directory;
    assert(gui.proof.actual_close_observed && gui.proof.exit_code === 0 && gui.receipt.gui_documents_verified, 'gui_seed_not_verified');
    seedEvidence.gui = gui.proof;
    phase = 'cmd_seed';
    const cmd = await runOwnedAssemblyNative({freecadHome: runtime.installationRoot, stage: 'thumbnail-visibility-fixture', script: CMD_SEED, spec: {}});
    assert(cmd.proof.actual_close_observed && cmd.proof.exit_code === 0 && cmd.receipt.state === 'seeded' && cmd.receipt.documents_closed === true && Array.isArray(cmd.receipt.files), 'cmd_seed_not_verified');
    seedEvidence.cmd = cmd.proof; seedEvidence.cmd_directory = cmd.directory;
    phase = 'cmd_copy';
    const cmdNames = ['CmdPlate.FCStd', 'CmdSpacer.FCStd', 'CmdHiddenPlate.FCStd', 'CmdHiddenSpacer.FCStd'];
    assert(cmd.receipt.files.length === cmdNames.length, 'cmd_seed_count');
    for (const [index, rel] of cmdNames.entries()) {
      const bytes = checkedBytes(path.join(cmd.directory, rel), 16 * 1024 * 1024), claim = cmd.receipt.files[index] as {rel: string; sha256: string; bytes: number};
      assert(claim.rel === rel && claim.sha256 === sha(bytes) && claim.bytes === bytes.length && !unzipSync(bytes)['GuiDocument.xml'], 'cmd_seed_bytes_changed');
      writeNew(path.join(workspace, rel), bytes);
    }
    seedEvidence.cmd_source_hashes = Object.fromEntries(cmdNames.map(rel => [rel, sha(checkedBytes(path.join(cmd.directory, rel)))]));
    phase = 'variants';
    const variants = buildSyntheticVisibilityVariants(checkedBytes(path.join(workspace, 'Plate.FCStd')));
    for (const [key, value] of Object.entries(variants)) writeNew(path.join(workspace, key + '.FCStd'), value);
    const cases = [
      ...['Plate.FCStd', 'Spacer.FCStd', 'CmdPlate.FCStd', 'CmdSpacer.FCStd', 'withoutGui.FCStd'].map(rel => ({rel, expected: 'visible'})),
      ...['guiHidden.FCStd', 'CmdHiddenPlate.FCStd', 'CmdHiddenSpacer.FCStd'].map(rel => ({rel, expected: 'hidden'})),
      ...['missingVisibility.FCStd', 'invalidVisibility.FCStd'].map(rel => ({rel, expected: 'rejected'})),
      {rel: 'Plate.FCStd', expected: 'recovery'},
    ];
    hiddenFiles = cases.filter(item => item.expected === 'hidden').map(item => item.rel);
    rejectedFiles = cases.filter(item => item.expected === 'rejected').map(item => item.rel);
    before = Object.fromEntries([...new Set(cases.map(item => item.rel))].map(rel => [rel, sha(checkedBytes(path.join(workspace, rel)))]));
    checks.gui_and_actual_cmd_seeds_closed = true;
    phase = 'worker_start';
    const profile = path.join(artifact, 'Worker');
    await withOwnedThumbnailWorker({resource: loaded.resource, executable: runtime.executable, profile, forbidden_roots: [workspace, cmd.directory]}, async session => {
      identity = session.identity;
      frozenRoot = path.dirname(path.dirname(fs.realpathSync(path.join(profile, 'Mod', 'PhoenixFreeCADTools'))));
      for (const [index, item] of cases.entries()) {
        const caseKey = index + '_' + item.rel;
        phase = 'case_' + caseKey;
        const readyBefore = await session.client.status();
        assert(readyBefore.state === 'ready' && readyBefore.active_job_id === null, 'worker_not_ready_before_case');
        const input = {jobId: randomUUID(), file: path.join(workspace, item.rel), expectedSha256: before[item.rel], width: 128, height: 128};
        const job = await terminal(session.client, input);
        const entry: Record<string, unknown> = {rel: item.rel, expected: item.expected, job: {...job, result: job.result ? {...job.result, png: undefined} : null}};
        if (item.expected === 'rejected') {
          checks[caseKey + '_explicitly_rejected'] = job.state === 'failed' && job.result === null && job.error !== null;
        } else {
          assert(job.state === 'done' && job.result && job.input_revision, 'valid_case_not_completed');
          const image = job.result, content = fixtureImageContent(image.png), pixels = content.visiblePixels;
          silhouettes[item.rel] = content.foregroundSha;
          imageHashes[item.rel] = image.sha256; entry.nonwhite_pixels = pixels;
          if (item.expected === 'hidden') {
            checks[caseKey + '_hidden_state_preserved_only'] = pixels === 0;
            entry.visual_thumbnail_accepted = false;
            writeNew(path.join(artifact, `hidden-${index}.png`), image.png);
          } else {
            checks[caseKey + (item.expected === 'recovery' ? '_recovery_nonblank' : '_nonblank')] = pixels > image.width * image.height / 100;
            assert(pixels > image.width * image.height / 100, 'visible_case_blank');
            const publication = await publishWorkerThumbnail({workspacePath: workspace, filePath: item.rel, expectedSourceSha256: before[item.rel],
              worker: {workerId: session.identity.workerId, sessionId: session.identity.sessionId, jobId: input.jobId}, inputRevision: job.input_revision,
              renderProfile: image.render_profile, image, cameraRestored: image.camera_restored, documentsClosed: image.documents_closed,
              savedCad: image.saved_cad, workerReusable: image.worker_reusable});
            assert(publication.status === 'published' && publication.registered && publication.sourceWritten === false, 'visible_cache_not_published');
            checks[caseKey + '_cache_matches_reader'] = sha(thumbnailBytes(workspace, item.rel)) === image.sha256
              && sha(checkedBytes(path.join(workspace, '.phoenix/thumbnail-cache', image.sha256 + '.png'))) === image.sha256;
            bindings.push({rel: item.rel, workerId: session.identity.workerId, sessionId: session.identity.sessionId, jobId: input.jobId,
              source: before[item.rel], image: image.sha256});
            published.push(item.rel); entry.publication = publication; entry.visual_thumbnail_accepted = true;
          }
        }
        const observed = await session.client.get(input);
        checks[caseKey + '_same_job_query_stable'] = observed.state === job.state && observed.result?.sha256 === job.result?.sha256;
        const ready = await session.client.status();
        checks[caseKey + '_same_worker_reusable'] = ready.state === 'ready' && ready.active_job_id === null
          && ready.worker_id === session.identity.workerId && ready.session_id === session.identity.sessionId;
        results.push(entry);
        assert(checks[caseKey + '_same_worker_reusable'], 'worker_not_reusable');
      }
      // GUI appearance is authoritative when present. Removing it deliberately
      // selects native defaults; colors need not match that saved GUI material.
      checks.no_gui_and_actual_cmd_use_same_default_image = imageHashes['withoutGui.FCStd'] === imageHashes['CmdPlate.FCStd'];
      checks.gui_and_no_gui_plate_silhouettes_match = silhouettes['Plate.FCStd'] === silhouettes['withoutGui.FCStd']
        && silhouettes['Plate.FCStd'] === silhouettes['CmdPlate.FCStd'];
      checks.gui_and_actual_cmd_spacer_silhouettes_match = silhouettes['Spacer.FCStd'] === silhouettes['CmdSpacer.FCStd'];
      checks.distinct_cmd_geometries_have_distinct_images = imageHashes['CmdPlate.FCStd'] !== imageHashes['CmdSpacer.FCStd'];
      checks.distinct_gui_geometries_have_distinct_images = imageHashes['Plate.FCStd'] !== imageHashes['Spacer.FCStd'];
      checks.sources_unchanged_during_worker = Object.entries(before).every(([rel, value]) => sha(checkedBytes(path.join(workspace, rel))) === value);
    }, {onChildClose: (kind, proof) => closeEvents.push({kind, ...proof, resource_present: !!frozenRoot && fs.existsSync(frozenRoot)})});
    phase = 'post_close_verification';
    checks.both_actual_child_closes_before_release = closeEvents.length === 2 && closeEvents[0].kind === 'mcp' && closeEvents[1].kind === 'native'
      && closeEvents[1].pid === identity?.nativePid && closeEvents[0].pid !== closeEvents[1].pid && closeEvents.every(item => item.resource_present);
    checks.resource_released_after_actual_closes = !!frozenRoot && !fs.existsSync(frozenRoot);
    checks.all_sources_unchanged_after_close = Object.entries(before).every(([rel, value]) => sha(checkedBytes(path.join(workspace, rel))) === value);
    checks.cmd_original_sources_unchanged = cmdNames.every(rel => sha(checkedBytes(path.join(cmd.directory, rel))) === before[rel]);
    const staging = path.join(profile, 'runtime', 'thumbnail-input');
    checks.worker_staging_empty = !fs.existsSync(staging) || fs.readdirSync(staging).length === 0;
    const db = pnwCreateDb(path.join(workspace, '.phoenix/phoenix-workspace.sqlite'));
    try {
      const rows = db.all<{file_rel: string; worker_id: string; session_id: string; job_id: string; source_sha256: string; image_sha256: string; render_profile: string}>(
        'SELECT file_rel,worker_id,session_id,job_id,source_sha256,image_sha256,render_profile FROM desk_thumbnail_worker_publication');
      checks.only_visible_cases_registered = rows.length === published.length && rows.every(row => published.includes(row.file_rel))
        && [...hiddenFiles, ...rejectedFiles].every(rel => !rows.some(row => row.file_rel === rel));
      checks.publication_rows_match_exact_job_source_and_image = bindings.every(binding => rows.filter(row => row.file_rel === binding.rel
        && row.worker_id === binding.workerId && row.session_id === binding.sessionId && row.job_id === binding.jobId
        && row.source_sha256 === binding.source && row.image_sha256 === binding.image && row.render_profile === 'native-isometric-white-v1').length === 1);
      const gallery = db.all<{rel: string; source_hash: string; image_hash: string; width: number; height: number}>(
        'SELECT rel,source_hash,image_hash,width,height FROM desk_cad_thumbnail');
      checks.gallery_rows_match_only_visible_sources = gallery.length === new Set(published).size && gallery.every(row => published.includes(row.rel)
        && row.source_hash === before[row.rel] && row.image_hash === imageHashes[row.rel] && row.width === 128 && row.height === 128)
        && [...hiddenFiles, ...rejectedFiles].every(rel => !gallery.some(row => row.rel === rel));
    } finally { db.close(); }
  } catch (error) { failure = error; }
  checks.production_sources_unchanged = JSON.stringify(sources) === JSON.stringify(sourceHashes());
  const finalResource = loadPinnedResource(); checks.pinned_candidate_unchanged = finalResource.state === 'ready' && finalResource.resource.digest === loaded.resource.digest;
  const failedChecks = Object.keys(checks).filter(key => !checks[key]);
  const receipt = {state: !failure && !failedChecks.length ? 'passed' : 'blocked', sources, checks, failed_checks: failedChecks,
    resource: {digest: loaded.resource.digest, version: loaded.version}, workspace, before, seed: seedEvidence, results, close_events: closeEvents,
    phase, exception: failure instanceof Error ? {name: failure.name, message: failure.message, stack: failure.stack} : null,
    observations: {cmd_plate_matches_gui_bytes: imageHashes['CmdPlate.FCStd'] === imageHashes['Plate.FCStd'], cmd_spacer_matches_gui_bytes: imageHashes['CmdSpacer.FCStd'] === imageHashes['Spacer.FCStd'],
      removing_gui_preserves_image_bytes: imageHashes['withoutGui.FCStd'] === imageHashes['Plate.FCStd']},
    code: String((failure as {code?: string})?.code ?? (failure || failedChecks.length ? 'visibility_unverified' : 'verified'))};
  writeNew(path.join(artifact, 'visibility.json'), JSON.stringify(receipt, null, 2));
  if (receipt.state !== 'passed') throw Object.assign(new Error('Independent visibility QA not verified'), {code: 'visibility_unverified', artifact: path.basename(artifact)});
  return {state: receipt.state, checks, artifact: path.basename(artifact)};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--allow-native') { console.error('Exactly --allow-native and pinned candidate environment are required. No existing CAD input is accepted.'); process.exitCode = 2; }
  else verifyThumbnailWorkerVisibility().then(value => console.log(JSON.stringify(value))).catch(error => {
    const artifact = String(error?.artifact ?? ''); console.error(JSON.stringify({state: 'blocked', code: 'visibility_unverified',
      artifact: /^desk-worker-visibility-proof-[A-Za-z0-9-]+$/.test(artifact) ? artifact : null})); process.exitCode = 1;
  });
}
