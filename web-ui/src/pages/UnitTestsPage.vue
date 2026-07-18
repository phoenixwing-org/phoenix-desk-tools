<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchTestModuleCatalog,
  fetchTestCaseCatalog,
  fetchUnitTestSuites,
  type TestModuleCatalogEntry,
  type TestCaseCatalogEntry,
  type UnitTestPlan,
  type UnitTestCaseResult,
  type UnitTestRunOptions,
  type UnitTestRunResult,
  type UnitTestSuiteInfo,
} from "../api";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import UnitTestRunScopePane from "../components/unit-tests/UnitTestRunScopePane.vue";
import { useUnitTestsPropertySheet } from "../composables/useUnitTestsPropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";
import {
  useUnitTestRunController,
  type UnitTestRunMode as RunMode,
  type UnitTestRunRequest,
} from "../composables/useUnitTestRunController";
import {
  useUnitTestPlanController,
  type UnitTestPlanRequest,
} from "../composables/useUnitTestPlanController";
import { pnwPromptChoice } from "phoenix-wing";
import { useAppShell } from "../composables/useAppShell";
import {
  UNIT_TEST_RUNNABLE_SUITE_IDS,
  useUnitTestsPageStore,
  type UnitTestsPageTab,
} from "../stores/unitTestsPage";
import {
  clearWatchlist,
  excludeCaseIdsForFullRun,
  loadWatchlist,
  recordWatchlistFailure,
  removeWatchlistEntry,
  setWatchlistRunOnFull,
  sortWatchlistEntries,
  watchlistTotalFailCount,
  type UnitTestWatchlistEntry,
} from "../utils/unitTestWatchlist";
import {
  loadModuleHistory,
  recordModuleRuns,
  sortPlanModules,
  type ModuleHistoryMap,
} from "../utils/unitTestModuleHistory";
import {
  canRunUnitTestFull,
  deriveUnitTestModuleFilter,
  deriveUnitTestRunScopeSelection,
  filterUnitTestCases,
  filterUnitTestModuleSummaries,
  groupUnitTestCasesByModule,
  mergeUnitTestRunOptions,
  projectUnitTestRunScopeRows,
  syncUnitTestCheckedModules,
  unitTestModuleDescription,
  unitTestModuleDescriptionBrief,
  unitTestPassRate,
  unitTestShortModule as shortModule,
  unitTestStatusClass as statusClass,
  unitTestStatusLabel as statusLabel,
  type UnitTestRunScopeRowView,
} from "../models/unitTestsViewModel";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const pageStore = useUnitTestsPageStore();

type PageTab = UnitTestsPageTab;

const RUNNABLE_SUITE_IDS = UNIT_TEST_RUNNABLE_SUITE_IDS;

const STATUS_FILTER_OPTIONS = [
  { id: "passed", label: "通过" },
  { id: "failed", label: "失败" },
  { id: "error", label: "错误" },
  { id: "skipped", label: "跳过" },
] as const;

const suites = ref<UnitTestSuiteInfo[]>([]);
const loadError = ref("");
const lastRunSuites = ref<string[]>([]);
const resultSuiteChecked = ref<Set<string>>(new Set());
const resultStatusChecked = ref<Set<string>>(new Set(["passed", "failed", "error", "skipped"]));
const expandedCase = ref<string | null>(null);
const moduleCatalog = ref<Record<string, TestModuleCatalogEntry>>({});
const caseCatalog = ref<Record<string, TestCaseCatalogEntry>>({});
const watchlist = ref<UnitTestWatchlistEntry[]>(loadWatchlist());
const filterWatchlistOnly = ref(false);
const filterReTestedOnly = ref(false);
const lastReTestedCaseIds = ref<Set<string>>(new Set());
const lastIgnoredCount = ref(0);
const rerunningWatchlistId = ref<string | null>(null);
const rerunningModule = ref<string | null>(null);
const moduleHistory = ref<ModuleHistoryMap>(loadModuleHistory());

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

const runController = useUnitTestRunController({
  onCaseDone: syncWatchlistFromCase,
  onCompleted: syncCompletedRun,
});
const { running, result } = runController;

const planController = useUnitTestPlanController({
  onAccepted: syncAcceptedPlan,
});
const {
  plan: runPlan,
  loading: runPlanLoading,
  error: runPlanError,
} = planController;

useUnitTestsPropertySheet("unit_tests", {
  runCheckedCount,
  runnableSuiteCount: computed(() => RUNNABLE_SUITE_IDS.length),
  activeTab,
  running,
  result,
});

