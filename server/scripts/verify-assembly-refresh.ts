/** Manual, independent synthetic fixtures only. No input CAD or alternate gate scope is accepted.
 * pnpm -C server exec tsx scripts/verify-assembly-refresh.ts --allow-native
 * Receipts and generated FCStd remain in private temporary directories, never the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ASSEMBLY_NATIVE_BOOTSTRAP, runOwnedAssemblyNative } from '../src/features/assembly-maintenance/native-runner.js';
import { ASSEMBLY_NATIVE_PRESERVATION } from '../src/features/assembly-maintenance/native-preservation.js';

const PROGRAM = ASSEMBLY_NATIVE_BOOTSTRAP + ASSEMBLY_NATIVE_PRESERVATION + String.raw`
import Part
import JointObject
import UtilsAssembly
import hashlib

def phase(tag):
    with (root / 'phases.jsonl').open('a') as output:
        output.write(json.dumps({'phase': tag, 'module': __name__, 'documents': list(App.listDocuments())}) + '\n')
phase('begin')

def box(assembly, name, x):
    obj = assembly.newObject('Part::Box', name)
    obj.Length = 3
    obj.Width = 4
    obj.Height = 5
    obj.Placement = App.Placement(App.Vector(x, 2, 1), App.Rotation(App.Vector(0, 0, 1), 17))
    return obj

def assembly(doc):
    obj = doc.addObject('Assembly::AssemblyObject', 'Assembly')
    obj.newObject('Assembly::JointGroup', 'Joints')
    return obj

def link(assembly, source, name, rigid, x):
    obj = assembly.newObject('Assembly::AssemblyLink', name)
    obj.LinkedObject = source
    obj.Placement = App.Placement(App.Vector(x, 3, 7), App.Rotation(App.Vector(1, 0, 0), 11))
    obj.Rigid = rigid
    obj.recompute(False)
    return obj

leafdoc = App.newDocument('SyntheticLeaf')
leaf = assembly(leafdoc)
base = box(leaf, 'Base', 0)
keeper = box(leaf, 'Keeper', 10)
loose = box(leaf, 'Loose', 20)
joint = leafdoc.getObject('Joints').newObject('App::FeaturePython', 'JointKeep')
JointObject.Joint(joint, 0)
joint.Reference1 = (base, ['Face6', 'Vertex7'])
joint.Reference2 = (keeper, ['Face6', 'Vertex7'])
joint.Detach1 = True
joint.Detach2 = True
joint.Placement1 = App.Placement(App.Vector(1, 2, 3), App.Rotation(0, 0, 19))
joint.Placement2 = App.Placement(App.Vector(4, 5, 6), App.Rotation(0, 0, 23))
attached = leafdoc.getObject('Joints').newObject('App::FeaturePython', 'AttachedKeep')
JointObject.Joint(attached, 0)
attached.Reference1 = (base, ['Face6', 'Vertex7'])
attached.Reference2 = (keeper, ['Face6', 'Vertex7'])
attached.Placement1 = attached.Proxy.findPlacement(attached, attached.Reference1, 0)
attached.Placement2 = attached.Proxy.findPlacement(attached, attached.Reference2, 1)
assert not attached.Detach1 and not attached.Detach2
ground = leafdoc.getObject('Joints').newObject('App::FeaturePython', 'Grounded')
JointObject.GroundedJoint(ground, base)
leafdoc.recompute()
leafdoc.saveAs(str(root / 'Leaf.FCStd'))
phase('leaf-saved')
middoc = App.newDocument('SyntheticMiddle')
middle = assembly(middoc)
middoc.saveAs(str(root / 'Middle.FCStd'))
phase('middle-initial-save')
nested = link(middle, leaf, 'LeafInstance', False, 30)
middoc.recompute()
middoc.saveAs(str(root / 'Middle.FCStd'))
hostdoc = App.newDocument('SyntheticHost')
host = assembly(hostdoc)
hostdoc.saveAs(str(root / 'Host.FCStd'))
rigid = link(host, middle, 'RigidInstance', True, 50)
flex = link(host, middle, 'FlexibleInstance', False, 80)
anchor = box(host, 'HostAnchor', 100)
host_ground = hostdoc.getObject('Joints').newObject('App::FeaturePython', 'HostGrounded')
JointObject.GroundedJoint(host_ground, anchor)
hostdoc.recompute()
phase('host-created')

for obj in hostdoc.Objects:
    if obj.TypeId == 'Assembly::AssemblyLink' or hasattr(obj, 'JointType') or hasattr(obj, 'ObjectToGround'):
        obj.addProperty('App::PropertyString', 'SyntheticUserNote', 'Synthetic proof')
        obj.SyntheticUserNote = 'independently-authored:' + obj.Name
hostdoc.save()
tracked_properties = {obj.Name: ['SyntheticUserNote'] for obj in hostdoc.Objects if 'SyntheticUserNote' in obj.PropertiesList}
if spec['payload'].get('kind') in ('seed-compound-joint', 'seed-connected-deletion'):
    if spec['payload']['kind'] == 'seed-compound-joint':
        compound = hostdoc.getObject('Joints').newObject('App::FeaturePython', 'CompoundReference')
        JointObject.Joint(compound, 0)
        compound.Reference1 = (rigid, ['Face6', 'Vertex7'])
        compound.Reference2 = (anchor, ['Face6', 'Vertex7'])
        compound.Detach1 = True
        compound.Detach2 = True
        hostdoc.save()
        leafdoc.removeObject(loose.Name)
        box(leaf, 'Added', 40)
    else:
        leafdoc.removeObject(keeper.Name)
    leafdoc.save()
    finish({'state': 'seeded', 'fixture_directory': str(root)})
    for name in list(App.listDocuments()):
        App.closeDocument(name)
    raise SystemExit(0)
before = observe_assembly_document(hostdoc, tracked_properties)
assert_assembly_frame_storage_consistent(before)
phase('before-observed')
identities = {obj.Name: obj for obj in hostdoc.Objects}
if spec['payload'].get('kind') == 'connected-deletion':
    host_bytes = (root / 'Host.FCStd').read_bytes()
    candidates = sorted(name for name in before['objects'] if name.startswith('Keeper'))
    leafdoc.removeObject(keeper.Name)
    leafdoc.save()
    blocked = False
    try:
        guard_assembly_removals(before, candidates)
    except AssertionError as error:
        blocked = str(error) == 'connected_component_deletion'
    assert blocked and len(candidates) == 2, 'connected_deletion_not_blocked'
    grounded_blocked = False
    try:
        guard_assembly_removals(before, ['HostAnchor'])
    except AssertionError as error:
        grounded_blocked = str(error) == 'connected_component_deletion'
    assert grounded_blocked, 'grounded_deletion_not_blocked'
    assert (root / 'Host.FCStd').read_bytes() == host_bytes, 'host_changed_after_rejection'
    finish({'state': 'passed', 'kind': 'connected-deletion', 'checks': {
        'real_source_component_deleted': leafdoc.getObject('Keeper') is None,
        'connected_delete_blocked': blocked, 'host_bytes_unchanged': True,
        'grounded_component_delete_blocked': grounded_blocked,
        'update_calls_after_rejection': 0, 'no_joint_deleted_to_repair': True}})
    for name in list(App.listDocuments()):
        App.closeDocument(name)
    raise SystemExit(0)
leafdoc.removeObject(loose.Name)
added = box(leaf, 'Added', 40)
leafdoc.recompute()
leafdoc.save()
def fingerprints():
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in ('Leaf.FCStd', 'Middle.FCStd')}
dependencies = fingerprints()
phase('source-mutated')
if spec['payload'].get('kind') == 'seed-only':
    finish({'state': 'seeded', 'fixture_directory': str(root)})
    for name in list(App.listDocuments()):
        App.closeDocument(name)
    raise SystemExit(0)
# Only the explicitly targeted native object path is used, never a Rigid flip.
calls = refresh_assembly_links([middoc, hostdoc])
after = observe_assembly_document(hostdoc, tracked_properties)
assert_assembly_frame_storage_consistent(after)
phase('after-observed')
removed = sorted(set(before['objects']) - set(after['objects']))
inserted = sorted(set(after['objects']) - set(before['objects']))
changed = sorted(name for name in set(before['objects']) & set(after['objects'])
                 if before['objects'][name] != after['objects'][name])
identity_changed = sorted(name for name in set(before['objects']) & set(after['objects'])
                          if hostdoc.getObject(name) is not identities[name])
checks = {'source_add_propagated': inserted == ['Added', 'Added001'],
          'source_delete_propagated': removed == ['Loose', 'Loose001'],
          'surviving_objects_preserved': not changed,
          'surviving_identity_preserved': not identity_changed,
          'all_joints_preserved': before['joints'] == after['joints'],
          'non_detached_actual_and_stored_frames_equal': True,
          'grounded_joint_present_and_preserved': any(value['type'] == 'Grounded' for value in before['joints'].values()) and before['joints'] == after['joints'],
          'joint_groups_preserved': before['joint_groups'] == after['joint_groups'],
          'dependency_bytes_unchanged': dependencies == fingerprints(),
          'solve_disabled': not App.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly').GetBool('SolveOnRecompute', True)}
# A dangerous source deletion is preflighted by the saved/live endpoint topology.
# Do not actually delete a connected part, delete a Joint or repair/reconnect anything.
connected = {value[key][0] for value in before['joints'].values() if value['type'] != 'Grounded' for key in ('reference1', 'reference2')}
checks['connected_delete_blocked'] = 'Keeper' in connected and 'Keeper001' in connected
if all(checks.values()):
    assert_assembly_preserved(before, after, removed)
    hostdoc.save()
    (root / 'expected.json').write_text(json.dumps({'state': after, 'tracked_properties': tracked_properties}))
finish({'state': 'passed' if all(checks.values()) else 'blocked', 'freecad': App.Version(),
        'checks': checks, 'removed': removed, 'inserted': inserted, 'changed': changed,
        'identity_changed': identity_changed, 'before': before, 'after': after,
        'recompute_calls': calls,
        'sources': {'leaf_name': leaf.Document.Name, 'linked_leaf_name': nested.LinkedObject.Document.Name,
                    'leaf_group': [x.Name for x in leaf.Group], 'linked_group': [x.Name for x in nested.LinkedObject.Group],
                    'middle_group': [x.Name for x in nested.Group],
                    'documents': list(App.listDocuments())},
        'dependency_hashes': dependencies, 'fixture_directory': str(root)})
for name in list(App.listDocuments()):
    App.closeDocument(name)
`;

const REOPEN = ASSEMBLY_NATIVE_BOOTSTRAP + ASSEMBLY_NATIVE_PRESERVATION + String.raw`
import JointObject, hashlib, zipfile
fixture = Path(spec['payload']['fixture_directory'])
assert fixture.is_absolute() and fixture.name.startswith('desk-assembly-proof-')
expected = json.loads((fixture / 'expected.json').read_text())
def hashes():
    return {name: hashlib.sha256((fixture / name).read_bytes()).hexdigest()
            for name in ('Leaf.FCStd', 'Middle.FCStd', 'Host.FCStd')}
before_hashes = hashes()
with zipfile.ZipFile(fixture / 'Host.FCStd') as archive:
    before_xml = archive.read('Document.xml')
doc = App.openDocument(str(fixture / 'Host.FCStd'))
actual = observe_assembly_document(doc, expected['tracked_properties'])
assert_assembly_frame_storage_consistent(actual)
checks = {'independent_reopen_exact_native_state': actual == expected['state'],
          'all_saved_dependency_and_host_bytes_unchanged': hashes() == before_hashes,
          'joints_and_frames_equal': actual['joints'] == expected['state']['joints'],
          'joint_groups_equal': actual['joint_groups'] == expected['state']['joint_groups']}
with zipfile.ZipFile(fixture / 'Host.FCStd') as archive:
    checks['saved_xml_unchanged'] = archive.read('Document.xml') == before_xml
finish({'state': 'passed' if all(checks.values()) else 'blocked', 'kind': 'independent-reopen',
        'checks': checks, 'actual': actual, 'expected': expected['state']})
for name in list(App.listDocuments()):
    App.closeDocument(name)
`;

const CODE_FILES = ['server/scripts/verify-assembly-refresh.ts',
  'server/src/features/assembly-maintenance/native-runner.ts',
  'server/src/features/assembly-maintenance/native-preservation.ts',
  'server/src/features/drawing-research/executionGate.ts',
  'server/src/features/cad-native-measurement/host-barrier.ts',
  'server/src/lib/deskToolsRegistration.ts', 'server/src/lib/freecadProcessSecurity.ts'] as const;
function sourceDigests() {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  return Object.fromEntries(CODE_FILES.map(name => {
    const filename = path.join(repository, name), st = fs.lstatSync(filename);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 1024 * 1024) throw new Error('unsafe_proof_source');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { return [name, createHash('sha256').update(fs.readFileSync(fd)).digest('hex')]; } finally { fs.closeSync(fd); }
  }));
}

/** Public independent geometry only; intentionally leaves the saved host stale. */
export async function createSyntheticAssemblyRefreshFixture(kind: 'unreferenced' | 'compound' | 'connected' = 'unreferenced') {
  return runOwnedAssemblyNative({ freecadHome: '/Applications/FreeCAD.app', stage: 'proof', script: PROGRAM,
    spec: { kind: kind === 'compound' ? 'seed-compound-joint' : kind === 'connected' ? 'seed-connected-deletion' : 'seed-only' }, timeoutMs: 180_000 });
}

