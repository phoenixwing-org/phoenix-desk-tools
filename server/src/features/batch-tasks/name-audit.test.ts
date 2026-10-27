import { describe, expect, it } from 'vitest';
import { inspectSelectedCadNames, type SelectedNameSource } from '../../../../shared/cad-name-audit/model.js';

const source = (rel: string, index: number, overrides: Partial<SelectedNameSource> = {}): SelectedNameSource => ({
  item_id: `item_${index}`, rel, sha256: 'a'.repeat(64), ...overrides,
});
const audit = (...rels: string[]) => inspectSelectedCadNames(rels.map((rel, index) => source(rel, index)));
describe('explicit-selection CAD filename analysis, not an executable batch action', () => {
  it('groups only the supplied file list, keeping distinct paths and fingerprints untouched', () => {
    const inputs = [source('one/DEMO42.007-H-Plate.FCStd', 1), source('two/DEMO42.007-H-Plate.FCStd', 2)];
    const original = JSON.stringify(inputs), result = inspectSelectedCadNames(inputs);
    expect(result).toMatchObject({ schema_version: 1, scope: 'explicit_selection', source: 'display_filename', complete: true, selected: 2, inspected: 2 });
    expect(result.exact_filename_duplicates).toEqual([{key:'DEMO42.007-H-Plate.FCStd',item_ids:['item_1','item_2'],paths:inputs.map(input=>input.rel)}]);
    expect(result.identity_duplicates).toHaveLength(1); expect(JSON.stringify(inputs)).toBe(original);
    expect(audit(inputs[0].rel).identity_duplicates).toEqual([]);
  });
  it('does not collapse the full P/P1/P2 variant or four-digit revisions', () => {
    const result = audit('a/DEMO42.007-H-Plate.FCStd','a/DEMO42.007P-H-Plate.FCStd','a/DEMO42.007P1-H-Plate.FCStd',
      'a/DEMO42.007P2-H-Plate.FCStd','a/DEMO42.0007-H-Plate.FCStd','a/DEMO42.007Q-H-Plate.FCStd');
    expect(result.identity_duplicates).toEqual([]); expect(result.inspected).toBe(4);
    expect(result.manual).toHaveLength(2); expect(result.complete).toBe(false);
  });
  it('reports a shared code/revision despite different display names without recommending a merge', () => {
    const result = audit('a/DEMO42.007-H-Plate.FCStd','b/DEMO42.007-H-Other.FCStd');
    expect(result.exact_filename_duplicates).toEqual([]); expect(result.identity_duplicates).toHaveLength(1);
    expect(result).not.toHaveProperty('merge'); expect(result).not.toHaveProperty('delete');
  });
  it('separates model, independent Drawing, and different drawing drafts', () => {
    const result = audit('DEMO42.007-H-Plate.FCStd','DEMO42.007-H-Plate.Drawing.FCStd','DEMO42.007-H-Plate-初稿02.Drawing.FCStd');
    expect(result.complete).toBe(true); expect(result.identity_duplicates).toEqual([]);
    expect(audit('a/DEMO42.007-H-Plate.FCStd','b/DEMO42.007-H-Plate.ASSY.FCStd').identity_duplicates).toHaveLength(1);
  });
  it('reports portable NFC/case collisions separately without normalizing input names', () => {
    const rels = ['a/DEMO42.007-H-Café.FCStd', 'b/demo42.007-h-Cafe\u0301.fcstd'];
    const result = audit(...rels); expect(result.exact_filename_duplicates).toEqual([]);
    expect(result.portable_filename_collisions).toHaveLength(1);
    expect(result.portable_filename_collisions[0].paths).toEqual(rels);
    expect(result.identity_duplicates).toEqual([]);
  });
  it('retains unreadable/missing and unknown identity inputs as incomplete rather than silently skipping', () => {
    const result = inspectSelectedCadNames([source('a/DEMO42.007-H-Plate.FCStd', 1),
      source('b/DEMO42.007-H-Plate.FCStd', 2, {sha256:null,error:'Explicit source unavailable'}),source('untitled.FCStd',3)]);
    expect(result).toMatchObject({complete:false,selected:3,inspected:1}); expect(result.manual).toHaveLength(2);
    expect(result.identity_duplicates).toEqual([]); expect(result.exact_filename_duplicates).toEqual([]);
  });
  it.each(['../outside.FCStd','/outside.FCStd','C:\\outside.FCStd','.private/model.FCStd','a/__pycache__/model.FCStd',
    'a//model.FCStd','a\\model.FCStd','a/./model.FCStd','a/\u0000.FCStd'])('rejects unsafe relative input %s', rel => {
    expect(()=>audit(rel)).toThrow(/Invalid/);
  });
  it('rejects ambiguous identities, missing fingerprints, duplicate IDs/paths and unbounded inputs', () => {
    const a = source('a/DEMO42.007-H-Plate.FCStd',1);
    expect(()=>inspectSelectedCadNames([])).toThrow(/1–200/);
    expect(()=>inspectSelectedCadNames(Array.from({length:201},(_,index)=>source(`a/${index}.FCStd`,index)))).toThrow(/1–200/);
    expect(()=>inspectSelectedCadNames([a,{...a,rel:'b/other.FCStd'}])).toThrow(/duplicate/);
    expect(()=>inspectSelectedCadNames([a,{...a,item_id:'another'}])).toThrow(/duplicate/);
    expect(()=>inspectSelectedCadNames([{...a,sha256:'bad'}])).toThrow(/Invalid/);
    expect(inspectSelectedCadNames([{...a,sha256:null}]).complete).toBe(false);
  });
  it('rejects an oversized result instead of truncating groups or manual input details', () => {
    const selected = Array.from({length:200},(_,index)=>source(`${index}/${'N'.repeat(1900)}.FCStd`,index));
    expect(()=>inspectSelectedCadNames(selected)).toThrow(/256KiB/);
  });
});
