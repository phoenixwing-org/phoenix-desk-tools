import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import { runtimeScriptCandidates } from "./appRuntimePaths.js";

export type SwStepPrefs = {
  source_dir: string;
  out_step_dir: string;
  recursive_scan: boolean;
  com_available: boolean;
  adapter_available: boolean;
  solidworks_registered: boolean | null;
  availability_code:
    | "ready"
    | "custom_adapter"
    | "unsupported_platform"
    | "adapter_missing"
    | "solidworks_not_registered";
  platform: string;
};

export type SwStepPreview = {
  source_display: string;
  model_count: number;
  prefs: SwStepPrefs;
  _native?: "node";
};

export type SwStepRunResult = {
  ok_count: number;
  failed_count: number;
  failed: Array<{ path: string; error: string }>;
  log: string;
  out_display: string;
  prefs: SwStepPrefs;
  _native?: "node";
  engine?: "powershell-com";
};

export type SwStepRunContext = {
  platform?: NodeJS.Platform;
  comHost?: string;
  runnerPath?: string;
  directRunner?: boolean;
  solidWorksRegistered?: boolean;
  env?: NodeJS.ProcessEnv;
};

type AdapterResult = {
  ok?: string[];
  failed?: Array<{ path?: string; error?: string }>;
  logs?: string[];
  fatal_error?: string | null;
};

type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
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

function executableFile(candidate: unknown): string | null {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  try {
    return fs.statSync(raw).isFile() ? path.resolve(raw) : null;
  } catch {
    return null;
  }
}

function findOnPath(command: string, platform: NodeJS.Platform): string | null {
  const lookup = platform === "win32" ? "where.exe" : "which";
  try {
    const result = spawnSync(lookup, [command], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) return null;
    const first = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first ? executableFile(first) : null;
  } catch {
    return null;
  }
}

export function resolveSwComHost(
  override?: unknown,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = executableFile(override || env.PHOENIX_SW_COM_HOST);
  if (explicit) return explicit;
  if (platform !== "win32") return null;
  const candidates = [
    path.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path.join(env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
  ];
  for (const candidate of candidates) {
    const found = executableFile(candidate);
    if (found) return found;
  }
  return findOnPath("powershell.exe", platform) || findOnPath("pwsh.exe", platform);
}

function resolveRunnerPath(override?: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    override,
    env.PHOENIX_SW_COM_RUNNER,
    ...runtimeScriptCandidates("sw-step-export.ps1", env),
    path.resolve(process.cwd(), "scripts/sw-step-export.ps1"),
  ];
  for (const candidate of candidates) {
    const found = executableFile(candidate);
    if (found) return found;
  }
  return null;
}

function explicitAdapterAvailable(ctx: SwStepRunContext = {}): boolean {
  const env = ctx.env || process.env;
  return Boolean(
    resolveSwComHost(ctx.comHost, ctx.platform || process.platform, env)
    && resolveRunnerPath(ctx.runnerPath, env),
  );
}

function usesCustomDirectAdapter(ctx: SwStepRunContext = {}): boolean {
  const env = ctx.env || process.env;
  return ctx.directRunner === true || env.PHOENIX_SW_COM_DIRECT === "1";
}

