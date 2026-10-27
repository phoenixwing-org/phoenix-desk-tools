import fs from 'node:fs';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';
import type {CompanionDiagnostic, CompanionDiscoveryResult, CompanionRequest} from '../../../../shared/cad-companion/contracts.js';
import {parseCadIdentity} from '../../../../shared/cad-companion/model.js';
import {discoverCompanionDocuments, readCompanionText} from '../cad-companions/discovery.js';
import {assertNotCancelled, assertRoot, CompanionFsError, listDirectory, MAX_DIRECTORY_ENTRIES, readBoundedFile, safeRelative, validateRelative} from '../cad-companions/filesystem.js';
import {parseSidecarProvenanceMarker, verifySidecarProvenance} from '../cad-companions/output.js';
import {verifyCadObjectArchive} from '../cad-object-info/archive.js';
import {CAD_OBJECT_LIMITS, parseCadObjectDocumentXml} from '../cad-object-info/document.js';

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const fold = (value: string) => value.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
export type ReferencePdfEvidence = {
  kind: 'sidecar' | 'drawing_marker';
  rel: string;
  status: 'verified' | 'legacy' | 'unknown' | 'invalid' | 'unreadable' | 'conflict' | 'other_pdf';
  sha256: string | null;
};
export type ReferencePdfInspection = {
  version: 1;
  pdf_rel: string;
  pdf_sha256: string | null;
  /** All rows remain visible. Only generated_verified may be excluded automatically. */
  classification: 'generated_verified' | 'candidate' | 'manual';
  evidence: ReferencePdfEvidence[];
  diagnostics: CompanionDiagnostic[];
};
export type ReferencePdfInput = {pdf_rel: string; binding: CompanionRequest; signal?: AbortSignal};
const directory = (rel: string) => path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
function signature(result: CompanionDiscoveryResult): string {
  return JSON.stringify([result.status, result.scope_complete, result.candidates.map(item => [item.rel,item.purpose,item.naming,item.read_status,item.sha256,item.bytes,item.diagnostics])]);
}
function observationProof(root: string, files: string[], directories: string[], signal?: AbortSignal): string {
  let used = 0;
  const scopes = [...new Set(directories)].map(rel => {
    assertNotCancelled(signal);
    const listing = listDirectory(root, rel, MAX_DIRECTORY_ENTRIES - used); used += listing.names.length;
    if (!listing.complete) throw new CompanionFsError('limit', '生成证据目录无法完整核对');
    return [rel,listing.proof];
  });
  const entries = [...new Set(files)].map(rel => {
    assertNotCancelled(signal);
    const stat = fs.lstatSync(safeRelative(root, rel), {bigint: true});
    if (!stat.isFile() || stat.isSymbolicLink()) throw new CompanionFsError('unsafe', '生成证据不是普通文件');
    return [rel,String(stat.dev),String(stat.ino),String(stat.size),String(stat.mtimeNs),String(stat.ctimeNs)];
  });
  return JSON.stringify([scopes,entries]);
}
function pdfContainer(bytes: Buffer): boolean {
  return /^%PDF-\d\.\d/.test(bytes.subarray(0,16).toString('latin1'))
    && bytes.subarray(Math.max(0,bytes.length-1024)).toString('latin1').includes('%%EOF');
}
/** Inspect only saved XML, with validated ZIP boundaries, bounded inflate and CRC. */
async function drawingHasGeneratedHint(bytes: Buffer, signal?: AbortSignal): Promise<boolean> {
  assertNotCancelled(signal);
  const span = verifyCadObjectArchive(bytes, undefined);
  if (span.originalBytes > CAD_OBJECT_LIMITS.xmlBytes) throw new CompanionFsError('limit', '图纸 XML 超过检查预算');
  const compressed = bytes.subarray(span.compressedStart, span.compressedStart + span.compressedBytes);
  const xmlBytes = span.method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: span.originalBytes + 1});
  if (xmlBytes.length !== span.originalBytes) throw new CompanionFsError('unreadable', '图纸 XML 长度无效');
  verifyCadObjectArchive(bytes, xmlBytes);
  const xml = new TextDecoder('utf-8', {fatal: true}).decode(xmlBytes);
  await parseCadObjectDocumentXml(xml, signal);
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  // These legacy/current saved tokens are clues, never final-file hash proof.
  return /AI\.(?:SourceSHA256|TitleBlockSnapshot)|phoenix-cad-companion/i.test(semantic);
}

