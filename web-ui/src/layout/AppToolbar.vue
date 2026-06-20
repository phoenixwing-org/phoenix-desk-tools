<script setup lang="ts">
import { computed, ref } from "vue";
import { removeRecentWorkspace } from "../api";
import { NAV_MODULE_OPTIONS } from "../constants/navModules";
import { useAppShell } from "../composables/useAppShell";
import { DEFAULT_APP_TITLE } from "../types/config";
import RibbonTabBar from "./ribbon/RibbonTabBar.vue";

const props = withDefaults(
  defineProps<{
    showRibbonTabs?: boolean;
    ribbonTabs?: { id: string; label: string }[];
    ribbonActiveTab?: string;
    ribbonCollapsed?: boolean;
  }>(),
  {
    showRibbonTabs: false,
    ribbonTabs: () => [],
    ribbonActiveTab: "start",
    ribbonCollapsed: false,
  },
);

const emit = defineEmits<{
  "update:ribbonActiveTab": [id: string];
  "update:ribbonCollapsed": [value: boolean];
}>();

const shell = useAppShell();
const recentOpen = ref(false);

const title = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const recent = computed(() => shell.launcher.value?.recent_workspaces ?? []);
const workspacePath = computed(() => shell.workspacePath.value);
const workspaceShort = computed(() => {
  const p = workspacePath.value;
  if (!p) return "—";
  return p.length > 48 ? "…" + p.slice(-45) : p;
});

function isModuleEnabled(id: string): boolean {
  return shell.enabledNavModules.value.includes(id);
}

function moduleChipTitle(opt: (typeof NAV_MODULE_OPTIONS)[number]): string {
  const on = isModuleEnabled(opt.id);
  return `${opt.label}：${opt.hint}（${on ? "已启用，点击关闭" : "已关闭，点击启用"}）`;
}

async function toggleModule(id: string) {
  await shell.toggleNavModule(id);
}

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

async function toggleRibbon() {
  const next = shell.shellLayout.value.ribbon_mode === 1 ? 0 : 1;
  await shell.persistShellLayout({ ribbon_mode: next });
  shell.setStatus(next === 1 ? "已启用 Ribbon 工具台" : "已恢复左侧导航");
}

function openConfig() {
  recentOpen.value = false;
  shell.goToPage("config");
}

function toggleRibbonCollapsed() {
  emit("update:ribbonCollapsed", !props.ribbonCollapsed);
}
</script>

<template>
  <header class="toolbar" :class="{ 'toolbar-ribbon': showRibbonTabs }">
    <div class="toolbar-left">
      <span class="app-title">{{ title }}</span>
      <div class="module-chips" aria-label="功能模块">
        <button
          v-for="opt in NAV_MODULE_OPTIONS"
          :key="opt.id"
          type="button"
          class="module-chip"
          :class="{ on: isModuleEnabled(opt.id), off: !isModuleEnabled(opt.id) }"
          :title="moduleChipTitle(opt)"
          @click="toggleModule(opt.id)"
        >
          {{ opt.shortLabel }}
        </button>
      </div>
      <span v-if="!showRibbonTabs" class="workspace-chip" :title="workspacePath">{{ workspaceShort }}</span>
    </div>

    <div v-if="showRibbonTabs" class="toolbar-center">
      <RibbonTabBar
        :tabs="ribbonTabs"
        :active-tab="ribbonActiveTab"
        @update:active-tab="emit('update:ribbonActiveTab', $event)"
      />
    </div>
    <span v-else-if="workspacePath" class="workspace-chip toolbar-center-fallback" :title="workspacePath">
      {{ workspaceShort }}
    </span>

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
      <span v-if="showRibbonTabs" class="workspace-chip workspace-chip-compact" :title="workspacePath">
        {{ workspaceShort }}
      </span>
      <button
        v-if="showRibbonTabs"
        type="button"
        class="tb-btn tb-btn-icon"
        :title="ribbonCollapsed ? '展开功能区' : '折叠功能区'"
        @click="toggleRibbonCollapsed"
      >
        {{ ribbonCollapsed ? "▼" : "▲" }}
      </button>
      <button
        type="button"
        class="tb-btn"
        :class="{ 'tb-btn-on': shell.shellLayout.value.ribbon_mode === 1 }"
        title="切换 Ribbon 工具台（或地址栏 ?ribbon=1 预览）"
        @click="toggleRibbon"
      >
        Ribbon
      </button>
      <button type="button" class="tb-btn primary" @click="openConfig">配置</button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  height: 44px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 8px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.toolbar:not(.toolbar-ribbon) {
  display: flex;
  justify-content: space-between;
}

.toolbar-center {
  display: flex;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
}

.toolbar-center-fallback {
  flex: 1;
  text-align: center;
  max-width: none;
}

.workspace-chip-compact {
  max-width: min(200px, 18vw);
  font-size: 0.72rem;
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

.module-chips {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 0 2px 0 4px;
  border-left: 1px solid var(--border);
}

.module-chip {
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: #f1f5f9;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
}

.module-chip.on {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.module-chip.off {
  opacity: 0.5;
  background: transparent;
}

.module-chip:hover {
  border-color: #93c5fd;
}

.module-chip.off:hover {
  opacity: 0.75;
}

.workspace-chip {
  font-size: 0.78rem;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(360px, 32vw);
}

@media (max-width: 900px) {
  .workspace-chip {
    max-width: min(200px, 24vw);
  }
}

@media (max-width: 720px) {
  .module-chips {
    display: none;
  }

  .workspace-chip {
    max-width: min(420px, 40vw);
  }
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

.tb-btn-on {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.tb-btn-icon {
  width: 30px;
  padding: 0;
  font-size: 0.65rem;
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
