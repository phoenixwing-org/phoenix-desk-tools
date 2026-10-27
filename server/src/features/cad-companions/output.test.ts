import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {CompanionRequest, FrozenDrawingOutputGroup, SidecarProvenance} from '../../../../shared/cad-companion/contracts.js';
import {parseCadIdentity} from '../../../../shared/cad-companion/model.js';
import {allocateDrawingOutputGroup, assertOutputGroupAbsent, formatSidecarProvenanceMarker, parseSidecarProvenanceMarker, validateSidecarProvenance, verifySidecarProvenance} from './output.js';
import * as companionFilesystem from './filesystem.js';

const roots: string[] = [];
afterEach(() => {vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true});});
function fixture(sourceName = '1357.004P1-Widget.ASSY.FCStd', folder = 'parts'): {root: string; binding: CompanionRequest} {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cad-companion-output-'))); roots.push(root);
  if (folder) fs.mkdirSync(path.join(root, folder));
  const source_rel = folder ? `${folder}/${sourceName}` : sourceName;
  fs.writeFileSync(path.join(root, source_rel), 'independent synthetic source bytes; not a CAD model');
  return {root, binding: {source_rel, source_node: 'Body', identity: parseCadIdentity(sourceName), purpose: 'drawing_notes'}};
}
const digest = (root: string, rel: string) => createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
function provenanceFixture(options: {sourceName?: string; nameOverride?: string; draftSequence?: number} = {}): {root: string; group: FrozenDrawingOutputGroup; record: SidecarProvenance} {
  const {root, binding} = fixture(options.sourceName);
  if (options.nameOverride !== undefined) binding.name_override = options.nameOverride;
  if (options.draftSequence !== undefined) binding.draft_sequence = options.draftSequence;
  const group = allocateDrawingOutputGroup(root, binding);
  fs.writeFileSync(path.join(root, group.drawing_rel), 'synthetic final archive bytes, not an FCStd');
  fs.writeFileSync(path.join(root, group.pdf_rel), 'synthetic final PDF bytes, not a PDF');
  const reference = 'parts/reference.pdf'; fs.writeFileSync(path.join(root, reference), 'independent reference bytes');
  return {root, group, record: {schema: 'phoenix-cad-companion', version: 1, generated_draft: true,
    source_rel: binding.source_rel, source_node: binding.source_node, source_sha256: digest(root, binding.source_rel),
    drawing_rel: group.drawing_rel, drawing_sha256: digest(root, group.drawing_rel), pdf_rel: group.pdf_rel, pdf_sha256: digest(root, group.pdf_rel),
    revisionRaw: binding.identity.revisionRaw!, variantRaw: binding.identity.variantRaw, draft_sequence: group.draft_sequence,
    reference_pdf: {rel: reference, sha256: digest(root, reference)}}};
}

