<script setup lang="ts">
import { computed } from "vue";
import ShellPanelToggleBar from "../components/ShellPanelToggleBar.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

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
</script>

<template>
  <footer class="status">
    <span class="status-main">{{ line }}</span>
    <ShellPanelToggleBar variant="footer" />
  </footer>
</template>

<style scoped>
.status {
  height: var(--phoenix-status-height);
  flex-shrink: 0;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--phoenix-text-muted);
  background: var(--phoenix-bg-toolbar);
  border-top: 1px solid var(--phoenix-border);
}

.status-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
