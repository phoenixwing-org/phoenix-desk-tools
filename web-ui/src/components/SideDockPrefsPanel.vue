<script setup lang="ts">
import { computed } from "vue";
import type { ShellLayout } from "../types/config";
import { useAppShell } from "../composables/useAppShell";

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false });

const shell = useAppShell();
const layout = computed(() => shell.shellLayout.value);
const onGitPage = computed(() => shell.currentPage.value === "git");

type BlockVisibilityKey =
  | "right_panel_open"
  | "properties_panel_open"
  | "workset_panel_open"
  | "git_commit_panel_open"
  | "log_panel_open";

async function setBlockVisible(
  key: BlockVisibilityKey,
  open: string | number | boolean,
  label: string,
): Promise<void> {
  const visible = Boolean(open);
  if (layout.value[key] === visible) return;
  await shell.persistShellLayout({ [key]: visible } as Partial<ShellLayout>);
  shell.setStatus(visible ? `已显示${label}` : `已隐藏${label}`);
}
</script>

<template>
  <div class="side-dock-panel" :class="{ compact }">
    <div class="dock-block-list" role="list" aria-label="右侧与下方 Block 显示设置">
      <div class="dock-block-row" role="listitem">
        <div><strong>工作空间树</strong><span>源码目录与工作集 Tab</span></div>
        <span class="dock-position">右侧</span>
        <el-switch
          :model-value="layout.right_panel_open"
          size="small"
          aria-label="显示工作空间树"
          @update:model-value="(v: string | number | boolean) => setBlockVisible('right_panel_open', v, '工作空间树')"
        />
      </div>
      <div class="dock-block-row" role="listitem">
        <div><strong>页面属性</strong><span>当前 View 与页面生成状态</span></div>
        <span class="dock-position">右侧</span>
        <el-switch
          :model-value="layout.properties_panel_open"
          size="small"
          aria-label="显示页面属性"
          @update:model-value="(v: string | number | boolean) => setBlockVisible('properties_panel_open', v, '页面属性')"
        />
      </div>
      <div class="dock-block-row" role="listitem">
        <div><strong>独立工作集</strong><span>与工作空间树同时显示</span></div>
        <span class="dock-position">右侧</span>
        <el-switch
          :model-value="layout.workset_panel_open"
          size="small"
          aria-label="显示独立工作集"
          @update:model-value="(v: string | number | boolean) => setBlockVisible('workset_panel_open', v, '独立工作集')"
        />
      </div>
      <div v-if="onGitPage" class="dock-block-row" role="listitem">
        <div><strong>Git 提交</strong><span>当前仓库提交 Block</span></div>
        <span class="dock-position">右侧</span>
        <el-switch
          :model-value="layout.git_commit_panel_open"
          size="small"
          aria-label="显示 Git 提交"
          @update:model-value="(v: string | number | boolean) => setBlockVisible('git_commit_panel_open', v, 'Git 提交')"
        />
      </div>
      <div class="dock-block-row" role="listitem">
        <div><strong>运行日志</strong><span>问题、预检与所有运行输出</span></div>
        <span class="dock-position bottom">下方</span>
        <el-switch
          :model-value="layout.log_panel_open"
          size="small"
          aria-label="显示运行日志"
          @update:model-value="(v: string | number | boolean) => setBlockVisible('log_panel_open', v, '运行日志')"
        />
      </div>
    </div>
    <p v-if="!compact" class="dock-hint">
      当前壳层固定为右侧结构 Block 与下方全局面板；这里仅控制每个 Block 是否显示。
    </p>
  </div>
</template>

<style scoped>
.side-dock-panel.compact {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.dock-block-list { display: flex; width: 100%; flex-direction: column; }
.dock-block-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.dock-block-row :deep(.el-switch) { flex: 0 0 auto; }
.dock-block-row:first-child { padding-top: 0; }
.dock-block-row:last-child { padding-bottom: 0; border-bottom: 0; }
.dock-block-row > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.dock-block-row strong { color: var(--el-text-color-primary); font-size: 13px; }
.dock-block-row div span { color: var(--el-text-color-secondary); font-size: 11px; }
.dock-position {
  min-width: 38px;
  padding: 2px 6px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 999px;
  font-size: 11px;
  text-align: center;
}
.dock-position.bottom {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success-light-7);
}
.dock-hint { margin: 10px 0 4px; color: var(--muted, #64748b); font-size: 0.78rem; line-height: 1.55; }
</style>
