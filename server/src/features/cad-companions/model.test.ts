import { describe, expect, it } from 'vitest';
import {
  parseCadIdentity,
  parseCompanionFilename,
  proposeCompanionFilename,
  sameCadBindingIdentity,
} from '../../../../shared/cad-companion/model.js';

const model = (stem = 'DEMO42.007P1-夹具示例') => parseCadIdentity(`${stem}.FCStd`);

describe('lossless CAD filename identity', () => {
  it.each([
    ['', null, 'none'], ['P', 'P', 'known'], ['P1', 'P1', 'known'], ['P2', 'P2', 'known'],
  ] as const)('separates revision and known variant %s', (suffix, variantRaw, variantStatus) => {
    const displayFilename = `DEMO42.007${suffix}-夹具-原料P-分类段.FCStd`;
    expect(parseCadIdentity(displayFilename)).toEqual({
      number: 'DEMO42', revisionRaw: `007${suffix}`, revision: '007', variantRaw, variantStatus,
      name: '夹具-原料P-分类段', rawStem: `DEMO42.007${suffix}-夹具-原料P-分类段`,
      displayFilename, role: 'model', draftSequence: null, parseStatus: 'parsed',
    });
  });

  it.each(['Q', 'P3', 'p1', 'A4b'])('preserves unknown variant %s and requires manual review', variant => {
    const identity = model(`DEMO42.007${variant}-夹具示例`);
    expect(identity).toMatchObject({ revision: '007', revisionRaw: `007${variant}`, variantRaw: variant, variantStatus: 'unknown', parseStatus: 'manual' });
    expect(proposeCompanionFilename(identity, 'model_notes')).toMatchObject({ status: 'manual', filename: null });
  });

  it.each(['0007', '0071', '07', '7', '００７', '007P_1', '007P-1'])('does not guess invalid revision token %s', revision => {
    const identity = model(`DEMO42.${revision}-夹具示例`);
    // A hyphen starts the name, not an extra variant component.
    if (revision === '007P-1') {
      expect(identity).toMatchObject({ revisionRaw: '007P', variantRaw: 'P', name: '1-夹具示例', parseStatus: 'parsed' });
    } else {
      expect(identity.parseStatus).toBe('manual');
      expect(proposeCompanionFilename(identity, 'model_notes').filename).toBeNull();
    }
    expect(identity.displayFilename).toBe(`DEMO42.${revision}-夹具示例.FCStd`);
  });

  it.each([
    ['.FCStd', 'model', null], ['.ASSY.FCStd', 'assembly', null], ['.Drawing.FCStd', 'drawing', 1],
    ['-初稿02.Drawing.FCStd', 'drawing', 2], ['-初稿12.Drawing.FCStd', 'drawing', 12],
  ] as const)('separates role and draft in %s', (suffix, role, draftSequence) => {
    expect(parseCadIdentity(`DEMO_42.007P1-夹具示例${suffix}`)).toMatchObject({
      number: 'DEMO_42', revisionRaw: '007P1', name: '夹具示例', role, draftSequence, parseStatus: 'parsed',
    });
  });

  it.each(['00', '01', '002', '10000', '０２', 'next'])('stops at noncanonical draft %s', sequence => {
    const identity = parseCadIdentity(`DEMO42.007P1-夹具示例-初稿${sequence}.Drawing.FCStd`);
    expect(identity.parseStatus).toBe('manual');
    expect(proposeCompanionFilename(identity, 'drawing_notes').filename).toBeNull();
  });

  it.each(['.FCStd', '.ASSY.FCStd'])('does not truncate a real 3D name containing a Drawing draft suffix in %s', suffix => {
    const identity = parseCadIdentity(`DEMO42.007P1-夹具-初稿02${suffix}`);
    expect(identity).toMatchObject({ name: '夹具-初稿02', draftSequence: null, parseStatus: 'manual' });
    expect(proposeCompanionFilename(identity, 'drawing_notes').filename).toBeNull();
  });

  it.each(['../DEMO42.007-夹具.FCStd', 'sub\\DEMO42.007-夹具.FCStd', 'DEMO42.007-夹\u0000具.FCStd', 'DEMO42.007-夹\u202e具.FCStd', 'DEMO42.007-夹\ud800具.FCStd'])('preserves unsafe display %j without treating it as a basename', filename => {
    const identity = parseCadIdentity(filename);
    expect(identity.displayFilename).toBe(filename);
    expect(identity.parseStatus).toBe('manual');
    expect(proposeCompanionFilename(identity, 'model_notes').filename).toBeNull();
  });

  it('leaves unknown source roles manual and retains the full name without simplification', () => {
    const identity = parseCadIdentity('DEMO42.007P1-分类-项目-夹具.PDF');
    expect(identity).toMatchObject({ role: 'unknown', displayFilename: 'DEMO42.007P1-分类-项目-夹具.PDF', parseStatus: 'manual' });
    expect(proposeCompanionFilename(model('DEMO42.007P1-分类-项目-夹具'), 'model_notes').filename).toBe('DEMO42.007P1-分类-项目-夹具-模型说明.md');
  });
});

