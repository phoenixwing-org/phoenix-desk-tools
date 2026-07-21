<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  TestModuleCatalogEntry,
  UnitTestCaseResult,
  UnitTestModuleSummary,
  UnitTestRunResult,
} from "../../api";
import {
  groupUnitTestCasesByModule,
  unitTestModuleDescription,
  unitTestModuleDescriptionBrief,
  unitTestShortModule,
  unitTestStatusClass,
  unitTestStatusLabel,
} from "../../models/unitTestsViewModel";

const STATUS_FILTER_OPTIONS = [
  { id: "passed", label: "通过" },
  { id: "failed", label: "失败" },
  { id: "error", label: "错误" },
  { id: "skipped", label: "跳过" },
] as const;

const props = defineProps<{
  result: UnitTestRunResult;
  passRate: number;
  lastRunSuites: readonly string[];
  suiteLabelById: ReadonlyMap<string, string>;
  resultSuiteChecked: ReadonlySet<string>;
  resultStatusChecked: ReadonlySet<string>;
  filteredCases: readonly UnitTestCaseResult[];
  filteredModuleSummaries: readonly UnitTestModuleSummary[];
  moduleCatalog: Readonly<Record<string, TestModuleCatalogEntry>>;
  watchlistCount: number;
  reTestedCount: number;
  filterWatchlistOnly: boolean;
  filterReTestedOnly: boolean;
  lastIgnoredCount: number;
}>();

const emit = defineEmits<{
  suiteChange: [id: string, checked: boolean];
  statusChange: [id: string, checked: boolean];
  selectAllSuites: [];
  selectOnlyFailed: [];
  filterWatchlist: [];
  filterReTested: [];
}>();

const expandedCase = ref<string | null>(null);
const groupedModules = computed(() => groupUnitTestCasesByModule(props.filteredCases));
const failureRate = computed(() => props.result.summary.tests_run
  ? ((props.result.summary.failed + props.result.summary.errors) / props.result.summary.tests_run) * 100
  : 0);

watch(() => props.result, () => { expandedCase.value = null; });

function toggleCase(id: string) {
  expandedCase.value = expandedCase.value === id ? null : id;
}

function moduleDescription(module: string): string {
  return unitTestModuleDescription(props.moduleCatalog, module);
}

function moduleDescriptionBrief(module: string, maxLen = 48): string {
  return unitTestModuleDescriptionBrief(props.moduleCatalog, module, maxLen);
}

function moduleSuiteLabel(module: string): string {
  const suiteId = props.result.cases.find((testCase) => testCase.module === module)?.suite_id ?? "";
  return props.suiteLabelById.get(suiteId) ?? "—";
}
</script>

