<script setup lang="ts">
import { computed, ref } from "vue";
import UnitTestRunScopePane from "../src/components/unit-tests/UnitTestRunScopePane.vue";
import {
  projectUnitTestRunScopeRows,
  type UnitTestRunScopeModuleInput,
} from "../src/models/unitTestsViewModel";
import { sortPlanModules, type ModuleHistoryMap, type ModuleSortBy } from "../src/utils/unitTestModuleHistory";

type Scenario = "loaded" | "loading" | "error" | "empty" | "single-running";

const scenario = ref<Scenario>("loaded");
const showModuleList = ref(true);
const showCaseDetails = ref(false);
const moduleSortBy = ref<ModuleSortBy>("plan");
const checkedSuiteIds = ref(new Set(["code", "cad", "platform", "caa"]));
const checkedModules = ref(new Set<string>());
const eventLog = ref(["ready"]);
const narrow = new URLSearchParams(window.location.search).has("narrow");

const suites = [
  { id: "code", label: "Code", module_count: 9 },
  { id: "cad", label: "CAD", module_count: 9 },
  { id: "platform", label: "平台", module_count: 9 },
  { id: "caa", label: "CAA", module_count: 9 },
];
const suiteIds = suites.map((suite) => suite.id);

const loadedModules: UnitTestRunScopeModuleInput[] = Array.from({ length: 36 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  const suiteId = suiteIds[index % suiteIds.length] ?? "code";
  return {
    module: `tests.module_${number}`,
    suite_id: suiteId,
    backend: index % 3 === 0 ? "runtime" : "vitest",
    case_count: (index % 5) + 1,
    cases: [
      { id: `case-${number}-1`, class_name: `Module${number}Tests`, method: "works" },
      { id: `case-${number}-2`, class_name: `Module${number}Tests`, method: "edge_case" },
    ],
  };
});
checkedModules.value = new Set(loadedModules.map((module) => module.module));

const moduleCatalog = Object.fromEntries(loadedModules.map((module, index) => [
  module.module,
  { description_zh: `模块 ${index + 1} 的运行范围与回归说明` },
]));
const caseCatalog = Object.fromEntries(loadedModules.flatMap((module) =>
  (module.cases ?? []).map((testCase) => [testCase.id, { summary: `${testCase.method} 摘要` }]),
));
const moduleHistory: ModuleHistoryMap = Object.fromEntries(loadedModules.slice(0, 12).map((module, index) => [
  module.module,
  {
    module: module.module,
    run_count: index + 1,
    last_run_at: new Date(Date.UTC(2026, 6, 18, 5, index)).toISOString(),
  },
]));
const suiteLabels = new Map(suites.map((suite) => [suite.id, suite.label]));

const planModules = computed(() => scenario.value === "empty" || scenario.value === "error"
  ? []
  : loadedModules);
const plan = computed(() => scenario.value === "error"
  ? null
  : {
      suite_label: "Code + CAD + 平台 + CAA",
      total_modules: planModules.value.length,
      total_cases: planModules.value.reduce((sum, module) => sum + module.case_count, 0),
      ignored_cases: 2,
      load_errors: [],
      modules: planModules.value,
      suite_id: "all",
    });
const sortedModules = computed(() => sortPlanModules(
  [...planModules.value],
  moduleSortBy.value,
  moduleHistory,
));
const rows = computed(() => projectUnitTestRunScopeRows(
  sortedModules.value,
  checkedModules.value,
  moduleCatalog,
  caseCatalog,
  moduleHistory,
  suiteLabels,
));
const running = computed(() => scenario.value === "single-running");
const rerunningModule = computed(() => running.value ? "tests.module_01" : null);
const planLoading = computed(() => scenario.value === "loading");
const planError = computed(() => scenario.value === "error" ? "Error: fixture offline" : "");
const moduleCountLabel = computed(() => `${checkedModules.value.size}/${planModules.value.length}`);

function record(event: string): void {
  eventLog.value = [...eventLog.value, event].slice(-10);
}

function setScenario(next: Scenario): void {
  scenario.value = next;
  showModuleList.value = true;
  showCaseDetails.value = false;
  moduleSortBy.value = "plan";
  checkedModules.value = new Set(loadedModules.map((module) => module.module));
  eventLog.value = [`scenario:${next}`];
}

function onSuiteChange(suiteId: string, checked: boolean): void {
  const next = new Set(checkedSuiteIds.value);
  if (checked) next.add(suiteId);
  else next.delete(suiteId);
  checkedSuiteIds.value = next;
  record(`suite:${suiteId}:${checked}`);
}

function onModuleChange(module: string, checked: boolean): void {
  const next = new Set(checkedModules.value);
  if (checked) next.add(module);
  else next.delete(module);
  checkedModules.value = next;
  record(`module:${module}:${checked}`);
}

function onAllModulesChange(checked: boolean): void {
  checkedModules.value = checked
    ? new Set(planModules.value.map((module) => module.module))
    : new Set();
  record(`all-modules:${checked}`);
}

function onRunModule(row: { module: string }): void {
  record(`run:${row.module}`);
}
</script>

<template>
  <main class="fixture" :class="{ narrow }">
    <nav class="fixture-actions" aria-label="夹具场景">
      <button type="button" @click="setScenario('loaded')">已加载</button>
      <button type="button" @click="setScenario('loading')">加载中</button>
      <button type="button" @click="setScenario('error')">加载失败</button>
      <button type="button" @click="setScenario('empty')">空计划</button>
      <button type="button" @click="setScenario('single-running')">单模块运行中</button>
    </nav>
    <output data-testid="unit-scope-fixture-event">{{ eventLog.join(" | ") }}</output>
    <section class="pane-shell" data-testid="unit-scope-pane-shell">
      <UnitTestRunScopePane
        v-model:show-module-list="showModuleList"
        v-model:show-case-details="showCaseDetails"
        v-model:module-sort-by="moduleSortBy"
        :runnable-suites="suites"
        :checked-suite-ids="checkedSuiteIds"
        :running="running"
        :module-count-label="moduleCountLabel"
        :plan="plan"
        :plan-loading="planLoading"
        :plan-error="planError"
        :rows="rows"
        :rerunning-module="rerunningModule"
        @suite-change="onSuiteChange"
        @all-modules-change="onAllModulesChange"
        @module-change="onModuleChange"
        @run-module="onRunModule"
      />
    </section>
  </main>
</template>

<style scoped>
.fixture {
  box-sizing: border-box;
  display: flex;
  min-height: 100vh;
  padding: 14px;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

.fixture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fixture-actions button {
  padding: 5px 9px;
}

output {
  min-height: 20px;
  color: #475569;
  font-family: var(--font-mono);
}

.pane-shell {
  box-sizing: border-box;
  width: min(980px, calc(100vw - 28px));
  min-height: 0;
  overflow: hidden;
}

.fixture.narrow .pane-shell {
  width: min(360px, calc(100vw - 28px));
}
</style>
