import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { COMPANION_READ_WORKER } from './read-worker.js';

export const MAX_DIRECTORY_ENTRIES = 2000;
export const MAX_COMPANION_CANDIDATES = 100;
export const MAX_COMPANION_BYTES = 2 * 1024 * 1024;
export type CompanionFsCode = 'unsafe' | 'unreadable' | 'invalid_encoding' | 'changed' | 'cancelled' | 'limit';
export class CompanionFsError extends Error {
  constructor(readonly code: CompanionFsCode, message: string) { super(message); this.name = 'CompanionFsError'; }
}
export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CompanionFsError('cancelled', '文档读取已取消');
}
export function assertRoot(workspace: string): string {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(workspace)) throw new CompanionFsError('unsafe', '需要明确工作空间目录');
  try {
    const stat = fs.lstatSync(workspace);
    const root = fs.realpathSync(workspace);
    const canonical = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !canonical.isDirectory() || canonical.isSymbolicLink()
      || stat.dev !== canonical.dev || stat.ino !== canonical.ino || root === path.parse(root).root) throw new Error();
    return root;
  } catch { throw new CompanionFsError('unsafe', '工作空间不是安全的普通目录'); }
}
export function validateRelative(rel: string): string {
  if (typeof rel !== 'string' || !rel || rel.length > 4096 || /[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(rel) || path.posix.isAbsolute(rel)
    || rel.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || ['node_modules', '__pycache__'].includes(part))) {
    throw new CompanionFsError('unsafe', '仅接受工作空间内明确的安全相对路径');
  }
  return rel;
}
/** No symlink segments. Missing is permitted only for the final output leaf. */
export function safeRelative(workspace: string, rel: string, options: { allowMissingLeaf?: boolean } = {}): string {
  const root = assertRoot(workspace), parts = validateRelative(rel).split('/');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || index < parts.length - 1 && !stat.isDirectory()) throw new CompanionFsError('unsafe', '路径含别名或非目录节点');
    } catch (error) {
      if (options.allowMissingLeaf && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return current;
      if (error instanceof CompanionFsError) throw error;
      throw new CompanionFsError('unreadable', '文档路径不存在或不可读取');
    }
  }
  return current;
}
const WORKER_MESSAGES: Record<CompanionFsCode, string> = {
  unsafe: '文档路径包含不安全节点', unreadable: '无法读取指定文档', invalid_encoding: '文档不是有效 UTF-8 文本',
  changed: '文档或目录在读取期间变化', cancelled: '文档读取已取消', limit: '文档超过读取上限',
};
function worker(workspace: string, spec: Record<string, unknown>, maxBuffer: number): Record<string, unknown> {
  const root = assertRoot(workspace), rootStat = fs.lstatSync(root, { bigint: true });
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) if (process.env[key] !== undefined) env[key] = process.env[key];
  let response: unknown;
  try {
    const result = childProcess.execFileSync(process.execPath, ['--input-type=commonjs', '--eval', COMPANION_READ_WORKER], {
      cwd: root, env, input: JSON.stringify({ ...spec, rootIdentity: [String(rootStat.dev), String(rootStat.ino)] }),
      encoding: 'utf8', maxBuffer, timeout: 10_000, killSignal: 'SIGKILL', windowsHide: true,
    });
    response = JSON.parse(result);
  } catch (error) {
    try { response = JSON.parse(String((error as { stdout?: unknown }).stdout ?? '')); } catch { /* Fixed fallback below. */ }
    const code = (response as { error?: unknown } | undefined)?.error;
    if (typeof code === 'string' && Object.hasOwn(WORKER_MESSAGES, code)) throw new CompanionFsError(code as CompanionFsCode, WORKER_MESSAGES[code as CompanionFsCode]);
    throw new CompanionFsError('unreadable', '无法完成隔离只读文档检查');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new CompanionFsError('unreadable', '文档读取报告无效');
  return response as Record<string, unknown>;
}
export function listDirectory(workspace: string, directoryRel: string, limit = MAX_DIRECTORY_ENTRIES): { names: string[]; complete: boolean; proof: string } {
  try {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_DIRECTORY_ENTRIES) throw new CompanionFsError('limit', '目录预算无效');
    const rel = directoryRel === '.' ? '' : directoryRel;
    if (rel) validateRelative(rel);
    const result = worker(workspace, { mode: 'list', rel, limit }, 2 * 1024 * 1024);
    if (!Array.isArray(result.names) || result.names.length > limit || result.names.some(name => typeof name !== 'string' || !name || name === '.' || name === '..'
      || name.includes('/') || name.includes('\\') || Buffer.from(name, 'utf8').toString('utf8') !== name)
      || new Set(result.names).size !== result.names.length
      || typeof result.complete !== 'boolean' || typeof result.proof !== 'string' || !/^[a-f0-9]{64}$/.test(result.proof)) throw new CompanionFsError('unreadable', '候选目录报告无效');
    return { names: result.names as string[], complete: result.complete, proof: result.proof };
  }
  catch (error) {
    if (error instanceof CompanionFsError) throw error;
    throw new CompanionFsError('unreadable', '无法读取候选目录');
  }
}
/** Read bytes for an exact, bounded file; never follows links or changes files. */
export function readBoundedFile(workspace: string, rel: string, maxBytes: number, signal?: AbortSignal): { data: Buffer; bytes: number; sha256: string } {
  try {
    assertNotCancelled(signal); validateRelative(rel);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024) throw new CompanionFsError('limit', '读取预算无效');
    const result = worker(workspace, { mode: 'read', rel, maxBytes }, Math.ceil(maxBytes / 3) * 4 + 128 * 1024);
    assertNotCancelled(signal);
    if (!Number.isSafeInteger(result.bytes) || Number(result.bytes) < 0 || Number(result.bytes) > maxBytes || typeof result.data !== 'string'
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.data) || typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.sha256)) throw new CompanionFsError('unreadable', '文档读取报告无效');
    const data = Buffer.from(result.data, 'base64');
    if (data.byteLength !== result.bytes || data.toString('base64') !== result.data || createHash('sha256').update(data).digest('hex') !== result.sha256) throw new CompanionFsError('unreadable', '文档读取指纹无效');
    return { data, bytes: Number(result.bytes), sha256: result.sha256 };
  }
  catch (error) {
    if (error instanceof CompanionFsError) throw error;
    throw new CompanionFsError('unreadable', '无法读取指定文档');
  }
}
export function readDocument(workspace: string, rel: string, signal?: AbortSignal): { text: string; bytes: number; sha256: string } {
  if (!/\.md$/i.test(rel)) throw new CompanionFsError('unsafe', '只读取 Markdown 文本');
  const result = readBoundedFile(workspace, rel, MAX_COMPANION_BYTES, signal);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(result.data);
    if (text.includes('\0')) throw new Error();
    return { text, bytes: result.bytes, sha256: result.sha256 };
  } catch { throw new CompanionFsError('invalid_encoding', '文档不是有效 UTF-8 文本'); }
}
