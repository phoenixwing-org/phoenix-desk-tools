<script setup lang="ts">
import { computed, onUnmounted, watch } from "vue";
import {
  useWorkbenchBottomPanelState,
} from "../../composables/useWorkbenchBottomContribution";
import { usePdtWorkbenchBottomPanel } from "../../composables/usePdtWorkbenchBottomPanel";
import WorkbenchBottomPanel from "./WorkbenchBottomPanel.vue";

const props = withDefaults(defineProps<{
  /** 由 PnwWorkbenchShell 提供外层标签与尺寸时只渲染内容。 */
  embedded?: boolean;
  activeTabId?: string;
}>(), {
  embedded: false,
  activeTabId: "output",
});

const {
  shell,
  contribution,
  contributionProps,
  tabs: pnwTabs,
  contentTab,
  summary: pnwSummary,
} = usePdtWorkbenchBottomPanel();
const panelState = useWorkbenchBottomPanelState();
let heightPersistTimer: ReturnType<typeof setTimeout> | null = null;

const activeTab = computed({
  get: () => props.embedded ? props.activeTabId : panelState.activeTab.value,
  set: (value: string) => {
    if (!props.embedded) panelState.setActiveTab(value as "preflight" | "problems" | "output");
  },
});
const expanded = computed({
  get: () => shell.shellLayout.value.log_panel_open,
  set: (value: boolean) => {
    void shell.setLogOpen(value);
  },
});
const height = computed({
  get: () => shell.shellLayout.value.log_panel_height_px,
  set: (value: number) => {
    const next = Math.round(value);
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      log_panel_height_px: next,
    };
    if (heightPersistTimer) clearTimeout(heightPersistTimer);
    heightPersistTimer = setTimeout(() => {
      heightPersistTimer = null;
      void shell.persistShellLayout({ log_panel_height_px: next });
    }, 180);
  },
});
const summary = computed(() => pnwSummary(activeTab.value));

watch(pnwTabs, (available) => {
  if (available.some((tab) => tab.id === activeTab.value)) return;
  activeTab.value = available[0]?.id ?? "output";
}, { immediate: true });

onUnmounted(() => {
  if (heightPersistTimer) clearTimeout(heightPersistTimer);
  heightPersistTimer = null;
});
</script>

<template>
  <WorkbenchBottomPanel
    v-if="!embedded"
    v-model="activeTab"
    v-model:expanded="expanded"
    v-model:height="height"
    :tabs="pnwTabs"
    aria-label="全局工作台面板"
    class="global-workbench-bottom-panel"
    data-tour="shell-log"
  >
    <template #summary>{{ summary }}</template>

    <template #preflight>
      <component
        :is="contribution.component"
        v-if="contribution && contentTab('preflight')"
        v-bind="contributionProps"
        panel-tab="preflight"
      />
      <p v-else class="global-panel-empty">当前没有预检结果。</p>
    </template>

    <template #problems>
      <component
        :is="contribution.component"
        v-if="contribution && contentTab('problems')"
        v-bind="contributionProps"
        panel-tab="problems"
      />
      <p v-else class="global-panel-empty">当前没有问题。</p>
    </template>

    <template #output>
      <div class="global-output">
        <div class="output-actions">
          <span>所有模块共用运行日志，不随 View 切换</span>
          <button type="button" :disabled="!shell.logText.value" @click="shell.clearLog()">清空</button>
        </div>
        <pre>{{ shell.logText.value || "尚无运行日志。" }}</pre>
      </div>
    </template>
  </WorkbenchBottomPanel>
  <section v-else class="global-workbench-bottom-panel global-workbench-bottom-panel--embedded">
    <template v-if="activeTab === 'preflight'">
      <component
        :is="contribution.component"
        v-if="contribution && contentTab('preflight')"
        v-bind="contributionProps"
        panel-tab="preflight"
      />
      <p v-else class="global-panel-empty">当前没有预检结果。</p>
    </template>
    <template v-else-if="activeTab === 'problems'">
      <component
        :is="contribution.component"
        v-if="contribution && contentTab('problems')"
        v-bind="contributionProps"
        panel-tab="problems"
      />
      <p v-else class="global-panel-empty">当前没有问题。</p>
    </template>
    <div v-else class="global-output">
      <div class="output-actions">
        <span>所有模块共用运行日志，不随 View 切换</span>
        <button type="button" :disabled="!shell.logText.value" @click="shell.clearLog()">清空</button>
      </div>
      <pre>{{ shell.logText.value || "尚无运行日志。" }}</pre>
    </div>
  </section>
</template>

<style scoped>
.global-workbench-bottom-panel { width: 100%; }
.global-workbench-bottom-panel--embedded { height: 100%; min-height: 0; overflow: hidden; }
.global-panel-empty { display: grid; height: 100%; margin: 0; padding: 20px; place-items: center; color: var(--muted); font-size: 0.7rem; }
.global-output { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.output-actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; padding: 4px 8px; color: var(--muted); background: var(--panel-head-bg); border-bottom: 1px solid var(--border); font-size: 0.62rem; }
.output-actions button { padding: 2px 7px; color: inherit; background: transparent; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; font-size: inherit; }
.output-actions button:disabled { opacity: 0.45; cursor: default; }
.global-output pre { flex: 1 1 auto; min-height: 0; margin: 0; overflow: auto; padding: 8px 10px; color: var(--text); background: color-mix(in srgb, var(--sidebar-bg) 70%, transparent); font: 0.66rem/1.45 ui-monospace, monospace; white-space: pre-wrap; }
</style>
