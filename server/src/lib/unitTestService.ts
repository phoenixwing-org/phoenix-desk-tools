import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { runtimeRepoRoot } from "./appRuntimePaths.js";
import {
  packagedRuntimeChecks,
  runPackagedRuntimeCheck,
} from "./packagedRuntimeTestService.js";

const REPO_ROOT = runtimeRepoRoot();

export type UnitTestSuiteId = "code" | "cad" | "platform" | "caa";
export type UnitTestStatus = "passed" | "failed" | "error" | "skipped";
export type UnitTestBackend = "vitest" | "runtime";

export type UnitTestSuiteInfo = {
  id: UnitTestSuiteId;
  label: string;
  description: string;
  module_count: number;
  modules: string[];
  backend: UnitTestBackend;
};

export type UnitTestCaseInfo = {
  id: string;
  module: string;
  suite_id: UnitTestSuiteId;
  class_name: string;
  method: string;
  full_name: string;
};

export type UnitTestModuleInfo = {
  module: string;
  file_stem: string;
  suite_id: UnitTestSuiteId;
  package_id: string;
  package_rel_path: string;
  backend: UnitTestBackend;
  case_count: number;
  cases: UnitTestCaseInfo[];
};

export type UnitTestCatalog = {
  modules: UnitTestModuleInfo[];
  load_errors: string[];
  scanned_at: string;
};

export type UnitTestPlanCase = {
  id: string;
  class_name: string;
  method: string;
};

export type UnitTestPlanModule = {
  module: string;
  suite_id: UnitTestSuiteId;
  backend: UnitTestBackend;
  case_count: number;
  cases?: UnitTestPlanCase[];
};

export type UnitTestPlan = {
  suite_id: string;
  suite_label: string;
  total_modules: number;
  total_cases: number;
  ignored_cases: number;
  load_errors: string[];
  modules: UnitTestPlanModule[];
};

export type UnitTestCaseResult = {
  id: string;
  module: string;
  suite_id: UnitTestSuiteId;
  class_name: string;
  method: string;
  status: UnitTestStatus;
  duration_ms: number;
  message: string;
  traceback: string;
};

export type UnitTestModuleSummary = {
  module: string;
  tests_run: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
};

export type UnitTestRunResult = {
  ok: boolean;
  suite_id: string;
  suite_label: string;
  duration_ms: number;
  summary: {
    tests_run: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    modules: number;
    load_errors?: number;
    ignored?: number;
    cancelled?: number;
  };
  modules: UnitTestModuleSummary[];
  cases: UnitTestCaseResult[];
  failures: UnitTestCaseResult[];
};

export type UnitTestRunRequest = {
  suites?: string[];
  include_modules?: string[];
  include_cases?: string[];
  exclude_cases?: string[];
  include_case_details?: boolean;
};

export type UnitTestStreamEvent =
  | {
      type: "start";
      run_id: string;
      suite_id: string;
      suite_label: string;
      total_modules: number;
      total_cases: number;
      modules: string[];
      load_errors: string[];
      ignored_cases: number;
      ignored: Array<{ id: string; method: string; module: string; reason?: string }>;
    }
  | {
      type: "module_start";
      module: string;
      module_index: number;
      module_total: number;
      suite_id: UnitTestSuiteId;
    }
  | {
      type: "case_done";
      case: UnitTestCaseResult;
      completed: number;
      total: number;
    }
  | { type: "module_done"; module: string; summary: UnitTestModuleSummary }
  | { type: "done"; result: UnitTestRunResult }
  | { type: "cancelled"; result: UnitTestRunResult; completed: number; total: number }
  | { type: "error"; message: string };

type PackageConfig = {
  id: string;
  repoPrefix: string;
  cwd: string;
};

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
};

type ActiveRun = {
  cancelled: boolean;
  children: Set<ChildProcessWithoutNullStreams>;
};

const PACKAGE_CONFIGS: PackageConfig[] = [
  { id: "server", repoPrefix: "server", cwd: path.join(REPO_ROOT, "server") },
  { id: "web-ui", repoPrefix: "web-ui", cwd: path.join(REPO_ROOT, "web-ui") },
  { id: "catdlg-core", repoPrefix: "packages/catdlg-core", cwd: path.join(REPO_ROOT, "packages", "catdlg-core") },
];

