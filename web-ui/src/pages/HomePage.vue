<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const appTitle = computed(() => shell.appConfig.value?.title ?? "FreeCAD 管理工具");
const workspacePath = computed(() => shell.workspacePath.value);
const featureNav = computed(() =>
  (shell.appConfig.value?.navigation ?? []).filter(
    (n) => n.page !== "home" && n.page !== "config",
  ),
);

function openFeature(page: string) {
  shell.goToPage(page);
}

function openConfig() {
  shell.goToPage("config");
}
</script>

<template>
  <div class="page welcome-page">
    <h1 class="page-title">主页</h1>

    <section class="intro">
      <p class="lead">
        <strong>{{ appTitle }}</strong>
        面向 FreeCAD 工作空间的 Web 壳层：在浏览器中管理 CAD 索引、BOM、零件库、文件属性与引用路径，并与本机
        FreeCAD 目录协同。
      </p>
      <p class="lead muted">
        左侧导航进入各功能；工作区树可打开文件详情。工作空间根目录、FreeCAD 安装路径与最近打开记录在
        <button type="button" class="link-btn" @click="openConfig">配置</button>
        中维护。
      </p>
    </section>

    <section class="section">
      <h2 class="section-title">当前工作空间</h2>
      <p class="workspace-path">{{ workspacePath || "（未设置）" }}</p>
      <button type="button" class="btn" @click="openConfig">打开配置…</button>
    </section>

    <section class="section">
      <h2 class="section-title">功能入口</h2>
      <ul class="feature-grid">
        <li v-for="item in featureNav" :key="item.page">
          <button type="button" class="feature-card" @click="openFeature(item.page)">
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
.welcome-page {
  padding: 24px 28px 40px;
  max-width: 920px;
}

.page-title {
  margin: 0 0 16px;
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

.feature-card:hover {
  border-color: var(--accent);
  background: #f0f6ff;
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