describe('purpose and legacy Markdown candidate names', () => {
  it.each([
    ['-模型说明.md', 'model_notes', 'purpose_v1', 'model', null],
    ['-出图说明.md', 'drawing_notes', 'purpose_v1', 'drawing', 1],
    ['-开发文档.md', 'development_doc', 'purpose_v1', 'unknown', null],
    ['.Drawing.ai.md', 'drawing_notes', 'drawing_ai', 'drawing', 1],
    ['.md', 'unknown', 'bare', 'unknown', null],
    ['.Drawing.md', 'unknown', 'bare', 'drawing', 1],
    ['.ASSY.md', 'unknown', 'bare', 'assembly', null],
  ] as const)('parses %s with an explicit or unknown purpose', (suffix, purpose, naming, role, draftSequence) => {
    const filename = `DEMO42.007P1-夹具-原料P${suffix}`;
    expect(parseCompanionFilename(filename)).toMatchObject({ purpose, naming, identity: {
      number: 'DEMO42', revision: '007', variantRaw: 'P1', name: '夹具-原料P',
      displayFilename: filename, role, draftSequence, parseStatus: 'parsed',
    } });
  });

  it('keeps draft 02 separate in both new and legacy notes', () => {
    for (const suffix of ['-出图说明.md', '.Drawing.ai.md']) {
      expect(parseCompanionFilename(`DEMO42.007P1-夹具-初稿02${suffix}`)?.identity).toMatchObject({
        revisionRaw: '007P1', name: '夹具', draftSequence: 2, parseStatus: 'parsed',
      });
    }
    expect(parseCompanionFilename('DEMO42.007P1-夹具.PDF')).toBeNull();
    expect(parseCompanionFilename('DEMO42.007P3-夹具-出图说明.md')?.identity.parseStatus).toBe('manual');
  });

  it.each(['.md', '.Drawing.md', '-模型说明.md', '-开发文档.md'])('does not assign a Drawing draft to an unknown or non-Drawing note %s', suffix => {
    expect(parseCompanionFilename(`DEMO42.007P1-夹具-初稿02${suffix}`)?.identity).toMatchObject({
      name: '夹具-初稿02', draftSequence: null, parseStatus: 'manual',
    });
  });

  it('compares exact base identities without merging variants, names or draft bindings', () => {
    const source = model();
    const secondDraft = parseCadIdentity('DEMO42.007P1-夹具示例-初稿02.Drawing.FCStd');
    expect(sameCadBindingIdentity(source, secondDraft)).toBe(true);
    for (const different of ['DEMO42.007P2-夹具示例', 'DEMO42.007-夹具示例', 'DEMO42.007P1-分类-夹具示例', 'demo42.007P1-夹具示例', 'DEMO42.007Q-夹具示例']) {
      expect(sameCadBindingIdentity(source, model(different))).toBe(false);
    }
    expect(sameCadBindingIdentity(model('DEMO42.007Q-夹具'), model('DEMO42.007Q-夹具'))).toBe(false);
  });
});

