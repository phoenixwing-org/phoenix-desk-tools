import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {SidecarProvenance} from '../../../../shared/cad-companion/contracts.js';
import {formatSidecarProvenanceMarker} from '../cad-companions/output.js';
import {fcstdWorkspace, safeFcstdPath} from '../../lib/fcstdBatchFiles.js';

const MAX_NOTES_BYTES = 2 * 1024 * 1024;
const OWNED_STAGE_NAME = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-出图说明\.md$/u;
class DraftNotesError extends Error {}
function fail(message: string): never {throw new DraftNotesError(message);}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const identity = (stat: fs.BigIntStats) => [stat.dev, stat.ino].join(':');
const stamp = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');
function assertOwnedRegular(stat: fs.BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) fail('暂存说明必须是本任务独有的普通文件，不能是符号链接或硬链接');
}
/** Include a sentinel byte so growth cannot turn a bounded read into a prefix. */
function readExact(fd: number, size: number): Buffer {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_NOTES_BYTES) fail('暂存说明超过 2 MiB 安全上限');
  const data = Buffer.alloc(size + 1); let length = 0;
  while (length < data.length) {
    const amount = fs.readSync(fd, data, length, Math.min(64 * 1024, data.length - length), length);
    if (!amount) break;
    length += amount;
  }
  if (length !== size) fail('暂存说明在读取期间变化，未确认定稿');
  return data.subarray(0, length);
}

/**
 * Add provenance only to this job's private hidden stage, after independent CAD
 * verification. This is not a publisher or a portable parent-swap-proof writer.
 * A failure may leave this owned stage partially written; its job cleans it up.
 */
export function finalizeDraftNotes(
  root: string,
  stageNotesAbs: string,
  expectedNotesSha: string,
  provenance: SidecarProvenance,
): {sha256: string; bytes: number} {
  try {
    if (typeof root !== 'string' || !path.isAbsolute(root)
      || typeof stageNotesAbs !== 'string' || !path.isAbsolute(stageNotesAbs)
      || stageNotesAbs !== path.resolve(stageNotesAbs) || !OWNED_STAGE_NAME.test(path.basename(stageNotesAbs))) fail('只允许本任务的隐藏 UUID 出图说明暂存文件');
    if (typeof expectedNotesSha !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedNotesSha)) fail('暂存说明需要明确的原正文 SHA256');
    // The formatter validates shape and escapes metadata; nothing is evaluated.
    const marker = formatSidecarProvenanceMarker(provenance);
    const workspace = fcstdWorkspace(root), rel = path.relative(workspace, stageNotesAbs);
    const filename = safeFcstdPath(workspace, rel), before = fs.lstatSync(filename, {bigint: true});
    assertOwnedRegular(before);
    if (before.size > BigInt(MAX_NOTES_BYTES)) fail('暂存说明超过 2 MiB 安全上限');
    const fd = fs.openSync(filename, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = fs.fstatSync(fd, {bigint: true}); assertOwnedRegular(opened);
      if (stamp(before) !== stamp(opened)) fail('暂存说明在打开前变化，未确认定稿');
      const original = readExact(fd, Number(before.size));
      if (hash(original) !== expectedNotesSha) fail('暂存说明原正文 SHA256 已变化，未追加来源标记');
      let text: string;
      try {text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(original);}
      catch {fail('暂存说明不是有效 UTF-8 文本');}
      if (text.includes('\0')) fail('暂存说明包含 NUL，不是可追加的 UTF-8 文本');
      if (/<!--\s*phoenix-cad-companion\b/iu.test(text)) fail('暂存说明已有来源标记，不能重复追加或替换');
      const separator = original.length === 0 ? '' : original[original.length - 1] === 10 ? '\n' : '\n\n';
      const addition = Buffer.from(`${separator}${marker}\n`, 'utf8');
      const finalSize = original.byteLength + addition.byteLength;
      if (finalSize > MAX_NOTES_BYTES) fail('正文与来源标记总量超过 2 MiB 安全上限');
      const preWrite = fs.fstatSync(fd, {bigint: true}), atPath = fs.lstatSync(safeFcstdPath(workspace, rel), {bigint: true});
      assertOwnedRegular(preWrite); assertOwnedRegular(atPath);
      if (stamp(before) !== stamp(preWrite) || stamp(before) !== stamp(atPath)) fail('暂存说明在写入前变化，未追加来源标记');
      let offset = 0;
      while (offset < addition.byteLength) {
        const amount = fs.writeSync(fd, addition, offset, addition.byteLength - offset, original.byteLength + offset);
        if (!Number.isSafeInteger(amount) || amount <= 0 || amount > addition.byteLength - offset) fail('暂存说明追加未完成，未确认定稿');
        offset += amount;
      }
      fs.fsyncSync(fd);
      const written = fs.fstatSync(fd, {bigint: true}); assertOwnedRegular(written);
      if (identity(before) !== identity(written) || written.size !== BigInt(finalSize)) fail('暂存说明写后身份或大小不一致，未确认定稿');
      const finalBytes = readExact(fd, finalSize), expected = Buffer.concat([original, addition]);
      const after = fs.fstatSync(fd, {bigint: true}), finalPath = fs.lstatSync(safeFcstdPath(workspace, rel), {bigint: true});
      assertOwnedRegular(after); assertOwnedRegular(finalPath);
      if (stamp(written) !== stamp(after) || stamp(written) !== stamp(finalPath) || !finalBytes.equals(expected)) fail('暂存说明写后字节或身份变化，未确认定稿');
      return {sha256: hash(finalBytes), bytes: finalBytes.byteLength};
    } finally {fs.closeSync(fd);}
  } catch (error) {
    if (error instanceof DraftNotesError) throw error;
    // Never forward raw filesystem errors, document content or caller metadata.
    throw new DraftNotesError('暂存说明定稿失败；未确认发布，请清理本任务暂存文件');
  }
}
