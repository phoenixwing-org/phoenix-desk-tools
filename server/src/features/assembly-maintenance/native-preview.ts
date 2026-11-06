import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import type { AssemblyNativePreviewInput, AssemblyNativePreviewResult, AssemblyUpdatePorts } from './updates.js';
import { ASSEMBLY_NATIVE_BOOTSTRAP, runOwnedAssemblyNative } from './native-runner.js';
import { ASSEMBLY_NATIVE_PRESERVATION } from './native-preservation.js';
import { safeFcstdPath } from '../../lib/fcstdBatchFiles.js';
import { accumulateAssemblyClosurePayload, AssemblyArchiveError, readAssemblyArchive, readStableAssemblyFile } from './native-archive.js';
import { decodeCadXmlAttribute } from '../cad-object-info/document.js';

export class AssemblyNativePreviewError extends Error {
  readonly code = 'manual_required';
  constructor(readonly reason: string) { super('原生镜像未能证明装配安全，原件保持不变'); this.name = 'AssemblyNativePreviewError'; }
}
const fail = (reason: string): never => { throw new AssemblyNativePreviewError(reason); };
const digest = (value: Buffer | Uint8Array | string) => createHash('sha256').update(value).digest('hex');

/** Runtime dumpContent uses the same persistence serializer without saving a
 * dependency. Every pre-open saved property remains a guard, including unknown
 * user metadata; only narrowly named serializer bookkeeping is normalized. */
