<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Setting } from "@element-plus/icons-vue";
import {
  PnwSelect,
  PnwWorkspaceWelcome,
  type PnwRecentWorkspaceEntry,
  type PnwSelectOption,
} from "phoenix-wing";
import {
  PROJECT_GITEE_HOME,
  PROJECT_INSTALL_DOC,
  PROJECT_QUICKSTART_DOC,
} from "../constants/projectLinks";
import {
  MODULE_SCOPE_OPTIONS,
  moduleScopeLabel,
  type ModuleScope,
} from "../constants/moduleScope";
import { useAppShell } from "../composables/useAppShell";
import { useShellTour } from "../composables/useShellTour";
import CaaUnsavedDraftsPanel from "../components/caa/CaaUnsavedDraftsPanel.vue";
import { useWorkspaceDirectoryPicker } from "../composables/useWorkspaceDirectoryPicker";
import { confirmCloseTabsBeforeWorkspacePick } from "../composables/tabCloseConfirm";
import { DEFAULT_APP_TITLE } from "../types/config";

const shell = useAppShell();
const { startShellTour } = useShellTour(shell);
const { picking, pickAndOpenWorkspace } = useWorkspaceDirectoryPicker();
const touring = ref(false);

const appTitle = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const workspacePath = computed(() => shell.workspacePath.value);
const workspaceWelcomeDisabled = computed(() => picking.value || touring.value);
const moduleScopeOptions: readonly PnwSelectOption[] = MODULE_SCOPE_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
}));

onMounted(() => {
  void shell.reloadLauncher();
});

function entryScope(rootPath: string): ModuleScope {
  return shell.launcher.value?.recent_workspace_entries
    ?.find((entry) => entry.path === rootPath)
    ?.module_scope ?? "all";
}

function isWorkspaceBlockingTab(pageId: string) {
  return pageId !== "home" && pageId !== "welcome" && pageId !== "config";
}

