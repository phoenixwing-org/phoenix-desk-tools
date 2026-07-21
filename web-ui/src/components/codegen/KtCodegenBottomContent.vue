<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useAppShell } from "../../composables/useAppShell";
import { useWorkbenchBottomPanelState } from "../../composables/useWorkbenchBottomContribution";
import { useKtCodegenStore, type KtCodegenProblem } from "../../stores/ktCodegen";
import { deriveKtCodegenPlanPresentation } from "../../models/ktCodegenPlanPresentation";
import {
  ktCodegenDiagnosticLocation,
  ktCodegenDiagnosticMarkerContext,
} from "../../utils/ktCodegenDiagnosticPresentation";

const props = withDefaults(defineProps<{
  workbenchTabId?: string;
  panelTab?: "preflight" | "problems";
}>(), {
  workbenchTabId: "",
  panelTab: "preflight",
});

const shell = useAppShell();
const panel = useWorkbenchBottomPanelState();
const store = useKtCodegenStore(props.workbenchTabId);
const {
  preflight,
  problems,
  selectedArtifact,
  selectedArtifactId,
  sourcePreview,
  sourcePreviewError,
  sourcePreviewKind,
  sourcePreviewLoading,
} = storeToRefs(store);

const planPresentation = computed(() => deriveKtCodegenPlanPresentation(preflight.value));

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
  if (!file) return false;
  return problem.origin === "预检"
    && location?.source === "source"
    && typeof location.row === "number"
    && Boolean(preflight.value?.source_file_fingerprints[file.replace(/\\/g, "/")]);
}

async function openProblem(problem: KtCodegenProblem): Promise<void> {
  if (!canOpenProblem(problem)) return;
  if (props.workbenchTabId) shell.activateTab(props.workbenchTabId);
  const preview = await store.previewDiagnostic(problem.diagnostic);
  if (!preview) return;
  panel.setActiveTab("preflight");
  void shell.setLogOpen(true);
  shell.setStatus(`已定位 ${preview.path}:${preview.focus_start_line + 1}`);
}
</script>

<template>
  <div class="kt-codegen-bottom-content">
    <template v-if="panelTab === 'preflight'">
      <div v-if="preflight" class="plan-body" :class="`tone-${planPresentation.tone}`">
        <nav class="artifact-list" aria-label="生成产物">
          <button
            v-for="artifact in preflight.plan.artifacts"
            :key="artifact.id"
            type="button"
            :class="{ active: artifact.id === selectedArtifactId }"
            :aria-pressed="artifact.id === selectedArtifactId"
            @click="store.selectArtifact(artifact.id)"
          >
            <strong>{{ artifact.blockKey }}</strong>
            <small>{{ artifact.classId }} · {{ artifact.target }}</small>
          </button>
          <p v-if="!preflight.plan.artifacts.length">没有生成产物</p>
        </nav>
        <div class="code-preview-stack">
          <section class="source-preview" :aria-busy="sourcePreviewLoading">
            <header>
              <strong>当前源码</strong>
              <span v-if="sourcePreview">
                {{ sourcePreview.path }}:{{ sourcePreview.focus_start_line + 1 }} ·
                {{ sourcePreview.encoding.toUpperCase() }} · {{ sourcePreview.eol.toUpperCase() }}
              </span>
              <span v-else>{{ sourcePreviewLoading ? "加载中…" : "选择预检区域或问题" }}</span>
            </header>
            <div
              v-if="sourcePreview"
              class="source-lines"
              :class="{ stale: sourcePreview.stale, 'warning-focus': sourcePreviewKind === 'diagnostic' }"
            >
              <div v-for="line in sourcePreview.lines" :key="line.number" :class="{ focus: line.focus }">
                <span>{{ line.number + 1 }}</span><code>{{ line.text || " " }}</code>
              </div>
            </div>
            <p v-else-if="sourcePreviewError" class="source-error">{{ sourcePreviewError }}</p>
            <p v-else class="source-empty">{{ sourcePreviewLoading ? "正在读取源码片段…" : "没有源码片段" }}</p>
            <p v-if="sourcePreviewError && sourcePreview" class="source-error">{{ sourcePreviewError }}</p>
          </section>
          <section class="artifact-candidate">
            <header>
              <strong>Wing 生成候选</strong>
              <span>{{ selectedArtifact?.blockKey || "Artifact" }}</span>
            </header>
            <pre>{{ selectedArtifact?.content || "从左侧 Primary 选择预检命中，或从“问题”定位源码行。" }}</pre>
          </section>
        </div>
        <aside class="plan-state" :class="`tone-${planPresentation.tone}`">
          <strong>{{ planPresentation.label }}</strong>
          <span>{{ planPresentation.detail }}</span>
          <span>{{ preflight.plan.markerRegions.length }} 区域 · {{ preflight.plan.artifacts.length }} 产物</span>
          <span v-if="preflight.source_scan_truncated">源码扫描不完整</span>
          <span v-else>计划 {{ preflight.plan_fingerprint.slice(0, 18) }}…</span>
        </aside>
      </div>
      <p v-else class="bottom-empty">点击“预检”或“Apply 源码”；Apply 在没有计划时会先自动预检。</p>
    </template>

    <template v-else>
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
    </template>
  </div>
