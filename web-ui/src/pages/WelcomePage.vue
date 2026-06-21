<script setup lang="ts">
import { computed, onMounted } from "vue";
import { removeRecentWorkspace } from "../api";
import {
  PROJECT_GITEE_HOME,
  PROJECT_GITEE_REPO,
  PROJECT_INSTALL_DOC,
  PROJECT_QUICKSTART_DOC,
} from "../constants/projectLinks";
import {
  MODULE_SCOPE_OPTIONS,
  moduleScopeLabel,
  moduleScopeTagType,
  type ModuleScope,
} from "../constants/moduleScope";
import { useAppShell } from "../composables/useAppShell";
import { DEFAULT_APP_TITLE } from "../types/config";
import type { RecentWorkspaceEntry } from "../types/config";

const shell = useAppShell();

const appTitle = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const workspacePath = computed(() => shell.workspacePath.value);

const recentEntries = computed((): RecentWorkspaceEntry[] => {
  const launcher = shell.launcher.value;
  if (launcher?.recent_workspace_entries?.length) {
    return launcher.recent_workspace_entries;
  }
  return (launcher?.recent_workspaces ?? []).map((path) => ({
    path,
    exists: true,
    module_scope: "all" as ModuleScope,
  }));
});

function entryScope(entry: RecentWorkspaceEntry): ModuleScope {
  return entry.module_scope ?? "all";
}

onMounted(() => {
  void shell.reloadLauncher();
});

function pathLabel(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = norm.split("/");
  return parts[parts.length - 1] || norm;
}

function pathParent(absPath: string): string {
  const norm = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return norm;
  return norm.slice(0, idx);
}

async function openWorkspace(entry: RecentWorkspaceEntry) {
  if (!entry.exists) return;
  const scope = entryScope(entry);
  if (entry.path !== workspacePath.value) {
    if (!window.confirm(`打开工作空间？\n\n${entry.path}`)) return;
    try {
      await shell.switchWorkspace(entry.path);
    } catch (e) {
      shell.setStatus(String(e));
      return;
    }
  }
  try {
    await shell.enterWorkbenchFromWelcome({ scope });
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

async function onScopeChange(path: string, scope: ModuleScope) {
  try {
    await shell.setWorkspaceModuleScope(path, scope);
    shell.setStatus(`模块范围已设为 ${moduleScopeLabel(scope)}`);
  } catch (e) {
    shell.setStatus(String(e));
  }
}

function openConfig() {
  shell.openConfig();
}

function openGuide() {
  shell.openOnboardingGuide();
}

function openHome() {
  if (!workspacePath.value) {
    shell.openConfig();
    return;
  }
  shell.goToPage("home");
}
</script>

<template>
  <div class="welcome-shell" data-tour-page-welcome>
    <aside class="welcome-rail">
      <header class="brand">
        <span class="brand-mark" aria-hidden="true">P</span>
        <div class="brand-text">
          <div class="brand-name">PHOENIX</div>
          <div class="brand-sub">{{ appTitle }}</div>
        </div>
      </header>

      <div class="rail-actions">
        <el-button type="primary" class="rail-btn-full" @click="openConfig">
          打开工作空间
        </el-button>
        <el-button class="rail-btn-full" @click="openGuide">新手指南</el-button>
        <el-button class="rail-btn-full" @click="openHome">主页 · 功能清单</el-button>
      </div>

      <div class="rail-links">
        <el-link :href="PROJECT_GITEE_HOME" target="_blank" rel="noopener noreferrer">
          Gitee 主页
        </el-link>
        <el-link :href="PROJECT_GITEE_REPO" target="_blank" rel="noopener noreferrer">
          克隆地址
        </el-link>
        <el-link :href="PROJECT_INSTALL_DOC" target="_blank" rel="noopener noreferrer">
          安装说明
        </el-link>
        <el-link :href="PROJECT_QUICKSTART_DOC" target="_blank" rel="noopener noreferrer">
          快速开始
        </el-link>
      </div>
    </aside>

    <main class="welcome-main">
      <header class="welcome-head">
        <h1 class="welcome-title">欢迎使用 Phoenix</h1>
        <p class="welcome-lead">
          在下方选择工程与模块（CAD / Code / 全部），点击进入对应工具台；若该模块有未关闭的文档，将自动恢复。
        </p>
        <p v-if="workspacePath" class="welcome-current">
          当前工作空间：
          <span class="mono" :title="workspacePath">{{ workspacePath }}</span>
        </p>
      </header>

      <section class="recent-section" data-tour-page-welcome-recent>
        <h2 class="recent-heading">最近使用</h2>

        <el-empty
          v-if="!recentEntries.length"
          description="尚无最近工程。点击左侧「打开工作空间」在配置中填写工程根目录并保存。"
          :image-size="72"
        />

        <ul v-else class="recent-list">
          <li
            v-for="entry in recentEntries"
            :key="entry.path"
            class="recent-item"
            :class="{
              current: entry.path === workspacePath,
              missing: !entry.exists,
            }"
          >
            <el-button
              class="recent-open"
              :disabled="!entry.exists"
              :title="entry.path"
              @click="openWorkspace(entry)"
            >
              <span class="recent-open-body">
                <span class="recent-name-row">
                  <span class="recent-name">{{ pathLabel(entry.path) }}</span>
                  <el-tag
                    :type="moduleScopeTagType(entryScope(entry))"
                    size="small"
                    effect="light"
                    class="recent-scope-tag"
                  >
                    {{ moduleScopeLabel(entryScope(entry)) }}
                  </el-tag>
                </span>
                <span class="recent-path">{{ pathParent(entry.path) }}</span>
                <el-tag v-if="!entry.exists" type="danger" size="small" effect="light">
                  路径不存在
                </el-tag>
                <el-tag
                  v-else-if="entry.path === workspacePath"
                  type="primary"
                  size="small"
                  effect="light"
                >
                  当前
                </el-tag>
              </span>
            </el-button>
            <el-select
              v-if="entry.exists"
              :model-value="entryScope(entry)"
              size="small"
              class="recent-scope-select"
              title="本工程的 CAD / Code 模块范围（写入工作空间偏好）"
              @click.stop
              @change="(v: ModuleScope) => onScopeChange(entry.path, v)"
            >
              <el-option
                v-for="opt in MODULE_SCOPE_OPTIONS"
                :key="opt.id"
                :label="opt.label"
                :value="opt.id"
              />
            </el-select>
            <el-button
              class="recent-remove"
              text
              title="从最近列表移除"
              @click="removeRecent(entry.path, $event)"
            >
              ×
            </el-button>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.welcome-shell {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 100%;
  background: var(--phoenix-bg-welcome-rail);
}

.welcome-rail {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 20px 24px;
  background: var(--phoenix-bg-welcome-rail);
  border-right: 1px solid var(--phoenix-border-header);
  box-sizing: border-box;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}

.brand-mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 1.1rem;
  color: #fff;
  background: linear-gradient(145deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
}

.brand-name {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--phoenix-brand-title);
}

