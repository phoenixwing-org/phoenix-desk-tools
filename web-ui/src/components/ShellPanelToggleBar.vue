<script setup lang="ts">
import { ref } from "vue";
import { Setting } from "@element-plus/icons-vue";
import WorkbenchPanelToggleIcon from "./workbench/WorkbenchPanelToggleIcon.vue";
import SideDockPrefsPanel from "./SideDockPrefsPanel.vue";
import { useShellPanelToggles } from "../composables/useShellPanelToggles";

withDefaults(defineProps<{
  variant?: "ribbon" | "footer";
  layout?: "group" | "inline";
}>(), { variant: "footer", layout: "group" });

const settingsOpen = ref(false);

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
    :class="[`variant-${variant}`, `layout-${layout}`]"
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
    <el-popover
      v-model:visible="settingsOpen"
      :placement="variant === 'ribbon' ? 'bottom-end' : 'top-end'"
      :width="300"
      trigger="click"
      popper-class="shell-panel-layout-popover"
      title="Block 显示"
    >
      <template #reference>
        <span class="settings-reference">
          <button
            type="button"
            class="layout-toggle settings-toggle"
            :class="{ active: settingsOpen }"
            title="设置右侧结构 Block 与下方运行日志是否显示"
            aria-label="右侧与下方 Block 显示设置"
            :aria-pressed="settingsOpen"
          >
            <el-icon><Setting /></el-icon>
            <span class="layout-label">Block 设置</span>
          </button>
        </span>
      </template>
      <SideDockPrefsPanel compact />
    </el-popover>
  </div>
</template>

<style scoped>
.workbench-layout-toggles { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px; }
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
.settings-reference { display: inline-flex; line-height: 0; }
.settings-toggle :deep(.el-icon) { width: 17px; height: 17px; font-size: 17px; }

.layout-toggle { width: 27px; height: 24px; }
:deep(.workbench-panel-toggle-icon) { width: 18px; height: 18px; }

.variant-ribbon { align-self: stretch; padding-left: 5px; border-left: 1px solid var(--ribbon-group-divider, var(--border)); }
.variant-ribbon .layout-toggle { width: auto; min-width: 48px; height: 100%; padding: 3px 7px; flex-direction: column; gap: 2px; border-radius: 0; }
.variant-ribbon .layout-label { display: inline; line-height: 1.1; }
.variant-ribbon.layout-inline { align-self: center; height: 36px; }
.variant-ribbon.layout-inline .layout-toggle { min-width: 0; height: 36px; padding: 0 8px; flex-direction: row; gap: 4px; border-radius: 4px; }
.variant-ribbon.layout-inline .layout-label { font-size: 0.7rem; }
</style>