const GUARDS = String.raw`
import hashlib, io, zipfile, math, xml.etree.ElementTree as ET, sys
import JointObject
assert tuple(App.Version()[:3]) == ('1', '1', '0') and App.Version()[-1] == '34a9716668b1ddeb55b914f1c5be644826bdbbbf', 'unvalidated_freecad_build'
program_input = spec['payload']
assert hashlib.sha256(program_input['plan_json'].encode('utf8')).hexdigest() == program_input['plan_digest'], 'plan_digest_mismatch'
payload = json.loads(program_input['plan_json'])
payload['plan_digest'] = program_input['plan_digest']
if 'expected_json' in program_input:
    assert hashlib.sha256(program_input['expected_json'].encode('utf8')).hexdigest() == program_input['expected_digest'], 'expected_digest_mismatch'
    frozen_expected = json.loads(program_input['expected_json'])
    payload['expected_native'] = frozen_expected['native']
    payload['expected_xml'] = frozen_expected['xml']
    payload['expected_digest'] = program_input['expected_digest']
    for row in payload['files']:
        if row['rel'] == payload['hostRel']:
            row['sha256'] = frozen_expected['staged_sha256']
mirror = Path(payload['mirrorRoot']).resolve()
assert mirror.is_dir() and not mirror.is_symlink(), 'unsafe_mirror'
files = {row['rel']: row for row in payload['files']}
assert len(files) == len(payload['files']) and payload['hostRel'] in files, 'incomplete_mirror'
def file_path(rel):
    assert rel in files, 'unfrozen_file'
    location = mirror / rel
    assert location.resolve().is_relative_to(mirror) and not location.is_symlink(), 'outside_mirror'
    return location
def file_hash(rel):
    return hashlib.sha256(file_path(rel).read_bytes()).hexdigest()
for rel, row in files.items():
    assert file_hash(rel) == row['sha256'], 'mirror_bytes_changed'
def parsed(data):
    result = ET.fromstring(data)
    if result.tag == 'Content':
        result = result.find('Document')
    assert result is not None and result.tag == 'Document', 'unknown_document_serialization'
    return result
resource_sets = {}
shape_digest_cache = {}
def saved_xml(rel):
    with zipfile.ZipFile(file_path(rel)) as archive:
        document = parsed(archive.read('Document.xml'))
        resource_sets[id(document)] = {name: archive.read(name) for name in archive.namelist() if name != 'Document.xml'}
        return document
def runtime_xml(doc):
    archive_bytes = doc.dumpContent()
    assert len(archive_bytes) <= 64 * 1024 * 1024, 'runtime_dump_limit'
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        document = parsed(archive.read('Persistence.xml'))
        resource_sets[id(document)] = {name: archive.read(name) for name in archive.namelist() if name != 'Persistence.xml'}
        return document
def shape_digest(filename, resources):
    assert filename in resources and '/' not in filename and '\\' not in filename, 'unknown_shape_member'
    data = resources[filename]
    key = hashlib.sha256(data).hexdigest() + Path(filename).suffix
    if key not in shape_digest_cache:
        shape = Part.Shape()
        if filename.endswith('.brp'):
            shape.importBrepFromString(data.decode('ascii'))
        elif filename.endswith('.bin'):
            temporary = root / ('shape-' + hashlib.sha256(data).hexdigest() + '.bin')
            if not temporary.exists():
                with temporary.open('xb') as output:
                    output.write(data)
            shape.importBinary(str(temporary))
        else:
            raise AssertionError('unknown_shape_encoding')
        assert not shape.isNull() and shape.isValid(), 'invalid_saved_shape'
        shape_digest_cache[key] = hashlib.sha256(shape.exportBrepToString().encode('ascii')).hexdigest()
    return shape_digest_cache[key]
def norm_element(element, rel, resources):
    attrs = dict(element.attrib)
    if element.tag == 'Property' and 'status' in attrs:
        value = int(attrs['status']) & ~1  # FreeCAD's transient Touched flag only.
        if value:
            attrs['status'] = str(value)
        else:
            del attrs['status']
    if element.tag == 'XLink':
        attrs.pop('stamp', None)  # target save timestamp, not target identity.
        target = attrs.get('file', '')
        if target:
            target_path = (mirror / Path(rel).parent / target).resolve()
            assert target_path.is_relative_to(mirror), 'external_native_reference'
            target_rel = target_path.relative_to(mirror).as_posix()
            assert target_rel in files, 'unfrozen_native_reference'
            attrs['file'] = target_rel
    if element.tag == 'PropertyPlacement':
        # Axis/angle is derived and non-unique; quaternion/translation is the
        # complete placement. Never normalize arbitrary user float properties.
        for key in ('A', 'Ox', 'Oy', 'Oz'):
            attrs.pop(key, None)
        for key in ('Px', 'Py', 'Pz', 'Q0', 'Q1', 'Q2', 'Q3'):
            assert key in attrs and math.isfinite(float(attrs[key])), 'unknown_placement'
            attrs[key] = str(round(float(attrs[key]), 10))
    if element.tag == 'Part' and 'file' in attrs:
        # dumpContent is binary BRep even when save() uses text BRep. Parse both
        # with the same installed kernel and compare canonical geometry bytes.
        attrs['file'] = 'canonical-brep-sha256:' + shape_digest(attrs['file'], resources)
    if element.tag in ('PlacementList', 'VectorList') and 'file' in attrs:
        member = attrs['file']
        assert member in resources, 'missing_native_list_member'
        attrs['file'] = 'member-sha256:' + hashlib.sha256(resources[member]).hexdigest()
    text = element.text or ''
    if list(element) and not text.strip():
        text = ''  # Structural indentation only; leaf/mixed user text is exact.
    tail = element.tail or ''
    if not tail.strip():
        tail = ''  # Serialization indentation between siblings only.
    return [element.tag, [[key, value] for key, value in sorted(attrs.items())], text,
            [norm_element(child, rel, resources) for child in element], tail]
def properties(node, rel, resources):
    result = {}
    for prop in node.findall('./Properties/Property'):
        name = prop.get('name')
        assert name and name not in result, 'duplicate_native_property'
        result[name] = norm_element(prop, rel, resources)
    return result
def xml_state(document, rel):
    resources = resource_sets[id(document)]
    declared = {obj.get('name'): obj.get('type') for obj in document.findall('./Objects/Object')}
    result = {}
    for obj in document.findall('./ObjectData/Object'):
        name = obj.get('name')
        assert name in declared and name not in result, 'unknown_native_object'
        result[name] = {'type': declared[name], 'attributes': dict(obj.attrib),
            'extensions': [norm_element(child, rel, resources) for child in obj if child.tag != 'Properties'],
            'properties': properties(obj, rel, resources)}
    assert len(result) == len(declared), 'missing_native_object'
    attrs = dict(document.attrib)
    attrs.pop('ProgramVersion', None)  # serializer build metadata, not user data.
    return {'attributes': attrs, 'properties': properties(document, rel, resources), 'objects': result}
saved_documents = {rel: saved_xml(rel) for rel in files}
saved = {rel: xml_state(document, rel) for rel, document in saved_documents.items()}
def group_names(document, name):
    obj = next((o for o in document.findall('./ObjectData/Object') if o.get('name') == name), None)
    assert obj is not None, 'missing_group_owner'
    return [link.get('value') for link in obj.findall('./Properties/Property[@name="Group"]/LinkList/Link')]
def linked_identity(document, rel, name):
    obj = next((o for o in document.findall('./ObjectData/Object') if o.get('name') == name), None)
    assert obj is not None, 'missing_link_owner'
    link = obj.find('./Properties/Property[@name="LinkedObject"]/XLink')
    assert link is not None and not list(link), 'unknown_link_source'
    filename = link.get('file', '')
    target = (mirror / Path(rel).parent / filename).resolve() if filename else file_path(rel)
    assert target.is_relative_to(mirror), 'external_link_source'
    target_rel = target.relative_to(mirror).as_posix()
    assert target_rel in files, 'unfrozen_link_source'
    return target_rel, link.get('name')
authorized = {rel: set() for rel in files}
pending = [(payload['hostRel'], name) for name in payload['selectedObjects']]
while pending:
    rel, name = pending.pop()
    if name in authorized[rel]:
        continue
    assert saved[rel]['objects'].get(name, {}).get('type') == 'Assembly::AssemblyLink', 'invalid_authorized_instance'
    authorized[rel].add(name)
    for child in group_names(saved_documents[rel], name):
        if saved[rel]['objects'][child]['type'] == 'Assembly::AssemblyLink':
            pending.append((rel, child))
    target_rel, target_name = linked_identity(saved_documents[rel], rel, name)
    target_type = saved[target_rel]['objects'].get(target_name, {}).get('type')
    if target_type == 'Assembly::AssemblyLink':
        pending.append((target_rel, target_name))
    elif target_type == 'Assembly::AssemblyObject':
        for child in group_names(saved_documents[target_rel], target_name):
            if saved[target_rel]['objects'][child]['type'] == 'Assembly::AssemblyLink':
                pending.append((target_rel, child))
    else:
        raise AssertionError('unknown_assembly_source')
stale = {rel: {row['objectName']: row for row in payload['staleDerivedLinks'] if row['sourceRel'] == rel} for rel in files}

# Observe and block Python entry points. Native-internal automatic C++ solves
# are disabled by private preferences, not claimed to be instrumented.
solver_observations = []
def blocked_solve(*args, **kwargs):
    solver_observations.append('python_solve_entry')
    raise AssertionError('solver_call_blocked')
def solve_profile(frame, event, arg):
    if event == 'c_call' and getattr(arg, '__name__', '') == 'solve':
        target = getattr(arg, '__self__', None)
        if str(getattr(target, 'TypeId', '')).startswith('Assembly::'):
            solver_observations.append('native_solve_entry')
            raise AssertionError('solver_call_blocked')
assert sys.getprofile() is None, 'preexisting_profile'
JointObject.Joint.preSolve = blocked_solve
JointObject.solveIfAllowed = blocked_solve
sys.setprofile(solve_profile)
def solver_quiet():
    assert sys.getprofile() is solve_profile and not solver_observations, 'solver_observer_changed'
    prefs = App.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly')
    assert not prefs.GetBool('SolveOnRecompute', True) and not prefs.GetBool('SolveInJointCreation', True), 'solver_preferences_changed'
def reject_compound_joint_references(doc):
    for obj in doc.Objects:
        if not hasattr(obj, 'JointType'):
            continue
        for reference in (obj.Reference1, obj.Reference2):
            assert UtilsAssembly.isRefValid(reference, 2), 'invalid_joint_reference'
            target = UtilsAssembly.getObject(reference)
            assert target is not None, 'missing_joint_reference_object'
            assert target.TypeId not in ('Assembly::AssemblyLink', 'Assembly::AssemblyObject', 'App::Part'), 'compound_joint_actual_frame_unknown'
            if target.TypeId == 'App::Link':
                linked = target.getLinkedObject()
                assert linked is not None and linked.TypeId not in ('Assembly::AssemblyLink', 'Assembly::AssemblyObject', 'App::Part'), 'compound_joint_actual_frame_unknown'

def compare_xml(before, after, rel, final=False, allow_differences=True):
    assert before['attributes'] == after['attributes'], 'document_serializer_changed'
    doc_before, doc_after = dict(before['properties']), dict(after['properties'])
    if final and rel == payload['hostRel']:
        def normalized_save_date(value):
            copy = json.loads(json.dumps(value))
            assert dict(copy[1]).get('type') == 'App::PropertyString' and len(copy[3]) == 1 and copy[3][0][0] == 'String', 'unknown_modified_date_serializer'
            attrs = dict(copy[3][0][1])
            from datetime import datetime
            assert isinstance(attrs.get('value'), str) and len(attrs['value']) <= 128, 'unknown_modified_date_value'
            datetime.fromisoformat(attrs['value'])
            attrs['value'] = '<native-save-timestamp>'
            copy[3][0][1] = [[key, value] for key, value in sorted(attrs.items())]
            return copy
        assert ('LastModifiedDate' in doc_before) == ('LastModifiedDate' in doc_after), 'modified_date_schema_changed'
        if 'LastModifiedDate' in doc_before:
            doc_before['LastModifiedDate'] = normalized_save_date(doc_before['LastModifiedDate'])
            doc_after['LastModifiedDate'] = normalized_save_date(doc_after['LastModifiedDate'])
    assert doc_before == doc_after, 'document_user_properties_changed'
    removed = sorted(set(before['objects']) - set(after['objects']))
    added = sorted(set(after['objects']) - set(before['objects']))
    if not allow_differences:
        assert not added and not removed, 'reopen_object_set_changed'
    assert set(removed) <= set(stale[rel]), 'unauthorized_object_deletion'
    for name in removed:
        assert before['objects'][name]['type'] == 'App::Link', 'non_derived_deletion'
    for name in set(before['objects']) & set(after['objects']):
        a, b = before['objects'][name], after['objects'][name]
        assert a['type'] == b['type'] and a['attributes'] == b['attributes'] and a['extensions'] == b['extensions'] and set(a['properties']) == set(b['properties']), 'object_identity_or_property_schema_changed'
        for prop in a['properties']:
            if prop == 'Group' and name in authorized[rel] and allow_differences:
                def members(value):
                    assert value[0] == 'Property' and len(value[3]) == 1 and value[3][0][0] == 'LinkList', 'unknown_group_serializer'
                    links = value[3][0][3]
                    assert all(link[0] == 'Link' and not link[3] for link in links), 'unknown_group_member'
                    return [dict(link[1])['value'] for link in links]
                old_members, new_members = members(a['properties'][prop]), members(b['properties'][prop])
                assert len(set(new_members)) == len(new_members), 'duplicate_group_member'
                assert [x for x in old_members if x not in removed] == [x for x in new_members if x not in added], 'surviving_group_membership_changed'
                def without_delta(value, excluded):
                    copy = json.loads(json.dumps(value))
                    container = copy[3][0]
                    attrs = dict(container[1])
                    assert attrs.get('count', '').isdigit() and int(attrs['count']) == len(container[3]), 'group_count_invalid'
                    container[3] = [link for link in container[3] if dict(link[1])['value'] not in excluded]
                    attrs['count'] = str(len(container[3]))
                    container[1] = [[key, value] for key, value in sorted(attrs.items())]
                    return copy
                assert without_delta(a['properties'][prop], removed) == without_delta(b['properties'][prop], added), 'group_serializer_metadata_changed'
                continue
            if a['properties'][prop] != b['properties'][prop]:
                (root / 'guard-difference.json').write_text(json.dumps({'rel': rel, 'object': name, 'property': prop,
                    'before': a['properties'][prop], 'after': b['properties'][prop]}))
                raise AssertionError('saved_object_property_changed:' + name + ':' + prop)
    return added, removed

def validate_added(document, state, rel, names, require_complete=False):
    for name in names:
        assert state['objects'][name]['type'] == 'App::Link', 'unsupported_new_native_type'
        owners = [o.get('name') for o in document.findall('./ObjectData/Object')
                  if name in group_names(document, o.get('name'))]
        assert len(owners) == 1 and owners[0] in authorized[rel], 'new_object_outside_selection'
        source_rel, source_name = linked_identity(document, rel, owners[0])
        seen = set()
        while saved[source_rel]['objects'][source_name]['type'] == 'Assembly::AssemblyLink':
            assert (source_rel, source_name) not in seen, 'assembly_source_cycle'
            seen.add((source_rel, source_name))
            source_rel, source_name = linked_identity(saved_documents[source_rel], source_rel, source_name)
        assert saved[source_rel]['objects'][source_name]['type'] == 'Assembly::AssemblyObject', 'unknown_new_object_source'
        target_rel, target_name = linked_identity(document, rel, name)
        allowed_targets = []
        for child in group_names(saved_documents[source_rel], source_name):
            child_type = saved[source_rel]['objects'][child]['type']
            if child_type in ('Assembly::AssemblyLink', 'Assembly::JointGroup', 'App::FeaturePython'):
                continue
            allowed_targets.append(linked_identity(saved_documents[source_rel], source_rel, child) if child_type == 'App::Link' else (source_rel, child))
        assert (target_rel, target_name) in allowed_targets, 'new_object_not_derived_from_source'
    # Exact multiplicity, not merely membership: an extra duplicate derived
    # target cannot be mistaken for the intended new source component.
    from collections import Counter
    for owner in authorized[rel]:
        source_rel, source_name = linked_identity(document, rel, owner)
        trail = set()
        while saved[source_rel]['objects'][source_name]['type'] == 'Assembly::AssemblyLink':
            assert (source_rel, source_name) not in trail, 'assembly_source_cycle'
            trail.add((source_rel, source_name))
            source_rel, source_name = linked_identity(saved_documents[source_rel], source_rel, source_name)
        expected_targets = []
        for child in group_names(saved_documents[source_rel], source_name):
            child_type = saved[source_rel]['objects'][child]['type']
            if child_type in ('Assembly::AssemblyLink', 'Assembly::JointGroup', 'App::FeaturePython'):
                continue
            expected_targets.append(linked_identity(saved_documents[source_rel], source_rel, child) if child_type == 'App::Link' else (source_rel, child))
        actual_targets = [linked_identity(document, rel, child) for child in group_names(document, owner) if state['objects'][child]['type'] == 'App::Link']
        # Opening-before may still contain the proved stale links. The final
        # validation below is called again after refresh and requires exactness.
        if require_complete:
            assert Counter(actual_targets) == Counter(expected_targets), 'derived_source_membership_incomplete_or_duplicate'
    return True

def load_mirror():
    # Dependency-first order is explicit; cyclic source files are manual.
    order, visiting, visited = [], set(), set()
    def visit(rel):
        if rel in visited:
            return
        assert rel not in visiting, 'cyclic_file_dependencies'
        visiting.add(rel)
        for row in payload['links']:
            if row['sourceRel'] == rel and row['targetRel'] != rel:
                visit(row['targetRel'])
        visiting.remove(rel)
        visited.add(rel)
        order.append(rel)
    visit(payload['hostRel'])
    assert set(order) == set(files), 'incomplete_file_order'
    documents = {}
    for rel in order:
        existing = next((doc for doc in App.listDocuments().values() if os.path.realpath(doc.FileName) == str(file_path(rel))), None)
        documents[rel] = existing or App.openDocument(str(file_path(rel)))
        assert os.path.realpath(documents[rel].FileName) == str(file_path(rel)), 'wrong_document_opened'
        assert all(os.path.realpath(doc.FileName) in {str(file_path(name)) for name in files} for doc in App.listDocuments().values()), 'native_opened_outside_mirror'
    return order, documents
`;

