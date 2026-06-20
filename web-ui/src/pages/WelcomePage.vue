<script setup lang="ts">
import { computed, onMounted } from "vue";
import { removeRecentWorkspace } from "../api";
import {
  PROJECT_GITEE_HOME,
  PROJECT_GITEE_REPO,
  PROJECT_INSTALL_DOC,
  PROJECT_QUICKSTART_DOC,
} from "../constants/projectLinks";
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
  }));
});

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

async function openWorkspace(path: string) {
  if (path !== workspacePath.value) {
    if (!window.confirm(`打开工作空间？\n\n${path}`)) return;
    try {
      await shell.switchWorkspace(path);
    } catch (e) {
      shell.setStatus(String(e));
      return;
    }
  }
  try {
    await shell.enterWorkbenchFromWelcome();
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
  shell.openConfig();
}

function openGuide() {
  shell.openOnboardingGuide();
}

function openHome() {
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
        <button type="button" class="rail-btn rail-btn-primary" @click="openConfig">
          打开工作空间
        </button>
        <button type="button" class="rail-btn" @click="openGuide">新手指南</button>
        <button type="button" class="rail-btn" @click="openHome">功能与模块</button>
      </div>

      <div class="rail-links">
        <a class="rail-link" :href="PROJECT_GITEE_HOME" target="_blank" rel="noopener noreferrer">
          Gitee 主页
        </a>
        <a class="rail-link" :href="PROJECT_GITEE_REPO" target="_blank" rel="noopener noreferrer">
          克隆地址
        </a>
        <a class="rail-link" :href="PROJECT_INSTALL_DOC" target="_blank" rel="noopener noreferrer">
          安装说明
        </a>
        <a class="rail-link" :href="PROJECT_QUICKSTART_DOC" target="_blank" rel="noopener noreferrer">
          快速开始
        </a>
      </div>
    </aside>

    <main class="welcome-main">
      <header class="welcome-head">
        <h1 class="welcome-title">欢迎使用 Phoenix</h1>
        <p v-if="workspacePath" class="welcome-current">
          当前工作空间：
          <span class="mono" :title="workspacePath">{{ workspacePath }}</span>
        </p>
      </header>

      <section class="recent-section" data-tour-page-welcome-recent>
        <h2 class="recent-heading">最近使用</h2>

        <p v-if="!recentEntries.length" class="recent-empty">
          尚无最近工程。点击左侧「打开工作空间」在配置中填写工程根目录并保存。
        </p>

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
            <button
              type="button"
              class="recent-open"
              :disabled="!entry.exists"
              :title="entry.path"
              @click="openWorkspace(entry.path)"
            >
              <span class="recent-name">{{ pathLabel(entry.path) }}</span>
              <span class="recent-path">{{ pathParent(entry.path) }}</span>
              <span v-if="!entry.exists" class="recent-badge">路径不存在</span>
              <span v-else-if="entry.path === workspacePath" class="recent-badge current-badge">当前</span>
            </button>
            <button
              type="button"
              class="recent-remove"
              title="从最近列表移除"
              @click="removeRecent(entry.path, $event)"
            >
              ×
            </button>
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
  background: #eceff3;
}

.welcome-rail {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 20px 24px;
  background: #eceff3;
  border-right: 1px solid #d8dee6;
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
  color: #0f172a;
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

.rail-btn {
  width: 100%;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  font-size: 0.9rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.rail-btn:hover {
  border-color: #93c5fd;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
}

.rail-btn-primary {
  font-weight: 600;
  border-color: #93c5fd;
  background: #fff;
  color: #1e40af;
}

.rail-links {
  margin-top: auto;
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rail-link {
  display: block;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 0.82rem;
  color: #475569;
  text-decoration: none;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid transparent;
}

.rail-link:hover {
  color: #1d4ed8;
  border-color: #bfdbfe;
  background: #fff;
}

.welcome-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 48px 56px 56px;
  background: #fff;
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

.recent-empty {
  margin: 0;
  max-width: 520px;
  font-size: 0.9rem;
  line-height: 1.65;
  color: #64748b;
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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 56px;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fafafa;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
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
  cursor: not-allowed;
}

.recent-name {
  font-weight: 600;
  font-size: 0.95rem;
  color: #0f172a;
}

.recent-path {
  font-size: 0.78rem;
  color: #64748b;
  word-break: break-all;
}

.recent-badge {
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: #fee2e2;
  color: #b91c1c;
}

.recent-badge.current-badge {
  background: #dbeafe;
  color: #1d4ed8;
}

.recent-remove {
  flex-shrink: 0;
  width: 36px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: #94a3b8;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
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

  .rail-link {
    flex: 1 1 auto;
  }

  .welcome-main {
    padding: 24px 20px 32px;
  }
}
</style>
