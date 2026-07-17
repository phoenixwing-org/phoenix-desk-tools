<script setup lang="ts">
import { computed, onUnmounted, toValue } from "vue";
import { useAppShell } from "../../composables/useAppShell";
import {
  useGlobalWorkbenchBottomContribution,
  useWorkbenchBottomPanelState,
  type WorkbenchBottomContributionTab,
} from "../../composables/useWorkbenchBottomContribution";
import WorkbenchBottomPanel, { type WorkbenchBottomPanelTab } from "./WorkbenchBottomPanel.vue";

const shell = useAppShell();
const contribution = useGlobalWorkbenchBottomContribution();
const panelState = useWorkbenchBottomPanelState();
let heightPersistTimer: ReturnType<typeof setTimeout> | null = null;

const runtimeLogLineCount = computed(() => shell.logText.value
  .split(/\r?\n/)
  .filter(Boolean)
  .length);
const contributedTabs = computed(() => contribution.value ? toValue(contribution.value.tabs) : []);
const sourceLabel = computed(() => {
  const value = contribution.value?.sourceLabel;
  return value ? toValue(value) : "工作台";
});
const contributionSummary = computed(() => {
  const value = contribution.value?.summary;
  return value ? toValue(value) : "";
});
const contributionProps = computed(() => {
  const value = contribution.value?.props;
  return value ? toValue(value) : {};
});

function resolveTab(id: "preflight" | "problems", label: string): WorkbenchBottomPanelTab {
  const tab = contributedTabs.value.find((item) => item.id === id);
  if (!tab) return { id, label, count: 0 };
  return {
    id,
    label: tab.label,
    count: tab.count == null ? undefined : toValue(tab.count),
    tone: tab.tone == null ? undefined : toValue(tab.tone),
  };
}

const tabs = computed<readonly WorkbenchBottomPanelTab[]>(() => [
  resolveTab("preflight", "预检"),
  resolveTab("problems", "问题"),
  { id: "output", label: "运行日志", count: runtimeLogLineCount.value },
]);
const activeTab = computed({
  get: () => panelState.activeTab.value,
  set: (value: string) => panelState.setActiveTab(value as "preflight" | "problems" | "output"),
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
const summary = computed(() => {
  if (activeTab.value === "output") return `全局运行日志 · ${runtimeLogLineCount.value} 行`;
  if (contributionSummary.value) return `${sourceLabel.value} · ${contributionSummary.value}`;
  return "全局面板会保留最近的预检与问题；切换 View 不会销毁";
});

function contentTab(tab: WorkbenchBottomContributionTab["id"]) {
  return contributedTabs.value.find((item) => item.id === tab);
}

onUnmounted(() => {
  if (heightPersistTimer) clearTimeout(heightPersistTimer);
  heightPersistTimer = null;
});
</script>

<template>
  <WorkbenchBottomPanel
    v-model="activeTab"
    v-model:expanded="expanded"
    v-model:height="height"
    :tabs="tabs"
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
</template>

<style scoped>
.global-workbench-bottom-panel { width: 100%; }
.global-panel-empty { display: grid; height: 100%; margin: 0; padding: 20px; place-items: center; color: var(--muted); font-size: 0.7rem; }
.global-output { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.output-actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; padding: 4px 8px; color: var(--muted); background: var(--panel-head-bg); border-bottom: 1px solid var(--border); font-size: 0.62rem; }
.output-actions button { padding: 2px 7px; color: inherit; background: transparent; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; font-size: inherit; }
.output-actions button:disabled { opacity: 0.45; cursor: default; }
.global-output pre { flex: 1 1 auto; min-height: 0; margin: 0; overflow: auto; padding: 8px 10px; color: var(--text); background: color-mix(in srgb, var(--sidebar-bg) 70%, transparent); font: 0.66rem/1.45 ui-monospace, monospace; white-space: pre-wrap; }
</style>
