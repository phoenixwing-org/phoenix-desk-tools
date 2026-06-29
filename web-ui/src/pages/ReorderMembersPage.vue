<script setup lang="ts">
import { Document, Folder } from "@element-plus/icons-vue";
import { computed, onMounted, ref, watch } from "vue";
import { promptChoice } from "../composables/choiceDialog";
import {
  fetchGitInfo,
  fetchReorderMembersPrefs,
  fetchReorderMembersTopLevel,
  initGitRepo,
  restoreGitPaths,
  runReorderMembers,
  saveReorderMembersPrefs,
  type ReorderMembersEntry,
} from "../api";
import type { GitWorkspaceInfo } from "../types/gitWorkspace";
import PageHeader from "../components/PageHeader.vue";
import AppModalOverlay from "../components/AppModalOverlay.vue";
import GitChangePathLabel from "../components/git/GitChangePathLabel.vue";
import GitDiffPreviewButton from "../components/git/GitDiffPreviewButton.vue";
import GitRevertWorktreeButton from "../components/git/GitRevertWorktreeButton.vue";
import { useAppShell } from "../composables/useAppShell";
import { useReorderMembersPageStore } from "../stores/reorderMembersPage";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { useReorderMembersPropertySheet } from "../composables/useReorderMembersPropertySheet";
import { deriveReorderTopLevelFromWorkset } from "../utils/deriveReorderTopLevelFromWorkset";
import { formatFileAtRepoDir } from "../utils/workspaceFileQuery";

const shell = useAppShell();
const pageStore = useReorderMembersPageStore();
const worksetStore = useFileWorksetsStore();

const CHANGED_PAGE_SIZE = 20;

type ChangedFileStatus = "dry_run" | "written";

type ChangedFileRow = {
  path: string;
  status: ChangedFileStatus;
};

const selected = computed(() => pageStore.selectedSet);
const entriesExpanded = computed({
  get: () => pageStore.entriesExpanded,
  set: (value: boolean) => pageStore.setEntriesExpanded(value),
});

const ignoreFileDisplay = ref("");
const ignoreFileExists = ref(false);
const ignoredEntries = ref<Array<{ name: string; kind: string; reason: string }>>([]);
const entries = ref<ReorderMembersEntry[]>([]);
const ignoredCount = ref(0);

const changedFileRows = ref<ChangedFileRow[]>([]);
const lastRunDryRun = ref(false);
const lastRunSummary = ref("");
const changedPage = ref(0);
const ignoredModalOpen = ref(false);

const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const loadError = ref("");

const gitInfo = ref<GitWorkspaceInfo | null>(null);
const gitInitLoading = ref(false);
const revertingPath = ref<string | null>(null);

const gitReady = computed(() => Boolean(gitInfo.value?.git_installed && gitInfo.value?.repo_initialized));

const selectedCount = computed(() => pageStore.selectedCount);
const allChecked = computed(
  () => entries.value.length > 0 && entries.value.every((e) => selected.value.has(e.name)),
);
const dirCount = computed(() => entries.value.filter((e) => e.kind === "dir").length);
const fileCount = computed(() => entries.value.filter((e) => e.kind === "file").length);
const changedTotal = computed(() => changedFileRows.value.length);
const changedPageCount = computed(() => Math.max(1, Math.ceil(changedTotal.value / CHANGED_PAGE_SIZE)));
const changedPageSafe = computed(() =>
  Math.min(changedPage.value, Math.max(0, changedPageCount.value - 1)),
);
const pagedChangedFiles = computed(() => {
  const start = changedPageSafe.value * CHANGED_PAGE_SIZE;
  return changedFileRows.value.slice(start, start + CHANGED_PAGE_SIZE);
});

const activeWorksetPathCount = computed(() => {
  const ws = worksetStore.activeWorkset;
  if (!ws) return 0;
  const list = ws.entries ?? ws.paths;
  return list?.length ?? 0;
});
const canSelectFromWorkset = computed(
  () => activeWorksetPathCount.value > 0 && entries.value.length > 0 && !loading.value,
);

function fileKindLabel(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) return ".cpp";
  if (lower.endsWith(".hpp") || lower.endsWith(".hh")) return ".hpp";
  if (lower.endsWith(".h")) return ".h";
  return "源文件";
}

function changedStatusLabel(status: ChangedFileStatus): string {
  return status === "dry_run" ? "预检" : "已写盘";
}

function changedStatusTagType(status: ChangedFileStatus): "success" | "warning" {
  return status === "dry_run" ? "warning" : "success";
}

