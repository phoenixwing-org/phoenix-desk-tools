<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchTestModuleCatalog,
  fetchTestCaseCatalog,
  fetchUnitTestPlan,
  fetchUnitTestSuites,
  fetchVitestTestList,
  cancelUnitTestRun,
  runUnitTestsStream,
  type TestModuleCatalogEntry,
  type TestCaseCatalogEntry,
  type UnitTestPlan,
  type UnitTestPlanModule,
  type UnitTestCaseResult,
  type UnitTestRunOptions,
  type UnitTestRunResult,
  type UnitTestStreamEvent,
  type UnitTestSuiteInfo,
} from "../api";
import PageHeader from "../components/PageHeader.vue";
import { useUnitTestsPropertySheet } from "../composables/useUnitTestsPropertySheet";
import { promptChoice } from "../composables/choiceDialog";
import { useAppShell } from "../composables/useAppShell";
import {
  UNIT_TEST_RUNNABLE_SUITE_IDS,
  useUnitTestsPageStore,
  type UnitTestsPageTab,
} from "../stores/unitTestsPage";
import {
  clearWatchlist,
  excludeCaseIdsForFullRun,
  includeCaseIdsForWatchlistRun,
  loadWatchlist,
  recordWatchlistFailure,
  removeWatchlistEntry,
  setWatchlistRunOnFull,
  sortWatchlistEntries,
  watchlistTotalFailCount,
  type UnitTestWatchlistEntry,
} from "../utils/unitTestWatchlist";
import {
  hasModuleHistory,
  loadModuleHistory,
  moduleLastRunAt,
  moduleRunCount,
  recordModuleRuns,
  sortPlanModules,
  type ModuleHistoryMap,
} from "../utils/unitTestModuleHistory";
import { mergeSuites } from "../utils/unitTestBackendSplit";

const shell = useAppShell();
const pageStore = useUnitTestsPageStore();

type PageTab = UnitTestsPageTab;
type RunMode = "full" | "watchlist";

const RUNNABLE_SUITE_IDS = UNIT_TEST_RUNNABLE_SUITE_IDS;

const STATUS_FILTER_OPTIONS = [
  { id: "passed", label: "通过" },
  { id: "failed", label: "失败" },
  { id: "error", label: "错误" },
  { id: "skipped", label: "跳过" },
] as const;

const suites = ref<UnitTestSuiteInfo[]>([]);
const running = ref(false);
const loadError = ref("");
const result = ref<UnitTestRunResult | null>(null);
const lastRunSuites = ref<string[]>([]);
const resultSuiteChecked = ref<Set<string>>(new Set());
const resultStatusChecked = ref<Set<string>>(new Set(["passed", "failed", "error", "skipped"]));
const expandedCase = ref<string | null>(null);
const runProgress = ref<{
  suiteLabel: string;
  totalModules: number;
  totalCases: number;
  completedCases: number;
  moduleIndex: number;
  moduleTotal: number;
  currentModule: string;
  currentSuiteId: string;
  currentCase: string;
  passed: number;
  failed: number;
  skipped: number;
  recentCases: UnitTestCaseResult[];
  startedAt: number;
} | null>(null);
const runTick = ref(0);
const moduleCatalog = ref<Record<string, TestModuleCatalogEntry>>({});
const caseCatalog = ref<Record<string, TestCaseCatalogEntry>>({});
const watchlist = ref<UnitTestWatchlistEntry[]>(loadWatchlist());
const filterWatchlistOnly = ref(false);
const filterReTestedOnly = ref(false);
const lastReTestedCaseIds = ref<Set<string>>(new Set());
const lastIgnoredCount = ref(0);
const runProgressIgnored = ref(0);
const runScopeCollapsed = ref(false);
const rerunningWatchlistId = ref<string | null>(null);
const rerunningModule = ref<string | null>(null);
const moduleHistory = ref<ModuleHistoryMap>(loadModuleHistory());
const currentRunId = ref<string | null>(null);
let runAbortController: AbortController | null = null;

const runChecked = computed(() => pageStore.runCheckedSuiteIds);
const runCheckedCount = computed(() => pageStore.runCheckedCount);
const activeTab = computed({
  get: () => pageStore.activeTab,
  set: (tab: PageTab) => pageStore.setActiveTab(tab),
});
const watchlistPrefs = computed(() => pageStore.watchlistPrefs);
const showRunScopeList = computed({
  get: () => pageStore.showRunScopeList,
  set: (value: boolean) => pageStore.setShowRunScopeList(value),
});
const showRunScopeCases = computed({
  get: () => pageStore.showRunScopeCases,
  set: (value: boolean) => pageStore.setShowRunScopeCases(value),
});
const moduleSortBy = computed(() => pageStore.moduleSortBy);

useUnitTestsPropertySheet("unit_tests", {
  runCheckedCount,
  runnableSuiteCount: computed(() => RUNNABLE_SUITE_IDS.length),
  activeTab,
  running,
  result,
});

const runPlan = ref<UnitTestPlan | null>(null);
const runPlanLoading = ref(false);
const runPlanError = ref("");
const runCheckedModules = ref<Set<string>>(new Set());
const lastPlanModuleNames = ref<string[]>([]);

const runnableSuites = computed(() =>
  suites.value.filter((s) => RUNNABLE_SUITE_IDS.includes(s.id as (typeof RUNNABLE_SUITE_IDS)[number])),
);

const watchlistCount = computed(() => watchlist.value.length);
const watchlistTotalFails = computed(() => watchlistTotalFailCount(watchlist.value));
const watchlistSkipCount = computed(() => watchlist.value.filter((e) => !e.run_on_full).length);
const watchlistIdSet = computed(() => new Set(watchlist.value.map((e) => e.id)));
const sortedWatchlist = computed(() =>
  sortWatchlistEntries(watchlist.value, watchlistPrefs.value.sort_by),
);
const watchlistChecked = computed(() => pageStore.watchlistCheckedSet);
const watchlistCheckedCount = computed(() => pageStore.watchlistCheckedCount);
const watchlistAllChecked = computed(
  () =>
    sortedWatchlist.value.length > 0 &&
    sortedWatchlist.value.every((e) => watchlistChecked.value.has(e.id)),
);

const runScopeModuleNames = computed(() => runPlan.value?.modules.map((m) => m.module) ?? []);

const sortedRunPlanModules = computed(() => {
  const mods = runPlan.value?.modules ?? [];
  return sortPlanModules(mods, moduleSortBy.value, moduleHistory.value);
});

const showModuleHistoryColumns = computed(() => hasModuleHistory(moduleHistory.value));

const runScopeModulesAllChecked = computed(
  () =>
    runScopeModuleNames.value.length > 0 &&
    runScopeModuleNames.value.every((m) => runCheckedModules.value.has(m)),
);

const runScopeModuleCheckedCount = computed(() =>
  runScopeModuleNames.value.filter((m) => runCheckedModules.value.has(m)).length,
);

const runScopeSelectedSummary = computed(() => {
  if (!runPlan.value) return null;
  const mods = runPlan.value.modules.filter((m) => runCheckedModules.value.has(m.module));
  return {
    modules: mods.length,
    totalModules: runPlan.value.modules.length,
    cases: mods.reduce((sum, m) => sum + m.case_count, 0),
    totalCases: runPlan.value.total_cases,
  };
});

const runScopeButtonModuleCount = computed(() => {
  if (showRunScopeList.value && runPlan.value && !runPlanLoading.value) {
    const s = runScopeSelectedSummary.value;
    if (s && s.modules < s.totalModules) return `${s.modules}/${s.totalModules}`;
    return String(runPlan.value.total_modules);
  }
  let sum = 0;
  for (const id of runChecked.value) {
    const suite = suites.value.find((s) => s.id === id);
    if (suite) sum += suite.module_count;
  }
  return sum > 0 ? String(sum) : "";
});

