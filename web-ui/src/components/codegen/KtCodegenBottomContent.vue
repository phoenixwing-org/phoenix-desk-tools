<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useAppShell } from "../../composables/useAppShell";
import { useKtCodegenStore, type KtCodegenProblem } from "../../stores/ktCodegen";
import {
  ktCodegenDiagnosticLocation,
  ktCodegenDiagnosticMarkerContext,
} from "../../utils/ktCodegenDiagnosticPresentation";

const props = withDefaults(defineProps<{
  workbenchTabId?: string;
  panelTab?: "problems";
}>(), {
  workbenchTabId: "",
  panelTab: "problems",
});

const shell = useAppShell();
const store = useKtCodegenStore(props.workbenchTabId);
const { preflight, problems } = storeToRefs(store);

function diagnosticDetails(problem: KtCodegenProblem): string {
  return [
    problem.origin,
    ktCodegenDiagnosticMarkerContext(problem.diagnostic),
    ktCodegenDiagnosticLocation(problem.diagnostic),
  ].filter(Boolean).join(" · ");
}

function canOpenProblem(problem: KtCodegenProblem): boolean {
  const location = problem.diagnostic.path;
  const file = location?.file;
  return Boolean(
    file
    && problem.origin === "预检"
    && location?.source === "source"
    && typeof location.row === "number"
    && preflight.value?.source_file_fingerprints[file.replace(/\\/g, "/")],
  );
}

function openProblem(problem: KtCodegenProblem): void {
  if (!canOpenProblem(problem)) return;
  if (props.workbenchTabId) shell.activateTab(props.workbenchTabId);
  store.requestPreflightViewFocus();
  const location = problem.diagnostic.path!;
  shell.openFileDetailForRel(location.file!, { subTab: "edit" });
  shell.setStatus(`已打开 ${location.file}:${(location.row ?? 0) + 1}；预检结果仍保留在 Codegen View`);
}
</script>

<template>
  <div class="kt-codegen-problems">
    <div v-if="problems.length" class="problem-list" role="list" aria-label="Codegen 问题">
      <button
        v-for="problem in problems"
        :key="problem.key"
        type="button"
        role="listitem"
        :class="[`diagnostic-${problem.diagnostic.severity}`, { navigable: canOpenProblem(problem) }]"
        :disabled="!canOpenProblem(problem)"
        @click="openProblem(problem)"
      >
        <span class="problem-severity">{{ problem.diagnostic.severity }}</span>
        <strong>{{ problem.diagnostic.code }}</strong>
        <span class="problem-message">{{ problem.diagnostic.message }}</span>
        <small>{{ diagnosticDetails(problem) }}</small>
      </button>
    </div>
    <p v-else class="bottom-empty">当前配置与预检没有 warning/error/info。</p>
  </div>
</template>

<style scoped>
.kt-codegen-problems { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.problem-list { height: 100%; overflow: auto; }
.problem-list button { display: grid; width: 100%; min-width: 0; grid-template-columns: 58px minmax(120px, 22%) minmax(240px, 1fr) minmax(120px, 26%); align-items: center; gap: 7px; padding: 6px 9px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--border); cursor: default; font-size: 0.65rem; }
.problem-list button.navigable { cursor: pointer; }
.problem-list button.navigable:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.problem-list button:disabled { opacity: 1; color: inherit; }
.problem-list strong, .problem-message, .problem-list small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.problem-list strong { font-family: ui-monospace, monospace; }
.problem-list small { color: var(--muted); }
.problem-severity { text-transform: uppercase; font-size: 0.58rem; }
.diagnostic-error { border-left: 2px solid #b91c1c !important; }
.diagnostic-warning { border-left: 2px solid #b45309 !important; }
.diagnostic-info { border-left: 2px solid #2563eb !important; }
.bottom-empty { display: grid; height: 100%; margin: 0; padding: 20px; place-items: center; color: var(--muted); font-size: 0.7rem; }
@media (max-width: 980px) {
  .problem-list button { grid-template-columns: 52px minmax(100px, 28%) 1fr; }
  .problem-list small { display: none; }
}
</style>