const UPDATE = ASSEMBLY_NATIVE_BOOTSTRAP + ASSEMBLY_NATIVE_PRESERVATION + GUARDS + String.raw`
order, documents = load_mirror()
opening, opening_native, opening_identities = {}, {}, {}
for rel in order:
    runtime = runtime_xml(documents[rel])
    opening[rel] = xml_state(runtime, rel)
    added, removed = compare_xml(saved[rel], opening[rel], rel)
    validate_added(runtime, opening[rel], rel, added)
    reject_compound_joint_references(documents[rel])
    opening_native[rel] = observe_assembly_document(documents[rel])
    opening_identities[rel] = {obj.Name: obj for obj in documents[rel].Objects}
    assert_assembly_frame_storage_consistent(opening_native[rel])
    guard_assembly_removals(opening_native[rel], set(stale[rel]))
solver_quiet()
calls = refresh_assembly_links([documents[rel] for rel in order],
    {documents[rel].Name: sorted(authorized[rel]) for rel in order})
after_native, final_xml, added_rows, removed_rows = {}, {}, [], []
for rel in order:
    document = runtime_xml(documents[rel])
    final_xml[rel] = xml_state(document, rel)
    added, removed = compare_xml(saved[rel], final_xml[rel], rel)
    validate_added(document, final_xml[rel], rel, added, require_complete=True)
    assert set(removed) == set(stale[rel]), 'stale_copy_not_removed'
    after_native[rel] = observe_assembly_document(documents[rel])
    for name in set(opening_identities[rel]) & set(after_native[rel]['objects']):
        assert documents[rel].getObject(name) is opening_identities[rel][name], 'surviving_native_identity_changed'
    assert_assembly_frame_storage_consistent(after_native[rel])
    # Opening-before saved XML, not post-open identity, controls object changes.
    already_removed = set(opening_native[rel]['objects']) - set(after_native[rel]['objects'])
    assert_assembly_preserved(opening_native[rel], after_native[rel], already_removed)
    if rel == payload['hostRel']:
        for name, kind in [(name, 'added') for name in added] + [(name, 'removed') for name in removed]:
            value = final_xml[rel]['objects'].get(name) or saved[rel]['objects'][name]
            label = documents[rel].getObject(name).Label if kind == 'added' else payload['labels'].get(name, name)
            if kind == 'added':
                parents = [o.get('name') for o in document.findall('./ObjectData/Object') if name in group_names(document, o.get('name'))]
                parent = parents[0]
            else:
                parent = stale[rel][name]['ownerObjectName']
            row = {'object_name': name, 'label': label, 'type_id': value['type'], 'parent_object': parent}
            (added_rows if kind == 'added' else removed_rows).append(row)
for rel in files:
    assert file_hash(rel) == files[rel]['sha256'], 'mirror_write_before_host_save'
solver_quiet()
host = documents[payload['hostRel']]
host.save()
for rel in files:
    if rel != payload['hostRel']:
        assert file_hash(rel) == files[rel]['sha256'], 'dependency_file_written'
saved_after = xml_state(saved_xml(payload['hostRel']), payload['hostRel'])
compare_xml(saved[payload['hostRel']], saved_after, payload['hostRel'], final=True)
runtime_after_save = xml_state(runtime_xml(host), payload['hostRel'])
assert runtime_after_save == saved_after, 'saved_host_runtime_mismatch'
solver_quiet()
finish({'state': 'verified', 'plan_digest': payload['plan_digest'], 'added': added_rows, 'removed': removed_rows,
    'expected_native': {**opening_native, payload['hostRel']: after_native[payload['hostRel']]},
    'expected_xml': {**opening, payload['hostRel']: saved_after},
    'preserved_joint_count': len(after_native[payload['hostRel']]['joints']),
    'preserved_instance_count': sum('rigid' in value for value in after_native[payload['hostRel']]['objects'].values()),
    'engine_version': '.'.join(App.Version()[:3]) + ':' + App.Version()[-1],
    'solver_observations': solver_observations, 'recompute_calls': calls})
for name in list(App.listDocuments()):
    App.closeDocument(name)
sys.setprofile(None)
`;

