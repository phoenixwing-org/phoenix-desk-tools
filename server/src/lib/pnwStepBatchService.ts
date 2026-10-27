import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireDrawingExecution } from "../features/drawing-research/executionGate.js";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import { runtimeScriptCandidates, runtimeUserDataDir } from "./appRuntimePaths.js";
import {
  buildFreecadChildEnvironment,
  redactSensitiveText,
  resolveFreecadCommand,
  truncateExternalProcessText,
} from "./freecadProcessSecurity.js";

export { resolveFreecadCommand } from "./freecadProcessSecurity.js";

export type StepBatchPrefs = {
  step_dir: string;
  out_dir: string;
  skip_existing: boolean;
  view_fit: "none" | "last" | "all";
  use_inbox_bridge: boolean;
  step_recursive: boolean;
};

export type StepBatchPreview = {
  step_dir_display: string;
  top_level: number;
  deep_total: number;
  batch_count: number;
  recursive: boolean;
  prefs: StepBatchPrefs;
  _native?: "node";
};

export type StepBatchRunResult = {
  exit_code: number;
  log: string;
  ok_count: number | null;
  skip_count: number | null;
  fail_count: number | null;
  total_count: number | null;
  out_dir_display: string;
  report_display: string;
  prefs: StepBatchPrefs;
  _native?: "node";
  engine?: "freecadcmd";
};

export type StepBatchRunContext = {
  freecadCmd?: string;
  runnerPath?: string;
  launcherPrefsPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Host-only cancellation; never populated from HTTP action parameters. */
  signal?: AbortSignal;
};

type StepBatchJob = {
  stepDir: string;
  outDir: string;
  skipExisting: boolean;
  viewFit: "none" | "last" | "all";
  recursive: boolean;
  reportFilename: string;
};

type BatchSummary = {
  ok: number;
  skip: number;
  fail: number;
  total: number;
};

type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const REPORT_FILENAME = "batch_step_convert_report.md";
const FREECAD_STREAM_MAX_BYTES = 1024 * 1024;
const FREECAD_LOG_MAX_CHARACTERS = 256 * 1024;
const FREECAD_TIMEOUT_MS = 120_000;
// Fixed launch guard only: the existing runner still owns all conversion logic.
// No FreeCAD import/document/preference action is allowed before the owner ack.
const STEP_LAUNCH_GUARD = String.raw`
import json, os, runpy, stat, sys, time
try:
    with open(JOB_PATH, 'rb') as stream:
        raw = stream.read(16385)
    if len(raw) > 16384:
        raise ValueError()
    spec = json.loads(raw.decode('utf-8'))
    if set(spec) != {'runner', 'owner', 'nonce'}:
        raise ValueError()
    deadline = time.monotonic() + 10
    while not os.path.lexists(spec['owner']):
        if time.monotonic() >= deadline:
            raise ValueError()
        time.sleep(0.02)
    before = os.lstat(spec['owner'])
    if not stat.S_ISREG(before.st_mode) or before.st_size > 4096:
        raise ValueError()
    fd = os.open(spec['owner'], os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        opened = os.fstat(fd)
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError()
        marker = json.loads(os.read(fd, 4097).decode('utf-8'))
    finally:
        os.close(fd)
    if marker != {'pid': os.getpid(), 'nonce': spec['nonce']}:
        raise ValueError()
    import FreeCAD as App
    if getattr(App, 'GuiUp', False) or App.listDocuments():
        raise ValueError()
    for key, variable in [('UserHomePath', 'FREECAD_USER_HOME'), ('UserAppData', 'FREECAD_USER_DATA'), ('UserCachePath', 'FREECAD_USER_TEMP'), ('AppTempPath', 'FREECAD_USER_TEMP')]:
        if os.path.realpath(App.ConfigGet(key)) != os.path.realpath(os.environ[variable]):
            raise ValueError()
except BaseException:
    sys.stderr.write('[phoenix] STEP owned launch guard rejected\n')
    raise SystemExit(2)
try:
    runpy.run_path(spec['runner'], run_name='__main__')
except BaseException:
    sys.stderr.write('[phoenix] STEP owned runner did not complete\n')
    raise SystemExit(2)
result = json.dumps({'version': 1, 'status': 'completed', 'pid': os.getpid(), 'nonce': spec['nonce']}).encode('utf-8')
fd = os.open(os.path.join(os.path.dirname(JOB_PATH), 'launch-result.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
try:
    offset = 0
    while offset < len(result):
        count = os.write(fd, result[offset:])
        if count < 1:
            raise ValueError()
        offset += count
    os.fsync(fd)
finally:
    os.close(fd)
`;
const DEFAULT_PREFS: StepBatchPrefs = {
  step_dir: ".",
  out_dir: ".",
  skip_existing: true,
  view_fit: "none",
  use_inbox_bridge: false,
  step_recursive: false,
};

