<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import {
  pnwCodeDefineReorderMembersPanel,
  type PnwCodeReorderMembersPanel,
  type PnwCodeReorderMembersPanelActionDetail,
  type PnwCodeReorderMembersPanelModel,
} from "@phoenix-wing/code-core/ui";
import {
  fetchGitInfo,
  fetchReorderMembersPrefs,
  initGitRepo,
  resolveReorderMembersScope,
  restoreGitPaths,
  runReorderMembers,
  saveReorderMembersPrefs,
} from "../api";
import type { GitWorkspaceInfo } from "../types/gitWorkspace";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useGitDiffPreview } from "../composables/useGitDiffPreview";
import { useAppShell } from "../composables/useAppShell";
import { useReorderMembersPageStore } from "../stores/reorderMembersPage";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import {
  KEVIN_SYSTEM_CODE_OPTIONS,
  useReorderMembersPropertySheet,
} from "../composables/useReorderMembersPropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

pnwCodeDefineReorderMembersPanel();

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const pageStore = useReorderMembersPageStore();
const worksetStore = useFileWorksetsStore();

type ChangedFileStatus = "dry_run" | "written";

type ChangedFileRow = {
  path: string;
  status: ChangedFileStatus;
};

// --- 工作集选择（页头 combo） ---
const selectedWorksetId = computed({
  get: () => pageStore.selectedWorksetId || "",
  set: (value: string) => pageStore.setSelectedWorksetId(value || null),
});

const selectedWorkset = computed(() => {
  if (!selectedWorksetId.value) return null;
  return worksetStore.worksetById(selectedWorksetId.value);
});

const worksetPathsForApi = computed(() => {
  const ws = selectedWorkset.value;
  if (!ws) return [] as string[];
  const entries = ws.entries ?? ws.paths;
  return (entries ?? []).map((e: any) => (typeof e === "string" ? e : e.path));
});
const primaryWorksetOptions = computed(() => [
  { value: "", label: "全工作空间" },
  ...worksetStore.worksetOptions.map((workset) => ({
    value: workset.id,
    label: `${workset.label}（${workset.count}）`,
  })),
]);

// --- 解析预览（可选的预检前预览文件列表） ---
const resolvedFiles = ref<string[]>([]);
const resolving = ref(false);

async function onResolve() {
  const paths = worksetPathsForApi.value;
  resolving.value = true;
  try {
    const out = await resolveReorderMembersScope({ repo_rel_paths: paths });
    resolvedFiles.value = out.resolved_files ?? [];
    const label = paths.length ? "工作集" : "全工作空间";
    if (out.total === 0) {
      shell.setStatus(`${label}内无匹配的 C++ 源文件（.h/.hpp/.cpp）`);
    } else {
      shell.setStatus(`${label}解析完成：${out.total} 个源文件`);
    }
  } catch (e) {
    shell.setStatus(String(e));
    resolvedFiles.value = [];
  } finally {
    resolving.value = false;
  }
}

// --- 运行 ---
const changedFileRows = ref<ChangedFileRow[]>([]);
const lastRunDryRun = ref(false);
const lastRunSummary = ref("");
const resultRevision = ref(0);
const reorderPanelRef = ref<PnwCodeReorderMembersPanel | null>(null);

const saving = ref(false);
const running = ref(false);

const gitInfo = ref<GitWorkspaceInfo | null>(null);
const gitInitLoading = ref(false);
const revertingPath = ref<string | null>(null);
const { preview: previewGitDiff } = useGitDiffPreview();

const gitReady = computed(() =>
  Boolean(gitInfo.value?.git_installed && gitInfo.value?.repo_initialized),
);

const changedTotal = computed(() => changedFileRows.value.length);
const reorderPanelMessage = computed(() => {
  const summary = lastRunSummary.value.trim();
  if (summary.length <= 240) return summary;
  const firstPath = summary.indexOf(" - ");
  return firstPath > 0 ? summary.slice(0, firstPath) : `${summary.slice(0, 237)}…`;
});

