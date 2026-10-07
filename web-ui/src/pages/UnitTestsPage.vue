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
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import UnitTestRunScopePane from "../components/unit-tests/UnitTestRunScopePane.vue";
import UnitTestWatchlistPane from "../components/unit-tests/UnitTestWatchlistPane.vue";
import UnitTestResultPane from "../components/unit-tests/UnitTestResultPane.vue";
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
  mergeUnitTestRunOptions,
  projectUnitTestRunScopeRows,
  projectUnitTestWatchlistRows,
  syncUnitTestCheckedModules,
  unitTestPassRate,
  unitTestShortModule as shortModule,
  type UnitTestRunScopeRowView,
  type UnitTestWatchlistRowView,
} from "../models/unitTestsViewModel";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const pageStore = useUnitTestsPageStore();

type PageTab = UnitTestsPageTab;

const RUNNABLE_SUITE_IDS = UNIT_TEST_RUNNABLE_SUITE_IDS;

const suites = ref<UnitTestSuiteInfo[]>([]);
const loadError = ref("");
const lastRunSuites = ref<string[]>([]);
const resultSuiteChecked = ref<Set<string>>(new Set());
const resultStatusChecked = ref<Set<string>>(new Set(["passed", "failed", "error", "skipped"]));
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

const watchlistRows = computed(() => projectUnitTestWatchlistRows(
  sortedWatchlist.value,
  watchlistChecked.value,
  caseCatalog.value,
  moduleCatalog.value,
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

function onWatchlistRunOnFullChange(id: string, checked: boolean) {
  watchlist.value = setWatchlistRunOnFull(id, checked);
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

async function removeFromWatchlist(row: UnitTestWatchlistRowView) {
  const result = await pnwPromptChoice({
    title: "移出关注列表",
    message: `${row.method}\n累计失败 ${row.failCount} 次`,
    choices: [
      { id: "remove", label: "移出", variant: "danger" },
      { id: "cancel", label: "取消" },
    ],
    defaultChoiceId: "cancel",
  });
  if (result.choiceId !== "remove") return;
  watchlist.value = removeWatchlistEntry(row.id);
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

async function onRerunWatchlistEntry(row: UnitTestWatchlistRowView) {
  if (running.value) return;
  rerunningWatchlistId.value = row.id;
  try {
    await executeRun({
      suiteIds: ["all"],
      runOptions: { include_cases: [row.id] },
      logLabel: `复测 ${row.method}`,
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
  <PageLayout title="单元测试" class="desk-page-layout" :body-inset="false">
    <template #header>
      <PageHeader title="单元测试">
        <template #right>
          <div class="toolbar-group">
            <el-button-group size="small">
              <el-button :disabled="running" @click="selectAllRun">全选</el-button>
              <el-button :disabled="running" @click="clearAllRun">清空</el-button>
              <el-button v-if="watchlistCount" :disabled="running" @click="onRun('watchlist')">
                全部复测（{{ watchlistCount }}）
              </el-button>
            </el-button-group>
          </div>
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
    </template>
    <PageMainBlock class="tool-page unit-tests-page">

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

      <UnitTestWatchlistPane
        v-if="activeTab === 'watchlist'"
        :rows="watchlistRows"
        :running="running"
        :sort-by="watchlistPrefs.sort_by"
        :default-run-on-full="watchlistPrefs.default_run_on_full"
        :rerunning-id="rerunningWatchlistId"
        @sort="onWatchlistSortChange"
        @default-run-on-full="onWatchlistDefaultRunOnFullChange"
        @all-checked="toggleAllWatchlistChecked"
        @checked="toggleWatchlistChecked"
        @run-on-full="onWatchlistRunOnFullChange"
        @run-selected="onRunWatchlistSelected"
        @run-watchlist="onRun('watchlist')"
        @rerun="onRerunWatchlistEntry"
        @remove-request="removeFromWatchlist"
        @clear-request="clearAllWatchlist"
      />

      <UnitTestResultPane
        v-if="activeTab === 'results' && result"
        :result="result"
        :pass-rate="passRate"
        :last-run-suites="lastRunSuites"
        :suite-label-by-id="suiteLabelById"
        :result-suite-checked="resultSuiteChecked"
        :result-status-checked="resultStatusChecked"
        :filtered-cases="filteredCases"
        :filtered-module-summaries="filteredModuleSummaries"
        :module-catalog="moduleCatalog"
        :watchlist-count="watchlistCount"
        :re-tested-count="lastReTestedCaseIds.size"
        :filter-watchlist-only="filterWatchlistOnly"
        :filter-re-tested-only="filterReTestedOnly"
        :last-ignored-count="lastIgnoredCount"
        @suite-change="toggleResultSuite"
        @status-change="toggleResultStatus"
        @select-all-suites="selectAllResultSuites"
        @select-only-failed="selectOnlyFailedResults"
        @filter-watchlist="filterResultsToWatchlist"
        @filter-re-tested="filterResultsToReTested"
      />

      <p v-else-if="!running && activeTab === 'results'" class="muted hint compact-hint">
        勾选套件后点「运行」；失败项会进入「失败关注」Tab。
      </p>
    </PageMainBlock>
  </PageLayout>
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

.hint,
.empty-hint {
  font-size: 0.85rem;
}

.error-text {
  color: #b91c1c;
  font-size: 0.85rem;
}
</style>
