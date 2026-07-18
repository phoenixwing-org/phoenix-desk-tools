<script setup lang="ts">
import { computed, ref, useId } from "vue";
import type {
  UnitTestRunScopePlanView,
  UnitTestRunScopeRowView,
  UnitTestRunScopeSuiteView,
} from "../../models/unitTestsViewModel";

type ModuleSortBy = "plan" | "last_run_at" | "run_count";

const props = defineProps<{
  runnableSuites: readonly UnitTestRunScopeSuiteView[];
  checkedSuiteIds: ReadonlySet<string>;
  running: boolean;
  moduleCountLabel: string;
  plan: UnitTestRunScopePlanView | null;
  planLoading: boolean;
  planError: string;
  rows: readonly UnitTestRunScopeRowView[];
  rerunningModule: string | null;
}>();

const showModuleList = defineModel<boolean>("showModuleList", { required: true });
const showCaseDetails = defineModel<boolean>("showCaseDetails", { required: true });
const moduleSortBy = defineModel<ModuleSortBy>("moduleSortBy", { required: true });

const emit = defineEmits<{
  suiteChange: [suiteId: string, checked: boolean];
  allModulesChange: [checked: boolean];
  moduleChange: [module: string, checked: boolean];
  runModule: [row: UnitTestRunScopeRowView];
}>();

const collapsed = ref(false);
const scopeBodyId = useId();
const selectedRows = computed(() => props.rows.filter((row) => row.selected));
const allModulesChecked = computed(() =>
  props.rows.length > 0 && selectedRows.value.length === props.rows.length,
);
const showHistoryColumns = computed(() =>
  props.rows.some((row) => row.runCount > 0 || row.lastRunAt),
);

function rowClass({ row }: { row: UnitTestRunScopeRowView }): string {
  return row.selected ? "" : "run-scope-row-off";
}
</script>