export function probeSolidWorksRegistration(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform !== "win32") return false;
  const reg = executableFile(path.join(env.SystemRoot || "C:\\Windows", "System32", "reg.exe"))
    || findOnPath("reg.exe", platform);
  if (!reg) return false;
  try {
    const result = spawnSync(reg, ["query", "HKCR\\SldWorks.Application\\CLSID"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function availability(ctx: SwStepRunContext = {}): Pick<
  SwStepPrefs,
  "com_available" | "adapter_available" | "solidworks_registered" | "availability_code" | "platform"
> {
  const platform = ctx.platform || process.platform;
  const env = ctx.env || process.env;
  const adapterAvailable = explicitAdapterAvailable(ctx);
  if (usesCustomDirectAdapter(ctx)) {
    return {
      com_available: adapterAvailable,
      adapter_available: adapterAvailable,
      solidworks_registered: null,
      availability_code: adapterAvailable ? "custom_adapter" : "adapter_missing",
      platform,
    };
  }
  if (platform !== "win32") {
    return {
      com_available: false,
      adapter_available: adapterAvailable,
      solidworks_registered: null,
      availability_code: "unsupported_platform",
      platform,
    };
  }
  if (!adapterAvailable) {
    return {
      com_available: false,
      adapter_available: false,
      solidworks_registered: null,
      availability_code: "adapter_missing",
      platform,
    };
  }
  const solidWorksRegistered = ctx.solidWorksRegistered
    ?? probeSolidWorksRegistration(platform, env);
  return {
    com_available: solidWorksRegistered,
    adapter_available: true,
    solidworks_registered: solidWorksRegistered,
    availability_code: solidWorksRegistered ? "ready" : "solidworks_not_registered",
    platform,
  };
}

function prefsFromRaw(root: string, raw: any, ctx: SwStepRunContext = {}): SwStepPrefs {
  return {
    source_dir: displayPath(root, resolveConfiguredPath(root, raw?.source_dir)),
    out_step_dir: displayPath(root, resolveConfiguredPath(root, raw?.out_step_dir)),
    recursive_scan: Boolean(raw?.recursive_scan),
    ...availability(ctx),
  };
}

export function getSwStepPrefs(workspaceRoot: string, ctx: SwStepRunContext = {}): SwStepPrefs {
  const root = resolvedRoot(workspaceRoot);
  const raw = loadWorkspaceSection(root, "sw_step_export", {});
  return prefsFromRaw(root, raw, ctx);
}

export function saveSwStepPrefs(
  workspaceRoot: string,
  patch: any = {},
  ctx: SwStepRunContext = {},
): SwStepPrefs {
  const root = resolvedRoot(workspaceRoot);
  const current = loadWorkspaceSection(root, "sw_step_export", {});
  const next: Record<string, any> = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "source_dir")) {
    next.source_dir = storeConfiguredPath(root, patch.source_dir);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "out_step_dir")) {
    next.out_step_dir = storeConfiguredPath(root, patch.out_step_dir);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "recursive_scan")) {
    next.recursive_scan = Boolean(patch.recursive_scan);
  }
  replaceWorkspaceSection(root, "sw_step_export", next);
  return getSwStepPrefs(root, ctx);
}

function isSwModel(name: string): boolean {
  return /\.(?:sldprt|sldasm)$/i.test(name);
}

export function listSwModelPaths(sourceDir: string, recursive: boolean): string[] {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`SolidWorks model directory does not exist: ${sourceDir}`);
  }
  const files: string[] = [];
  const queue = [sourceDir];
  while (queue.length) {
    const dir = queue.shift()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory() && recursive) queue.push(absolutePath);
      else if (entry.isFile() && isSwModel(entry.name)) files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function resolveDirs(root: string, prefs: SwStepPrefs): { sourceDir: string; outDir: string } {
  const sourceDir = resolveConfiguredPath(root, prefs.source_dir);
  const outDir = resolveConfiguredPath(root, prefs.out_step_dir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`SolidWorks model directory does not exist: ${displayPath(root, sourceDir)}`);
  }
  return { sourceDir, outDir };
}

export function previewSwStepExport(
  workspaceRoot: string,
  opts: any = {},
  ctx: SwStepRunContext = {},
): SwStepPreview {
  const root = resolvedRoot(workspaceRoot);
  if (opts && Object.keys(opts).length) saveSwStepPrefs(root, opts, ctx);
  const prefs = getSwStepPrefs(root, ctx);
  const { sourceDir } = resolveDirs(root, prefs);
  const models = listSwModelPaths(sourceDir, prefs.recursive_scan);
  return {
    source_display: displayPath(root, sourceDir),
    model_count: models.length,
    prefs,
    _native: "node",
  };
}

function parseIntegerPair(value: unknown): { saveVersion: number; silentOptions: number } {
  const parts = String(value || "").split(",").map((part) => part.trim());
  if (parts.length === 2 && parts.every((part) => /^-?\d+$/.test(part))) {
    return { saveVersion: Number(parts[0]), silentOptions: Number(parts[1]) };
  }
  return { saveVersion: 128, silentOptions: 8 };
}

