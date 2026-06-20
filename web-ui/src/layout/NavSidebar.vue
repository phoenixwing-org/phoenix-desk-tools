<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";
import { useOnboardingStore } from "../stores/onboarding";
import { WORKSPACE_GATE_MSG } from "../utils/onboardingConstants";
import { DEFAULT_PAGE_ICONS } from "../types/config";

const { hideToolNav = false } = defineProps<{
  /** Ribbon 模式下隐藏功能入口，仅保留指引/配置/侧栏开关 */
  hideToolNav?: boolean;
}>();

const shell = useAppShell();
const onboarding = useOnboardingStore();

const navItems = computed(() => shell.appConfig.value?.navigation ?? []);
const mainNavItems = computed(() =>
  navItems.value
    .filter((n) => n.page !== "home" && n.page !== "config")
    .filter((n) => shell.isNavItemVisible(n)),
);
const homeNavItem = computed(() => navItems.value.find((n) => n.page === "home"));
const configNavItem = computed(() => navItems.value.find((n) => n.page === "config"));
const shellLayout = computed(() => shell.shellLayout.value);
const currentPage = computed(() => shell.currentPage.value);
const wide = computed(() => shellLayout.value.nav_rail_mode === 1);

function iconFor(page: string, custom?: string) {
  return custom || DEFAULT_PAGE_ICONS[page] || "•";
}

async function toggleRail() {
  const next = shell.shellLayout.value.nav_rail_mode === 1 ? 0 : 1;
  await shell.persistShellLayout({ nav_rail_mode: next });
}

async function toggleRight() {
  await shell.persistShellLayout({
    right_panel_open: !shell.shellLayout.value.right_panel_open,
  });
}

function navDisabled(page: string): boolean {
  return !shell.canNavigateToPage(page);
}

function select(page: string) {
  shell.goToPage(page);
}

function openGuide() {
  shell.openOnboardingGuide();
}

function hover(tip: string | null) {
  shell.navHover.value = tip;
}
</script>

<template>
  <nav class="nav" :class="{ wide }" data-tour="nav-rail">
    <button
      v-if="!hideToolNav"
      type="button"
      class="nav-mode"
      :title="wide ? '切换为窄栏（仅图标）' : '切换为宽栏（图标+文字）'"
      @click="toggleRail"
      @mouseenter="hover('导航：单击切换 窄图标 / 宽（图标+文字）')"
      @mouseleave="hover(null)"
    >
      {{ wide ? "◀" : "▶" }}
    </button>

    <button
      v-if="!hideToolNav && homeNavItem"
      type="button"
      class="nav-item nav-home"
      :class="{ active: currentPage === homeNavItem.page }"
      :title="homeNavItem.label"
      @click="select(homeNavItem.page)"
      @mouseenter="hover(homeNavItem.label)"
      @mouseleave="hover(null)"
    >
      <template v-if="wide">
        {{ iconFor(homeNavItem.page, homeNavItem.icon) }} {{ homeNavItem.label }}
      </template>
      <template v-else>{{ iconFor(homeNavItem.page, homeNavItem.icon) }}</template>
    </button>

    <button
      v-if="!hideToolNav"
      v-for="item in mainNavItems"
      :key="item.page"
      type="button"
      class="nav-item"
      :class="{ active: currentPage === item.page, disabled: navDisabled(item.page) }"
      :title="navDisabled(item.page) ? WORKSPACE_GATE_MSG : item.label"
      :disabled="navDisabled(item.page)"
      @click="select(item.page)"
      @mouseenter="hover(item.label)"
      @mouseleave="hover(null)"
    >
      <template v-if="wide">{{ iconFor(item.page, item.icon) }} {{ item.label }}</template>
      <template v-else>{{ iconFor(item.page, item.icon) }}</template>
    </button>

    <div class="nav-spacer" />

    <button
      type="button"
      class="nav-item nav-guide"
      :class="{ active: currentPage === 'home' }"
      title="新手指南与界面巡游"
      @click="openGuide"
      @mouseenter="hover('新手指引：四步开工清单')"
      @mouseleave="hover(null)"
    >
      <template v-if="wide">? 新手指引</template>
      <template v-else>?</template>
    </button>

    <button
      v-if="configNavItem"
      type="button"
      class="nav-item nav-config"
      data-tour="nav-config"
      :class="{ active: shell.configOverlayOpen.value || currentPage === configNavItem.page }"
      :title="configNavItem.label"
      @click="select(configNavItem.page)"
      @mouseenter="hover(configNavItem.label)"
      @mouseleave="hover(null)"
    >
      <template v-if="wide">
        {{ iconFor(configNavItem.page, configNavItem.icon) }} {{ configNavItem.label }}
      </template>
      <template v-else>{{ iconFor(configNavItem.page, configNavItem.icon) }}</template>
    </button>

    <button
      type="button"
      class="nav-dock"
      :title="shellLayout.right_panel_open ? '收起工作空间树' : '展开工作空间树'"
      @click="toggleRight"
      @mouseenter="hover('全局侧栏：展开 / 收起')"
      @mouseleave="hover(null)"
    >
      {{ shellLayout.right_panel_open ? "«" : "»" }}
    </button>
  </nav>
</template>

<style scoped>
.nav {
  width: 36px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--nav-bg);
  border-right: 1px solid var(--border);
  padding: 6px 3px 10px;
}

.nav.wide {
  width: 148px;
}

.nav-mode,
.nav-item,
.nav-dock {
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 0.88rem;
  cursor: pointer;
}

.nav-mode {
  height: 26px;
  margin-bottom: 6px;
  background: var(--nav-mode-bg);
  color: var(--nav-mode-fg);
}

.nav-item {
  min-height: 30px;
  margin: 2px 0;
  padding: 4px 6px;
  text-align: center;
}

.nav.wide .nav-item {
  min-height: 34px;
  text-align: left;
  padding: 6px 8px;
}

.nav-item:hover,
.nav-dock:hover {
  background: var(--nav-hover);
}

.nav-item.active {
  background: var(--accent);
  color: #fff;
}

.nav-item.disabled,
.nav-item:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.nav-item.disabled:hover,
.nav-item:disabled:hover {
  background: transparent;
}

.nav-spacer {
  flex: 1;
  min-height: 8px;
}

.nav-guide {
  margin-top: 4px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.nav-config {
  margin-top: 2px;
}

.nav-dock {
  height: 30px;
  font-size: 1rem;
  color: var(--muted);
}
</style>