</template>

<style scoped>
.kt-codegen-bottom-content { width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.plan-body { display: grid; height: 100%; min-height: 0; grid-template-columns: minmax(180px, 25%) minmax(300px, 1fr) minmax(150px, 18%); }
.artifact-list,
.code-preview-stack { min-width: 0; min-height: 0; overflow: auto; }
.artifact-list { border-right: 1px solid var(--border); }
.artifact-list button { display: flex; width: 100%; flex-direction: column; gap: 2px; padding: 6px 8px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--border); cursor: pointer; }
.artifact-list button:hover,
.artifact-list button.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.artifact-list strong { overflow: hidden; font: 0.66rem ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.artifact-list small { color: var(--muted); font-size: 0.6rem; }
.artifact-list p { padding: 12px; color: var(--muted); font-size: 0.7rem; }
.code-preview-stack { display: grid; grid-template-rows: minmax(90px, 1fr) minmax(90px, 1fr); background: color-mix(in srgb, var(--sidebar-bg) 70%, transparent); }
.source-preview,
.artifact-candidate { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
.source-preview { border-bottom: 1px solid var(--border); }
.source-preview > header,
.artifact-candidate > header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 8px; min-height: 25px; padding: 4px 8px; color: var(--muted); background: var(--panel-head-bg); font-size: 0.62rem; }
.source-preview > header strong,
.artifact-candidate > header strong { color: var(--text); }
.source-lines { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 0; font: 0.65rem/1.45 ui-monospace, monospace; }
.source-lines > div { display: grid; grid-template-columns: 42px minmax(0, 1fr); }
.source-lines > div.focus { background: color-mix(in srgb, var(--accent) 15%, transparent); }
.source-lines.warning-focus > div.focus { background: color-mix(in srgb, #f59e0b 28%, transparent); box-shadow: inset 3px 0 #d97706; }
.source-lines > div > span { padding: 0 7px 0 4px; color: var(--muted); text-align: right; user-select: none; border-right: 1px solid var(--border); }
.source-lines code { display: block; min-width: max-content; padding: 0 8px; color: var(--text); white-space: pre; }
.source-lines.stale { opacity: 0.7; }
.source-error,
.source-empty { margin: 0; padding: 8px; color: var(--muted); font-size: 0.67rem; }
.source-error { color: #b45309; }
.artifact-candidate pre { flex: 1 1 auto; min-height: 0; margin: 0; overflow: auto; padding: 9px; color: var(--text); font: 0.68rem/1.45 ui-monospace, monospace; white-space: pre; }
.plan-state { display: flex; min-width: 0; flex-direction: column; gap: 5px; padding: 9px; color: var(--muted); border-left: 1px solid var(--border); font-size: 0.64rem; }
.plan-state strong { color: var(--text); font-size: 0.69rem; }
.tone-ready .plan-state strong { color: #15803d; }
.tone-warning .plan-state strong { color: #b45309; }
.tone-error .plan-state strong { color: #b91c1c; }
.bottom-empty { height: 100%; margin: 0; display: grid; place-items: center; padding: 20px; color: var(--muted); font-size: 0.7rem; }
.problem-list { height: 100%; overflow: auto; }
.problem-list button { display: grid; width: 100%; min-width: 0; grid-template-columns: 58px minmax(120px, 22%) minmax(240px, 1fr) minmax(120px, 26%); align-items: center; gap: 7px; padding: 6px 9px; color: inherit; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--border); cursor: default; font-size: 0.65rem; }
.problem-list button.navigable { cursor: pointer; }
.problem-list button.navigable:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.problem-list button:disabled { opacity: 1; color: inherit; }
.problem-list strong,
.problem-message,
.problem-list small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.problem-list strong { font-family: ui-monospace, monospace; }
.problem-list small { color: var(--muted); }
.problem-severity { text-transform: uppercase; font-size: 0.58rem; }
.diagnostic-error { border-left: 2px solid #b91c1c; }
.diagnostic-warning { border-left: 2px solid #b45309; }
.diagnostic-info { border-left: 2px solid #2563eb; }

@media (max-width: 980px) {
  .plan-body { grid-template-columns: minmax(150px, 32%) 1fr; }
  .plan-state { display: none; }
  .problem-list button { grid-template-columns: 52px minmax(100px, 28%) 1fr; }
  .problem-list small { display: none; }
}
</style>
