<script setup lang="ts">
import { computed } from "vue";
import type { BatchStep } from "../../../../shared/batch-tasks/contracts";
import { summarizeBatchStepResult } from "./resultSummary";
const props = defineProps<{ step: BatchStep }>();
const summary = computed(() => summarizeBatchStepResult(props.step));
</script>
<template>
  <section class="batch-task-result" :aria-label="summary.title">
    <h4>{{ summary.title }}</h4>
    <dl v-if="summary.facts.length">
      <template v-for="fact in summary.facts" :key="fact.label"><dt>{{ fact.label }}</dt><dd :class="{ mono: fact.mono }">{{ fact.value }}</dd></template>
    </dl>
    <div v-for="table in summary.tables" :key="table.title" class="result-table">
      <table><caption>{{ table.title }}</caption><thead><tr><th v-for="column in table.columns" :key="column" scope="col">{{ column }}</th></tr></thead>
        <tbody><tr v-for="(row, index) in table.rows" :key="index"><td v-for="(cell, column) in row" :key="column">{{ cell }}</td></tr></tbody>
      </table>
    </div>
    <p v-for="notice in summary.notices" :key="notice" class="result-note">{{ notice }}</p>
    <details v-if="summary.raw !== null"><summary>原始结果 JSON</summary><pre>{{ summary.raw }}</pre></details>
  </section>
</template>
<style scoped>
.batch-task-result { min-width: 0; display: grid; gap: 7px; font-size: 12px; }
h4, p, dl { margin: 0; } h4 { font-size: inherit; } dl { display: grid; grid-template-columns: minmax(82px, max-content) minmax(0, 1fr); gap: 4px 9px; }
dt, .result-note { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; min-width: 0; } .mono, pre { font-family: var(--font-mono, monospace); }
.result-table { min-width: 0; overflow: auto; max-height: 340px; } table { width: 100%; border-collapse: collapse; text-align: left; } caption { text-align: left; font-weight: 600; padding: 3px 0; }
th, td { padding: 5px 7px; border: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; white-space: pre-wrap; } th { background: var(--panel-head-bg); }
.result-note { overflow-wrap: anywhere; } summary { cursor: pointer; } pre { max-height: 280px; overflow: auto; margin: 7px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
