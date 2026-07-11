<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import {
  applyCodeRename,
  fetchCodeRenamePrefs,
  previewCodeRename,
  saveCodeRenamePrefs,
  type CodeRenameHit,
} from "../api";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";
import { useCodeRenamePropertySheet } from "../composables/useCodeRenamePropertySheet";
import { useWorksetPageScope } from "../composables/useWorksetPageScope";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import {
  CODE_RENAME_LEVEL_OPTIONS,
  useCodeRenamePageStore,
} from "../stores/codeRenamePage";

const shell = useAppShell();
const pageStore = useCodeRenamePageStore();
const worksetScope = useWorksetPageScope("code_rename");
const worksetStore = useFileWorksetsStore();

const canRun = computed(() => pageStore.canRun);

const hits = ref<CodeRenameHit[]>([]);
const previewSummary = ref<{ total_hits: number; text_files: number; dirs?: number; files?: number; skipped: number } | null>(null);
const engineMessage = ref("");

const loading = ref(false);
const saving = ref(false);
const previewing = ref(false);
const applying = ref(false);

function openIgnorePanel() {
  void shell.openCodeIgnoreSidebar();
}

function hitLevelLabel(level: string) {
  return CODE_RENAME_LEVEL_OPTIONS.find((o) => o.id === level)?.label ?? level;
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
  if (!pageStore.levels.length) {
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
    if (out.implemented === false) {
      shell.setStatus(out.message || "预览不可用");
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
  const result = await pnwPromptChoice({
    title: "执行批量改名",
    message: `将执行批量改名：\n  ${pageStore.old.trim()} → ${pageStore.new.trim()}\n\n建议先预览。确定写盘？`,
    choices: [
      { id: "write", label: "写盘", variant: "primary" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "write") return;
  applying.value = true;
  shell.appendLog("[Code 批量改名] 执行写盘…", { source: "code_rename", open: true });
  try {
    const out = await applyCodeRename(buildRunBody());
    engineMessage.value = out.message || "";
    const logText = out.lines?.join("\n") || out.log || out.message || "完成";
    shell.appendLog(logText, { source: "code_rename" });
    shell.setStatus(out.implemented === false ? out.message || "执行不可用" : "执行完成");
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
  },
);

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefsSave() {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null;
    void onSavePrefs();
  }, 400);
}

useCodeRenamePropertySheet("code_rename", schedulePrefsSave, (msg) => shell.setStatus(msg));

onMounted(async () => {
  pageStore.hydrate(shell.workspacePath.value);
  await loadPrefs();
});
</script>

<template>
  <div class="page tool-page code-rename-page">
    <PageHeader title="Code 批量改名" page-id="code_rename">
      <template #actions>
        <el-select
          :model-value="worksetScope.worksetId.value ?? ''"
          size="small"
          placeholder="全工作空间"
          clearable
          style="width: 160px"
          @update:model-value="
            worksetScope.worksetId.value = $event || null;
            worksetScope.scopeMode.value = $event ? 'workset' : 'all';
          "
        >
          <el-option label="全工作空间" value="" />
          <el-option
            v-for="w in worksetStore.worksetOptions"
            :key="w.id"
            :label="`${w.label}（${w.count}）`"
            :value="w.id"
          />
        </el-select>
        <div class="toolbar-group">
          <el-button size="small" plain @click="openIgnorePanel">忽略设定</el-button>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button size="small" :loading="saving" @click="onSavePrefs">保存偏好</el-button>
          <el-button size="small" :loading="previewing" :disabled="!canRun" @click="onPreview">预览</el-button>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button type="primary" size="small" :loading="applying" :disabled="!canRun" @click="onApply">
            执行改名
          </el-button>
        </div>
      </template>
    </PageHeader>

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
