import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { verifyCadObjectArchive } from '../cad-object-info/archive.js';
import { readFcstdLightBytes } from '../../lib/fcstdBatchFiles.js';

export class AssemblyArchiveError extends Error {
  readonly code = 'manual_required';
  constructor(readonly reason: string) { super('装配归档完整性或预算未通过'); this.name = 'AssemblyArchiveError'; }
}
const fail = (reason: string): never => { throw new AssemblyArchiveError(reason); };
export const ASSEMBLY_CLOSURE_PAYLOAD_LIMIT = 256 * 1024 * 1024;
export function accumulateAssemblyClosurePayload(total: number, verifiedBytes: number): number {
  if (![total, verifiedBytes].every(value => Number.isSafeInteger(value) && value >= 0)
    || total + verifiedBytes > ASSEMBLY_CLOSURE_PAYLOAD_LIMIT) fail('mirror_closure_payload_limit');
  return total + verifiedBytes;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** Domain-only full archive verification. The shared verifier proves directory
 * boundaries first; each payload is then bounded by zlib's actual output cap
 * and checked for exact length+CRC, before any Native or sidecar merge. */
export function readAssemblyArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > 64 * 1024 * 1024) fail('archive_file_limit');
  try { verifyCadObjectArchive(bytes, undefined); } catch { return fail('archive_directory_invalid'); }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true), u32 = (offset: number) => view.getUint32(offset, true);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  const count = u16(end + 10); if (count > 10000) fail('archive_entry_limit');
  const entries: Array<{ name: string; body: number; compressed: number; original: number; crc: number; method: number }> = [];
  const aliases = new Set<string>(); let cursor = u32(end + 16), total = 0;
  for (let index = 0; index < count; index++) {
    const flags = u16(cursor + 8), method = u16(cursor + 10), compressed = u32(cursor + 20), original = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32), local = u32(cursor + 42);
    let name: string;
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { return fail('archive_name_encoding'); }
    const logical = name.endsWith('/') ? name.slice(0, -1) : name;
    if (!logical || name.startsWith('/') || /[\\\x00-\x1f:]/.test(name) || logical.split('/').some(part => !part || part === '.' || part === '..')) fail('archive_member_path');
    const alias = logical.normalize('NFC').toLowerCase();
    if (aliases.has(alias)) fail('archive_member_alias'); aliases.add(alias);
    total += original; if (total > 256 * 1024 * 1024) fail('archive_payload_limit');
    if (flags & 1 || ![0, 8].includes(method) || (method === 0 && original !== compressed)) fail('archive_compression_unsupported');
    entries.push({ name, method, compressed, original, crc: u32(cursor + 16), body: local + 30 + nameLength + u16(local + 28) });
    cursor += 46 + nameLength + extra + comment;
  }
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.body, entry.body + entry.compressed);
    let actual: Uint8Array;
    try { actual = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: entry.original + 1 }); }
    catch { return fail('archive_payload_invalid'); }
    if (actual.byteLength !== entry.original || crc32(actual) !== entry.crc) fail('archive_payload_invalid');
    files[entry.name] = actual;
  }
  if (!files['Document.xml']) fail('archive_document_spelling');
  return files;
}

export function readStableAssemblyFile(filename: string): Uint8Array {
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64n * 1024n * 1024n) fail('unsafe_staged_file');
  const bytes = readFcstdLightBytes(filename), after = fs.lstatSync(filename, { bigint: true });
  const stamp = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
  if (stamp(before) !== stamp(after)) fail('staged_file_changed_during_read');
  return bytes;
}