const runCheckedModules = ref<Set<string>>(new Set());
const lastPlanModuleNames = ref<string[]>([]);

const runnableSuites = computed(() =>
  suites.value.filter((s) => RUNNABLE_SUITE_IDS.includes(s.id as (typeof RUNNABLE_SUITE_IDS)[number])),
);

const watchlistCount = computed(() => watchlist.value.length);
const watchlistTotalFails = computed(() => watchlistTotalFailCount(watchlist.value));
const watchlistSkipCount = computed(() => watchlist.value.filter((e) => !e.run_on_full).length);
const fullRunExcludedCaseSignature = computed(() =>
  excludeCaseIdsForFullRun(watchlist.value).slice().sort().join("\u0000"),
);
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

const runScopeModuleCheckedCount = computed(() =>
  runScopeModuleNames.value.filter((m) => runCheckedModules.value.has(m)).length,
);

const runScopeSelectedSummary = computed(() => {
  return deriveUnitTestRunScopeSelection(runPlan.value, runCheckedModules.value);
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
  return canRunUnitTestFull({
    checkedSuiteCount: runCheckedCount.value,
    showRunScopeList: showRunScopeList.value,
    planLoading: runPlanLoading.value,
    planError: runPlanError.value,
    planReady: !!runPlan.value,
    planModuleCount: runPlan.value?.modules.length ?? 0,
    checkedModuleCount: runScopeModuleCheckedCount.value,
  });
});

const passRate = computed(() => unitTestPassRate(result.value?.summary));

const suiteLabelById = computed(() => {
  const map = new Map<string, string>();
  for (const s of suites.value) map.set(s.id, s.label);
  return map;
});

const runScopeRows = computed(() => projectUnitTestRunScopeRows(
  sortedRunPlanModules.value,
  runCheckedModules.value,
  moduleCatalog.value,
  caseCatalog.value,
  moduleHistory.value,
  suiteLabelById.value,
));

const filteredCases = computed(() => {
  return filterUnitTestCases(result.value?.cases ?? [], {
    suiteIds: resultSuiteChecked.value,
    statuses: resultStatusChecked.value,
    watchlistOnly: filterWatchlistOnly.value,
    reTestedOnly: filterReTestedOnly.value,
    watchlistIds: watchlistIdSet.value,
    reTestedIds: lastReTestedCaseIds.value,
  });
});

const filteredModuleSummaries = computed(() => {
  return filterUnitTestModuleSummaries(result.value?.modules ?? [], filteredCases.value);
});

const groupedModules = computed(() => groupUnitTestCasesByModule(filteredCases.value));

function moduleDescription(module: string): string {
  return unitTestModuleDescription(moduleCatalog.value, module);
}

