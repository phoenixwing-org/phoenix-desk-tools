import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { preserveAssemblySidecars } from './native-preview.js';
import { readAssemblyArchive } from './native-archive.js';

const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])), { level: 0 });
const xml = '<Document><ObjectData/></Document>';

describe('native sidecar preservation (no native execution)', () => {
  it('preserves GUI survivor attributes and thumbnail bytes but prunes only disclosed removed view providers', () => {
    const gui = '<GuiDocument><ViewProviderData Count="2"><ViewProvider name="Keeper" expanded="1"><Properties><Property name="PublicColor"><Color value="123"/></Property></Properties></ViewProvider><ViewProvider name="Removed" expanded="0"><Properties/></ViewProvider></ViewProviderData></GuiDocument>';
    const original = zip({ 'Document.xml': xml, 'GuiDocument.xml': gui, 'thumbnails/Thumbnail.png': new Uint8Array([1, 2, 3]) });
    const staged = zip({ 'Document.xml': xml });
    const result = readAssemblyArchive(preserveAssemblySidecars(original, staged, ['Removed']));
    const value = strFromU8(result['GuiDocument.xml']);
    expect(value).toContain('Count="1"'); expect(value).toContain('name="Keeper" expanded="1"');
    expect(value).toContain('<Color value="123"/>'); expect(value).not.toContain('name="Removed"');
    expect([...result['thumbnails/Thumbnail.png']]).toEqual([1, 2, 3]);
  });

  it('never overwrites native-required resource slots with the originals', () => {
    const original = zip({ 'Document.xml': '<Document><Part file="Part.Shape.brp"/><PlacementList file="PlacementList1"/></Document>', 'Part.Shape.brp': 'old geometry', PlacementList1: 'old list' });
    const staged = zip({ 'Document.xml': xml, 'Part.Shape.brp': 'native verified geometry', PlacementList: 'native verified list' });
    const result = readAssemblyArchive(preserveAssemblySidecars(original, staged, []));
    expect(strFromU8(result['Part.Shape.brp'])).toBe('native verified geometry');
    expect(result.PlacementList1).toBeUndefined(); expect(strFromU8(result.PlacementList)).toBe('native verified list');
  });

  it('rejects silent loss of unknown archive members', () => {
    expect(() => preserveAssemblySidecars(zip({ 'Document.xml': xml, 'PublicMetadata.txt': 'preserve me' }), zip({ 'Document.xml': xml }), [])).toThrow();
  });

  it('rejects conflicting thumbnail data instead of silently claiming regeneration', () => {
    expect(() => preserveAssemblySidecars(zip({ 'Document.xml': xml, 'thumbnails/Thumbnail.png': 'old' }), zip({ 'Document.xml': xml, 'thumbnails/Thumbnail.png': 'different' }), [])).toThrow();
  });

  it('rejects GUI member case aliases before merging', () => {
    expect(() => preserveAssemblySidecars(zip({ 'Document.xml': xml, 'GuiDocument.xml': '<GuiDocument/>', 'guidocument.xml': '<GuiDocument/>' }), zip({ 'Document.xml': xml }), [])).toThrow();
  });

  it('does not span across a self-closing removed provider or fake closing text inside CDATA', () => {
    const gui = '<GuiDocument><ViewProviderData Count="2"><ViewProvider name="Removed"/><ViewProvider name="Keeper"><Properties><Property name="Note"><String><![CDATA[</ViewProvider><ViewProvider name="Removed">]]></String></Property></Properties></ViewProvider></ViewProviderData></GuiDocument>';
    const result = readAssemblyArchive(preserveAssemblySidecars(zip({ 'Document.xml': xml, 'GuiDocument.xml': gui }), zip({ 'Document.xml': xml }), ['Removed']));
    const value = strFromU8(result['GuiDocument.xml']);
    expect(value).toContain('name="Keeper"'); expect(value).toContain('<![CDATA[</ViewProvider><ViewProvider name="Removed">]]>');
    expect(value).not.toContain('<ViewProvider name="Removed"/>'); expect(value).toContain('Count="1"');
  });
});