const SUITE_LABELS: Record<UnitTestSuiteId, string> = {
  code: "Code",
  cad: "CAD",
  platform: "Platform",
  caa: "CAA",
};

const SUITE_DESCRIPTIONS: Record<UnitTestSuiteId, string> = {
  code: "Code index, rename, UUID, ignore, workset, and reorder member tests.",
  cad: "CAD, FCStd, BOM, part, and xref migration tests.",
  platform: "Launcher, shell, API adapter, layout, and test platform checks.",
  caa: "CAA dialog parser, writer, NLS, wizard, and visual editor tests.",
};

const activeRuns = new Map<string, ActiveRun>();
let catalogCache: { expiresAt: number; value: UnitTestCatalog } | null = null;
let commandRunnerForTests: ((pkg: PackageConfig, args: string[], timeoutMs: number, active?: ActiveRun) => Promise<CommandResult>) | null = null;

function normalizeRel(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function withoutExt(p: string): string {
  return p.replace(/\.[^.]+$/, "");
}

function stemFromModule(module: string): string {
  const base = path.posix.basename(module);
  return base.replace(/\.test\.[cm]?[tj]sx?$/i, "");
}

function vitestEntry(pkg: PackageConfig): string {
  const requireFromPackage = createRequire(path.join(pkg.cwd, "package.json"));
  return path.join(path.dirname(requireFromPackage.resolve("vitest/package.json")), "vitest.mjs");
}

function repoModulePath(pkg: PackageConfig, file: string): string {
  return normalizeRel(`${pkg.repoPrefix}/${normalizeRel(file)}`);
}

export function sourceVitestEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...env, CI: "true" };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("PHOENIX_")) delete clean[key];
  }
  clean.PHOENIX_REPO_ROOT = REPO_ROOT;
  return clean;
}

function packageRelPath(module: string): { pkg: PackageConfig; rel: string } | null {
  const normalized = normalizeRel(module);
  for (const pkg of PACKAGE_CONFIGS) {
    const prefix = `${pkg.repoPrefix}/`;
    if (normalized.startsWith(prefix)) {
      return { pkg, rel: normalized.slice(prefix.length) };
    }
  }
  return null;
}

function classifySuite(module: string): UnitTestSuiteId {
  const m = module.toLowerCase();
  if (
    m.startsWith("packages/catdlg-core/") ||
    /(^|\/)(caa|catdlg|catnls|catrsc|wizard|controlcatalog)/i.test(module) ||
    /(emitcatdlg|parsecatdlg|patchcatdlg|patchcatnls|caadialog|caacontrol|caadrop|caaspan)/i.test(module)
  ) return "caa";
  if (/(cad|fcstd|bom|part|xlink|pnwcad|pnwbom|filerename)/i.test(module)) return "cad";
  if (/(code|reorder|uuid|workset|ignore|pdtcode)/i.test(module)) return "code";
  return "platform";
}

function caseId(module: string, fullName: string): string {
  return `${module} > ${fullName}`;
}

export type VitestModule = {
  file: string;
  count: number;
  tests: string[];
};

export function parseVitestList(output: string, pkg?: PackageConfig): VitestModule[] {
  const byFile = new Map<string, VitestModule>();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const m = line.match(/^(.+?\.test\.[cm]?[tj]sx?)\s*>\s*(.+)$/);
    if (!m) continue;
    const file = pkg ? repoModulePath(pkg, m[1]) : normalizeRel(m[1]);
    const current = byFile.get(file) ?? { file, count: 0, tests: [] };
    current.count += 1;
    current.tests.push(m[2]);
    byFile.set(file, current);
  }
  return [...byFile.values()];
}

export function parseVitestResult(output: string): { passed: number; failed: number } {
  const json = tryParseVitestJson(output);
  if (json) {
    return {
      passed: Number(json.numPassedTests || 0),
      failed: Number(json.numFailedTests || 0),
    };
  }
  const passed = (output.match(/(^|\s)(✓|PASS)\s/gm) || []).length;
  const failed = (output.match(/(^|\s)(×|✗|FAIL)\s/gm) || []).length;
  return { passed, failed };
}

