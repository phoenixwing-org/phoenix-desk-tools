<script setup lang="ts">
import { Refresh } from "@element-plus/icons-vue";
import GitPathFilterChips from "../components/git/GitPathFilterChips.vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import GitChangeList from "../components/git/GitChangeList.vue";
import GitSectionHead from "../components/git/GitSectionHead.vue";
import {
  fetchGitChanges,
  fetchGitInfo,
  initGitRepo,
  restoreGitPaths,
  stageGitPaths,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import { pnwPromptChoice } from "phoenix-wing";
import { useGitPropertySheet } from "../composables/useGitPropertySheet";
import { useGitPathFilter } from "../composables/useGitPathFilter";
import { useGitPageState } from "../composables/useGitPageState";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";
import { pushGitPathFilterHistory } from "../utils/gitPathFilterPrefs";
import type { GitChangeEntry, GitChangesPayload, GitWorkspaceInfo } from "../types/gitWorkspace";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const gitPageState = useGitPageState();

const loading = ref(false);
const actionPaths = ref<string[] | null>(null);
const revertPaths = ref<string[] | null>(null);
const bulkBusy = ref<{ section: "staged" | "changes" | "untracked"; kind: "primary" | "revert" } | null>(
  null,
);
const initLoading = ref(false);
const gitInfo = ref<GitWorkspaceInfo | null>(null);
const changesPayload = ref<GitChangesPayload | null>(null);
const loadError = ref("");
const filterTags = ref<string[]>([]);

const {
  filterHistory,
  tagSuggestions,
  snapshotForRefresh,
  restoreAfterRefresh,
  applyFilterSet,
} = useGitPathFilter(shell.workspacePath, filterTags);

function rememberFilters() {
  if (!filterTags.value.length) return;
  pushGitPathFilterHistory(shell.workspacePath.value, filterTags.value);
  shell.setStatus(`已记住 ${filterTags.value.length} 个筛选标签`);
}

const sectionOpen = ref({ staged: true, changes: true, untracked: true });

function toggleSection(key: "staged" | "changes" | "untracked") {
  sectionOpen.value[key] = !sectionOpen.value[key];
}

const gitReady = computed(
  () => Boolean(gitInfo.value?.git_installed && gitInfo.value?.repo_initialized),
);

const hasAnyGitChanges = computed(() => {
  const p = changesPayload.value;
  if (!p) return false;
  return p.staged.length + p.changes.length + p.untracked.length > 0;
});

function filterGitRows(rows: GitChangeEntry[]): GitChangeEntry[] {
  const tags = filterTags.value.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tags.length) return rows;
  return rows.filter((row) => {
    const path = row.path.toLowerCase();
    return tags.every((tag) => path.includes(tag));
  });
}

const filteredStaged = computed(() => filterGitRows(changesPayload.value?.staged ?? []));
const filteredChanges = computed(() => filterGitRows(changesPayload.value?.changes ?? []));
const filteredUntracked = computed(() => filterGitRows(changesPayload.value?.untracked ?? []));

const isFiltering = computed(() => filterTags.value.length > 0);

const hasFilteredResults = computed(
  () => filteredStaged.value.length + filteredChanges.value.length + filteredUntracked.value.length > 0,
);

function sectionCount(filtered: number, total: number): number | string {
  if (!isFiltering.value || filtered === total) return filtered;
  return `${filtered} / ${total}`;
}

useGitPropertySheet("git", {
  gitInfo,
  changesPayload,
  loading,
  loadError,
  initLoading,
  listViewMode: gitPageState.listViewMode,
  onListViewModeChange: gitPageState.setListViewMode,
});

