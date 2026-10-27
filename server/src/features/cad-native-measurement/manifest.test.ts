import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import * as filesystem from '../cad-companions/filesystem.js';
import { canonicalSingleFeatureManifestPayload, extractSavedShapeSnapshot, prepareSingleFeatureManifest, SINGLE_FEATURE_MANIFEST_ALGORITHM, type NativeManifestReason, type SingleFeatureManifest, type SingleFeatureManifestInput } from './manifest.js';

// Independently constructed FORMAT fixtures, deliberately NOT real BRep/Native geometry.
const NODE = 'ExampleFeature';
const SHAPE = 'ExampleFeature.Shape.brp';
const opaqueShape = Buffer.from('synthetic opaque saved-shape payload\nnot a geometric validity proof\n');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const roots: string[] = [];
function xml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Document SchemaVersion="4" ProgramVersion="synthetic-format-only" FileVersion="1" StringHasher="1">
 <StringHasher saveall="0" threshold="0" count="0"/>
 <Properties Count="8" TransientCount="3">
  <_Property name="FileName" type="App::PropertyString" status="1"/>
  <_Property name="TransientDir" type="App::PropertyString"/>
  <_Property name="Tip" type="App::PropertyLink"/>
  <Property name="Comment" type="App::PropertyString"><String value="independent format fixture"/></Property>
  <Property name="Label" type="App::PropertyString"><String value="Example &amp; sample"/></Property>
  <Property name="TipName" type="App::PropertyString"><String value=""/></Property>
  <Property name="Material" type="App::PropertyMap"><Map count="0"/></Property>
  <Property name="Meta" type="App::PropertyMap"><Map count="0"/></Property>
  <Property name="Uid" type="App::PropertyUUID"><Uuid value="a94af932-915c-4cb1-8e94-7a12f295894d"/></Property>
  <Property name="UseHasher" type="App::PropertyBool"><Bool value="true"/></Property>
  <Property name="UnitSystem" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="2"><Enum value="unit option one"/><Enum value="unit option two"/></CustomEnumList></Property>
 </Properties>
 <Objects Count="1" Dependencies="1"><ObjectDeps Name="${NODE}" Count="0"/><Object type="Part::Feature" name="${NODE}" id="17"/></Objects>
 <ObjectData Count="1"><Object name="${NODE}"><Properties Count="7" TransientCount="1">
  <_Property name="_ElementMapVersion" type="App::PropertyString"/>
  <Property name="ExpressionEngine" type="App::PropertyExpressionEngine"><ExpressionEngine count="0"/></Property>
  <Property name="Label" type="App::PropertyString"><String value="generic feature"/></Property>
  <Property name="Label2" type="App::PropertyString"><String value=""/></Property>
  <Property name="Placement" type="App::PropertyPlacement"><PropertyPlacement Px="0.0" Py="0.0" Pz="0.0" Q0="0.0" Q1="0.0" Q2="0.0" Q3="1.0" A="0.0" Ox="0.0" Oy="0.0" Oz="1.0"/></Property>
  <Property name="Shape" type="Part::PropertyPartShape"><Part ElementMap="15.70200.5" file="${SHAPE}"/><ElementMap/></Property>
  <Property name="ShapeMaterial" type="Materials::PropertyMaterial"><PropertyMaterial uuid="00000000-0000-0000-0000-000000000000"/></Property>
  <Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property>
 </Properties></Object></ObjectData>