function casesFromModule(file: string, tests: string[]): UnitTestCaseInfo[] {
  const suiteId = classifySuite(file);
  return tests.map((fullName) => {
    const parts = fullName.split(/\s+>\s+/).map((p) => p.trim()).filter(Boolean);
    const method = parts.at(-1) || fullName;
    const className = parts.length > 1 ? parts.slice(0, -1).join(" > ") : stemFromModule(file);
    return {
      id: caseId(file, fullName),
      module: file,
      suite_id: suiteId,
      class_name: className,
      method,
      full_name: fullName,
    };
  });
}

function moduleInfoFromListItem(item: VitestModule): UnitTestModuleInfo | null {
  const pkgRel = packageRelPath(item.file);
  if (!pkgRel) return null;
  const suiteId = classifySuite(item.file);
  const cases = casesFromModule(item.file, item.tests);
  return {
    module: item.file,
    file_stem: stemFromModule(item.file),
    suite_id: suiteId,
    package_id: pkgRel.pkg.id,
    package_rel_path: pkgRel.rel,
    backend: "vitest",
    case_count: cases.length,
    cases,
  };
}

function runSync(pkg: PackageConfig, args: string[], timeoutMs: number): CommandResult {
  const proc = spawnSync(process.execPath, [vitestEntry(pkg), ...args], {
    cwd: pkg.cwd,
    encoding: "utf8",
    env: sourceVitestEnvironment(),
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: proc.status ?? (proc.error ? 1 : 0),
    stdout: proc.stdout || "",
    stderr: proc.stderr || (proc.error?.message ?? ""),
    signal: proc.signal,
  };
}

function terminateChildProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) {
    try {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.unref();
      return;
    } catch {
      // Fall through to the regular ChildProcess API.
    }
  }
  try { child.kill(); } catch { /* process already exited */ }
}

async function runAsync(pkg: PackageConfig, args: string[], timeoutMs: number, active?: ActiveRun): Promise<CommandResult> {
  if (commandRunnerForTests) return commandRunnerForTests(pkg, args, timeoutMs, active);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitestEntry(pkg), ...args], {
      cwd: pkg.cwd,
      env: sourceVitestEnvironment(),
      shell: false,
      windowsHide: true,
    });
    active?.children.add(child);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminateChildProcess(child);
    }, timeoutMs);
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active?.children.delete(child);
      resolve(result);
    };
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));
    child.on("close", (status, signal) => {
      finish({
        status: status ?? 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
        signal,
        timedOut,
      });
    });
    child.on("error", (err) => {
      finish({
        status: 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: err.message,
        signal: null,
        timedOut,
      });
    });
  });
}

export function setUnitTestCatalogForTests(value: UnitTestCatalog | null): void {
  catalogCache = value ? { expiresAt: Date.now() + 60_000, value } : null;
}

export function setUnitTestCommandRunnerForTests(
  runner: ((pkg: PackageConfig, args: string[], timeoutMs: number, active?: ActiveRun) => Promise<CommandResult>) | null,
): void {
  commandRunnerForTests = runner;
}

export function buildUnitTestCatalogFromList(modules: VitestModule[], loadErrors: string[] = []): UnitTestCatalog {
  const infos = modules
    .map(moduleInfoFromListItem)
    .filter((m): m is UnitTestModuleInfo => m !== null)
    .sort((a, b) => a.suite_id.localeCompare(b.suite_id) || a.module.localeCompare(b.module));
  return { modules: infos, load_errors: loadErrors, scanned_at: new Date().toISOString() };
}

export function buildPackagedRuntimeCatalog(): UnitTestCatalog {
  const byModule = new Map<string, UnitTestModuleInfo>();
  for (const runtimeCheck of packagedRuntimeChecks()) {
    const fullName = `${runtimeCheck.className} > ${runtimeCheck.method}`;
    const testCase: UnitTestCaseInfo = {
      id: runtimeCheck.id,
      module: runtimeCheck.module,
      suite_id: runtimeCheck.suiteId,
      class_name: runtimeCheck.className,
      method: runtimeCheck.method,
      full_name: fullName,
    };
    const current = byModule.get(runtimeCheck.module) ?? {
      module: runtimeCheck.module,
      file_stem: path.posix.basename(runtimeCheck.module),
      suite_id: runtimeCheck.suiteId,
      package_id: "runtime",
      package_rel_path: runtimeCheck.module,
      backend: "runtime" as const,
      case_count: 0,
      cases: [],
    };
    current.cases.push(testCase);
    current.case_count = current.cases.length;
    byModule.set(runtimeCheck.module, current);
  }
  return {
    modules: [...byModule.values()].sort((a, b) => a.suite_id.localeCompare(b.suite_id) || a.module.localeCompare(b.module)),
    load_errors: [],
    scanned_at: new Date().toISOString(),
  };
}