<template>
  <section
    class="unit-test-run-scope-pane"
    data-testid="unit-test-run-scope-pane"
    data-tour-page-unit-tests-suites
  >
    <div class="run-toolbar">
      <button
        type="button"
        class="run-toolbar-toggle"
        :aria-expanded="!collapsed"
        :aria-controls="scopeBodyId"
        @click="collapsed = !collapsed"
      >
        <h2 class="section-label">
          <span class="collapse-arrow">{{ collapsed ? '▸' : '▾' }}</span>
          运行范围
        </h2>
      </button>
      <div class="run-chips">
        <el-checkbox
          v-for="suite in runnableSuites"
          :key="suite.id"
          :model-value="checkedSuiteIds.has(suite.id)"
          :disabled="running"
          border
          size="small"
          class="suite-chip"
          @change="emit('suiteChange', suite.id, Boolean($event))"
        >
          {{ suite.label }}
          <span class="suite-count">{{ suite.module_count }}</span>
        </el-checkbox>
      </div>
    </div>

    <div v-if="!collapsed" :id="scopeBodyId" class="run-scope-body">
      <div class="run-scope-controls">
        <el-checkbox
          v-model="showModuleList"
          :disabled="running"
          size="small"
        >
          列出运行范围
          <span v-if="moduleCountLabel" class="suite-count">{{ moduleCountLabel }}</span>
        </el-checkbox>
        <template v-if="showModuleList">
          <el-checkbox
            v-model="showCaseDetails"
            :disabled="running || planLoading"
          >
            展开用例
          </el-checkbox>
          <el-radio-group
            v-if="plan?.modules.length"
            v-model="moduleSortBy"
            size="small"
            :disabled="running || planLoading"
          >
            <el-radio-button value="plan">默认</el-radio-button>
            <el-radio-button value="last_run_at">最近运行</el-radio-button>
            <el-radio-button value="run_count">运行次数</el-radio-button>
          </el-radio-group>
          <span
            v-if="plan && !planLoading"
            class="run-scope-summary muted small"
            data-testid="unit-test-run-scope-summary"
          >
            {{ plan.suite_label }}
            <template v-if="selectedRows.length < rows.length">
              · 已选 {{ selectedRows.length }}/{{ rows.length }} 模块
              · {{ selectedRows.reduce((sum, row) => sum + row.caseCount, 0) }} 用例
            </template>
            <template v-else>
              · {{ plan.total_modules }} 模块 · {{ plan.total_cases }} 用例
            </template>
            <template v-if="plan.ignored_cases"> · 将忽略 {{ plan.ignored_cases }}</template>
          </span>
          <span v-if="planLoading" class="muted small" data-testid="unit-test-run-scope-loading">
            加载计划…
          </span>
          <span v-if="planError" class="error-text small" data-testid="unit-test-run-scope-error">
            {{ planError }}
          </span>
        </template>
      </div>

      <div
        v-if="showModuleList && rows.length"
        class="run-scope-list"
        data-testid="unit-test-run-scope-scroll"
      >
        <el-table
          :data="rows"
          row-key="module"
          size="small"
          stripe
          class="run-scope-table"
          :row-class-name="rowClass"
        >
          <el-table-column v-if="showCaseDetails" type="expand" width="36">
            <template #default="{ row }">
              <ul v-if="row.cases.length" class="run-scope-cases">
                <li v-for="testCase in row.cases" :key="testCase.id" class="mono">
                  {{ testCase.label }}
                  <span v-if="testCase.summary" class="case-brief muted">
                    — {{ testCase.summary }}
                  </span>
                </li>
              </ul>
              <span v-else class="muted small">无用例明细</span>
            </template>
          </el-table-column>
          <el-table-column width="44" align="center">
            <template #header>
              <el-checkbox
                :model-value="allModulesChecked"
                :disabled="running || planLoading || !rows.length"
                aria-label="全选运行模块"
                @change="emit('allModulesChange', Boolean($event))"
              />
            </template>
            <template #default="{ row }">
              <el-checkbox
                :model-value="row.selected"
                :disabled="running || planLoading"
                :aria-label="`选择模块 ${row.moduleLabel}`"
                @change="emit('moduleChange', row.module, Boolean($event))"
              />
            </template>
          </el-table-column>
          <el-table-column label="模块" min-width="168" class-name="mono">
            <template #default="{ row }">{{ row.moduleLabel }}</template>
          </el-table-column>
          <el-table-column label="简介" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="module-desc-cell">{{ row.description }}</span>
            </template>
          </el-table-column>
          <el-table-column label="套件" width="72" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain">{{ row.suiteLabel }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="后端" width="66" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.backend === 'vitest'" size="small" type="warning" effect="plain">
                vitest
              </el-tag>
              <el-tag v-else size="small" type="success" effect="plain">runtime</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="用例" width="56" align="center">
            <template #default="{ row }">{{ row.caseCount }}</template>
          </el-table-column>
          <el-table-column v-if="showHistoryColumns" label="次数" width="52" align="center">
            <template #default="{ row }">
              <span class="run-count-cell">{{ row.runCount || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showHistoryColumns" label="最近" width="88" align="center">
            <template #default="{ row }">
              <span class="run-time-cell" :title="row.lastRunAt ?? undefined">
                {{ row.lastRunLabel }}
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
                :data-module="row.module"
                :loading="rerunningModule === row.module"
                :disabled="planLoading || (running && rerunningModule !== row.module)"
                @click="emit('runModule', row)"
              >
                运行
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-empty
        v-else-if="showModuleList && plan && !planLoading && !planError"
        class="run-scope-empty"
        description="当前计划没有可执行模块"
        :image-size="56"
      />

      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.unit-test-run-scope-pane {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.run-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.run-toolbar-toggle {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.run-toolbar-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 3px;
}

.section-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--muted);
  white-space: nowrap;
}

.collapse-arrow {
  width: 0.8rem;
  text-align: center;
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

.suite-count {
  font-size: 0.7rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
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

.run-scope-list {
  margin-top: 8px;
  max-height: min(40vh, 320px);
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter, var(--border));
  border-radius: 6px;
}

.run-scope-table {
  width: 100%;
  min-width: 820px;
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

.run-scope-empty {
  min-height: 112px;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 0.76rem;
}

.error-text {
  color: #b91c1c;
}
</style>
