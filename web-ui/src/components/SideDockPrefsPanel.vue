<script setup lang="ts">
import type { SideDock } from "../types/config";
import { useSideDockPrefs } from "../composables/useSideDockPrefs";

withDefaults(
  defineProps<{
    compact?: boolean;
    showLogSwitch?: boolean;
    showPropsSwitch?: boolean;
  }>(),
  {
    compact: false,
    showLogSwitch: true,
    showPropsSwitch: true,
  },
);

const {
  treeDock,
  logDock,
  propsDock,
  logPanelOpen,
  propsPanelOpen,
  setTreeDock,
  setLogDock,
  setPropsDock,
  setLogPanelOpen,
  setPropsPanelOpen,
} = useSideDockPrefs();

function onTreeChange(v: SideDock | string | number | boolean | undefined) {
  if (v === "left" || v === "right") void setTreeDock(v);
}

function onLogChange(v: SideDock | string | number | boolean | undefined) {
  if (v === "left" || v === "right") void setLogDock(v);
}

function onPropsChange(v: SideDock | string | number | boolean | undefined) {
  if (v === "left" || v === "right") void setPropsDock(v);
}

function onLogOpenChange(open: string | number | boolean) {
  void setLogPanelOpen(Boolean(open));
}

function onPropsOpenChange(open: string | number | boolean) {
  void setPropsPanelOpen(Boolean(open));
}
</script>

<template>
  <div class="side-dock-panel" :class="{ compact }">
    <el-form label-position="top" class="dock-form">
      <el-form-item label="工作空间树停靠">
        <el-radio-group :model-value="treeDock" @update:model-value="onTreeChange">
          <el-radio-button value="left">左侧</el-radio-button>
          <el-radio-button value="right">右侧</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="页面属性停靠">
        <el-radio-group :model-value="propsDock" @update:model-value="onPropsChange">
          <el-radio-button value="left">左侧</el-radio-button>
          <el-radio-button value="right">右侧</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="运行日志停靠">
        <el-radio-group :model-value="logDock" @update:model-value="onLogChange">
          <el-radio-button value="left">左侧</el-radio-button>
          <el-radio-button value="right">右侧</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="showPropsSwitch" label="显示页面属性">
        <el-switch :model-value="propsPanelOpen" @update:model-value="onPropsOpenChange" />
      </el-form-item>
      <el-form-item v-if="showLogSwitch" label="显示运行日志">
        <el-switch :model-value="logPanelOpen" @update:model-value="onLogOpenChange" />
      </el-form-item>
    </el-form>
    <p v-if="!compact" class="dock-hint">
      树、属性、日志可分别选左/右；改停靠时会自动展开侧栏。
    </p>
  </div>
</template>

<style scoped>
.side-dock-panel.compact {
  min-width: 240px;
}

.dock-form :deep(.el-radio-group) {
  display: flex;
  width: 100%;
}

.dock-form :deep(.el-radio-button) {
  flex: 1;
}

.dock-form :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 12px;
}

.dock-hint {
  margin: 0 0 4px;
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--muted, #64748b);
}
</style>