const reorderPanelModel = computed<PnwCodeReorderMembersPanelModel>(() => ({
  presentation: "results",
  status: running.value ? "running" : "done",
  message: reorderPanelMessage.value,
  scanned: resolvedFiles.value.length || changedFileRows.value.length,
  reorderRevision: resultRevision.value,
  reorderSelectedUris: [],
  reorderResults: changedFileRows.value.map((row) => ({
    uri: row.path,
    relativePath: row.path,
    kind: /\.(?:h|hh|hpp)$/iu.test(row.path) ? "header" : "source",
    encoding: "",
    changed: true,
    state: row.status === "dry_run" ? "pending" : "applied",
    warnings: [],
  })),
  capabilities: {
    scan: false,
    apply: false,
    addToWorkset: false,
    open: false,
    preview: false,
    cancel: false,
    selection: false,
    gitDiff: gitReady.value,
    revert: gitReady.value,
  },
}));

watch(reorderPanelModel, async (model) => {
  await nextTick();
  if (reorderPanelRef.value) reorderPanelRef.value.model = model;
}, { immediate: true, deep: true });

function buildChangedRows(paths: string[], dryRun: boolean): ChangedFileRow[] {
  const status: ChangedFileStatus = dryRun ? "dry_run" : "written";
  return paths.map((path) => ({ path, status }));
}

function collectChangedPaths(
  out: Awaited<ReturnType<typeof runReorderMembers>>,
): string[] {
  if (out.changed_files?.length) return out.changed_files;
  return (out.item_results ?? []).flatMap((item) => item.changed_files ?? []);
}

function canGitActions(row: ChangedFileRow): boolean {
  return row.status === "written" && gitReady.value;
}

function openIgnorePanel() {
  void shell.openCodeIgnoreSidebar();
}

async function loadGitInfo() {
  try {
    gitInfo.value = await fetchGitInfo();
  } catch {
    gitInfo.value = null;
  }
}

async function onGitInit() {
  const choice = await pnwPromptChoice({
    title: "初始化 Git 仓库",
    message:
      "将在当前工作空间根目录执行 git init。\n需本机已安装 Git。\n\n继续？",
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
  const choice = await pnwPromptChoice({
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
      changedFileRows.value = changedFileRows.value.filter(
        (r) => r.path !== row.path,
      );
      shell.setStatus(`已 Revert：${row.path}`);
    } else {
      shell.setStatus(
        `未能 Revert：${row.path}（可能未跟踪或无 Git 差异）`,
      );
    }
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    revertingPath.value = null;
  }
}

async function onReorderPanelAction(event: Event): Promise<void> {
  const detail = (event as CustomEvent<PnwCodeReorderMembersPanelActionDetail>).detail;
  if (detail.kind !== "reorderAction") return;
  const path = detail.uris[0];
  if (!path) return;
  const row = changedFileRows.value.find((item) => item.path === path);
  if (!row || !canGitActions(row)) return;
  if (detail.action === "gitDiff") {
    await previewGitDiff(path, "worktree");
    return;
  }
  if (detail.action === "revert") {
    await onRevertFile(row);
  }
}

function prefsPayload() {
  return pageStore.prefsPayload;
}

// --- 偏好持久化 ---
let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefsSave() {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null;
    void onSave();
  }, 400);
}

useReorderMembersPropertySheet(
  "reorder_members",
  schedulePrefsSave,
  (msg) => shell.setStatus(msg),
);

function updateIncludeCpp(checked: boolean) {
  if (!pageStore.setIncludeCpp(checked)) {
    shell.setStatus("至少勾选一种源文件类型");
    return;
  }
  schedulePrefsSave();
}

function updateIncludeHeader(checked: boolean) {
  if (!pageStore.setIncludeHeader(checked)) {
    shell.setStatus("至少勾选一种源文件类型");
    return;
  }
  schedulePrefsSave();
}