const canRunFull = computed(() => {
  if (!runCheckedCount.value) return false;
  if (showRunScopeList.value && runPlan.value?.modules.length) {
    return runScopeModuleCheckedCount.value > 0;
  }
  return true;
});

const runProgressPct = computed(() => {
  const p = runProgress.value;
  if (!p || !p.totalCases) return 0;
  return Math.round((p.completedCases / p.totalCases) * 100);
});

const runElapsedMs = computed(() => {
  runTick.value;
  const p = runProgress.value;
  if (!p) return 0;
  return Date.now() - p.startedAt;
});

const runProgressHeadline = computed(() => {
  const p = runProgress.value;
  if (!p) return "";
  const suite = suiteLabelById.value.get(p.currentSuiteId) ?? p.currentSuiteId;
  if (p.currentCase) {
    return `${suite} · ${shortModule(p.currentModule)} · ${p.currentCase}`;
  }
  if (p.currentModule) {
    return `${suite} · ${shortModule(p.currentModule)}`;
  }
  return p.suiteLabel;
});

const passRate = computed(() => {
  const s = result.value?.summary;
  if (!s || s.tests_run === 0) return 0;
  return Math.round((s.passed / s.tests_run) * 100);
});

const suiteLabelById = computed(() => {
  const map = new Map<string, string>();
  for (const s of suites.value) map.set(s.id, s.label);
  return map;
});

function caseMatchesStatus(c: UnitTestCaseResult) {
  if (c.status === "failed" || c.status === "error") {
    return resultStatusChecked.value.has("failed") || resultStatusChecked.value.has("error");
  }
  return resultStatusChecked.value.has(c.status);
}

const filteredCases = computed(() => {
  let cases = result.value?.cases ?? [];
  if (filterReTestedOnly.value && lastReTestedCaseIds.value.size) {
    cases = cases.filter((c) => lastReTestedCaseIds.value.has(c.id));
  } else if (filterWatchlistOnly.value) {
    const ids = watchlistIdSet.value;
    cases = cases.filter((c) => ids.has(c.id));
  }
  return cases.filter(
    (c) => resultSuiteChecked.value.has(c.suite_id) && caseMatchesStatus(c),
  );
});

const filteredModuleSummaries = computed(() => {
  const mods = result.value?.modules ?? [];
  const visibleModules = new Set(filteredCases.value.map((c) => c.module));
  return mods.filter((m) => visibleModules.has(m.module));
});

