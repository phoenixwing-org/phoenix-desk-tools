import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { CompanionFsError, readBoundedFile, validateRelative } from '../cad-companions/filesystem.js';
import { decodeCadXmlAttribute } from '../cad-object-info/document.js';

/** This is an intentionally narrow saved-file profile, NOT a general FCStd dependency resolver.
 * A ready manifest proves neither a valid solid nor restored-document/recompute semantics.
 * The opaque Shape bytes are never executed, repaired, or measured here. */
export const SINGLE_FEATURE_MANIFEST_ALGORITHM = 'single-feature-saved-manifest-v2' as const;
export const SINGLE_FEATURE_MANIFEST_LIMITS = Object.freeze({ source: 64 * 1024 * 1024, xml: 1024 * 1024, shape: 32 * 1024 * 1024, members: 32, xmlNodes: 2048, xmlDepth: 12 });
export type NativeMeasurementProfile = 'restored_document' | 'saved_brep_snapshot';
export type NativeManifestReason = 'invalid_selection' | 'unsafe_source' | 'unreadable_source' | 'source_changed' | 'cancelled' | 'resource_limit'
  | 'invalid_archive' | 'duplicate_member' | 'unsupported_archive' | 'invalid_xml' | 'unsupported_document_structure' | 'unsupported_property'
  | 'unsupported_object_type' | 'selection_mismatch' | 'unsupported_shape_carrier' | 'missing_shape_member' | 'unsupported_member'
  | 'invalid_shape_payload' | 'material_resolution_required' | 'invalid_material_metadata' | 'profile_mismatch' | 'manifest_mismatch';
export type SavedMaterialMetadata = {
  readonly uuid_raw: string;
  readonly state: 'nil' | 'unresolved_metadata_only';
  readonly resolution_performed: false;
  readonly density_kg_m3: null;
  readonly mass_kg: null;
};
export type SingleFeatureManifestPayload = {
  readonly schema_version: 1;
  readonly algorithm_version: typeof SINGLE_FEATURE_MANIFEST_ALGORITHM;
  readonly measurement_profile: NativeMeasurementProfile;
  readonly source: { readonly rel: string; readonly bytes: number; readonly sha256: string };
  readonly document_xml: { readonly bytes: number; readonly sha256: string };
  readonly entity: { readonly node: string; readonly type_id: 'Part::Feature'; readonly shape_property: 'Shape'; readonly shape_property_type: 'Part::PropertyPartShape' };
  readonly shape: { readonly basis: 'serialized_shape_snapshot'; readonly member_path: string; readonly bytes: number; readonly sha256: string; readonly crc32: string; readonly compression: 'stored' | 'deflate' };
  readonly dependencies: readonly [];
  readonly dependency_check: 'strict_self_contained_single_feature_v1' | 'strict_saved_shape_carrier_v1';
  readonly dependency_scope: 'restored_document_structure' | 'saved_shape_carrier';
  readonly engine_asset_dependencies: 'not_attested';
  readonly material: SavedMaterialMetadata;
  readonly restored_document: { readonly verified: false };
  readonly native_executed: false;
};
export type SingleFeatureManifest = SingleFeatureManifestPayload & { readonly manifest_sha256: string };
export type SingleFeatureManifestResult = { status: 'ready'; manifest: SingleFeatureManifest } | { status: 'manual'; reason_codes: NativeManifestReason[] };
export type SingleFeatureManifestInput = { rel: string; node: string; profile?: NativeMeasurementProfile; signal?: AbortSignal };
/** Host memory only, NOT a database/wire DTO. The caller must hash its exact staged copy again.
 * Never serialize shape into a run, log, receipt or public response. */
export type SavedShapeSnapshotResult = { status: 'ready'; manifest: SingleFeatureManifest; shape: Buffer } | { status: 'manual'; reason_codes: NativeManifestReason[] };