function changedStatusTitle(status: ChangedFileStatus): string {
  return status === "dry_run" ? "未写盘，仅分析变更范围" : "已写回磁盘";
}

function buildChangedRows(paths: string[], dryRun: boolean): ChangedFileRow[] {
  const status: ChangedFileStatus = dryRun ? "dry_run" : "written";
  return paths.map((path) => ({ path, status }));
}

function collectChangedPaths(out: Awaited<ReturnType<typeof runReorderMembers>>): string[] {
  if (out.changed_files?.length) return out.changed_files;
  return (out.item_results ?? []).flatMap((item) => item.changed_files ?? []);
}

function canGitActions(row: ChangedFileRow): boolean {
  return row.status === "written" && gitReady.value;
}

async function loadGitInfo() {
  try {
    gitInfo.value = await fetchGitInfo();
  } catch {
    gitInfo.value = null;
  }
}

async function onGitInit() {
  const choice = await promptChoice({
    title: "初始化 Git 仓库",
    message: "将在当前工作空间根目录执行 git init。\n需本机已安装 Git。\n\n继续？",
    defaultChoiceId: "cancel",
    choices: [
      { id: "cancel", label: "取消" },
      { id: "confirm", label: "初始化" },
    ],
  });
  if (choice.choiceId !== "confirm") return;
  gitInitLoading.value = true;
  try {
    const out = await initGitRepo();
    await loadGitInfo();
    shell.setStatus(`已初始化 Git：${out.git_root_display || out.git_root}`);
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    gitInitLoading.value = false;
  }
}