function resolvedRoot(workspaceRoot: string): string {
  const raw = String(workspaceRoot || "").trim();
  if (!raw) throw new Error("workspace is required");
  const root = path.resolve(raw);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`workspace directory does not exist: ${root}`);
  }
  return root;
}

function readJson(file: string): Record<string, any> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeViewFit(value: unknown): "none" | "last" | "all" {
  return value === "last" || value === "all" ? value : "none";
}

function resolveConfiguredPath(root: string, value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw === ".") return root;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
}

function displayPath(root: string, absolutePath: string): string {
  const rel = path.relative(root, path.resolve(absolutePath));
  if (!rel || rel === ".") return ".";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return `./${rel.replace(/\\/g, "/")}`;
  return path.normalize(absolutePath);
}

function storeConfiguredPath(root: string, value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === ".") return null;
  const absolutePath = resolveConfiguredPath(root, raw);
  const rel = path.relative(root, absolutePath);
  if (!rel || rel === ".") return null;
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.replace(/\\/g, "/");
  return path.normalize(absolutePath);
}

function prefsFromRaw(root: string, raw: any): StepBatchPrefs {
  return {
    step_dir: displayPath(root, resolveConfiguredPath(root, raw?.step_dir)),
    out_dir: displayPath(root, resolveConfiguredPath(root, raw?.out_dir)),
    skip_existing: raw?.skip_existing == null ? DEFAULT_PREFS.skip_existing : Boolean(raw.skip_existing),
    view_fit: normalizeViewFit(raw?.view_fit),
    use_inbox_bridge: Boolean(raw?.use_inbox_bridge),
    step_recursive: Boolean(raw?.step_recursive),
  };
}

export function getStepBatchPrefs(workspaceRoot: string): StepBatchPrefs {
  const root = resolvedRoot(workspaceRoot);
  const raw = loadWorkspaceSection(root, "step_batch", {});
  return prefsFromRaw(root, raw);
}

export function saveStepBatchPrefs(workspaceRoot: string, patch: any = {}): StepBatchPrefs {
  const root = resolvedRoot(workspaceRoot);
  const current = loadWorkspaceSection(root, "step_batch", {});
  const next: Record<string, any> = { ...current, project_relative: null };

  if (Object.prototype.hasOwnProperty.call(patch, "step_dir")) {
    next.step_dir = storeConfiguredPath(root, patch.step_dir);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "out_dir")) {
    next.out_dir = storeConfiguredPath(root, patch.out_dir);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "skip_existing")) {
    next.skip_existing = Boolean(patch.skip_existing);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "use_inbox_bridge")) {
    next.use_inbox_bridge = Boolean(patch.use_inbox_bridge);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "step_recursive")) {
    next.step_recursive = Boolean(patch.step_recursive);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "view_fit")) {
    next.view_fit = normalizeViewFit(patch.view_fit);
  }

  replaceWorkspaceSection(root, "step_batch", next);
  return getStepBatchPrefs(root);
}

function isStepFile(name: string): boolean {
  return /\.(?:stp|step)$/i.test(name);
}

