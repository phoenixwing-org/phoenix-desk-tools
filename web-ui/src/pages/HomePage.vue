<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from "vue";
import { PnwWorkbenchHome, pnwCreateWorkbenchHomeDefinition } from "phoenix-wing";
import PageHelpButton from "../components/PageHelpButton.vue";
import OnboardingChecklist from "../components/OnboardingChecklist.vue";
import { NAV_MODULE_OPTIONS, type NavModuleId } from "../constants/navModules";
import { useAppShell } from "../composables/useAppShell";
import { useOnboardingStore } from "../stores/onboarding";
import { DEFAULT_APP_TITLE, type NavItem } from "../types/config";
import { ribbonIconFor } from "../layout/ribbon/ribbonIcons";

const shell = useAppShell();
const onboarding = useOnboardingStore();

onMounted(() => {
  void onboarding.refreshStatus();
});

watch(
  () => shell.scrollToGuideToken.value,
  async () => {
    await nextTick();
    document.getElementById("onboarding-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
);

const appTitle = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const homeDefinition = pnwCreateWorkbenchHomeDefinition({
  viewId: "home",
  title: "主页",
  iconId: "pnw:home",
});

const HUB_SKIP_PAGES = new Set(["home", "config", "welcome"]);

function navItemsForModule(moduleId: NavModuleId): NavItem[] {
  return (shell.appConfig.value?.navigation ?? []).filter(
    (n) => n.module === moduleId && !HUB_SKIP_PAGES.has(n.page),
  );
}

const systemFeatures = computed(() =>
  (shell.appConfig.value?.navigation ?? []).filter(
    (n) => !n.module && !HUB_SKIP_PAGES.has(n.page) && shell.isNavItemVisible(n),
  ),
);

function isModuleEnabled(id: string): boolean {
  return shell.enabledNavModules.value.includes(id);
}

async function toggleModule(id: string) {
  await shell.toggleNavModule(id);
}

function openFeature(page: string) {
  if (!shell.canNavigateToPage(page)) {
    shell.goToPage("config");
    return;
  }
  shell.goToPage(page);
}

function openWelcome() {
  shell.goToPage("welcome");
}

function openConfig() {
  shell.goToPage("config");
}

function visibleFeatures(moduleId: NavModuleId): NavItem[] {
  if (!isModuleEnabled(moduleId)) return [];
  return navItemsForModule(moduleId).filter((n) => shell.isNavItemVisible(n));
}
</script>

<template>
  <PnwWorkbenchHome
    class="home-page"
    :title="homeDefinition.title"
    eyebrow="Phoenix Workbench"
    max-content-width="1080px"
  >
    <template #description>
      <p class="home-lead">
        <strong>{{ appTitle }}</strong>
        — FreeCAD / Code 工作空间。顶栏 Ribbon 为主入口；下方按模块勾选并快捷打开功能页。工作空间与 FreeCAD 路径在
        <el-button link type="primary" @click="openConfig">配置</el-button>
        中维护。
      </p>
    </template>

    <template #actions>
      <el-button link type="primary" class="back-welcome" @click="openWelcome">← 欢迎页</el-button>
      <PageHelpButton page-id="home" />
    </template>

    <section class="module-hub" data-tour-page-home-modules data-tour-page-home-features>
      <div
        v-for="opt in NAV_MODULE_OPTIONS"
        :key="opt.id"
        class="module-group"
        :class="[`module-group--${opt.id}`, { 'is-on': isModuleEnabled(opt.id) }]"
      >
        <header class="module-group-head">
          <div class="module-group-title-row">
            <el-checkbox
              :model-value="isModuleEnabled(opt.id)"
              class="module-check"
              @change="toggleModule(opt.id)"
            />
            <h2 class="module-group-title">{{ opt.label }}</h2>
            <el-tag size="small" effect="plain" type="info">
              {{ navItemsForModule(opt.id).length }} 项
            </el-tag>
          </div>
          <p class="module-group-hint">{{ opt.hint }}</p>
        </header>

        <ul
          v-if="isModuleEnabled(opt.id)"
          class="feature-grid"
        >
          <li v-for="item in visibleFeatures(opt.id)" :key="item.page">
            <button
              type="button"
              class="feature-card"
              :class="{ 'is-disabled': !shell.canNavigateToPage(item.page) }"
              :disabled="!shell.canNavigateToPage(item.page)"
              @click="openFeature(item.page)"
            >
              <span class="feature-icon" aria-hidden="true">
                <el-icon><component :is="ribbonIconFor(item.page)" /></el-icon>
              </span>
              <span class="feature-body">
                <span class="feature-label">{{ item.label }}</span>
                <span class="feature-desc">{{ item.description }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-else class="module-off-hint">未启用 — 勾选上方以在 Ribbon 与本页显示 {{ opt.shortLabel }} 功能</p>
      </div>

      <div v-if="systemFeatures.length" class="module-group module-group--system">
        <header class="module-group-head">
          <h2 class="module-group-title">系统</h2>
          <p class="module-group-hint">与工作空间模块无关的壳层工具</p>
        </header>
        <ul class="feature-grid">
          <li v-for="item in systemFeatures" :key="item.page">
            <button
              type="button"
              class="feature-card"
              :class="{ 'is-disabled': !shell.canNavigateToPage(item.page) }"
              :disabled="!shell.canNavigateToPage(item.page)"
              @click="openFeature(item.page)"
            >
              <span class="feature-icon" aria-hidden="true">
                <el-icon><component :is="ribbonIconFor(item.page)" /></el-icon>
              </span>
              <span class="feature-body">
                <span class="feature-label">{{ item.label }}</span>
                <span class="feature-desc">{{ item.description }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <OnboardingChecklist />

    <template #footer>
      <section class="hints-section">
        <h2 class="hints-title">使用提示</h2>
        <ul class="hint-list">
          <li>模块偏好保存在当前工作空间 SQLite；欢迎页最近工程可设置工作空间类型。</li>
          <li>首次使用请在欢迎页打开工作空间根目录。</li>
          <li>在「CAD 索引」或 KT Auto CAD 中更新工作空间索引；两端共用 Wing 算法与 Schema v13 数据库。</li>
          <li>预检、问题与运行日志固定在下方全局面板，切换 View 后仍会保留。</li>
        </ul>
      </section>
    </template>
  </PnwWorkbenchHome>
</template>

<style scoped>
@import "./page-shared.css";

.back-welcome {
  font-size: 0.82rem;
  white-space: nowrap;
}

.home-lead {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--phoenix-text-secondary);
}

.module-hub {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 28px;
}

.module-group {
  padding: 16px 18px 18px;
  border: 1px solid var(--phoenix-border);
  border-radius: var(--phoenix-radius-lg);
  background: var(--phoenix-bg-elevated);
  box-shadow: var(--phoenix-shadow-sm);
  transition: border-color 0.15s ease;
}

.module-group.is-on {
  border-color: var(--phoenix-accent-border);
}

.module-group--cad.is-on {
  background: linear-gradient(180deg, var(--phoenix-accent-soft) 0%, var(--phoenix-bg-elevated) 72%);
}

.module-group--code.is-on {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--phoenix-accent-soft) 55%, var(--phoenix-bg-elevated)) 0%,
    var(--phoenix-bg-elevated) 72%
  );
}

