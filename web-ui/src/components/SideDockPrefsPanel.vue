<script setup lang="ts">
import type { SideDock } from "../types/config";
import { useSideDockPrefs } from "../composables/useSideDockPrefs";

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const {
  treeDock,
  logDock,
  propsDock,
  treePanelOpen,
  logPanelOpen,
  propsPanelOpen,
  gitCommitPanelOpen,
  gitCommitDock,
  onGitPage,
  setTreeDock,
  setLogDock,
  setPropsDock,
  setGitCommitDock,
  setTreePanelOpen,
  setLogPanelOpen,
  setPropsPanelOpen,
  setGitCommitPanelOpen,
} = useSideDockPrefs();

function onDockChange(
  setter: (side: SideDock) => void | Promise<void>,
  v: SideDock | string | number | boolean | undefined,
) {
  if (v === "left" || v === "right") void setter(v);
}

function onOpenChange(setter: (open: boolean) => void | Promise<void>, v: string | number | boolean) {
  void setter(Boolean(v));
}
</script>

<template>
  <div class="side-dock-panel" :class="{ compact }">
    <el-form label-position="top" class="dock-form">
      <div class="dock-block-list" role="list">
        <div class="dock-block-row" role="listitem">
          <span class="dock-block-label">工作空间树</span>
          <el-radio-group
            :model-value="treeDock"
            size="small"
            class="dock-side-group"
            @update:model-value="(v) => onDockChange(setTreeDock, v)"
          >
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
          <div class="dock-block-show">
            <span class="dock-show-label">显示</span>
            <el-switch
              :model-value="treePanelOpen"
              size="small"
              @update:model-value="(v) => onOpenChange(setTreePanelOpen, v)"
            />
          </div>
        </div>

        <div class="dock-block-row" role="listitem">
          <span class="dock-block-label">页面属性</span>
          <el-radio-group
            :model-value="propsDock"
            size="small"
            class="dock-side-group"
            @update:model-value="(v) => onDockChange(setPropsDock, v)"
          >
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
          <div class="dock-block-show">
            <span class="dock-show-label">显示</span>
            <el-switch
              :model-value="propsPanelOpen"
              size="small"
              @update:model-value="(v) => onOpenChange(setPropsPanelOpen, v)"
            />
          </div>
        </div>

        <div v-if="onGitPage" class="dock-block-row" role="listitem">
          <span class="dock-block-label">Git 提交</span>
          <el-radio-group
            :model-value="gitCommitDock"
            size="small"
            class="dock-side-group"
            @update:model-value="(v) => onDockChange(setGitCommitDock, v)"
          >
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
          <div class="dock-block-show">
            <span class="dock-show-label">显示</span>
            <el-switch
              :model-value="gitCommitPanelOpen"
              size="small"
              @update:model-value="(v) => onOpenChange(setGitCommitPanelOpen, v)"
            />
          </div>
        </div>

        <div class="dock-block-row" role="listitem">
          <span class="dock-block-label">运行日志</span>
          <el-radio-group
            :model-value="logDock"
            size="small"
            class="dock-side-group"
            @update:model-value="(v) => onDockChange(setLogDock, v)"
          >
            <el-radio-button value="left">左</el-radio-button>
            <el-radio-button value="right">右</el-radio-button>
          </el-radio-group>
          <div class="dock-block-show">
            <span class="dock-show-label">显示</span>
            <el-switch
              :model-value="logPanelOpen"
              size="small"
              @update:model-value="(v) => onOpenChange(setLogPanelOpen, v)"
            />
          </div>
        </div>
      </div>
    </el-form>
    <p v-if="!compact" class="dock-hint">
      每块可独立选左/右停靠与是否显示。页脚 <strong>左栏 / 右栏</strong> 图标可收起整侧（类似 VS Code）。
    </p>
  </div>
</template>

<style scoped>
.side-dock-panel.compact {
  min-width: 268px;
}

.dock-block-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
}

.dock-block-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
}

.dock-block-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.dock-block-row:first-child {
  padding-top: 0;
}

.dock-block-label {
  min-width: 0;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.dock-side-group {
  flex-shrink: 0;
}

.dock-side-group :deep(.el-radio-button__inner) {
  padding: 4px 10px;
}

.dock-block-show {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.dock-block-inherit {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.dock-show-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.dock-hint {
  margin: 10px 0 4px;
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--muted, #64748b);
}
</style>