export function discoverUnitTestCatalog(force = false): UnitTestCatalog {
  const now = Date.now();
  if (!force && catalogCache && catalogCache.expiresAt > now) return catalogCache.value;
  if (process.env.PHOENIX_PACKAGED === "1") {
    const catalog = buildPackagedRuntimeCatalog();
    catalogCache = { expiresAt: now + 60_000, value: catalog };
    return catalog;
  }
  const modules: VitestModule[] = [];
  const loadErrors: string[] = [];
  for (const pkg of PACKAGE_CONFIGS) {
    const proc = runSync(pkg, ["list", "--run"], 90_000);
    if (proc.status !== 0) {
      loadErrors.push(`${pkg.id}: ${(proc.stderr || proc.stdout || "vitest list failed").trim()}`);
      continue;
    }
    modules.push(...parseVitestList(proc.stdout, pkg));
  }
  const catalog = buildUnitTestCatalogFromList(modules, loadErrors);
  catalogCache = { expiresAt: now + 60_000, value: catalog };
  return catalog;
}

export function buildUnitTestSuites(catalog = discoverUnitTestCatalog()): UnitTestSuiteInfo[] {
  return (["code", "cad", "platform", "caa"] as UnitTestSuiteId[])
    .map((id) => {
      const modules = catalog.modules.filter((m) => m.suite_id === id).map((m) => m.module);
      return {
        id,
        label: SUITE_LABELS[id],
        description: SUITE_DESCRIPTIONS[id],
        module_count: modules.length,
        modules,
        backend: catalog.modules.find((module) => module.suite_id === id)?.backend || "vitest",
      };
    })
    .filter((suite) => suite.module_count > 0);
}

function requestedSuiteIds(raw: string[] | undefined): UnitTestSuiteId[] {
  const valid = new Set<UnitTestSuiteId>(["code", "cad", "platform", "caa"]);
  if (!raw?.length || raw.includes("all")) return [...valid];
  const out = raw.filter((id): id is UnitTestSuiteId => valid.has(id as UnitTestSuiteId));
  return out.length ? [...new Set(out)] : [...valid];
}

function suiteLabel(ids: UnitTestSuiteId[]): string {
  return ids.length === 1 ? SUITE_LABELS[ids[0]] : ids.map((id) => SUITE_LABELS[id]).join(" + ");
}

function selectedCatalogModules(catalog: UnitTestCatalog, req: UnitTestRunRequest) {
  const suiteIds = requestedSuiteIds(req.suites);
  const suiteSet = new Set(suiteIds);
  const includeModules = new Set((req.include_modules || []).map(normalizeRel));
  const includeCases = new Set(req.include_cases || []);
  const excludeCases = new Set(req.exclude_cases || []);
  const modules = catalog.modules
    .filter((m) => suiteSet.has(m.suite_id))
    .filter((m) => !includeModules.size || includeModules.has(m.module));
  const beforeCases = modules.flatMap((m) => m.cases);
  const selectedByModule = new Map<string, UnitTestCaseInfo[]>();
  const ignored: UnitTestCaseInfo[] = [];
  for (const mod of modules) {
    const selectedCases = mod.cases.filter((testCase) => {
      if (includeCases.size && !includeCases.has(testCase.id)) return false;
      if (excludeCases.has(testCase.id)) return false;
      return true;
    });
    const selectedIds = new Set(selectedCases.map((c) => c.id));
    for (const testCase of mod.cases) {
      if (!selectedIds.has(testCase.id)) ignored.push(testCase);
    }
    if (selectedCases.length) selectedByModule.set(mod.module, selectedCases);
  }
  const selectedModules = modules.filter((m) => selectedByModule.has(m.module));
  return { suiteIds, selectedModules, selectedByModule, ignored, beforeCases };
}