async function onRevertFile(row: ChangedFileRow) {
  if (!canGitActions(row)) return;
  const choice = await promptChoice({
    title: "Revert 文件",
    message: `将用 git restore 恢复：\n${row.path}\n\n未跟踪或二进制文件可能无法恢复。继续？`,
    defaultChoiceId: "cancel",
    choices: [
      { id: "cancel", label: "取消" },
      { id: "confirm", label: "Revert", variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;
  revertingPath.value = row.path;
  try {
    const out = await restoreGitPaths([row.path], "worktree");
    if (out.restored.includes(row.path)) {
      changedFileRows.value = changedFileRows.value.filter((r) => r.path !== row.path);
      shell.setStatus(`已 Revert：${row.path}`);
    } else {
      shell.setStatus(`未能 Revert：${row.path}（可能未跟踪或无 Git 差异）`);
    }
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    revertingPath.value = null;
  }
}

function prefsPayload() {
  return pageStore.prefsPayload;
}

function openIgnorePanel() {
  void shell.openCodeIgnoreSidebar();
}

function kindLabel(kind: string) {
  return kind === "file" ? "文件" : "目录";
}

async function loadPrefsFromApi() {
  const prefs = await fetchReorderMembersPrefs();
  ignoreFileDisplay.value = prefs.ignore_file_display || prefs.ignore_file;
  ignoreFileExists.value = prefs.ignore_file_exists;
  pageStore.setIgnoreFileDisplay(ignoreFileDisplay.value);
  pageStore.applyFromApi(prefs);
}

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefsSave() {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null;
    void onSave();
  }, 400);
}

useReorderMembersPropertySheet("reorder_members", schedulePrefsSave, (msg) => shell.setStatus(msg));

async function refreshList() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await fetchReorderMembersTopLevel();
    ignoreFileDisplay.value = data.ignore_file_display || data.ignore_file;
    ignoreFileExists.value = data.ignore_file_exists;
    entries.value = data.entries;
    ignoredEntries.value = data.ignored ?? [];
    ignoredCount.value = data.ignored?.length ?? 0;
    pageStore.filterSelected(new Set(data.entries.map((e) => e.name)));
  } catch (e) {
    loadError.value = String(e);
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  saving.value = true;
  try {
    pageStore.syncFromServer(await saveReorderMembersPrefs(prefsPayload()));
    shell.setStatus("已保存成员排序偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}


function toggleEntry(name: string, checked: boolean) {
  pageStore.toggleSelected(name, checked);
}

function toggleAll(checked: boolean) {
  pageStore.toggleAll(
    entries.value.map((e) => e.name),
    checked,
  );
}

function selectFromWorkset() {
  const ws = worksetStore.activeWorkset;
  const wsPaths = (ws?.entries ?? ws?.paths ?? []).map((e: any) => (typeof e === "string" ? e : e.path));
  if (!wsPaths.length) {
    shell.setStatus("侧栏活动工作集为空，请先在索引/树中归集文件");
    return;
  }
  const derived = deriveReorderTopLevelFromWorkset(
    wsPaths,
    entries.value.map((e) => e.name),
  );
  if (!derived.length) {
    shell.setStatus(`工作集「${ws.name}」中的路径与一级条目无交集`);
    return;
  }
  pageStore.toggleAll(derived, true);
  shell.setStatus(`已从工作集「${ws.name}」勾选 ${derived.length} 项`);
}

async function onRun(dryRun: boolean) {
  if (!selectedCount.value) {
    shell.setStatus("请至少勾选一项");
    return;
  }
  if (!dryRun) {
    const choice = await promptChoice({
      title: "执行成员排序",
      message: "将直接写回选中的 .h / .cpp 文件。\n建议先点「预检」确认变更范围。\n\n确定执行排序？",
      defaultChoiceId: "cancel",
      choices: [
        { id: "cancel", label: "取消" },
        { id: "confirm", label: "写盘", variant: "danger" },
      ],
    });
    if (choice.choiceId !== "confirm") return;
  }
  running.value = true;
  const mode = dryRun ? "预检" : "写盘";
  shell.appendLog(`[C++ 成员排序] ${mode} · ${selectedCount.value} 项…`, {
    source: "reorder_members",
    open: true,
  });
  try {
    const out = await runReorderMembers({
      ...prefsPayload(),
      targets: [...selected.value],
      dry_run: dryRun,
    });
    changedFileRows.value = buildChangedRows(collectChangedPaths(out), out.dry_run);
    changedPage.value = 0;
    lastRunDryRun.value = dryRun;
    lastRunSummary.value = out.summary || "";
    const logText = pageStore.verbose ? out.log || out.summary : out.summary || out.log;
    shell.appendLog(logText || "完成", { source: "reorder_members" });
    shell.setStatus(out.summary || (out.ok ? "完成" : "失败"));
    if (!dryRun) await loadGitInfo();
  } catch (e) {
    shell.appendLog(String(e), { source: "reorder_members" });
    shell.setStatus(String(e));
  } finally {
    running.value = false;
  }
}

onMounted(async () => {
  pageStore.hydrate(shell.workspacePath.value);
  try {
    await loadPrefsFromApi();
    await refreshList();
    await loadGitInfo();
  } catch (e) {
    shell.setStatus(String(e));
  }
});

watch(
  () => shell.workspacePath.value,
  async (ws) => {
    pageStore.hydrate(ws);
    try {
      await loadPrefsFromApi();
      await refreshList();
      await loadGitInfo();
    } catch (e) {
      shell.setStatus(String(e));
    }
  },
);
</script>

<template>
  <div class="page tool-page reorder-page">
    <PageHeader title="C++ 成员排序" page-id="reorder_members">
      <template #actions>
        <div class="toolbar-group">
          <el-button size="small" :loading="saving" @click="onSave">保存偏好</el-button>
          <el-button size="small" :loading="running" :disabled="!selectedCount" @click="onRun(true)">
            预检
          </el-button>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button
            type="primary"
            size="small"
            :loading="running"
            :disabled="!selectedCount"
            @click="onRun(false)"
          >
            执行排序
          </el-button>
        </div>
      </template>
    </PageHeader>

    <section class="card results-card" :class="{ collapsed: !entriesExpanded }">
      <div class="results-head-row">
        <el-button class="collapse-trigger" link type="primary" @click="entriesExpanded = !entriesExpanded">
          <span class="collapse-chevron" :class="{ open: entriesExpanded }" aria-hidden="true">▶</span>
          <span class="section-label">一级条目</span>
        </el-button>
        <span v-if="entries.length" class="head-meta muted small">
          已选 {{ selectedCount }}/{{ entries.length }}
          · 目录 {{ dirCount }}
          · 源文件 {{ fileCount }}
          <template v-if="ignoredCount"> · 已忽略 {{ ignoredCount }}</template>
        </span>
        <span v-else-if="loading" class="head-meta muted small">加载中…</span>
        <div class="results-head-actions">
          <el-button size="small" :loading="loading" @click="refreshList">刷新列表</el-button>
          <el-button
            size="small"
            plain
            :disabled="!canSelectFromWorkset"
            :title="
              activeWorksetPathCount
                ? `按侧栏活动工作集「${worksetStore.activeWorkset?.name ?? ''}」路径推导一级目录/文件`
                : '请先在侧栏选择活动工作集并添加文件'
            "
            @click="selectFromWorkset"
          >
            从工作集勾选
          </el-button>
          <el-button v-if="ignoredCount" size="small" @click="ignoredModalOpen = true">
            已忽略 {{ ignoredCount }}
          </el-button>
          <el-button size="small" plain @click="openIgnorePanel">忽略设定</el-button>
        </div>
      </div>

      <div v-show="entriesExpanded" class="results-body">
        <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" class="err-alert" />

        <el-table v-if="entries.length" :data="entries" size="small" stripe class="entries-table">
          <el-table-column width="44" align="center">
            <template #header>
              <el-checkbox :model-value="allChecked" @change="toggleAll(Boolean($event))" />
            </template>
            <template #default="{ row }">
              <el-checkbox
                :model-value="selected.has(row.name)"
                @change="toggleEntry(row.name, Boolean($event))"
              />
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="160" class-name="mono" />
          <el-table-column label="类型" width="52" align="center">
            <template #default="{ row }">
              <el-tooltip :content="kindLabel(row.kind)" placement="top" :show-after="400">
                <el-icon
                  class="entry-kind-icon"
                  :class="row.kind === 'file' ? 'is-file' : 'is-dir'"
                  :aria-label="kindLabel(row.kind)"
                >
                  <Document v-if="row.kind === 'file'" />
                  <Folder v-else />
                </el-icon>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column prop="source_file_count" label="源文件" width="72" align="center" />
        </el-table>
        <el-empty
          v-else
          :description="loading ? '加载中…' : loadError ? '加载失败' : '没有可列出的目录或源文件'"
          :image-size="64"
        />
      </div>
    </section>

    <section v-if="changedFileRows.length || lastRunSummary" class="card changed-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">变更文件</span>
          <span v-if="changedFileRows.length" class="muted small">
            {{ lastRunDryRun ? "预检" : "已写盘" }} · 共 {{ changedTotal }} 个
          </span>
          <span v-else-if="lastRunSummary" class="muted small">本次无变更</span>
        </div>
        <p v-if="lastRunSummary && !changedFileRows.length" class="run-summary muted">{{ lastRunSummary.split("\n")[0] }}</p>
        <div v-if="changedFileRows.length && !lastRunDryRun" class="git-hint-row">
          <el-alert
            v-if="gitInfo && !gitInfo.git_installed"
            type="warning"
            :closable="false"
            title="未检测到 Git，预览与 Revert 不可用（请本机安装 Git）"
            show-icon
          />
          <el-alert
            v-else-if="gitInfo && !gitInfo.repo_initialized"
            type="info"
            :closable="false"
            show-icon
          >
            <template #default>
              写盘后可用 Git 预览 diff。当前工作空间尚未初始化 Git。
              <el-button
                size="small"
                type="primary"
                link
                :loading="gitInitLoading"
                class="git-init-link"
                @click="onGitInit"
              >
                初始化 Git 仓库
              </el-button>
            </template>
          </el-alert>
        </div>
      </header>

      <el-table v-if="changedFileRows.length" :data="pagedChangedFiles" size="small" stripe class="changed-table">
        <el-table-column label="#" width="52" align="center">
          <template #default="{ $index }">
            {{ changedPageSafe * CHANGED_PAGE_SIZE + $index + 1 }}
          </template>
        </el-table-column>
        <el-table-column prop="path" label="文件" min-width="200" class-name="mono">
          <template #default="{ row }">
            <GitChangePathLabel
              :path="row.path"
              :label="formatFileAtRepoDir(row.path)"
              multiline
            />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="88" align="center">
          <template #default="{ row }">
            <el-tag
              size="small"
              effect="plain"
              :type="changedStatusTagType(row.status)"
              :title="changedStatusTitle(row.status)"
            >
              {{ changedStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ fileKindLabel(row.path) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="96" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="canGitActions(row)">
              <div class="git-row-actions">
                <GitDiffPreviewButton :path="row.path" />
                <GitRevertWorktreeButton
                  :path="row.path"
                  :loading="revertingPath === row.path"
                  @click="onRevertFile(row)"
                />
              </div>
            </template>
            <span v-else class="muted small">—</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="changedPageCount > 1"
        class="pager"
        layout="prev, pager, next"
        :total="changedTotal"
        :page-size="CHANGED_PAGE_SIZE"
        :current-page="changedPageSafe + 1"
        size="small"
        @current-change="(p: number) => (changedPage = p - 1)"
      />
    </section>

    <AppModalOverlay
      v-if="ignoredEntries.length"
      :open="ignoredModalOpen"
      aria-label="已忽略条目"
      panel-class="reorder-ignored-modal"
      @close="ignoredModalOpen = false"
    >
      <div class="rules-modal-inner">
        <header class="rules-modal-head">
          <h2 class="rules-modal-title">已忽略（{{ ignoredEntries.length }}）</h2>
          <el-button size="small" @click="ignoredModalOpen = false">关闭</el-button>
        </header>
        <el-table :data="ignoredEntries" size="small" stripe class="ignored-table">
          <el-table-column prop="name" label="名称" class-name="mono" />
          <el-table-column label="类型" width="72">
            <template #default="{ row }">{{ kindLabel(row.kind) }}</template>
          </el-table-column>
          <el-table-column label="原因">
            <template #default="{ row }">{{ row.reason === "内置" ? "内置" : "ignore 规则" }}</template>
          </el-table-column>
        </el-table>
        <p class="ignored-modal-foot muted small">
          规则说明见页顶 <strong>?</strong>；编辑忽略请点「忽略设定」。
        </p>
      </div>
    </AppModalOverlay>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.reorder-page strong {
  font-weight: 600;
}

.card {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.section-label {
  flex-shrink: 0;
  margin: 0;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--muted);
  white-space: nowrap;
  line-height: 1.2;
}

.err-alert {
  margin-bottom: 8px;
}

.entries-table :deep(.mono) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.entry-kind-icon {
  font-size: 16px;
  vertical-align: middle;
}

.entry-kind-icon.is-dir {
  color: var(--el-color-info);
}

.entry-kind-icon.is-file {
  color: var(--el-color-success);
}

.changed-table :deep(.mono) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.changed-table :deep(td.mono) {
  vertical-align: top;
}

.changed-table :deep(td.mono .cell) {
  white-space: normal !important;
  overflow: hidden;
  line-height: 1.35;
}

.changed-table :deep(td.mono .el-tooltip__trigger) {
  display: flex;
  align-items: flex-start;
  overflow: hidden;
  max-width: 100%;
}

.changed-table :deep(.git-row-actions) {
  justify-content: center;
}

.pager {
  margin-top: 10px;
  justify-content: center;
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
}

.results-card.collapsed {
  padding: 6px 12px;
}

.results-card.collapsed .results-head-row {
  flex-wrap: nowrap;
  gap: 8px;
}

.collapse-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}

.collapse-trigger:hover .section-label {
  color: var(--text);
}

.collapse-chevron {
  display: inline-block;
  font-size: 0.62rem;
  color: var(--muted);
  transition: transform 0.15s ease;
}

.collapse-chevron.open {
  transform: rotate(90deg);
}

.head-meta {
  flex: 1 1 auto;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-card:not(.collapsed) .head-meta {
  white-space: normal;
}

.results-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.results-body {
  margin-top: 8px;
}

.reorder-page .table-wrap {
  max-height: calc(100vh - 380px);
  padding: 0;
}

.changed-table-wrap {
  max-height: min(360px, calc(100vh - 420px));
}

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.pager-meta {
  font-size: 0.76rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.run-summary {
  margin: 6px 0 0;
  font-size: 0.78rem;
}

.rules-modal-inner {
  padding: 14px 16px 16px;
}

.rules-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.rules-modal-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.ignored-modal-foot {
  margin: 10px 0 0;
}

:global(.reorder-ignored-modal) {
  width: min(520px, 100%);
}

.entry-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.entry-table th,
.entry-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.entry-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 1;
  white-space: nowrap;
}

.col-check {
  width: 40px;
  text-align: center;
}

.col-kind {
  width: 72px;
}

.col-num {
  width: 72px;
  text-align: center;
}

.entry-name {
  font-weight: 600;
  word-break: break-all;
  line-height: 1.45;
}

.kind-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: #f1f5f9;
  border: 1px solid var(--border);
  color: var(--muted);
}

.kind-badge[data-kind="file"] {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.count-badge {
  display: inline-block;
  min-width: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid var(--border);
  font-size: 0.72rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.entry-table tbody tr:hover td {
  background: #f8fafc;
}

.entry-table tbody tr.row-alt td {
  background: #fafbfc;
}

.entry-table tbody tr.row-alt:hover td {
  background: #f1f5f9;
}

.err-msg {
  margin: 0 0 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.82rem;
  background: #fef2f2;
  color: #b91c1c;
}

.help-sub {
  margin: 0 0 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}

.help-sub + .help-list {
  margin-top: 0;
}

.help-list {
  margin: 0 0 12px;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.55;
}

.help-list:last-child {
  margin-bottom: 0;
}

.help-list li + li {
  margin-top: 4px;
}

.small {
  font-size: 0.78rem;
}

.muted {
  color: var(--muted);
}

.help-list .link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

@media (max-width: 720px) {
  .form-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-actions {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