async function onSave() {
  saving.value = true;
  try {
    pageStore.syncFromServer(
      await saveReorderMembersPrefs(prefsPayload()),
    );
    shell.setStatus("已保存成员排序偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

// --- 执行排序 ---
function resolveRunParams(): { repo_rel_paths: string[]; scopeLabel: string } {
  const paths = worksetPathsForApi.value;
  if (paths.length) {
    return {
      repo_rel_paths: paths,
      scopeLabel: `工作集「${selectedWorkset.value?.name ?? ""}」${paths.length} 路径`,
    };
  }
  return { repo_rel_paths: [], scopeLabel: "全工作空间" };
}

async function onRun(dryRun: boolean) {
  const { repo_rel_paths: repoRelPaths, scopeLabel } = resolveRunParams();
  if (!dryRun) {
    const scopeDesc = repoRelPaths.length ? "工作集范围内的" : "全工作空间的";
    const choice = await pnwPromptChoice({
      title: "执行成员排序",
      message:
        `将直接写回${scopeDesc}.h / .cpp 文件。\n建议先点「预检」确认变更范围。\n\n确定执行排序？`,
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
  shell.appendLog(
    `[C++ 成员排序] ${mode} · ${scopeLabel}…`,
    { source: "reorder_members", open: true },
  );
  try {
    const out = await runReorderMembers({
      ...prefsPayload(),
      repo_rel_paths: repoRelPaths,
      dry_run: dryRun,
    });
    changedFileRows.value = buildChangedRows(
      collectChangedPaths(out),
      out.dry_run,
    );
    resultRevision.value += 1;
    lastRunDryRun.value = dryRun;
    lastRunSummary.value = out.summary || "";
    const logText = pageStore.verbose
      ? out.log || out.summary
      : out.summary || out.log;
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
  await worksetStore.hydrate(shell.workspacePath.value);
  try {
    await loadPrefsFromApi();
    await loadGitInfo();
  } catch (e) {
    shell.setStatus(String(e));
  }
});

watch(
  () => shell.workspacePath.value,
  async (ws) => {
    pageStore.hydrate(ws);
    await worksetStore.hydrate(ws);
    try {
      await loadPrefsFromApi();
      await loadGitInfo();
    } catch (e) {
      shell.setStatus(String(e));
    }
  },
);

async function loadPrefsFromApi() {
  try {
    const prefs = await fetchReorderMembersPrefs();
    pageStore.applyFromApi(prefs);
  } catch (e) {
    shell.setStatus(String(e));
  }
}

usePagePrimaryContribution("reorder_members", props.workbenchTabId, {
  summary: computed(() => lastRunSummary.value
    || (resolvedFiles.value.length ? `当前范围 ${resolvedFiles.value.length} 个 C++ 文件` : "尚未预检成员排序")),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "scope",
      title: "运行范围",
      description: "选择工作集限制处理范围；不选择时扫描整个工作空间。",
      controls: [
        {
          id: "workset",
          kind: "select",
          label: "工作集",
          modelValue: selectedWorksetId,
          options: primaryWorksetOptions,
          clearable: true,
          onUpdate: (value) => { selectedWorksetId.value = value; },
        },
        {
          id: "resolved-count",
          kind: "readonly",
          label: "预检文件",
          value: computed(() => resolvedFiles.value.length || "—"),
        },
      ],
      actions: [
        { id: "resolve", label: "预检范围", loading: resolving, run: onResolve },
        { id: "ignore", label: "忽略设定", run: openIgnorePanel },
      ],
    },
    {
      id: "options",
      title: "排序选项",
      controls: [
        {
          id: "cpp",
          kind: "boolean",
          label: ".cpp",
          modelValue: computed(() => pageStore.includeCpp),
          onUpdate: updateIncludeCpp,
        },
        {
          id: "header",
          kind: "boolean",
          label: "头文件（.h / .hpp）",
          modelValue: computed(() => pageStore.includeHeader),
          onUpdate: updateIncludeHeader,
        },
        {
          id: "verbose",
          kind: "boolean",
          label: "详细日志",
          modelValue: computed(() => pageStore.verbose),
          onUpdate: (checked) => {
            pageStore.setVerbose(checked);
            schedulePrefsSave();
          },
        },
        {
          id: "kevin-mode",
          kind: "select",
          label: "KEVIN_SYSTEM_CODE",
          modelValue: computed(() => pageStore.kevinSystemCodeMode),
          options: KEVIN_SYSTEM_CODE_OPTIONS,
          description: KEVIN_SYSTEM_CODE_OPTIONS.find((option) => option.value === pageStore.kevinSystemCodeMode)
            ?.description,
          onUpdate: (value) => {
            pageStore.setKevinSystemCodeMode(value as typeof pageStore.kevinSystemCodeMode);
            schedulePrefsSave();
          },
        },
      ],
      actions: [
        { id: "save", label: "保存偏好", loading: saving, run: onSave },
        {
          id: "dry-run",
          label: "预检",
          tone: "primary",
          loading: running,
          run: () => onRun(true),
        },
        {
          id: "apply",
          label: "执行排序",
          tone: "danger",
          loading: running,
          run: () => onRun(false),
        },
      ],
    },
  ]),
});
</script>

<template>
  <div class="page tool-page reorder-page">
    <PageHeader title="C++ 成员排序" page-id="reorder_members">
      <template #actions>
        <el-select
          v-model="selectedWorksetId"
          size="small"
          placeholder="全工作空间"
          clearable
          style="width: 170px"
        >
          <el-option label="（未选）" value="" />
          <el-option
            v-for="w in worksetStore.worksetOptions"
            :key="w.id"
            :label="`${w.label}（${w.count}）`"
            :value="w.id"
          />
        </el-select>
        <el-button
          size="small"
          :loading="resolving"
          @click="onResolve"
        >
          预检范围
        </el-button>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button size="small" :loading="saving" @click="onSave">
            保存偏好
          </el-button>
          <el-button
            size="small"
            :loading="running"
            @click="onRun(true)"
          >
            预检
          </el-button>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button
            type="primary"
            size="small"
            :loading="running"
            @click="onRun(false)"
          >
            执行排序
          </el-button>
        </div>
        <el-button size="small" plain @click="openIgnorePanel">
          忽略设定
        </el-button>
      </template>
    </PageHeader>

    <!-- 预检范围预览 -->
    <section
      v-if="resolvedFiles.length"
      class="card resolved-card"
    >
      <div class="results-head-row">
        <span class="section-label">预检范围</span>
        <span class="head-meta muted small">
          工作集「{{ selectedWorkset?.name }}」→ {{ resolvedFiles.length }} 个源文件
        </span>
      </div>
      <el-table
        :data="resolvedFiles.map((f, i) => ({ index: i + 1, path: f }))"
        size="small"
        stripe
        class="resolved-table"
        max-height="200"
      >
        <el-table-column label="#" width="48" align="center">
          <template #default="{ row }">{{ row.index }}</template>
        </el-table-column>
        <el-table-column
          prop="path"
          label="文件路径"
          min-width="200"
          class-name="mono"
        />
      </el-table>
    </section>

    <!-- 变更文件 -->
    <section
      v-if="changedFileRows.length || lastRunSummary"
      class="card changed-card"
    >
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">变更文件</span>
          <span v-if="changedFileRows.length" class="muted small">
            {{ lastRunDryRun ? "预检" : "已写盘" }} · 共
            {{ changedTotal }} 个
          </span>
          <span v-else-if="lastRunSummary" class="muted small">
            本次无变更
          </span>
        </div>
        <p
          v-if="lastRunSummary && !changedFileRows.length"
          class="run-summary muted"
        >
          {{ lastRunSummary.split("\n")[0] }}
        </p>
        <div
          v-if="changedFileRows.length && !lastRunDryRun"
          class="git-hint-row"
        >
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

      <pnw-code-reorder-members-panel
        ref="reorderPanelRef"
        class="shared-reorder-results"
        @pnw-code-reorder-members-action="onReorderPanelAction"
      />
    </section>
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

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
}

.head-meta {
  flex: 1 1 auto;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resolved-table :deep(.mono) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.run-summary {
  margin: 6px 0 0;
  font-size: 0.78rem;
}

.small {
  font-size: 0.78rem;
}

.muted {
  color: var(--muted);
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