export function buildUnitTestPlan(req: UnitTestRunRequest, catalog = discoverUnitTestCatalog()): UnitTestPlan {
  const selection = selectedCatalogModules(catalog, req);
  const modules = selection.selectedModules.map((m) => {
    const cases = selection.selectedByModule.get(m.module) || [];
    return {
      module: m.module,
      suite_id: m.suite_id,
      backend: m.backend,
      case_count: cases.length,
      ...(req.include_case_details ? {
        cases: cases.map((c) => ({ id: c.id, class_name: c.class_name, method: c.method })),
      } : {}),
    };
  });
  return {
    suite_id: selection.suiteIds.length === 1 ? selection.suiteIds[0] : "all",
    suite_label: suiteLabel(selection.suiteIds),
    total_modules: modules.length,
    total_cases: modules.reduce((sum, m) => sum + m.case_count, 0),
    ignored_cases: selection.ignored.length,
    load_errors: catalog.load_errors,
    modules,
  };
}

export function testModuleCatalog(reqModules: string[] = [], catalog = discoverUnitTestCatalog()) {
  const filter = new Set(reqModules.map(normalizeRel));
  const modules: Record<string, any> = {};
  for (const m of catalog.modules) {
    if (filter.size && !filter.has(m.module)) continue;
    modules[m.module] = {
      module_name: m.module,
      file_stem: m.file_stem,
      suite_id: m.suite_id,
      title: m.file_stem,
      description_zh: `${SUITE_LABELS[m.suite_id]} / ${m.file_stem}`,
      doc_path: null,
      case_count: m.case_count,
    };
  }
  return { modules };
}

export function testCaseCatalog(ids: string[] = [], catalog = discoverUnitTestCatalog()) {
  const filter = new Set(ids);
  const cases: Record<string, any> = {};
  for (const m of catalog.modules) {
    for (const c of m.cases) {
      if (filter.size && !filter.has(c.id)) continue;
      cases[c.id] = {
        full_id: c.id,
        case_key: c.method,
        module_name: c.module,
        class_name: c.class_name,
        method_name: c.method,
        suite_id: c.suite_id,
        title: c.method,
        description_zh: c.full_name,
        summary: c.full_name,
        docstring: "",
      };
    }
  }
  return { cases };
}

function tryParseVitestJson(output: string): any | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function moduleFromJsonName(rawName: string): string {
  const normalized = normalizeRel(rawName);
  if (path.isAbsolute(rawName)) {
    const rel = normalizeRel(path.relative(REPO_ROOT, rawName));
    return rel && !rel.startsWith("..") ? rel : normalized;
  }
  return normalized;
}

function mapStatus(status: string): UnitTestStatus {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "skipped" || status === "todo") return "skipped";
  return "error";
}

export function parseVitestJsonRun(output: string, durationMs = 0): UnitTestRunResult {
  const json = tryParseVitestJson(output);
  if (!json) {
    const message = output.trim() || "Vitest did not produce JSON output.";
    const failure: UnitTestCaseResult = {
      id: "__vitest_json_error__",
      module: "",
      suite_id: "platform",
      class_name: "vitest",
      method: "json reporter",
      status: "error",
      duration_ms: 0,
      message,
      traceback: message,
    };
    return runResultFromCases([failure], [], durationMs, "all", "Vitest", false, 0);
  }
  const cases: UnitTestCaseResult[] = [];
  for (const testResult of json.testResults || []) {
    const module = moduleFromJsonName(String(testResult.name || ""));
    const suiteId = classifySuite(module);
    for (const assertion of testResult.assertionResults || []) {
      const ancestors = Array.isArray(assertion.ancestorTitles) ? assertion.ancestorTitles.map(String) : [];
      const method = String(assertion.title || assertion.fullName || "");
      const fullName = [...ancestors, method].filter(Boolean).join(" > ") || String(assertion.fullName || "");
      const status = mapStatus(String(assertion.status || ""));
      const failureMessages = Array.isArray(assertion.failureMessages) ? assertion.failureMessages.map(String) : [];
      cases.push({
        id: caseId(module, fullName),
        module,
        suite_id: suiteId,
        class_name: ancestors.length ? ancestors.join(" > ") : stemFromModule(module),
        method,
        status,
        duration_ms: Number(assertion.duration || 0),
        message: failureMessages.join("\n"),
        traceback: failureMessages.join("\n"),
      });
    }
  }
  return runResultFromCases(cases, [], durationMs, "all", "Vitest", false, 0);
}