const REOPEN = ASSEMBLY_NATIVE_BOOTSTRAP + ASSEMBLY_NATIVE_PRESERVATION + GUARDS + String.raw`
App.openDocument(str(file_path(payload['hostRel'])))
documents = {}
for doc in App.listDocuments().values():
    filename = Path(doc.FileName).resolve()
    assert filename.is_relative_to(mirror), 'native_opened_outside_mirror'
    rel = filename.relative_to(mirror).as_posix()
    assert rel in files and rel not in documents, 'unfrozen_native_document'
    documents[rel] = doc
assert set(documents) == set(files), 'independent_reopen_incomplete_closure'
for rel in files:
    reject_compound_joint_references(documents[rel])
    actual_xml = xml_state(runtime_xml(documents[rel]), rel)
    if actual_xml != payload['expected_xml'][rel]:
        (root / 'reopen-difference.json').write_text(json.dumps({'rel': rel, 'expected': payload['expected_xml'][rel], 'actual': actual_xml}))
        raise AssertionError('independent_reopen_raw_property_change')
    actual = observe_assembly_document(documents[rel])
    assert_assembly_frame_storage_consistent(actual)
    assert actual == payload['expected_native'][rel], 'independent_reopen_native_state_change'
    assert file_hash(rel) == files[rel]['sha256'], 'independent_reopen_wrote_file'
host = documents[payload['hostRel']]
# A normal selected top-level recompute must not roll the persisted host back
# to the intentionally unsaved dependency's stale materialized copies.
for name in payload['selectedObjects']:
    host.getObject(name).recompute(False)
assert xml_state(runtime_xml(host), payload['hostRel']) == payload['expected_xml'][payload['hostRel']], 'top_level_recompute_regressed_host'
assert observe_assembly_document(host) == payload['expected_native'][payload['hostRel']], 'top_level_recompute_changed_frames'
assert all(file_hash(rel) == files[rel]['sha256'] for rel in files), 'recompute_probe_wrote_file'
solver_quiet()
finish({'state': 'verified', 'plan_digest': payload['plan_digest'], 'expected_digest': payload['expected_digest'],
    'solver_observations': solver_observations, 'ordinary_host_only_reopen': True, 'top_level_recompute_stable': True})
for name in list(App.listDocuments()):
    App.closeDocument(name)
sys.setprofile(None)
`;