</Document>`;
}
function archive(text = xml(), level: 0 | 6 = 6, extra: Record<string, Uint8Array> = {}): Buffer {
  return Buffer.from(zipSync({ 'Document.xml': strToU8(text), [SHAPE]: opaqueShape, ...extra }, { level }));
}
function fixture(bytes = archive()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-manifest-synthetic-')); roots.push(root);
  fs.writeFileSync(path.join(root, 'Example.FCStd'), bytes);
  return root;
}
async function manual(text: string, code?: NativeManifestReason) {
  const result = await prepareSingleFeatureManifest(fixture(archive(text)), { rel: 'Example.FCStd', node: NODE });
  expect(result.status).toBe('manual');
  if (code && result.status === 'manual') expect(result.reason_codes).toContain(code);
  expect(JSON.stringify(result)).not.toContain(os.tmpdir());
}
function centralEntries(b: Buffer): { offset: number; local: number; start: number; size: number; name: string }[] {
  const end = b.length - 22, count = b.readUInt16LE(end + 10), entries = [];
  let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const local = b.readUInt32LE(p + 42), nameLength = b.readUInt16LE(p + 28), localNameLength = b.readUInt16LE(local + 26);
    entries.push({ offset: p, local, start: local + 30 + localNameLength + b.readUInt16LE(local + 28), size: b.readUInt32LE(p + 20), name: b.toString('utf8', p + 46, p + 46 + nameLength) });
    p += 46 + nameLength + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return entries;
}
/** fflate object keys cannot represent duplicate members, so join independent one-entry ZIP records. */
function zipMembers(parts: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let localBytes = 0;
  for (const [name, data] of parts) {
    const one = Buffer.from(zipSync({ [name]: data }, { level: 0 })), e = one.length - 22, c = one.readUInt32LE(e + 16);
    locals.push(one.subarray(0, c)); const central = Buffer.from(one.subarray(c, e)); central.writeUInt32LE(localBytes, 42); centrals.push(central); localBytes += c;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(localBytes, 16);
  return Buffer.concat([...locals, central, end]);
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('strict saved single-feature manifest (no Native proof)', () => {
  it.each([0, 6] as const)('freezes exact source/XML/Shape evidence, compression level %s', async level => {
    const source = archive(xml(), level), root = fixture(source), before = fs.readFileSync(path.join(root, 'Example.FCStd'));
    const result = await prepareSingleFeatureManifest(root, { rel: 'Example.FCStd', node: NODE });
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    const m = result.manifest;
    expect(m.algorithm_version).toBe(SINGLE_FEATURE_MANIFEST_ALGORITHM);
    expect(m.source).toEqual({ rel: 'Example.FCStd', bytes: source.length, sha256: sha(source) });
    expect(m.document_xml).toEqual({ bytes: Buffer.byteLength(xml()), sha256: sha(xml()) });
    expect(m.entity).toEqual({ node: NODE, type_id: 'Part::Feature', shape_property: 'Shape', shape_property_type: 'Part::PropertyPartShape' });
    expect(m.shape).toMatchObject({ basis: 'serialized_shape_snapshot', member_path: SHAPE, bytes: opaqueShape.length, sha256: sha(opaqueShape), compression: level ? 'deflate' : 'stored' });
    expect(m.shape.crc32).toMatch(/^[a-f0-9]{8}$/);
    expect(m.dependencies).toEqual([]); expect(m.restored_document).toEqual({ verified: false }); expect(m.native_executed).toBe(false);
    expect(m.manifest_sha256).toBe(sha(canonicalSingleFeatureManifestPayload(m)));
    expect(Object.isFrozen(m)).toBe(true); expect(Object.isFrozen(m.source)).toBe(true); expect(Object.isFrozen(m.dependencies)).toBe(true);
    expect(JSON.stringify(m)).not.toContain(root); expect(JSON.stringify(m)).not.toContain('independent format fixture');
    expect(fs.readFileSync(path.join(root, 'Example.FCStd'))).toEqual(before);
    expect(fs.readdirSync(root)).toEqual(['Example.FCStd']);
  });
  it('accepts a ZIP EOCD comment without treating its bytes as members', async () => {
    const b = archive(), comment = Buffer.from('independent zip comment'); b.writeUInt16LE(comment.length, b.length - 2);
    expect((await prepareSingleFeatureManifest(fixture(Buffer.concat([b, comment])), { rel: 'Example.FCStd', node: NODE })).status).toBe('ready');
  });
  it('records the independently known CRC32 check vector', async () => {
    const b = Buffer.from(zipSync({ 'Document.xml': strToU8(xml()), [SHAPE]: strToU8('123456789') }, { level: 6 }));
    const result = await prepareSingleFeatureManifest(fixture(b), { rel: 'Example.FCStd', node: NODE });
    expect(result.status).toBe('ready'); if (result.status === 'ready') expect(result.manifest.shape.crc32).toBe('cbf43926');
  });
  it.each(['PartDesign::Body', 'App::Part', 'Assembly::AssemblyObject', 'App::Link', 'Part::FeaturePython'])('does not promise %s restore semantics', async type => {
    await manual(xml().replace('type="Part::Feature"', `type="${type}"`), 'unsupported_object_type');
  });
  it('does not use a BOM/root object or a label as selected entity identity', async () => {
    const result = await prepareSingleFeatureManifest(fixture(), { rel: 'Example.FCStd', node: 'OtherFeature' });
    expect(result).toEqual({ status: 'manual', reason_codes: ['selection_mismatch'] });
  });
  it.each([
    ['additional object', (s: string) => s.replace('Objects Count="1"', 'Objects Count="2"'), 'unsupported_object_type'],
    ['dependency declaration', (s: string) => s.replace(`ObjectDeps Name="${NODE}" Count="0"`, `ObjectDeps Name="${NODE}" Count="1"`), 'unsupported_document_structure'],
    ['expression', (s: string) => s.replace('<ExpressionEngine count="0"/>', '<ExpressionEngine count="1"><Expression path="Shape" expression="other"/></ExpressionEngine>'), 'unsupported_property'],
    ['non-empty document map', (s: string) => s.replace('<Map count="0"/>', '<Map count="1"><Item key="external" value="other"/></Map>'), 'unsupported_property'],
    ['Proxy', (s: string) => s.replace('name="Label2" type="App::PropertyString"', 'name="Proxy" type="App::PropertyPythonObject"'), 'unsupported_property'],
    ['external link', (s: string) => s.replace('name="Label2" type="App::PropertyString"', 'name="LinkedObject" type="App::PropertyXLink"'), 'unsupported_property'],
    ['Joint property', (s: string) => s.replace('name="Label2"', 'name="Joint"'), 'unsupported_property'],
    ['unknown transient', (s: string) => s.replace('name="_ElementMapVersion"', 'name="UnknownTransient"'), 'unsupported_property'],
    ['unknown root section', (s: string) => s.replace('</Document>', '<UnknownRestoreHook/></Document>'), 'unsupported_document_structure'],
    ['non-identity placement', (s: string) => s.replace('Px="0.0"', 'Px="1.0"'), 'unsupported_property'],
    ['nonempty hasher', (s: string) => s.replace('threshold="0" count="0"', 'threshold="0" count="1"'), 'unsupported_document_structure'],
    ['nonempty material UUID', (s: string) => s.replace('00000000-0000-0000-0000-000000000000', 'bf8bf28e-1d77-4fc5-b013-252c517bef6b'), 'material_resolution_required'],
    ['invalid material UUID', (s: string) => s.replace('00000000-0000-0000-0000-000000000000', 'external-card-name'), 'material_resolution_required'],
    ['duplicate property', (s: string) => s.replace('name="Label2"', 'name="Label"'), 'unsupported_property'],
    ['incorrect property count', (s: string) => s.replace('Count="7"', 'Count="8"'), 'unsupported_document_structure'],
    ['unexpected attribute', (s: string) => s.replace('<Part ElementMap=', '<Part external="something" ElementMap='), 'unsupported_shape_carrier'],
    ['multiple Shape carriers', (s: string) => s.replace('<ElementMap/>', `<Part file="${SHAPE}"/>`), 'unsupported_shape_carrier'],
    ['inline Shape', (s: string) => s.replace(`<Part ElementMap="15.70200.5" file="${SHAPE}"/>`, '<Part value="inline"/>'), 'unsupported_shape_carrier'],
    ['escaping Shape path', (s: string) => s.replace(`file="${SHAPE}"`, 'file="../outside.brp"'), 'unsupported_shape_carrier'],
    ['nested Shape path', (s: string) => s.replace(`file="${SHAPE}"`, 'file="folder/shape.brp"'), 'unsupported_shape_carrier'],
    ['missing carrier member', (s: string) => s.replace(`file="${SHAPE}"`, 'file="Missing.Shape.brp"'), 'missing_shape_member'],
  ] as const)('requires manual for %s', async (_label, change, code) => { await manual(change(xml()), code); });
  it.each([
    (s: string) => s.replace('<Document ', '<!DOCTYPE Document SYSTEM "file:///never-read"><Document '),
    (s: string) => s.replace('<Objects ', '<?restore anything?><Objects '),
    (s: string) => s.replace('<ElementMap/>', '<![CDATA[opaque]]>'),
    (s: string) => s.replace('SchemaVersion="4"', 'SchemaVersion="4" SchemaVersion="4"'),
    (s: string) => s.replace('generic feature', 'bad &unknown; entity'),
    (s: string) => s.replace('</ObjectData>', '</Wrong>'),
    (s: string) => s.replace('<ElementMap/>', '<ElementMap/>not whitespace'),
    (s: string) => s.replace('<ElementMap/>', '<!-- invalid\0XML --><ElementMap/>'),
    (s: string) => s.replace('<ObjectData ', '\u00a0<ObjectData '),
    (s: string) => s.replace('SchemaVersion="4" ', 'SchemaVersion="4"\u00a0'),
    (s: string) => s.replace('</ObjectData>', '</ObjectData\u00a0>'),
    (s: string) => s + '\ufeff',
  ])('rejects malformed/unresolved XML syntax', async change => { await manual(change(xml()), 'invalid_xml'); });
  it('bounds XML structure before resolving dependencies', async () => { await manual(xml().replace('<ElementMap/>', '<ElementMap>' + '<a/>'.repeat(2100) + '</ElementMap>'), 'resource_limit'); });
  it('does not read an external file mentioned by an unsupported property', async () => {
    const root = fixture(archive(xml().replace('name="Label2" type="App::PropertyString"', 'name="ExternalFile" type="App::PropertyFile"')));
    const spy = vi.spyOn(filesystem, 'readBoundedFile');
    expect((await prepareSingleFeatureManifest(root, { rel: 'Example.FCStd', node: NODE })).status).toBe('manual');
    expect(spy.mock.calls.map(call => call[1])).toEqual(['Example.FCStd']);
  });
  it.each(['same name', 'case alias'] as const)('rejects duplicate ZIP members: %s', async kind => {
    const b = zipMembers([['Document.xml', Buffer.from(xml())], [SHAPE, opaqueShape], [kind === 'same name' ? SHAPE : SHAPE.toLowerCase(), opaqueShape]]);
    expect(await prepareSingleFeatureManifest(fixture(b), { rel: 'Example.FCStd', node: NODE })).toEqual({ status: 'manual', reason_codes: ['duplicate_member'] });
  });
  it('rejects unrecognized extra members rather than assuming self containment', async () => {
    const result = await prepareSingleFeatureManifest(fixture(archive(xml(), 6, { 'GuiDocument.xml': strToU8('<Gui/>') })), { rel: 'Example.FCStd', node: NODE });
    expect(result).toEqual({ status: 'manual', reason_codes: ['unsupported_member'] });
  });
  it.each(['Document.xml', SHAPE])('verifies actual uncompressed CRC for %s', async name => {
    const b = archive(xml(), 0), m = centralEntries(b).find(e => e.name === name)!; b[m.start + 1] ^= 1;
    const result = await prepareSingleFeatureManifest(fixture(b), { rel: 'Example.FCStd', node: NODE });
    expect(result).toEqual({ status: 'manual', reason_codes: [name === SHAPE ? 'invalid_shape_payload' : 'invalid_xml'] });
  });
  it.each(['header name', 'header size', 'encryption', 'method', 'trailing bytes', 'truncated', 'oversized shape'] as const)('rejects archive inconsistency: %s', async change => {
    let b = archive(), m = centralEntries(b)[1];
    if (change === 'header name') b[m.local + 30] ^= 1;
    if (change === 'header size') b.writeUInt32LE(b.readUInt32LE(m.local + 22) + 1, m.local + 22);
    if (change === 'encryption') b.writeUInt16LE(1, m.offset + 8);
    if (change === 'method') b.writeUInt16LE(99, m.offset + 10);
    if (change === 'trailing bytes') b = Buffer.concat([b, Buffer.from('trailing')]);
    if (change === 'truncated') b = b.subarray(0, b.length - 1);
    if (change === 'oversized shape') b.writeUInt32LE(40 * 1024 * 1024, m.offset + 24);
    expect((await prepareSingleFeatureManifest(fixture(b), { rel: 'Example.FCStd', node: NODE })).status).toBe('manual');
  });
  it('rejects declared deflate size smaller than actual output', async () => {
    const b = archive(), m = centralEntries(b)[1]; b.writeUInt32LE(2, m.local + 22); b.writeUInt32LE(2, m.offset + 24);
    expect(await prepareSingleFeatureManifest(fixture(b), { rel: 'Example.FCStd', node: NODE })).toEqual({ status: 'manual', reason_codes: ['invalid_shape_payload'] });
  });
  it('requires an explicit safe file/node selection and does not infer from labels', async () => {
    const root = fixture();
    for (const input of [{ rel: '../Example.FCStd', node: NODE }, { rel: 'Example.FCStd', node: '' }, { rel: 'Example.step', node: NODE }, { rel: 'Example.FCStd', node: 'generic feature' }]) {
      expect((await prepareSingleFeatureManifest(root, input)).status).toBe('manual');
    }
    expect(await prepareSingleFeatureManifest(root, { rel: 'Missing.FCStd', node: NODE })).toEqual({ status: 'manual', reason_codes: ['unreadable_source'] });
  });
  it('rejects a source symlink without following it', async () => {
    const root = fixture(); fs.symlinkSync('Example.FCStd', path.join(root, 'Link.FCStd'));
    expect(await prepareSingleFeatureManifest(root, { rel: 'Link.FCStd', node: NODE })).toEqual({ status: 'manual', reason_codes: ['unsafe_source'] });
  });
  it('pre-abort does not read source', async () => {
    const spy = vi.spyOn(filesystem, 'readBoundedFile'), controller = new AbortController(); controller.abort();
    expect(await prepareSingleFeatureManifest(fixture(), { rel: 'Example.FCStd', node: NODE, signal: controller.signal })).toEqual({ status: 'manual', reason_codes: ['cancelled'] });
    expect(spy).not.toHaveBeenCalled();
  });
  it('abort after the first safe read produces no ready manifest', async () => {
    const controller = new AbortController(), read = filesystem.readBoundedFile;
    const spy = vi.spyOn(filesystem, 'readBoundedFile').mockImplementation((...args) => { const result = read(...args); controller.abort(); return result; });
    expect(await prepareSingleFeatureManifest(fixture(), { rel: 'Example.FCStd', node: NODE, signal: controller.signal })).toEqual({ status: 'manual', reason_codes: ['cancelled'] });
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it('freezes explicit rel/node before the asynchronous recheck boundary', async () => {
    const root = fixture(), input = { rel: 'Example.FCStd', node: NODE }, read = filesystem.readBoundedFile;
    vi.spyOn(filesystem, 'readBoundedFile').mockImplementation((...args) => { const result = read(...args); input.rel = 'Different.FCStd'; input.node = 'DifferentFeature'; return result; });
    const result = await prepareSingleFeatureManifest(root, input);
    expect(result.status).toBe('ready'); if (result.status === 'ready') { expect(result.manifest.source.rel).toBe('Example.FCStd'); expect(result.manifest.entity.node).toBe(NODE); }
  });
  it('rechecks actual source bytes after parsing, through the public read seam', async () => {
    const root = fixture(), read = filesystem.readBoundedFile; let changed = false;
    vi.spyOn(filesystem, 'readBoundedFile').mockImplementation((...args) => {
      const result = read(...args);
      if (!changed) { changed = true; fs.writeFileSync(path.join(root, 'Example.FCStd'), archive(xml().replace('independent format fixture', 'independently changed fixture'))); }
      return result;
    });
    expect(await prepareSingleFeatureManifest(root, { rel: 'Example.FCStd', node: NODE })).toEqual({ status: 'manual', reason_codes: ['source_changed'] });
    expect(changed).toBe(true);
  });
});

describe('explicit saved-BRep snapshot profile; never a restored-document fallback', () => {
  const materialUuid = '52e0db93-3f90-46c4-96cc-645d1dd2d7f4';
  const materialXml = (value = materialUuid) => xml().replace('00000000-0000-0000-0000-000000000000', value);
  async function prepared(root: string, profile: 'restored_document' | 'saved_brep_snapshot' = 'saved_brep_snapshot'): Promise<SingleFeatureManifest> {
    const r = await prepareSingleFeatureManifest(root, { rel: 'Example.FCStd', node: NODE, profile });
    expect(r.status).toBe('ready'); if (r.status !== 'ready') throw new Error('synthetic fixture not ready');
    return r.manifest;
  }
  it('keeps omitted/default restored profile strict and requires explicit snapshot opt-in', async () => {
    const root = fixture(archive(materialXml()));
    for (const profile of [undefined, 'restored_document'] as const) {
      expect(await prepareSingleFeatureManifest(root, { rel: 'Example.FCStd', node: NODE, profile })).toEqual({ status: 'manual', reason_codes: ['material_resolution_required'] });
    }
    const m = await prepared(root);
    expect(m.algorithm_version).toBe('single-feature-saved-manifest-v2');
    expect(m.measurement_profile).toBe('saved_brep_snapshot');
    expect(m.dependency_scope).toBe('saved_shape_carrier'); expect(m.dependency_check).toBe('strict_saved_shape_carrier_v1');
    expect(m.engine_asset_dependencies).toBe('not_attested'); expect(m.dependencies).toEqual([]);
    expect(m.material).toEqual({ uuid_raw: materialUuid, state: 'unresolved_metadata_only', resolution_performed: false, density_kg_m3: null, mass_kg: null });
    expect(m.restored_document.verified).toBe(false); expect(m.native_executed).toBe(false); expect(Object.isFrozen(m.material)).toBe(true);
  });
  it('binds requested profile into canonical payload and digest even for the same nil-material source', async () => {
    const root = fixture(), restored = await prepared(root, 'restored_document'), snapshot = await prepared(root);
    expect(restored.source).toEqual(snapshot.source); expect(restored.shape).toEqual(snapshot.shape);
    expect(restored.material.state).toBe('nil'); expect(snapshot.material.state).toBe('nil');
    expect(restored.dependency_scope).toBe('restored_document_structure');
    expect(snapshot.manifest_sha256).not.toBe(restored.manifest_sha256);
    expect(snapshot.manifest_sha256).toBe(sha(canonicalSingleFeatureManifestPayload(snapshot)));
    const omitted = await prepareSingleFeatureManifest(root, { rel: 'Example.FCStd', node: NODE });
    expect(omitted.status === 'ready' && omitted.manifest.manifest_sha256).toBe(restored.manifest_sha256);
  });
  it('preserves UUID spelling without material resolution, labels, default density, or UUID-derived mass', async () => {
    const value = materialUuid.toUpperCase(), m = await prepared(fixture(archive(materialXml(value))));
    expect(m.material.uuid_raw).toBe(value); expect(m.material.resolution_performed).toBe(false);
    expect(m.material.density_kg_m3).toBeNull(); expect(m.material.mass_kg).toBeNull();
  });
  it.each(['not-a-uuid', '{52e0db93-3f90-46c4-96cc-645d1dd2d7f4}', ' 52e0db93-3f90-46c4-96cc-645d1dd2d7f4', '52e0db93-3f90-46c4-96cc-645d1dd2d7fz', ''])('does not repair or resolve invalid snapshot material metadata: %s', async value => {
    expect(await prepareSingleFeatureManifest(fixture(archive(materialXml(value))), { rel: 'Example.FCStd', node: NODE, profile: 'saved_brep_snapshot' })).toEqual({ status: 'manual', reason_codes: ['invalid_material_metadata'] });
  });
  it.each([
    (s: string) => s.replace('type="Part::Feature"', 'type="App::Link"'),
    (s: string) => s.replace('Objects Count="1"', 'Objects Count="2"'),
    (s: string) => s.replace('Px="0.0"', 'Px="1.0"'),
    (s: string) => s.replace('<ExpressionEngine count="0"/>', '<ExpressionEngine count="1"/>'),
    (s: string) => s.replace('name="Label2"', 'name="Proxy"'),
    (s: string) => s.replace('name="Label2" type="App::PropertyString"', 'name="ExternalFile" type="App::PropertyFile"'),
    (s: string) => s.replace(`ObjectDeps Name="${NODE}" Count="0"`, `ObjectDeps Name="${NODE}" Count="1"`),
    (s: string) => s.replace(`<Part ElementMap="15.70200.5" file="${SHAPE}"/>`, '<Part file="../escaped.brp"/>'),
  ])('retains all entity, identity-placement, unknown-property and dependency gates', async change => {
    const result = await prepareSingleFeatureManifest(fixture(archive(change(materialXml()))), { rel: 'Example.FCStd', node: NODE, profile: 'saved_brep_snapshot' });
    expect(result.status).toBe('manual');
  });
  it('rejects an unknown requested profile before reading, with no fallback', async () => {
    const spy = vi.spyOn(filesystem, 'readBoundedFile');
    const input = { rel: 'Example.FCStd', node: NODE, profile: 'auto' } as unknown as SingleFeatureManifestInput;
    expect(await prepareSingleFeatureManifest(fixture(), input)).toEqual({ status: 'manual', reason_codes: ['profile_mismatch'] });
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([0, 6] as const)('extracts a fresh host-only buffer after full archive/XML/Shape verification, level %s', async level => {
    const root = fixture(archive(materialXml(), level)), before = fs.readFileSync(path.join(root, 'Example.FCStd')), m = await prepared(root);
    const result = await extractSavedShapeSnapshot(root, m);
    expect(result.status).toBe('ready'); if (result.status !== 'ready') return;
    expect(Buffer.isBuffer(result.shape)).toBe(true); expect(result.shape).toEqual(opaqueShape);
    expect(result.shape.length).toBe(m.shape.bytes); expect(sha(result.shape)).toBe(m.shape.sha256);
    expect(result.manifest).toEqual(m); expect(JSON.stringify(result.manifest)).not.toContain('opaque saved-shape');
    result.shape.fill(0); // No Buffer alias back into a document, DTO, or future extraction.
    const again = await extractSavedShapeSnapshot(root, m); expect(again.status === 'ready' && again.shape.equals(opaqueShape)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'Example.FCStd'))).toEqual(before); expect(fs.readdirSync(root)).toEqual(['Example.FCStd']);
  });
  it('never extracts a restored-profile manifest as a snapshot', async () => {
    const root = fixture(), m = await prepared(root, 'restored_document'), spy = vi.spyOn(filesystem, 'readBoundedFile');
    expect(await extractSavedShapeSnapshot(root, m)).toEqual({ status: 'manual', reason_codes: ['profile_mismatch'] });
    expect(spy).not.toHaveBeenCalled();
  });
  it.each(['source metadata', 'shape bytes', 'CRC corruption', 'duplicate member'] as const)('extractor refuses changed evidence: %s', async target => {
    const root = fixture(archive(materialXml())), m = await prepared(root); let changed: Buffer;
    if (target === 'source metadata') changed = archive(materialXml().replace('independent format fixture', 'independently changed metadata'));
    else if (target === 'shape bytes') changed = Buffer.from(zipSync({ 'Document.xml': strToU8(materialXml()), [SHAPE]: strToU8('other opaque shape bytes') }, { level: 6 }));
    else if (target === 'CRC corruption') { changed = archive(materialXml(), 0); const entry = centralEntries(changed)[1]; changed[entry.start] ^= 1; }
    else changed = zipMembers([['Document.xml', Buffer.from(materialXml())], [SHAPE, opaqueShape], [SHAPE, opaqueShape]]);
    fs.writeFileSync(path.join(root, 'Example.FCStd'), changed);
    const result = await extractSavedShapeSnapshot(root, m);
    expect(result.status).toBe('manual'); expect(Object.hasOwn(result, 'shape')).toBe(false);
  });
  it.each(['digest', 'shape SHA', 'XML SHA', 'CRC', 'material resolution', 'material mass', 'scope', 'node'] as const)('rejects forged frozen claims before releasing bytes: %s', async target => {
    const root = fixture(archive(materialXml())), forged = structuredClone(await prepared(root));
    const raw = forged as unknown as { manifest_sha256: string; shape: { sha256: string; crc32: string }; document_xml: { sha256: string }; material: { resolution_performed: boolean; mass_kg: number | null }; dependency_scope: string; entity: { node: string } };
    if (target === 'digest') raw.manifest_sha256 = 'a'.repeat(64);
    if (target === 'shape SHA') raw.shape.sha256 = 'b'.repeat(64);
    if (target === 'XML SHA') raw.document_xml.sha256 = 'b'.repeat(64);
    if (target === 'CRC') raw.shape.crc32 = '00000000';
    if (target === 'material resolution') raw.material.resolution_performed = true;
    if (target === 'material mass') raw.material.mass_kg = 1;
    if (target === 'scope') raw.dependency_scope = 'restored_document_structure';
    if (target === 'node') raw.entity.node = 'AnotherFeature';
    const result = await extractSavedShapeSnapshot(root, forged);
    expect(result).toEqual({ status: 'manual', reason_codes: ['manifest_mismatch'] });
  });
  it('rejects an accessor/oversized or unknown canonical field without executing it or serializing geometry', async () => {
    const root = fixture(archive(materialXml())), m = await prepared(root), getter = vi.fn(() => 'secret');
    const accessor = structuredClone(m); Object.defineProperty(accessor.material, 'uuid_raw', { get: getter, enumerable: true });
    expect(await extractSavedShapeSnapshot(root, accessor)).toEqual({ status: 'manual', reason_codes: ['manifest_mismatch'] }); expect(getter).not.toHaveBeenCalled();
    const oversized = structuredClone(m) as unknown as { material: { uuid_raw: string } }; oversized.material.uuid_raw = 'x'.repeat(1024 * 1024);
    expect(await extractSavedShapeSnapshot(root, oversized as unknown as SingleFeatureManifest)).toEqual({ status: 'manual', reason_codes: ['manifest_mismatch'] });
    const unknown = { ...m, geometry: opaqueShape };
    expect(await extractSavedShapeSnapshot(root, unknown)).toEqual({ status: 'manual', reason_codes: ['manifest_mismatch'] });
  });
  it.each(['shape SHA', 'XML SHA', 'material UUID', 'member path', 'source SHA'] as const)('rechecks complete evidence, not merely a caller-rehashed digest: %s', async target => {
    const root = fixture(archive(materialXml())), original = await prepared(root);
    const changed = structuredClone(original) as unknown as { manifest_sha256: string; shape: { sha256: string; member_path: string }; document_xml: { sha256: string }; source: { sha256: string }; material: { uuid_raw: string } };
    if (target === 'shape SHA') changed.shape.sha256 = 'a'.repeat(64);
    if (target === 'XML SHA') changed.document_xml.sha256 = 'a'.repeat(64);
    if (target === 'source SHA') changed.source.sha256 = 'a'.repeat(64);
    if (target === 'member path') changed.shape.member_path = 'Other.Shape.brp';
    if (target === 'material UUID') changed.material.uuid_raw = 'ecf90bf3-cbd2-4b77-964d-3351caf59392';
    const forged = changed as unknown as SingleFeatureManifest; changed.manifest_sha256 = sha(canonicalSingleFeatureManifestPayload(forged));
    expect(await extractSavedShapeSnapshot(root, forged)).toEqual({ status: 'manual', reason_codes: ['manifest_mismatch'] });
  });
  it('extractor rejects mid-read source changes and pre-abort without returning geometry', async () => {
    const root = fixture(archive(materialXml())), m = await prepared(root), controller = new AbortController(); controller.abort();
    const spy = vi.spyOn(filesystem, 'readBoundedFile');
    expect(await extractSavedShapeSnapshot(root, m, { signal: controller.signal })).toEqual({ status: 'manual', reason_codes: ['cancelled'] }); expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
    const read = filesystem.readBoundedFile; let changed = false;
    vi.spyOn(filesystem, 'readBoundedFile').mockImplementation((...args) => {
      const result = read(...args); if (!changed) { changed = true; fs.writeFileSync(path.join(root, 'Example.FCStd'), archive(materialXml().replace('independent format fixture', 'changed while inspecting'))); } return result;
    });
    expect(await extractSavedShapeSnapshot(root, m)).toEqual({ status: 'manual', reason_codes: ['source_changed'] }); expect(changed).toBe(true);
  });
  it('extractor cancellation after a real first read releases no geometry', async () => {
    const root = fixture(archive(materialXml())), m = await prepared(root), controller = new AbortController(), read = filesystem.readBoundedFile;
    vi.spyOn(filesystem, 'readBoundedFile').mockImplementation((...args) => { const result = read(...args); controller.abort(); return result; });
    expect(await extractSavedShapeSnapshot(root, m, { signal: controller.signal })).toEqual({ status: 'manual', reason_codes: ['cancelled'] });
  });
});
