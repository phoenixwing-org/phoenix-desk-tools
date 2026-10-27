import fs from 'node:fs';
import path from 'node:path';
import type {CadNameIdentity, CompanionRequest, FrozenDrawingOutputGroup, SidecarProvenance} from '../../../../shared/cad-companion/contracts.js';
import {parseCadIdentity, proposeCompanionFilename, sameCadBindingIdentity} from '../../../../shared/cad-companion/model.js';
import {assertRoot, CompanionFsError, listDirectory, MAX_COMPANION_BYTES, MAX_COMPANION_CANDIDATES, readBoundedFile, safeRelative, validateRelative} from './filesystem.js';

const MAX_SEQUENCE = 9999;
const MAX_MARKER_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const notesSuffix = '-出图说明.md';
const fold = (value: string) => value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
const directory = (rel: string) => path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
function invalid(message: string): never {throw new CompanionFsError('unsafe', message);}
const sequence = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= MAX_SEQUENCE;
function filename(rel: string): string {
  validateRelative(rel);
  const name = path.posix.basename(rel);
  if (Buffer.byteLength(name, 'utf8') > 255) invalid('输出文件名超过 255 字节');
  return name;
}
function bindingIdentity(binding: CompanionRequest): CadNameIdentity {
  if (!binding || binding.purpose !== 'drawing_notes' || !binding.identity || !/\.fcstd$/i.test(binding.source_rel)) invalid('需要明确的源模型及出图说明绑定');
  const parsed = parseCadIdentity(filename(binding.source_rel));
  if (!['model', 'assembly'].includes(parsed.role)) invalid('新出图源仅支持模型或总成，不接受既有图纸');
  if (parsed.parseStatus !== 'parsed' || binding.identity.parseStatus !== 'parsed' || !sameCadBindingIdentity(parsed, binding.identity)
    || parsed.draftSequence !== binding.identity.draftSequence || parsed.role !== binding.identity.role) invalid('源文件身份与绑定不一致，需重新预览');
  return parsed;
}
function plannedGroup(binding: CompanionRequest, draft: number): FrozenDrawingOutputGroup {
  const sourceIdentity = bindingIdentity(binding);
  if (!sequence(draft)) invalid('初稿序号必须为 1 至 9999 的整数');
  const proposal = proposeCompanionFilename(binding.identity, 'drawing_notes', {name: binding.name_override, draftSequence: draft});
  const notesName = proposal.filename;
  if (proposal.status !== 'ready' || notesName === null || !notesName.endsWith(notesSuffix)) invalid('无法无损生成输出名称，需人工确认');
  const folder = directory(binding.source_rel), prefix = folder ? `${folder}/` : '';
  // A reviewed Markdown name is not authorization to rename CAD/PDF outputs.
  // Use the original source basename, stripping only its parsed CAD role.
  const draftSuffix = draft === 1 ? '' : `-初稿${String(draft).padStart(2, '0')}`;
  const stem = sourceIdentity.rawStem + draftSuffix;
  const notesStem = notesName.slice(0, -notesSuffix.length);
  const drawing_rel = `${prefix}${stem}.Drawing.FCStd`, pdf_rel = `${prefix}${stem}.Drawing.pdf`, notes_rel = `${prefix}${notesName}`;
  for (const rel of [drawing_rel, pdf_rel]) {
    const name = filename(rel);
    if (name !== name.normalize('NFC')) invalid('新 CAD/PDF 文件名必须已经是 Unicode NFC，不能自动改写源基名');
  }
  if (binding.drawing_rel !== undefined && binding.drawing_rel !== drawing_rel) invalid('冻结图纸路径与出图绑定不一致');
  if (binding.explicit_aliases !== undefined && (!Array.isArray(binding.explicit_aliases) || binding.explicit_aliases.length > MAX_COMPANION_CANDIDATES)) {
    throw new CompanionFsError('limit', '显式别名超过候选预算');
  }
  const aliases = (binding.explicit_aliases ?? []).filter(alias => alias.purpose === 'drawing_notes').map(alias => {
    filename(alias.rel);
    if (directory(alias.rel) !== folder || !/\.md$/i.test(alias.rel)) invalid('出图说明别名必须在源文件同目录');
    return alias.rel;
  });
  const reserved_rels = [...new Set([drawing_rel, pdf_rel, notes_rel,
    `${prefix}${stem}.Drawing.ai.md`, `${prefix}${stem}.Drawing.md`, `${prefix}${stem}${notesSuffix}`,
    `${prefix}${notesStem}.Drawing.ai.md`, `${prefix}${notesStem}.Drawing.md`, ...aliases])];
  for (const rel of reserved_rels) filename(rel);
  if (new Set([drawing_rel, pdf_rel, notes_rel].map(fold)).size !== 3) invalid('三件输出名称发生碰撞');
  return {version: 1, binding: {...structuredClone(binding), draft_sequence: draft, drawing_rel}, draft_sequence: draft, drawing_rel, pdf_rel, notes_rel, reserved_rels};
}
function sourceExists(root: string, binding: CompanionRequest): void {
  const source = safeRelative(root, binding.source_rel);
  try {if (!fs.lstatSync(source).isFile()) invalid('源模型必须是普通文件');}
  catch (error) {if (error instanceof CompanionFsError) throw error; throw new CompanionFsError('unreadable', '源模型无法安全核对');}
}
function inventory(root: string, group: FrozenDrawingOutputGroup): ReturnType<typeof listDirectory> {
  const listing = listDirectory(root, directory(group.binding.source_rel));
  if (!listing.complete) throw new CompanionFsError('limit', '输出目录超过完整扫描预算，需人工确认');
  return listing;
}
function occupied(group: FrozenDrawingOutputGroup, names: string[]): boolean {
  const reserved = new Set(group.reserved_rels.map(rel => fold(path.posix.basename(rel))));
  return names.some(name => reserved.has(fold(name)));
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Initial planning only. Retrying execution must recheck its frozen group, never allocate again. */
export function allocateDrawingOutputGroup(workspace: string, binding: CompanionRequest, options: {allowNextDraft?: boolean} = {}): FrozenDrawingOutputGroup {
  const root = assertRoot(workspace);
  bindingIdentity(binding); sourceExists(root, binding);
  if (binding.draft_sequence !== undefined && !sequence(binding.draft_sequence)) invalid('初稿序号无效');
  const first = binding.draft_sequence ?? 1;
  const end = binding.draft_sequence === undefined && options.allowNextDraft === true ? MAX_SEQUENCE : first;
  const initial = plannedGroup(binding, first), listing = inventory(root, initial);
  for (let draft = first; draft <= end; draft++) {
    const group = draft === first ? initial : plannedGroup(binding, draft);
    if (occupied(group, listing.names)) continue;
    // A race after selection fails this preview; it must not silently select a new number.
    assertOutputGroupAbsent(root, group);
    return deepFreeze(group);
  }
  throw new CompanionFsError('unsafe', '输出或兼容说明名称已占位，需重新预览');
}
/** Read-only observation, not an atomic publication primitive or permission to overwrite. */
export function assertOutputGroupAbsent(workspace: string, group: FrozenDrawingOutputGroup): void {
  const root = assertRoot(workspace);
  if (!group || group.version !== 1 || group.binding?.draft_sequence !== group.draft_sequence) invalid('冻结输出组无效');
  const expected = plannedGroup(group.binding, group.draft_sequence);
  if (group.drawing_rel !== expected.drawing_rel || group.pdf_rel !== expected.pdf_rel || group.notes_rel !== expected.notes_rel
    || JSON.stringify(group.reserved_rels) !== JSON.stringify(expected.reserved_rels)) invalid('冻结输出组已改变');
  sourceExists(root, group.binding);
  const before = inventory(root, group);
  if (occupied(group, before.names)) invalid('输出或兼容说明名称已占位，需重新预览');
  for (const rel of group.reserved_rels) {
    const target = safeRelative(root, rel, {allowMissingLeaf: true});
    try {fs.lstatSync(target); invalid('输出或兼容说明名称已占位，需重新预览');}
    catch (error) {
      if (error instanceof CompanionFsError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CompanionFsError('unreadable', '输出占位无法安全核对');
    }
  }
  const after = inventory(root, group);
  if (JSON.stringify(before.proof) !== JSON.stringify(after.proof) || JSON.stringify(before.names) !== JSON.stringify(after.names)) {
    throw new CompanionFsError('changed', '输出目录在检查期间变化，需重新预览');
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function artifactPath(value: unknown, extension: RegExp): value is string {
  if (typeof value !== 'string' || !extension.test(value)) return false;
  try {filename(value); return true;} catch {return false;}
}
/** Shape validation is deliberately separate from current-file/binding verification. */
export function validateSidecarProvenance(value: unknown): SidecarProvenance | null {
  if (!isObject(value)) return null;
  const required = ['schema','version','generated_draft','source_rel','source_sha256','drawing_rel','drawing_sha256','pdf_rel','pdf_sha256','revisionRaw','variantRaw','draft_sequence','reference_pdf'];
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && key !== 'source_node')) return null;
  if (value.schema !== 'phoenix-cad-companion' || value.version !== 1 || value.generated_draft !== true
    || !artifactPath(value.source_rel, /\.fcstd$/i) || !artifactPath(value.drawing_rel, /\.drawing\.fcstd$/i) || !artifactPath(value.pdf_rel, /\.drawing\.pdf$/i)
    || !sha(value.source_sha256) || !sha(value.drawing_sha256) || !sha(value.pdf_sha256) || !text(value.revisionRaw, 128)
    || value.variantRaw !== null && !text(value.variantRaw, 128) || !sequence(value.draft_sequence)
    || Object.hasOwn(value, 'source_node') && !text(value.source_node)) return null;
  if (directory(value.source_rel) !== directory(value.drawing_rel) || directory(value.source_rel) !== directory(value.pdf_rel)
    || fold(value.source_rel) === fold(value.drawing_rel) || fold(value.drawing_rel.slice(0, -'.FCStd'.length)) !== fold(value.pdf_rel.slice(0, -'.pdf'.length))) return null;
  if (value.reference_pdf !== null && (!isObject(value.reference_pdf) || Object.keys(value.reference_pdf).sort().join(',') !== 'rel,sha256'
    || !artifactPath(value.reference_pdf.rel, /\.pdf$/i) || !sha(value.reference_pdf.sha256) || fold(value.reference_pdf.rel) === fold(value.pdf_rel))) return null;
  return structuredClone(value) as SidecarProvenance;
}
export type ParsedSidecarProvenance = {status: 'missing' | 'unknown' | 'invalid'; provenance?: never} | {status: 'valid'; provenance: SidecarProvenance};
/** Metadata only: it is neither a drawing approval nor an instruction to any executor. */
export function formatSidecarProvenanceMarker(value: SidecarProvenance): string {
  const record = validateSidecarProvenance(value);
  if (!record) invalid('出图来源元数据无效');
  const escaped = JSON.stringify(record).replace(/[<>&\u2028\u2029]/gu, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const marker = `<!-- phoenix-cad-companion:v1 ${escaped} -->`;
  if (Buffer.byteLength(marker, 'utf8') > MAX_MARKER_BYTES) throw new CompanionFsError('limit', '出图来源标记超过大小上限');
  return marker;
}
export function parseSidecarProvenanceMarker(markdown: string): ParsedSidecarProvenance {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > MAX_COMPANION_BYTES) return {status: 'invalid'};
  const starts = [...markdown.matchAll(/<!--\s*phoenix-cad-companion:/g)];
  if (!starts.length) return {status: 'missing'};
  if (starts.length !== 1) return {status: 'invalid'};
  const begin = starts[0].index!, end = markdown.indexOf('-->', begin);
  if (end < 0) return {status: 'invalid'};
  const marker = markdown.slice(begin, end + 3);
  if (Buffer.byteLength(marker, 'utf8') > MAX_MARKER_BYTES) return {status: 'invalid'};
  const match = /^<!-- phoenix-cad-companion:([^\s]+) ([^\r\n]+) -->$/.exec(marker);
  if (!match) return {status: 'invalid'};
  if (match[1] !== 'v1') return {status: 'unknown'};
  try {
    const value: unknown = JSON.parse(match[2]);
    if (isObject(value) && (value.schema !== 'phoenix-cad-companion' || value.version !== 1)) return {status: 'unknown'};
    const provenance = validateSidecarProvenance(value);
    // Only our versioned machine encoding is recognized; duplicate JSON keys,
    // alternate escaping and hand-edited markers remain unverified/manual.
    return provenance && formatSidecarProvenanceMarker(provenance) === marker ? {status: 'valid', provenance} : {status: 'invalid'};
  } catch {return {status: 'invalid'};}
}
export type VerifiedSidecarProvenance = {verified: false; status: 'manual'; reason: string} | {verified: true; status: 'verified'; provenance: SidecarProvenance};
function artifactProof(root: string, rel: string): string {
  const stat = fs.lstatSync(safeRelative(root, rel), {bigint: true});
  if (!stat.isFile() || stat.isSymbolicLink()) invalid('最终产物必须是普通文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
/** All three current final artifacts and the complete binding must agree; a suffix is never evidence. */
export function verifySidecarProvenance(workspace: string, value: unknown, binding: CompanionRequest, options: {signal?: AbortSignal} = {}): VerifiedSidecarProvenance {
  const record = validateSidecarProvenance(value);
  if (!record) return {verified: false, status: 'manual', reason: '来源标记未知或无效'};
  try {
    const root = assertRoot(workspace);
    bindingIdentity(binding);
    const draft = binding.draft_sequence;
    if (!sequence(draft)) invalid('来源核对需要明确初稿序号');
    const expected = plannedGroup(binding, draft);
    if (record.source_rel !== binding.source_rel || record.source_node !== binding.source_node || record.drawing_rel !== expected.drawing_rel
      || record.pdf_rel !== expected.pdf_rel || record.revisionRaw !== binding.identity.revisionRaw || record.variantRaw !== binding.identity.variantRaw
      || record.draft_sequence !== binding.draft_sequence) return {verified: false, status: 'manual', reason: '来源标记与当前绑定不一致'};
    const artifacts = [[record.source_rel,record.source_sha256],[record.drawing_rel,record.drawing_sha256],[record.pdf_rel,record.pdf_sha256],
      ...(record.reference_pdf ? [[record.reference_pdf.rel,record.reference_pdf.sha256]] : [])];
    const before = artifacts.map(([rel]) => artifactProof(root, rel));
    for (const [rel, digest] of artifacts) if (readBoundedFile(root, rel, MAX_ARTIFACT_BYTES, options.signal).sha256 !== digest) {
      return {verified: false, status: 'manual', reason: '来源或最终产物 SHA 不一致'};
    }
    if (artifacts.some(([rel], index) => artifactProof(root, rel) !== before[index])) return {verified: false, status: 'manual', reason: '来源或最终产物在核对期间变化'};
    return {verified: true, status: 'verified', provenance: record};
  } catch (error) {
    if (error instanceof CompanionFsError && error.code === 'cancelled') throw error;
    return {verified: false, status: 'manual', reason: '来源或最终产物无法安全核对'};
  }
}