function stepTreeStats(stepDir: string): { top: number; deep: number } {
  if (!fs.existsSync(stepDir) || !fs.statSync(stepDir).isDirectory()) {
    throw new Error(`STEP directory does not exist: ${stepDir}`);
  }
  let top = 0;
  let deep = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: stepDir, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    for (const entry of fs.readdirSync(current.dir, { withFileTypes: true })) {
      const absolutePath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        queue.push({ dir: absolutePath, depth: current.depth + 1 });
      } else if (entry.isFile() && isStepFile(entry.name)) {
        deep += 1;
        if (current.depth === 0) top += 1;
      }
    }
  }
  return { top, deep };
}

export function previewStepBatch(workspaceRoot: string, opts: any = {}): StepBatchPreview {
  const root = resolvedRoot(workspaceRoot);
  if (opts && Object.keys(opts).length) saveStepBatchPrefs(root, opts);
  const prefs = getStepBatchPrefs(root);
  const stepDir = resolveConfiguredPath(root, prefs.step_dir);
  const stats = stepTreeStats(stepDir);
  return {
    step_dir_display: displayPath(root, stepDir),
    top_level: stats.top,
    deep_total: stats.deep,
    batch_count: prefs.step_recursive ? stats.deep : stats.top,
    recursive: prefs.step_recursive,
    prefs,
    _native: "node",
  };
}

function launcherPrefsPath(ctx: StepBatchRunContext): string {
  return ctx.launcherPrefsPath || path.join(runtimeUserDataDir(), "launcher-prefs.json");
}

function executableFile(candidate: string): string | null {
  try {
    return fs.statSync(candidate).isFile() ? path.resolve(candidate) : null;
  } catch {
    return null;
  }
}

function resolveRunnerPath(override?: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = String(override || "").trim();
  const candidates = explicit
    ? [explicit]
    : [
        ...runtimeScriptCandidates("freecad_batch_step_runner.py", env),
        path.resolve(process.cwd(), "scripts/freecad_batch_step_runner.py"),
        path.resolve(process.cwd(), "../scripts/freecad_batch_step_runner.py"),
      ];
  for (const candidate of candidates) {
    const found = executableFile(candidate);
    if (found) return found;
  }
  return null;
}

function buildJob(root: string, prefs: StepBatchPrefs): StepBatchJob {
  if (prefs.use_inbox_bridge) {
    throw new Error("Web STEP Batch does not support the FreeCAD inbox bridge; use FreeCADCmd mode");
  }
  const stepDir = resolveConfiguredPath(root, prefs.step_dir);
  const outDir = resolveConfiguredPath(root, prefs.out_dir);
  if (!fs.existsSync(stepDir) || !fs.statSync(stepDir).isDirectory()) {
    throw new Error(`STEP directory does not exist: ${displayPath(root, stepDir)}`);
  }
  return {
    stepDir,
    outDir,
    skipExisting: prefs.skip_existing,
    viewFit: prefs.view_fit,
    recursive: prefs.step_recursive,
    reportFilename: REPORT_FILENAME,
  };
}

function jobEnvironment(job: StepBatchJob): Record<string, string> {
  return {
    FCD_BATCH_STEP_DIR: job.stepDir,
    FCD_BATCH_OUT_DIR: job.outDir,
    FCD_BATCH_SKIP_EXISTING: job.skipExisting ? "1" : "0",
    FCD_BATCH_VIEW_FIT_LAST: job.viewFit === "last" ? "1" : "0",
    FCD_BATCH_VIEW_FIT_ALL: job.viewFit === "all" ? "1" : "0",
    FCD_BATCH_REPORT_NAME: job.reportFilename,
    FCD_BATCH_PROJECT_TAG: "",
    FCD_BATCH_STEP_RECURSIVE: job.recursive ? "1" : "0",
  };
}

class BoundedOutputTail {
  private buffer = Buffer.alloc(0);
  private omittedBytes = 0;

