<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";
import { useWorkspaceSwitcher } from "../composables/useWorkspaceSwitcher";
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

const title = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const brandShort = computed(() => {
  const t = title.value;
  return t.startsWith("Phoenix") ? "Phoenix" : t.split(/\s+/)[0] ?? t;
});
const brandSub = computed(() => {
  if (workspacePath.value) return workspaceShort.value;
  const t = title.value;
  if (t.startsWith("Phoenix")) return t.replace(/^Phoenix\s*/, "") || "Desk Tools";
  return "v0.1";
});

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
    <button type="button" class="header-brand" :title="workspacePath || '返回欢迎页'" @click="goWelcome">
      <span class="brand-mark" aria-hidden="true">P</span>
      <div class="brand-text">
        <span class="brand-title">{{ brandShort }}</span>
        <span class="brand-sub">{{ brandSub }}</span>
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
      <button
        type="button"
        class="header-icon-btn"
        :title="ribbonCollapsed ? '展开工具 Ribbon' : '折叠工具 Ribbon'"
        @click="toggleRibbonCollapsed"
      >
        {{ ribbonCollapsed ? "▼" : "▲" }}
      </button>
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
  max-width: 160px;
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

.header-icon-btn-active {
  background: rgba(255, 255, 255, 0.72);
  color: #1d4ed8;
  box-shadow: inset 0 0 0 1px #b6c4d4;
}

.header-tabs {
  display: flex;
  align-items: center;
  min-width: 0;
  flex-shrink: 0;
  padding: 0 2px;
}

.header-divider-pages {
  margin: 8px 4px 8px 2px;
  opacity: 0.85;
}

.header-spacer {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: 0 4px 0 0;
}

@media (max-width: 900px) {
  .brand-sub {
    display: none;
  }
}
</style>
