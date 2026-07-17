<script setup lang="ts">
import WorkbenchPanelToggleIcon from "./workbench/WorkbenchPanelToggleIcon.vue";
import { useShellPanelToggles } from "../composables/useShellPanelToggles";

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const {
  leftSidebarOpen,
  rightSidebarOpen,
  logOpen: bottomPanelOpen,
  toggleLeftSidebar,
  toggleRightSidebar,
  toggleLog: toggleBottomPanel,
} = useShellPanelToggles();

function setPanel(open: boolean, current: boolean, toggle: () => void | Promise<void>): void {
  if (open === current) return;
  void toggle();
}
</script>

<template>
  <div class="side-dock-panel" :class="{ compact }">
    <div class="layout-row">
      <WorkbenchPanelToggleIcon side="left" :active="leftSidebarOpen" />
      <div><strong>左侧 Primary</strong><span>页面范围、筛选和上下文</span></div>
      <el-switch
        :model-value="leftSidebarOpen"
        size="small"
        @update:model-value="(value: string | number | boolean) => setPanel(Boolean(value), leftSidebarOpen, toggleLeftSidebar)"
      />
    </div>
    <div class="layout-row">
      <WorkbenchPanelToggleIcon side="bottom" :active="bottomPanelOpen" />
      <div><strong>下方全局面板</strong><span>预检、问题与所有运行日志</span></div>
      <el-switch
        :model-value="bottomPanelOpen"
        size="small"
        @update:model-value="(value: string | number | boolean) => setPanel(Boolean(value), bottomPanelOpen, toggleBottomPanel)"
      />
    </div>
    <div class="layout-row">
      <WorkbenchPanelToggleIcon side="right" :active="rightSidebarOpen" />
      <div><strong>右侧 Secondary</strong><span>工作空间树、属性和系统块</span></div>
      <el-switch
        :model-value="rightSidebarOpen"
        size="small"
        @update:model-value="(value: string | number | boolean) => setPanel(Boolean(value), rightSidebarOpen, toggleRightSidebar)"
      />
    </div>
    <p v-if="!compact" class="dock-hint">
      工作台固定为左、下、右三个区域；运行日志只能显示在下方全局面板。
    </p>
  </div>
</template>

<style scoped>
.side-dock-panel.compact { min-width: 268px; }
.layout-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.layout-row:last-of-type { border-bottom: 0; }
.layout-row > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.layout-row strong { color: var(--el-text-color-primary); font-size: 13px; }
.layout-row span { color: var(--el-text-color-secondary); font-size: 11px; }
.layout-row :deep(.workbench-panel-toggle-icon) { color: var(--el-text-color-secondary); }
.dock-hint { margin: 10px 0 4px; color: var(--muted, #64748b); font-size: 0.78rem; line-height: 1.55; }
</style>
