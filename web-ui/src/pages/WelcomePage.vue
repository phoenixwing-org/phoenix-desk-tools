<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Setting } from "@element-plus/icons-vue";
import {
  PnwWorkspaceGate,
  PnwWorkspaceTypeSelect,
  PnwWorkspaceRailAction,
  PnwColorSchemeToggle,
  PnwPhoenixWingMark,
  PnwInformationBlock,
  PnwInformationCardGroup,
  pnwPromptChoice,
  type PnwInformationBlockDefinition,
  type PnwInformationCardGroupDefinition,
  type PnwColorScheme,
  type PnwRecentWorkspaceEntry,
  type PnwWorkspaceGateMode,
} from "phoenix-wing";
import {
  PROJECT_GITEE_HOME,
  PROJECT_INSTALL_DOC,
  PROJECT_QUICKSTART_DOC,
} from "../constants/projectLinks";
import {
  moduleScopeLabel,
  type ModuleScope,
} from "../constants/moduleScope";
import { useAppShell } from "../composables/useAppShell";
import { useShellTour } from "../composables/useShellTour";
import CaaUnsavedDraftsPanel from "../components/caa/CaaUnsavedDraftsPanel.vue";
import { useWorkspaceDirectoryPicker } from "../composables/useWorkspaceDirectoryPicker";
import { confirmCloseTabsBeforeWorkspacePick } from "../composables/tabCloseConfirm";
import { DEFAULT_APP_TITLE } from "../types/config";
import deskWelcomeInformation from "../content/welcomeInformation.json";

const shell = useAppShell();
const props = defineProps<{
  colorScheme: PnwColorScheme;
}>();
const emit = defineEmits<{
  "update:colorScheme": [colorScheme: PnwColorScheme];
}>();
const { startShellTour } = useShellTour(shell);
const { picking, pickAndOpenWorkspace } = useWorkspaceDirectoryPicker();
const touring = ref(false);
const projectInformation: PnwInformationBlockDefinition = deskWelcomeInformation.project;
const contributionInformation: PnwInformationBlockDefinition = deskWelcomeInformation.contribution.block;
const contributionCards: PnwInformationCardGroupDefinition = deskWelcomeInformation.contribution.cardGroup;

const appTitle = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const workspacePath = computed(() => shell.workspacePath.value);
const workspaceWelcomeDisabled = computed(() => picking.value || touring.value);
const gateMode = computed<PnwWorkspaceGateMode>(() => (
  shell.currentPage.value === "welcome" ? "welcome" : "workbench"
));

onMounted(() => {
  void shell.reloadLauncher();
});

function moduleScopeForWorkspaceType(workspaceTypeId: string): ModuleScope {
  return workspaceTypeId === "cad" || workspaceTypeId === "code" ? workspaceTypeId : "all";
}

function isWorkspaceBlockingTab(pageId: string) {
  return pageId !== "home" && pageId !== "welcome" && pageId !== "config";
}

async function openWorkspace(entry: PnwRecentWorkspaceEntry) {
  if (entry.availability === "missing" || entry.availability === "unauthorized") return;
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
}

