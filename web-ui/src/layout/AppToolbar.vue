<script setup lang="ts">
import { computed, ref } from "vue";
import { HomeFilled, Setting, FolderOpened, ArrowDown, Link } from "@element-plus/icons-vue";
import { removeRecentWorkspace } from "../api";
import { PROJECT_GITEE_HOME } from "../constants/projectLinks";
import { NAV_MODULE_OPTIONS } from "../constants/navModules";
import { useAppShell } from "../composables/useAppShell";
import { DEFAULT_APP_TITLE } from "../types/config";
import RibbonTabBar from "./ribbon/RibbonTabBar.vue";
import WorkbenchTabBar from "./WorkbenchTabBar.vue";

const props = withDefaults(
  defineProps<{
    ribbonTabs?: { id: string; label: string }[];
    ribbonActiveTab?: string;
    ribbonCollapsed?: boolean;
  }>(),
  {
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
const brandShort = computed(() => {
  const t = title.value;
  return t.startsWith("Phoenix") ? "Phoenix" : t.split(/\s+/)[0] ?? t;
});
const brandSub = computed(() => {
  const t = title.value;
  if (t.startsWith("Phoenix")) return t.replace(/^Phoenix\s*/, "") || "Desk Tools";
  return "v0.1";
});

const recent = computed(() => shell.launcher.value?.recent_workspaces ?? []);
const workspacePath = computed(() => shell.workspacePath.value);
const workspaceShort = computed(() => {
  const p = workspacePath.value;
  if (!p) return "未打开工作空间";
  const norm = p.replace(/\\/g, "/");
  const name = norm.split("/").pop() || p;
  return name.length > 28 ? `…${name.slice(-25)}` : name;
});

const showWorkbenchTabs = computed(() => shell.showTabBar.value);

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

function openConfig() {
  recentOpen.value = false;
  shell.openConfig();
}

function goWelcome() {
  recentOpen.value = false;
  shell.goToPage("welcome");
}

function toggleRibbonCollapsed() {
  emit("update:ribbonCollapsed", !props.ribbonCollapsed);
}
</script>

<template>
  <header class="chili-header">
    <button type="button" class="header-brand" title="返回欢迎页" @click="goWelcome">
      <span class="brand-mark" aria-hidden="true">P</span>
      <div class="brand-text">
        <span class="brand-title">{{ brandShort }}</span>
        <span class="brand-sub">{{ brandSub }}</span>
      </div>
    </button>

    <div class="header-divider" aria-hidden="true" />

    <div class="header-quick">
      <button type="button" class="header-icon-btn" title="欢迎页" @click="goWelcome">
        <HomeFilled />
      </button>
      <button type="button" class="header-icon-btn" title="配置" @click="openConfig">
        <Setting />
      </button>
    </div>

    <div class="header-divider" aria-hidden="true" />

    <div class="header-tabs" data-tour="ribbon-tabs">
      <RibbonTabBar
        :tabs="ribbonTabs"
        :active-tab="ribbonActiveTab"
        @update:active-tab="emit('update:ribbonActiveTab', $event)"
      />
    </div>

    <div class="header-spacer">
      <WorkbenchTabBar v-if="showWorkbenchTabs" in-header />
    </div>

    <div class="header-modules" aria-label="功能模块">
      <button
        v-for="opt in NAV_MODULE_OPTIONS"
        :key="opt.id"
        type="button"
        class="module-toggle"
        :class="{ on: isModuleEnabled(opt.id) }"
        :title="moduleChipTitle(opt)"
        @click="toggleModule(opt.id)"
      >
        {{ opt.shortLabel }}
      </button>
    </div>

    <div class="header-right">
      <span class="workspace-pill" :title="workspacePath || '未设置工作空间'">
        <FolderOpened class="workspace-pill-icon" />
        {{ workspaceShort }}
      </span>

      <div class="recent-wrap">
        <button
          type="button"
          class="header-icon-btn"
          title="最近工作空间"
          @click="recentOpen = !recentOpen"
        >
          <ArrowDown />
        </button>
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

      <button
        type="button"
        class="header-icon-btn"
        :title="ribbonCollapsed ? '展开工具 Ribbon' : '折叠工具 Ribbon'"
        @click="toggleRibbonCollapsed"
      >
        {{ ribbonCollapsed ? "▼" : "▲" }}
      </button>

      <a
        class="header-icon-btn header-link"
        :href="PROJECT_GITEE_HOME"
        target="_blank"
        rel="noopener noreferrer"
        title="Gitee 仓库"
      >
        <Link />
      </a>
    </div>
  </header>
</template>

<style scoped>
.chili-header {
  height: var(--header-height, 40px);
  min-height: var(--header-height, 40px);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  padding: 0 8px 0 6px;
  background: var(--header-bg, #e8ecf2);
  border-bottom: 1px solid var(--header-border, #cdd3dc);
  flex-shrink: 0;
  gap: 0;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin: 0;
  padding: 0 6px 0 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
}

.header-brand:hover {
  background: rgba(255, 255, 255, 0.55);
}

.header-brand:hover .brand-title {
  color: #2563eb;
}

.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 0.72rem;
  color: #fff;
  background: linear-gradient(145deg, #2563eb 0%, #1d4ed8 100%);
}

.brand-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.15;
  min-width: 0;
}

.brand-title {
  font-weight: 700;
  font-size: 0.82rem;
  color: #1e293b;
  white-space: nowrap;
}

.brand-sub {
  font-size: 0.62rem;
  color: #64748b;
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-divider {
  width: 1px;
  align-self: stretch;
  margin: 6px 6px;
  background: #c5ccd6;
  flex-shrink: 0;
}

.header-quick,
.header-right {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.header-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #475569;
  font-size: 0.75rem;
  cursor: pointer;
  text-decoration: none;
}

.header-icon-btn :deep(svg) {
  width: 16px;
  height: 16px;
}

.header-icon-btn:hover {
  background: rgba(255, 255, 255, 0.55);
  color: #1d4ed8;
}

.header-tabs {
  display: flex;
  align-items: stretch;
  min-width: 0;
  flex-shrink: 0;
}

.header-spacer {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
}

.header-modules {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-right: 8px;
}

.module-toggle {
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: #64748b;
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
}

.module-toggle.on {
  color: #1d4ed8;
  background: rgba(255, 255, 255, 0.65);
  border-color: #b6c4d4;
}

.module-toggle:hover {
  background: rgba(255, 255, 255, 0.45);
}

.workspace-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(200px, 18vw);
  height: 26px;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid #c8ced8;
  background: linear-gradient(180deg, #fff 0%, #eef1f5 100%);
  color: #334155;
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.workspace-pill-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #64748b;
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

@media (max-width: 900px) {
  .header-modules {
    display: none;
  }

  .brand-sub {
    display: none;
  }
}

@media (max-width: 720px) {
  .workspace-pill {
    max-width: 100px;
  }
}
</style>
