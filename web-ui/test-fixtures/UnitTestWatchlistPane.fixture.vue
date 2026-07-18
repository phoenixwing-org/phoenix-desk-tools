<script setup lang="ts">
import { computed, ref } from "vue";
import UnitTestWatchlistPane from "../src/components/unit-tests/UnitTestWatchlistPane.vue";
import {
  projectUnitTestWatchlistRows,
  type UnitTestWatchlistEntryViewInput,
} from "../src/models/unitTestsViewModel";

type Scenario = "populated" | "empty" | "single-running";
type SortBy = "fail_count" | "last_seen_at";

const scenario = ref<Scenario>("populated");
const sortBy = ref<SortBy>("last_seen_at");
const defaultRunOnFull = ref(true);
const checkedIds = ref(new Set(["fixture-01", "fixture-03"]));
const eventLog = ref(["ready"]);

const initialEntries: UnitTestWatchlistEntryViewInput[] = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `fixture-${number}`,
    module: `tests.fixture_module_${number}`,
    suite_id: index % 2 === 0 ? "code" : "cad",
    class_name: `Fixture${number}Tests`,
    method: index % 2 === 0 ? `fails_${number}` : `raises_${number}`,
    status: index % 2 === 0 ? "failed" : "error",
    message: `fixture diagnostic ${number} with a deliberately long message`,
    fail_count: (index % 5) + 1,
    last_seen_at: new Date(Date.UTC(2026, 6, 18, 6, index)).toISOString(),
    run_on_full: index % 3 !== 0,
  };
});
const entries = ref([...initialEntries]);

const caseCatalog = Object.fromEntries(initialEntries.map((entry, index) => [
  entry.id,
  { description_zh: `关注用例 ${index + 1} 的行为说明，用于验证窄宽表格中的文本截断与完整 title` },
]));
const moduleCatalog = Object.fromEntries(initialEntries.map((entry) => [
  entry.module,
  { description_zh: `${entry.module} 模块说明` },
]));
const suiteLabels = new Map([["code", "Code"], ["cad", "CAD"]]);

const sortedEntries = computed(() => [...entries.value].sort((left, right) => {
  if (sortBy.value === "fail_count") {
    return right.fail_count - left.fail_count
      || right.last_seen_at.localeCompare(left.last_seen_at);
  }
  return right.last_seen_at.localeCompare(left.last_seen_at)
    || right.fail_count - left.fail_count;
}));
const visibleEntries = computed(() => scenario.value === "empty" ? [] : sortedEntries.value);
const rows = computed(() => projectUnitTestWatchlistRows(
  visibleEntries.value,
  checkedIds.value,
  caseCatalog,
  moduleCatalog,
  suiteLabels,
));
const running = computed(() => scenario.value === "single-running");
const rerunningId = computed(() => running.value ? "fixture-01" : null);

function record(event: string): void {
  eventLog.value = [...eventLog.value, event].slice(-12);
}

function setScenario(next: Scenario): void {
  scenario.value = next;
  entries.value = [...initialEntries];
  checkedIds.value = new Set(["fixture-01", "fixture-03"]);
  eventLog.value = [`scenario:${next}`];
}

function setChecked(id: string, checked: boolean): void {
  const next = new Set(checkedIds.value);
  if (checked) next.add(id);
  else next.delete(id);
  checkedIds.value = next;
  record(`checked:${id}:${checked}`);
}

function setAllChecked(checked: boolean): void {
  checkedIds.value = checked ? new Set(visibleEntries.value.map((entry) => entry.id)) : new Set();
  record(`all:${checked}`);
}

function setRunOnFull(id: string, checked: boolean): void {
  entries.value = entries.value.map((entry) => entry.id === id
    ? { ...entry, run_on_full: checked }
    : entry);
  record(`full:${id}:${checked}`);
}
</script>

<template>
  <main class="fixture">
    <nav class="fixture-actions" aria-label="夹具场景">
      <button type="button" @click="setScenario('populated')">有数据</button>
      <button type="button" @click="setScenario('empty')">空列表</button>
      <button type="button" @click="setScenario('single-running')">单条运行中</button>
    </nav>
    <output data-testid="watchlist-fixture-event">{{ eventLog.join(" | ") }}</output>
    <section class="pane-shell" data-testid="watchlist-pane-shell">
      <UnitTestWatchlistPane
        :rows="rows"
        :running="running"
        :sort-by="sortBy"
        :default-run-on-full="defaultRunOnFull"
        :rerunning-id="rerunningId"
        @sort="(value) => { sortBy = value; record(`sort:${value}`); }"
        @default-run-on-full="(value) => { defaultRunOnFull = value; record(`default:${value}`); }"
        @all-checked="setAllChecked"
        @checked="setChecked"
        @run-on-full="setRunOnFull"
        @run-selected="record('run-selected')"
        @run-watchlist="record('run-watchlist')"
        @rerun="record(`rerun:${$event.id}`)"
        @remove-request="record(`remove:${$event.id}`)"
        @clear-request="record('clear')"
      />
    </section>
  </main>
</template>

<style scoped>
.fixture {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 14px;
  overflow-x: hidden;
}

.fixture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.fixture-actions button { padding: 5px 9px; }

output {
  display: block;
  min-height: 20px;
  margin-bottom: 8px;
  color: #475569;
  font-family: var(--font-mono);
}

.pane-shell {
  box-sizing: border-box;
  width: min(980px, calc(100vw - 28px));
  min-width: 0;
}
</style>