describe('frozen drawing output planning', () => {
  it('uses the shared model, strips only known source roles and freezes three outputs plus legacy reservations without writes', () => {
    const {root, binding} = fixture(), before = fs.readdirSync(path.join(root, 'parts'));
    const group = allocateDrawingOutputGroup(root, binding);
    expect(group).toMatchObject({version: 1, draft_sequence: 1, drawing_rel: 'parts/1357.004P1-Widget.Drawing.FCStd',
      pdf_rel: 'parts/1357.004P1-Widget.Drawing.pdf', notes_rel: 'parts/1357.004P1-Widget-出图说明.md'});
    expect(group.reserved_rels).toEqual([group.drawing_rel, group.pdf_rel, group.notes_rel, 'parts/1357.004P1-Widget.Drawing.ai.md', 'parts/1357.004P1-Widget.Drawing.md']);
    expect(group.binding).toMatchObject({draft_sequence: 1, drawing_rel: group.drawing_rel});
    expect(Object.isFrozen(group)).toBe(true); expect(Object.isFrozen(group.binding.identity)).toBe(true); expect(Object.isFrozen(group.reserved_rels)).toBe(true);
    binding.source_node = 'changed after preview'; expect(group.binding.source_node).toBe('Body');
    expect(fs.readdirSync(path.join(root, 'parts'))).toEqual(before);
  });
  it('does not remove an unknown dotted classification from the source name', () => {
    const {root, binding} = fixture('1357.004P1-Widget.Custom.FCStd');
    expect(allocateDrawingOutputGroup(root, binding).drawing_rel).toBe('parts/1357.004P1-Widget.Custom.Drawing.FCStd');
  });
  it('simplifies only the reviewed Markdown name while preserving the complete source CAD/PDF basename', () => {
    const {root, binding} = fixture('820001.007-H-PX-Bracket.FCStd'), sourceHash = digest(root, binding.source_rel);
    binding.name_override = 'Bracket';
    binding.drawing_rel = 'parts/820001.007-H-PX-Bracket.Drawing.FCStd';
    const group = allocateDrawingOutputGroup(root, binding);
    expect(group).toMatchObject({drawing_rel: 'parts/820001.007-H-PX-Bracket.Drawing.FCStd',
      pdf_rel: 'parts/820001.007-H-PX-Bracket.Drawing.pdf', notes_rel: 'parts/820001.007-Bracket-出图说明.md'});
    expect(group.binding.identity.name).toBe('H-PX-Bracket');
    expect(group.binding.name_override).toBe('Bracket');
    expect(group.reserved_rels).toContain('parts/820001.007-H-PX-Bracket-出图说明.md');
    expect(() => assertOutputGroupAbsent(root, group)).not.toThrow();
    expect(() => allocateDrawingOutputGroup(root, {...binding, drawing_rel: 'parts/820001.007-Bracket.Drawing.FCStd'})).toThrow(/不一致/);
    expect(digest(root, binding.source_rel)).toBe(sourceHash);
    expect(fs.readdirSync(path.join(root, 'parts'))).toEqual([path.posix.basename(binding.source_rel)]);
  });
  it.each(['', 'P', 'P1', 'P2'].flatMap(variant => [1, 2].map(draft => ({variant, draft}))))('retains variant $variant and draft $draft in both independent name stems', ({variant, draft}) => {
    const {root, binding} = fixture(`820001.007${variant}-H-PX-Bracket.ASSY.FCStd`);
    binding.name_override = 'Bracket'; binding.draft_sequence = draft;
    const suffix = draft === 1 ? '' : '-初稿02', group = allocateDrawingOutputGroup(root, binding);
    expect(group.drawing_rel).toBe(`parts/820001.007${variant}-H-PX-Bracket${suffix}.Drawing.FCStd`);
    expect(group.pdf_rel).toBe(`parts/820001.007${variant}-H-PX-Bracket${suffix}.Drawing.pdf`);
    expect(group.notes_rel).toBe(`parts/820001.007${variant}-Bracket${suffix}-出图说明.md`);
    expect(group.binding.identity).toMatchObject({revision: '007', revisionRaw: `007${variant}`, variantRaw: variant || null});
    expect(() => assertOutputGroupAbsent(root, group)).not.toThrow();
  });
  it.each([
    {name: '820001.007P1-H-PX-Bracket-初稿02.Drawing.ai.md'},
    {name: '820001.007P1-H-PX-Bracket-初稿02.Drawing.md'},
    {name: '820001.007P1-H-PX-Bracket-初稿02-出图说明.md'},
    {name: '820001.007P1-Bracket-初稿02.Drawing.ai.md'},
    {name: '820001.007P1-Bracket-初稿02.Drawing.md'},
    {name: '820001.007P1-Bracket-初稿02-出图说明.md'},
  ])('protects same-binding full and older override-derived note occupancy: $name', ({name}) => {
    const {root, binding} = fixture('820001.007P1-H-PX-Bracket.FCStd');
    binding.name_override = 'Bracket'; binding.draft_sequence = 2;
    const group = allocateDrawingOutputGroup(root, binding), occupied = `parts/${name}`;
    expect(group.reserved_rels).toContain(occupied);
    fs.writeFileSync(path.join(root, occupied), 'independent existing note');
    expect(() => assertOutputGroupAbsent(root, group)).toThrow(/占位/);
    expect(() => allocateDrawingOutputGroup(root, binding, {allowNextDraft: true})).toThrow(/占位/);
    expect(fs.readFileSync(path.join(root, occupied), 'utf8')).toBe('independent existing note');
  });
  it('advances both stems only at initial explicit next-draft allocation, never while checking a frozen group', () => {
    const {root, binding} = fixture('820001.007P1-H-PX-Bracket.FCStd'); binding.name_override = 'Bracket';
    fs.writeFileSync(path.join(root, 'parts/820001.007P1-H-PX-Bracket.Drawing.ai.md'), 'existing canonical-family legacy note');
    const group = allocateDrawingOutputGroup(root, binding, {allowNextDraft: true});
    expect(group).toMatchObject({draft_sequence: 2, drawing_rel: 'parts/820001.007P1-H-PX-Bracket-初稿02.Drawing.FCStd',
      notes_rel: 'parts/820001.007P1-Bracket-初稿02-出图说明.md'});
    fs.writeFileSync(path.join(root, 'parts/820001.007P1-Bracket-初稿02.Drawing.md'), 'existing shortened-family legacy note');
    expect(() => assertOutputGroupAbsent(root, group)).toThrow(/占位/);
    expect(group.draft_sequence).toBe(2);
    expect(fs.readdirSync(path.join(root, 'parts')).some(name => name.includes('初稿03'))).toBe(false);
  });
  it('rejects a forged older note-derived CAD output in a frozen reviewed-name group', () => {
    const {root, binding} = fixture('820001.007P1-H-PX-Bracket.FCStd'); binding.name_override = 'Bracket';
    const group = allocateDrawingOutputGroup(root, binding);
    expect(() => assertOutputGroupAbsent(root, {...group, drawing_rel: 'parts/820001.007P1-Bracket.Drawing.FCStd',
      pdf_rel: 'parts/820001.007P1-Bracket.Drawing.pdf'})).toThrow(/改变/);
    expect(() => assertOutputGroupAbsent(root, {...group, reserved_rels: group.reserved_rels.filter(rel => !rel.endsWith('H-PX-Bracket.Drawing.ai.md'))})).toThrow(/改变/);
  });
  it('keeps revision, variant and draft number independent', () => {
    const {root, binding} = fixture(); binding.draft_sequence = 2;
    const group = allocateDrawingOutputGroup(root, binding);
    expect(group.drawing_rel).toBe('parts/1357.004P1-Widget-初稿02.Drawing.FCStd');
    expect(group.binding.identity).toMatchObject({revisionRaw: '004P1', revision: '004', variantRaw: 'P1'});
  });
  it.each([0, -1, 1.5, 10000, Number.NaN])('rejects invalid explicit draft %s', draft => {
    const {root, binding} = fixture(); binding.draft_sequence = draft;
    expect(() => allocateDrawingOutputGroup(root, binding, {allowNextDraft: true})).toThrow(/序号/);
  });
  it('allocates a next number only on an explicit initial-preview opt-in', () => {
    const {root, binding} = fixture(), first = allocateDrawingOutputGroup(root, binding);
    fs.writeFileSync(path.join(root, first.notes_rel), 'human text is protected');
    expect(() => allocateDrawingOutputGroup(root, binding)).toThrow(/占位/);
    expect(() => allocateDrawingOutputGroup(root, {...binding, draft_sequence: 1}, {allowNextDraft: true})).toThrow(/占位/);
    const second = allocateDrawingOutputGroup(root, binding, {allowNextDraft: true}); expect(second.draft_sequence).toBe(2);
    fs.mkdirSync(path.join(root, second.pdf_rel));
    expect(() => assertOutputGroupAbsent(root, second)).toThrow(/占位/);
    expect(second.draft_sequence).toBe(2);
  });
  it.each([0, 1, 2, 3, 4])('treats reservation %s as occupied independently', index => {
    const {root, binding} = fixture(), group = allocateDrawingOutputGroup(root, binding);
    fs.writeFileSync(path.join(root, group.reserved_rels[index]), 'protected');
    expect(() => assertOutputGroupAbsent(root, group)).toThrow(/占位/);
  });
  it.each(['directory', 'dangling-link', 'link'])('protects an existing %s instead of following or treating it as empty', kind => {
    const {root, binding} = fixture(), group = allocateDrawingOutputGroup(root, binding), target = path.join(root, group.notes_rel);
    if (kind === 'directory') fs.mkdirSync(target);
    else fs.symlinkSync(kind === 'link' ? path.join(root, binding.source_rel) : path.join(root, 'missing-target'), target);
    expect(() => assertOutputGroupAbsent(root, group)).toThrow(/占位|别名/);
  });
  it('protects NFC and case aliases, including a decomposed name on a case-sensitive volume', () => {
    const {root, binding} = fixture('1357.004-Café.FCStd'), group = allocateDrawingOutputGroup(root, binding);
    const alias = group.notes_rel.normalize('NFD').toUpperCase(); fs.writeFileSync(path.join(root, alias), 'protected alias');
    expect(() => assertOutputGroupAbsent(root, group)).toThrow(/占位/);
  });
  it('includes only explicit drawing-notes aliases in the same directory', () => {
    const {root, binding} = fixture(); binding.explicit_aliases = [{rel: 'parts/reviewed-old.md', purpose: 'drawing_notes'}, {rel: 'parts/development.md', purpose: 'development_doc'}];
    fs.writeFileSync(path.join(root, 'parts/development.md'), 'separate purpose');
    const group = allocateDrawingOutputGroup(root, binding);
    expect(group.reserved_rels).toContain('parts/reviewed-old.md'); expect(group.reserved_rels).not.toContain('parts/development.md');
    fs.writeFileSync(path.join(root, 'parts/reviewed-old.md'), 'must not overwrite'); expect(() => assertOutputGroupAbsent(root, group)).toThrow(/占位/);
  });
  it('rejects a cross-directory alias and a forged output or reduced reservation set', () => {
    const {root, binding} = fixture(), group = allocateDrawingOutputGroup(root, binding);
    expect(() => allocateDrawingOutputGroup(root, {...binding, explicit_aliases: [{rel: 'elsewhere/reviewed.md', purpose: 'drawing_notes'}]})).toThrow(/同目录/);
    expect(() => assertOutputGroupAbsent(root, {...group, notes_rel: 'elsewhere/notes.md'})).toThrow(/改变/);
    expect(() => assertOutputGroupAbsent(root, {...group, reserved_rels: group.reserved_rels.slice(0, 3)})).toThrow(/改变/);
    expect(() => allocateDrawingOutputGroup(root, {...binding, drawing_rel: 'elsewhere/not-allowed.Drawing.FCStd'})).toThrow(/不一致/);
  });
  it('rejects path traversal, unsafe source kinds, a linked parent and identity mismatch', () => {
    const {root, binding} = fixture();
    expect(() => allocateDrawingOutputGroup(root, {...binding, source_rel: '../1357.004P1-Widget.ASSY.FCStd'})).toThrow();
    fs.symlinkSync(path.join(root, 'parts'), path.join(root, 'alias'));
    expect(() => allocateDrawingOutputGroup(root, {...binding, source_rel: binding.source_rel.replace('parts/', 'alias/')})).toThrow(/别名/);
    expect(() => allocateDrawingOutputGroup(root, {...binding, identity: parseCadIdentity('1357.004P2-Widget.ASSY.FCStd')})).toThrow(/身份/);
    fs.unlinkSync(path.join(root, binding.source_rel)); fs.mkdirSync(path.join(root, binding.source_rel));
    expect(() => allocateDrawingOutputGroup(root, binding)).toThrow(/普通文件/);
  });
  it('does not treat an existing Drawing as a new source or accept a forged source draft', () => {
    const drawing = fixture('1357.004P1-Widget-初稿02.Drawing.FCStd');
    expect(() => allocateDrawingOutputGroup(drawing.root, {...drawing.binding, name_override: 'Other'})).toThrow(/既有图纸/);
    const {root, binding} = fixture();
    expect(() => allocateDrawingOutputGroup(root, {...binding, identity: {...binding.identity, draftSequence: 2}})).toThrow(/身份/);
  });
  it('bounds explicit alias inputs before constructing a reservation group', () => {
    const {root, binding} = fixture(); binding.explicit_aliases = Array.from({length: 101}, (_, index) => ({rel: `parts/alias-${index}.md`, purpose: 'drawing_notes'}));
    expect(() => allocateDrawingOutputGroup(root, binding)).toThrow(/预算/);
  });
  it('supports an adjacent output at the workspace root but never creates directories', () => {
    const {root, binding} = fixture('1357.004-Widget.FCStd', ''); const group = allocateDrawingOutputGroup(root, binding);
    expect(group.drawing_rel).toBe('1357.004-Widget.Drawing.FCStd'); expect(fs.readdirSync(root)).toEqual([binding.source_rel]);
  });
  it('checks the longer Drawing filename against the UTF-8 255-byte limit', () => {
    const {root, binding} = fixture(`1357.004-${'a'.repeat(234)}.FCStd`);
    expect(() => allocateDrawingOutputGroup(root, binding)).toThrow(/255|名称|无损/);
  });
  it('does not let a short Markdown override bypass unsafe or oversized original CAD output names', () => {
    const tooLong = fixture(`820001.007-${'a'.repeat(234)}.FCStd`);
    expect(() => allocateDrawingOutputGroup(tooLong.root, {...tooLong.binding, name_override: 'Bracket'})).toThrow(/255/);
    const decomposed = fixture('820001.007-H-PX-Cafe\u0301.FCStd');
    expect(() => allocateDrawingOutputGroup(decomposed.root, {...decomposed.binding, name_override: 'Bracket'})).toThrow(/NFC/);
    const unknownVariant = fixture('820001.007Q-H-PX-Bracket.FCStd');
    expect(() => allocateDrawingOutputGroup(unknownVariant.root, {...unknownVariant.binding, name_override: 'Bracket'})).toThrow(/身份/);
    const unnamed = fixture('Model.FCStd');
    expect(() => allocateDrawingOutputGroup(unnamed.root, {...unnamed.binding, name_override: 'Bracket'})).toThrow(/身份/);
    const {root, binding} = fixture('820001.007-H-PX-Bracket.FCStd');
    expect(() => allocateDrawingOutputGroup(root, {...binding, name_override: '../Bracket'})).toThrow(/名称|无损/);
  });
  it('fails a post-selection race without automatically choosing another draft', () => {
    const {root, binding} = fixture(), expected = allocateDrawingOutputGroup(root, binding), original = fs.lstatSync;
    let inserted = false;
    vi.spyOn(fs, 'lstatSync').mockImplementation(((file: fs.PathLike, options?: unknown) => {
      if (!inserted && String(file) === path.join(root, expected.drawing_rel)) {inserted = true; fs.writeFileSync(file, 'concurrent owner');}
      return original(file, options as never);
    }) as typeof fs.lstatSync);
    expect(() => allocateDrawingOutputGroup(root, binding, {allowNextDraft: true})).toThrow(/占位/);
    expect(fs.readdirSync(path.join(root, 'parts')).some(name => name.includes('初稿02'))).toBe(false);
  });
  it('refuses an incomplete directory inventory rather than proving absence by truncation', () => {
    const {root, binding} = fixture(); for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(root, 'parts', `independent-${i}.txt`), '');
    expect(() => allocateDrawingOutputGroup(root, binding)).toThrow(/预算/);
  });
});