/** Fixed projection; callers still have to re-prepare and compare the complete payload, not trust a supplied digest. */
export function canonicalSingleFeatureManifestPayload(m: SingleFeatureManifestPayload): string {
  validateManifestPayload(m);
  return JSON.stringify({ schema_version: m.schema_version, algorithm_version: m.algorithm_version, measurement_profile: m.measurement_profile,
    source: { rel: m.source.rel, bytes: m.source.bytes, sha256: m.source.sha256 }, document_xml: { bytes: m.document_xml.bytes, sha256: m.document_xml.sha256 },
    entity: { node: m.entity.node, type_id: m.entity.type_id, shape_property: m.entity.shape_property, shape_property_type: m.entity.shape_property_type },
    shape: { basis: m.shape.basis, member_path: m.shape.member_path, bytes: m.shape.bytes, sha256: m.shape.sha256, crc32: m.shape.crc32, compression: m.shape.compression },
    dependencies: [], dependency_check: m.dependency_check, dependency_scope: m.dependency_scope, engine_asset_dependencies: m.engine_asset_dependencies,
    material: { uuid_raw: m.material.uuid_raw, state: m.material.state, resolution_performed: false, density_kg_m3: null, mass_kg: null },
    restored_document: { verified: m.restored_document.verified }, native_executed: m.native_executed });
}
class Rejected extends Error { constructor(readonly code: NativeManifestReason) { super(code); } }
function reject(code: NativeManifestReason): never { throw new Rejected(code); }
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
function active(signal?: AbortSignal) { if (signal?.aborted) reject('cancelled'); }
function freeze<T extends object>(v: T): T { Object.freeze(v); for (const c of Object.values(v)) if (c && typeof c === 'object') freeze(c); return v; }
const crcTable = Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(data: Buffer): number { let n = 0xffffffff; for (const b of data) n = crcTable[(n ^ b) & 255] ^ n >>> 8; return (n ^ 0xffffffff) >>> 0; }
type Member = { name: string; start: number; compressed: number; bytes: number; crc: number; method: number };
function utf8(data: Buffer, reason: NativeManifestReason): string {
  try { const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); if (!Buffer.from(value).equals(data)) reject(reason); return value; }
  catch { return reject(reason); }
}
function safeMember(name: string) {
  return !!name && Buffer.byteLength(name) <= 255 && name === name.normalize('NFC') && !/[\\/:\p{Cc}\p{Cf}\p{Cs}]/u.test(name)
    && name !== '.' && name !== '..' && !name.startsWith('.');
}
/** Validate ALL indexed headers before trusting the XML. Extra records/members are not assumed harmless. */
function archive(data: Buffer): Map<string, Member> {
  const bad = () => reject('invalid_archive');
  if (data.length < 22) bad();
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  }
  if (end < 0) bad();
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) reject('unsupported_archive');
  const count = data.readUInt16LE(end + 10), centralSize = data.readUInt32LE(end + 12), centralStart = data.readUInt32LE(end + 16);
  if (!count || count > SINGLE_FEATURE_MANIFEST_LIMITS.members) reject('resource_limit');
  if (count !== data.readUInt16LE(end + 8) || centralStart + centralSize !== end) bad();
  const result = new Map<string, Member>(), folded = new Set<string>();
  let p = centralStart, localEnd = 0, totalBytes = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || data.readUInt32LE(p) !== 0x02014b50) bad();
    const needed = data.readUInt16LE(p + 6), flags = data.readUInt16LE(p + 8), method = data.readUInt16LE(p + 10);
    const crc = data.readUInt32LE(p + 16), compressed = data.readUInt32LE(p + 20), bytes = data.readUInt32LE(p + 24);
    const nameLen = data.readUInt16LE(p + 28), extra = data.readUInt16LE(p + 30), comment = data.readUInt16LE(p + 32), offset = data.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extra + comment > end) bad();
    if (needed > 20 || flags & ~0x800 || ![0, 8].includes(method) || extra || data.readUInt16LE(p + 34)) reject('unsupported_archive');
    const mode = data.readUInt32LE(p + 38) >>> 16;
    if (mode && (mode & 0xf000) !== 0x8000 || data.readUInt32LE(p + 38) & 0x10) reject('unsupported_archive');
    const nameRaw = data.subarray(p + 46, p + 46 + nameLen), name = utf8(nameRaw, 'invalid_archive');
    if (!(flags & 0x800) && nameRaw.some(b => b >= 128) || !safeMember(name)) reject('unsupported_member');
    const normalized = name.normalize('NFC').toLowerCase();
    if (result.has(name) || folded.has(normalized)) reject('duplicate_member');
    folded.add(normalized);
    if (offset !== localEnd || offset + 30 > centralStart || data.readUInt32LE(offset) !== 0x04034b50) bad();
    const localNameLen = data.readUInt16LE(offset + 26), localExtra = data.readUInt16LE(offset + 28);
    if (localExtra || offset + 30 + localNameLen + localExtra > centralStart) reject('unsupported_archive');
    if (data.readUInt16LE(offset + 4) !== needed || data.readUInt16LE(offset + 6) !== flags || data.readUInt16LE(offset + 8) !== method
      || data.readUInt32LE(offset + 14) !== crc || data.readUInt32LE(offset + 18) !== compressed || data.readUInt32LE(offset + 22) !== bytes
      || !data.subarray(offset + 30, offset + 30 + localNameLen).equals(nameRaw)) bad();
    const start = offset + 30 + localNameLen;
    localEnd = start + compressed;
    if (localEnd > centralStart || bytes > SINGLE_FEATURE_MANIFEST_LIMITS.shape) reject('resource_limit');
    totalBytes += bytes;
    if (totalBytes > SINGLE_FEATURE_MANIFEST_LIMITS.source) reject('resource_limit');
    result.set(name, { name, start, compressed, bytes, crc, method });
    p += 46 + nameLen + extra + comment;
  }
  if (p !== end || localEnd !== centralStart) bad();
  return result;
}
function payload(data: Buffer, m: Member, max: number, reason: NativeManifestReason): Buffer {
  if (!m.bytes || m.bytes > max) reject('resource_limit');
  const raw = data.subarray(m.start, m.start + m.compressed);
  let bytes: Buffer;
  try {
    if (m.method === 0) bytes = raw;
    else {
      // Node's Buffer overload does not model the runtime info:true result.
      const inflated = inflateRawSync(raw, { maxOutputLength: m.bytes + 1, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      if (!inflated || !Buffer.isBuffer(inflated.buffer) || inflated.engine?.bytesWritten !== raw.length) reject(reason);
      bytes = inflated.buffer;
    }
  } catch { return reject(reason); }
  if (bytes.length !== m.bytes || crc32(bytes) !== m.crc) reject(reason);
  return bytes;
}

type Xml = { tag: string; attrs: Record<string, string>; children: Xml[] };
/** Small non-resolving XML subset. No character data, general/external entity declarations,
 * CDATA, DTD, or processing instructions beyond the initial declaration. */
function tree(xml: string): Xml {
  if (xml.startsWith('\ufeff')) reject('invalid_xml');
  for (const c of xml) { const n = c.codePointAt(0)!; if (!(n === 9 || n === 10 || n === 13 || n >= 0x20 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff)) reject('invalid_xml'); }
  xml = xml.replace(/^<\?xml[ \t\r\n]+version=(?:"1\.0"|'1\.0')[ \t\r\n]+encoding=(?:"utf-8"|'utf-8')[ \t\r\n]*\?>/i, '');
  // XML S is only space/tab/CR/LF, not JavaScript's broader \s or trim set.
  const tokens = /<!--[\s\S]*?-->|<\/?[A-Za-z_][\w.-]*(?:[ \t\r\n]+[A-Za-z_][\w.-]*[ \t\r\n]*=[ \t\r\n]*(?:"[^"<]*"|'[^'<]*'))*[ \t\r\n]*\/?>/g;
  let end = 0, count = 0, root: Xml | undefined;
  const stack: Xml[] = [];
  for (const match of xml.matchAll(tokens)) {
    if (++count > SINGLE_FEATURE_MANIFEST_LIMITS.xmlNodes) reject('resource_limit');
    if (!/^[ \t\r\n]*$/.test(xml.slice(end, match.index))) reject('invalid_xml');
    end = match.index! + match[0].length;
    const token = match[0];
    if (token.startsWith('<!--')) { if (token.slice(4, -3).includes('--') || token.slice(4, -3).endsWith('-')) reject('invalid_xml'); continue; }
    if (token.startsWith('</')) { const close = /^<\/([A-Za-z_][\w.-]*)[ \t\r\n]*>$/.exec(token); if (!close || !stack.length || stack.pop()!.tag !== close[1]) reject('invalid_xml'); continue; }
    const tag = /^<([\w.-]+)/.exec(token)![1], attrs: Record<string, string> = Object.create(null);
    for (const a of token.matchAll(/([A-Za-z_][\w.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/g)) {
      if (Object.hasOwn(attrs, a[1])) reject('invalid_xml');
      try { attrs[a[1]] = decodeCadXmlAttribute(a[2] ?? a[3]); } catch { reject('invalid_xml'); }
    }
    const item = { tag, attrs, children: [] as Xml[] };
    if (stack.length) stack.at(-1)!.children.push(item); else { if (root) reject('invalid_xml'); root = item; }
    if (!token.endsWith('/>')) stack.push(item);
    if (stack.length > SINGLE_FEATURE_MANIFEST_LIMITS.xmlDepth) reject('resource_limit');
  }
  if (!/^[ \t\r\n]*$/.test(xml.slice(end)) || stack.length || !root) reject('invalid_xml');
  return root;
}
function attrs(n: Xml, required: string[], optional: string[] = [], reason: NativeManifestReason = 'unsupported_document_structure') {
  if (required.some(k => !Object.hasOwn(n.attrs, k)) || Object.keys(n.attrs).some(k => !required.includes(k) && !optional.includes(k))) reject(reason);
}
function leaf(n: Xml, tag: string, required: string[], optional: string[] = [], reason: NativeManifestReason = 'unsupported_property') {
  if (n.tag !== tag || n.children.length) reject(reason); attrs(n, required, optional, reason);
}
function count(value: string | undefined): number { if (!value || !/^(?:0|[1-9][0-9]{0,4})$/.test(value)) reject('unsupported_document_structure'); return Number(value); }
function properties(n: Xml): Map<string, Xml> {
  if (n.tag !== 'Properties') reject('unsupported_document_structure'); attrs(n, ['Count'], ['TransientCount']);
  if (count(n.attrs.Count) !== n.children.filter(p => p.tag === 'Property').length
    || count(n.attrs.TransientCount ?? '0') !== n.children.filter(p => p.tag === '_Property').length) reject('unsupported_document_structure');
  const result = new Map<string, Xml>();
  for (const p of n.children) {
    if (!['Property', '_Property'].includes(p.tag)) reject('unsupported_property');
    attrs(p, ['name', 'type'], ['status'], 'unsupported_property');
    if (result.has(p.attrs.name)) reject('unsupported_property');
    if (p.attrs.status !== undefined && !/^[0-9]{1,10}$/.test(p.attrs.status)) reject('unsupported_property');
    result.set(p.attrs.name, p);
  }
  return result;
}
function typed(p: Xml, type: string): Xml { if (p.tag !== 'Property' || p.attrs.type !== type || p.children.length !== 1) reject('unsupported_property'); return p.children[0]; }
function stringProperty(p: Xml) { leaf(typed(p, 'App::PropertyString'), 'String', ['value']); }
function boolProperty(p: Xml) { const b = typed(p, 'App::PropertyBool'); leaf(b, 'Bool', ['value']); if (!['true', 'false'].includes(b.attrs.value)) reject('unsupported_property'); }
function emptyMap(p: Xml) { const m = typed(p, 'App::PropertyMap'); leaf(m, 'Map', ['count']); if (m.attrs.count !== '0') reject('unsupported_property'); }
const nilUuid = /^00000000-0000-0000-0000-000000000000$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function inertRecord(value: unknown, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('manifest_mismatch');
  const keys = Reflect.ownKeys(value);
  if (keys.length > required.length + optional.length || required.some(k => !Object.hasOwn(value, k)) || keys.some(k => typeof k !== 'string' || !required.includes(k) && !optional.includes(k))) reject('manifest_mismatch');
  for (const k of keys) { const d = Object.getOwnPropertyDescriptor(value, k); if (!d || !('value' in d) || !d.enumerable) reject('manifest_mismatch'); }
}
/** Keep externally supplied projections inert and bounded before stringify/comparison. */
function validateManifestPayload(m: SingleFeatureManifestPayload) {
  inertRecord(m, ['schema_version', 'algorithm_version', 'measurement_profile', 'source', 'document_xml', 'entity', 'shape', 'dependencies', 'dependency_check', 'dependency_scope', 'engine_asset_dependencies', 'material', 'restored_document', 'native_executed'], ['manifest_sha256']);
  inertRecord(m.source, ['rel', 'bytes', 'sha256']); inertRecord(m.document_xml, ['bytes', 'sha256']);
  inertRecord(m.entity, ['node', 'type_id', 'shape_property', 'shape_property_type']);
  inertRecord(m.shape, ['basis', 'member_path', 'bytes', 'sha256', 'crc32', 'compression']);
  inertRecord(m.material, ['uuid_raw', 'state', 'resolution_performed', 'density_kg_m3', 'mass_kg']); inertRecord(m.restored_document, ['verified']);
  const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const bytes = (v: number, max: number) => Number.isSafeInteger(v) && v > 0 && v <= max;
  if (m.schema_version !== 1 || m.algorithm_version !== SINGLE_FEATURE_MANIFEST_ALGORITHM || !['restored_document', 'saved_brep_snapshot'].includes(m.measurement_profile)) reject('manifest_mismatch');
  if (typeof m.source.rel !== 'string' || !/\.FCStd$/i.test(m.source.rel) || !bytes(m.source.bytes, SINGLE_FEATURE_MANIFEST_LIMITS.source) || !digest(m.source.sha256)
    || !bytes(m.document_xml.bytes, SINGLE_FEATURE_MANIFEST_LIMITS.xml) || !digest(m.document_xml.sha256)) reject('manifest_mismatch');
  try { validateRelative(m.source.rel); } catch { reject('manifest_mismatch'); }
  if (typeof m.entity.node !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(m.entity.node) || m.entity.type_id !== 'Part::Feature' || m.entity.shape_property !== 'Shape' || m.entity.shape_property_type !== 'Part::PropertyPartShape') reject('manifest_mismatch');
  if (m.shape.basis !== 'serialized_shape_snapshot' || typeof m.shape.member_path !== 'string' || !safeMember(m.shape.member_path) || !/\.brp$/i.test(m.shape.member_path)
    || !bytes(m.shape.bytes, SINGLE_FEATURE_MANIFEST_LIMITS.shape) || !digest(m.shape.sha256) || typeof m.shape.crc32 !== 'string' || !/^[a-f0-9]{8}$/.test(m.shape.crc32) || !['stored', 'deflate'].includes(m.shape.compression)) reject('manifest_mismatch');
  if (typeof m.material.uuid_raw !== 'string' || !uuid.test(m.material.uuid_raw) || m.material.state !== (nilUuid.test(m.material.uuid_raw) ? 'nil' : 'unresolved_metadata_only')
    || m.material.resolution_performed !== false || m.material.density_kg_m3 !== null || m.material.mass_kg !== null) reject('manifest_mismatch');
  const snapshot = m.measurement_profile === 'saved_brep_snapshot';
  if (!snapshot && m.material.state !== 'nil' || m.dependency_check !== (snapshot ? 'strict_saved_shape_carrier_v1' : 'strict_self_contained_single_feature_v1')
    || m.dependency_scope !== (snapshot ? 'saved_shape_carrier' : 'restored_document_structure') || m.engine_asset_dependencies !== 'not_attested'
    || !Array.isArray(m.dependencies) || Object.getPrototypeOf(m.dependencies) !== Array.prototype || m.dependencies.length !== 0 || Reflect.ownKeys(m.dependencies).length !== 1
    || m.restored_document.verified !== false || m.native_executed !== false) reject('manifest_mismatch');
  if (Object.hasOwn(m, 'manifest_sha256') && !digest((m as SingleFeatureManifest).manifest_sha256)) reject('manifest_mismatch');
}
function documentProfile(xml: string, node: string, profile: NativeMeasurementProfile): { member: string; material: SavedMaterialMetadata } {
  const d = tree(xml);
  if (d.tag !== 'Document') reject('unsupported_document_structure'); attrs(d, ['SchemaVersion', 'ProgramVersion', 'FileVersion'], ['StringHasher']);
  if (d.attrs.SchemaVersion !== '4' || d.attrs.FileVersion !== '1' || d.attrs.StringHasher !== undefined && !['0', '1'].includes(d.attrs.StringHasher)) reject('unsupported_document_structure');
  const groups = new Map<string, Xml>();
  for (const c of d.children) { if (groups.has(c.tag)) reject('unsupported_document_structure'); groups.set(c.tag, c); }
  if (groups.size !== 3 + (groups.has('StringHasher') ? 1 : 0) || !groups.has('Properties') || !groups.has('Objects') || !groups.has('ObjectData')) reject('unsupported_document_structure');
  const hasher = groups.get('StringHasher');
  if (hasher) { leaf(hasher, 'StringHasher', ['saveall', 'threshold', 'count']); if (Object.values(hasher.attrs).some(v => v !== '0')) reject('unsupported_document_structure'); }
  if (d.attrs.StringHasher === '1' && !hasher) reject('unsupported_document_structure');
  const strings = new Set(['Comment', 'Company', 'CreatedBy', 'CreationDate', 'Id', 'Label', 'LastModifiedBy', 'LastModifiedDate', 'License', 'LicenseURL', 'TipName']);
  for (const [name, p] of properties(groups.get('Properties')!)) {
    if (p.tag === '_Property') {
      if (!['FileName', 'TransientDir', 'Tip'].includes(name) || p.children.length || p.attrs.type !== (name === 'Tip' ? 'App::PropertyLink' : 'App::PropertyString')) reject('unsupported_property');
    } else if (strings.has(name)) {
      stringProperty(p);
      if (name === 'TipName' && p.children[0].attrs.value && p.children[0].attrs.value !== node) reject('unsupported_property');
    } else if (['Meta', 'Material'].includes(name)) emptyMap(p);
    else if (['ShowHidden', 'UseHasher'].includes(name)) boolProperty(p);
    else if (name === 'Uid') { const u = typed(p, 'App::PropertyUUID'); leaf(u, 'Uuid', ['value']); if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(u.attrs.value)) reject('unsupported_property'); }
    else if (name === 'UnitSystem') {
      if (p.attrs.type !== 'App::PropertyEnumeration' || p.children.length !== 2) reject('unsupported_property');
      leaf(p.children[0], 'Integer', ['value', 'CustomEnum']); const list = p.children[1]; attrs(list, ['count']);
      if (list.tag !== 'CustomEnumList' || p.children[0].attrs.CustomEnum !== 'true' || !/^[0-9]{1,2}$/.test(p.children[0].attrs.value)
        || count(list.attrs.count) !== list.children.length || !list.children.length || list.children.length > 32 || Number(p.children[0].attrs.value) >= list.children.length) reject('unsupported_property');
      for (const e of list.children) leaf(e, 'Enum', ['value']);
    } else reject('unsupported_property');
  }
  const objects = groups.get('Objects')!; attrs(objects, ['Count'], ['Dependencies']);
  if (objects.attrs.Count !== '1') reject('unsupported_object_type');
  const declarations = objects.children.filter(o => o.tag === 'Object'), deps = objects.children.filter(o => o.tag === 'ObjectDeps');
  if (declarations.length !== 1 || declarations.length + deps.length !== objects.children.length || deps.length > 1) reject('unsupported_document_structure');
  if (objects.attrs.Dependencies !== undefined && objects.attrs.Dependencies !== String(deps.length)) reject('unsupported_document_structure');
  const obj = declarations[0]; leaf(obj, 'Object', ['type', 'name'], ['id']);
  if (obj.attrs.type !== 'Part::Feature') reject('unsupported_object_type');
  if (obj.attrs.name !== node) reject('selection_mismatch');
  for (const dep of deps) { leaf(dep, 'ObjectDeps', ['Name', 'Count']); if (dep.attrs.Name !== node || dep.attrs.Count !== '0') reject('unsupported_document_structure'); }
  const objectData = groups.get('ObjectData')!; attrs(objectData, ['Count']);
  if (objectData.attrs.Count !== '1' || objectData.children.length !== 1) reject('unsupported_document_structure');
  const saved = objectData.children[0]; attrs(saved, ['name']);
  if (saved.tag !== 'Object' || saved.attrs.name !== node || saved.children.length !== 1) reject('selection_mismatch');
  const props = properties(saved.children[0]);
  for (const required of ['Shape', 'Placement', 'ExpressionEngine', 'ShapeMaterial']) if (!props.has(required)) reject('unsupported_property');
  let member = '', materialUuid = '';
  for (const [name, p] of props) {
    if (name === '_ElementMapVersion') { if (p.tag !== '_Property' || p.attrs.type !== 'App::PropertyString' || p.children.length) reject('unsupported_property'); }
    else if (['Label', 'Label2'].includes(name)) stringProperty(p);
    else if (name === 'Visibility') boolProperty(p);
    else if (name === 'ExpressionEngine') { const e = typed(p, 'App::PropertyExpressionEngine'); leaf(e, 'ExpressionEngine', ['count']); if (e.attrs.count !== '0') reject('unsupported_property'); }
    else if (name === 'Placement') {
      const placement = typed(p, 'App::PropertyPlacement');
      leaf(placement, 'PropertyPlacement', ['Px', 'Py', 'Pz', 'Q0', 'Q1', 'Q2', 'Q3', 'A', 'Ox', 'Oy', 'Oz']);
      for (const [k, value] of Object.entries(placement.attrs)) {
        if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/i.test(value) || !Number.isFinite(Number(value)) || Number(value) !== (['Q3', 'Oz'].includes(k) ? 1 : 0)) reject('unsupported_property');
      }
    } else if (name === 'ShapeMaterial') {
      const material = typed(p, 'Materials::PropertyMaterial'); leaf(material, 'PropertyMaterial', ['uuid']);
      materialUuid = material.attrs.uuid;
      if (profile === 'restored_document' && !nilUuid.test(materialUuid)) reject('material_resolution_required');
      if (!uuid.test(materialUuid)) reject('invalid_material_metadata');
    } else if (name === 'Shape') {
      if (p.tag !== 'Property' || p.attrs.type !== 'Part::PropertyPartShape' || ![1, 2].includes(p.children.length)) reject('unsupported_shape_carrier');
      const part = p.children[0]; leaf(part, 'Part', ['file'], ['ElementMap'], 'unsupported_shape_carrier');
      if (part.attrs.ElementMap !== undefined && !/^[0-9]+(?:\.[0-9]+){1,5}$/.test(part.attrs.ElementMap)) reject('unsupported_shape_carrier');
      if (p.children[1]) leaf(p.children[1], 'ElementMap', [], [], 'unsupported_shape_carrier');
      if (!safeMember(part.attrs.file) || !/\.brp$/i.test(part.attrs.file)) reject('unsupported_shape_carrier');
      member = part.attrs.file;
    } else reject('unsupported_property');
  }
  return { member, material: { uuid_raw: materialUuid, state: nilUuid.test(materialUuid) ? 'nil' : 'unresolved_metadata_only', resolution_performed: false, density_kg_m3: null, mass_kg: null } };
}

async function inspect(root: string, input: SingleFeatureManifestInput): Promise<{ manifest: SingleFeatureManifest; shape: Buffer }> {
    const { rel, node, signal, profile = 'restored_document' } = input ?? {};
    active(signal);
    if (!['restored_document', 'saved_brep_snapshot'].includes(profile)) reject('profile_mismatch');
    if (typeof node !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(node) || typeof rel !== 'string' || !/\.FCStd$/i.test(rel)) reject('invalid_selection');
    validateRelative(rel);
    const source = readBoundedFile(root, rel, SINGLE_FEATURE_MANIFEST_LIMITS.source, signal);
    const members = archive(source.data), xmlMember = members.get('Document.xml');
    if (!xmlMember) reject('invalid_archive');
    const xml = payload(source.data, xmlMember, SINGLE_FEATURE_MANIFEST_LIMITS.xml, 'invalid_xml');
    const parsed = documentProfile(utf8(xml, 'invalid_xml'), node, profile), memberPath = parsed.member, shapeMember = members.get(memberPath);
    if (!shapeMember) reject('missing_shape_member');
    if (memberPath === 'Document.xml' || members.size !== 2) reject('unsupported_member');
    const shape = payload(source.data, shapeMember, SINGLE_FEATURE_MANIFEST_LIMITS.shape, 'invalid_shape_payload');
    active(signal);
    // Give cancellation/source-change observers a turn; execution MUST re-prepare independently later.
    await new Promise<void>(resolve => setImmediate(resolve));
    const after = readBoundedFile(root, rel, SINGLE_FEATURE_MANIFEST_LIMITS.source, signal);
    if (after.bytes !== source.bytes || after.sha256 !== source.sha256) reject('source_changed');
    const payloadDto: SingleFeatureManifestPayload = {
      schema_version: 1, algorithm_version: SINGLE_FEATURE_MANIFEST_ALGORITHM, measurement_profile: profile,
      source: { rel, bytes: source.bytes, sha256: source.sha256 }, document_xml: { bytes: xml.length, sha256: sha(xml) },
      entity: { node, type_id: 'Part::Feature', shape_property: 'Shape', shape_property_type: 'Part::PropertyPartShape' },
      shape: { basis: 'serialized_shape_snapshot', member_path: memberPath, bytes: shape.length, sha256: sha(shape), crc32: shapeMember.crc.toString(16).padStart(8, '0'), compression: shapeMember.method === 0 ? 'stored' : 'deflate' },
      dependencies: [], dependency_check: profile === 'saved_brep_snapshot' ? 'strict_saved_shape_carrier_v1' : 'strict_self_contained_single_feature_v1',
      dependency_scope: profile === 'saved_brep_snapshot' ? 'saved_shape_carrier' : 'restored_document_structure', engine_asset_dependencies: 'not_attested', material: parsed.material,
      restored_document: { verified: false }, native_executed: false,
    };
    return { manifest: freeze({ ...payloadDto, manifest_sha256: sha(canonicalSingleFeatureManifestPayload(payloadDto)) }), shape };
}
function manualResult(error: unknown): { status: 'manual'; reason_codes: NativeManifestReason[] } {
  if (error instanceof Rejected) return { status: 'manual', reason_codes: [error.code] };
  if (error instanceof CompanionFsError) return { status: 'manual', reason_codes: [{ unsafe: 'unsafe_source', unreadable: 'unreadable_source', invalid_encoding: 'invalid_xml', changed: 'source_changed', cancelled: 'cancelled', limit: 'resource_limit' }[error.code] as NativeManifestReason] };
  return { status: 'manual', reason_codes: ['invalid_archive'] };
}
export async function prepareSingleFeatureManifest(root: string, input: SingleFeatureManifestInput): Promise<SingleFeatureManifestResult> {
  try { const checked = await inspect(root, input); return { status: 'ready', manifest: checked.manifest }; }
  catch (error) { return manualResult(error); }
}
/** Explicit snapshot-only extraction. Never falls back from a failed restored profile and never
 * restores a document or resolves materials. Every call rechecks the full archive and canonical binding. */
export async function extractSavedShapeSnapshot(root: string, requested: SingleFeatureManifest, options: { signal?: AbortSignal } = {}): Promise<SavedShapeSnapshotResult> {
  try {
    const signal = options.signal;
    active(signal);
    const claimedPayload = canonicalSingleFeatureManifestPayload(requested), claimedDigest = requested.manifest_sha256;
    if (requested.measurement_profile !== 'saved_brep_snapshot') reject('profile_mismatch');
    if (sha(claimedPayload) !== claimedDigest) reject('manifest_mismatch');
    const checked = await inspect(root, { rel: requested.source.rel, node: requested.entity.node, profile: 'saved_brep_snapshot', signal });
    if (checked.manifest.manifest_sha256 !== claimedDigest || canonicalSingleFeatureManifestPayload(checked.manifest) !== claimedPayload) reject('manifest_mismatch');
    active(signal);
    return { status: 'ready', manifest: checked.manifest, shape: Buffer.from(checked.shape) };
  } catch (error) { return manualResult(error); }
}
