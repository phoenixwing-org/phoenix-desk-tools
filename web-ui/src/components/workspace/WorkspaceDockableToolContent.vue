<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { PnwSelect, type PnwSelectOption } from "phoenix-wing";
import { useAppShell } from "../../composables/useAppShell";
import { useWorkspaceSwitcher } from "../../composables/useWorkspaceSwitcher";

const shell = useAppShell();
const switcher = useWorkspaceSwitcher(shell);
const selectedPath = ref(shell.workspacePath.value);
const switching = ref(false);

const phaseLabel = computed(() => {
  const phase = shell.workspaceState.value.phase;
  if (phase === "open") return "已打开";
  if (phase === "closed") return "未打开";
  if (phase === "preparing-switch") return "正在准备切换";
  if (phase === "opening-target") return "正在打开目标";
  if (phase === "preparing-close") return "正在关闭";
  return "正在打开";
});

const recentOptions = computed<readonly PnwSelectOption[]>(() => shell.workspaceState.value.recent.map((entry) => ({
  value: entry.rootPath,
  label: entry.availability === "available" ? entry.name : `${entry.name}（不可用）`,
  disabled: entry.availability !== "available",
})));

watch(() => shell.workspacePath.value, (path) => {
  selectedPath.value = path;
});

async function selectWorkspace(path: string) {
  selectedPath.value = path;
  if (!path || path === shell.workspacePath.value || switching.value) return;
  switching.value = true;
  try {
    await switcher.pickRecent(path);
  } finally {
    selectedPath.value = shell.workspacePath.value;
    switching.value = false;
  }
}
</script>

<template>
  <div class="workspace-tool-content">
    <div class="workspace-tool-current">
      <span>{{ phaseLabel }}</span>
      <strong :title="shell.workspacePath.value">
        {{ shell.workspacePath.value || "尚未选择工作空间" }}
      </strong>
    </div>

    <label v-if="recentOptions.length" class="workspace-tool-field">
      <span>最近工作空间</span>
      <PnwSelect
        :model-value="selectedPath"
        :options="recentOptions"
        size="compact"
        aria-label="最近工作空间"
        :disabled="switching"
        @update:model-value="selectWorkspace"
      />
    </label>

    <p v-if="shell.workspaceState.value.error" class="workspace-tool-error" role="alert">
      {{ shell.workspaceState.value.error.message }}
    </p>

    <div class="workspace-tool-actions">
      <button type="button" @click="switcher.openConfig">选择目录…</button>
      <button
        v-if="shell.workspacePath.value"
        type="button"
        :disabled="switching"
        @click="switcher.closeCurrentWorkspace"
      >关闭工作空间</button>
    </div>
  </div>
</template>

<style scoped>
.workspace-tool-content {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  color: var(--pnw-workbench-text, var(--text));
  font-size: 12px;
}
.workspace-tool-current { display: grid; gap: 3px; min-width: 0; }
.workspace-tool-current span,
.workspace-tool-field > span { color: var(--pnw-workbench-muted, var(--muted)); font-size: 11px; }
.workspace-tool-current strong {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-tool-field { display: grid; gap: 5px; min-width: 0; }
.workspace-tool-error { margin: 0; color: var(--phoenix-danger-text, #b42318); line-height: 1.4; }
.workspace-tool-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.workspace-tool-actions button {
  min-height: 27px;
  padding: 4px 9px;
  border: 1px solid var(--pnw-control-border, var(--border));
  border-radius: 4px;
  color: inherit;
  background: var(--pnw-control-bg, var(--panel-bg));
  cursor: pointer;
  font: inherit;
}
.workspace-tool-actions button:hover:not(:disabled) {
  border-color: var(--pnw-focus-ring, var(--accent));
  background: var(--pnw-control-hover-bg, var(--panel-head-bg));
}
.workspace-tool-actions button:disabled { opacity: 0.55; cursor: default; }
</style>