async function removeRecent(entry: PnwRecentWorkspaceEntry) {
  const choice = await pnwPromptChoice({
    title: "移除最近工作空间",
    message: `仅从最近列表移除，不会删除磁盘上的项目文件。\n\n${entry.rootPath}`,
    choices: [
      { id: "remove", label: "移除记录", variant: "default" },
      { id: "cancel", label: "取消", variant: "default" },
    ],
    defaultChoiceId: "cancel",
  });
  if (choice.choiceId !== "remove") return;
  try {
    await shell.removeRecentWorkspace(entry.rootPath);
    shell.setStatus("已从最近列表移除");
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function onWorkspaceTypeChange(rootPath: string, workspaceTypeId: string) {
  try {
    const scope = moduleScopeForWorkspaceType(workspaceTypeId);
    await shell.setWorkspaceType(rootPath, workspaceTypeId);
    await shell.setWorkspaceModuleScope(rootPath, scope);
    shell.setStatus(`工作空间类型已更新；模块范围为 ${moduleScopeLabel(scope)}`);
  } catch (error) {
    shell.setStatus(String(error));
  }
}

function openWorkspacePicker() {
  void pickAndOpenWorkspace({ enterWorkbench: false });
}

function openConfig() {
  if (!workspacePath.value) return;
  shell.openConfig();
}

function onGateModeUpdate(mode: PnwWorkspaceGateMode) {
  if (mode === "welcome") {
    shell.goToPage("welcome");
    return;
  }
  void shell.enterWorkbenchFromWelcome();
}

async function closeWorkspace() {
  try {
    await shell.requestCloseWorkspace();
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function enterAndStartTour() {
  if (!workspacePath.value || touring.value || picking.value) return;
  touring.value = true;
  try {
    await startShellTour(true);
  } finally {
    touring.value = false;
  }
}

</script>

<template>
  <PnwWorkspaceGate
    data-tour-page-welcome
    :state="shell.workspaceState.value"
    :mode="gateMode"
    :color-scheme="props.colorScheme"
    policy="required"
    :app-title="appTitle"
    product-subtitle="Phoenix 桌面工具"
    heading="欢迎使用 Phoenix"
    description="在下方选择工程类型（综合 / Code / CAD / 照明），打开后进入对应工具台；未关闭的业务 View 会按工作空间恢复。"
    open-label="打开工作空间"
    close-workspace-label="关闭工作空间"
    recent-title="最近使用"
    recent-collapsible
    :recent-default-open="true"
    :disabled="workspaceWelcomeDisabled"
    @open-workspace="openWorkspacePicker"
    @open-recent="openWorkspace"
    @remove-recent="removeRecent"
    @close-workspace="closeWorkspace"
    @update:mode="onGateModeUpdate"
  >
    <template #brand>
      <header class="desk-welcome-brand">
        <PnwPhoenixWingMark class="desk-welcome-brand-mark" decorative />
        <span class="desk-welcome-brand-copy">
          <strong>PHOENIX</strong>
          <small>{{ appTitle }}</small>
        </span>
      </header>
    </template>

    <template #secondary-actions>
      <PnwWorkspaceRailAction
        v-if="workspacePath"
        label="界面巡游"
        icon="search"
        :disabled="touring || picking"
        title="进入工作空间并逐步介绍 Ribbon、页面 Tab 与工作区树"
        @activate="enterAndStartTour"
      />
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
      <PnwColorSchemeToggle
        :model-value="props.colorScheme"
        @update:model-value="emit('update:colorScheme', $event)"
      />
      <el-button
        :disabled="!workspacePath"
        :title="workspacePath ? '工作空间、FreeCAD 与界面偏好' : '请先打开工作空间'"
        @click="openConfig"
      >
        <el-icon aria-hidden="true"><Setting /></el-icon>
        设置
      </el-button>
    </template>

    <template #before-recent>
      <span data-tour-page-welcome-recent />
    </template>

    <template #entry-actions="{ entry }">
      <PnwWorkspaceTypeSelect
        v-if="entry.availability === 'available' || entry.availability === 'unknown'"
        :model-value="entry.workspaceTypeId ?? 'mixed'"
        size="compact"
        :aria-label="`${entry.name} 工作空间类型`"
        @update:model-value="onWorkspaceTypeChange(entry.rootPath, $event)"
      />
    </template>

    <template #empty>
      <p class="desk-welcome-empty">尚无最近工程。点击左侧“打开工作空间”选择工程根目录。</p>
    </template>

    <template #after-recent>
      <PnwInformationBlock
        class="desk-welcome-information"
        :definition="projectInformation"
      />
      <PnwInformationBlock
        class="desk-welcome-information"
        :definition="contributionInformation"
      >
        <template #footer>
          <PnwInformationCardGroup :definition="contributionCards" />
        </template>
      </PnwInformationBlock>
      <CaaUnsavedDraftsPanel />
    </template>

    <template #workbench="slotProps">
      <slot name="workbench" v-bind="slotProps" />
    </template>
  </PnwWorkspaceGate>
</template>

<style scoped>
.desk-welcome-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.desk-welcome-brand-mark {
  --pnw-phoenix-wing-mark-size: 40px;
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

.desk-welcome-links { display: grid; gap: 8px; justify-items: start; }
.desk-welcome-information { margin-top: 8px; }
.desk-welcome-empty {
  margin: 0;
  padding: 20px;
  color: var(--pnw-workbench-muted, #64748b);
  text-align: center;
}
</style>
