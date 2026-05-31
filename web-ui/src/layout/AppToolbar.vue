<script setup lang="ts">
import { computed, ref } from "vue";
import { removeRecentWorkspace } from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();
const recentOpen = ref(false);

const title = computed(() => shell.appConfig.value?.title ?? "FreeCAD 管理工具");
const recent = computed(() => shell.launcher.value?.recent_workspaces ?? []);
const workspacePath = computed(() => shell.workspacePath.value);
const workspaceShort = computed(() => {
  const p = workspacePath.value;
  if (!p) return "—";
  return p.length > 48 ? "…" + p.slice(-45) : p;
});

async function pickRecent(path: string) {
  recentOpen.value = false;
  if (path === workspacePath.value) return;
  if (!window.confirm(`切换到工作空间？\n\n${path}`)) return;
  try {
    await shell.switchWorkspace(path);
  } catch (e) {
    shell.setStatus(String(e));
  }
}

async function removeRecent(path: string, event: MouseEvent) {
  event.stopPropagation();
  if (!window.confirm(`从最近列表中移除？\n\n${path}`)) return;
  try {
    await removeRecentWorkspace(path);
    await shell.reloadLauncher();
    shell.setStatus("已从最近列表移除");
  } catch (e) {
    shell.setStatus(String(e));
  }
}

function openConfig() {
  recentOpen.value = false;
  shell.goToPage("home");
}
</script>

<template>
  <header class="toolbar">
    <div class="toolbar-left">
      <span class="app-title">{{ title }}</span>
      <span class="workspace-chip" :title="workspacePath">{{ workspaceShort }}</span>
    </div>
    <div class="toolbar-actions">
      <div class="recent-wrap">
        <button type="button" class="tb-btn" @click="recentOpen = !recentOpen">最近 ▾</button>
        <div v-if="recentOpen" class="recent-menu">
          <div v-for="p in recent" :key="p" class="recent-row">
            <button
              type="button"
              class="recent-item"
              :class="{ current: p === workspacePath }"
              @click="pickRecent(p)"
            >
              {{ p === workspacePath ? "● " : "" }}{{ p }}
            </button>
            <button
              type="button"
              class="recent-remove"
              title="从最近列表移除"
              @click="removeRecent(p, $event)"
            >
              ×
            </button>
          </div>
          <p v-if="!recent.length" class="recent-empty">尚无记录</p>
          <button v-if="recent.length" type="button" class="recent-manage" @click="openConfig">
            管理最近列表…
          </button>
        </div>
      </div>
      <button type="button" class="tb-btn primary" @click="openConfig">配置</button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 8px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.app-title {
  font-weight: 600;
  font-size: 0.92rem;
  white-space: nowrap;
}

.workspace-chip {
  font-size: 0.78rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(420px, 40vw);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tb-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.85rem;
}

.tb-btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.recent-wrap {
  position: relative;
}

.recent-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 320px;
  max-width: min(520px, 90vw);
  max-height: 280px;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  z-index: 20;
  padding: 6px;
}

.recent-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
  margin-bottom: 2px;
}

.recent-item {
  flex: 1;
  display: block;
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 0.82rem;
  word-break: break-all;
}

.recent-item:hover {
  background: #eef2ff;
}

.recent-item.current {
  background: #dbeafe;
  font-weight: 500;
}

.recent-remove {
  flex-shrink: 0;
  width: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1;
}

.recent-remove:hover {
  background: #fee2e2;
  color: #b91c1c;
}

.recent-manage {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 10px;
  border: none;
  border-top: 1px solid var(--border);
  border-radius: 0 0 6px 6px;
  background: transparent;
  font-size: 0.78rem;
  color: var(--muted);
  text-align: left;
}

.recent-manage:hover {
  background: #f8fafc;
  color: var(--accent);
}

.recent-empty {
  margin: 8px;
  font-size: 0.82rem;
  color: var(--muted);
}
</style>
