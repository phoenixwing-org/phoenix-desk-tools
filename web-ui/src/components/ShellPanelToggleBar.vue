<script setup lang="ts">
import WorkbenchPanelToggleIcon from "./workbench/WorkbenchPanelToggleIcon.vue";
import { useShellPanelToggles } from "../composables/useShellPanelToggles";

const {
  leftSidebarOpen,
  rightSidebarOpen,
  logOpen: bottomPanelOpen,
  leftSidebarTip,
  rightSidebarTip,
  logTip: bottomPanelTip,
  toggleLeftSidebar,
  toggleRightSidebar,
  toggleLog: toggleBottomPanel,
} = useShellPanelToggles();
</script>

<template>
  <div
    class="workbench-layout-toggles"
    role="group"
    aria-label="工作台布局"
  >
    <button
      type="button"
      class="layout-toggle"
      :class="{ active: leftSidebarOpen }"
      :title="leftSidebarTip"
      :aria-label="leftSidebarTip"
      :aria-pressed="leftSidebarOpen"
      @click="toggleLeftSidebar"
    >
      <WorkbenchPanelToggleIcon side="left" :active="leftSidebarOpen" />
      <span class="layout-label">左侧</span>
    </button>
    <button
      type="button"
      class="layout-toggle"
      :class="{ active: bottomPanelOpen }"
      :title="bottomPanelTip"
      :aria-label="bottomPanelTip"
      :aria-pressed="bottomPanelOpen"
      @click="toggleBottomPanel"
    >
      <WorkbenchPanelToggleIcon side="bottom" :active="bottomPanelOpen" />
      <span class="layout-label">下方</span>
    </button>
    <button
      type="button"
      class="layout-toggle"
      :class="{ active: rightSidebarOpen }"
      :title="rightSidebarTip"
      :aria-label="rightSidebarTip"
      :aria-pressed="rightSidebarOpen"
      @click="toggleRightSidebar"
    >
      <WorkbenchPanelToggleIcon side="right" :active="rightSidebarOpen" />
      <span class="layout-label">右侧</span>
    </button>
  </div>
</template>

<style scoped>
.workbench-layout-toggles { display: inline-flex; align-items: center; gap: 3px; }
.layout-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  box-sizing: border-box;
  padding: 0;
  color: var(--muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.layout-toggle:hover { color: var(--text); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.layout-toggle.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.layout-toggle:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
.layout-label { display: none; font-size: 0.66rem; white-space: nowrap; }

.layout-toggle { width: 27px; height: 24px; }
:deep(.workbench-panel-toggle-icon) { width: 18px; height: 18px; }
</style>