async function refresh() {
  snapshotForRefresh();
  loading.value = true;
  loadError.value = "";
  try {
    gitInfo.value = await fetchGitInfo();
    if (gitInfo.value.repo_initialized) {
      changesPayload.value = await fetchGitChanges();
    } else {
      changesPayload.value = null;
    }
    gitPageState.setGitPageSnapshot({
      gitReady: Boolean(gitInfo.value?.git_installed && gitInfo.value?.repo_initialized),
      stagedCount: changesPayload.value?.staged_count ?? 0,
    });
  } catch (e) {
    loadError.value = String(e);
    gitInfo.value = null;
    changesPayload.value = null;
    gitPageState.setGitPageSnapshot({ gitReady: false, stagedCount: 0 });
  } finally {
    loading.value = false;
    restoreAfterRefresh();
  }
}

async function onInitGit() {
  initLoading.value = true;
  try {
    const out = await initGitRepo();
    shell.setStatus(`已初始化 Git：${out.git_root_display || out.git_root}`);
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    initLoading.value = false;
  }
}

async function onStage(paths: string[]) {
  if (!paths.length) return;
  actionPaths.value = paths;
  try {
    await stageGitPaths(paths);
    shell.setStatus(paths.length === 1 ? `已暂存：${paths[0]}` : `已暂存 ${paths.length} 个文件`);
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    actionPaths.value = null;
  }
}

async function onUnstage(paths: string[]) {
  if (!paths.length) return;
  actionPaths.value = paths;
  try {
    await restoreGitPaths(paths, "staged");
    shell.setStatus(
      paths.length === 1 ? `已取消暂存：${paths[0]}` : `已取消暂存 ${paths.length} 个文件`,
    );
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    actionPaths.value = null;
  }
}