.module-group-head {
  margin-bottom: 14px;
}

.module-group-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.module-group-title {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 600;
  color: var(--phoenix-text);
}

.module-check {
  height: auto;
  margin: 0;
}

.module-check :deep(.el-checkbox__label) {
  display: none;
}

.module-group-hint {
  margin: 6px 0 0;
  padding-left: 28px;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--phoenix-text-muted);
}

.module-group--system .module-group-hint {
  padding-left: 0;
}

.module-off-hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--phoenix-radius-md);
  font-size: 0.82rem;
  color: var(--phoenix-text-muted);
  background: var(--phoenix-bg-muted);
}

.feature-grid {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin: 0;
  padding: 11px 12px;
  text-align: left;
  border: 1px solid var(--phoenix-border);
  border-radius: var(--phoenix-radius-md);
  background: var(--phoenix-bg-elevated);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.feature-card:hover:not(:disabled) {
  border-color: var(--phoenix-accent-border);
  background: var(--phoenix-accent-soft);
  box-shadow: var(--phoenix-shadow-sm);
}

.feature-card.is-disabled,
.feature-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.feature-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--phoenix-radius-md);
  color: var(--phoenix-accent);
  background: var(--phoenix-accent-soft);
}

.feature-icon :deep(.el-icon) {
  font-size: 1.05rem;
}

.feature-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.feature-label {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--phoenix-text);
}

.feature-desc {
  font-size: 0.76rem;
  color: var(--phoenix-text-muted);
  line-height: 1.45;
}

.hints-section {
  margin-top: 8px;
}

.hints-title {
  margin: 0 0 10px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--phoenix-text-secondary);
}

.hint-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.84rem;
  line-height: 1.7;
  color: var(--phoenix-text-muted);
}

@media (max-width: 640px) {
  .home-page {
    padding: 18px 16px 32px;
  }

  .module-group-hint {
    padding-left: 0;
  }

  .feature-grid {
    grid-template-columns: 1fr;
  }
}
</style>
