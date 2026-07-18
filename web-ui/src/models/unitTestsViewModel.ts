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

export interface UnitTestRunScopeCaseInput {
  readonly id: string;
  readonly class_name: string;
  readonly method: string;
}

export interface UnitTestRunScopeModuleInput {
  readonly module: string;
  readonly suite_id: string;
  readonly backend?: "vitest" | "runtime";
  readonly case_count: number;
  readonly cases?: readonly UnitTestRunScopeCaseInput[];
}

export interface UnitTestRunScopeSuiteView {
  readonly id: string;
  readonly label: string;
  readonly module_count: number;
}

export interface UnitTestRunScopePlanView {
  readonly suite_label: string;
  readonly total_modules: number;
  readonly total_cases: number;
  readonly ignored_cases: number;
  readonly modules: readonly unknown[];
}

export interface UnitTestModuleCatalogTextInput {
  readonly title?: string;
  readonly description_zh?: string;
}

export interface UnitTestCaseCatalogTextInput {
  readonly summary?: string;
}

export interface UnitTestModuleHistoryTextInput {
  readonly run_count: number;
  readonly last_run_at: string;
}

export interface UnitTestRunScopeCaseView {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
}

export interface UnitTestRunScopeRowView {
  readonly module: string;
  readonly moduleLabel: string;
  readonly description: string;
  readonly suiteId: string;
  readonly suiteLabel: string;
  readonly backend: "vitest" | "runtime";
  readonly caseCount: number;
  readonly selected: boolean;
  readonly cases: readonly UnitTestRunScopeCaseView[];
  readonly runCount: number;
  readonly lastRunAt: string | null;
  readonly lastRunLabel: string;
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

export function unitTestSuiteShortLabel(
  suiteId: string,
  suiteLabels: ReadonlyMap<string, string> = new Map(),
): string {
  if (suiteId === "cad") return "CAD";
  if (suiteId === "code") return "Code";
  if (suiteId === "platform") return "平台";
  if (suiteId === "caa") return "CAA";
  if (suiteId === "all") return "全部";
  return suiteLabels.get(suiteId) ?? suiteId;
}

export function unitTestModuleDescription(
  catalog: Readonly<Record<string, UnitTestModuleCatalogTextInput>>,
  module: string,
): string {
  const entry = catalog[module] ?? catalog[`tests.${unitTestShortModule(module)}`];
  return entry?.description_zh || entry?.title || "";
}

export function unitTestModuleDescriptionBrief(
  catalog: Readonly<Record<string, UnitTestModuleCatalogTextInput>>,
  module: string,
  maxLength = 48,
): string {
  const text = unitTestModuleDescription(catalog, module).replace(/\s+/gu, " ").trim();
  if (!text) return "—";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatUnitTestModuleLastRun(iso: string | null | undefined): string {
  if (!iso || iso === new Date(0).toISOString()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function projectUnitTestRunScopeRows(
  modules: readonly UnitTestRunScopeModuleInput[],
  checkedModules: ReadonlySet<string>,
  moduleCatalog: Readonly<Record<string, UnitTestModuleCatalogTextInput>>,
  caseCatalog: Readonly<Record<string, UnitTestCaseCatalogTextInput>>,
  history: Readonly<Record<string, UnitTestModuleHistoryTextInput>>,
  suiteLabels: ReadonlyMap<string, string>,
): UnitTestRunScopeRowView[] {
  return modules.map((module) => {
    const historyEntry = history[module.module];
    const lastRunAt = historyEntry?.last_run_at
      && historyEntry.last_run_at !== new Date(0).toISOString()
      ? historyEntry.last_run_at
      : null;
    return {
      module: module.module,
      moduleLabel: unitTestShortModule(module.module),
      description: unitTestModuleDescriptionBrief(moduleCatalog, module.module),
      suiteId: module.suite_id,
      suiteLabel: unitTestSuiteShortLabel(module.suite_id, suiteLabels),
      backend: module.backend === "vitest" ? "vitest" : "runtime",
      caseCount: module.case_count,
      selected: checkedModules.has(module.module),
      cases: (module.cases ?? []).map((testCase) => ({
        id: testCase.id,
        label: `${testCase.class_name}.${testCase.method}`,
        summary: caseCatalog[testCase.id]?.summary ?? "",
      })),
      runCount: historyEntry?.run_count ?? 0,
      lastRunAt,
      lastRunLabel: formatUnitTestModuleLastRun(lastRunAt),
    };
  });
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

export interface UnitTestFullRunAvailabilityInput {
  readonly checkedSuiteCount: number;
  readonly showRunScopeList: boolean;
  readonly planLoading: boolean;
  readonly planError: string;
  readonly planReady: boolean;
  readonly planModuleCount: number;
  readonly checkedModuleCount: number;
}

export function canRunUnitTestFull(input: UnitTestFullRunAvailabilityInput): boolean {
  if (!input.checkedSuiteCount) return false;
  if (!input.showRunScopeList) return true;
  if (input.planLoading || input.planError || !input.planReady) return false;
  return input.planModuleCount > 0 && input.checkedModuleCount > 0;
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