function moduleSummaries(cases: UnitTestCaseResult[]): UnitTestModuleSummary[] {
  const byModule = new Map<string, UnitTestModuleSummary>();
  for (const c of cases) {
    const summary = byModule.get(c.module) ?? { module: c.module, tests_run: 0, passed: 0, failed: 0, errors: 0, skipped: 0 };
    summary.tests_run += 1;
    if (c.status === "passed") summary.passed += 1;
    else if (c.status === "failed") summary.failed += 1;
    else if (c.status === "error") summary.errors += 1;
    else summary.skipped += 1;
    byModule.set(c.module, summary);
  }
  return [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module));
}

function runResultFromCases(
  cases: UnitTestCaseResult[],
  loadErrors: string[],
  durationMs: number,
  suiteId: string,
  suiteLabelText: string,
  cancelled: boolean,
  ignoredCount: number,
): UnitTestRunResult {
  const modules = moduleSummaries(cases);
  const failures = cases.filter((c) => c.status === "failed" || c.status === "error");
  const passed = cases.filter((c) => c.status === "passed").length;
  const failed = cases.filter((c) => c.status === "failed").length;
  const errors = cases.filter((c) => c.status === "error").length + loadErrors.length;
  const skipped = cases.filter((c) => c.status === "skipped").length;
  return {
    ok: !cancelled && failed === 0 && errors === 0,
    suite_id: suiteId,
    suite_label: suiteLabelText,
    duration_ms: durationMs,
    summary: {
      tests_run: cases.length,
      passed,
      failed,
      errors,
      skipped,
      modules: modules.length,
      load_errors: loadErrors.length,
      ignored: ignoredCount,
      cancelled: cancelled ? 1 : 0,
    },
    modules,
    cases,
    failures,
  };
}

