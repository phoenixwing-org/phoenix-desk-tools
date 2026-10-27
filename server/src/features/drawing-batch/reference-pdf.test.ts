import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {strToU8, zipSync} from 'fflate';
import {afterEach, expect, it, vi} from 'vitest';
import type {CompanionRequest, SidecarProvenance} from '../../../../shared/cad-companion/contracts.js';
import {parseCadIdentity, proposeCompanionFilename} from '../../../../shared/cad-companion/model.js';
import {formatSidecarProvenanceMarker} from '../cad-companions/output.js';
import * as provenanceOutput from '../cad-companions/output.js';
import * as companionFilesystem from '../cad-companions/filesystem.js';
import * as discovery from '../cad-companions/discovery.js';
import {inspectReferencePdf} from './reference-pdf.js';

const roots: string[] = [];
afterEach(() => {vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
const sha = (root: string, rel: string) => createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
const pdfBytes = Buffer.from('%PDF-1.7\nIndependent synthetic PDF envelope for a unit test, not a rendered drawing.\n%%EOF\n');
function drawingBytes(hint = false, extra = ''): Uint8Array {
  return zipSync({'Document.xml': strToU8(`<Document><Properties>${hint ? '<Property name="Meta" type="App::PropertyMap"><Map><Item key="AI.SourceSHA256" value="legacy-synthetic-source-hash"/></Map></Property>' : ''}</Properties><Objects Count="0"/><ObjectData Count="0"/>${extra}</Document>`)}, {level: 0});
}
function fixture(options: {source?: string; draft?: number; nameOverride?: string; hint?: boolean} = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reference-pdf-independent-'))); roots.push(root); fs.mkdirSync(path.join(root, 'parts'));
  const sourceName = options.source ?? '2468.005P1-QA-Project-Widget.FCStd', source_rel = `parts/${sourceName}`;
  const draft = options.draft ?? 1, stem = sourceName.replace(/(?:\.ASSY)?\.FCStd$/i, '') + (draft === 1 ? '' : `-初稿${String(draft).padStart(2, '0')}`);
  const drawing_rel = `parts/${stem}.Drawing.FCStd`, pdf_rel = `parts/${stem}.Drawing.pdf`;
  fs.writeFileSync(path.join(root, source_rel), 'independent source bytes; no actual model');
  fs.writeFileSync(path.join(root, drawing_rel), drawingBytes(options.hint)); fs.writeFileSync(path.join(root, pdf_rel), pdfBytes);
  const identity = parseCadIdentity(sourceName);
  const binding: CompanionRequest = {source_rel, source_node: 'Body', drawing_rel, identity, purpose: 'drawing_notes', draft_sequence: draft,
    ...(options.nameOverride ? {name_override: options.nameOverride} : {})};
  const proposal = proposeCompanionFilename(identity, 'drawing_notes', {name: options.nameOverride, draftSequence: draft});
  const notes_rel = `parts/${proposal.filename ?? 'unclassified-legacy.md'}`;
  const legacy_rel = pdf_rel.replace(/\.pdf$/i, '.ai.md'), bare_rel = pdf_rel.replace(/\.pdf$/i, '.md');
  const record = (): SidecarProvenance => ({schema: 'phoenix-cad-companion',version: 1,generated_draft: true,
    source_rel,source_node: 'Body',source_sha256: sha(root, source_rel),drawing_rel,drawing_sha256: sha(root, drawing_rel),pdf_rel,pdf_sha256: sha(root, pdf_rel),
    revisionRaw: identity.revisionRaw!,variantRaw: identity.variantRaw,draft_sequence: draft,reference_pdf: null});
  const inspect = (overrides: Partial<CompanionRequest> = {}) => inspectReferencePdf(root, {pdf_rel,binding: {...binding,...overrides}});
  return {root,binding,pdf_rel,drawing_rel,source_rel,notes_rel,legacy_rel,bare_rel,record,inspect};
}
function writeNote(f: ReturnType<typeof fixture>, rel = f.notes_rel, record = f.record()): string {
  const text = `# Independent review notes\n${formatSidecarProvenanceMarker(record)}\nNot an engineering approval.\n`;
  fs.writeFileSync(path.join(f.root, rel), text); return text;
}

it.each(['purpose', 'legacy-ai', 'explicit-bare'] as const)('verifies complete current structured provenance in %s notes', async naming => {
  const f = fixture({hint: true});
  const rel = naming === 'purpose' ? f.notes_rel : naming === 'legacy-ai' ? f.legacy_rel : f.bare_rel;
  if (naming === 'explicit-bare') f.binding.explicit_aliases = [{rel,purpose: 'drawing_notes'}];
  writeNote(f, rel);
  const before = fs.readdirSync(path.join(f.root, 'parts')), result = await f.inspect();
  expect(result).toMatchObject({version: 1,pdf_rel: f.pdf_rel,pdf_sha256: sha(f.root, f.pdf_rel),classification: 'generated_verified'});
  expect(result.evidence).toContainEqual({kind: 'sidecar',rel,status: 'verified',sha256: sha(f.root, rel)});
  expect(fs.readdirSync(path.join(f.root, 'parts'))).toEqual(before);
});
it('keeps CAD basename classification/project segments while a reviewed override changes only the note name', async () => {
  const f = fixture({source: '2468.005P2-QA-Project-Bracket.ASSY.FCStd',nameOverride: 'Reviewed-Bracket'}); writeNote(f);
  expect(f.pdf_rel).toBe('parts/2468.005P2-QA-Project-Bracket.Drawing.pdf');
  expect(f.notes_rel).toBe('parts/2468.005P2-Reviewed-Bracket-出图说明.md');
  expect(await f.inspect()).toMatchObject({classification: 'generated_verified'});
});
it('supports a reviewed different note alias without guessing a name from the PDF basename', async () => {
  const f = fixture(), rel = 'parts/reviewed-receipt.md'; writeNote(f, rel); f.binding.explicit_aliases = [{rel,purpose: 'drawing_notes'}];
  expect(await f.inspect()).toMatchObject({classification: 'generated_verified'});
});
it('does not discover an arbitrary different note name without an override or explicit alias', async () => {
  const f = fixture({hint: true}); writeNote(f, 'parts/reviewed-receipt.md');
  const result = await f.inspect(); expect(result.classification).toBe('manual');
  expect(result.evidence.some(item => item.rel === 'parts/reviewed-receipt.md')).toBe(false);
});
it('accepts byte-identical known aliases but retains every evidence path', async () => {
  const f = fixture(), text = writeNote(f); fs.writeFileSync(path.join(f.root, f.legacy_rel), text);
  const result = await f.inspect(); expect(result.classification).toBe('generated_verified');
  expect(result.evidence.filter(item => item.kind === 'sidecar').map(item => item.rel).sort()).toEqual([f.notes_rel,f.legacy_rel].sort());
});
it('keeps conflicting sidecars visible and manual even when one complete record is valid', async () => {
  const f = fixture(); writeNote(f); fs.writeFileSync(path.join(f.root, f.legacy_rel), 'Independent human edits to a legacy note');
  const result = await f.inspect(); expect(result.classification).toBe('manual');
  expect(result.evidence.filter(item => item.kind === 'sidecar')).toHaveLength(2);
  expect(result.evidence.some(item => item.status === 'conflict')).toBe(true);
});
it('keeps unknown bare-purpose collisions manual rather than ignoring them', async () => {
  const f = fixture(), text = writeNote(f); fs.writeFileSync(path.join(f.root, f.bare_rel), text);
  const result = await f.inspect(); expect(result.classification).toBe('manual'); expect(result.evidence).toHaveLength(2);
});
it.each(['legacy-prose', 'meta-only', 'draft-suffix'] as const)('does not upgrade %s clues to generated proof or an original reference', async clue => {
  const f = fixture({hint: clue === 'meta-only',draft: clue === 'draft-suffix' ? 2 : 1});
  if (clue === 'legacy-prose') fs.writeFileSync(path.join(f.root, f.legacy_rel), '# Legacy AI draft\nSource hash and basename only.');
  const result = await f.inspect(); expect(result).toMatchObject({pdf_rel: f.pdf_rel,classification: 'manual'});
  expect(result.pdf_sha256).toBe(sha(f.root, f.pdf_rel));
});
it.each(['legacy-ai', 'explicit-bare'] as const)('keeps plain %s generation claims manual when the saved source SHA is stale and Drawing Meta is empty', async naming => {
  const f = fixture(), oldSourceSha = sha(f.root, f.source_rel), rel = naming === 'legacy-ai' ? f.legacy_rel : f.bare_rel;
  if (naming === 'explicit-bare') f.binding.explicit_aliases = [{rel,purpose: 'drawing_notes'}];
  const legacyText = `# Independent old draft receipt\n状态：已生成，待人工审核\n源模型：${f.source_rel}\n节点：Body\n源SHA256：${oldSourceSha}\n`;
  fs.writeFileSync(path.join(f.root, rel), legacyText);
  fs.appendFileSync(path.join(f.root, f.source_rel), '\nindependent later source edit');
  expect(sha(f.root, f.source_rel)).not.toBe(oldSourceSha);
  const result = await f.inspect();
  expect(result).toMatchObject({pdf_rel: f.pdf_rel,classification: 'manual'});
  expect(result.evidence).toContainEqual({kind: 'sidecar',rel,status: 'legacy',sha256: sha(f.root, rel)});
  expect(result.evidence.some(item => item.kind === 'drawing_marker')).toBe(false);
  expect(fs.readFileSync(path.join(f.root, rel), 'utf8')).toBe(legacyText);
});
it('treats an ordinary PDF with no generation clues as a visible candidate, never an engineering approval', async () => {
  const f = fixture(), result = await f.inspect();
  expect(result.classification).toBe('candidate'); expect(result.evidence).toEqual([]);
  expect(result.diagnostics.some(item => item.code === 'reference_candidate')).toBe(true);
});
it('does not let a valid sidecar for another PDF hide an ordinary original PDF', async () => {
  const f = fixture(); writeNote(f); const rel = 'parts/original-reference.pdf'; fs.writeFileSync(path.join(f.root, rel), pdfBytes);
  const result = await inspectReferencePdf(f.root, {pdf_rel: rel,binding: f.binding});
  expect(result).toMatchObject({classification: 'candidate',pdf_rel: rel}); expect(result.evidence[0].status).toBe('other_pdf');
});
it.each(['source', 'drawing', 'pdf'] as const)('keeps changed final %s bytes manual', async target => {
  const f = fixture(); writeNote(f);
  if (target === 'drawing') fs.writeFileSync(path.join(f.root, f.drawing_rel), drawingBytes(false, '<Changed/>'));
  else fs.appendFileSync(path.join(f.root, target === 'source' ? f.source_rel : f.pdf_rel), '\nexternal independent edit');
  expect(await f.inspect()).toMatchObject({classification: 'manual'});
});
it.each(['node', 'revision', 'variant', 'draft', 'pdf-path'] as const)('requires the exact %s binding rather than plausible filenames', async field => {
  const f = fixture(), record = f.record();
  if (field === 'node') record.source_node = 'OtherBody';
  else if (field === 'revision') record.revisionRaw = '006P1';
  else if (field === 'variant') record.variantRaw = 'P2';
  else if (field === 'draft') record.draft_sequence = 2;
  else {record.pdf_rel = 'parts/other.Drawing.pdf'; record.drawing_rel = 'parts/other.Drawing.FCStd';}
  writeNote(f, f.notes_rel, record); expect(await f.inspect()).toMatchObject({classification: 'manual'});
});
it('requires an explicit draft binding before automatically excluding a PDF', async () => {
  const f = fixture(); writeNote(f); expect(await f.inspect({draft_sequence: undefined})).toMatchObject({classification: 'manual'});
});
it('also rechecks an explicitly recorded original reference PDF hash', async () => {
  const f = fixture(), rel = 'parts/independent-original.pdf'; fs.writeFileSync(path.join(f.root, rel), pdfBytes);
  const record = f.record(); record.reference_pdf = {rel,sha256: sha(f.root, rel)}; writeNote(f, f.notes_rel, record);
  expect(await f.inspect()).toMatchObject({classification: 'generated_verified'});
  fs.appendFileSync(path.join(f.root, rel), '\noriginal reference changed');
  expect(await f.inspect()).toMatchObject({classification: 'manual'});
});
it.each(['unknown-version', 'duplicate', 'invalid'] as const)('keeps %s markers visible and manual', async kind => {
  const f = fixture(), text = writeNote(f);
  fs.writeFileSync(path.join(f.root, f.notes_rel), kind === 'unknown-version' ? text.replace(':v1 ', ':v2 ') : kind === 'duplicate' ? `${text}\n${text}` : '<!-- phoenix-cad-companion:v1 malformed -->');
  const result = await f.inspect(); expect(result.classification).toBe('manual'); expect(result.evidence[0].rel).toBe(f.notes_rel);
});
it.each(['Model.FCStd', '2468.005P9-QA-Project-Widget.FCStd'] as const)('keeps legacy or unknown identity %s manual without invented revisions', async source => {
  const f = fixture({source}); fs.writeFileSync(path.join(f.root, f.legacy_rel), 'Independent legacy notes');
  const result = await f.inspect(); expect(result.classification).toBe('manual');
  expect(f.binding.identity.revisionRaw).toBe(source === 'Model.FCStd' ? null : '005P9');
});
it.each(['symlink', 'invalid-utf8', 'oversized'] as const)('does not ignore %s sidecar candidates', async kind => {
  const f = fixture();
  if (kind === 'symlink') fs.symlinkSync(path.join(f.root, 'missing'), path.join(f.root, f.notes_rel));
  else if (kind === 'invalid-utf8') fs.writeFileSync(path.join(f.root, f.notes_rel), Buffer.from([0xc0,0xaf]));
  else {fs.writeFileSync(path.join(f.root, f.notes_rel), ''); fs.truncateSync(path.join(f.root, f.notes_rel), 2 * 1024 * 1024 + 1);}
  const result = await f.inspect(); expect(result.classification).toBe('manual'); expect(result.evidence[0].status).toBe('unreadable');
});
it('refuses incomplete directory discovery instead of proving there are no generation notes', async () => {
  const f = fixture(); for (let index = 0; index < 2000; index++) fs.writeFileSync(path.join(f.root, 'parts', `unrelated-${index}.txt`), '');
  expect(await f.inspect()).toMatchObject({classification: 'manual'});
});
it.each(['bad-pdf', 'bad-zip', 'bad-xml'] as const)('keeps %s containers manual without a Native fallback', async kind => {
  const f = fixture();
  if (kind === 'bad-pdf') fs.writeFileSync(path.join(f.root, f.pdf_rel), 'not a PDF');
  else fs.writeFileSync(path.join(f.root, f.drawing_rel), kind === 'bad-zip' ? Buffer.from('not a zip') : zipSync({'Document.xml': strToU8('<Document><Broken></Document>')}, {level: 0}));
  writeNote(f); expect(await f.inspect()).toMatchObject({classification: 'manual'});
});
it('does not count a copied generation token in an XML comment as a saved marker', async () => {
  const f = fixture(); fs.writeFileSync(path.join(f.root, f.drawing_rel), drawingBytes(false, '<!-- AI.SourceSHA256 is only an independent comment -->'));
  expect(await f.inspect()).toMatchObject({classification: 'candidate'});
});
it('keeps an oversized PDF and a differently spelled paired Drawing manual', async () => {
  const f = fixture(); fs.truncateSync(path.join(f.root, f.pdf_rel), 64 * 1024 * 1024 + 1);
  expect(await f.inspect()).toMatchObject({classification: 'manual',pdf_sha256: null});
  fs.writeFileSync(path.join(f.root, f.pdf_rel), pdfBytes);
  fs.renameSync(path.join(f.root, f.drawing_rel), path.join(f.root, 'parts', path.posix.basename(f.drawing_rel).toUpperCase()));
  expect(await f.inspect()).toMatchObject({classification: 'manual'});
});
it('rejects unsafe and linked PDF selections without following them', async () => {
  const f = fixture(); expect(await inspectReferencePdf(f.root, {pdf_rel: '../outside.pdf',binding: f.binding})).toMatchObject({classification: 'manual',pdf_sha256: null});
  const rel = 'parts/linked.pdf'; fs.symlinkSync(path.join(f.root, f.pdf_rel), path.join(f.root, rel));
  expect(await inspectReferencePdf(f.root, {pdf_rel: rel,binding: f.binding})).toMatchObject({classification: 'manual',pdf_sha256: null});
});
it('retains manual state when notes change after discovery rather than trusting a stale hash', async () => {
  const f = fixture(); writeNote(f); const discover = discovery.discoverCompanionDocuments; let changed = false;
  vi.spyOn(discovery, 'discoverCompanionDocuments').mockImplementation(async (...args) => {
    const result = await discover(...args); if (!changed) {changed = true; fs.appendFileSync(path.join(f.root, f.notes_rel), '\nconcurrent independent note edit');} return result;
  });
  expect(await f.inspect()).toMatchObject({classification: 'manual'}); expect(changed).toBe(true);
});
it('detects a real source edit during final artifact hash verification', async () => {
  const f = fixture(); writeNote(f); const read = companionFilesystem.readBoundedFile; let changed = false;
  vi.spyOn(companionFilesystem, 'readBoundedFile').mockImplementation((...args) => {
    const result = read(...args); if (args[1] === f.source_rel && !changed) {changed = true; fs.appendFileSync(path.join(f.root, f.source_rel), 'concurrent source edit');} return result;
  });
  expect(await f.inspect()).toMatchObject({classification: 'manual'}); expect(changed).toBe(true);
});
it.each(['source', 'notes', 'new-alias'] as const)('does not accept %s changes after the final hash verifier has returned', async target => {
  const f = fixture(); writeNote(f); const verify = provenanceOutput.verifySidecarProvenance; let changed = false;
  vi.spyOn(provenanceOutput, 'verifySidecarProvenance').mockImplementation((...args) => {
    const result = verify(...args); expect(result.verified).toBe(true);
    if (!changed) {
      changed = true;
      if (target === 'new-alias') fs.writeFileSync(path.join(f.root, f.legacy_rel), 'independent conflicting late legacy note');
      else fs.appendFileSync(path.join(f.root, target === 'source' ? f.source_rel : f.notes_rel), '\nlate independent change');
    }
    return result;
  });
  const result = await f.inspect(); expect(changed).toBe(true); expect(result.classification).toBe('manual');
  expect(result.diagnostics.some(item => item.code === 'evidence_changed')).toBe(true);
});
it('propagates cancellation instead of returning a usable candidate', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await expect(inspectReferencePdf(f.root, {pdf_rel: f.pdf_rel,binding: f.binding,signal: controller.signal})).rejects.toThrow(/取消/);
  const later = new AbortController(), read = companionFilesystem.readBoundedFile;
  vi.spyOn(companionFilesystem, 'readBoundedFile').mockImplementation((...args) => {const result = read(...args); later.abort(); return result;});
  await expect(inspectReferencePdf(f.root, {pdf_rel: f.pdf_rel,binding: f.binding,signal: later.signal})).rejects.toThrow(/取消/);
});
