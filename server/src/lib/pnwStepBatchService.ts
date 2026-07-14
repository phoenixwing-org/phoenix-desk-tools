import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import { runtimeScriptCandidates, runtimeUserDataDir } from "./appRuntimePaths.js";

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
    skip_existing: raw?.skip_existing == null ? true : Boolean(raw.skip_existing),
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

export function resolveFreecadCommand(freecadHome: unknown, override?: unknown): string | null {
  const explicit = String(override || "").trim();
  if (explicit) return executableFile(explicit);
  const raw = String(freecadHome || "").trim();
  if (!raw) return null;
  const home = path.resolve(raw);
  const candidates = [
    home,
    path.join(home, "Contents", "Resources", "bin", "freecadcmd"),
    path.join(home, "Contents", "MacOS", "FreeCADCmd"),
    path.join(home, "Contents", "Resources", "bin", "FreeCADCmd"),
    path.join(home, "Resources", "bin", "freecadcmd"),
    path.join(home, "Resources", "bin", "FreeCADCmd"),
    path.join(home, "MacOS", "FreeCADCmd"),
    path.join(home, "bin", "freecadcmd"),
    path.join(home, "bin", "FreeCADCmd"),
    path.join(home, "FreeCADCmd"),
    path.join(home, "FreeCADCmd.exe"),
    path.join(home, "bin", "FreeCADCmd.exe"),
  ];
  for (const candidate of candidates) {
    const found = executableFile(candidate);
    if (found) return found;
  }
  return null;
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

function execute(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => reject(new Error(`Failed to start FreeCADCmd: ${error.message}`)));
    child.once("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
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
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (output) lines.push("", "--- 运行日志 ---", output);
  else if (!summary) lines.push("（无控制台输出）");
  return lines.join("\n");
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

  const env: NodeJS.ProcessEnv = { ...baseEnv, ...jobEnvironment(job) };
  const processResult = await execute(freecadCmd, [runner], root, env);
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
