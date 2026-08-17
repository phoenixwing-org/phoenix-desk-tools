<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  ktCodegenDefineControlPanelElement,
  type KtCodegenControlCopyEndDetail,
  type KtCodegenControlOpenDetail,
  type KtCodegenControlPanel,
  type KtCodegenControlSplitDetail,
} from "@phoenix-wing/kt-codegen/ui";
import { useAppShell } from "../../composables/useAppShell";
import { buildKtCodegenControlUiModel } from "../../models/ktCodegenControlUi";
import { useKtCodegenStore } from "../../stores/ktCodegen";
import KtCodegenSourceViewerDialog from "./KtCodegenSourceViewerDialog.vue";

ktCodegenDefineControlPanelElement();

const props = withDefaults(defineProps<{ workbenchTabId?: string }>(), { workbenchTabId: "" });
const open = defineModel<boolean>({ default: false });
const shell = useAppShell();
const store = useKtCodegenStore(props.workbenchTabId);
const {
  active,
  preflightView,
  preflightViewState,
  lastApply,
  selectedBlockKeys,
  sourcePreview,
  sourcePreviewError,
  sourcePreviewLoading,
  status,
} = storeToRefs(store);
const panelRef = ref<KtCodegenControlPanel | null>(null);
const splitRatio = ref(42);
const sourceDialogOpen = ref(false);

const model = computed(() => buildKtCodegenControlUiModel({
  documentId: active.value?.path ?? "",
  fileName: active.value?.file_name ?? "KT Codegen",
  selectedBlockKeys: selectedBlockKeys.value,
  preflight: preflightView.value,
  state: preflightViewState.value,
  message: status.value,
  lastApply: lastApply.value,
}));
const issueCount = computed(() => preflightView.value?.plan.diagnostics
  .filter((item) => item.severity !== "info").length ?? 0);

watch(model, async (value) => {
  await nextTick();
  if (!panelRef.value) return;
  panelRef.value.splitRatio = splitRatio.value;
  panelRef.value.model = value;
}, { immediate: true, deep: true });

watch(preflightView, (value, previous) => {
  if (value && !previous) open.value = true;
});

function syncOpen(event: Event): void {
  open.value = (event.currentTarget as HTMLDetailsElement).open;
}

async function openSource(event: Event): Promise<void> {
  const detail = (event as CustomEvent<KtCodegenControlOpenDetail>).detail;
  const preview = await store.previewLocation(detail.path, detail.line);
  if (!preview) {
    shell.setStatus(sourcePreviewError.value || `无法读取 ${detail.path}:${detail.line + 1}`);
    return;
  }
  sourceDialogOpen.value = true;
  shell.setStatus(`正在查看 ${preview.path}:${detail.line + 1}`);
}

async function copyEnd(event: Event): Promise<void> {
  const detail = (event as CustomEvent<KtCodegenControlCopyEndDetail>).detail;
  try {
    await navigator.clipboard.writeText(detail.expectedEnd);
    shell.setStatus(`已复制 ${detail.blockKey} 的 END 控制符`);
  } catch (error) {
    shell.setStatus(`复制 END 失败：${String(error)}`);
  }
}

function rememberSplit(event: Event): void {
  splitRatio.value = (event as CustomEvent<KtCodegenControlSplitDetail>).detail.ratio;
}
</script>

<template>
  <details :open="open" class="preflight-block" @toggle="syncOpen">
    <summary>
      <span>预检结果</span>
      <small v-if="preflightView">{{ preflightView.plan.markerRegions.length }} 命中 · {{ issueCount }} 问题</small>
      <small v-else>尚未预检</small>
    </summary>
    <kt-codegen-control-panel
      ref="panelRef"
      @kt-codegen-control-copy-end="copyEnd"
      @kt-codegen-control-open="openSource"
      @kt-codegen-control-split-change="rememberSplit"
    />
  </details>
  <KtCodegenSourceViewerDialog
    v-model="sourceDialogOpen"
    :preview="sourcePreview"
    :loading="sourcePreviewLoading"
    :error="sourcePreviewError"
  />
</template>

<style scoped>
.preflight-block {
  position: relative;
  flex: 0 0 auto;
  margin: 0 8px 8px;
  overflow: visible;
  color: var(--text);
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.preflight-block > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  color: var(--muted);
  background: var(--panel-head-bg);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.preflight-block > summary::-webkit-details-marker { display: none; }
.preflight-block > summary::before { content: "›"; font-size: 18px; line-height: 1; }
.preflight-block[open] > summary::before { transform: rotate(90deg); }
.preflight-block > summary > span { color: var(--text); font-size: 0.72rem; font-weight: 650; }
.preflight-block > summary > small { margin-left: auto; overflow: hidden; color: var(--muted); font-size: 0.65rem; text-overflow: ellipsis; white-space: nowrap; }
kt-codegen-control-panel {
  display: block;
  min-height: 0;
  --pnw-codegen-detail-sticky-top: 58px;
  --pnw-codegen-detail-height: min(520px, calc(100vh - 120px));
}
</style>