/**
 * Classifies one visible PDF observation, not an engineering approval or write
 * permission. It neither scans the workspace nor silently hides unknown PDFs.
 * Automatic generated evidence requires an explicit draft binding and all
 * current hashes; filename suffixes and legacy prose/Meta are insufficient.
 */
export async function inspectReferencePdf(workspace: string, input: ReferencePdfInput): Promise<ReferencePdfInspection> {
  const result: ReferencePdfInspection = {version: 1, pdf_rel: input?.pdf_rel, pdf_sha256: null, classification: 'manual', evidence: [], diagnostics: []};
  const add = (code: string, message: string) => result.diagnostics.push({code,message});
  const signal = input?.signal;
  assertNotCancelled(signal);
  try {
    const root = assertRoot(workspace), pdfRel = validateRelative(input.pdf_rel), binding = structuredClone(input.binding);
    if (!/\.pdf$/i.test(pdfRel) || binding?.purpose !== 'drawing_notes') throw new CompanionFsError('unsafe', '需要明确 PDF 和出图说明绑定');
    const pdf = readBoundedFile(root, pdfRel, MAX_PDF_BYTES, signal); result.pdf_sha256 = pdf.sha256;
    if (!pdfContainer(pdf.data)) {add('invalid_pdf', 'PDF 容器标识不完整，需人工核对'); return result;}
    const discovery = await discoverCompanionDocuments(root, binding, signal);
    const notes = discovery.candidates.filter(item => item.purpose === 'drawing_notes' || item.purpose === 'unknown');
    for (const note of notes) result.evidence.push({kind: 'sidecar', rel: note.rel,
      status: note.read_status !== 'readable' ? 'unreadable' : discovery.status === 'conflict' ? 'conflict' : 'unknown', sha256: note.sha256});

    let drawingHint = false, drawingRel: string | undefined, drawingHash: string | undefined;
    if (/\.drawing\.pdf$/i.test(pdfRel)) {
      const paired = pdfRel.replace(/\.pdf$/i, '.FCStd'), folder = directory(paired), leaf = path.posix.basename(paired);
      const listing = listDirectory(root, folder);
      if (!listing.complete) {add('scope_incomplete', '图纸相邻目录不完整，不能证明生成来源'); return result;}
      const matches = listing.names.filter(name => fold(name) === fold(leaf));
      if (matches.length > 1 || matches.length === 1 && matches[0] !== leaf) {add('drawing_alias', '图纸存在大小写或 Unicode 别名，需明确绑定'); return result;}
      if (matches.length) {
        drawingRel = paired;
        try {
          const drawing = readBoundedFile(root, paired, MAX_PDF_BYTES, signal); drawingHash = drawing.sha256;
          drawingHint = await drawingHasGeneratedHint(drawing.data, signal);
          if (drawingHint) result.evidence.push({kind: 'drawing_marker',rel: paired,status: 'legacy',sha256: drawingHash});
        } catch (error) {
          assertNotCancelled(signal);
          result.evidence.push({kind: 'drawing_marker',rel: paired,status: 'unreadable',sha256: drawingHash ?? null});
          add('drawing_unreadable', '相邻图纸不能安全核对，不能复作原参考 PDF'); return result;
        }
      }
    }
    if (!discovery.scope_complete || discovery.status === 'manual' || discovery.status === 'conflict') {
      add('sidecar_manual', '说明候选不完整、身份未知或内容冲突，PDF 保留人工态'); return result;
    }
    let provenance: ReturnType<typeof parseSidecarProvenanceMarker> | undefined;
    let noteRel: string | undefined, noteHash: string | undefined;
    if (notes.length) {
      const selected = notes.find(item => item.rel === discovery.selected_rel) ?? notes[0];
      if (selected.purpose !== 'drawing_notes' || selected.read_status !== 'readable' || !selected.sha256) {
        add('sidecar_unknown', '旧说明用途或内容不可核对，PDF 保留人工态'); return result;
      }
      noteRel = selected.rel; noteHash = selected.sha256;
      const note = await readCompanionText(root, noteRel, noteHash, signal);
      provenance = parseSidecarProvenanceMarker(note.text);
      if (provenance.status !== 'valid') {
        for (const evidence of result.evidence) if (evidence.kind === 'sidecar') evidence.status = provenance.status === 'missing' ? 'legacy' : provenance.status;
        add('unverified_marker', '说明只有旧记录、未知或无效标记，不能作为已生成或原参考证明'); return result;
      }
      if (provenance.provenance.pdf_rel !== pdfRel) {
        for (const evidence of result.evidence) if (evidence.kind === 'sidecar') evidence.status = 'other_pdf';
        if (/\.drawing\.pdf$/i.test(pdfRel)) {add('pdf_binding_mismatch', '同族图纸说明指向另一 PDF，不能猜测改绑'); return result;}
        provenance = undefined;
      }
    }

    // Recheck the actual candidate PDF and any observed paired drawing after
    // yielding XML/discovery work. A replaced source of evidence stays manual.
    if (readBoundedFile(root, pdfRel, MAX_PDF_BYTES, signal).sha256 !== pdf.sha256
      || drawingRel && readBoundedFile(root, drawingRel, MAX_PDF_BYTES, signal).sha256 !== drawingHash) {
      add('evidence_changed', 'PDF 或图纸在核对期间变化'); return result;
    }
    if (provenance?.status === 'valid') {
      const record = provenance.provenance;
      const files = [record.source_rel,record.drawing_rel,record.pdf_rel,...(record.reference_pdf ? [record.reference_pdf.rel] : []),...notes.map(item => item.rel)];
      const directories = [directory(binding.source_rel),directory(pdfRel),...(binding.drawing_rel ? [directory(binding.drawing_rel)] : []),
        ...(binding.notes_directories ?? []).map(rel => rel === '.' ? '' : rel),...notes.map(item => directory(item.rel))];
      const before = observationProof(root, files, directories, signal);
      const again = await discoverCompanionDocuments(root, binding, signal);
      if (signature(again) !== signature(discovery)) {add('evidence_changed', '说明候选在来源核对期间变化'); return result;}
      if (noteRel && noteHash) await readCompanionText(root, noteRel, noteHash, signal);
      const verified = verifySidecarProvenance(root, record, binding, {signal});
      if (!verified.verified || record.pdf_sha256 !== pdf.sha256) {
        add('binding_or_hash_mismatch', '说明与精确来源、版次、variant、初稿或当前最终 SHA 不一致'); return result;
      }
      if (observationProof(root, files, directories, signal) !== before) {add('evidence_changed', '文件或说明候选集合在最终核对期间变化'); return result;}
      for (const evidence of result.evidence) if (evidence.kind === 'sidecar') evidence.status = 'verified';
      result.classification = 'generated_verified';
      add('generated_verified', '完整说明绑定和当前最终文件 SHA 一致；不是工程审批'); return result;
    }
    const pdfIdentity = parseCadIdentity(path.posix.basename(pdfRel).replace(/\.pdf$/i, '.FCStd'));
    if (drawingHint || pdfIdentity.role === 'drawing' && (pdfIdentity.draftSequence ?? 1) > 1) {
      add('generated_hint_only', '只有保存生成线索或初稿命名，缺完整最终 SHA 证明；PDF 保留人工态'); return result;
    }
    result.classification = 'candidate';
    add('reference_candidate', '未发现此 PDF 的生成证据；仅作为可见参考候选，不等于编号版次已匹配或工程审批');
    return result;
  } catch (error) {
    assertNotCancelled(signal);
    add(error instanceof CompanionFsError ? error.code : 'inspection_failed', '无法安全完成 PDF 来源核对，保留人工态');
    return result;
  }
}
