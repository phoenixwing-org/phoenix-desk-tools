/** Fixed native observation/refresh implementation shared by the manual proof and publisher.
 * It neither solves, flips Rigid, repairs references nor saves any document.
 * Saved XML is a separate, mandatory pre-open baseline; this cannot replace it.
 */
export const ASSEMBLY_NATIVE_PRESERVATION = String.raw`
import UtilsAssembly
import os
import Part

def assembly_placement(value):
    # Native roundoff only, well below the 1e-7 mm/radian proof tolerance.
    return [round(float(x), 10) for x in (value.Base.x, value.Base.y, value.Base.z, *value.Rotation.Q)]

def assembly_endpoint(value):
    if value is None:
        return None
    assert len(value) == 2 and value[0] is not None, 'invalid_joint_endpoint'
    return [value[0].Name, list(value[1]), os.path.realpath(value[0].Document.FileName)]

def assembly_actual_frame(joint, reference, side):
    assert UtilsAssembly.isRefValid(reference, 2), 'invalid_joint_reference'
    assert UtilsAssembly.getObject(reference) is not None, 'missing_joint_reference_object'
    target, subnames = reference
    first = target.getSubObject(subnames[0])
    assert first is not None, 'missing_joint_primary_selector'
    selectors = []
    for index, sub in enumerate(subnames):
        element = UtilsAssembly.getElementName(sub)
        shape = first.getElement(element) if index == 1 and isinstance(first, Part.Shape) and first.ShapeType == 'Face' and element.startswith('Edge') else target.getSubObject(sub)
        assert shape is not None, 'missing_joint_selector'
        if isinstance(shape, Part.Shape):
            assert not shape.isNull() and shape.isValid(), 'invalid_joint_selector'
        selectors.append({'sub': sub, 'type': shape.ShapeType if isinstance(shape, Part.Shape) else shape.TypeId})
    assert hasattr(joint.Proxy, 'findPlacement'), 'unsupported_joint_proxy'
    computed = joint.Proxy.findPlacement(joint, reference, side)
    return {'local': assembly_placement(computed),
            'world': assembly_placement(UtilsAssembly.getGlobalPlacement(reference) * computed),
            'selectors': selectors}

def assembly_tracked_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [assembly_tracked_value(x) for x in value]
    if hasattr(value, 'Base') and hasattr(value, 'Rotation'):
        return assembly_placement(value)
    if hasattr(value, 'Value') and hasattr(value, 'Unit'):
        return ['quantity', float(value.Value), str(value.Unit)]
    if all(hasattr(value, key) for key in ('x', 'y', 'z')):
        return ['vector', float(value.x), float(value.y), float(value.z)]
    raise AssertionError('unsupported_tracked_property')

def observe_assembly_document(doc, user_properties=None):
    objects, joints, groups = {}, {}, {}
    for obj in doc.Objects:
        row = {'type': obj.TypeId, 'label': obj.Label, 'label2': obj.Label2}
        if hasattr(obj, 'Placement'):
            row['placement'] = assembly_placement(obj.Placement)
            if obj.TypeId in ('App::Link', 'Assembly::AssemblyLink', 'Assembly::AssemblyObject'):
                row['world'] = assembly_placement(UtilsAssembly.getGlobalPlacement((obj, ['', ''])))
        if hasattr(obj, 'Uid'):
            row['uid'] = str(obj.Uid)
        if hasattr(obj, 'Rigid'):
            row['rigid'] = obj.Rigid
        if user_properties and obj.Name in user_properties:
            row['user_properties'] = {key: assembly_tracked_value(getattr(obj, key))
                                      for key in user_properties[obj.Name]}
        if hasattr(obj, 'JointType'):
            assert obj.Reference1 is not None and obj.Reference2 is not None, 'disconnected_joint'
            joints[obj.Name] = {'type': str(obj.JointType), 'reference1': assembly_endpoint(obj.Reference1),
                'reference2': assembly_endpoint(obj.Reference2), 'placement1': assembly_placement(obj.Placement1),
                'placement2': assembly_placement(obj.Placement2), 'detach1': obj.Detach1, 'detach2': obj.Detach2,
                'frame1': assembly_placement(UtilsAssembly.getJcsGlobalPlc(obj.Placement1, obj.Reference1)),
                'frame2': assembly_placement(UtilsAssembly.getJcsGlobalPlc(obj.Placement2, obj.Reference2)),
                'offset1': assembly_placement(obj.Offset1), 'offset2': assembly_placement(obj.Offset2),
                'suppressed': obj.Suppressed,
                'parameters': {key: assembly_tracked_value(getattr(obj, key)) for key in (
                    'Angle', 'AngleMax', 'AngleMin', 'Distance', 'Distance2', 'EnableAngleMax',
                    'EnableAngleMin', 'EnableLengthMax', 'EnableLengthMin', 'LengthMax', 'LengthMin')}}
            joints[obj.Name]['actual_frame1'] = assembly_actual_frame(obj, obj.Reference1, 0)
            joints[obj.Name]['actual_frame2'] = assembly_actual_frame(obj, obj.Reference2, 1)
            joints[obj.Name]['proxy_type'] = type(obj.Proxy).__module__ + '.' + type(obj.Proxy).__qualname__
        elif hasattr(obj, 'ObjectToGround'):
            grounded = obj.ObjectToGround
            assert grounded is not None, 'disconnected_grounded_joint'
            joints[obj.Name] = {'type': 'Grounded', 'object_to_ground': [grounded.Name, os.path.realpath(grounded.Document.FileName)],
                'placement': assembly_placement(grounded.Placement),
                'world': assembly_placement(UtilsAssembly.getGlobalPlacement((grounded, ['', '']))),
                'proxy_type': type(obj.Proxy).__module__ + '.' + type(obj.Proxy).__qualname__}
        if obj.TypeId == 'Assembly::JointGroup':
            groups[obj.Name] = [x.Name for x in obj.Group]
        objects[obj.Name] = row
    return {'objects': objects, 'joints': joints, 'joint_groups': groups}

def refresh_assembly_links(documents, selected_roots=None):
    # Caller supplies an explicitly frozen dependency-first closure. Native refresh
    # is single-level: the top AssemblyLink alone does not refresh nested copies.
    calls = []
    for doc in documents:
        visited, visiting, order = set(), set(), []
        def visit(obj):
            if obj.Name in visited:
                return
            assert obj.Name not in visiting, 'assembly_cycle'
            visiting.add(obj.Name)
            for child in list(obj.Group):
                if child.TypeId == 'Assembly::AssemblyLink':
                    visit(child)
            visiting.remove(obj.Name)
            visited.add(obj.Name)
            order.append(obj.Name)
        if selected_roots is not None and doc.Name in selected_roots:
            roots = [doc.getObject(name) for name in selected_roots[doc.Name]]
            assert all(obj is not None and obj.TypeId == 'Assembly::AssemblyLink' for obj in roots), 'invalid_selected_instance'
        else:
            roots = [obj for obj in list(doc.Objects) if obj.TypeId == 'Assembly::AssemblyLink']
        for obj in roots:
            visit(obj)
        for name in order:
            obj = doc.getObject(name)
            assert obj is not None and obj.TypeId == 'Assembly::AssemblyLink', 'selected_instance_disappeared'
            obj.recompute(False)
            calls.append([doc.Name, name])
    return calls

def assert_assembly_frame_storage_consistent(state):
    for joint in state['joints'].values():
        if joint['type'] == 'Grounded':
            continue
        for side in (1, 2):
            if not joint['detach' + str(side)]:
                assert joint['actual_frame' + str(side)]['local'] == joint['placement' + str(side)], 'stored_actual_local_frame_mismatch'
                assert joint['actual_frame' + str(side)]['world'] == joint['frame' + str(side)], 'stored_actual_world_frame_mismatch'

def assert_assembly_preserved(before, after, allowed_removed):
    removed = set(before['objects']) - set(after['objects'])
    assert removed == set(allowed_removed), 'unexpected_removed_objects'
    assert before['joints'] == after['joints'], 'joint_or_frame_changed'
    assert before['joint_groups'] == after['joint_groups'], 'joint_group_changed'
    for name in set(before['objects']) & set(after['objects']):
        assert before['objects'][name] == after['objects'][name], 'surviving_object_changed'
    guard_assembly_removals(before, removed)

def guard_assembly_removals(before, removed):
    connected = set()
    for row in before['joints'].values():
        if row['type'] == 'Grounded':
            connected.add(row['object_to_ground'][0])
            continue
        for key in ('reference1', 'reference2'):
            reference = row[key]
            assert reference is not None, 'disconnected_joint'
            connected.add(reference[0])
            for subname in reference[1]:
                connected.update(segment for segment in subname.split('.') if segment in before['objects'])
    assert not (connected & set(removed)), 'connected_component_deletion'
`;
