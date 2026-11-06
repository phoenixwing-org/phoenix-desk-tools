import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { deflateRawSync } from 'node:zlib';
import { accumulateAssemblyClosurePayload, ASSEMBLY_CLOSURE_PAYLOAD_LIMIT, readAssemblyArchive } from './native-archive.js';

const fixture = (more: Record<string, Uint8Array> = {}) => zipSync({ 'Document.xml': strToU8('<Document/>'), ...more }, { level: 0 });
function offset(bytes: Uint8Array, signature: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 4 <= bytes.length; i++) if (view.getUint32(i, true) === signature) return i;
  throw new Error('synthetic archive signature absent');
}

describe('assembly full archive guard (no native execution)', () => {
  it('caps the complete mirror closure, not the per-file cap multiplied by file count', () => {
    const half = ASSEMBLY_CLOSURE_PAYLOAD_LIMIT / 2;
    expect(accumulateAssemblyClosurePayload(half, half)).toBe(ASSEMBLY_CLOSURE_PAYLOAD_LIMIT);
    expect(() => accumulateAssemblyClosurePayload(half + 1, half)).toThrow();
    expect(() => accumulateAssemblyClosurePayload(0, Number.NaN)).toThrow();
  });
  it('verifies all entry payloads, including non-XML members', () => {
    const bytes = fixture({ 'Public.bin': new Uint8Array([8, 9, 10]) });
    expect([...readAssemblyArchive(bytes)['Public.bin']]).toEqual([8, 9, 10]);
  });
  it('rejects payload corruption outside Document.xml', () => {
    const bytes = fixture({ 'Public.bin': new Uint8Array([8, 9, 10]) });
    const needle = bytes.findIndex((v, i) => v === 8 && bytes[i + 1] === 9 && bytes[i + 2] === 10);
    bytes[needle] ^= 1;
    expect(() => readAssemblyArchive(bytes)).toThrow();
  });
  it('rejects duplicate case aliases and traversal members', () => {
    expect(() => readAssemblyArchive(fixture({ 'Public.bin': new Uint8Array(), 'public.BIN': new Uint8Array() }))).toThrow();
    expect(() => readAssemblyArchive(fixture({ '../Public.bin': new Uint8Array() }))).toThrow();
  });
  it('rejects declared inflation budgets before extraction', () => {
    const bytes = fixture(); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = offset(bytes, 0x02014b50), local = offset(bytes, 0x04034b50);
    view.setUint32(central + 24, 257 * 1024 * 1024, true); view.setUint32(local + 22, 257 * 1024 * 1024, true);
    expect(() => readAssemblyArchive(bytes)).toThrow();
  });
  it('does not let a dishonest compressed stream truncate to its fake claimed length', () => {
    // Keep headers mutually consistent while deflate expands beyond the claim.
    const content = strToU8('<Document>' + 'x'.repeat(4096) + '</Document>');
    const bytes = zipSync({ 'Document.xml': content }, { level: 6 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = offset(bytes, 0x02014b50), local = offset(bytes, 0x04034b50);
    expect(deflateRawSync(content).length).toBeGreaterThan(0);
    view.setUint32(central + 24, 8, true); view.setUint32(local + 22, 8, true);
    expect(() => readAssemblyArchive(bytes)).toThrow();
  });
});
