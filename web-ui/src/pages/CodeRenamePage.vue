<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import {
  applyCodeRename,
  fetchCodeIgnorePrefs,
  fetchCodeRenamePrefs,
  previewCodeRename,
  saveCodeRenamePrefs,
  type CodeRenameHit,
  type RenameLevel,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import WorksetScopePicker from "../components/WorksetScopePicker.vue";
import { useAppShell } from "../composables/useAppShell";
import { useWorksetPageScope } from "../composables/useWorksetPageScope";
import {
  CODE_RENAME_LEVEL_OPTIONS,
  useCodeRenamePageStore,
} from "../stores/codeRenamePage";

const shell = useAppShell();
const pageStore = useCodeRenamePageStore();
const worksetScope = useWorksetPageScope("code_rename");

const LEVEL_OPTIONS = CODE_RENAME_LEVEL_OPTIONS;

const oldName = computed({
  get: () => pageStore.old,
  set: (value: string) => pageStore.setOld(value),
});
const newName = computed({
  get: () => pageStore.new,
  set: (value: string) => pageStore.setNew(value),
});
const targetEncoding = computed({
  get: () => pageStore.targetEncoding,
  set: (value: "utf-8" | "gbk") => pageStore.setTargetEncoding(value),
});
const includeIgnored = computed({
  get: () => pageStore.includeIgnored,
  set: (value: boolean) => pageStore.setIncludeIgnored(value),
});
const rescanIndex = computed({
  get: () => pageStore.rescanIndex,
  set: (value: boolean) => pageStore.setRescanIndex(value),
});
const levels = computed(() => pageStore.levelSet);
const canRun = computed(() => pageStore.canRun);

const ignoreSummary = ref("");

const hits = ref<CodeRenameHit[]>([]);
const previewSummary = ref<{ total_hits: number; text_files: number; dirs?: number; files?: number; skipped: number } | null>(null);
const engineMessage = ref("");

const loading = ref(false);
const saving = ref(false);
const previewing = ref(false);
const applying = ref(false);

async function loadIgnoreSummary() {
  try {
    const ig = await fetchCodeIgnorePrefs();
    ignoreSummary.value = `忽略 ${ig.ignore_patterns.length} 条（文件 ${ig.ignore_file_patterns.length} + 自定义 ${ig.ignore_custom_patterns.length}）`;
  } catch {
    ignoreSummary.value = "";
  }
}

function openIgnorePanel() {
  void shell.openCodeIgnoreSidebar();
}

function toggleLevel(id: RenameLevel, checked: boolean) {
  pageStore.toggleLevel(id, checked);
}

function levelLabel(id: RenameLevel) {
  return LEVEL_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

function hitLevelLabel(level: string) {
  return levelLabel(level as RenameLevel);
}

async function loadPrefs() {
  loading.value = true;
  try {
    pageStore.applyFromApi(await fetchCodeRenamePrefs());
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function onSavePrefs() {
  if (!levels.value.size) {
    shell.setStatus("至少勾选一种改名级别");
    return;
  }
  saving.value = true;
  try {
    pageStore.syncFromServer(await saveCodeRenamePrefs(pageStore.prefsPayload));
    shell.setStatus("已保存批量改名偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

function buildRunBody() {
  const { scope: _legacyScope, ...rest } = pageStore.prefsPayload;
  return { ...rest, ...worksetScope.buildScanBody() };
}

async function onPreview() {
  if (!canRun.value) {
    shell.setStatus("请填写旧名、新名并勾选级别");
    return;
  }
  previewing.value = true;
  engineMessage.value = "";
  shell.appendLog("[Code 批量改名] 预览扫描…", { source: "code_rename", open: true });
  try {
    const out = await previewCodeRename(buildRunBody());
    hits.value = out.hits || [];
    previewSummary.value = out.summary;
    engineMessage.value = out.message || "";
    const logText = out.lines?.join("\n") || out.log || out.message || "预览完成";
    shell.appendLog(logText, { source: "code_rename" });
    if (!out.implemented) {
      shell.setStatus(out.message || "引擎尚未接入");
    } else {
      shell.setStatus(`命中 ${out.summary?.total_hits ?? hits.value.length} 处`);
    }
  } catch (e) {
    shell.appendLog(String(e), { source: "code_rename" });
    shell.setStatus(String(e));
  } finally {
    previewing.value = false;
  }
}

async function onApply() {
  if (!canRun.value) {
    shell.setStatus("请填写旧名、新名并勾选级别");
    return;
  }
  const ok = await ElMessageBox.confirm(
    `将执行批量改名：\n  ${oldName.value.trim()} → ${newName.value.trim()}\n\n建议先预览。确定写盘？`,
    "执行批量改名",
    {
      type: "warning",
      confirmButtonText: "写盘",
      cancelButtonText: "取消",
      distinguishCancelAndClose: true,
    },
  ).then(
    () => true,
    () => false,
  );
  if (!ok) return;
  applying.value = true;
  shell.appendLog("[Code 批量改名] 执行写盘…", { source: "code_rename", open: true });
  try {
    const out = await applyCodeRename(buildRunBody());
    engineMessage.value = out.message || "";
    const logText = out.lines?.join("\n") || out.log || out.message || "完成";
    shell.appendLog(logText, { source: "code_rename" });
    shell.setStatus(out.implemented ? out.summary?.total_hits != null ? "执行完成" : "完成" : out.message || "引擎尚未接入");
  } catch (e) {
    shell.appendLog(String(e), { source: "code_rename" });
    shell.setStatus(String(e));
  } finally {
    applying.value = false;
  }
}

watch(
  () => shell.workspacePath.value,
  (ws) => {
    pageStore.hydrate(ws);
    void loadPrefs();
    void loadIgnoreSummary();
  },
);

onMounted(async () => {
  pageStore.hydrate(shell.workspacePath.value);
  await loadPrefs();
  await loadIgnoreSummary();
});
</script>

<template>
  <div class="page tool-page code-rename-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">Code 批量改名</h1>
        <p class="page-desc">
          工作空间内精确匹配改名（文件夹 / 文件 / 文本）；忽略规则在「Code 忽略设定」统一配置
        </p>
        <div class="head-help">
          <PageHelpButton page-id="code_rename" />
        </div>
      </div>
    </header>

    <section class="card settings-card">
      <el-form class="settings-form" label-position="top" @submit.prevent>
        <div class="form-row name-row">
          <el-form-item label="旧名" class="name-field">
            <el-input v-model="oldName" size="small" class="mono" spellcheck="false" placeholder="精确匹配" />
          </el-form-item>
          <span class="arrow" aria-hidden="true">→</span>
          <el-form-item label="新名" class="name-field">
            <el-input v-model="newName" size="small" class="mono" spellcheck="false" />
          </el-form-item>
        </div>

        <WorksetScopePicker page-id="code_rename" />

        <div class="form-row form-foot">
          <div class="option-row">
            <el-checkbox
              v-for="opt in LEVEL_OPTIONS"
              :key="opt.id"
              :model-value="levels.has(opt.id)"
              size="small"
              @change="toggleLevel(opt.id, Boolean($event))"
            >
              {{ opt.label }}
            </el-checkbox>
            <el-select v-model="targetEncoding" size="small" class="encoding-select">
              <el-option value="utf-8" label="UTF-8 写回" />
              <el-option value="gbk" label="GBK 写回" />
            </el-select>
            <el-checkbox v-model="rescanIndex" size="small">完成后重扫 Code 索引</el-checkbox>
            <el-checkbox v-model="includeIgnored" size="small" class="danger-opt" title="包含忽略目录内的条目，慎用">
              包含忽略目录
            </el-checkbox>
          </div>
          <div class="settings-actions">
            <el-button size="small" :loading="saving" @click="onSavePrefs">保存偏好</el-button>
            <el-button size="small" :loading="previewing" :disabled="!canRun" @click="onPreview">预览</el-button>
            <el-button type="primary" size="small" :loading="applying" :disabled="!canRun" @click="onApply">
              执行改名
            </el-button>
          </div>
        </div>
      </el-form>
    </section>

    <section class="card ignore-banner">
      <span v-if="ignoreSummary" class="muted small">{{ ignoreSummary }}</span>
      <el-button size="small" link type="primary" @click="openIgnorePanel">右侧栏 · 忽略</el-button>
    </section>

    <section class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">预览命中</span>
          <span v-if="previewSummary" class="muted small">
            共 {{ previewSummary.total_hits }} 处 · 文件夹 {{ previewSummary.dirs ?? 0 }} · 文件 {{ previewSummary.files ?? 0 }} · 文本 {{ previewSummary.text_files }} · 跳过 {{ previewSummary.skipped }}
          </span>
        </div>
        <p v-if="engineMessage" class="engine-msg">{{ engineMessage }}</p>
      </header>

      <el-table
        v-if="hits.length"
        :data="hits"
        size="small"
        stripe
        class="hits-table"
        row-key="hit_id"
        :empty-text="loading ? '加载中…' : '点击「预览」列出命中'"
      >
        <el-table-column prop="repo_rel_path" label="路径" min-width="200" class-name="mono" />
        <el-table-column label="级别" width="72" align="center">
          <template #default="{ row }">{{ hitLevelLabel(row.level) }}</template>
        </el-table-column>
        <el-table-column prop="hits" label="次数" width="64" align="center" />
        <el-table-column label="目标 / 行号" min-width="160">
          <template #default="{ row }">
            <span class="mono muted">{{ row.new_path || row.lines?.join(', ') || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else :description="loading ? '加载中…' : '点击「预览」列出命中'" :image-size="64" />
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

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
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
}

.form-foot {
  justify-content: space-between;
  align-items: center;
}

.name-row {
  align-items: flex-end;
}

.name-row .name-field {
  flex: 1;
  min-width: 140px;
  margin-bottom: 0;
}

.settings-form :deep(.el-form-item__label) {
  font-size: 0.72rem;
  color: var(--muted);
  padding-bottom: 2px;
  line-height: 1.2;
}

.arrow {
  padding-bottom: 8px;
  color: var(--muted);
}

.option-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.encoding-select {
  width: 120px;
}

.danger-opt :deep(.el-checkbox__label) {
  color: #b91c1c;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.ignore-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.engine-msg {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: #b45309;
}

.hits-table {
  width: 100%;
}

.hits-table :deep(.mono) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.82rem;
}

.muted {
  color: var(--muted);
}
</style>
