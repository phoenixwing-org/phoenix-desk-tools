<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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
import { useAppShell } from "../composables/useAppShell";
import {
  CODE_RENAME_LEVEL_OPTIONS,
  useCodeRenamePageStore,
} from "../stores/codeRenamePage";

const shell = useAppShell();
const pageStore = useCodeRenamePageStore();

const LEVEL_OPTIONS = CODE_RENAME_LEVEL_OPTIONS;

const oldName = computed({
  get: () => pageStore.old,
  set: (value: string) => pageStore.setOld(value),
});
const newName = computed({
  get: () => pageStore.new,
  set: (value: string) => pageStore.setNew(value),
});
const scope = computed({
  get: () => pageStore.scope,
  set: (value: string) => pageStore.setScope(value),
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

async function onPreview() {
  if (!canRun.value) {
    shell.setStatus("请填写旧名、新名并勾选级别");
    return;
  }
  previewing.value = true;
  engineMessage.value = "";
  shell.appendLog("[Code 批量改名] 预览扫描…", { source: "code_rename", open: true });
  try {
    const out = await previewCodeRename(pageStore.prefsPayload);
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
  const ok = window.confirm(
    `将执行批量改名：\n  ${oldName.value.trim()} → ${newName.value.trim()}\n\n建议先预览。确定写盘？`,
  );
  if (!ok) return;
  applying.value = true;
  shell.appendLog("[Code 批量改名] 执行写盘…", { source: "code_rename", open: true });
  try {
    const out = await applyCodeRename(pageStore.prefsPayload);
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
      <div class="settings-form">
        <div class="form-row name-row">
          <label class="field">
            <span class="field-label">旧名</span>
            <input v-model="oldName" class="input mono" type="text" spellcheck="false" placeholder="精确匹配" />
          </label>
          <span class="arrow" aria-hidden="true">→</span>
          <label class="field">
            <span class="field-label">新名</span>
            <input v-model="newName" class="input mono" type="text" spellcheck="false" />
          </label>
          <label class="field field-scope">
            <span class="field-label">范围（可选）</span>
            <input v-model="scope" class="input mono" type="text" spellcheck="false" placeholder="相对子目录，空=全工作空间" />
          </label>
        </div>

        <div class="form-row form-foot">
          <div class="option-chips">
            <label v-for="opt in LEVEL_OPTIONS" :key="opt.id" class="opt-chip">
              <input
                type="checkbox"
                :checked="levels.has(opt.id)"
                @change="toggleLevel(opt.id, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ opt.label }}</span>
            </label>
            <label class="opt-chip">
              <select v-model="targetEncoding" class="encoding-select">
                <option value="utf-8">UTF-8 写回</option>
                <option value="gbk">GBK 写回</option>
              </select>
            </label>
            <label class="opt-chip">
              <input v-model="rescanIndex" type="checkbox" />
              <span>完成后重扫 Code 索引</span>
            </label>
            <label class="opt-chip danger-chip" title="包含忽略目录内的条目，慎用">
              <input v-model="includeIgnored" type="checkbox" />
              <span>包含忽略目录</span>
            </label>
          </div>
          <div class="settings-actions">
            <button type="button" class="btn btn-quiet btn-sm" :disabled="saving" @click="onSavePrefs">
              {{ saving ? "…" : "保存偏好" }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="previewing || !canRun" @click="onPreview">
              {{ previewing ? "…" : "预览" }}
            </button>
            <button type="button" class="btn primary btn-sm" :disabled="applying || !canRun" @click="onApply">
              {{ applying ? "…" : "执行改名" }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card ignore-banner">
      <span v-if="ignoreSummary" class="muted small">{{ ignoreSummary }}</span>
      <button type="button" class="btn btn-quiet btn-sm" @click="openIgnorePanel">右侧栏 · 忽略</button>
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

      <div class="table-wrap">
        <table v-if="hits.length" class="entry-table">
          <thead>
            <tr>
              <th>路径</th>
              <th class="col-level">级别</th>
              <th class="col-num">次数</th>
              <th>目标 / 行号</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in hits" :key="h.hit_id || `${h.repo_rel_path}-${i}`" :class="{ 'row-alt': i % 2 === 1 }">
              <td class="mono">{{ h.repo_rel_path }}</td>
              <td class="col-level">{{ hitLevelLabel(h.level) }}</td>
              <td class="col-num">{{ h.hits }}</td>
              <td class="mono muted">{{ h.new_path || h.lines?.join(", ") || "—" }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">{{ loading ? "加载中…" : "点击「预览」列出命中" }}</p>
      </div>
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

.name-row .field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  flex: 1;
}

.field-scope {
  min-width: 200px;
  flex: 1.4;
}

.field-label {
  font-size: 0.72rem;
  color: var(--muted);
}

.input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.82rem;
}

.arrow {
  padding-bottom: 8px;
  color: var(--muted);
}

.option-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #f8fafc;
  font-size: 0.76rem;
  cursor: pointer;
  user-select: none;
}

.opt-chip:has(input:checked),
.opt-chip:has(select) {
  background: #eff6ff;
  border-color: #93c5fd;
}

.danger-chip:has(input:checked) {
  background: #fef2f2;
  border-color: #fca5a5;
  color: #b91c1c;
}

.encoding-select,
.preset-select {
  border: none;
  background: transparent;
  font-size: inherit;
  cursor: pointer;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.btn-sm {
  padding: 5px 11px;
  font-size: 0.78rem;
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

.table-wrap {
  max-height: calc(100vh - 520px);
  overflow: auto;
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
}

.entry-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 1;
}

.col-level {
  width: 72px;
}

.col-num {
  width: 56px;
  text-align: center;
}

.row-alt {
  background: #fafbfc;
}

.empty {
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--muted);
  font-size: 0.82rem;
}
</style>