const groupedModules = computed(() => {
  const map = new Map<string, UnitTestCaseResult[]>();
  for (const c of filteredCases.value) {
    const list = map.get(c.module) ?? [];
    list.push(c);
    map.set(c.module, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
});

function statusLabel(status: string) {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  if (status === "error") return "错误";
  if (status === "skipped") return "跳过";
  return status;
}

function statusClass(status: string) {
  return `status-${status}`;
}

function shortModule(module: string) {
  return module.replace(/^tests\./, "");
}

function suiteShortLabel(suiteId: string): string {
  if (suiteId === "cad") return "CAD";
  if (suiteId === "code") return "Code";
  if (suiteId === "platform") return "平台";
  if (suiteId === "caa") return "CAA";
  if (suiteId === "all") return "全部";
  return suiteLabelById.value.get(suiteId) ?? suiteId;
}

function moduleCatalogEntry(module: string): TestModuleCatalogEntry | undefined {
  return moduleCatalog.value[module] ?? moduleCatalog.value[`tests.${shortModule(module)}`];
}

function moduleDescription(module: string): string {
  const entry = moduleCatalogEntry(module);
  if (!entry) return "";
  return entry.description_zh || entry.title || "";
}

function moduleDescriptionBrief(module: string, maxLen = 48): string {
  const text = moduleDescription(module).replace(/\s+/g, " ").trim();
  if (!text) return "—";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function caseCatalogEntry(entry: UnitTestWatchlistEntry): TestCaseCatalogEntry | undefined {
  return caseCatalog.value[entry.id];
}

function caseDescription(entry: UnitTestWatchlistEntry): string {
  const cat = caseCatalogEntry(entry);
  if (cat?.description_zh) return cat.description_zh.trim();
  if (cat?.title && cat.title !== `${entry.class_name}.${entry.method}`) {
    return cat.title.trim();
  }
  const doc = cat?.docstring?.trim();
  if (doc) {
    const first = doc.split(/\n+/).map((ln) => ln.trim()).find(Boolean);
    if (first && !first.startsWith("case_id=")) return first;
  }
  return moduleDescription(entry.module);
}

function caseDescriptionBrief(entry: UnitTestWatchlistEntry, maxLen = 56): string {
  const text = caseDescription(entry).replace(/\s+/g, " ").trim();
  if (!text) return "—";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

/** 与后端 suite_registry 前缀一致，仅用于模块表展示 */
function classifyModule(module: string): string {
  const stem = module.replace(/^tests\./, "");
  if (stem.startsWith("test_code_") || stem.startsWith("test_reorder_") || stem === "test_text_encoding") {
    return "code";
  }
  if (
    stem.startsWith("test_fcstd_") ||
    stem.startsWith("test_bom_") ||
    stem.startsWith("test_part_") ||
    stem.startsWith("test_batch_step_") ||
    stem.startsWith("test_xlink_") ||
    stem.startsWith("test_cad_") ||
    stem.startsWith("test_rename_ref_fix") ||
    stem.startsWith("test_solidworks_")
  ) {
    return "cad";
  }
  return "platform";
}

function onModuleSortChange(sortBy: "plan" | "last_run_at" | "run_count") {
  pageStore.setModuleSortBy(sortBy);
}

function formatModuleLastRun(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function runScopeRowClass({ row }: { row: UnitTestPlanModule }) {
  return runCheckedModules.value.has(row.module) ? "" : "run-scope-row-off";
}

function recordRunHistoryFromResult(r: UnitTestRunResult | null) {
  if (!r?.modules.length) return;
  moduleHistory.value = recordModuleRuns(
    r.modules.map((m) => m.module),
    moduleHistory.value,
  );
}

function toggleCase(id: string) {
  expandedCase.value = expandedCase.value === id ? null : id;
}

function toggleRunSuite(id: string, checked: boolean) {
  pageStore.toggleRunSuite(id, checked);
}

function toggleResultSuite(id: string, checked: boolean) {
  const next = new Set(resultSuiteChecked.value);
  if (checked) next.add(id);
  else next.delete(id);
  resultSuiteChecked.value = next;
}

function toggleResultStatus(id: string, checked: boolean) {
  const next = new Set(resultStatusChecked.value);
  if (checked) next.add(id);
  else next.delete(id);
  resultStatusChecked.value = next;
}

function selectAllRun() {
  pageStore.selectAllRun();
}

function clearAllRun() {
  pageStore.clearAllRun();
}

function selectAllResultSuites() {
  resultSuiteChecked.value = new Set(lastRunSuites.value);
}

function selectOnlyFailedResults() {
  resultStatusChecked.value = new Set(["failed", "error"]);
}

function syncWatchlistFromCase(c: UnitTestCaseResult) {
  if (c.status === "failed" || c.status === "error") {
    watchlist.value = recordWatchlistFailure(c, watchlistPrefs.value);
    void loadCaseCatalog([c.id]);
    void loadModuleCatalog([c.module]);
  }
}

function formatRunSummary(r: UnitTestRunResult): string {
  const s = r.summary;
  if (s.cancelled) {
    const base = `${r.suite_label}：已终止 · 已完成 ${s.tests_run} 条（${r.duration_ms} ms）`;
    if (s.failed + s.errors > 0) {
      return `${base} · 失败 ${s.failed}、错误 ${s.errors}`;
    }
    return base;
  }
  const base = r.ok
    ? `${r.suite_label}：${s.passed}/${s.tests_run} 通过（${r.duration_ms} ms）`
    : `${r.suite_label}：失败 ${s.failed}、错误 ${s.errors}（${r.duration_ms} ms）`;
  if (s.ignored && s.ignored > 0) {
    return `${base} · 忽略 ${s.ignored} 条（关注·默认不跑）`;
  }
  return base;
}

function cancelRun() {
  if (!running.value || !currentRunId.value) return;
  shell.appendLog("[单元测试] 请求终止…（当前用例结束后停止）", { source: "unit_tests" });
  shell.setStatus("正在终止…");
  void cancelUnitTestRun(currentRunId.value).catch((e) => {
    shell.setStatus(String(e));
  });
}

function onWatchlistRunOnFullChange(entry: UnitTestWatchlistEntry, checked: boolean) {
  watchlist.value = setWatchlistRunOnFull(entry.id, checked);
}

function onWatchlistDefaultRunOnFullChange(checked: boolean) {
  pageStore.setWatchlistDefaultRunOnFull(checked);
}

function onWatchlistSortChange(sortBy: "fail_count" | "last_seen_at") {
  pageStore.setWatchlistSortBy(sortBy);
}

function toggleWatchlistChecked(id: string, checked: boolean) {
  pageStore.toggleWatchlistChecked(id, checked);
}

function toggleAllWatchlistChecked(checked: boolean) {
  pageStore.toggleAllWatchlistChecked(
    sortedWatchlist.value.map((e) => e.id),
    checked,
  );
}

function syncWatchlistChecked() {
  pageStore.pruneWatchlistChecked(new Set(sortedWatchlist.value.map((e) => e.id)));
}

function formatWatchlistTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function removeFromWatchlist(entry: UnitTestWatchlistEntry) {
  const result = await promptChoice({
    title: "移出关注列表",
    message: `${entry.method}\n累计失败 ${entry.fail_count} 次`,
    choices: [
      { id: "remove", label: "移出", variant: "danger" },
      { id: "cancel", label: "取消" },
    ],
    defaultChoiceId: "cancel",
  });
  if (result.choiceId !== "remove") return;
  watchlist.value = removeWatchlistEntry(entry.id);
}

async function clearAllWatchlist() {
  const result = await promptChoice({
    title: "清空关注列表",
    message: `确定移除全部 ${watchlistCount.value} 条失败关注？\n此操作不可恢复`,
    choices: [
      { id: "clear", label: "全部移除", variant: "danger" },
      { id: "cancel", label: "取消" },
    ],
    defaultChoiceId: "cancel",
  });
  if (result.choiceId !== "clear") return;
  watchlist.value = clearWatchlist();
}

function filterResultsToWatchlist() {
  filterReTestedOnly.value = false;
  filterWatchlistOnly.value = true;
  resultStatusChecked.value = new Set(["failed", "error", "passed", "skipped"]);
  activeTab.value = "results";
}

function filterResultsToReTested() {
  filterWatchlistOnly.value = false;
  filterReTestedOnly.value = true;
  resultStatusChecked.value = new Set(["failed", "error", "passed", "skipped"]);
  activeTab.value = "results";
}

async function loadModuleCatalog(modules?: string[]) {
  try {
    const data = await fetchTestModuleCatalog(modules);
    moduleCatalog.value = { ...moduleCatalog.value, ...data.modules };
  } catch {
    /* 简介为辅助信息，失败时不阻断页面 */
  }
}

async function loadCaseCatalog(caseIds?: string[]) {
  const ids = caseIds ?? watchlist.value.map((e) => e.id);
  if (!ids.length) return;
  try {
    const data = await fetchTestCaseCatalog(ids);
    caseCatalog.value = { ...caseCatalog.value, ...data.cases };
  } catch {
    /* 简介为辅助信息，失败时不阻断页面 */
  }
}

async function loadSuites() {
  loadError.value = "";
  try {
    // 并行从 Python + Node 获取套件列表
    const [pyData, vitestData] = await Promise.all([
      fetchUnitTestSuites().catch(() => ({ suites: [] as UnitTestSuiteInfo[] })),
      fetchVitestTestList().catch(() => ({ modules: [] as { file: string; count: number; tests: string[] }[] })),
    ]);

    suites.value = mergeSuites(pyData.suites, vitestData.modules ?? []);
    void loadRunPlan();
  } catch (e) {
    loadError.value = String(e);
    suites.value = [];
  }
}

function syncRunCheckedModulesFromPlan(plan: UnitTestPlan) {
  const names = plan.modules.map((m) => m.module);
  const prevAvailable = new Set(lastPlanModuleNames.value);
  const prevChecked = runCheckedModules.value;

  if (!prevAvailable.size) {
    runCheckedModules.value = new Set(names);
    lastPlanModuleNames.value = names;
    return;
  }

  const next = new Set<string>();
  for (const name of names) {
    if (!prevAvailable.has(name)) next.add(name);
    else if (prevChecked.has(name)) next.add(name);
  }
  runCheckedModules.value = next;
  lastPlanModuleNames.value = names;
}

function toggleRunScopeModule(module: string, checked: boolean) {
  const next = new Set(runCheckedModules.value);
  if (checked) next.add(module);
  else next.delete(module);
  runCheckedModules.value = next;
}

function toggleAllRunScopeModules(checked: boolean) {
  if (checked) {
    runCheckedModules.value = new Set(runScopeModuleNames.value);
    return;
  }
  runCheckedModules.value = new Set();
}

function runModuleFilterOptions(): Pick<UnitTestRunOptions, "include_modules"> | undefined {
  if (!showRunScopeList.value || !runPlan.value?.modules.length) return undefined;
  const allNames = runPlan.value.modules.map((m) => m.module);
  const selected = allNames.filter((m) => runCheckedModules.value.has(m));
  if (!selected.length || selected.length === allNames.length) return undefined;
  return { include_modules: selected };
}

function mergeRunOptions(base?: UnitTestRunOptions): UnitTestRunOptions | undefined {
  const exclude = base?.exclude_cases ?? excludeCaseIdsForFullRun(watchlist.value);
  const includeCases = base?.include_cases;
  const mod = runModuleFilterOptions();
  const opts: UnitTestRunOptions = {};
  if (exclude.length) opts.exclude_cases = exclude;
  if (includeCases?.length) opts.include_cases = includeCases;
  if (mod?.include_modules?.length) opts.include_modules = mod.include_modules;
  return Object.keys(opts).length ? opts : undefined;
}

async function loadRunPlan() {
  if (!showRunScopeList.value) {
    runPlan.value = null;
    runPlanError.value = "";
    return;
  }
  const ids = [...runChecked.value];
  if (!ids.length) {
    runPlan.value = null;
    runPlanError.value = "";
    return;
  }
  runPlanLoading.value = true;
  runPlanError.value = "";
  try {
    runPlan.value = await fetchUnitTestPlan(ids, {
      ...mergeRunOptions(),
      include_case_details: showRunScopeCases.value,
    });
    syncRunCheckedModulesFromPlan(runPlan.value);
    void loadModuleCatalog(runPlan.value.modules.map((m) => m.module));
    if (showRunScopeCases.value) {
      const caseIds = runPlan.value.modules.flatMap((m) => (m.cases ?? []).map((c) => c.id));
      void loadCaseCatalog(caseIds.slice(0, 200));
    }
  } catch (e) {
    runPlanError.value = String(e);
    runPlan.value = null;
  } finally {
    runPlanLoading.value = false;
  }
}

function handleRunStreamEvent(event: UnitTestStreamEvent) {
  if (event.type === "start") {
    currentRunId.value = event.run_id ?? null;
    runProgressIgnored.value = event.ignored_cases ?? 0;
    runProgress.value = {
      suiteLabel: event.suite_label,
      totalModules: event.total_modules,
      totalCases: event.total_cases,
      completedCases: 0,
      moduleIndex: 0,
      moduleTotal: event.total_modules,
      currentModule: "",
      currentSuiteId: "",
      currentCase: "",
      passed: 0,
      failed: 0,
      skipped: 0,
      recentCases: [],
      startedAt: Date.now(),
    };
    if (event.load_errors.length) {
      for (const err of event.load_errors) {
        shell.appendLog(`  ✗ 加载 ${err}`, { source: "unit_tests" });
      }
    }
    return;
  }

  const p = runProgress.value;
  if (!p) return;

  if (event.type === "module_start") {
    p.moduleIndex = event.module_index;
    p.moduleTotal = event.module_total;
    p.currentModule = event.module;
    p.currentSuiteId = event.suite_id;
    p.currentCase = "";
    const suite = suiteLabelById.value.get(event.suite_id) ?? event.suite_id;
    shell.appendLog(`  → [${suite}] ${shortModule(event.module)} (${event.module_index}/${event.module_total})`, {
      source: "unit_tests",
    });
    return;
  }

  if (event.type === "case_start") {
    p.currentModule = event.module;
    p.currentSuiteId = event.suite_id;
    p.currentCase = `${event.class_name}.${event.method}`;
    return;
  }

  if (event.type === "case_done") {
    p.completedCases = event.completed;
    p.currentCase = "";
    const c = event.case;
    if (c.status === "passed") p.passed += 1;
    else if (c.status === "failed" || c.status === "error") p.failed += 1;
    else if (c.status === "skipped") p.skipped += 1;
    p.recentCases = [c, ...p.recentCases].slice(0, 8);
    syncWatchlistFromCase(c);
    if (c.status === "failed" || c.status === "error") {
      shell.appendLog(`  ✗ ${c.method}: ${c.message || c.status}`, { source: "unit_tests" });
    }
    return;
  }

  if (event.type === "module_done") {
    p.currentCase = "";
    const s = event.summary;
    shell.appendLog(
      `  ✓ ${shortModule(event.module)}：${s.passed}/${s.tests_run} 通过`,
      { source: "unit_tests" },
    );
  }
}

async function executeRun(args: {
  suiteIds: string[];
  runOptions?: UnitTestRunOptions;
  logLabel: string;
  lastRunSuiteIds?: string[];
  runMode?: RunMode;
}) {
  running.value = true;
  result.value = null;
  runProgress.value = null;
  expandedCase.value = null;
  currentRunId.value = null;
  activeTab.value = "results";
  shell.appendLog(`[单元测试] 运行 ${args.logLabel}…`, { source: "unit_tests", open: true });
  runAbortController = new AbortController();
  const tickTimer = window.setInterval(() => {
    runTick.value += 1;
  }, 500);
  let cancelled = false;
  try {
    result.value = await runUnitTestsStream(args.suiteIds, handleRunStreamEvent, {
      ...args.runOptions,
      signal: runAbortController.signal,
    });
    cancelled = !!result.value.summary.cancelled;
    recordRunHistoryFromResult(result.value);
    lastRunSuites.value = args.lastRunSuiteIds ?? [...runChecked.value];
    lastIgnoredCount.value = result.value.summary.ignored ?? 0;
    void loadModuleCatalog(result.value.modules.map((m) => m.module));
    resultSuiteChecked.value = new Set(lastRunSuites.value.length ? lastRunSuites.value : RUNNABLE_SUITE_IDS);
    resultStatusChecked.value = new Set(["passed", "failed", "error", "skipped"]);
    filterWatchlistOnly.value = false;
    filterReTestedOnly.value = false;
    const msg = formatRunSummary(result.value);
    shell.appendLog(msg, { source: "unit_tests" });
    shell.setStatus(msg);
    if (!result.value.ok && result.value.failures.length) {
      for (const f of result.value.failures.slice(0, 5)) {
        shell.appendLog(`  ✗ ${f.id}: ${f.message}`, { source: "unit_tests" });
      }
    }
    if (args.runMode === "watchlist") {
      const ids = args.runOptions?.include_cases;
      if (ids?.length) {
        lastReTestedCaseIds.value = new Set(ids);
        filterReTestedOnly.value = true;
      } else {
        filterWatchlistOnly.value = true;
      }
    } else if (result.value.failures.length && !cancelled) {
      activeTab.value = "watchlist";
    }
  } catch (e) {
    const msg = String(e);
    if (msg.includes("终止") || msg.includes("aborted")) {
      shell.appendLog("[单元测试] 运行已终止", { source: "unit_tests" });
      shell.setStatus("运行已终止");
    } else {
      shell.appendLog(msg, { source: "unit_tests" });
      shell.setStatus(msg);
    }
  } finally {
    window.clearInterval(tickTimer);
    runAbortController = null;
    currentRunId.value = null;
    running.value = false;
    runProgress.value = null;
  }
}

async function onRun(mode: RunMode = "full") {
  const ids = [...runChecked.value];
  if (mode === "full" && !ids.length) {
    shell.setStatus("请至少勾选一个要运行的套件");
    return;
  }
  if (mode === "full" && showRunScopeList.value && runPlan.value?.modules.length && !runScopeModuleCheckedCount.value) {
    shell.setStatus("请至少勾选一个要运行的模块");
    return;
  }
  if (mode === "watchlist" && !watchlist.value.length) {
    shell.setStatus("失败关注列表为空");
    return;
  }

  let runOptions: UnitTestRunOptions | undefined;
  let suiteIds = ids;
  let logLabel: string;
  if (mode === "watchlist") {
    runOptions = { include_cases: includeCaseIdsForWatchlistRun(watchlist.value) };
    suiteIds = ids.length ? ids : ["all"];
    logLabel = `全部复测 ${watchlist.value.length} 条`;
  } else {
    runOptions = mergeRunOptions();
    const modCount = runScopeModuleCheckedCount.value;
    const modTotal = runPlan.value?.modules.length ?? 0;
    const suitePart = ids.map((id) => suiteLabelById.value.get(id) ?? id).join(" + ");
    if (showRunScopeList.value && modTotal && modCount < modTotal) {
      logLabel = `${suitePart} · ${modCount}/${modTotal} 模块`;
    } else {
      logLabel = suitePart;
    }
  }

  await executeRun({
    suiteIds,
    runOptions,
    logLabel,
    lastRunSuiteIds: mode === "watchlist" ? [...runChecked.value] : ids,
    runMode: mode,
  });
}

async function onRunWatchlistSelected() {
  if (!watchlistChecked.value.size) {
    shell.setStatus("请勾选用例后再复测");
    return;
  }
  await executeRun({
    suiteIds: ["all"],
    runOptions: { include_cases: [...watchlistChecked.value] },
    logLabel: `复测勾选 ${watchlistChecked.value.size} 条`,
    runMode: "watchlist",
  });
}

async function onRerunWatchlistEntry(entry: UnitTestWatchlistEntry) {
  if (running.value) return;
  rerunningWatchlistId.value = entry.id;
  try {
    await executeRun({
      suiteIds: ["all"],
      runOptions: { include_cases: [entry.id] },
      logLabel: `复测 ${entry.method}`,
      runMode: "watchlist",
    });
  } finally {
    rerunningWatchlistId.value = null;
  }
}

async function onRunSingleModule(mod: UnitTestPlanModule) {
  if (running.value) return;
  rerunningModule.value = mod.module;
  try {
    await executeRun({
      suiteIds: [mod.suite_id],
      runOptions: { include_modules: [mod.module] },
      logLabel: shortModule(mod.module),
      lastRunSuiteIds: [...runChecked.value],
    });
  } finally {
    rerunningModule.value = null;
  }
}

watch(watchlist, () => {
  syncWatchlistChecked();
  void loadCaseCatalog();
  void loadModuleCatalog(watchlist.value.map((e) => e.module));
});

watch(result, (r) => {
  if (!r) return;
  if (!resultSuiteChecked.value.size && lastRunSuites.value.length) {
    resultSuiteChecked.value = new Set(lastRunSuites.value);
  }
});

watch(showRunScopeList, (show) => {
  if (!show) {
    runCheckedModules.value = new Set();
    lastPlanModuleNames.value = [];
  }
});

watch(
  () => [
    [...runChecked.value].sort().join(","),
    showRunScopeList.value,
    showRunScopeCases.value,
    watchlist.value.length,
    watchlistSkipCount.value,
  ],
  () => {
    void loadRunPlan();
  },
);

onMounted(() => {
  pageStore.hydrate();
  moduleHistory.value = loadModuleHistory();
  void loadSuites();
  void loadModuleCatalog();
  watchlist.value = loadWatchlist();
  syncWatchlistChecked();
  void loadCaseCatalog();
  void loadModuleCatalog(watchlist.value.map((e) => e.module));
});
</script>

<template>
  <div class="page tool-page unit-tests-page">
    <PageHeader title="单元测试" page-id="unit_tests">
      <template #actions>
        <div class="toolbar-group">
          <el-button-group size="small">
            <el-button :disabled="running" @click="selectAllRun">全选</el-button>
            <el-button :disabled="running" @click="clearAllRun">清空</el-button>
            <el-button v-if="watchlistCount" :disabled="running" @click="onRun('watchlist')">
              全部复测（{{ watchlistCount }}）
            </el-button>
          </el-button-group>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group toolbar-group-run">
          <el-button
            v-if="running"
            type="danger"
            plain
            size="small"
            data-tour-page-unit-tests-cancel
            @click="cancelRun"
          >
            终止
          </el-button>
          <el-button
            v-else
            type="primary"
            size="small"
            data-tour-page-unit-tests-run
            :disabled="!canRunFull"
            @click="onRun('full')"
          >
            运行（{{ runCheckedCount }}<template v-if="showRunScopeList && runScopeSelectedSummary && runScopeSelectedSummary.modules < runScopeSelectedSummary.totalModules"> · {{ runScopeSelectedSummary.modules }} 模块</template>）
          </el-button>
        </div>
      </template>
    </PageHeader>

    <p v-if="loadError" class="error-text">{{ loadError }}</p>

    <section class="card run-card" data-tour-page-unit-tests-suites>
      <div
        class="run-toolbar"
        :class="{ 'run-toolbar-collapsed': runScopeCollapsed }"
        role="button"
        :aria-expanded="!runScopeCollapsed"
        @click="runScopeCollapsed = !runScopeCollapsed"
      >
        <h2 class="section-label">
          <span class="collapse-arrow">{{ runScopeCollapsed ? '▸' : '▾' }}</span>
          运行范围
        </h2>
        <div class="run-chips" @click.stop>
          <el-checkbox
            v-for="suite in runnableSuites"
            :key="suite.id"
            :model-value="runChecked.has(suite.id)"
            :disabled="running"
            border
            size="small"
            class="suite-chip"
            @change="toggleRunSuite(suite.id, Boolean($event))"
          >
            {{ suite.label }}
            <span class="suite-count">{{ suite.module_count }}</span>
          </el-checkbox>
        </div>
      </div>
      <template v-if="!runScopeCollapsed">
      <div class="run-scope-controls">
        <el-checkbox
          :model-value="showRunScopeList"
          :disabled="running"
          size="small"
          @change="showRunScopeList = Boolean($event)"
        >
          列出运行范围
          <span v-if="runScopeButtonModuleCount" class="suite-count">{{ runScopeButtonModuleCount }}</span>
        </el-checkbox>
        <template v-if="showRunScopeList">
          <el-checkbox v-model="showRunScopeCases" :disabled="running || runPlanLoading">
            展开用例
          </el-checkbox>
        <el-radio-group
          v-if="runPlan?.modules.length"
          :model-value="moduleSortBy"
          size="small"
          :disabled="running"
          @change="onModuleSortChange($event as 'plan' | 'last_run_at' | 'run_count')"
        >
          <el-radio-button value="plan">默认</el-radio-button>
          <el-radio-button value="last_run_at">最近运行</el-radio-button>
          <el-radio-button value="run_count">运行次数</el-radio-button>
        </el-radio-group>
        <span v-if="showRunScopeList && runPlan && !runPlanLoading" class="run-scope-summary muted small">
          {{ runPlan.suite_label }}
          <template v-if="runScopeSelectedSummary && runScopeSelectedSummary.modules < runScopeSelectedSummary.totalModules">
            · 已选 {{ runScopeSelectedSummary.modules }}/{{ runScopeSelectedSummary.totalModules }} 模块
            · {{ runScopeSelectedSummary.cases }} 用例
          </template>
          <template v-else>
            · {{ runPlan.total_modules }} 模块 · {{ runPlan.total_cases }} 用例
          </template>
          <template v-if="runPlan.ignored_cases"> · 将忽略 {{ runPlan.ignored_cases }}</template>
        </span>
        <span v-if="runPlanLoading" class="muted small">加载计划…</span>
        <span v-if="runPlanError" class="error-text small">{{ runPlanError }}</span>
        </template>
      </div>
      <div v-if="showRunScopeList && runPlan?.modules.length" class="run-scope-list">
        <el-table
          :data="sortedRunPlanModules"
          row-key="module"
          size="small"
          stripe
          class="run-scope-table"
          :row-class-name="runScopeRowClass"
        >
          <el-table-column v-if="showRunScopeCases" type="expand" width="36">
            <template #default="{ row }">
              <ul v-if="row.cases?.length" class="run-scope-cases">
                <li v-for="c in row.cases" :key="c.id" class="mono">
                  {{ c.class_name }}.{{ c.method }}
                  <span v-if="caseCatalog[c.id]?.summary" class="case-brief muted">
                    — {{ caseCatalog[c.id]?.summary }}
                  </span>
                </li>
              </ul>
              <span v-else class="muted small">无用例明细</span>
            </template>
          </el-table-column>
          <el-table-column width="44" align="center">
            <template #header>
              <el-checkbox
                :model-value="runScopeModulesAllChecked"
                :disabled="running || !runPlan.modules.length"
                @change="toggleAllRunScopeModules(Boolean($event))"
              />
            </template>
            <template #default="{ row }">
              <el-checkbox
                :model-value="runCheckedModules.has(row.module)"
                :disabled="running"
                @change="toggleRunScopeModule(row.module, Boolean($event))"
              />
            </template>
          </el-table-column>
          <el-table-column label="模块" min-width="168" class-name="mono">
            <template #default="{ row }">{{ shortModule(row.module) }}</template>
          </el-table-column>
          <el-table-column label="简介" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="module-desc-cell">{{ moduleDescriptionBrief(row.module) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="套件" width="72" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ suiteShortLabel(row.suite_id) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="后端" width="66" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.backend === 'vitest'" size="small" type="warning" effect="plain">vitest</el-tag>
              <span v-else class="muted" style="font-size:0.7rem">py</span>
            </template>
          </el-table-column>
          <el-table-column label="用例" width="56" align="center">
            <template #default="{ row }">{{ row.case_count }}</template>
          </el-table-column>
          <el-table-column v-if="showModuleHistoryColumns" label="次数" width="52" align="center">
            <template #default="{ row }">
              <span class="run-count-cell">{{ moduleRunCount(row.module, moduleHistory) || "—" }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showModuleHistoryColumns" label="最近" width="88" align="center">
            <template #default="{ row }">
              <span
                class="run-time-cell"
                :title="moduleLastRunAt(row.module, moduleHistory) ?? undefined"
              >
                {{ formatModuleLastRun(moduleLastRunAt(row.module, moduleHistory)) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="" width="68" align="center" class-name="col-run">
            <template #default="{ row }">
              <el-button
                size="small"
                type="primary"
                plain
                class="module-run-btn"
                :loading="rerunningModule === row.module"
                :disabled="running && rerunningModule !== row.module"
                @click="onRunSingleModule(row)"
              >
                运行
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="running && runProgress" class="run-progress">
        <div class="run-progress-head">
          <span class="run-progress-title">{{ runProgressHeadline }}</span>
          <span class="run-progress-stats">
            {{ runProgress.completedCases }}/{{ runProgress.totalCases || "?" }}
            · {{ runElapsedMs }} ms
          </span>
          <el-button type="danger" plain size="small" @click="cancelRun">终止</el-button>
        </div>
        <div class="progress-bar run-progress-bar">
          <div
            class="progress-pass"
            :style="{ width: `${runProgressPct}%` }"
          />
        </div>
        <div class="run-progress-meta">
          <span>模块 {{ runProgress.moduleIndex }}/{{ runProgress.moduleTotal }}</span>
          <span>通过 {{ runProgress.passed }}</span>
          <span v-if="runProgress.failed">失败 {{ runProgress.failed }}</span>
          <span v-if="runProgress.skipped">跳过 {{ runProgress.skipped }}</span>
          <span v-if="runProgressIgnored">忽略 {{ runProgressIgnored }}</span>
        </div>
        <ul v-if="runProgress.recentCases.length" class="run-progress-recent">
          <li
            v-for="c in runProgress.recentCases"
            :key="c.id"
            :class="statusClass(c.status)"
          >
            <span class="case-status">{{ statusLabel(c.status) }}</span>
            <span class="case-name">{{ c.method }}</span>
            <span class="case-ms">{{ c.duration_ms }} ms</span>
          </li>
        </ul>
      </div>
      <p v-else-if="watchlistSkipCount || result" class="run-foot">
        <span v-if="watchlistSkipCount && !running" class="run-foot-hint">
          全量时将忽略 {{ watchlistSkipCount }} 条关注项
        </span>
        <span v-if="result" class="run-meta">
          {{ result.suite_label }} · {{ result.duration_ms }} ms
          <template v-if="lastIgnoredCount"> · 忽略 {{ lastIgnoredCount }}</template>
        </span>
      </p>
      </template>
    </section>

    <el-radio-group
      v-if="watchlistCount || result"
      v-model="activeTab"
      size="small"
      class="page-tabs"
    >
      <el-radio-button value="results">运行结果</el-radio-button>
      <el-radio-button value="watchlist">
        失败关注
        <span v-if="watchlistCount" class="tab-badge">{{ watchlistCount }}</span>
      </el-radio-button>
    </el-radio-group>

    <section v-if="activeTab === 'watchlist'" class="card watchlist-card">
      <div class="watchlist-head">
        <p class="watchlist-desc muted">
          失败/错误用例记入本机（localStorage），<strong>累计失败次数</strong>；通过不会自动移出，可逐条「移除」或「全部移除」。勾选后点「复测勾选」，或行内「复测」；需跑全部时点「全部复测」。
        </p>
        <div class="watchlist-actions">
          <span v-if="watchlistCount" class="watchlist-stats muted small">
            {{ watchlistCount }} 条 · 累计失败 {{ watchlistTotalFails }} 次
            <template v-if="watchlistCheckedCount"> · 已勾选 {{ watchlistCheckedCount }}</template>
          </span>
          <el-radio-group
            v-if="watchlistCount"
            :model-value="watchlistPrefs.sort_by"
            size="small"
            @change="onWatchlistSortChange($event as 'fail_count' | 'last_seen_at')"
          >
            <el-radio-button value="last_seen_at">最近失败</el-radio-button>
            <el-radio-button value="fail_count">失败次数</el-radio-button>
          </el-radio-group>
          <el-checkbox
            :model-value="watchlistPrefs.default_run_on_full"
            @change="onWatchlistDefaultRunOnFullChange(Boolean($event))"
          >
            新失败默认全量时运行
          </el-checkbox>
          <div class="watchlist-run-actions">
            <el-button
              type="primary"
              size="small"
              :disabled="running || !watchlistCheckedCount"
              @click="onRunWatchlistSelected"
            >
              复测勾选（{{ watchlistCheckedCount }}）
            </el-button>
            <el-button link size="small" :disabled="running || !watchlistCount" @click="onRun('watchlist')">
              全部复测
            </el-button>
            <el-button link size="small" :disabled="running || !watchlistCount" @click="clearAllWatchlist">
              全部移除
            </el-button>
          </div>
        </div>
      </div>
      <p v-if="!watchlistCount" class="muted empty-hint">暂无失败关注；运行测试后失败项会自动出现。</p>
      <div v-else class="watchlist-table-wrap">
        <table class="data-table compact watchlist-table">
          <colgroup>
            <col class="col-check" />
            <col class="col-case" />
            <col class="col-intro" />
            <col class="col-suite" />
            <col class="col-num" />
            <col class="col-time" />
            <col class="col-full" />
            <col class="col-run" />
            <col class="col-action" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-check">
                <el-checkbox
                  :model-value="watchlistAllChecked"
                  :disabled="running || !watchlistCount"
                  @change="toggleAllWatchlistChecked(Boolean($event))"
                />
              </th>
              <th class="col-case">用例</th>
              <th class="col-intro">简介</th>
              <th class="col-suite">套件</th>
              <th class="col-num">累计</th>
              <th class="col-time">最近失败</th>
              <th class="col-full">全量</th>
              <th class="col-run"></th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in sortedWatchlist"
              :key="entry.id"
              class="watchlist-row"
              :class="[
                statusClass(entry.status),
                {
                  'watchlist-row-running': rerunningWatchlistId === entry.id,
                  'watchlist-row-disabled': running && rerunningWatchlistId !== entry.id,
                },
              ]"
            >
              <td class="col-check">
                <el-checkbox
                  :model-value="watchlistChecked.has(entry.id)"
                  :disabled="running"
                  @change="toggleWatchlistChecked(entry.id, Boolean($event))"
                />
              </td>
              <td
                class="mono watchlist-case"
                :title="`${shortModule(entry.module)}\n${entry.message}`"
              >
                <span class="watchlist-method">{{ entry.method }}</span>
                <span class="watchlist-msg">{{ entry.message }}</span>
              </td>
              <td class="watchlist-intro" :title="caseDescription(entry)">
                {{ caseDescriptionBrief(entry) }}
              </td>
              <td class="col-suite" :title="suiteLabelById.get(entry.suite_id) ?? entry.suite_id">
                {{ suiteLabelById.get(entry.suite_id) ?? entry.suite_id }}
              </td>
              <td class="col-num">{{ entry.fail_count }}</td>
              <td class="col-time" :title="entry.last_seen_at">{{ formatWatchlistTime(entry.last_seen_at) }}</td>
              <td class="col-full">
                <el-checkbox
                  :model-value="entry.run_on_full"
                  :disabled="running"
                  @change="onWatchlistRunOnFullChange(entry, Boolean($event))"
                />
              </td>
              <td class="col-run">
                <el-button
                  type="primary"
                  plain
                  size="small"
                  :loading="rerunningWatchlistId === entry.id"
                  :disabled="running && rerunningWatchlistId !== entry.id"
                  @click="onRerunWatchlistEntry(entry)"
                >
                  复测
                </el-button>
              </td>
              <td class="col-action">
                <el-button link size="small" :disabled="running" @click="removeFromWatchlist(entry)">
                  移除
                </el-button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="activeTab === 'results' && result" class="card results-card">
      <div class="stat-cards">
        <div class="stat-card" :class="result.ok ? 'tone-pass' : 'tone-fail'">
          <span class="stat-value">{{ result.ok ? "通过" : "未通过" }}</span>
          <span class="stat-label">结论</span>
        </div>
        <div class="stat-card tone-pass">
          <span class="stat-value">{{ result.summary.passed }}</span>
          <span class="stat-label">通过</span>
        </div>
        <div class="stat-card" :class="result.summary.failed + result.summary.errors > 0 ? 'tone-fail' : ''">
          <span class="stat-value">{{ result.summary.failed + result.summary.errors }}</span>
          <span class="stat-label">失败/错误</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ result.summary.skipped }}</span>
          <span class="stat-label">跳过</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ result.summary.tests_run }}</span>
          <span class="stat-label">合计</span>
        </div>
        <div v-if="result.summary.ignored" class="stat-card">
          <span class="stat-value">{{ result.summary.ignored }}</span>
          <span class="stat-label">忽略</span>
        </div>
        <div class="stat-card tone-rate">
          <span class="stat-value">{{ passRate }}%</span>
          <span class="stat-label">通过率</span>
        </div>
      </div>

      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="progress-pass" :style="{ width: `${passRate}%` }" />
          <div
            class="progress-fail"
            :style="{
              width: `${result.summary.tests_run ? ((result.summary.failed + result.summary.errors) / result.summary.tests_run) * 100 : 0}%`,
            }"
          />
        </div>
      </div>

      <div class="filter-bar">
        <div class="filter-group">
          <span class="filter-label">结果 · 套件</span>
          <div class="filter-chips">
            <el-checkbox
              v-for="id in lastRunSuites"
              :key="id"
              :model-value="resultSuiteChecked.has(id)"
              border
              size="small"
              @change="toggleResultSuite(id, Boolean($event))"
            >
              {{ suiteLabelById.get(id) ?? id }}
            </el-checkbox>
            <el-button link size="small" @click="selectAllResultSuites">全选</el-button>
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">结果 · 状态</span>
          <div class="filter-chips">
            <el-checkbox
              v-for="opt in STATUS_FILTER_OPTIONS"
              :key="opt.id"
              :model-value="resultStatusChecked.has(opt.id)"
              border
              size="small"
              @change="toggleResultStatus(opt.id, Boolean($event))"
            >
              {{ opt.label }}
            </el-checkbox>
            <el-button link size="small" @click="selectOnlyFailedResults">仅失败</el-button>
            <el-button v-if="watchlistCount" link size="small" @click="filterResultsToWatchlist">
              仅关注项
            </el-button>
            <el-button v-if="lastReTestedCaseIds.size" link size="small" @click="filterResultsToReTested">
              仅复测项
            </el-button>
          </div>
        </div>
        <span class="count">
          显示 <strong>{{ filteredCases.length }}</strong> / {{ result.cases.length }} 条用例
          <template v-if="filterReTestedOnly">（已筛复测项）</template>
          <template v-if="filterWatchlistOnly && !filterReTestedOnly">（已筛关注）</template>
          <template v-if="lastIgnoredCount"> · 本次忽略 {{ lastIgnoredCount }} 条</template>
        </span>
      </div>

      <div v-if="filteredModuleSummaries.length" class="module-summary">
        <h3 class="subsection-title">按模块</h3>
        <table class="data-table compact">
          <thead>
            <tr>
              <th>模块</th>
              <th>简介</th>
              <th>套件</th>
              <th>通过</th>
              <th>失败</th>
              <th>错误</th>
              <th>跳过</th>
              <th>合计</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in filteredModuleSummaries" :key="m.module">
              <td class="mono">{{ shortModule(m.module) }}</td>
              <td class="module-desc" :title="moduleDescription(m.module)">
                {{ moduleDescriptionBrief(m.module) }}
              </td>
              <td>{{ suiteLabelById.get(classifyModule(m.module)) ?? "—" }}</td>
              <td>{{ m.passed }}</td>
              <td>{{ m.failed }}</td>
              <td>{{ m.errors }}</td>
              <td>{{ m.skipped }}</td>
              <td>{{ m.tests_run }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="cases-panel">
        <h3 class="subsection-title">用例明细</h3>
        <p v-if="!filteredCases.length" class="muted empty-hint">当前筛选无匹配用例，请调整上方勾选。</p>
        <div v-for="[mod, cases] in groupedModules" :key="mod" class="module-group">
          <div class="module-group-head">
            <div class="module-group-title">
              <span class="mono">{{ shortModule(mod) }}</span>
              <span v-if="moduleDescription(mod)" class="module-group-desc">
                {{ moduleDescriptionBrief(mod, 64) }}
              </span>
            </div>
            <span class="module-suite-tag">{{ suiteLabelById.get(cases[0]?.suite_id ?? "") }}</span>
          </div>
          <ul class="case-list">
            <li v-for="c in cases" :key="c.id" class="case-item" :class="statusClass(c.status)">
              <button type="button" class="case-head" @click="toggleCase(c.id)">
                <span class="case-status">{{ statusLabel(c.status) }}</span>
                <span class="case-name">{{ c.class_name }}.{{ c.method }}</span>
                <span class="case-ms">{{ c.duration_ms }} ms</span>
              </button>
              <pre
                v-if="expandedCase === c.id && (c.message || c.traceback)"
                class="case-detail"
              >{{ c.message }}{{ c.traceback ? "\n" + c.traceback : "" }}</pre>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <p v-else-if="!running && activeTab === 'results'" class="muted hint compact-hint">
      勾选套件后点「运行」；失败项会进入「失败关注」Tab。
    </p>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.unit-tests-page code {
  font-size: 0.85em;
}

.card {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.run-card {
  padding: 8px 12px;
}

.run-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.run-chips {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.suite-chip :deep(.el-checkbox__label) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.scope-list-btn :deep(.el-checkbox__label) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.suite-chip-inline {
  gap: 4px;
}

.suite-count {
  font-size: 0.7rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.suite-chip-inline:has(input:checked) .suite-count,
.suite-chip-inline.checked .suite-count {
  color: #64748b;
}

.run-scope-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.scope-toggle {
  cursor: pointer;
}

.scope-list-btn {
  cursor: pointer;
}

.run-scope-sort {
  gap: 4px;
}

.run-scope-sort-label {
  margin-right: 2px;
}

.run-scope-list {
  margin-top: 8px;
  max-height: min(40vh, 320px);
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter, var(--border));
  border-radius: 6px;
}

.run-scope-table {
  width: 100%;
}

.run-scope-table :deep(.el-table__header th) {
  font-size: 0.76rem;
}

.run-scope-table :deep(.mono) {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.run-scope-table :deep(.run-scope-row-off) {
  opacity: 0.55;
}

.run-scope-table :deep(.run-scope-row-off td) {
  background: transparent;
}

.module-desc-cell {
  font-size: 0.76rem;
  color: var(--muted);
}

.run-count-cell,
.run-time-cell {
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.run-scope-table :deep(.col-run .cell) {
  padding-left: 4px;
  padding-right: 4px;
}

.module-run-btn {
  min-width: 44px;
  padding-left: 10px;
  padding-right: 10px;
}

.run-scope-cases {
  margin: 0;
  padding: 4px 12px 8px 28px;
  font-size: 0.78rem;
  line-height: 1.45;
}

.run-scope-cases .case-brief {
  font-family: inherit;
}

.run-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 4px 0 0;
  font-size: 0.72rem;
  color: var(--muted);
}

.run-foot-hint::after {
  content: "·";
  margin-left: 10px;
  color: #cbd5e1;
}

.run-foot-hint:only-child::after {
  content: none;
}

.run-progress {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.run-progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.run-progress-title {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-progress-stats {
  flex-shrink: 0;
  font-size: 0.72rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.run-progress-bar {
  height: 6px;
  margin-bottom: 6px;
}

.run-progress-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.72rem;
  color: var(--muted);
}

.run-progress-recent {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: 140px;
  overflow-y: auto;
}

.run-progress-recent li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-top: 1px solid var(--border);
  font-size: 0.72rem;
}

.run-progress-recent li:first-child {
  border-top: none;
}

.run-meta {
  font-size: 0.72rem;
  color: var(--muted);
}

.btn-sm {
  padding: 4px 12px;
  font-size: 0.78rem;
}

.btn-cancel {
  border: 1px solid #fca5a5;
  background: #fef2f2;
  color: #b91c1c;
}

.btn-cancel:hover {
  background: #fee2e2;
}

.run-progress-head .btn-cancel {
  flex-shrink: 0;
  align-self: center;
}

.compact-hint {
  margin: 0;
  font-size: 0.78rem;
}

.page-tabs {
  margin: 0 0 0;
  flex-shrink: 0;
}

.page-tabs + .card {
  margin-top: 8px;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.watchlist-card {
  padding: 10px 12px;
}

.watchlist-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 12px;
  margin-bottom: 10px;
}

.watchlist-desc {
  flex: 1;
  min-width: 220px;
  margin: 0;
  font-size: 0.76rem;
}

.watchlist-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.watchlist-run-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.watchlist-run-actions .link-btn {
  font-size: 0.76rem;
}

.watchlist-stats {
  font-variant-numeric: tabular-nums;
}

.watchlist-pref {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.74rem;
  color: var(--muted);
}

.tab-badge {
  margin-left: 4px;
  min-width: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #64748b;
  font-size: 0.68rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.45;
  vertical-align: middle;
}

.watchlist-table-wrap {
  overflow-x: auto;
  max-width: 100%;
}

.watchlist-table {
  table-layout: fixed;
  width: 100%;
  min-width: 680px;
}

.watchlist-table col.col-check {
  width: 36px;
}

.watchlist-table col.col-case {
  width: 24%;
}

.watchlist-table col.col-intro {
  width: 32%;
}

.watchlist-table col.col-suite {
  width: 72px;
}

.watchlist-table col.col-num {
  width: 40px;
}

.watchlist-table col.col-time {
  width: 88px;
}

.watchlist-table col.col-full {
  width: 44px;
}

.watchlist-table col.col-run {
  width: 52px;
}

.watchlist-table col.col-action {
  width: 44px;
}

.watchlist-table th,
.watchlist-table td {
  overflow: hidden;
  vertical-align: middle;
}

.watchlist-table .col-num,
.watchlist-table td.col-num {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.watchlist-table .col-time,
.watchlist-table td.col-time {
  white-space: nowrap;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.watchlist-table .col-check,
.watchlist-table td.col-check {
  text-align: center;
}

.watchlist-table .col-suite,
.watchlist-table td.col-suite {
  font-size: 0.72rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.watchlist-table .col-full,
.watchlist-table td.col-full {
  text-align: center;
}

.watchlist-table .col-run,
.watchlist-table td.col-run {
  text-align: center;
}

.watchlist-table .col-action,
.watchlist-table td.col-action {
  text-align: center;
  white-space: nowrap;
}

.watchlist-table th.col-full,
.watchlist-table th.col-time {
  font-size: 0.72rem;
  white-space: nowrap;
}

.watchlist-run-btn {
  min-width: 44px;
  padding: 2px 10px;
  border: 1px solid #93c5fd;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.72rem;
  line-height: 1.4;
  cursor: pointer;
}

.watchlist-run-btn:hover:not(:disabled) {
  background: #dbeafe;
}

.watchlist-run-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.watchlist-row {
  /* 行本身不再可点 */
}

.watchlist-row:hover {
  background: transparent;
}

.watchlist-row-running {
  background: #eff6ff;
}

.watchlist-row-disabled {
  opacity: 0.65;
}

.watchlist-table .watchlist-case {
  max-width: 0;
}

.watchlist-method {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
}

.watchlist-table .watchlist-intro {
  max-width: 0;
  font-size: 0.72rem;
  color: #475569;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.watchlist-msg {
  display: block;
  margin-top: 2px;
  font-size: 0.68rem;
  font-weight: 400;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-label {
  margin: 0;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--muted);
  white-space: nowrap;
}

.subsection-title {
  margin: 0 0 8px;
  font-size: 0.88rem;
  font-weight: 600;
}

.option-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #f8fafc;
  font-size: 0.76rem;
  cursor: pointer;
  user-select: none;
}

.opt-chip:has(input:checked),
.opt-chip.checked {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

.filter-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.filter-label {
  flex-shrink: 0;
  min-width: 72px;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--muted);
}

.link-btn.mini {
  font-size: 0.72rem;
  padding: 2px 6px;
}

.count {
  font-size: 0.78rem;
  color: var(--muted);
}

.stat-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 72px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stat-label {
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--muted);
}

.stat-card.tone-pass .stat-value {
  color: #15803d;
}

.stat-card.tone-fail .stat-value {
  color: #b91c1c;
}

.stat-card.tone-rate .stat-value {
  color: #1d4ed8;
}

.progress-wrap {
  margin-bottom: 14px;
}

.progress-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: #e5e7eb;
}

.progress-pass {
  background: #22c55e;
  transition: width 0.3s ease;
}

.progress-fail {
  background: #ef4444;
  transition: width 0.3s ease;
}

.module-summary {
  margin-bottom: 16px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.data-table th,
.data-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
}

.data-table th {
  background: #f9fafb;
  font-weight: 600;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.module-group {
  margin-bottom: 12px;
}

.module-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: #f3f4f6;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  font-size: 0.78rem;
  font-weight: 600;
}

.module-group-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.module-group-desc {
  font-size: 0.72rem;
  font-weight: 400;
  color: var(--muted);
}

.module-desc {
  max-width: 280px;
  font-size: 0.76rem;
  color: var(--muted);
  line-height: 1.35;
}

.module-suite-tag {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--muted);
}

.case-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 0 0 6px 6px;
}

.case-item {
  border-top: 1px solid var(--border);
}

.case-item:first-child {
  border-top: none;
}

.case-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: 0.82rem;
}

.case-head:hover {
  background: #f9fafb;
}

.case-status {
  flex-shrink: 0;
  min-width: 36px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-passed .case-status {
  color: #15803d;
}

.status-failed .case-status,
.status-error .case-status {
  color: #b91c1c;
}

.status-skipped .case-status {
  color: #a16207;
}

.case-name {
  flex: 1;
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.case-ms {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.case-detail {
  margin: 0;
  padding: 8px 10px 10px;
  background: #fef2f2;
  border-top: 1px solid #fecaca;
  font-size: 0.72rem;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.hint,
.empty-hint {
  font-size: 0.85rem;
}

.error-text {
  color: #b91c1c;
  font-size: 0.85rem;
}
</style>