function parseOpenOptions(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(parsed) ? parsed : 1;
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
    child.once("error", (error) => reject(new Error(`Failed to start SolidWorks COM adapter: ${error.message}`)));
    child.once("close", (code) => resolve({
      exitCode: typeof code === "number" ? code : 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function parseAdapterResult(stdout: string): AdapterResult {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Continue searching in case the COM host wrote a banner before the JSON line.
    }
  }
  throw new Error("SolidWorks COM adapter did not return JSON");
}

function adapterArgs(runner: string, jobFile: string, direct: boolean): string[] {
  if (direct) return [runner, jobFile];
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Sta",
    "-File",
    runner,
    "-JobPath",
    jobFile,
  ];
}

export async function runSwStepExport(
  workspaceRoot: string,
  opts: any = {},
  ctx: SwStepRunContext = {},
): Promise<SwStepRunResult> {
  const root = resolvedRoot(workspaceRoot);
  const env = ctx.env || process.env;
  if (opts && Object.keys(opts).length) saveSwStepPrefs(root, opts, ctx);
  const prefs = getSwStepPrefs(root, ctx);
  if (!prefs.com_available) {
    if (prefs.availability_code === "unsupported_platform") {
      throw new Error("SolidWorks STEP export requires Windows and SolidWorks COM");
    }
    if (prefs.availability_code === "solidworks_not_registered") {
      throw new Error("SldWorks.Application COM is not registered; install or repair SolidWorks");
    }
    throw new Error("SolidWorks COM adapter is unavailable");
  }
  const { sourceDir, outDir } = resolveDirs(root, prefs);
  const models = listSwModelPaths(sourceDir, prefs.recursive_scan);
  if (!models.length) throw new Error("No .sldprt / .sldasm models were found");

  const host = resolveSwComHost(ctx.comHost, ctx.platform || process.platform, env);
  const runner = resolveRunnerPath(ctx.runnerPath, env);
  if (!host || !runner) throw new Error("SolidWorks COM adapter is unavailable");
  const direct = ctx.directRunner ?? env.PHOENIX_SW_COM_DIRECT === "1";
  const pair = parseIntegerPair(env.PHOENIX_SW_SAVEAS_SILENT_OPTS);
  const job = {
    models,
    out_step_dir: outDir,
    open_options: parseOpenOptions(env.PHOENIX_SW_OPEN_OPTIONS),
    save_version: pair.saveVersion,
    silent_options: pair.silentOptions,
  };
  const tempDir = path.join(root, ".phoenix", "tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  const jobFile = path.join(tempDir, `sw-step-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(jobFile, `${JSON.stringify(job, null, 2)}\n`, "utf8");

  let processResult: ProcessResult;
  try {
    processResult = await execute(host, adapterArgs(runner, jobFile, direct), root, env);
  } finally {
    try { fs.rmSync(jobFile, { force: true }); } catch { /* best effort */ }
  }
  const adapter = parseAdapterResult(processResult.stdout);
  const stderr = processResult.stderr.trim();
  if (adapter.fatal_error) {
    throw new Error(`SolidWorks COM adapter failed: ${adapter.fatal_error}${stderr ? `\n${stderr}` : ""}`);
  }
  if (processResult.exitCode !== 0) {
    throw new Error(`SolidWorks COM adapter exited with code ${processResult.exitCode}${stderr ? `: ${stderr}` : ""}`);
  }
  const failed = (adapter.failed || []).slice(0, 50).map((entry) => ({
    path: String(entry.path || ""),
    error: String(entry.error || "STEP export failed"),
  }));
  const logs = (adapter.logs || []).map(String);
  if (stderr) logs.push(stderr);
  return {
    ok_count: (adapter.ok || []).length,
    failed_count: (adapter.failed || []).length,
    failed,
    log: logs.join("\n"),
    out_display: displayPath(root, outDir),
    prefs,
    _native: "node",
    engine: "powershell-com",
  };
}