async function openWorkspace(entry: PnwRecentWorkspaceEntry) {
  if (entry.availability === "missing" || entry.availability === "unauthorized") return;
  const scope = entryScope(entry.rootPath);
  if (entry.rootPath !== workspacePath.value) {
    const tabTitles = shell.tabs.value.filter((tab) => isWorkspaceBlockingTab(tab.pageId)).map((tab) => tab.title);
    if (tabTitles.length) {
      const ok = await confirmCloseTabsBeforeWorkspacePick(tabTitles, shell.toolTabDirtyTitles());
      if (!ok) {
        shell.setStatus("已取消打开工作空间");
        return;
      }
      shell.discardAllToolTabs();
    }
    try {
      await shell.switchWorkspace(entry.rootPath);
    } catch (error) {
      shell.setStatus(String(error));
      return;
    }
  }
  try {
    await shell.enterWorkbenchFromWelcome({ scope });
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function removeRecent(entry: PnwRecentWorkspaceEntry) {
  if (!window.confirm(`从最近列表中移除？\n\n${entry.rootPath}`)) return;
  try {
    await shell.removeRecentWorkspace(entry.rootPath);
    shell.setStatus("已从最近列表移除");
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function onScopeChange(rootPath: string, scope: string) {
  if (!MODULE_SCOPE_OPTIONS.some((option) => option.id === scope)) return;
  try {
    await shell.setWorkspaceModuleScope(rootPath, scope as ModuleScope);
    shell.setStatus(`模块范围已设为 ${moduleScopeLabel(scope)}`);
  } catch (error) {
    shell.setStatus(String(error));
  }
}

function openWorkspacePicker() {
  void pickAndOpenWorkspace();
}

function openConfig() {
  shell.openConfig();
}

async function enterAndStartTour() {
  if (touring.value || picking.value) return;
  touring.value = true;
  try {
    if (!workspacePath.value) {
      const result = await pickAndOpenWorkspace({
        enterWorkbench: true,
        logSource: "welcome",
      });
      if (!result.ok) return;
    }
    await startShellTour(true);
  } finally {
    touring.value = false;
  }
}

function returnToWorkspace() {
  if (!workspacePath.value) {
    shell.setStatus("请先打开工作空间");
    return;
  }
  void shell.enterWorkbenchFromWelcome();
}
</script>

<template>
  <PnwWorkspaceWelcome
    class="desk-workspace-welcome"
    data-tour-page-welcome
    :state="shell.workspaceState.value"
    :app-title="appTitle"
    product-subtitle="Phoenix 桌面工具"
    heading="欢迎使用 Phoenix"
    description="在下方选择工程与模块（CAD / Code / 全部），点击进入对应工具台；若该模块有未关闭的文档，将自动恢复。"
    open-label="打开工作空间"
    recent-title="最近使用"
    :disabled="workspaceWelcomeDisabled"
    @open-workspace="openWorkspacePicker"
    @open-recent="openWorkspace"
    @remove-recent="removeRecent"
  >
    <template #brand>
      <header class="desk-welcome-brand">
        <span class="desk-welcome-brand-mark" aria-hidden="true">P</span>
        <span class="desk-welcome-brand-copy">
          <strong>PHOENIX</strong>
          <small>{{ appTitle }}</small>
        </span>
      </header>
    </template>

    <template #rail-actions>
      <el-button
        class="desk-welcome-rail-action"
        :loading="touring || picking"
        title="进入工作空间并逐步介绍 Ribbon、页面 Tab 与工作区树"
        @click="enterAndStartTour"
      >
        界面巡游
      </el-button>
      <el-button
        class="desk-welcome-rail-action"
        :disabled="!workspacePath"
        @click="returnToWorkspace"
      >
        返回工作空间
      </el-button>
    </template>

    <template #links>
      <nav class="desk-welcome-links" aria-label="Phoenix 帮助链接">
        <el-link :href="PROJECT_GITEE_HOME" target="_blank" rel="noopener noreferrer">
          Gitee 主页
        </el-link>
        <el-link :href="PROJECT_INSTALL_DOC" target="_blank" rel="noopener noreferrer">
          安装说明
        </el-link>
        <el-link :href="PROJECT_QUICKSTART_DOC" target="_blank" rel="noopener noreferrer">
          快速开始
        </el-link>
      </nav>
    </template>

    <template #head-actions>
      <el-button title="工作空间、FreeCAD 与界面偏好" @click="openConfig">
        <el-icon aria-hidden="true"><Setting /></el-icon>
        设置
      </el-button>
    </template>

    <template #before-recent>
      <span data-tour-page-welcome-recent />
    </template>

    <template #entry-actions="{ entry }">
      <PnwSelect
        v-if="entry.availability === 'available' || entry.availability === 'unknown'"
        class="desk-welcome-scope-select"
        :model-value="entryScope(entry.rootPath)"
        :options="moduleScopeOptions"
        size="compact"
        :aria-label="`${entry.name} 模块范围`"
        @update:model-value="onScopeChange(entry.rootPath, $event)"
      />
    </template>

    <template #empty>
      <p class="desk-welcome-empty">尚无最近工程。点击左侧“打开工作空间”选择工程根目录。</p>
    </template>

    <template #after-recent>
      <CaaUnsavedDraftsPanel />
    </template>
  </PnwWorkspaceWelcome>
</template>

<style scoped>
.desk-workspace-welcome { height: 100%; }

.desk-welcome-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.desk-welcome-brand-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(145deg, #2563eb 0%, #1d4ed8 100%);
  box-shadow: 0 2px 8px rgb(37 99 235 / 35%);
  font-size: 1.1rem;
  font-weight: 800;
}

.desk-welcome-brand-copy { display: grid; min-width: 0; gap: 2px; }
.desk-welcome-brand-copy strong { letter-spacing: 0.06em; }
.desk-welcome-brand-copy small {
  overflow: hidden;
  color: var(--pnw-workbench-muted, #64748b);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desk-welcome-rail-action { width: 100%; margin: 0; }
.desk-welcome-links { display: grid; gap: 8px; justify-items: start; }
.desk-welcome-scope-select { width: 112px; margin: 8px; }
.desk-welcome-empty {
  margin: 0;
  padding: 20px;
  color: var(--pnw-workbench-muted, #64748b);
  text-align: center;
}
</style>
