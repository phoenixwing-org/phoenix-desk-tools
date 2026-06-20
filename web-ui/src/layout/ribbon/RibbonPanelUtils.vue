<script setup lang="ts">
import { computed, ref } from "vue";
import { Collection, Document, FolderOpened, Operation } from "@element-plus/icons-vue";
import SideDockPrefsPanel from "../../components/SideDockPrefsPanel.vue";
import { useAppShell } from "../../composables/useAppShell";
import RibbonUtilButton from "./RibbonUtilButton.vue";

const shell = useAppShell();
const sideDockOpen = ref(false);

const panelOpen = computed(() => shell.shellLayout.value.right_panel_open);
const logOpen = computed(() => shell.shellLayout.value.log_panel_open);

async function togglePanel() {
  const next = !panelOpen.value;
  await shell.persistShellLayout({ right_panel_open: next });
  shell.setStatus(next ? "已展开侧栏" : "已收起侧栏");
}

async function toggleLog() {
  const next = !logOpen.value;
  await shell.setLogOpen(next);
  if (next) {
    await shell.persistShellLayout({ right_panel_open: true });
  }
  shell.setStatus(next ? "已展开运行日志" : "已收起运行日志");
}

async function openWorksetPanel() {
  await shell.openWorksetSidebar();
  shell.setStatus("已打开侧栏 · 工作集");
}
</script>

<template>
  <div class="ribbon-panel-utils-inner">
    <RibbonUtilButton
      label="工作空间树"
      :active="panelOpen"
      :title="panelOpen ? '收起侧栏（工作空间树 / 日志）' : '展开侧栏'"
      @click="togglePanel"
    >
      <template #icon><FolderOpened /></template>
    </RibbonUtilButton>

    <RibbonUtilButton
      label="工作集"
      title="侧栏 · 文件工作集（系统）"
      @click="openWorksetPanel"
    >
      <template #icon><Collection /></template>
    </RibbonUtilButton>

    <RibbonUtilButton
      label="运行日志"
      :active="logOpen"
      :title="logOpen ? '收起运行日志' : '展开运行日志'"
      @click="toggleLog"
    >
      <template #icon><Document /></template>
    </RibbonUtilButton>

    <el-popover
      v-model:visible="sideDockOpen"
      placement="bottom-end"
      :width="280"
      trigger="click"
      popper-class="ribbon-side-dock-popover"
      title="侧栏停靠"
    >
      <template #reference>
        <RibbonUtilButton
          label="侧栏"
          :active="sideDockOpen"
          title="工作空间树 / 运行日志 左·右停靠"
        >
          <template #icon><Operation /></template>
        </RibbonUtilButton>
      </template>
      <SideDockPrefsPanel compact :show-log-switch="false" />
    </el-popover>
  </div>
</template>

<style scoped>
.ribbon-panel-utils-inner {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
</style>

<style>
.ribbon-side-dock-popover {
  z-index: 8000 !important;
}
</style>