function moduleDescriptionBrief(module: string, maxLen = 48): string {
  return unitTestModuleDescriptionBrief(moduleCatalog.value, module, maxLen);
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

function moduleSuiteId(module: string): string {
  return result.value?.cases.find((testCase) => testCase.module === module)?.suite_id
    ?? runPlan.value?.modules.find((item) => item.module === module)?.suite_id
    ?? "";
}

function onModuleSortChange(sortBy: "plan" | "last_run_at" | "run_count") {
  pageStore.setModuleSortBy(sortBy);
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

function cancelRun() {
  runController.cancel();
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
  const result = await pnwPromptChoice({
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
  const result = await pnwPromptChoice({
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
    const data = await fetchUnitTestSuites();
    suites.value = data.suites;
    void loadRunPlan();
  } catch (e) {
    loadError.value = String(e);
    suites.value = [];
  }
}

function syncRunCheckedModulesFromPlan(plan: UnitTestPlan) {
  const names = plan.modules.map((m) => m.module);
  const synced = syncUnitTestCheckedModules(
    names,
    lastPlanModuleNames.value,
    runCheckedModules.value,
  );
  runCheckedModules.value = new Set(synced.checked);
  lastPlanModuleNames.value = [...synced.available];
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
  return deriveUnitTestModuleFilter(
    showRunScopeList.value,
    runPlan.value?.modules.map((module) => module.module) ?? [],
    runCheckedModules.value,
  );
}

function mergeRunOptions(base?: UnitTestRunOptions): UnitTestRunOptions | undefined {
  return mergeUnitTestRunOptions(
    base,
    excludeCaseIdsForFullRun(watchlist.value),
    runModuleFilterOptions(),
  );
}

async function loadRunPlan() {
  if (!showRunScopeList.value) {
    planController.clear();
    return;
  }
  const ids = [...runChecked.value];
  if (!ids.length) {
    planController.clear();
    return;
  }

  await planController.load({
    suiteIds: ids,
    excludeCaseIds: excludeCaseIdsForFullRun(watchlist.value),
    includeCaseDetails: showRunScopeCases.value,
  });
}

function syncAcceptedPlan(accepted: UnitTestPlan, request: UnitTestPlanRequest) {
  syncRunCheckedModulesFromPlan(accepted);
  void loadModuleCatalog(accepted.modules.map((module) => module.module));
  if (request.includeCaseDetails) {
    const caseIds = accepted.modules.flatMap((module) =>
      (module.cases ?? []).map((testCase) => testCase.id));
    void loadCaseCatalog(caseIds.slice(0, 200));
  }
}

function syncCompletedRun(completed: UnitTestRunResult, request: UnitTestRunRequest) {
  const cancelled = !!completed.summary.cancelled;
  recordRunHistoryFromResult(completed);
  lastRunSuites.value = request.lastRunSuiteIds ?? [...runChecked.value];
  lastIgnoredCount.value = completed.summary.ignored ?? 0;
  void loadModuleCatalog(completed.modules.map((module) => module.module));
  resultSuiteChecked.value = new Set(
    lastRunSuites.value.length ? lastRunSuites.value : RUNNABLE_SUITE_IDS,
  );
  resultStatusChecked.value = new Set(["passed", "failed", "error", "skipped"]);
  filterWatchlistOnly.value = false;
  filterReTestedOnly.value = false;
  if (request.runMode === "watchlist") {
    const ids = request.runOptions?.include_cases;
    if (ids?.length) {
      lastReTestedCaseIds.value = new Set(ids);
      filterReTestedOnly.value = true;
    } else {
      filterWatchlistOnly.value = true;
    }
  } else if (completed.failures.length && !cancelled) {
    activeTab.value = "watchlist";
  }
}

async function executeRun(request: UnitTestRunRequest) {
  expandedCase.value = null;
  activeTab.value = "results";
  await runController.execute(request);
}

async function onRun(mode: RunMode = "full") {
  const ids = [...runChecked.value];
  if (mode === "full" && !ids.length) {
    shell.setStatus("请至少勾选一个要运行的套件");
    return;
  }
  if (mode === "full" && showRunScopeList.value) {
    if (runPlanLoading.value) {
      shell.setStatus("运行计划仍在加载，请稍候");
      return;
    }
    if (runPlanError.value) {
      shell.setStatus("运行计划加载失败，请切换范围重试或关闭模块范围");
      return;
    }
    const scopePlan = runPlan.value;
    if (!scopePlan) {
      shell.setStatus("运行计划尚未就绪，请稍候或关闭模块范围");
      return;
    }
    if (!scopePlan.modules.length) {
      shell.setStatus("当前运行计划没有可执行模块");
      return;
    }
    if (!runScopeModuleCheckedCount.value) {
      shell.setStatus("请至少勾选一个要运行的模块");
      return;
    }
  }
  if (mode === "watchlist" && !watchlist.value.length) {
    shell.setStatus("失败关注列表为空");
    return;
  }
  if (mode === "watchlist" && !watchlistCheckedCount.value) {
    shell.setStatus("请至少勾选一条用例后再复测");
    return;
  }

  let runOptions: UnitTestRunOptions | undefined;
  let suiteIds = ids;
  let logLabel: string;
  if (mode === "watchlist") {
    const targetIds = watchlistCheckedCount.value
      ? [...watchlistChecked.value]
      : watchlist.value.map((e) => e.id);
    runOptions = { include_cases: targetIds };
    suiteIds = ids.length ? ids : ["all"];
    logLabel = `全部复测 ${targetIds.length} 条`;
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

async function onRunSingleModule(mod: UnitTestRunScopeRowView) {
  if (running.value || runPlanLoading.value) return;
  rerunningModule.value = mod.module;
  try {
    await executeRun({
      suiteIds: [mod.suiteId],
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
    fullRunExcludedCaseSignature.value,
  ],
  () => {
    void loadRunPlan();
  },
);

usePagePrimaryContribution("unit_tests", props.workbenchTabId, {
  summary: computed(() => {
    if (running.value) return "单元测试正在运行";
    const summary = result.value?.summary;
    if (!summary) return `已选择 ${runCheckedCount.value} 个测试套件`;
    return `通过 ${summary.passed}/${summary.tests_run} · 失败 ${summary.failed} · 错误 ${summary.errors}`;
  }),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "suites",
      title: "运行范围",
      description: "选择测试套件；需要更精细范围时展开模块计划。",
      controls: [
        ...runnableSuites.value.map((suite) => ({
          id: `suite-${suite.id}`,
          kind: "boolean" as const,
          label: suite.label,
          description: `${suite.module_count} 个模块 · ${suite.description}`,
          disabled: running,
          modelValue: computed(() => runChecked.value.has(suite.id)),
          onUpdate: (checked: boolean) => toggleRunSuite(suite.id, checked),
        })),
        {
          id: "module-plan",
          kind: "boolean",
          label: "按模块选择",
          modelValue: showRunScopeList,
          disabled: running,
          onUpdate: (checked) => { showRunScopeList.value = checked; },
        },
        {
          id: "case-details",
          kind: "boolean",
          label: "加载用例明细",
          modelValue: showRunScopeCases,
          disabled: computed(() => running.value || !showRunScopeList.value),
          onUpdate: (checked) => { showRunScopeCases.value = checked; },
        },
        {
          id: "suite-count",
          kind: "readonly",
          label: "已选套件",
          value: runCheckedCount,
        },
        {
          id: "module-count",
          kind: "readonly",
          label: "已选模块",
          value: computed(() => runScopeSelectedSummary.value
            ? `${runScopeSelectedSummary.value.modules}/${runScopeSelectedSummary.value.totalModules}`
            : "全部"),
        },
      ],
      actions: [
        { id: "all", label: "全选", disabled: running, run: selectAllRun },
        { id: "clear", label: "清空", disabled: running, run: clearAllRun },
        {
          id: "run",
          label: computed(() => `运行（${runCheckedCount.value}）`),
          tone: "primary",
          disabled: computed(() => running.value || !canRunFull.value),
          run: () => onRun("full"),
        },
        {
          id: "cancel",
          label: "终止",
          tone: "danger",
          plain: true,
          disabled: computed(() => !running.value),
          run: cancelRun,
        },
      ],
    },
    {
      id: "results",
      title: "结果 View",
      controls: [
        {
          id: "active-view",
          kind: "choice",
          label: "中央内容",
          modelValue: activeTab,
          options: [
            { value: "results", label: "测试结果" },
            { value: "watchlist", label: `失败关注（${watchlistCount.value}）` },
          ],
          onUpdate: (value) => { activeTab.value = value === "watchlist" ? "watchlist" : "results"; },
        },
        { id: "watch-count", kind: "readonly", label: "关注用例", value: watchlistCount },
        { id: "watch-fails", kind: "readonly", label: "累计失败", value: watchlistTotalFails },
      ],
      actions: [
        {
          id: "rerun",
          label: computed(() => `复测勾选（${watchlistCheckedCount.value}）`),
          disabled: computed(() => running.value || !watchlistCheckedCount.value),
          run: onRunWatchlistSelected,
        },
      ],
    },
  ]),
});

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

    <UnitTestRunScopePane
      v-model:show-module-list="showRunScopeList"
      v-model:show-case-details="showRunScopeCases"
      :module-sort-by="moduleSortBy"
      :runnable-suites="runnableSuites"
      :checked-suite-ids="runChecked"
      :running="running"
      :module-count-label="runScopeButtonModuleCount"
      :plan="runPlan"
      :plan-loading="runPlanLoading"
      :plan-error="runPlanError"
      :rows="runScopeRows"
      :rerunning-module="rerunningModule"
      @update:module-sort-by="onModuleSortChange"
      @suite-change="toggleRunSuite"
      @all-modules-change="toggleAllRunScopeModules"
      @module-change="toggleRunScopeModule"
      @run-module="onRunSingleModule"
    >
      <template #footer>
        <p v-if="watchlistSkipCount || result" class="run-foot">
          <span v-if="watchlistSkipCount && !running" class="run-foot-hint">
            全量时将忽略 {{ watchlistSkipCount }} 条关注项
          </span>
          <span v-if="result" class="run-meta">
            {{ result.suite_label }} · {{ result.duration_ms }} ms
            <template v-if="lastIgnoredCount"> · 忽略 {{ lastIgnoredCount }}</template>
          </span>
        </p>
      </template>
    </UnitTestRunScopePane>

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
              <td>{{ suiteLabelById.get(moduleSuiteId(m.module)) ?? "—" }}</td>
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