describe('safe new purpose filename proposals', () => {
  it.each([
    ['model_notes', '模型说明'], ['drawing_notes', '出图说明'], ['development_doc', '开发文档'],
  ] as const)('generates the %s suffix only after explicit purpose selection', (purpose, label) => {
    expect(proposeCompanionFilename(model(), purpose)).toEqual({
      status: 'ready', filename: `DEMO42.007P1-夹具示例-${label}.md`, diagnostics: [],
    });
  });

  it('changes only an explicitly reviewed name and supports assemblies', () => {
    const identity = parseCadIdentity('DEMO42.007P1-分类-项目-夹具-原料P.ASSY.FCStd');
    expect(proposeCompanionFilename(identity, 'model_notes', { name: '夹具-原料P' }).filename).toBe('DEMO42.007P1-夹具-原料P-模型说明.md');
    expect(identity.name).toBe('分类-项目-夹具-原料P');
  });

  it('uses existing draft identity, allows an undrafted source sequence and rejects rebinding', () => {
    const draft = parseCadIdentity('DEMO42.007P1-夹具示例-初稿02.Drawing.FCStd');
    expect(proposeCompanionFilename(draft, 'drawing_notes').filename).toBe('DEMO42.007P1-夹具示例-初稿02-出图说明.md');
    expect(proposeCompanionFilename(draft, 'drawing_notes', { draftSequence: 2 }).status).toBe('ready');
    expect(proposeCompanionFilename(draft, 'drawing_notes', { draftSequence: 3 })).toMatchObject({ status: 'manual', filename: null, diagnostics: [{ code: 'draft_sequence_conflict' }] });
    expect(proposeCompanionFilename(model(), 'drawing_notes', { draftSequence: 3 }).filename).toBe('DEMO42.007P1-夹具示例-初稿03-出图说明.md');
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10000])('rejects draft sequence %s', draftSequence => {
    expect(proposeCompanionFilename(model(), 'drawing_notes', { draftSequence })).toMatchObject({ status: 'manual', filename: null });
  });

  it.each(['../夹具', 'sub/夹具', 'sub\\夹具', '夹\u0000具', '夹\u202e具', '夹\ud800具', '夹:具', '夹?具', '夹*具', '', '   ', '夹具-初稿02'])('rejects unsafe or ambiguous explicit name %j', name => {
    expect(proposeCompanionFilename(model(), 'model_notes', { name })).toMatchObject({ status: 'manual', filename: null });
  });

  it('preserves decomposed input losslessly but does not silently normalize new outputs', () => {
    const identity = model('DEMO42.007P1-Cafe\u0301');
    expect(identity.displayFilename).toBe('DEMO42.007P1-Cafe\u0301.FCStd');
    expect(proposeCompanionFilename(identity, 'model_notes')).toMatchObject({ status: 'manual', filename: null, diagnostics: [{ code: 'non_nfc_filename' }] });
    expect(proposeCompanionFilename(identity, 'model_notes', { name: 'Café' }).status).toBe('ready');
  });

  it('applies the exact 255 UTF-8 byte boundary rather than character count', () => {
    const prefixAndSuffixBytes = new TextEncoder().encode('DEMO42.007P1--模型说明.md').byteLength;
    const atLimit = 'x'.repeat(255 - prefixAndSuffixBytes);
    const ready = proposeCompanionFilename(model(), 'model_notes', { name: atLimit });
    expect(ready.status).toBe('ready');
    expect(new TextEncoder().encode(ready.filename!).byteLength).toBe(255);
    expect(proposeCompanionFilename(model(), 'model_notes', { name: `${atLimit}x` })).toMatchObject({ status: 'manual', filename: null, diagnostics: [{ code: 'filename_too_long' }] });
    expect(proposeCompanionFilename(model(), 'model_notes', { name: '夹'.repeat(90) }).status).toBe('manual');
  });

  it('does not generate when purpose, parsed identity or caller fields are uncertain', () => {
    expect(proposeCompanionFilename(model(), 'unknown').filename).toBeNull();
    expect(proposeCompanionFilename({ ...model(), revisionRaw: '007P2' }, 'model_notes').filename).toBeNull();
    expect(proposeCompanionFilename({ ...model(), number: '../DEMO42' }, 'model_notes').filename).toBeNull();
    expect(proposeCompanionFilename(model('unstructured'), 'model_notes', { name: '夹具' }).filename).toBeNull();
  });
});
