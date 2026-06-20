<script setup lang="ts">
import { computed } from "vue";
import { Document } from "@element-plus/icons-vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const logPanelOpen = computed(() => shell.shellLayout.value.log_panel_open);
const hasLogContent = computed(() => Boolean(shell.logText.value.trim()));

const line = computed(() => {
  const parts: string[] = [];
  const nav = shell.currentNavItem.value;
  parts.push(`当前: ${nav?.label ?? shell.currentPage.value}`);
  parts.push(`工作空间: ${shell.workspacePath.value || "—"}`);
  const fc = shell.launcher.value?.freecad_dir;
  if (fc) parts.push(`FreeCAD: ${fc}`);
  if (shell.navHover.value) parts.push(`（${shell.navHover.value}）`);
  if (shell.statusText.value) parts.push(shell.statusText.value);
  return parts.join("  |  ");
});

async function openLogPanel() {
  await shell.setLogOpen(true);
  shell.setStatus("已展开运行日志");
}
</script>

<template>
  <footer class="status">
    <span class="status-main">{{ line }}</span>
    <button
      v-if="!logPanelOpen"
      type="button"
      class="status-log-btn"
      title="展开运行日志（扫描、批量任务等输出）"
      @click="openLogPanel"
    >
      运行日志
      <span v-if="hasLogContent" class="log-pending-dot" aria-label="有未读输出">●</span>
    </button>
  </footer>
</template>

<style scoped>
.status {
  height: 28px;
  flex-shrink: 0;
  padding: 0 8px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--muted);
  background: var(--toolbar-bg);
  border-top: 1px solid var(--border);
}

.status-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-log-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid #c8ced8;
  border-radius: 4px;
  background: linear-gradient(180deg, #fff 0%, #eef1f5 100%);
  color: #334155;
  font-size: 0.72rem;
  cursor: pointer;
}

.status-log-btn:hover {
  border-color: #93c5fd;
  color: #1d4ed8;
  background: #f0f6ff;
}

.log-pending-dot {
  color: #f59e0b;
  font-size: 0.55rem;
  line-height: 1;
}
</style>