<template>
  <section class="card results-card unit-test-result-pane" data-testid="unit-test-result-pane">
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

    <div class="progress-wrap" aria-label="测试结果比例">
      <div class="progress-bar">
        <div class="progress-pass" :style="{ width: `${passRate}%` }" />
        <div class="progress-fail" :style="{ width: `${failureRate}%` }" />
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
            @change="emit('suiteChange', id, Boolean($event))"
          >
            {{ suiteLabelById.get(id) ?? id }}
          </el-checkbox>
          <el-button link size="small" @click="emit('selectAllSuites')">全选</el-button>
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">结果 · 状态</span>
        <div class="filter-chips">
          <el-checkbox
            v-for="option in STATUS_FILTER_OPTIONS"
            :key="option.id"
            :model-value="resultStatusChecked.has(option.id)"
            border
            size="small"
            @change="emit('statusChange', option.id, Boolean($event))"
          >
            {{ option.label }}
          </el-checkbox>
          <el-button link size="small" @click="emit('selectOnlyFailed')">仅失败</el-button>
          <el-button v-if="watchlistCount" link size="small" @click="emit('filterWatchlist')">仅关注项</el-button>
          <el-button v-if="reTestedCount" link size="small" @click="emit('filterReTested')">仅复测项</el-button>
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
      <div class="module-table-wrap">
        <table class="data-table compact">
          <thead>
            <tr><th>模块</th><th>简介</th><th>套件</th><th>通过</th><th>失败</th><th>错误</th><th>跳过</th><th>合计</th></tr>
          </thead>
          <tbody>
            <tr v-for="module in filteredModuleSummaries" :key="module.module">
              <td class="mono">{{ unitTestShortModule(module.module) }}</td>
              <td class="module-desc" :title="moduleDescription(module.module)">{{ moduleDescriptionBrief(module.module) }}</td>
              <td>{{ moduleSuiteLabel(module.module) }}</td>
              <td>{{ module.passed }}</td><td>{{ module.failed }}</td><td>{{ module.errors }}</td>
              <td>{{ module.skipped }}</td><td>{{ module.tests_run }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="cases-panel">
      <h3 class="subsection-title">用例明细</h3>
      <p v-if="!filteredCases.length" class="muted empty-hint">当前筛选无匹配用例，请调整上方勾选。</p>
      <div v-for="[module, cases] in groupedModules" :key="module" class="module-group">
        <div class="module-group-head">
          <div class="module-group-title">
            <span class="mono">{{ unitTestShortModule(module) }}</span>
            <span v-if="moduleDescription(module)" class="module-group-desc">{{ moduleDescriptionBrief(module, 64) }}</span>
          </div>
          <span class="module-suite-tag">{{ suiteLabelById.get(cases[0]?.suite_id ?? "") }}</span>
        </div>
        <ul class="case-list">
          <li v-for="testCase in cases" :key="testCase.id" class="case-item" :class="unitTestStatusClass(testCase.status)">
            <button type="button" class="case-head" @click="toggleCase(testCase.id)">
              <span class="case-status">{{ unitTestStatusLabel(testCase.status) }}</span>
              <span class="case-name">{{ testCase.class_name }}.{{ testCase.method }}</span>
              <span class="case-ms">{{ testCase.duration_ms }} ms</span>
            </button>
            <pre v-if="expandedCase === testCase.id && (testCase.message || testCase.traceback)" class="case-detail">{{ testCase.message }}{{ testCase.traceback ? "\n" + testCase.traceback : "" }}</pre>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stat-cards { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.stat-card { display: flex; flex-direction: column; align-items: center; min-width: 72px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
.stat-value { font-size: 1.1rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-label { margin-top: 2px; font-size: 0.72rem; color: var(--muted); }
.tone-pass .stat-value { color: #15803d; }
.tone-fail .stat-value { color: #b91c1c; }
.tone-rate .stat-value { color: #1d4ed8; }
.progress-wrap { margin-bottom: 14px; }
.progress-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #e5e7eb; }
.progress-pass { background: #22c55e; transition: width 0.3s ease; }
.progress-fail { background: #ef4444; transition: width 0.3s ease; }
.filter-bar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: #f8fafc; }
.filter-group, .filter-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.filter-chips { gap: 6px; }
.filter-label { flex-shrink: 0; min-width: 72px; font-size: 0.76rem; font-weight: 600; color: var(--muted); }
.count { font-size: 0.78rem; color: var(--muted); }
.subsection-title { margin: 0 0 8px; font-size: 0.88rem; font-weight: 600; }
.module-summary { margin-bottom: 16px; }
.module-table-wrap { overflow-x: auto; }
.data-table { width: 100%; min-width: 660px; border-collapse: collapse; font-size: 0.82rem; }
.data-table th, .data-table td { border: 1px solid var(--border); padding: 6px 8px; text-align: left; }
.data-table th { background: #f9fafb; font-weight: 600; }
.mono { font-family: ui-monospace, monospace; font-size: 0.78rem; }
.module-group { margin-bottom: 12px; }
.module-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; background: #f3f4f6; border: 1px solid var(--border); border-bottom: none; border-radius: 6px 6px 0 0; font-size: 0.78rem; font-weight: 600; }
.module-group-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.module-group-desc { font-size: 0.72rem; font-weight: 400; color: var(--muted); }
.module-desc { max-width: 280px; font-size: 0.76rem; color: var(--muted); line-height: 1.35; }
.module-suite-tag { font-size: 0.72rem; font-weight: 500; color: var(--muted); }
.case-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 0 0 6px 6px; }
.case-item { border-top: 1px solid var(--border); }
.case-item:first-child { border-top: none; }
.case-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: none; background: transparent; text-align: left; cursor: pointer; font-size: 0.82rem; }
.case-head:hover { background: #f9fafb; }
.case-status { flex-shrink: 0; min-width: 36px; font-size: 0.72rem; font-weight: 600; }
.status-passed .case-status { color: #15803d; }
.status-failed .case-status, .status-error .case-status { color: #b91c1c; }
.status-skipped .case-status { color: #a16207; }
.case-name { flex: 1; font-family: ui-monospace, monospace; font-size: 0.78rem; }
.case-ms { flex-shrink: 0; color: var(--muted); font-size: 0.72rem; font-variant-numeric: tabular-nums; }
.case-detail { margin: 0; padding: 8px 10px 10px; background: #fef2f2; border-top: 1px solid #fecaca; font-size: 0.72rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.muted { color: var(--muted); }
.empty-hint { font-size: 0.85rem; }
</style>
