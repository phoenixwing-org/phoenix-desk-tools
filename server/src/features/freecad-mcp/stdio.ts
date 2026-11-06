import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FreecadMcpConnection } from '../../../../shared/freecad-mcp/contracts.js';

// A deliberately small MCP 2025-11-25 stdio client, not a generic tool runner.
// Wire framing and initialization follow the official SDK's legacy handshake:
// one UTF-8 JSON-RPC message per line; initialize, then initialized notification.
const PROTOCOL = '2025-11-25';
const VERSION = '0.3.2';
const MAX_ENTRY = 4 * 1024 * 1024;
const MAX_STDOUT = 256 * 1024;
const MAX_LINE = 128 * 1024;
const MAX_STDERR = 8 * 1024;
const REQUIRED_TOOLS = ['get_capabilities', 'get_connection_status'] as const;
type RecordValue = Record<string, unknown>;
type ProbeInput = { entry: string; entry_sha256: string; port: number; signal?: AbortSignal; timeout_ms?: number };
// Per host process, not a FreeCAD ownership claim. The actual close event is
// the only release proof once spawn returned a child, including after timeout.
let ownedProbe: object | undefined;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (reason: string, blocked = false): FreecadMcpConnection => ({ state: blocked ? 'blocked' : 'failed',
  phase: blocked ? 'none' : 'mcp', reason, bridge_version: null, supported_methods: [], mcp_verified: false });
class ProbeError extends Error {}
function invalid(): never { throw new ProbeError('MCP 响应或能力合同不兼容；未执行任何 CAD 操作。'); }

function entryChecked(input: ProbeInput): void {
  if (typeof input.entry !== 'string' || !path.isAbsolute(input.entry) || path.resolve(input.entry) !== input.entry
    || input.entry.length > 4096 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input.entry)
    || !/^[a-f0-9]{64}$/u.test(input.entry_sha256) || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535
    || !Number.isInteger(input.timeout_ms ?? 10000) || (input.timeout_ms ?? 10000) < 100 || (input.timeout_ms ?? 10000) > 30000) {
    throw new ProbeError('MCP 探测参数无效；未启动进程。');
  }
  let descriptor: number | undefined;
  try {
    if (fs.realpathSync(input.entry) !== input.entry) throw new Error();
    const before = fs.lstatSync(input.entry, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(MAX_ENTRY)) throw new Error();
    descriptor = fs.openSync(input.entry, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const same = (a: typeof before, b: typeof before) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
      && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.nlink === b.nlink;
    if (!same(before, opened)) throw new Error();
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!count) throw new Error();
      offset += count;
    }
    if (createHash('sha256').update(bytes).digest('hex') !== input.entry_sha256
      || !same(opened, fs.fstatSync(descriptor, { bigint: true })) || !same(opened, fs.lstatSync(input.entry, { bigint: true }))) throw new Error();
  } catch { throw new ProbeError('可信 MCP 入口缺失、变化或摘要不符；未启动进程。'); }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function environment(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // No NODE_OPTIONS, NODE_PATH, loader hooks, credentials or reverse Desk tools.
  for (const key of ['HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']) {
    const value = process.env[key];
    if (value !== undefined && value.length <= 8192 && !value.includes('\0')) env[key] = value;
  }
  return { ...env, PHOENIX_FREECAD_URL: `http://127.0.0.1:${port}/`, PHOENIX_FREECAD_TOOL_SCOPE: 'full', PHOENIX_TIMEOUT_MS: '5000' };
}