  append(chunk: unknown): void {
    const incoming = Buffer.from(chunk as any);
    const combined = Buffer.concat([this.buffer, incoming]);
    if (combined.length <= FREECAD_STREAM_MAX_BYTES) {
      this.buffer = combined;
      return;
    }
    const remove = combined.length - FREECAD_STREAM_MAX_BYTES;
    this.omittedBytes += remove;
    this.buffer = combined.subarray(remove);
  }

  text(): string {
    // Do not feed arbitrarily long attacker-controlled lines to the legacy
    // redaction regexes. Omit the whole line, including any possible secret.
    const output = this.buffer.toString("utf8").split(/\r\n|\r|\n/).map(line => line.length > 4096
      ? `[phoenix] overlong FreeCAD output line omitted (${line.length} characters)` : line).join("\n");
    return this.omittedBytes > 0
      ? `[phoenix] earlier FreeCAD output truncated (${this.omittedBytes} bytes omitted)\n${output}`
      : output;
  }
}

function publishOwner(folder: string, pid: number, nonce: string): void {
  const temporary = path.join(folder, `.owner-${randomUUID()}.tmp`);
  const target = path.join(folder, "owner.json"), bytes = Buffer.from(JSON.stringify({ pid, nonce }));
  let fd: number | undefined, identity: fs.BigIntStats | undefined;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW | fs.constants.O_RDWR, 0o600);
    identity = fs.fstatSync(fd, { bigint: true });
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
      if (count < 1) throw new Error();
      offset += count;
    }
    fs.fsyncSync(fd);
    const read = Buffer.alloc(bytes.length + 1);
    if (fs.readSync(fd, read, 0, read.length, 0) !== bytes.length || !read.subarray(0, bytes.length).equals(bytes)) throw new Error();
    fs.linkSync(temporary, target); // Atomic, complete and no-replace publication.
    const published = fs.lstatSync(target, { bigint: true });
    if (!published.isFile() || published.isSymbolicLink() || published.dev !== identity.dev || published.ino !== identity.ino) throw new Error();
  } finally {
    if (identity) try {
      const named = fs.lstatSync(temporary, { bigint: true });
      if (named.isFile() && !named.isSymbolicLink() && named.dev === identity.dev && named.ino === identity.ino) fs.unlinkSync(temporary);
    } catch { /* Never remove a replaced marker. */ }
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* Child close still governs release. */ }
  }
}