export async function verifyAssemblyRefresh() {
  const sources = sourceDigests();
  const result = await runOwnedAssemblyNative({ freecadHome: '/Applications/FreeCAD.app', stage: 'proof', script: PROGRAM, spec: {}, timeoutMs: 180_000 });
  fs.writeFileSync(path.join(result.directory, 'host-receipt.json'), JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' });
  if (result.receipt.state !== 'passed') return { state: 'blocked', artifacts: path.basename(result.directory), checks: result.receipt.checks };
  const reopen = await runOwnedAssemblyNative({ freecadHome: '/Applications/FreeCAD.app', stage: 'reopen', script: REOPEN,
    spec: { fixture_directory: result.directory }, timeoutMs: 180_000 });
  fs.writeFileSync(path.join(reopen.directory, 'host-receipt.json'), JSON.stringify(reopen, null, 2), { mode: 0o600, flag: 'wx' });
  const negative = await runOwnedAssemblyNative({ freecadHome: '/Applications/FreeCAD.app', stage: 'proof', script: PROGRAM,
    spec: { kind: 'connected-deletion' }, timeoutMs: 180_000 });
  fs.writeFileSync(path.join(negative.directory, 'host-receipt.json'), JSON.stringify(negative, null, 2), { mode: 0o600, flag: 'wx' });
  const rows = [result, reopen, negative];
  const sourceUnchanged = JSON.stringify(sources) === JSON.stringify(sourceDigests());
  fs.writeFileSync(path.join(result.directory, 'complete-receipt.json'), JSON.stringify({ sources, source_unchanged: sourceUnchanged,
    runs: rows.map(row => ({ artifact: path.basename(row.directory), receipt: row.receipt, proof: row.proof })) }, null, 2), { mode: 0o600, flag: 'wx' });
  return { state: sourceUnchanged && rows.every(row => row.receipt.state === 'passed') ? 'passed' : 'blocked',
    source_unchanged: sourceUnchanged,
    artifacts: rows.map(row => path.basename(row.directory)), checks: rows.map(row => row.receipt.checks),
    proofs: rows.map(row => row.proof) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(' ') !== '--allow-native') {
    console.error('Explicit --allow-native is required; no input CAD or scope override is accepted.'); process.exitCode = 2;
  } else {
    verifyAssemblyRefresh().then(result => { console.log(JSON.stringify(result)); if (result.state !== 'passed') process.exitCode = 1; }).catch(error => {
      console.error(JSON.stringify({ state: 'failed', code: typeof error?.code === 'string' ? error.code : 'unverified_native_failure' })); process.exitCode = 1;
    });
  }
}