function regexEscape(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function vitestCaseNamePattern(fullName: string): string {
  return regexEscape(fullName.replace(/\s+>\s+/g, " ").trim());
}

function packageRunArgs(pkg: PackageConfig, modules: UnitTestModuleInfo[], selectedByModule: Map<string, UnitTestCaseInfo[]>, needsCaseFilter: boolean): string[] {
  const relFiles = [...new Set(modules.map((m) => m.package_rel_path))].sort();
  const args = ["run", ...relFiles, "--reporter=json", "--passWithNoTests"];
  if (needsCaseFilter) {
    const names = modules
      .flatMap((m) => selectedByModule.get(m.module) || [])
      .map((c) => vitestCaseNamePattern(c.full_name));
    if (names.length) args.push("--testNamePattern", `^(?:${names.join("|")})$`);
  }
  return args;
}

export async function runUnitTests(
  req: UnitTestRunRequest,
  onEvent?: (event: UnitTestStreamEvent) => void,
): Promise<UnitTestRunResult> {
  const started = Date.now();
  const runId = randomUUID();
  const active: ActiveRun = { cancelled: false, children: new Set() };
  const catalog = discoverUnitTestCatalog();
  const selection = selectedCatalogModules(catalog, req);
  const plan = buildUnitTestPlan(req, catalog);
  activeRuns.set(runId, active);
  const emit = (event: UnitTestStreamEvent) => {
    try {
      onEvent?.(event);
    } catch {
      active.cancelled = true;
      for (const child of active.children) terminateChildProcess(child);
    }
  };
  const ignored = selection.ignored.map((c) => ({ id: c.id, method: c.method, module: c.module, reason: "filtered" }));
  emit({
    type: "start",
    run_id: runId,
    suite_id: plan.suite_id,
    suite_label: plan.suite_label,
    total_modules: plan.total_modules,
    total_cases: plan.total_cases,
    modules: plan.modules.map((m) => m.module),
    load_errors: plan.load_errors,
    ignored_cases: plan.ignored_cases,
    ignored,
  });

  const allCases: UnitTestCaseResult[] = [];
  const loadErrors = [...catalog.load_errors];
  const byPackage = new Map<string, { pkg: PackageConfig; modules: UnitTestModuleInfo[] }>();
  for (const mod of selection.selectedModules) {
    if (mod.backend !== "vitest") continue;
    const pkgRel = packageRelPath(mod.module);
    if (!pkgRel) continue;
    const group = byPackage.get(pkgRel.pkg.id) ?? { pkg: pkgRel.pkg, modules: [] };
    group.modules.push(mod);
    byPackage.set(pkgRel.pkg.id, group);
  }

  try {
    let moduleIndex = 0;
    const runtimeChecks = new Map(packagedRuntimeChecks().map((runtimeCheck) => [runtimeCheck.id, runtimeCheck]));
    for (const mod of selection.selectedModules.filter((item) => item.backend === "runtime")) {
      if (active.cancelled) break;
      moduleIndex += 1;
      emit({
        type: "module_start",
        module: mod.module,
        module_index: moduleIndex,
        module_total: selection.selectedModules.length,
        suite_id: mod.suite_id,
      });
      if (active.cancelled) break;
      for (const selectedCase of selection.selectedByModule.get(mod.module) || []) {
        if (active.cancelled) break;
        const definition = runtimeChecks.get(selectedCase.id);
        const outcome = definition
          ? await runPackagedRuntimeCheck(definition)
          : {
              status: "error" as const,
              durationMs: 0,
              message: `Runtime check implementation is missing: ${selectedCase.id}`,
              traceback: `Runtime check implementation is missing: ${selectedCase.id}`,
            };
        const resultCase: UnitTestCaseResult = {
          id: selectedCase.id,
          module: selectedCase.module,
          suite_id: selectedCase.suite_id,
          class_name: selectedCase.class_name,
          method: selectedCase.method,
          status: outcome.status,
          duration_ms: outcome.durationMs,
          message: outcome.message,
          traceback: outcome.traceback,
        };
        allCases.push(resultCase);
        emit({ type: "case_done", case: resultCase, completed: allCases.length, total: plan.total_cases });
      }
    }

    for (const group of byPackage.values()) {
      if (active.cancelled) break;
      for (const mod of group.modules) {
        moduleIndex += 1;
        emit({ type: "module_start", module: mod.module, module_index: moduleIndex, module_total: selection.selectedModules.length, suite_id: mod.suite_id });
      }
      if (active.cancelled) break;
      const needsCaseFilter = Boolean(req.include_cases?.length || req.exclude_cases?.length);
      const args = packageRunArgs(group.pkg, group.modules, selection.selectedByModule, needsCaseFilter);
      const proc = await runAsync(group.pkg, args, 180_000, active);
      if (active.cancelled) break;
      if (proc.timedOut) {
        loadErrors.push(`${group.pkg.id}: Vitest timed out after 180 seconds`);
        continue;
      }
      if (proc.signal) {
        loadErrors.push(`${group.pkg.id}: Vitest terminated by ${proc.signal}`);
        continue;
      }
      const parsed = parseVitestJsonRun(`${proc.stdout}\n${proc.stderr}`, Date.now() - started);
      if (proc.status !== 0 && parsed.cases.length === 0) {
        loadErrors.push(`${group.pkg.id}: ${(proc.stderr || proc.stdout || "vitest run failed").trim()}`);
      }
      const allowed = new Set(group.modules.flatMap((m) => (selection.selectedByModule.get(m.module) || []).map((c) => c.id)));
      for (const c of parsed.cases) {
        if (allowed.size && !allowed.has(c.id)) continue;
        allCases.push(c);
        emit({ type: "case_done", case: c, completed: allCases.length, total: plan.total_cases });
      }
    }
  } finally {
    activeRuns.delete(runId);
  }

  if (!active.cancelled && plan.total_cases > 0 && allCases.length === 0) {
    loadErrors.push(
      `The test backend returned no selected test cases for a plan containing ${plan.total_cases} case(s)`,
    );
  }

  const duration = Date.now() - started;
  const suiteId = selection.suiteIds.length === 1 ? selection.suiteIds[0] : "all";
  const result = runResultFromCases(allCases, loadErrors, duration, suiteId, plan.suite_label, active.cancelled, plan.ignored_cases);
  for (const summary of result.modules) emit({ type: "module_done", module: summary.module, summary });
  if (active.cancelled) emit({ type: "cancelled", result, completed: allCases.length, total: plan.total_cases });
  else emit({ type: "done", result });
  return result;
}

export function cancelUnitTestRun(runId: string): boolean {
  const active = activeRuns.get(runId);
  if (!active) return false;
  active.cancelled = true;
  for (const child of active.children) terminateChildProcess(child);
  return true;
}

export function caaVitestModules(catalog = discoverUnitTestCatalog()): VitestModule[] {
  return catalog.modules
    .filter((m) => m.suite_id === "caa")
    .map((m) => ({ file: m.module, count: m.case_count, tests: m.cases.map((c) => c.full_name) }));
}