function pruneGuiViewProviders(xml: string, removed: readonly string[]): string {
  if (Buffer.byteLength(xml) > 32 * 1024 * 1024) fail('gui_document_limit');
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, value => ' '.repeat(value.length));
  if (semantic.includes('<!')) fail('unsupported_gui_xml');
  const tokens = /<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/g;
  const stack: Array<{ tag: string; start: number; object?: string }> = [], spans: Array<{ start: number; end: number; object: string }> = [];
  let previous = 0, dataTag: { start: number; end: number; source: string; count: number } | undefined;
  const attribute = (token: string, name: string) => {
    const matches = [...token.matchAll(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'g'))];
    if (matches.length !== 1) fail('unknown_gui_attribute');
    return decodeCadXmlAttribute(matches[0][2]);
  };
  for (const match of semantic.matchAll(tokens)) {
    if (semantic.slice(previous, match.index).includes('<')) fail('invalid_gui_xml');
    const token = match[0], start = match.index!, end = start + token.length; previous = end;
    const tag = /^<\/?([\w:.-]+)/.exec(token)![1];
    if (token.startsWith('</')) {
      const opened = stack.pop(); if (!opened) return fail('invalid_gui_nesting');
      if (opened.tag !== tag) fail('invalid_gui_nesting');
      if (opened.object !== undefined) spans.push({ start: opened.start, end, object: opened.object });
      continue;
    }
    if (tag === 'ViewProviderData') {
      if (dataTag) fail('multiple_gui_view_provider_lists');
      const value = attribute(token, 'Count'); if (!/^\d+$/.test(value)) fail('invalid_gui_view_provider_count');
      dataTag = { start, end, source: xml.slice(start, end), count: Number(value) };
    }
    const object = tag === 'ViewProvider' ? attribute(token, 'name') : undefined;
    if (object !== undefined && stack.at(-1)?.tag !== 'ViewProviderData') fail('unknown_gui_view_provider_nesting');
    if (token.endsWith('/>')) {
      if (object !== undefined) spans.push({ start, end, object });
    } else {
      if (stack.length >= 128) fail('gui_depth_limit');
      stack.push({ tag, start, object });
    }
    if (spans.length > 10000) fail('gui_object_limit');
  }
  if (!dataTag) return fail('missing_gui_view_provider_list');
  if (stack.length || semantic.slice(previous).includes('<') || dataTag.count !== spans.length
    || new Set(spans.map(span => span.object)).size !== spans.length) fail('invalid_gui_view_provider_list');
  const removals = new Set(removed), deleted = spans.filter(span => removals.has(span.object));
  const edits = deleted.map(span => ({ start: span.start, end: span.end, value: '' }));
  edits.push({ start: dataTag.start, end: dataTag.end,
    value: dataTag.source.replace(/(\bCount\s*=\s*)(["'])\d+\2/, (_match, prefix, quote) => `${prefix}${quote}${spans.length - deleted.length}${quote}`) });
  for (const edit of edits.sort((a, b) => b.start - a.start)) xml = xml.slice(0, edit.start) + edit.value + xml.slice(edit.end);
  return xml;
}

/** Only explicit GUI/thumbnail sidecars may be restored after headless Native.
 * Required native members always come from Native and are never overwritten. */
export function preserveAssemblySidecars(original: Uint8Array, staged: Uint8Array, removed: readonly string[]): Uint8Array {
  const before = readAssemblyArchive(original), after = readAssemblyArchive(staged);
  const originalXml = new TextDecoder('utf-8', { fatal: true }).decode(before['Document.xml']);
  const nativeMembers = new Set([...originalXml.matchAll(/<(?:Part|PlacementList|VectorList)\b[^>]*\bfile="([^"<>]+)"/g)].map(match => match[1]));
  for (const [name, bytes] of Object.entries(before)) {
    if (name === 'Document.xml') continue;
    if (name === 'GuiDocument.xml') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      after[name] = new TextEncoder().encode(pruneGuiViewProviders(text, removed));
    } else if (/^thumbnails\/[^/]+\.(?:png|svg)$/i.test(name)) {
      if (after[name] && digest(after[name]) !== digest(bytes)) fail('native_thumbnail_changed');
      after[name] = bytes;
    } else if (nativeMembers.has(name)) {
      // Native renumbers list-resource slots as derived copies are removed.
      // The bound XML guard compared the referenced resource's content/geometry,
      // not its arbitrary archive slot name. Never overwrite these native slots.
      continue;
    } else if (!after[name] || digest(after[name]) !== digest(bytes)) {
      fail('native_archive_member_changed');
    }
  }
  const result = zipSync(after, { level: 6 });
  if (result.byteLength > 64 * 1024 * 1024) fail('staged_archive_limit');
  readAssemblyArchive(result);
  return result;
}

function mirrorFiles(input: AssemblyNativePreviewInput) {
  const root = path.resolve(input.mirrorRoot), st = fs.lstatSync(root);
  if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(root) !== root || (st.mode & 0o077) !== 0 || root === input.baseline.root) fail('unsafe_mirror_root');
  let closurePayload = 0;
  return input.baseline.files.map(file => {
    const filename = safeFcstdPath(root, file.rel), info = fs.lstatSync(filename);
    const bytes = readStableAssemblyFile(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024 || digest(bytes) !== file.sha256) fail('mirror_fingerprint_mismatch');
    const archive = readAssemblyArchive(bytes);
    closurePayload = accumulateAssemblyClosurePayload(closurePayload, Object.values(archive).reduce((sum, member) => sum + member.byteLength, 0));
    return { rel: file.rel, sha256: file.sha256 };
  });
}

export function createAssemblyNativePreview(freecadHome: string): AssemblyUpdatePorts['native'] {
  return async (input): Promise<AssemblyNativePreviewResult> => {
    if (input.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    if (!input.baseline.complete || input.baseline.scope !== 'saved_xml_before_native_open' || !input.selectedObjects.length) fail('invalid_saved_baseline');
    const files = mirrorFiles(input), host = input.baseline.files.find(file => file.rel === input.baseline.hostRel);
    if (!host) return fail('missing_host_baseline');
    if (input.selectedObjects.some(name => !host.objects.some(obj => obj.name === name && obj.typeId === 'Assembly::AssemblyLink'))) fail('invalid_selected_objects');
    const stagedFile = safeFcstdPath(input.mirrorRoot, input.baseline.hostRel), original = readStableAssemblyFile(stagedFile);
    const plan = { mirrorRoot: input.mirrorRoot, hostRel: input.baseline.hostRel, files, selectedObjects: input.selectedObjects,
      links: input.baseline.links, staleDerivedLinks: input.baseline.staleDerivedLinks,
      labels: Object.fromEntries(host.objects.map(obj => [obj.name, obj.label])) };
    const plan_json = JSON.stringify(plan), plan_digest = digest(plan_json);
    try {
      input.phase('native_update');
      const update = await runOwnedAssemblyNative({ freecadHome, stage: 'preview-update', script: UPDATE, spec: { plan_json, plan_digest }, signal: input.signal, timeoutMs: 180_000 });
      const value = update.receipt;
      if (value.state !== 'verified') fail(typeof value.reason === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value.reason) ? value.reason : 'native_update_not_verified');
      if (value.plan_digest !== plan_digest || !Array.isArray(value.added) || !Array.isArray(value.removed)) fail('native_update_not_verified');
      const removed = (value.removed as Array<{ object_name: string }>).map(row => row.object_name);
      const merged = preserveAssemblySidecars(original, readStableAssemblyFile(stagedFile), removed);
      const temporary = path.join(path.dirname(stagedFile), '.native-sidecars-' + update.proof.nonce + '.FCStd');
      fs.writeFileSync(temporary, merged, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, stagedFile);
      const stagedDigest = digest(merged);
      const expected_json = JSON.stringify({ native: value.expected_native, xml: value.expected_xml, staged_sha256: stagedDigest }), expected_digest = digest(expected_json);
      input.phase('native_reopen');
      const reopen = await runOwnedAssemblyNative({ freecadHome, stage: 'preview-reopen', script: REOPEN,
        spec: { plan_json, plan_digest, expected_json, expected_digest }, signal: input.signal, timeoutMs: 180_000 });
      if (reopen.receipt.state !== 'verified') fail(typeof reopen.receipt.reason === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(reopen.receipt.reason) ? reopen.receipt.reason : 'native_reopen_not_verified');
      if (reopen.receipt.plan_digest !== plan_digest || reopen.receipt.expected_digest !== expected_digest) fail('native_reopen_not_verified');
      if (digest(readStableAssemblyFile(stagedFile)) !== stagedDigest) fail('staged_file_changed');
      for (const file of files) if (file.rel !== input.baseline.hostRel && digest(readStableAssemblyFile(safeFcstdPath(input.mirrorRoot, file.rel))) !== file.sha256) fail('dependency_written');
      return { stagedFile, nativeProof: { update: update.proof, reopen: reopen.proof }, preview: {
        added: value.added as AssemblyNativePreviewResult['preview']['added'], removed: value.removed as AssemblyNativePreviewResult['preview']['removed'],
        preserved_joint_count: Number(value.preserved_joint_count), preserved_instance_count: Number(value.preserved_instance_count),
        rigid_unchanged: true, placements_unchanged: true, joint_frames_unchanged: true, dependency_bytes_unchanged: true, independently_reopened: true,
        engine_version: String(value.engine_version),
      } };
    } catch (error) {
      if (input.signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      if (error instanceof AssemblyNativePreviewError) throw error;
      if (error instanceof AssemblyArchiveError) throw new AssemblyNativePreviewError(error.reason);
      throw new AssemblyNativePreviewError('native_stage_failed');
    }
  };
}