function verifyLaunchReceipt(folder: string, pid: number | undefined, nonce: string): void {
  const filename = path.join(folder, "launch-result.json");
  const stamp = (stat: fs.BigIntStats) => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  let fd: number | undefined;
  try {
    const before = fs.lstatSync(filename, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > 4096n) throw new Error();
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    if (stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before)) throw new Error();
    const bytes = Buffer.alloc(4097); let offset = 0;
    while (offset < bytes.length) { const amount = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!amount) break; offset += amount; }
    if (BigInt(offset) !== before.size || stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before) || stamp(fs.lstatSync(filename, { bigint: true })) !== stamp(before)) throw new Error();
    const raw = bytes.subarray(0, offset); if (raw.includes(0)) throw new Error();
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!value || Object.keys(value).sort().join(",") !== "nonce,pid,status,version" || value.version !== 1 || value.status !== "completed" || value.pid !== pid || value.nonce !== nonce) throw new Error();
  } catch { throw new Error("STEP owned runner completion was not confirmed; previous reports were not accepted"); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

async function execute(command: string, runner: string, baseEnv: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<ProcessResult> {
  if (signal?.aborted) throw new Error("STEP batch cancelled before native launch");
  const lease = acquireDrawingExecution(`step-batch:${randomUUID()}`);
  let folder: string | undefined;
  try {
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-step-batch-")));
    fs.chmodSync(folder, 0o700);
    const directories = Object.fromEntries(["home", "data", "temp", "xdg-config", "xdg-cache", "xdg-data", "xdg-runtime"].map(name => {
      const directory = path.join(folder!, name); fs.mkdirSync(directory, { mode: 0o700 }); return [name, directory];
    }));
    const env = { ...baseEnv, FREECAD_USER_HOME: directories.home, FREECAD_USER_DATA: directories.data,
      FREECAD_USER_TEMP: directories.temp, XDG_CONFIG_HOME: directories["xdg-config"], XDG_CACHE_HOME: directories["xdg-cache"],
      XDG_DATA_HOME: directories["xdg-data"], XDG_RUNTIME_DIR: directories["xdg-runtime"],
      TMPDIR: directories.temp, TMP: directories.temp, TEMP: directories.temp };
    const nonce = randomUUID(), config = path.join(folder, "job.json"), script = path.join(folder, "launch.py");
    const spec = JSON.stringify({ runner, owner: path.join(folder, "owner.json"), nonce });
    if (Buffer.byteLength(spec) > 16 * 1024) throw new Error("STEP launch configuration exceeds safety limit");
    fs.writeFileSync(config, spec, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(script, `JOB_PATH = ${JSON.stringify(config)}\n${STEP_LAUNCH_GUARD}`, { flag: "wx", mode: 0o600 });
    for (const name of ["user.cfg", "system.cfg"]) fs.writeFileSync(path.join(folder, name), "<?xml version=\"1.0\"?><FCParameters><FCParamGroup Name=\"Root\"/></FCParameters>", { flag: "wx", mode: 0o600 });
    const ownedFolder = folder; let ownedPid: number | undefined;
    const result = await new Promise<ProcessResult>((resolve, reject) => {
      const child = lease.spawn(command, ["-u", path.join(ownedFolder, "user.cfg"), "-s", path.join(ownedFolder, "system.cfg"), script], {
        cwd: ownedFolder, env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = new BoundedOutputTail(), stderr = new BoundedOutputTail();
      let reason = "", closed = false, ownerPublished = false, grace: ReturnType<typeof setTimeout> | undefined;
      const stop = (why: string) => {
        if (closed || reason) return;
        reason = why;
        if (Number.isSafeInteger(child.pid) && Number(child.pid) > 0) {
          grace = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* Wait for actual close. */ } }, 1000); grace.unref();
          try { child.kill("SIGTERM"); } catch { /* Wait for actual close. */ }
        }
      };
      const aborted = () => stop("STEP batch cancelled; owned FreeCADCmd has closed");
      const timer = setTimeout(() => stop("STEP batch exceeded 2 minutes; owned FreeCADCmd has closed"), FREECAD_TIMEOUT_MS); timer.unref();
      child.stdout?.on("data", chunk => stdout.append(chunk));
      child.stderr?.on("data", chunk => stderr.append(chunk));
      child.once("spawn", () => {
        if (closed || reason || signal?.aborted) return;
        try {
          if (!Number.isSafeInteger(child.pid) || Number(child.pid) < 1) throw new Error();
          lease.assertHealthy(); ownedPid = child.pid; publishOwner(ownedFolder, ownedPid!, nonce); ownerPublished = true;
        } catch { stop("STEP native ownership was not confirmed; conversion was not authorized"); }
      });
      child.once("error", () => stop("Failed to start or continue owned FreeCADCmd"));
      child.once("close", code => {
        closed = true; clearTimeout(timer); if (grace) clearTimeout(grace); signal?.removeEventListener("abort", aborted);
        if (reason) reject(new Error(reason));
        else if (!ownerPublished) reject(new Error("STEP native ownership was not confirmed"));
        else resolve({ exitCode: typeof code === "number" ? code : 1, stdout: redactSensitiveText(stdout.text()), stderr: redactSensitiveText(stderr.text()) });
      });
      signal?.addEventListener("abort", aborted, { once: true }); if (signal?.aborted) aborted();
    });
    lease.assertHealthy();
    verifyLaunchReceipt(ownedFolder, ownedPid, nonce);
    return result;
  } finally {
    try { if (folder) fs.rmSync(folder, { recursive: true, force: true }); }
    finally { lease(); }
  }
}

function parseSummary(text: string): BatchSummary | null {
  const match = String(text || "").match(/\[phoenix\]\s*OK=(\d+)\s+skip=(\d+)\s+fail=(\d+)\s+total=(\d+)/i);
  if (!match) return null;
  return {
    ok: Number(match[1]),
    skip: Number(match[2]),
    fail: Number(match[3]),
    total: Number(match[4]),
  };
}

function parseReportSummary(reportPath: string): BatchSummary | null {
  try {
    const text = fs.readFileSync(reportPath, "utf8");
    const match = text.match(/统计[：:]\s*成功\s*(\d+)[，,]\s*跳过\s*(\d+)[，,]\s*失败\s*(\d+)[，,]\s*(?:合计|共)\s*(\d+)/);
    if (!match) return null;
    return {
      ok: Number(match[1]),
      skip: Number(match[2]),
      fail: Number(match[3]),
      total: Number(match[4]),
    };
  } catch {
    return null;
  }
}

function formatRunLog(
  root: string,
  job: StepBatchJob,
  result: ProcessResult,
  summary: BatchSummary | null,
  reportWritten: boolean,
): string {
  const lines: string[] = [];
  if (summary) {
    lines.push(`转换完成：成功 ${summary.ok}，跳过 ${summary.skip}，失败 ${summary.fail}，共 ${summary.total} 个 STEP。`);
  } else if (result.exitCode === 0) {
    lines.push("FreeCADCmd 已结束（退出码 0）。");
  } else {
    lines.push(`FreeCADCmd 退出码 ${result.exitCode}。`);
  }
  lines.push(`输出目录：${displayPath(root, job.outDir)}`);
  if (reportWritten) lines.push(`报告文件：${displayPath(root, path.join(job.outDir, job.reportFilename))}`);
  const output = redactSensitiveText([result.stdout, result.stderr].filter(Boolean).join("\n")).trim();
  if (output) lines.push("", "--- 运行日志 ---", output);
  else if (!summary) lines.push("（无控制台输出）");
  return truncateExternalProcessText(lines.join("\n"), FREECAD_LOG_MAX_CHARACTERS);
}

export async function runStepBatch(
  workspaceRoot: string,
  opts: any = {},
  ctx: StepBatchRunContext = {},
): Promise<StepBatchRunResult> {
  const root = resolvedRoot(workspaceRoot);
  if (opts && Object.keys(opts).length) saveStepBatchPrefs(root, opts);
  const prefs = getStepBatchPrefs(root);
  const job = buildJob(root, prefs);
  const baseEnv = ctx.env || process.env;
  const launcher = readJson(launcherPrefsPath(ctx));
  const freecadCmd = resolveFreecadCommand(
    launcher.freecad_dir,
    ctx.freecadCmd || baseEnv.PHOENIX_FREECAD_CMD,
  );
  if (!freecadCmd) {
    throw new Error("FreeCADCmd was not found; configure the FreeCAD installation directory first");
  }
  const runner = resolveRunnerPath(ctx.runnerPath || baseEnv.PHOENIX_STEP_BATCH_RUNNER, baseEnv);
  if (!runner) throw new Error("freecad_batch_step_runner.py was not found");

  const env = buildFreecadChildEnvironment(baseEnv, jobEnvironment(job));
  const processResult = await execute(freecadCmd, runner, env, ctx.signal);
  const processOutput = [processResult.stdout, processResult.stderr].filter(Boolean).join("\n");
  const reportPath = path.join(job.outDir, job.reportFilename);
  const reportWritten = fs.existsSync(reportPath) && fs.statSync(reportPath).isFile();
  const summary = parseSummary(processOutput) || parseReportSummary(reportPath);
  return {
    exit_code: processResult.exitCode,
    log: formatRunLog(root, job, processResult, summary, reportWritten),
    ok_count: summary?.ok ?? null,
    skip_count: summary?.skip ?? null,
    fail_count: summary?.fail ?? null,
    total_count: summary?.total ?? null,
    out_dir_display: displayPath(root, job.outDir),
    report_display: reportWritten ? displayPath(root, reportPath) : "",
    prefs,
    _native: "node",
    engine: "freecadcmd",
  };
}