function names(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum
    || !value.every(name => typeof name === 'string' && /^[a-z][a-z0-9_]{0,99}$/u.test(name))
    || new Set(value).size !== value.length) return invalid();
  return value as string[];
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function toolResult(value: unknown): RecordValue {
  if (!record(value) || value.isError === true || (value.isError !== undefined && value.isError !== false)
    || !record(value.structuredContent) || value.structuredContent.ok !== true || !Array.isArray(value.content)
    || value.content.length !== 1 || !record(value.content[0]) || value.content[0].type !== 'text'
    || typeof value.content[0].text !== 'string') return invalid();
  let text: unknown;
  try { text = JSON.parse(value.content[0].text); } catch { return invalid(); }
  if (stable(text) !== stable(value.structuredContent)) return invalid();
  return value.structuredContent;
}
function toolList(value: unknown): string[] {
  if (!record(value) || !Array.isArray(value.tools) || value.tools.length > 64 || value.nextCursor !== undefined) return invalid();
  const all = names(value.tools.map(tool => record(tool) ? tool.name : null), 64);
  for (const name of REQUIRED_TOOLS) {
    const tool = value.tools.find(tool => record(tool) && tool.name === name);
    if (!record(tool) || !record(tool.inputSchema) || tool.inputSchema.type !== 'object'
      || !record(tool.inputSchema.properties) || Object.keys(tool.inputSchema.properties).length !== 0
      || tool.inputSchema.additionalProperties !== false
      || (tool.inputSchema.required !== undefined && (!Array.isArray(tool.inputSchema.required) || tool.inputSchema.required.length !== 0))
      || !record(tool.annotations) || tool.annotations.readOnlyHint !== true || tool.annotations.destructiveHint !== false) return invalid();
  }
  return all;
}

/** The caller must freeze and verify the whole trusted resource, including imports.
 * Only its private entry is injected here; this function never accepts shell text,
 * discovers instances, installs addons, calls arbitrary tools or opens CAD files. */
