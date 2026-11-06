import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireDrawingExecution, configureDrawingExecutionBarrier } from '../drawing-research/executionGate.js';
import { deskToolsRegistrationDirectory } from '../../lib/deskToolsRegistration.js';
import { buildFreecadChildEnvironment, resolveFreecadCommand } from '../../lib/freecadProcessSecurity.js';

/** Internal, host-authored programs only; never expose `script` as an action/API field. */
export interface OwnedAssemblyNativeOptions {
  freecadHome: string;
  stage: string;
  script: string;
  spec: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface OwnedAssemblyNativeProof {
  version: 1;
  nonce: string;
  pid: number | null;
  actual_close_observed: boolean;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  output_bytes: number;
  termination_requests: string[];
  private_configuration: true;
  fixed_host_barrier: true;
}
export class AssemblyNativeRunnerError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'AssemblyNativeRunnerError'; }
}
const fail = (code: string): never => { throw new AssemblyNativeRunnerError(code); };
const MAX_REPORT = 2 * 1024 * 1024;

function privateFile(filename: string, content: string) {
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function readPrivateReceipt(filename: string): Record<string, unknown> {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_REPORT)) fail('invalid_receipt');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true }), current = fs.lstatSync(filename, { bigint: true });
    const stamp = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
    if (BigInt(offset) !== before.size || current.isSymbolicLink() || stamp(before) !== stamp(after) || stamp(before) !== stamp(current)) fail('invalid_receipt');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_receipt');
    return value as Record<string, unknown>;
  } finally { fs.closeSync(fd); }
}

