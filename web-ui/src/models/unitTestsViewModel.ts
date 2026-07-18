export interface UnitTestCaseViewInput {
  readonly id: string;
  readonly module: string;
  readonly suite_id: string;
  readonly status: string;
}

export interface UnitTestModuleSummaryViewInput {
  readonly module: string;
}

export interface UnitTestPlanModuleViewInput {
  readonly module: string;
  readonly case_count: number;
}

export interface UnitTestPlanViewInput {
  readonly modules: readonly UnitTestPlanModuleViewInput[];
  readonly total_cases: number;
}

export interface UnitTestRunOptionsView {
  exclude_cases?: string[];
  include_cases?: string[];
  include_modules?: string[];
}

export interface UnitTestRunSummaryViewInput {
  readonly tests_run: number;
  readonly passed: number;
  readonly failed: number;
  readonly errors: number;
  readonly ignored?: number;
  readonly cancelled?: number;
}

export interface UnitTestRunResultViewInput {
  readonly ok: boolean;
  readonly suite_label: string;
  readonly duration_ms: number;
  readonly summary: UnitTestRunSummaryViewInput;
}

export interface UnitTestResultFilter {
  readonly suiteIds: ReadonlySet<string>;
  readonly statuses: ReadonlySet<string>;
  readonly watchlistOnly: boolean;
  readonly reTestedOnly: boolean;
  readonly watchlistIds: ReadonlySet<string>;
  readonly reTestedIds: ReadonlySet<string>;
}

export interface UnitTestRunScopeSelection {
  readonly modules: number;
  readonly totalModules: number;
  readonly cases: number;
  readonly totalCases: number;
}

export interface UnitTestCheckedModuleSync {
  readonly checked: ReadonlySet<string>;
  readonly available: readonly string[];
}

export function unitTestStatusLabel(status: string): string {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  if (status === "error") return "错误";
  if (status === "skipped") return "跳过";
  return status;
}

export function unitTestStatusClass(status: string): string {
  return `status-${status}`;
}

export function unitTestShortModule(module: string): string {
  return module.replace(/^tests\./u, "");
}

export function unitTestPassRate(summary: UnitTestRunSummaryViewInput | null | undefined): number {
  if (!summary || summary.tests_run === 0) return 0;
  return Math.round((summary.passed / summary.tests_run) * 100);
}

export function unitTestCaseMatchesStatus(
  testCase: UnitTestCaseViewInput,
  statuses: ReadonlySet<string>,
): boolean {
  if (testCase.status === "failed" || testCase.status === "error") {
    return statuses.has("failed") || statuses.has("error");
  }
  return statuses.has(testCase.status);
}

export function filterUnitTestCases<T extends UnitTestCaseViewInput>(
  cases: readonly T[],
  filter: UnitTestResultFilter,
): T[] {
  let scoped = cases;
  if (filter.reTestedOnly && filter.reTestedIds.size) {
    scoped = scoped.filter((testCase) => filter.reTestedIds.has(testCase.id));
  } else if (filter.watchlistOnly) {
    scoped = scoped.filter((testCase) => filter.watchlistIds.has(testCase.id));
  }
  return scoped.filter(
    (testCase) => filter.suiteIds.has(testCase.suite_id)
      && unitTestCaseMatchesStatus(testCase, filter.statuses),
  );
}

export function filterUnitTestModuleSummaries<T extends UnitTestModuleSummaryViewInput>(
  modules: readonly T[],
  visibleCases: readonly UnitTestCaseViewInput[],
): T[] {
  const visibleModules = new Set(visibleCases.map((testCase) => testCase.module));
  return modules.filter((module) => visibleModules.has(module.module));
}

export function groupUnitTestCasesByModule<T extends UnitTestCaseViewInput>(
  cases: readonly T[],
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const testCase of cases) {
    const list = groups.get(testCase.module) ?? [];
    list.push(testCase);
    groups.set(testCase.module, list);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export function deriveUnitTestRunScopeSelection(
  plan: UnitTestPlanViewInput | null | undefined,
  checked: ReadonlySet<string>,
): UnitTestRunScopeSelection | null {
  if (!plan) return null;
  const selected = plan.modules.filter((module) => checked.has(module.module));
  return {
    modules: selected.length,
    totalModules: plan.modules.length,
    cases: selected.reduce((sum, module) => sum + module.case_count, 0),
    totalCases: plan.total_cases,
  };
}

export function syncUnitTestCheckedModules(
  nextAvailable: readonly string[],
  previousAvailable: readonly string[],
  previousChecked: ReadonlySet<string>,
): UnitTestCheckedModuleSync {
  if (!previousAvailable.length) {
    return { checked: new Set(nextAvailable), available: [...nextAvailable] };
  }
  const previous = new Set(previousAvailable);
  const checked = new Set<string>();
  for (const module of nextAvailable) {
    if (!previous.has(module) || previousChecked.has(module)) checked.add(module);
  }
  return { checked, available: [...nextAvailable] };
}

export function deriveUnitTestModuleFilter(
  showRunScopeList: boolean,
  availableModules: readonly string[],
  checkedModules: ReadonlySet<string>,
): Pick<UnitTestRunOptionsView, "include_modules"> | undefined {
  if (!showRunScopeList || !availableModules.length) return undefined;
  const selected = availableModules.filter((module) => checkedModules.has(module));
  if (!selected.length || selected.length === availableModules.length) return undefined;
  return { include_modules: selected };
}

export function mergeUnitTestRunOptions(
  base: UnitTestRunOptionsView | undefined,
  defaultExcludeCases: readonly string[],
  moduleFilter: Pick<UnitTestRunOptionsView, "include_modules"> | undefined,
): UnitTestRunOptionsView | undefined {
  const excludeCases = base?.exclude_cases ?? defaultExcludeCases;
  const options: UnitTestRunOptionsView = {};
  if (excludeCases.length) options.exclude_cases = [...excludeCases];
  if (base?.include_cases?.length) options.include_cases = [...base.include_cases];
  if (moduleFilter?.include_modules?.length) {
    options.include_modules = [...moduleFilter.include_modules];
  }
  return Object.keys(options).length ? options : undefined;
}

export function formatUnitTestRunSummary(result: UnitTestRunResultViewInput): string {
  const summary = result.summary;
  if (summary.cancelled) {
    const base = `${result.suite_label}：已终止 · 已完成 ${summary.tests_run} 条（${result.duration_ms} ms）`;
    if (summary.failed + summary.errors > 0) {
      return `${base} · 失败 ${summary.failed}、错误 ${summary.errors}`;
    }
    return base;
  }
  const base = result.ok
    ? `${result.suite_label}：${summary.passed}/${summary.tests_run} 通过（${result.duration_ms} ms）`
    : `${result.suite_label}：失败 ${summary.failed}、错误 ${summary.errors}（${result.duration_ms} ms）`;
  if (summary.ignored && summary.ignored > 0) {
    return `${base} · 忽略 ${summary.ignored} 条（关注·默认不跑）`;
  }
  return base;
}