async function onRevert(paths: string[], scope: "worktree" | "untracked" = "worktree") {
  if (!paths.length) return;
  const isUntracked = scope === "untracked";
  const pathSummary =
    paths.length === 1 ? paths[0]! : `${paths.length} 个路径（含 ${paths[0]} 等）`;
  const choice = await pnwPromptChoice({
    title: isUntracked ? "删除未跟踪" : "Revert 工作区",
    message: isUntracked
      ? `将删除未跟踪路径（不可恢复）：\n${pathSummary}\n\n继续？`
      : `将用 git restore 恢复至 HEAD：\n${pathSummary}\n\n工作区改动将丢失，继续？`,
    defaultChoiceId: "cancel",
    choices: [
      { id: "cancel", label: "取消" },
      { id: "confirm", label: isUntracked ? "删除" : "Revert", variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;

  revertPaths.value = paths;
  try {
    await restoreGitPaths(paths, scope);
    shell.setStatus(
      isUntracked
        ? paths.length === 1
          ? `已删除未跟踪：${paths[0]}`
          : `已删除 ${paths.length} 个未跟踪路径`
        : paths.length === 1
          ? `已 Revert：${paths[0]}`
          : `已 Revert ${paths.length} 个文件`,
    );
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    revertPaths.value = null;
  }
}

function sectionPaths(rows: GitChangeEntry[]) {
  return rows.map((row) => row.path);
}

function bulkBusyFor(section: "staged" | "changes" | "untracked", kind: "primary" | "revert") {
  return bulkBusy.value?.section === section && bulkBusy.value.kind === kind ? kind : null;
}

async function onBulkStage(section: "changes" | "untracked", rows: GitChangeEntry[]) {
  const paths = sectionPaths(rows);
  if (!paths.length) return;
  bulkBusy.value = { section, kind: "primary" };
  try {
    await stageGitPaths(paths);
    shell.setStatus(`已暂存 ${paths.length} 个文件`);
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    bulkBusy.value = null;
  }
}

async function onBulkUnstage(rows: GitChangeEntry[]) {
  const paths = sectionPaths(rows);
  if (!paths.length) return;
  bulkBusy.value = { section: "staged", kind: "primary" };
  try {
    await restoreGitPaths(paths, "staged");
    shell.setStatus(`已取消暂存 ${paths.length} 个文件`);
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    bulkBusy.value = null;
  }
}

async function onBulkRevert(
  section: "changes" | "untracked",
  rows: GitChangeEntry[],
  scope: "worktree" | "untracked",
) {
  const paths = sectionPaths(rows);
  if (!paths.length) return;
  const isUntracked = scope === "untracked";
  const choice = await pnwPromptChoice({
    title: isUntracked ? "删除全部未跟踪" : "Revert 全部更改",
    message: isUntracked
      ? `将删除 ${paths.length} 个未跟踪路径（不可恢复）。\n\n继续？`
      : `将用 git restore 恢复 ${paths.length} 个文件至 HEAD。\n\n工作区改动将丢失，继续？`,
    defaultChoiceId: "cancel",
    choices: [
      { id: "cancel", label: "取消" },
      { id: "confirm", label: isUntracked ? "全部删除" : "全部 Revert", variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;

  bulkBusy.value = { section, kind: "revert" };
  try {
    await restoreGitPaths(paths, scope);
    shell.setStatus(isUntracked ? `已删除 ${paths.length} 个未跟踪路径` : `已 Revert ${paths.length} 个文件`);
    await refresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    bulkBusy.value = null;
  }
}

usePagePrimaryContribution("git", props.workbenchTabId, {
  summary: computed(() => {
    if (loadError.value) return "Git 状态加载失败";
    if (!gitInfo.value?.git_installed) return "本机未检测到 Git";
    if (!gitInfo.value.repo_initialized) return "当前工作空间尚未初始化 Git";
    const total = (changesPayload.value?.staged_count ?? 0)
      + (changesPayload.value?.changes.length ?? 0)
      + (changesPayload.value?.untracked_count ?? 0);
    return total ? `工作区共 ${total} 项变更` : "工作区干净";
  }),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "repository",
      title: "仓库",
      controls: [
        {
          id: "root",
          kind: "readonly",
          label: "Git 根",
          value: computed(() => gitInfo.value?.git_root_display || "—"),
          mono: true,
        },
        { id: "staged", kind: "readonly", label: "已暂存", value: computed(() => changesPayload.value?.staged_count ?? 0) },
        { id: "changes", kind: "readonly", label: "更改", value: computed(() => changesPayload.value?.changes.length ?? 0) },
        { id: "untracked", kind: "readonly", label: "未跟踪", value: computed(() => changesPayload.value?.untracked_count ?? 0) },
      ],
      actions: [
        { id: "refresh", label: "刷新", loading, run: refresh },
        {
          id: "init",
          label: "初始化 Git",
          tone: "primary",
          loading: initLoading,
          disabled: computed(() => !gitInfo.value?.git_installed || Boolean(gitInfo.value?.repo_initialized)),
          run: onInitGit,
        },
      ],
    },
    {
      id: "filter",
      title: "变更 View",
      controls: [
        {
          id: "path-filter",
          kind: "text",
          label: "路径筛选",
          description: "多个词以空格或逗号分隔，路径需同时包含所有词。",
          modelValue: computed(() => filterTags.value.join(" ")),
          placeholder: "模块、目录或扩展名",
          mono: true,
          onUpdate: (value) => {
            filterTags.value = value.split(/[\s,，]+/).map((tag) => tag.trim()).filter(Boolean);
          },
        },
        {
          id: "view-mode",
          kind: "choice",
          label: "列表模式",
          modelValue: gitPageState.listViewMode,
          options: [
            { value: "file", label: "文件" },
            { value: "tree", label: "目录树" },
          ],
          onUpdate: (value) => gitPageState.setListViewMode(value === "tree" ? "tree" : "file"),
        },
        {
          id: "show-staged",
          kind: "boolean",
          label: "显示已暂存",
          modelValue: computed(() => sectionOpen.value.staged),
          onUpdate: (checked) => { sectionOpen.value = { ...sectionOpen.value, staged: checked }; },
        },
        {
          id: "show-changes",
          kind: "boolean",
          label: "显示更改",
          modelValue: computed(() => sectionOpen.value.changes),
          onUpdate: (checked) => { sectionOpen.value = { ...sectionOpen.value, changes: checked }; },
        },
        {
          id: "show-untracked",
          kind: "boolean",
          label: "显示未跟踪",
          modelValue: computed(() => sectionOpen.value.untracked),
          onUpdate: (checked) => { sectionOpen.value = { ...sectionOpen.value, untracked: checked }; },
        },
      ],
      actions: [
        {
          id: "remember-filter",
          label: "记住筛选",
          disabled: computed(() => !filterTags.value.length),
          run: rememberFilters,
        },
        {
          id: "clear-filter",
          label: "清空筛选",
          disabled: computed(() => !filterTags.value.length),
          run: () => { filterTags.value = []; },
        },
      ],
    },
    {
      id: "stage",
      title: "暂存操作",
      description: "提交说明与 Commit 固定在右侧 Secondary；这里管理当前筛选结果的暂存状态。",
      actions: [
        {
          id: "unstage",
          label: computed(() => `取消暂存（${filteredStaged.value.length}）`),
          disabled: computed(() => !gitReady.value || !filteredStaged.value.length),
          loading: computed(() => bulkBusy.value?.section === "staged"),
          run: () => onBulkUnstage(filteredStaged.value),
        },
        {
          id: "stage-changes",
          label: computed(() => `暂存更改（${filteredChanges.value.length}）`),
          tone: "primary",
          disabled: computed(() => !gitReady.value || !filteredChanges.value.length),
          loading: computed(() => bulkBusy.value?.section === "changes"),
          run: () => onBulkStage("changes", filteredChanges.value),
        },
        {
          id: "stage-untracked",
          label: computed(() => `暂存未跟踪（${filteredUntracked.value.length}）`),
          disabled: computed(() => !gitReady.value || !filteredUntracked.value.length),
          loading: computed(() => bulkBusy.value?.section === "untracked"),
          run: () => onBulkStage("untracked", filteredUntracked.value),
        },
      ],
    },
  ]),
});

onMounted(() => {
  void shell.setPropertiesOpen(true);
  gitPageState.registerGitRefresh(refresh);
  void refresh();
});

onUnmounted(() => {
  gitPageState.unregisterGitRefresh(refresh);
});
</script>

<template>
  <div class="page tool-page git-page">
    <div class="git-page-head">
      <PageHeader title="Git" page-id="git">
        <template #actions>
          <GitPathFilterChips
            v-model="filterTags"
            :workspace-path="shell.workspacePath.value"
            :history="filterHistory"
            :suggestions="tagSuggestions"
            @apply-set="applyFilterSet"
            @remember="rememberFilters"
          />
          <el-button size="small" :loading="loading" @click="refresh">
            <el-icon class="btn-icon"><Refresh /></el-icon>
            刷新
          </el-button>
        </template>
      </PageHeader>
    </div>

    <div class="git-page-body">
      <el-alert v-if="loadError" type="error" :title="loadError" show-icon class="git-banner" />

    <el-alert
      v-if="gitInfo && !gitInfo.git_installed"
      type="warning"
      title="未检测到本机 Git，请先安装 Git 后再使用此页。"
      show-icon
      class="git-banner"
    />

    <el-alert
      v-else-if="gitInfo && !gitInfo.repo_initialized"
      type="info"
      show-icon
      class="git-banner"
    >
      <template #title>工作空间根目录尚未 git init</template>
      <el-button type="primary" link :loading="initLoading" @click="onInitGit">在此工作空间根初始化 Git</el-button>
    </el-alert>

    <template v-if="gitReady && changesPayload">
      <el-empty
        v-if="!hasAnyGitChanges"
        description="工作区干净，无改动"
        :image-size="64"
        class="git-clean-empty"
      />

      <el-empty
        v-else-if="isFiltering && !hasFilteredResults"
        description="无匹配的文件更改"
        :image-size="64"
        class="git-clean-empty"
      />

      <template v-else>
      <section
        v-if="changesPayload.staged.length"
        class="git-section card-block"
        :class="{ collapsed: !sectionOpen.staged }"
      >
        <GitSectionHead
          title="已暂存"
          :count="sectionCount(filteredStaged.length, changesPayload.staged.length)"
          :expanded="sectionOpen.staged"
          primary-action="minus"
          primary-tooltip="全部取消暂存"
          :busy="bulkBusyFor('staged', 'primary')"
          @toggle="toggleSection('staged')"
          @primary="onBulkUnstage(filteredStaged)"
        />
        <div v-show="sectionOpen.staged" class="section-body">
          <el-empty v-if="!filteredStaged.length" description="无匹配文件" :image-size="48" />
          <GitChangeList
            v-else
            :rows="filteredStaged"
            :mode="gitPageState.listViewMode.value"
            staged
            :action-paths="actionPaths"
            @unstage="onUnstage"
          />
        </div>
      </section>

      <section
        v-if="changesPayload.changes.length"
        class="git-section card-block"
        :class="{ collapsed: !sectionOpen.changes }"
      >
        <GitSectionHead
          title="更改"
          :count="sectionCount(filteredChanges.length, changesPayload.changes.length)"
          :expanded="sectionOpen.changes"
          primary-action="plus"
          primary-tooltip="全部暂存"
          show-revert
          :busy="bulkBusyFor('changes', 'primary') ?? bulkBusyFor('changes', 'revert')"
          @toggle="toggleSection('changes')"
          @primary="onBulkStage('changes', filteredChanges)"
          @revert="onBulkRevert('changes', filteredChanges, 'worktree')"
        />
        <div v-show="sectionOpen.changes" class="section-body">
          <el-empty v-if="!filteredChanges.length" description="无匹配文件" :image-size="48" />
          <GitChangeList
            v-else
            :rows="filteredChanges"
            :mode="gitPageState.listViewMode.value"
            revertable
            :action-paths="actionPaths"
            :revert-paths="revertPaths"
            @stage="onStage"
            @revert="(paths) => onRevert(paths, 'worktree')"
          />
        </div>
      </section>

      <section
        v-if="changesPayload.untracked.length"
        class="git-section card-block"
        :class="{ collapsed: !sectionOpen.untracked }"
      >
        <GitSectionHead
          title="未跟踪"
          :count="sectionCount(filteredUntracked.length, changesPayload.untracked.length)"
          :expanded="sectionOpen.untracked"
          primary-action="plus"
          primary-tooltip="全部暂存"
          show-revert
          :busy="bulkBusyFor('untracked', 'primary') ?? bulkBusyFor('untracked', 'revert')"
          @toggle="toggleSection('untracked')"
          @primary="onBulkStage('untracked', filteredUntracked)"
          @revert="onBulkRevert('untracked', filteredUntracked, 'untracked')"
        />
        <div v-show="sectionOpen.untracked" class="section-body">
          <el-empty v-if="!filteredUntracked.length" description="无匹配文件" :image-size="48" />
          <GitChangeList
            v-else
            :rows="filteredUntracked"
            :mode="gitPageState.listViewMode.value"
            revertable
            :action-paths="actionPaths"
            :revert-paths="revertPaths"
            @stage="onStage"
            @revert="(paths) => onRevert(paths, 'untracked')"
          />
        </div>
      </section>
      </template>
    </template>
    </div>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.git-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  box-sizing: border-box;
}

.git-page-head {
  flex-shrink: 0;
  padding: 20px 22px 10px;
  background: var(--page-bg);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.git-page-head :deep(.page-head) {
  margin-bottom: 0;
}

.git-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 22px 32px;
}

.git-banner {
  margin-bottom: 12px;
}

.card-block {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--el-fill-color-blank);
}

.git-section:not(.collapsed) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.git-section.collapsed {
  padding-bottom: 10px;
}

.git-section:not(.collapsed) :deep(.git-section-head) {
  margin-bottom: 10px;
  flex-shrink: 0;
}

.section-body {
  min-height: 0;
  max-height: min(400px, calc(50vh - 120px));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.btn-icon {
  margin-right: 4px;
}

.git-clean-empty {
  padding: 24px 0;
}
</style>
