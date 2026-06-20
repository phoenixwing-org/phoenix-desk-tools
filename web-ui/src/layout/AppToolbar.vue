<script setup lang="ts">
import { computed } from "vue";
import { ArrowDownBold, ArrowUpBold } from "@element-plus/icons-vue";
import GiteeIcon from "../components/icons/GiteeIcon.vue";
import { useAppShell } from "../composables/useAppShell";
import { useWorkspaceSwitcher } from "../composables/useWorkspaceSwitcher";
import { PROJECT_GITEE_HOME } from "../constants/projectLinks";
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
const { workspacePath, workspaceShort } = useWorkspaceSwitcher();

const appTitle = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const brandHint = computed(() =>
  workspacePath.value ? workspaceShort.value : "选择或打开工作空间",
);

const showWorkbenchTabs = computed(() => shell.showTabBar.value);

function goWelcome() {
  shell.goToPage("welcome");
}

function toggleRibbonCollapsed() {
  emit("update:ribbonCollapsed", !props.ribbonCollapsed);
}
</script>

<template>
  <header class="chili-header">
    <button
      type="button"
      class="header-brand"
      :title="workspacePath ? `${appTitle}\n${workspacePath}` : '返回欢迎页'"
      @click="goWelcome"
    >
      <span class="brand-mark" aria-hidden="true">P</span>
      <div class="brand-text">
        <span class="brand-title">{{ appTitle }}</span>
        <span class="brand-sub" :class="{ 'is-workspace': workspacePath }">
          <template v-if="workspacePath">
            <span class="brand-sub-dot" aria-hidden="true" />
            <span class="brand-workspace mono">{{ brandHint }}</span>
          </template>
          <template v-else>{{ brandHint }}</template>
        </span>
      </div>
    </button>

    <div class="header-divider" aria-hidden="true" />

    <div class="header-tabs" data-tour="ribbon-tabs">
      <RibbonTabBar
        :tabs="ribbonTabs"
        :active-tab="ribbonActiveTab"
        @update:active-tab="emit('update:ribbonActiveTab', $event)"
      />
    </div>

    <div v-if="showWorkbenchTabs" class="header-divider header-divider-pages" aria-hidden="true" />

    <div class="header-spacer">
      <WorkbenchTabBar v-if="showWorkbenchTabs" in-header />
    </div>

    <div class="header-right">
      <el-button
        class="header-icon-btn"
        text
        size="small"
        :title="ribbonCollapsed ? '展开工具 Ribbon' : '折叠工具 Ribbon'"
        @click="toggleRibbonCollapsed"
      >
        <el-icon>
          <ArrowDownBold v-if="ribbonCollapsed" />
          <ArrowUpBold v-else />
        </el-icon>
      </el-button>
      <a
        class="header-gitee-link"
        :href="PROJECT_GITEE_HOME"
        target="_blank"
        rel="noopener noreferrer"
        title="Gitee 仓库主页 · phoenix-desk-tools"
        aria-label="Gitee 仓库主页"
      >
        <GiteeIcon />
      </a>
    </div>
  </header>
</template>

<style scoped>
.chili-header {
  height: var(--phoenix-header-height);
  min-height: var(--phoenix-header-height);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  padding: 0 4px 0 8px;
  background: var(--phoenix-bg-header);
  border-bottom: 1px solid var(--phoenix-border-header);
  box-shadow: var(--phoenix-shadow-sm);
  flex-shrink: 0;
  gap: 0;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  max-width: min(280px, 34vw);
  margin: 0;
  padding: 4px 8px 4px 4px;
  border: none;
  border-radius: var(--phoenix-radius-md);
  background: transparent;
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: left;
  transition: background 0.15s ease;
}

.header-brand:hover {
  background: var(--phoenix-brand-hover-bg);
}

.header-brand:hover .brand-title {
  color: var(--phoenix-brand-hover-title);
}

.header-brand:focus-visible {
  outline: 2px solid var(--phoenix-focus-ring);
  outline-offset: 1px;
}

.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: var(--phoenix-radius-md);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-weight: 800;
  font-size: 0.82rem;
  letter-spacing: -0.02em;
  color: var(--phoenix-brand-mark-fg);
  background: linear-gradient(145deg, var(--phoenix-brand-from) 0%, var(--phoenix-brand-to) 100%);
  box-shadow: var(--phoenix-brand-shadow);
}

.brand-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  line-height: 1.2;
  min-width: 0;
}

.brand-title {
  font-weight: 650;
  font-size: 0.78rem;
  letter-spacing: 0.01em;
  color: var(--phoenix-brand-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s ease;
}

.brand-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.68rem;
  color: var(--phoenix-brand-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-sub.is-workspace {
  color: var(--phoenix-text-muted);
}

.brand-sub-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--phoenix-accent);
  opacity: 0.85;
}

.brand-workspace {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.68rem;
}

.header-divider {
  width: 1px;
  align-self: stretch;
  margin: 8px 8px;
  background: var(--phoenix-border-header);
  flex-shrink: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
}

.header-icon-btn {
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  color: var(--phoenix-text-muted);
}

.header-icon-btn:hover {
  color: var(--phoenix-accent);
  background: var(--phoenix-brand-hover-bg);
}

.header-gitee-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: var(--phoenix-radius-md, 8px);
  background: transparent;
  text-decoration: none;
  transition: background 0.15s ease;
}

.header-gitee-link:hover {
  background: var(--phoenix-brand-hover-bg);
}

.header-gitee-link:hover :deep(.gitee-icon) {
  transform: scale(1.12);
  filter: drop-shadow(0 2px 5px rgba(199, 29, 35, 0.4));
}

.header-gitee-link:active :deep(.gitee-icon) {
  transform: scale(1.04);
}

.header-gitee-link:focus-visible {
  outline: 2px solid var(--phoenix-focus-ring, #2563eb);
  outline-offset: 1px;
}

.header-gitee-link :deep(.gitee-icon) {
  transition:
    transform 0.15s ease,
    filter 0.15s ease;
}

.header-tabs {
  display: flex;
  align-items: center;
  min-width: 0;
  flex-shrink: 0;
  padding: 0 2px;
}

.header-divider-pages {
  margin: 10px 4px 10px 2px;
  opacity: 0.85;
}

.header-spacer {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0 4px 0 0;
}

@media (max-width: 900px) {
  .brand-title {
    font-size: 0.74rem;
  }

  .brand-sub {
    display: none;
  }

  .header-brand {
    max-width: 120px;
  }
}
</style>