export async function probeMcpStdio(input: ProbeInput): Promise<FreecadMcpConnection> {
  if (input.signal?.aborted) return failure('MCP 连接检查已取消；未启动进程。');
  if (ownedProbe) return failure('已有 MCP 探测进程尚未确认退出；未启动新的探测，也不会接管或关闭 FreeCAD。', true);
  try { entryChecked(input); }
  catch (error) { return failure(error instanceof ProbeError ? error.message : 'MCP 入口无法核验；未启动进程。', true); }
  const lease = {}; ownedProbe = lease;
  const release = () => { if (ownedProbe === lease) ownedProbe = undefined; };
  let child: ChildProcessWithoutNullStreams;
  try { child = spawn(process.execPath, [input.entry], { cwd: path.dirname(input.entry), env: environment(input.port),
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: false }); }
  catch { release(); return failure('无法启动可信 MCP 探测进程；未执行任何 CAD 操作。'); }
  let fatal: ProbeError | undefined;
  let pending: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void } | undefined;
  let buffer = Buffer.alloc(0), stdoutBytes = 0, stderrBytes = 0, nextId = 0, closed = false, closing = false;
  let closeCode: number | null = null;
  const fail = (reason: string) => {
    fatal ??= new ProbeError(reason);
    const current = pending; pending = undefined; current?.reject(fatal);
  };
  let resolveClose!: () => void;
  const didClose = new Promise<void>(resolve => { resolveClose = resolve; });
  child.once('close', code => {
    closed = true; closeCode = code; release(); resolveClose();
    if (!closing) fail('MCP 探测进程提前结束；未获得完整连接证明。');
  });
  child.on('error', () => fail('MCP 探测进程或管道失败；未执行任何 CAD 操作。'));
  child.stdin.on('error', () => fail('MCP 探测输入管道失败；未执行任何 CAD 操作。'));
  child.stdout.on('error', () => fail('MCP 探测输出管道失败；未获得连接证明。'));
  child.stderr.on('error', () => fail('MCP 探测诊断管道失败；未获得连接证明。'));
  child.stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_STDERR) fail('MCP 诊断输出超过预算；连接检查已停止。');
    // Diagnostics may contain private provider data and are never retained.
  });
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT) { fail('MCP 累计响应超过预算；连接检查已停止。'); return; }
    if (fatal) return;
    buffer = Buffer.concat([buffer, chunk]);
    try {
      while (buffer.includes(10)) {
        const end = buffer.indexOf(10);
        if (end > MAX_LINE) throw new Error();
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        const message: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        // No server requests, notifications, duplicate or unsolicited responses.
        if (!record(message) || Object.keys(message).some(key => !['jsonrpc', 'id', 'result', 'error'].includes(key))
          || message.jsonrpc !== '2.0' || !pending || message.id !== pending.id
          || !Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error') || !record(message.result)) throw new Error();
        const current = pending; pending = undefined; current.resolve(message.result);
      }
      if (buffer.length > MAX_LINE) throw new Error();
    } catch { fail('MCP 消息、请求编号或响应格式无效；连接检查已停止。'); }
  });
  const abort = () => fail('MCP 连接检查已取消；不会重试或操作 FreeCAD。');
  input.signal?.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => fail('MCP 连接检查超时；不会自动重试或关闭 FreeCAD。'), input.timeout_ms ?? 10000);
  const write = (message: unknown) => {
    if (fatal) throw fatal;
    if (closed) throw new ProbeError('MCP 探测进程已结束。');
    child.stdin.write(JSON.stringify(message) + '\n', error => { if (error) fail('MCP 探测输入管道失败。'); });
  };
  const request = (method: string, params: RecordValue) => new Promise<unknown>((resolve, reject) => {
    if (fatal) { reject(fatal); return; }
    const id = ++nextId; pending = { id, resolve, reject };
    try { write({ jsonrpc: '2.0', id, method, params }); }
    catch (error) { pending = undefined; reject(error); }
  });
  let answer: FreecadMcpConnection;
  try {
    if (input.signal?.aborted) abort();
    const initialize = await request('initialize', { protocolVersion: PROTOCOL, capabilities: {},
      clientInfo: { name: 'phoenix-desk-freecad-probe', version: '1.0.0' } });
    if (!record(initialize) || initialize.protocolVersion !== PROTOCOL || !record(initialize.capabilities)
      || !record(initialize.capabilities.tools) || !record(initialize.serverInfo)
      || initialize.serverInfo.name !== 'phoenix-freecad-mcp' || initialize.serverInfo.version !== VERSION) invalid();
    write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const discovered = toolList(await request('tools/list', {}));
    const capabilities = toolResult(await request('tools/call', { name: 'get_capabilities', arguments: {} }));
    if (capabilities.source_kind !== 'server_manifest' || capabilities.version !== VERSION || capabilities.bridge_protocol !== 1
      || capabilities.tool_scope !== 'full' || capabilities.connection_checked !== false || capabilities.runtime_supported_checked !== false
      || stable([...names(capabilities.tools, 64)].sort()) !== stable([...discovered].sort())) invalid();
    const connection = toolResult(await request('tools/call', { name: 'get_connection_status', arguments: {} }));
    if (connection.source_kind !== 'live_freecad_gui' || typeof connection.observed_at !== 'string'
      || !Number.isFinite(Date.parse(connection.observed_at)) || !record(connection.data)) invalid();
    const status = connection.data;
    if (status.protocol_version !== 1 || status.addon_name !== 'PhoenixFreeCADTools' || status.addon_version !== VERSION
      || status.running !== true || status.stopping !== false || status.host !== '127.0.0.1' || status.port !== input.port) invalid();
    const methods = names(status.supported_methods, 128);
    if (!methods.includes('get_status') || !methods.includes('list_documents')) invalid();
    if (buffer.length || fatal) throw fatal ?? new ProbeError('MCP 输出含未完成消息；未获得连接证明。');
    answer = { state: 'ready', phase: 'mcp', reason: '已通过 MCP 握手、工具清单及运行插件能力检查；未执行 CAD 操作。',
      bridge_version: VERSION, supported_methods: methods, mcp_verified: true };
  } catch (error) { answer = failure(error instanceof ProbeError ? error.message : 'MCP 合同检查失败；未执行任何 CAD 操作。'); }
  finally {
    closing = true;
    clearTimeout(deadline); input.signal?.removeEventListener('abort', abort);
    const wait = async (ms: number) => {
      if (closed) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([didClose, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]);
      if (timer) clearTimeout(timer);
    };
    try { child.stdin.end(); } catch { /* Only this owned probe child is reaped. */ }
    await wait(100);
    if (!closed) { try { child.kill('SIGTERM'); } catch { /* escalation below */ } await wait(300); }
    if (!closed) { try { child.kill('SIGKILL'); } catch { /* still require actual close */ } await wait(500); }
    if (!closed) {
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        try { stream.destroy(); } catch { /* A pipe failure is not child-close proof. */ }
      }
      await wait(100);
    }
    // Escalation is bounded; ownership is not. The caller's frozen-resource
    // callback must remain pending until this exact child actually closes.
    await didClose;
  }
  if (fatal) return failure(fatal.message);
  if (buffer.length && answer.state === 'ready') return failure('MCP 输出含未完成消息；未获得连接证明。');
  if (closeCode !== 0 && answer.state === 'ready') return failure('MCP 探测进程非正常结束；连接证明未保留。');
  return answer;
}