.brand-sub {
  margin-top: 2px;
  font-size: 0.72rem;
  color: #64748b;
  line-height: 1.35;
}

.rail-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rail-btn-full {
  width: 100%;
  margin: 0;
}

.rail-links {
  margin-top: auto;
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rail-links :deep(.el-link) {
  display: block;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.82rem;
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid transparent;
}

.rail-links :deep(.el-link:hover) {
  background: #fff;
  border-color: #bfdbfe;
}

.welcome-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 48px 56px 56px;
  background: var(--phoenix-bg-welcome-main);
  overflow: auto;
}

.welcome-head {
  margin-bottom: 40px;
}

.welcome-title {
  margin: 0 0 12px;
  font-size: 2rem;
  font-weight: 600;
  color: #0f172a;
}

.welcome-lead {
  margin: 0 0 10px;
  max-width: 36rem;
  font-size: 0.88rem;
  line-height: 1.55;
  color: #475569;
}

.welcome-current {
  margin: 0;
  font-size: 0.85rem;
  color: #64748b;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.recent-heading {
  margin: 0 0 16px;
  font-size: 1rem;
  font-weight: 600;
  color: #334155;
}

.recent-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
  max-width: 720px;
}

.recent-item {
  display: flex;
  align-items: stretch;
  gap: 4px;
}

.recent-open {
  flex: 1;
  height: auto;
  min-height: 56px;
  padding: 12px 16px;
  margin: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fafafa;
  text-align: left;
  justify-content: flex-start;
  white-space: normal;
}

.recent-open:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #f0f6ff;
}

.recent-item.current .recent-open {
  border-color: #3b82f6;
  background: #eff6ff;
}

.recent-item.missing .recent-open {
  opacity: 0.65;
}

.recent-open-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}

.recent-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}

.recent-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: #0f172a;
}

.recent-scope-tag {
  flex-shrink: 0;
}

.recent-scope-select {
  flex-shrink: 0;
  width: 88px;
  align-self: stretch;
}

.recent-scope-select :deep(.el-select__wrapper) {
  min-height: 100%;
}

.recent-path {
  font-size: 0.78rem;
  color: #64748b;
  word-break: break-all;
  text-align: left;
}

.recent-remove {
  flex-shrink: 0;
  width: 36px;
  min-width: 36px;
  height: auto;
  margin: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 1.1rem;
  color: #94a3b8;
}

.recent-remove:hover {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

@media (max-width: 720px) {
  .welcome-shell {
    flex-direction: column;
  }

  .welcome-rail {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #d8dee6;
  }

  .rail-links {
    flex-direction: row;
    flex-wrap: wrap;
    margin-top: 16px;
  }

  .rail-links :deep(.el-link) {
    flex: 1 1 auto;
  }

  .welcome-main {
    padding: 24px 20px 32px;
  }
}
</style>
