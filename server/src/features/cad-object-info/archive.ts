import { CadObjectInfoError } from "./error.js";
import type { CadObjectInfoBudget } from "./budget.js";

const invalid = () => { throw new CadObjectInfoError("invalid_fcstd_archive", "FCStd ZIP 目录或 Document.xml 完整性无效"); };
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array, budget?: CadObjectInfoBudget) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    if (i % 4096 === 0) budget?.check();
    crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type CadDocumentArchiveSpan = { method: 0 | 8; compressedStart: number; compressedBytes: number; originalBytes: number };

/** Validate ZIP metadata and, when supplied, the extracted XML.
 * The existing bounded FCStd ZIP helper remains the only extraction implementation.
 * Non-XML payloads are not inflated or CRC-checked; their directory boundaries are checked.
 * Undefined documentBytes is an internal light-reader metadata preflight only;
 * it must be followed by bounded length validation, extraction and CRC verification.
 */
export function verifyCadObjectArchive(bytes: Uint8Array, documentBytes: Uint8Array | undefined, budget?: CadObjectInfoBudget, documentName = "Document.xml"): CadDocumentArchiveSpan {
  // A read-only light adapter may carry the legacy spelling of this one ZIP
  // member. This is not an arbitrary archive-path or extraction override.
  if (!/^document\.xml$/i.test(documentName)) invalid();
  budget?.check();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => { if (offset < 0 || offset + 2 > bytes.length) invalid(); return view.getUint16(offset, true); };
  const u32 = (offset: number) => { if (offset < 0 || offset + 4 > bytes.length) invalid(); return view.getUint32(offset, true); };
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (end % 1024 === 0) budget?.check();
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  }
  if (end < 0 || end < bytes.length - 65557 || u16(end + 4) !== 0 || u16(end + 6) !== 0) invalid();
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  // ZIP64/multi-volume archives are outside the existing 64 MiB FCStd read contract.
  if (u16(end + 8) !== count || count === 0xffff || start === 0xffffffff || size === 0xffffffff || start + size !== end) invalid();
  if (count > 10000) throw new CadObjectInfoError("resource_limit", "FCStd ZIP 目录超过 10000 个条目上限");
  let cursor = start; let documents = 0; let document: CadDocumentArchiveSpan | undefined;
  for (let i = 0; i < count; i++) {
    if (i % 256 === 0) budget?.check();
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) invalid();
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const compressed = u32(cursor + 20), original = u32(cursor + 24);
    const nameLength = u16(cursor + 28), extraLength = u16(cursor + 30), commentLength = u16(cursor + 32);
    const local = u32(cursor + 42); const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || u16(cursor + 34) !== 0 || local + 30 > start || u32(local) !== 0x04034b50) invalid();
    if (u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== nameLength) invalid();
    for (let j = 0; j < nameLength; j++) if (bytes[cursor + 46 + j] !== bytes[local + 30 + j]) invalid();
    const body = local + 30 + nameLength + u16(local + 28);
    if (body > start || body + compressed > start) invalid();
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== original)) invalid();
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === documentName) {
      if (++documents > 1 || flags & 1 || ![0, 8].includes(method) || (method === 0 && compressed !== original)) invalid();
      if (documentBytes !== undefined && (original !== documentBytes.length || crc32(documentBytes, budget) !== crc)) invalid();
      document = { method: method as 0 | 8, compressedStart: body, compressedBytes: compressed, originalBytes: original };
    }
    cursor = next;
  }
  if (cursor !== end || documents !== 1) invalid();
  budget?.check();
  return document!;
}
