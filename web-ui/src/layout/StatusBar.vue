<script setup lang="ts">
import { computed } from "vue";
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
  <footer class="status">{{ line }}</footer>
</template>

<style scoped>
.status {
  height: 28px;
  flex-shrink: 0;
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-size: 0.78rem;
  color: var(--muted);
  background: var(--toolbar-bg);
  border-top: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
