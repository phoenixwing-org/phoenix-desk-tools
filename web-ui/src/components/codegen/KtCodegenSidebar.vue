<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { pnwPromptChoice } from "phoenix-wing";
import type { KtCodegenDiagnostic } from "@phoenix-wing/kt-codegen";
import {
  ktCodegenDefinePrimaryPanelElement,
  type KtCodegenApplyReportActionDetail,
  type KtCodegenControlSelectionDetail,
  type KtCodegenPrimaryActionDetail,
  type KtCodegenPrimaryPanel,
} from "@phoenix-wing/kt-codegen/ui";
import { useAppShell } from "../../composables/useAppShell";
import type { PageSideBlockHostProps } from "../../layout/pageRegistry";
import { buildKtCodegenPrimaryUiModel } from "../../models/ktCodegenControlUi";
import {
  buildKtCodegenBatchReport,
  type KtCodegenBatchReport,
  type KtCodegenBatchReportItem,
} from "../../models/ktCodegenBatchReport";
import { useKtCodegenStore } from "../../stores/ktCodegen";
import KtCodegenBatchReportDialog from "./KtCodegenBatchReportDialog.vue";
import KtCodegenSourceViewerDialog from "./KtCodegenSourceViewerDialog.vue";

ktCodegenDefinePrimaryPanelElement();

const props = defineProps<PageSideBlockHostProps>();
const shell = useAppShell();
const store = useKtCodegenStore(props.workbenchTabId);
const {
  active,
  applyReports,
  applying,
  documents,
  dirty,
  externalChange,
  lastApply,
  loadingDocuments,
  opening,
  preflightView,
  preflightViewState,
  saving,
  selectedBlockKeys,
  status,
  recoveryConflict,
  sourcePreview,
  sourcePreviewError,
  sourcePreviewLoading,
} = storeToRefs(store);
const panelRef = ref<KtCodegenPrimaryPanel | null>(null);
const batchApplying = ref(false);
const batchProgress = ref<{ current: number; total: number; fileName: string }>();
const selectedReport = ref<KtCodegenBatchReport | null>(null);
const reportDialogOpen = ref(false);
const sourceDialogOpen = ref(false);
let discoveryPoll: ReturnType<typeof setInterval> | null = null;

function reportIssues(
  diagnostics: readonly KtCodegenDiagnostic[],
  fallbackPath?: string,
): KtCodegenBatchReportItem["issues"] {
  return diagnostics.flatMap((diagnostic) => {
    if (diagnostic.severity !== "error" && diagnostic.severity !== "warning") return [];
    const path = diagnostic.path?.source === "source" ? diagnostic.path.file : fallbackPath;
    return [{
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      ...(path ? { path } : {}),
      ...(diagnostic.path?.row === undefined ? {} : { line: diagnostic.path.row + 1 }),
    }];
  });
}

const model = computed(() => buildKtCodegenPrimaryUiModel({
  documents: documents.value,
  active: active.value,
  dirty: dirty.value,
  externalChange: externalChange.value,
  selectedBlockKeys: selectedBlockKeys.value,
  preflight: preflightView.value,
  state: preflightViewState.value,
  message: status.value,
  lastApply: lastApply.value,
  batchReports: applyReports.value,
  loadingDocuments: loadingDocuments.value,
  applying: applying.value,
  opening: opening.value,
  saving: saving.value,
  batchApplying: batchApplying.value,
  batchProgress: batchProgress.value,
  hostBlocked: Boolean(recoveryConflict.value),
}));

watch(model, async (value) => {
  await nextTick();
  if (panelRef.value) panelRef.value.model = value;
}, { immediate: true, deep: true });

async function refresh(): Promise<void> {
  try {
    await store.discover();
    shell.setStatus(status.value);
  } catch (error) {
    shell.setStatus(String(error));
  }
}

function refreshOrCancel(): void {
  if (loadingDocuments.value) {
    store.cancelDiscovery();
    shell.setStatus(status.value);
  } else void refresh();
}

function updateMeta(detail: Extract<KtCodegenPrimaryActionDetail, { action: "updateMeta" }>): void {
  if (!active.value || active.value.path !== detail.id) return;
  active.value.param[detail.field] = detail.value;
  store.markDirty();
  shell.scheduleWorkbenchSave();
}