/** Every invocation is a distinct, owned, headless process. Artifacts stay outside the repository. */
export async function runOwnedAssemblyNative(options: OwnedAssemblyNativeOptions): Promise<{
  directory: string; receipt: Record<string, unknown>; proof: OwnedAssemblyNativeProof;
}> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(options.stage) || !options.script || options.script.length > 512 * 1024) fail('invalid_program');
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) fail('invalid_timeout');
  if (options.signal?.aborted) fail('cancelled');
  const command = resolveFreecadCommand(options.freecadHome);
  if (!command) fail('engine_unavailable');
  // Deliberately identical to server.ts. Never use a temporary scope, workspace or CLI override.
  configureDrawingExecutionBarrier(path.join(deskToolsRegistrationDirectory(), 'native-freecad-v1'));
  const lease = acquireDrawingExecution('assembly-maintenance:' + options.stage + ':' + randomUUID());
  let directory = '';
  const nonce = randomUUID();
  const proof: OwnedAssemblyNativeProof = {
    version: 1, nonce, pid: null, actual_close_observed: false, exit_code: null, signal: null,
    output_bytes: 0, termination_requests: [], private_configuration: true, fixed_host_barrier: true,
  };
  try {
    directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-assembly-' + options.stage + '-')));
    fs.chmodSync(directory, 0o700);
    const privatePaths = Object.fromEntries(['home', 'data', 'temp', 'config', 'cache', 'xdg-data'].map(name => {
      const location = path.join(directory, name); fs.mkdirSync(location, { mode: 0o700 }); return [name, location];
    }));
    const env = { ...buildFreecadChildEnvironment(process.env),
      FREECAD_USER_HOME: privatePaths.home, FREECAD_USER_DATA: privatePaths.data, FREECAD_USER_TEMP: privatePaths.temp,
      XDG_CONFIG_HOME: privatePaths.config, XDG_CACHE_HOME: privatePaths.cache, XDG_DATA_HOME: privatePaths['xdg-data'],
      TMPDIR: privatePaths.temp, TMP: privatePaths.temp, TEMP: privatePaths.temp,
    };
    privateFile(path.join(directory, 'spec.json'), JSON.stringify({ version: 1, nonce, payload: options.spec }));
    // FreeCADCmd imports the script as `program`; native Python proxy copying can
    // import the same file again as __main__. Never re-run the job on that import.
    const wrapped = 'def _desk_owned_entry():\n' + options.script.split('\n').map(line => '    ' + line).join('\n')
      + '\nif __name__ == "program":\n    try:\n        _desk_owned_entry()\n    except BaseException as error:\n        import traceback, json, os, re\n        from pathlib import Path\n        (Path.cwd() / "native-exception.log").write_text(traceback.format_exc())\n        result_path = Path.cwd() / "result.json"\n        if not result_path.exists():\n            source = json.loads((Path.cwd() / "spec.json").read_text())\n            reason = str(error).split(":", 1)[0]\n            if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", reason): reason = "native_program_failed"\n            with result_path.open("x") as output:\n                json.dump({"version":1,"nonce":source["nonce"],"pid":os.getpid(),"state":"blocked","reason":reason}, output)\n';
    privateFile(path.join(directory, 'program.py'), wrapped);
    privateFile(path.join(directory, 'user.cfg'), '<?xml version="1.0"?><FCParameters><FCParamGroup Name="Root"/></FCParameters>');
    privateFile(path.join(directory, 'system.cfg'), '<?xml version="1.0"?><FCParameters><FCParamGroup Name="Root"/></FCParameters>');
    let stopReason: string | undefined;
    await new Promise<void>((resolve, reject) => {
      let spawnError = false;
      const child = lease.spawn(command!, ['-u', path.join(directory, 'user.cfg'), '-s', path.join(directory, 'system.cfg'), path.join(directory, 'program.py')],
        { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const stop = (reason: string) => {
        stopReason ??= reason;
        if (proof.pid && !proof.actual_close_observed) {
          proof.termination_requests.push('SIGTERM');
          try { child.kill('SIGTERM'); } catch { proof.termination_requests.push('SIGTERM_failed'); }
        }
      };
      const abort = () => { stop('cancelled'); hardStop(); };
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      const hardStop = () => { hardTimer ??= setTimeout(() => {
        if (proof.pid && !proof.actual_close_observed) {
          proof.termination_requests.push('SIGKILL');
          try { child.kill('SIGKILL'); } catch { proof.termination_requests.push('SIGKILL_failed'); }
        }
      }, 3000); };
      const timerHard = setTimeout(hardStop, timeoutMs);
      options.signal?.addEventListener('abort', abort, { once: true });
      const diagnostic: Buffer[] = [];
      const count = (chunk: Buffer) => {
        proof.output_bytes += chunk.length;
        if (proof.output_bytes <= MAX_REPORT) diagnostic.push(chunk);
        if (proof.output_bytes > MAX_REPORT) { stop('output_limit'); hardStop(); }
      };
      child.stdout?.on('data', count); child.stderr?.on('data', count);
      child.once('spawn', () => {
        try {
          lease.assertHealthy();
          if (!Number.isInteger(child.pid) || !child.pid) fail('pid_missing');
          proof.pid = child.pid!;
          privateFile(path.join(directory, 'owner.json'), JSON.stringify({ version: 1, expected_pid: proof.pid, nonce }));
          if (options.signal?.aborted) { stop('cancelled'); hardStop(); }
        } catch { stop('ownership_failed'); hardStop(); }
      });
      child.once('error', () => { spawnError = true; });
      child.once('close', (code, signal) => {
        clearTimeout(timer); clearTimeout(timerHard); if (hardTimer) clearTimeout(hardTimer);
        options.signal?.removeEventListener('abort', abort);
        proof.actual_close_observed = true; proof.exit_code = code; proof.signal = signal;
        try { privateFile(path.join(directory, 'native-diagnostic.log'), Buffer.concat(diagnostic).toString('utf8')); } catch { /* private diagnostics are not authority */ }
        if (stopReason || spawnError || code !== 0 || signal) reject(new AssemblyNativeRunnerError(stopReason ?? (spawnError ? 'spawn_failed' : 'native_failed')));
        else resolve();
      });
    });
    const receipt = readPrivateReceipt(path.join(directory, 'result.json'));
    if (receipt.version !== 1 || receipt.nonce !== nonce || receipt.pid !== proof.pid || !proof.actual_close_observed) fail('receipt_binding_mismatch');
    return { directory, receipt, proof };
  } catch (error) {
    if (directory) try { privateFile(path.join(directory, 'failure-proof.json'), JSON.stringify(proof)); } catch { /* keep original failure */ }
    throw error instanceof AssemblyNativeRunnerError ? error : new AssemblyNativeRunnerError('native_unverified');
  } finally { lease(); }
}

/** Prefix for fixed host scripts: no CAD is read before the durable lease's PID/nonce is acknowledged. */
export const ASSEMBLY_NATIVE_BOOTSTRAP = String.raw`
import os, json, re, time, faulthandler
faulthandler.enable()
from pathlib import Path
root = Path.cwd()
spec = json.loads((root / 'spec.json').read_text())
assert set(spec) == {'version', 'nonce', 'payload'} and spec['version'] == 1
assert re.fullmatch(r'[a-f0-9-]{36}', spec['nonce'])
deadline = time.monotonic() + 10
while not (root / 'owner.json').exists():
    assert time.monotonic() < deadline, 'owner_timeout'
    time.sleep(0.01)
owner = json.loads((root / 'owner.json').read_text())
assert owner == {'version': 1, 'nonce': spec['nonce'], 'expected_pid': os.getpid()}, 'owner_mismatch'
import FreeCAD as App
assert not App.GuiUp, 'gui_not_allowed'
assert not App.listDocuments(), 'unexpected_preexisting_document'
for key in ('FREECAD_USER_HOME', 'FREECAD_USER_DATA', 'FREECAD_USER_TEMP'):
    location = Path(os.environ[key])
    assert location.resolve().is_relative_to(root) and location.is_dir() and not location.is_symlink(), 'private_configuration_required'
for key, name in (('UserParameter', 'user.cfg'), ('SystemParameter', 'system.cfg')):
    assert Path(App.ConfigGet(key)).resolve() == (root / name).resolve(), 'actual_configuration_mismatch'
App.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly').SetBool('SolveInJointCreation', False)
App.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly').SetBool('SolveOnRecompute', False)
assert not App.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly').GetBool('SolveInJointCreation', True)
assert not App.ParamGet('User parameter:BaseApp/Preferences/Mod/Assembly').GetBool('SolveOnRecompute', True)
def finish(payload):
    payload.update({'version': 1, 'nonce': spec['nonce'], 'pid': os.getpid()})
    with (root / 'result.json').open('x') as output:
        json.dump(payload, output, separators=(',', ':'))
        output.flush()
        os.fsync(output.fileno())
`;
