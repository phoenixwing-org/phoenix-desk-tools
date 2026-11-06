import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeMcpStdio } from './stdio.js';
import { loadPinnedResource, withFrozenResource } from './resource.js';

vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const folders: string[] = [];
const PORT = 19326;
// Independently constructed protocol peer: no FreeCAD, bridge, HTTP or CAD files.
function fixture(mode = 'normal') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-peer-'))); folders.push(root);
  const entry = path.join(root, 'peer.mjs'), trace = path.join(root, 'trace.json');
  const source = `import fs from 'node:fs';
import readline from 'node:readline';
const mode=${JSON.stringify(mode)}, trace=${JSON.stringify(trace)};
const messages=[];
const tools=['get_capabilities','get_connection_status'].map(name=>({name,inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}));
const finish=()=>{fs.writeFileSync(trace,JSON.stringify({messages,env:process.env,argv:process.argv.slice(2)}));process.exit(0);};
const end=()=>{if(mode.startsWith('late_'))setTimeout(finish,30);else finish();};
process.stdin.on('end',end);process.on('SIGTERM',end);
if(mode==='timeout')setInterval(()=>{},1000);
const result=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
const tool=(data)=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);messages.push(m);
 if(m.method==='notifications/initialized')return;
 if(mode==='timeout')return;
 if(mode==='non_json'){process.stdout.write('untrusted provider output\\n');return;}
 if(mode==='invalid_utf8'){process.stdout.write(Buffer.from([0xff,10]));return;}
 if(mode==='over_line'){process.stdout.write('x'.repeat(131073));return;}
 if(mode==='over_total'){process.stdout.write('x'.repeat(262145));return;}
 if(mode==='over_stderr'){process.stderr.write('untrusted diagnostic'.repeat(1000));return;}
 if(mode==='server_request'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:100,method:'sampling/createMessage',params:{}})+'\\n');return;}
 if(mode==='rpc_error'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'SECRET provider data'}})+'\\n');return;}
 if(m.method==='initialize'){
  const info={protocolVersion:mode==='wrong_protocol'?'2099-01-01':'2025-11-25',capabilities:{tools:{}},serverInfo:{name:mode==='wrong_server'?'different-peer':'phoenix-freecad-mcp',version:mode==='wrong_server_version'?'0.4.0':'0.3.2'}};
  result(mode==='wrong_id'?999:m.id,info);if(mode==='duplicate_response')result(m.id,info);return;
 }
 if(m.method==='tools/list'){
  if(mode==='missing_tool')tools.pop();
  if(mode==='required_argument')tools[0].inputSchema.required=['document'];
  if(mode==='nonempty_schema')tools[0].inputSchema.properties={document:{type:'string'}};
  if(mode==='writable_tool')tools[0].annotations.readOnlyHint=false;
  result(m.id,{tools,...(mode==='pagination'?{nextCursor:'more'}:{})});return;
 }
 if(m.method!=='tools/call'||!['get_capabilities','get_connection_status'].includes(m.params.name)||JSON.stringify(m.params.arguments)!=='{}')throw Error('unexpected operation');
 let data=m.params.name==='get_capabilities'?{ok:true,source_kind:'server_manifest',version:mode==='wrong_manifest_version'?'0.4.0':'0.3.2',bridge_protocol:1,tool_scope:'full',tools:tools.map(t=>t.name),connection_checked:false,runtime_supported_checked:false}
 :{ok:true,source_kind:'live_freecad_gui',observed_at:'2026-01-01T00:00:00.000Z',data:{protocol_version:mode==='wrong_bridge_protocol'?2:1,addon_name:mode==='wrong_addon'?'DifferentAddon':'PhoenixFreeCADTools',addon_version:mode==='wrong_addon_version'?'0.4.0':'0.3.2',running:mode!=='stopped',stopping:false,host:'127.0.0.1',port:mode==='wrong_port'?1:${PORT},supported_methods:mode==='invalid_methods'?['get_status','get_status']:['get_status','list_documents','capture_view']}};
 let value=tool(data);
 if(mode==='tool_error')value.isError=true;
 if(mode==='text_mismatch')value.content[0].text='{}';
 if(mode==='missing_structured')delete value.structuredContent;
 if(mode==='image_content')value.content=[{type:'image',data:'not requested',mimeType:'image/png'}];
 result(m.id,value);
 if(m.params.name==='get_connection_status'&&mode==='late_duplicate')setTimeout(()=>result(m.id,value),2);
 if(m.params.name==='get_connection_status'&&mode==='late_partial')setTimeout(()=>process.stdout.write('{'),2);
});
`;
  fs.writeFileSync(entry, source, { mode: 0o600 });
  return { root, entry, trace, entry_sha256: createHash('sha256').update(source).digest('hex'), port: PORT };
}
function resourceFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-resource-'))); folders.push(root);
  // Complete, independent neutral material; no installed addon or private CAD.
  const contents: Record<string, string> = {
    'addon/InitGui.py': '# Independent inert test addon\n',
    'addon/package.xml': '<package><version>0.3.2</version></package>',
    'addon/LICENSE': 'Independent test license material',
    'addon/NOTICE': 'Independent test attribution',
    'addon/README.md': 'Independent test resource notes',
    'scripts/install-addon.mjs': 'export const inertInstallerFixture = true;\n',
    'dist/peer.mjs': "import { marker } from './dependency.mjs'; export const fixture = marker;\n",
    'dist/dependency.mjs': "export const marker = 'independent-lease-fixture';\n",
  };
  const files: Record<string, string> = {};
  for (const [relative, bytes] of Object.entries(contents)) {
    const filename = path.join(root, relative); fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes); files[relative] = createHash('sha256').update(bytes).digest('hex');
  }
  const manifest = JSON.stringify({ schema_version: 1, plugin_version: '0.3.2', addon_dir: 'addon',
    installer_entry: 'scripts/install-addon.mjs', mcp_entry: 'dist/peer.mjs', files });
  const manifestPath = path.join(root, 'release.json'); fs.writeFileSync(manifestPath, manifest);
  const loaded = loadPinnedResource({ PHOENIX_FREECAD_MCP_RESOURCE_MANIFEST: manifestPath,
    PHOENIX_FREECAD_MCP_RESOURCE_SHA256: createHash('sha256').update(manifest).digest('hex') });
  expect(loaded.state).toBe('ready');
  if (loaded.state !== 'ready') throw new Error('Independent resource fixture must validate');
  return loaded.resource;
}
beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  vi.mocked(spawn).mockReset().mockImplementation(actual.spawn);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  for (const root of folders.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('bounded formal MCP stdio observation', () => {
  it('performs the handshake and only the two explicitly allowed read tools', async () => {
    const f = fixture();
    vi.stubEnv('NODE_OPTIONS', '--require /never-inherit-test-hook');
    vi.stubEnv('NODE_PATH', '/never-inherit-test-modules');
    vi.stubEnv('PHOENIX_DESK_NODE', '/never-inherit-reverse-desk-node');
    vi.stubEnv('PHOENIX_DESK_CLI', '/never-inherit-reverse-desk-cli');
    vi.stubEnv('PHOENIX_DESK_STATE_DIR', '/never-inherit-private-state');
    vi.stubEnv('PHOENIX_DESK_CHAT_READS', '1');
    vi.stubEnv('EXAMPLE_CREDENTIAL', 'synthetic-secret');
    const answer = await probeMcpStdio(f);
    expect(answer).toMatchObject({ state: 'ready', phase: 'mcp', mcp_verified: true, bridge_version: '0.3.2',
      supported_methods: ['get_status', 'list_documents', 'capture_view'] });
    const trace = JSON.parse(fs.readFileSync(f.trace, 'utf8'));
    expect(trace.messages.map((m: { method: string }) => m.method)).toEqual([
      'initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'tools/call',
    ]);
    expect(trace.messages[0]).toMatchObject({ jsonrpc: '2.0', id: 1, params: { protocolVersion: '2025-11-25', capabilities: {} } });
    expect(trace.messages.filter((m: { id?: number }) => m.id).map((m: { id: number }) => m.id)).toEqual([1, 2, 3, 4]);
    expect(trace.messages.slice(3).map((m: { params: unknown }) => m.params)).toEqual([
      { name: 'get_capabilities', arguments: {} }, { name: 'get_connection_status', arguments: {} },
    ]);
    expect(trace.env).toMatchObject({ PHOENIX_FREECAD_URL: `http://127.0.0.1:${PORT}/`, PHOENIX_FREECAD_TOOL_SCOPE: 'full' });
    for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'PHOENIX_DESK_NODE', 'PHOENIX_DESK_CLI', 'PHOENIX_DESK_STATE_DIR', 'PHOENIX_DESK_CHAT_READS', 'EXAMPLE_CREDENTIAL']) expect(trace.env).not.toHaveProperty(name);
    expect(trace.argv).toEqual([]);
    expect(vi.mocked(spawn).mock.calls).toHaveLength(1);
    expect(vi.mocked(spawn).mock.calls[0]).toEqual([process.execPath, [f.entry], expect.objectContaining({
      cwd: f.root, shell: false, detached: false, stdio: ['pipe', 'pipe', 'pipe'],
    })]);
  });

  it.each(['non_json', 'invalid_utf8', 'over_line', 'over_total', 'over_stderr', 'server_request', 'rpc_error', 'wrong_protocol',
    'wrong_server', 'wrong_server_version', 'wrong_id', 'duplicate_response', 'missing_tool', 'required_argument', 'nonempty_schema',
    'writable_tool', 'pagination', 'wrong_manifest_version', 'wrong_bridge_protocol', 'wrong_addon', 'wrong_addon_version',
    'stopped', 'wrong_port', 'invalid_methods', 'tool_error', 'text_mismatch', 'missing_structured', 'image_content', 'late_duplicate', 'late_partial'])('rejects %s without retries or provider text leakage', async mode => {
    const answer = await probeMcpStdio({ ...fixture(mode), timeout_ms: 1500 });
    expect(answer).toMatchObject({ state: 'failed', phase: 'mcp', mcp_verified: false, bridge_version: null, supported_methods: [] });
    expect(JSON.stringify(answer)).not.toMatch(/SECRET|untrusted|synthetic-secret/);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('does not spawn when the trusted entry digest changed', async () => {
    const f = fixture(); fs.appendFileSync(f.entry, '\n// changed after freeze\n');
    expect(await probeMcpStdio(f)).toMatchObject({ state: 'blocked', mcp_verified: false });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('does not spawn for a symbolic entry', async () => {
    const f = fixture(), link = path.join(f.root, 'linked.mjs'); fs.symlinkSync(f.entry, link);
    expect(await probeMcpStdio({ ...f, entry: link })).toMatchObject({ state: 'blocked', mcp_verified: false });
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each([0, 1023, 65536, 19326.5])('rejects invalid port %s', async port => {
    expect(await probeMcpStdio({ ...fixture(), port })).toMatchObject({ state: 'blocked', mcp_verified: false });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('does not spawn an already cancelled observation', async () => {
    const controller = new AbortController(); controller.abort();
    expect(await probeMcpStdio({ ...fixture(), signal: controller.signal })).toMatchObject({ state: 'failed', mcp_verified: false });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('times out and reaps only its owned Node child, without a retry', async () => {
    const kill = vi.spyOn(process, 'kill');
    const answer = await probeMcpStdio({ ...fixture('timeout'), timeout_ms: 100 });
    expect(answer).toMatchObject({ state: 'failed', mcp_verified: false }); expect(answer.reason).toContain('超时');
    expect(spawn).toHaveBeenCalledTimes(1); expect(kill).not.toHaveBeenCalled();
  });
  it('cancels during handshake and never sends a tool call', async () => {
    const f = fixture('timeout'), controller = new AbortController();
    const running = probeMcpStdio({ ...f, signal: controller.signal });
    controller.abort();
    const answer = await running;
    expect(answer).toMatchObject({ state: 'failed', mcp_verified: false }); expect(answer.reason).toContain('取消');
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it('waits for the child close event after TERM/KILL, not a successful kill return', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 111111, kill: vi.fn(() => true) });
    vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
    let finished = false;
    const running = probeMcpStdio({ ...fixture(), timeout_ms: 100 }).then(answer => { finished = true; return answer; });
    await vi.advanceTimersByTimeAsync(501);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]); expect(finished).toBe(false);
    child.emit('close', null, 'SIGKILL');
    expect(await running).toMatchObject({ state: 'failed', mcp_verified: false });
  });
  it('blocks concurrent probes and releases the lease only on the owned child close', async () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 111111, kill: vi.fn(() => true) });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcessWithoutNullStreams);
    const running = probeMcpStdio(fixture());
    try {
      expect(await probeMcpStdio(fixture())).toMatchObject({ state: 'blocked', mcp_verified: false });
      expect(spawn).toHaveBeenCalledTimes(1); expect(child.kill).not.toHaveBeenCalled();
    } finally { child.emit('close', 0); }
    expect(await running).toMatchObject({ state: 'failed', mcp_verified: false });
    expect(await probeMcpStdio(fixture())).toMatchObject({ state: 'ready', mcp_verified: true });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('retains its launch barrier and callback lease beyond cleanup deadlines until a later actual close', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 111111, kill: vi.fn(() => true) });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcessWithoutNullStreams);
    let settled = false, callbackLeased = false;
    const running = (async () => {
      callbackLeased = true;
      try { return await probeMcpStdio({ ...fixture(), timeout_ms: 100 }); }
      finally { callbackLeased = false; }
    })().finally(() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(10000);
      expect(settled).toBe(false); expect(callbackLeased).toBe(true);
      expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
      child.emit('error', new Error('Synthetic child error without close'));
      child.emit('exit', null, 'SIGKILL');
      await vi.advanceTimersByTimeAsync(10000);
      expect(settled).toBe(false); expect(callbackLeased).toBe(true);
      expect(await probeMcpStdio(fixture())).toMatchObject({ state: 'blocked', mcp_verified: false });
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally { child.emit('close', null, 'SIGKILL'); }
    const answer = await running;
    expect(answer).toMatchObject({ state: 'failed', mcp_verified: false }); expect(answer.reason).toContain('超时');
    expect(settled).toBe(true); expect(callbackLeased).toBe(false); vi.useRealTimers();
    expect(await probeMcpStdio(fixture())).toMatchObject({ state: 'ready', mcp_verified: true });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('keeps the actual frozen resource and imports leased until its TERM/KILL-ignoring child closes', async () => {
    vi.useFakeTimers();
    const resource = resourceFixture();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 111111, kill: vi.fn(() => true) });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcessWithoutNullStreams);
    let frozenRoot = '', frozenEntry = '', callbackSettled = false, resourceSettled = false;
    const running = withFrozenResource(resource, async frozen => {
      frozenRoot = frozen.root; frozenEntry = frozen.mcpEntry!;
      try { return await probeMcpStdio({ entry: frozenEntry, entry_sha256: resource.files[resource.mcpEntry!], port: PORT, timeout_ms: 100 }); }
      finally { callbackSettled = true; }
    }).finally(() => { resourceSettled = true; });
    try {
      await vi.advanceTimersByTimeAsync(10000);
      expect(callbackSettled).toBe(false); expect(resourceSettled).toBe(false);
      expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
      expect(fs.existsSync(frozenEntry)).toBe(true);
      expect(fs.readFileSync(path.join(frozenRoot, 'dist/dependency.mjs'), 'utf8')).toContain('independent-lease-fixture');
      expect(vi.mocked(spawn).mock.calls[0]).toEqual([process.execPath, [frozenEntry], expect.objectContaining({ cwd: path.dirname(frozenEntry) })]);
      child.emit('error', new Error('Synthetic child error without close')); child.emit('exit', 0);
      await vi.advanceTimersByTimeAsync(10000);
      expect(callbackSettled).toBe(false); expect(resourceSettled).toBe(false); expect(fs.existsSync(frozenEntry)).toBe(true);
      expect(await probeMcpStdio({ entry: frozenEntry, entry_sha256: resource.files[resource.mcpEntry!], port: PORT })).toMatchObject({ state: 'blocked', mcp_verified: false });
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally { child.emit('close', null, 'SIGKILL'); }
    expect(await running).toMatchObject({ state: 'failed', mcp_verified: false });
    expect(callbackSettled).toBe(true); expect(resourceSettled).toBe(true);
    expect(fs.existsSync(frozenRoot)).toBe(false);
    const next = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 222222, kill: vi.fn(() => true) });
    vi.mocked(spawn).mockReturnValueOnce(next as unknown as ChildProcessWithoutNullStreams);
    const nextProbe = probeMcpStdio(fixture()); next.emit('close', 0);
    expect(await nextProbe).toMatchObject({ state: 'failed', mcp_verified: false }); expect(spawn).toHaveBeenCalledTimes(2);
  });
  it('sanitizes spawn errors and never invokes another program', async () => {
    vi.mocked(spawn).mockImplementation(() => { throw new Error('SECRET executable diagnostics'); });
    const answer = await probeMcpStdio(fixture());
    expect(answer.state).toBe('failed'); expect(answer.reason).not.toContain('SECRET'); expect(spawn).toHaveBeenCalledTimes(1);
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(spawn).mockImplementation(actual.spawn);
    expect(await probeMcpStdio(fixture())).toMatchObject({ state: 'ready', mcp_verified: true });
  });
});
