import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {FreecadMcpSettings} from '../../../../shared/freecad-mcp/contracts.js';
import {runtimeUserDataDir} from '../../lib/appRuntimePaths.js';

export class FreecadMcpError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 409 | 413 | 500 | 503 = 400) { super(message); }
}
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function exactKeys(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
    throw new FreecadMcpError('invalid_request', '请求字段无效');
}
const defaults = (): FreecadMcpSettings => ({mode: 'owned_batch', mod_directory: '', mod_directory_confirmed: false, existing_port: 9876});
export function validateSettings(value: unknown): FreecadMcpSettings {
  exactKeys(value, ['mode', 'mod_directory', 'mod_directory_confirmed', 'existing_port']);
  if (!['owned_batch', 'existing'].includes(String(value.mode)) || typeof value.mode !== 'string'
    || typeof value.mod_directory !== 'string' || value.mod_directory.length > 4096 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.mod_directory)
    || (value.mod_directory !== '' && (!path.isAbsolute(value.mod_directory) || path.resolve(value.mod_directory) !== value.mod_directory))
    || typeof value.mod_directory_confirmed !== 'boolean' || (!value.mod_directory && value.mod_directory_confirmed)
    || !Number.isInteger(value.existing_port) || Number(value.existing_port) < 1024 || Number(value.existing_port) > 65535)
    throw new FreecadMcpError('invalid_settings', '连接模式、Mod 绝对目录或本机端口无效');
  return {mode: value.mode as FreecadMcpSettings['mode'], mod_directory: value.mod_directory,
    mod_directory_confirmed: value.mod_directory_confirmed, existing_port: Number(value.existing_port)};
}
const bytesFor = (settings: FreecadMcpSettings) => `${JSON.stringify({schema_version: 1, settings})}\n`;
const revisionOf = (settings: FreecadMcpSettings) => createHash('sha256').update(bytesFor(settings)).digest('hex');
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** No symlink traversal, including absent targets with existing symlink ancestors. */
function directoryChain(directory: string, create: boolean): void {
  let current = path.parse(directory).root;
  for (const name of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, name);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe');
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (create) fs.mkdirSync(current, {mode: 0o700});
    }
  }
}

/** Host-scoped preferences only. GET never creates a directory or repairs bad data. */
export class FreecadMcpSettingsStore {
  readonly filename: string;
  constructor(filename = path.join(runtimeUserDataDir(), 'freecad-mcp-settings.json')) {
    if (!path.isAbsolute(filename) || path.resolve(filename) !== filename) throw new Error('Invalid host settings location');
    this.filename = filename;
  }
  read(): {settings: FreecadMcpSettings; revision: string} {
    try {
      directoryChain(path.dirname(this.filename), false);
      let fd: number;
      try { fd = fs.openSync(this.filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
      catch (error) { if (isMissing(error)) { const settings = defaults(); return {settings, revision: revisionOf(settings)}; } throw error; }
      let bytes: Buffer;
      try {
        const before = fs.fstatSync(fd, {bigint: true}), named = fs.lstatSync(this.filename, {bigint: true});
        if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > 32768n || named.isSymbolicLink()
          || before.dev !== named.dev || before.ino !== named.ino) throw new Error('unsafe');
        bytes = Buffer.alloc(Number(before.size) + 1);
        let offset = 0;
        while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) break; offset += n; }
        const after = fs.fstatSync(fd, {bigint: true}), namedAfter = fs.lstatSync(this.filename, {bigint: true});
        if (offset !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
          || after.nlink !== 1n || namedAfter.isSymbolicLink() || namedAfter.dev !== before.dev || namedAfter.ino !== before.ino) throw new Error('changed');
        bytes = bytes.subarray(0, offset);
      } finally { fs.closeSync(fd); }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
      exactKeys(value, ['schema_version', 'settings']);
      if (value.schema_version !== 1) throw new Error('version');
      const settings = validateSettings(value.settings);
      return {settings, revision: revisionOf(settings)};
    } catch { throw new FreecadMcpError('settings_unreadable', 'MCP 配置文件无效或不安全；未自动覆盖，请先处理本地配置', 500); }
  }
  save(value: unknown, expectedRevision: unknown): {settings: FreecadMcpSettings; revision: string} {
    const settings = validateSettings(value);
    if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision))
      throw new FreecadMcpError('invalid_revision', '配置版本无效');
    if (this.read().revision !== expectedRevision) throw new FreecadMcpError('settings_changed', '配置已变化，请重新检测后保存', 409);
    const temporary = path.join(path.dirname(this.filename), `.freecad-mcp-${randomUUID()}.tmp`);
    let created = false;
    try {
      directoryChain(path.dirname(this.filename), true);
      const fd = fs.openSync(temporary, 'wx', 0o600); created = true;
      try { fs.writeFileSync(fd, bytesFor(settings)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // No async gap between the final compare and atomic replacement.
      if (this.read().revision !== expectedRevision) throw new FreecadMcpError('settings_changed', '配置已变化，请重新检测后保存', 409);
      fs.renameSync(temporary, this.filename); created = false;
      return {settings, revision: revisionOf(settings)};
    } catch (error) {
      if (error instanceof FreecadMcpError) throw error;
      throw new FreecadMcpError('settings_write_failed', '未能安全保存 MCP 配置；请重新检测当前状态', 503);
    } finally { if (created) { try { fs.unlinkSync(temporary); } catch { /* Preserve the original failure; never remove another target. */ } } }
  }
}