describe('versioned sidecar provenance', () => {
  it('verifies complete CAD/PDF stems with shortened notes, preserving variant and explicit draft 02', () => {
    const {root, group, record} = provenanceFixture({sourceName: '820001.007P1-H-PX-Bracket.FCStd', nameOverride: 'Bracket', draftSequence: 2});
    expect(group.notes_rel).toBe('parts/820001.007P1-Bracket-初稿02-出图说明.md');
    expect(record).toMatchObject({source_rel: 'parts/820001.007P1-H-PX-Bracket.FCStd', drawing_rel: 'parts/820001.007P1-H-PX-Bracket-初稿02.Drawing.FCStd',
      pdf_rel: 'parts/820001.007P1-H-PX-Bracket-初稿02.Drawing.pdf', revisionRaw: '007P1', variantRaw: 'P1', draft_sequence: 2});
    const marker = formatSidecarProvenanceMarker(record), parsed = parseSidecarProvenanceMarker(marker);
    expect(parsed).toEqual({status: 'valid', provenance: record});
    expect(verifySidecarProvenance(root, record, group.binding)).toMatchObject({verified: true});
    expect(verifySidecarProvenance(root, {...record, revisionRaw: '007', variantRaw: null}, group.binding)).toMatchObject({verified: false});
    expect(verifySidecarProvenance(root, {...record, draft_sequence: 1}, group.binding)).toMatchObject({verified: false});
    const olderDrawing = 'parts/820001.007P1-Bracket-初稿02.Drawing.FCStd', olderPdf = 'parts/820001.007P1-Bracket-初稿02.Drawing.pdf';
    fs.copyFileSync(path.join(root, record.drawing_rel), path.join(root, olderDrawing));
    fs.copyFileSync(path.join(root, record.pdf_rel), path.join(root, olderPdf));
    const olderRecord = {...record, drawing_rel: olderDrawing, pdf_rel: olderPdf};
    expect(validateSidecarProvenance(olderRecord)).not.toBeNull();
    expect(verifySidecarProvenance(root, olderRecord, group.binding)).toMatchObject({verified: false, status: 'manual'});
  });
  it('round-trips a bounded, single-line marker and escapes comment/HTML injection', () => {
    const {record} = provenanceFixture(); record.source_node = 'Body--><script>&payload';
    const marker = formatSidecarProvenanceMarker(record);
    expect(marker.split('\n')).toHaveLength(1); expect(marker.match(/-->/g)).toHaveLength(1); expect(marker).not.toContain('<script>');
    expect(marker).toContain('\\u003c'); expect(marker).toContain('\\u003e'); expect(marker).toContain('\\u0026');
    expect(parseSidecarProvenanceMarker(`Human notes\n${marker}\nmore text`)).toEqual({status: 'valid', provenance: record});
  });
  it('requires a complete explicit schema and never turns unknown or duplicate metadata into valid evidence', () => {
    const {record} = provenanceFixture(), marker = formatSidecarProvenanceMarker(record);
    expect(parseSidecarProvenanceMarker('filename.Drawing.ai.md')).toEqual({status: 'missing'});
    expect(parseSidecarProvenanceMarker(`${marker}\n${marker}`)).toEqual({status: 'invalid'});
    expect(parseSidecarProvenanceMarker(marker.replace(':v1 ', ':v2 '))).toEqual({status: 'unknown'});
    expect(parseSidecarProvenanceMarker(marker.replace('"version":1', '"version":2'))).toEqual({status: 'unknown'});
    expect(parseSidecarProvenanceMarker('<!-- phoenix-cad-companion:v1 not-json -->')).toEqual({status: 'invalid'});
    expect(parseSidecarProvenanceMarker('<!-- phoenix-cad-companion:v1 {')).toEqual({status: 'invalid'});
    expect(parseSidecarProvenanceMarker(`${marker}\n<!-- phoenix-cad-companion:v2 {}`)).toEqual({status: 'invalid'});
    expect(parseSidecarProvenanceMarker(marker.replace('"version":1', '"version":2,"version":1'))).toEqual({status: 'invalid'});
    expect(parseSidecarProvenanceMarker(marker.replace('"generated_draft":true', '"generated_draft":false,"generated_draft":true'))).toEqual({status: 'invalid'});
    expect(parseSidecarProvenanceMarker(marker.replace('{"schema"', '{ "schema"'))).toEqual({status: 'invalid'});
  });
  it.each(['source_sha256', 'drawing_sha256', 'pdf_sha256', 'reference_pdf', 'variantRaw'])('rejects a missing required %s field', field => {
    const {record} = provenanceFixture(), value = {...record} as Record<string, unknown>; delete value[field];
    expect(validateSidecarProvenance(value)).toBeNull(); expect(() => formatSidecarProvenanceMarker(value as SidecarProvenance)).toThrow(/元数据/);
  });
  it('rejects unsafe paths, extra keys, wrong hashes, wrong sequence and self-referencing generated PDF', () => {
    const {record} = provenanceFixture();
    for (const value of [{...record, source_rel: '../unsafe.FCStd'}, {...record, source_sha256: '0'.repeat(63)}, {...record, generated_draft: false},
      {...record, draft_sequence: 0}, {...record, unexpected: true}, {...record, reference_pdf: {rel: record.pdf_rel, sha256: record.pdf_sha256}},
      {...record, pdf_rel: 'other/1357.004P1-Widget.Drawing.pdf'}]) expect(validateSidecarProvenance(value)).toBeNull();
  });
  it('bounds both marker and Markdown input bytes', () => {
    const {record} = provenanceFixture(), marker = formatSidecarProvenanceMarker(record);
    expect(parseSidecarProvenanceMarker(`<!-- phoenix-cad-companion:v1 ${' '.repeat(65536)} -->`).status).toBe('invalid');
    expect(parseSidecarProvenanceMarker(`${'x'.repeat(2 * 1024 * 1024)}${marker}`).status).toBe('invalid');
  });
  it('verifies the exact frozen binding and all current final hashes, with a nullable reference', () => {
    const {root, group, record} = provenanceFixture();
    expect(verifySidecarProvenance(root, record, group.binding)).toMatchObject({verified: true, status: 'verified'});
    expect(verifySidecarProvenance(root, {...record, reference_pdf: null}, group.binding)).toMatchObject({verified: true});
    expect(verifySidecarProvenance(root, record, {...group.binding, draft_sequence: undefined})).toMatchObject({verified: false});
    expect(verifySidecarProvenance(root, record, {...group.binding, source_node: 'DifferentBody'})).toMatchObject({verified: false});
    expect(verifySidecarProvenance(root, record, {...group.binding, identity: {...group.binding.identity, revisionRaw: '004P2', variantRaw: 'P2'}})).toMatchObject({verified: false});
    expect(verifySidecarProvenance(root, {...record, draft_sequence: 2}, group.binding)).toMatchObject({verified: false});
  });
  it.each(['source', 'drawing', 'pdf', 'reference'])('does not verify a changed %s even if every filename and marker remains plausible', artifact => {
    const {root, group, record} = provenanceFixture();
    const rel = artifact === 'source' ? record.source_rel : artifact === 'drawing' ? record.drawing_rel : artifact === 'pdf' ? record.pdf_rel : record.reference_pdf!.rel;
    fs.appendFileSync(path.join(root, rel), 'external change');
    expect(verifySidecarProvenance(root, record, group.binding)).toMatchObject({verified: false, status: 'manual'});
  });
  it('rejects a different source path even when its bytes match', () => {
    const {root, group, record} = provenanceFixture();
    fs.mkdirSync(path.join(root, 'other')); fs.copyFileSync(path.join(root, record.source_rel), path.join(root, 'other', path.posix.basename(record.source_rel)));
    expect(verifySidecarProvenance(root, {...record, source_rel: `other/${path.posix.basename(record.source_rel)}`}, group.binding)).toMatchObject({verified: false});
  });
  it('keeps missing, linked and oversized artifacts manual and propagates cancellation', () => {
    const {root, group, record} = provenanceFixture(); const pdf = path.join(root, record.pdf_rel);
    fs.unlinkSync(pdf); expect(verifySidecarProvenance(root, record, group.binding)).toMatchObject({verified: false});
    fs.symlinkSync(path.join(root, record.source_rel), pdf); expect(verifySidecarProvenance(root, record, group.binding)).toMatchObject({verified: false});
    fs.unlinkSync(pdf); fs.writeFileSync(pdf, ''); fs.truncateSync(pdf, 64 * 1024 * 1024 + 1);
    expect(verifySidecarProvenance(root, record, group.binding)).toMatchObject({verified: false});
    const signal = new AbortController(); signal.abort(); expect(() => verifySidecarProvenance(root, record, group.binding, {signal: signal.signal})).toThrow(/取消/);
  });
  it.each(['source', 'reference'] as const)('detects an already-read source changing after the %s artifact was really read', artifact => {
    const {root, group, record} = provenanceFixture(), read = companionFilesystem.readBoundedFile;
    const trigger = artifact === 'source' ? record.source_rel : record.reference_pdf!.rel;
    let changed = false;
    vi.spyOn(companionFilesystem, 'readBoundedFile').mockImplementation((...args) => {
      const result = read(...args);
      if (args[1] === trigger && !changed) {
        expect(result.sha256).toBe(artifact === 'source' ? record.source_sha256 : record.reference_pdf!.sha256);
        changed = true; fs.appendFileSync(path.join(root, record.source_rel), 'concurrent source edit');
      }
      return result;
    });
    const result = verifySidecarProvenance(root, record, group.binding);
    expect(changed).toBe(true);
    expect(digest(root, record.source_rel)).not.toBe(record.source_sha256);
    expect(result).toMatchObject({verified: false, status: 'manual', reason: expect.stringContaining('期间变化')});
  });
});