async function scanCandidates(): Promise<void> {
  if (!active.value) {
    shell.setStatus("请先打开一份 Codegen 配置");
    return;
  }
  try {
    const result = await store.runPreflight(active.value.table);
    if (!result) return;
    store.requestPreflightViewFocus();
    shell.setStatus(`已扫描 ${result.candidate_file_count} 个候选文件`);
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function applyAll(): Promise<void> {
  if (dirty.value || recoveryConflict.value || externalChange.value) {
    shell.setStatus("当前 Codegen 草稿或外部冲突尚未处理，不能全部应用");
    return;
  }
  const targets = [...documents.value];
  if (!targets.length) return;
  const choice = await pnwPromptChoice({
    title: "全部应用 Codegen",
    message: `将依次预检并应用 ${targets.length} 份 Codegen 配置；不安全的配置会跳过。`,
    defaultChoiceId: "cancel",
    choices: [
      { id: "cancel", label: "取消" },
      { id: "confirm", label: "开始全部应用", variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;

  batchApplying.value = true;
  const startedAt = new Date().toISOString();
  let applied = 0;
  const failures: string[] = [];
  const reportItems: KtCodegenBatchReportItem[] = [];
  try {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!;
      const itemStartedAt = performance.now();
      batchProgress.value = { current: index + 1, total: targets.length, fileName: target.file_name };
      try {
        const document = await store.open(target.path, { discardDraft: true });
        const preflight = await store.runPreflight(document.table);
        if (!preflight?.safe_to_apply) {
          const message = `${target.file_name}：预检未通过安全门禁`;
          failures.push(message);
          reportItems.push({
            documentId: target.path,
            fileName: target.file_name,
            displayPath: target.path,
            health: "error",
            change: "not-applied",
            reasonCode: "preflight-blocked",
            errorCount: preflight?.plan.diagnostics.filter((item) => item.severity === "error").length ?? 1,
            preflightRegionCount: preflight?.plan.markerRegions.length ?? 0,
            preflightArtifactCount: preflight?.plan.artifacts.length ?? 0,
            preflightDiagnosticCount: preflight?.plan.diagnostics.length ?? 1,
            preflightErrorCount: preflight?.plan.diagnostics.filter((item) => item.severity === "error").length ?? 1,
            modifiedFileCount: 0,
            writtenRegionCount: 0,
            elapsedMilliseconds: performance.now() - itemStartedAt,
            message,
            issues: reportIssues(preflight?.plan.diagnostics ?? [], target.path),
          });
          continue;
        }
        const result = await store.apply(document.table);
        if (result) {
          applied += 1;
          const health = result.diagnostics.some((item) => item.severity === "error")
            ? "error" as const
            : result.diagnostics.some((item) => item.severity === "warning") ? "warning" as const : "success" as const;
          reportItems.push({
            documentId: target.path,
            fileName: target.file_name,
            displayPath: target.path,
            health,
            change: health === "error"
              ? result.files.length ? "partial" : "not-applied"
              : result.files.length ? "updated" : "unchanged",
            reasonCode: health === "error"
              ? result.files.length ? "partial-with-errors" : "apply-blocked"
              : result.files.length ? "content-updated" : "content-unchanged",
            errorCount: result.diagnostics.filter((item) => item.severity === "error").length,
            preflightRegionCount: preflight.plan.markerRegions.length,
            preflightArtifactCount: preflight.plan.artifacts.length,
            preflightDiagnosticCount: preflight.plan.diagnostics.length,
            preflightErrorCount: preflight.plan.diagnostics.filter((item) => item.severity === "error").length,
            modifiedFileCount: result.files.length,
            writtenRegionCount: result.region_count,
            elapsedMilliseconds: performance.now() - itemStartedAt,
            message: result.files.length
              ? `已更新 ${result.files.length} 个源码文件`
              : "生成结果与源码内容一致",
            issues: reportIssues(result.diagnostics, target.path),
          });
        }
      } catch (error) {
        const message = `${target.file_name}：${String(error)}`;
        failures.push(message);
        reportItems.push({
          documentId: target.path,
          fileName: target.file_name,
          displayPath: target.path,
          health: "error",
          change: "not-applied",
          reasonCode: "unexpected-error",
          errorCount: 1,
          preflightRegionCount: 0,
          preflightArtifactCount: 0,
          preflightDiagnosticCount: 1,
          preflightErrorCount: 1,
          modifiedFileCount: 0,
          writtenRegionCount: 0,
          elapsedMilliseconds: performance.now() - itemStartedAt,
          message,
          issues: [{ severity: "error", code: "batch.item-failed", message, path: target.path }],
        });
      }
    }
    store.addApplyReport(buildKtCodegenBatchReport({
      startedAt,
      completedAt: new Date().toISOString(),
      items: reportItems,
    }));
    await store.discover();
    shell.setStatus(failures.length
      ? `全部应用完成：${applied}/${targets.length} 成功，${failures.length} 份跳过；${failures[0]}`
      : `全部应用完成：${applied}/${targets.length} 成功`);
  } finally {
    batchApplying.value = false;
    batchProgress.value = undefined;
  }
}

async function handleAction(event: Event): Promise<void> {
  const detail = (event as CustomEvent<KtCodegenPrimaryActionDetail>).detail;
  if (detail.action === "refresh" || detail.action === "cancelOperation") {
    refreshOrCancel();
    return;
  }
  if (detail.action === "openDocument") {
    const tabId = shell.openKtCodegenDocument(detail.id);
    if (tabId) shell.setStatus(`已在独立 View 打开 ${detail.id}`);
    return;
  }
  if (detail.action === "openCandidate") {
    const candidate = preflightView.value?.source_candidates.find((item) => item.path === detail.id);
    const preview = candidate
      ? await store.previewCandidate(candidate)
      : await store.previewPath(detail.id, 0);
    if (!preview) {
      shell.setStatus(sourcePreviewError.value || `无法读取控制符候选 ${detail.id}`);
      return;
    }
    sourceDialogOpen.value = true;
    shell.setStatus(`正在查看控制符候选 ${preview.path}:${preview.focus_start_line + 1}`);
    return;
  }
  if (detail.action === "openReport") {
    const report = applyReports.value.find((item) => item.id === detail.id);
    if (report) {
      selectedReport.value = report;
      reportDialogOpen.value = true;
      shell.setStatus(`正在查看 ${report.summary.subject} 的批量应用报告`);
      return;
    }
    store.requestPreflightViewFocus();
    shell.setStatus(`单次 Apply 报告 ${detail.id} 已定位到当前 Codegen View`);
    return;
  }
  if (detail.action === "updateMeta") {
    updateMeta(detail);
    return;
  }
  if (detail.action === "scanCandidates") {
    await scanCandidates();
    return;
  }
  if (detail.action === "applyAll") {
    await applyAll();
    return;
  }
  shell.setStatus(`Desk Host 尚未接入 ${detail.action}；共享 UI 已保留该能力入口`);
}

function handleSelection(event: Event): void {
  const detail = (event as CustomEvent<KtCodegenControlSelectionDetail>).detail;
  store.setSelectedBlocks(detail.blockKeys);
  shell.scheduleWorkbenchSave();
}

async function handleReportAction(detail: KtCodegenApplyReportActionDetail): Promise<void> {
  if (detail.action === "openDocument") {
    const tabId = shell.openKtCodegenDocument(detail.documentId);
    if (tabId) shell.setStatus(`已在独立 View 打开 ${detail.documentId}`);
    return;
  }
  if (/\.json$/iu.test(detail.path)) {
    const tabId = shell.openKtCodegenDocument(detail.path);
    if (tabId) shell.setStatus(`已在独立 View 打开 ${detail.path}`);
    return;
  }
  const line = Math.max(0, (detail.line ?? 1) - 1);
  const preview = await store.previewPath(detail.path, line);
  if (!preview) {
    shell.setStatus(sourcePreviewError.value || `无法读取 ${detail.path}:${line + 1}`);
    return;
  }
  sourceDialogOpen.value = true;
  shell.setStatus(`正在查看报告问题 ${preview.path}:${preview.focus_start_line + 1}`);
}

onMounted(() => {
  if (!documents.value.length) void refresh();
  discoveryPoll = setInterval(() => void store.discover().catch(() => undefined), 15_000);
});

onUnmounted(() => {
  if (discoveryPoll) clearInterval(discoveryPoll);
  discoveryPoll = null;
  store.cancelDiscovery();
});
</script>

<template>
  <section class="codegen-sidebar" aria-label="KT Codegen Primary">
    <header class="primary-host-title">
      <strong>自动代码</strong>
      <span>KT Codegen Primary</span>
    </header>
    <kt-codegen-primary-panel
      ref="panelRef"
      class="primary-panel"
      @kt-codegen-control-selection-change="handleSelection"
      @kt-codegen-primary-action="handleAction"
    />
    <KtCodegenBatchReportDialog
      v-model="reportDialogOpen"
      :report="selectedReport"
      @action="handleReportAction"
    />
    <KtCodegenSourceViewerDialog
      v-model="sourceDialogOpen"
      title="报告源码位置"
      :preview="sourcePreview"
      :loading="sourcePreviewLoading"
      :error="sourcePreviewError"
    />
    <footer role="status" aria-live="polite" :title="status">{{ status }}</footer>
  </section>
</template>

<style scoped>
.codegen-sidebar { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; color: var(--text); background: var(--sidebar-bg); }
.primary-host-title { display: flex; min-height: 39px; flex: 0 0 auto; align-items: baseline; gap: 7px; padding: 8px 9px; background: var(--panel-head-bg); border-bottom: 1px solid var(--border); }
.primary-host-title strong { font-size: 0.8rem; }
.primary-host-title span { color: var(--muted); font-size: 0.63rem; }
.primary-panel { flex: 1 1 auto; min-height: 0; overflow: auto; }
footer { min-height: 30px; flex: 0 0 auto; overflow: hidden; padding: 7px 9px; color: var(--muted); background: var(--panel-head-bg); border-top: 1px solid var(--border); font-size: 0.67rem; text-overflow: ellipsis; white-space: nowrap; }
</style>
