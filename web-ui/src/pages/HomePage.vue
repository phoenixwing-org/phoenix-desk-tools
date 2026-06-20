<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from "vue";
import PageHelpButton from "../components/PageHelpButton.vue";
import OnboardingChecklist from "../components/OnboardingChecklist.vue";
import { NAV_MODULE_OPTIONS } from "../constants/navModules";
import { useAppShell } from "../composables/useAppShell";
import { useOnboardingStore } from "../stores/onboarding";
import { DEFAULT_APP_TITLE } from "../types/config";

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
const featureNav = computed(() =>
  (shell.appConfig.value?.navigation ?? []).filter(
    (n) => n.page !== "home" && n.page !== "config" && n.page !== "welcome" && shell.isNavItemVisible(n),
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
</script>

<template>
  <div class="page welcome-page">
    <div class="title-row">
      <h1 class="page-title">主页</h1>
      <div class="head-help">
        <button type="button" class="link-btn back-welcome" @click="openWelcome">← 欢迎页</button>
        <PageHelpButton page-id="home" />
      </div>
    </div>

    <section class="module-section" data-tour-page-home-modules>
      <div class="module-section-head">
        <h2 class="module-section-title">功能模块</h2>
        <p class="module-lead">
          勾选后顶栏 Ribbon 与下方入口才显示对应模块；偏好保存在本机 launcher，与工作空间无关。
        </p>
      </div>
      <ul class="module-grid">
        <li v-for="opt in NAV_MODULE_OPTIONS" :key="opt.id">
          <label class="module-card" :class="{ active: isModuleEnabled(opt.id) }">
            <input
              type="checkbox"
              class="module-check"
              :checked="isModuleEnabled(opt.id)"
              @change="toggleModule(opt.id)"
            />
            <span class="module-label">{{ opt.label }}</span>
            <span class="module-hint">{{ opt.hint }}</span>
          </label>
        </li>
      </ul>
    </section>

    <section class="intro">
      <p class="lead">
        <strong>{{ appTitle }}</strong>
        面向 FreeCAD 工作空间的 Web 壳层：在浏览器中管理 CAD 索引、BOM、零件库、文件属性与引用路径，并与本机
        FreeCAD 目录协同。
      </p>
      <p class="lead muted">
        顶栏 Ribbon 进入各功能；右侧工作区树可打开文件详情。工作空间根目录、FreeCAD 安装路径与最近打开记录在
        <button type="button" class="link-btn" @click="openConfig">配置</button>
        中维护。
      </p>
    </section>

    <OnboardingChecklist />

    <section class="section">
      <h2 class="section-title">功能入口</h2>
      <ul class="feature-grid" data-tour-page-home-features>
        <li v-for="item in featureNav" :key="item.page">
          <button
            type="button"
            class="feature-card"
            :class="{ 'feature-disabled': !shell.canNavigateToPage(item.page) }"
            :disabled="!shell.canNavigateToPage(item.page)"
            @click="openFeature(item.page)"
          >
            <span class="feature-label">{{ item.label }}</span>
            <span class="feature-desc">{{ item.description }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section class="section hints">
      <h2 class="section-title">使用提示</h2>
      <ul class="hint-list">
        <li>首次使用请在配置中填写工作空间根目录并保存偏好。</li>
        <li>「CAD 索引」扫描后，BOM 列表与文件详情中的属性才完整可用。</li>
        <li>文件详情支持多 Tab；改名、引用写回与 BOM 属性回写在同一页的不同子 Tab 中。</li>
        <li>运行日志在右侧栏，便于查看批量任务与 API 输出。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.welcome-page {
  padding: 24px 28px 40px;
  max-width: 920px;
}

.title-row {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.head-help {
  display: flex;
  align-items: center;
  gap: 10px;
}

.back-welcome {
  font-size: 0.82rem;
  white-space: nowrap;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
}

.intro {
  margin-bottom: 28px;
}

.lead {
  margin: 0 0 12px;
  font-size: 0.95rem;
  line-height: 1.65;
}

.lead.muted {
  color: var(--muted);
}

.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}

.section {
  margin-bottom: 28px;
}

.module-section {
  margin-bottom: 24px;
  padding: 16px 18px 18px;
  border: 1px solid #93c5fd;
  border-radius: 10px;
  background: linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%);
  box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
}

.module-section-head {
  margin-bottom: 14px;
}

.module-section-title {
  margin: 0 0 6px;
  font-size: 1.05rem;
  font-weight: 600;
  color: #1e40af;
}

.module-lead {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.55;
  color: #475569;
}

.module-grid {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.module-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 88px;
  padding: 14px 40px 14px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.module-card:hover {
  border-color: #93c5fd;
}

.module-card.active {
  border-color: var(--accent);
  background: #fff;
  box-shadow: 0 0 0 1px var(--accent);
}

.module-check {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent);
}

.module-label {
  font-weight: 600;
  font-size: 0.95rem;
}

.module-hint {
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.45;
}

@media (max-width: 560px) {
  .module-grid {
    grid-template-columns: 1fr;
  }
}

.section-title {
  margin: 0 0 10px;
  font-size: 1rem;
}

.workspace-path {
  margin: 0 0 12px;
  font-weight: 600;
  word-break: break-all;
  font-size: 0.88rem;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
}

.feature-grid {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.feature-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--btn-bg);
  cursor: pointer;
}

.feature-card:hover:not(:disabled) {
  border-color: var(--accent);
  background: #f0f6ff;
}

.feature-card.feature-disabled,
.feature-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.feature-label {
  font-weight: 600;
  font-size: 0.92rem;
}

.feature-desc {
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.45;
}

.hint-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--muted);
}
</style>
