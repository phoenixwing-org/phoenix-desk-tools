<script setup lang="ts">
import { computed } from "vue";
import { Document } from "@element-plus/icons-vue";
import { useAppShell } from "../../composables/useAppShell";

const shell = useAppShell();

const logOpen = computed(() => shell.shellLayout.value.log_panel_open);

async function toggleLog() {
  const next = !logOpen.value;
  await shell.setLogOpen(next);
  if (next) {
    await shell.persistShellLayout({ right_panel_open: true });
  }
  shell.setStatus(next ? "已展开运行日志" : "已收起运行日志");
}
</script>

<template>
  <button
    type="button"
    class="ribbon-log-toggle"
    :class="{ active: logOpen }"
    :title="logOpen ? '收起运行日志' : '展开运行日志'"
    @click="toggleLog"
  >
    <Document class="ribbon-log-icon" aria-hidden="true" />
    <span class="ribbon-log-label">运行日志</span>
  </button>
</template>

<style scoped>
.ribbon-log-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 36px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: transparent;
  color: var(--text, #334155);
  font-size: 0.72rem;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
}

.ribbon-log-toggle:hover {
  background: var(--ribbon-btn-hover, rgba(148, 163, 184, 0.15));
  border-color: var(--border, #e2e8f0);
}

.ribbon-log-toggle.active {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.ribbon-log-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.ribbon-log-toggle.active .ribbon-log-icon {
  color: #1d4ed8;
}
</style>
