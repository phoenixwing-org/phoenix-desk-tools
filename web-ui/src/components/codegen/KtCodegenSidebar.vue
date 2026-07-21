<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  ktCodegenDefinePrimaryPanelElement,
  type KtCodegenControlSelectionDetail,
  type KtCodegenPrimaryActionDetail,
  type KtCodegenPrimaryPanel,
} from "@phoenix-wing/kt-codegen/ui";
import { useAppShell } from "../../composables/useAppShell";
import type { PageSideBlockHostProps } from "../../layout/pageRegistry";
import { buildKtCodegenPrimaryUiModel } from "../../models/ktCodegenControlUi";
import { useKtCodegenStore } from "../../stores/ktCodegen";

ktCodegenDefinePrimaryPanelElement();

const props = defineProps<PageSideBlockHostProps>();
const shell = useAppShell();
const store = useKtCodegenStore(props.workbenchTabId);
const {
  active,
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
} = storeToRefs(store);
const panelRef = ref<KtCodegenPrimaryPanel | null>(null);
let discoveryPoll: ReturnType<typeof setInterval> | null = null;

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
  loadingDocuments: loadingDocuments.value,
  applying: applying.value,
  opening: opening.value,
  saving: saving.value,
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

function handleAction(event: Event): void {
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
    shell.openFileDetailForRel(detail.id, { subTab: "edit" });
    shell.setStatus(`已打开控制符候选 ${detail.id}`);
    return;
  }
  if (detail.action === "openReport") {
    shell.setStatus(`Apply 报告 ${detail.id} 已保留在当前 Codegen 会话`);
    return;
  }
  if (detail.action === "updateMeta") {
    updateMeta(detail);
    return;
  }
  shell.setStatus(`Desk Host 尚未接入 ${detail.action}；共享 UI 已保留该能力入口`);
}

function handleSelection(event: Event): void {
  const detail = (event as CustomEvent<KtCodegenControlSelectionDetail>).detail;
  store.setSelectedBlocks(detail.blockKeys);
  shell.scheduleWorkbenchSave();
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
