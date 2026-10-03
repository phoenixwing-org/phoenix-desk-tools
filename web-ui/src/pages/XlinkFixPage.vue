<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import {
  analyzeXlinkFix,
  applyXlinkFixOverride,
  fetchXlinkFixCandidates,
  fetchXlinkPrefs,
  runXlinkFix,
  saveXlinkPrefs,
  type XlinkFixCandidateFile,
  type XlinkFixIssueRow,
  type XlinkFixOverrideResult,
  type XlinkFixResult,
} from "../api";
import ExpandCaret from "phoenix-wing/components/PnwExpandCaret.vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";
import { useXlinkFixPropertySheet } from "../composables/useXlinkFixPropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

type FilterTab = "all" | "fixable" | "not_found";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const batchDir = ref(".");
const allInDir = ref(true);
const saving = ref(false);
const analyzing = ref(false);
const applying = ref(false);
const filterTab = ref<FilterTab>("all");
const analysis = ref<XlinkFixResult | null>(null);
const applyResult = ref<XlinkFixResult | null>(null);
const showLog = ref(false);
const expandedKey = ref<string | null>(null);
const candidatesByKey = ref<Record<string, XlinkFixCandidateFile[]>>({});
const candidateMetaByKey = ref<Record<string, { part_key: string; part_number: string; part_version: string }>>({});
const candidatesLoading = ref<Record<string, boolean>>({});
const selectedTargetRel = ref<Record<string, string>>({});
const applyingKey = ref<string | null>(null);

function prefsPayload() {
  return {
    batch_dir: batchDir.value.trim(),
    all_in_dir: allInDir.value,
  };
}

const stats = computed(() => analysis.value?.stats ?? null);

const filteredRows = computed(() => {
  const rows = analysis.value?.issue_rows ?? [];
  if (filterTab.value === "fixable") return rows.filter((r) => r.status === "fixable");
  if (filterTab.value === "not_found") return rows.filter((r) => r.status === "not_found");
  return rows;
});

const canApply = computed(() => {
  const s = stats.value;
  return Boolean(s && s.fixable_count > 0 && !applying.value);
});

async function loadPrefs() {
  const prefs = await fetchXlinkPrefs();
  batchDir.value = prefs.batch_dir || ".";
  allInDir.value = prefs.all_in_dir;
}

async function onSavePrefs() {
  saving.value = true;
  try {
    const prefs = await saveXlinkPrefs({ ...prefsPayload(), dry_run: true });
    batchDir.value = prefs.batch_dir || ".";
    allInDir.value = prefs.all_in_dir;
    shell.setStatus("已保存链接修正偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefsSave() {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null;
    void onSavePrefs();
  }, 400);
}

useXlinkFixPropertySheet("xlink_fix", {
  batchDir,
  allInDir,
  analysis,
  onPersist: schedulePrefsSave,
});

function issueRowKey(row: XlinkFixIssueRow) {
  return `${row.host_repo_rel}\x00${row.old_path}`;
}

function canExpandRow(row: XlinkFixIssueRow) {
  return row.status === "not_found";
}

function isExpanded(row: XlinkFixIssueRow) {
  return expandedKey.value === issueRowKey(row);
}

function fcstdCandidates(key: string): XlinkFixCandidateFile[] {
  return candidatesByKey.value[key] ?? [];
}

function resolvedPartKey(row: XlinkFixIssueRow): string {
  if (row.part_key?.trim()) return row.part_key.trim();
  const meta = candidateMetaByKey.value[issueRowKey(row)];
  return meta?.part_key?.trim() ?? "";
}

function resolvedPartNumber(row: XlinkFixIssueRow): string {
  if (row.part_number?.trim()) return row.part_number.trim();
  return candidateMetaByKey.value[issueRowKey(row)]?.part_number?.trim() ?? "";
}

function resolvedPartVersion(row: XlinkFixIssueRow): string {
  if (row.part_version?.trim()) return row.part_version.trim();
  return candidateMetaByKey.value[issueRowKey(row)]?.part_version?.trim() ?? "";
}

function selectTarget(key: string, repoRel: string) {
  selectedTargetRel.value = { ...selectedTargetRel.value, [key]: repoRel };
}

function isTargetSelected(key: string, repoRel: string) {
  return selectedTargetRel.value[key] === repoRel;
}

async function toggleExpand(row: XlinkFixIssueRow) {
  if (!canExpandRow(row)) return;
  const key = issueRowKey(row);
  if (expandedKey.value === key) {
    expandedKey.value = null;
    return;
  }
  expandedKey.value = key;
  await loadCandidates(row);
}

async function loadCandidates(row: XlinkFixIssueRow) {
  const key = issueRowKey(row);
  if (key in candidatesByKey.value) return;
  candidatesLoading.value = { ...candidatesLoading.value, [key]: true };
  try {
    const data = await fetchXlinkFixCandidates({
      basename: row.basename || row.old_path,
      part_number: row.part_number,
      part_version: row.part_version,
      exclude_repo_rel: row.host_repo_rel,
    });
    if (!row.part_key && data.part_key) {
      row.part_number = data.part_number;
      row.part_version = data.part_version;
      row.part_key = data.part_key;
    }
    candidateMetaByKey.value = {
      ...candidateMetaByKey.value,
      [key]: {
        part_key: data.part_key,
        part_number: data.part_number,
        part_version: data.part_version,
      },
    };
    candidatesByKey.value = { ...candidatesByKey.value, [key]: data.files ?? [] };
    const files = data.files ?? [];
    if (files.length === 1) {
      selectedTargetRel.value = { ...selectedTargetRel.value, [key]: files[0].repo_rel_path };
    }
  } catch (e) {
    shell.setStatus(String(e));
    candidatesByKey.value = { ...candidatesByKey.value, [key]: [] };
  } finally {
    const next = { ...candidatesLoading.value };
    delete next[key];
    candidatesLoading.value = next;
  }
}

function openPartKey(row: XlinkFixIssueRow) {
  const pn = resolvedPartNumber(row);
  const pv = resolvedPartVersion(row);
  if (!pn || !pv) return;
  shell.openPartKeyDetail(pn, pv);
}

function markRowFixed(row: XlinkFixIssueRow, result: XlinkFixOverrideResult) {
  row.status = "fixed_manual";
  row.new_path = result.new_path;
  row.target_display = result.target_display;
  row.verdict = "手选";
  row.note = result.target_display ? `→ ${result.target_display}` : "";
  const s = analysis.value?.stats;
  if (s) {
    const n = Math.max(1, row.count || 1);
    s.not_found_count = Math.max(0, s.not_found_count - n);
  }
}

async function onApplyOne(row: XlinkFixIssueRow) {
  const key = issueRowKey(row);
  const target = selectedTargetRel.value[key]?.trim();
  if (!target) {
    shell.setStatus("请先选择目标 FCStd");
    return;
  }
  const result = await pnwPromptChoice({
    title: "修正此项",
    message: "将宿主内该 XLink 指向所选文件，是否继续？",
    choices: [
      { id: "write", label: "写回", variant: "primary" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "write") return;
  applyingKey.value = key;
  try {
    const result = await applyXlinkFixOverride({
      host_repo_rel: row.host_repo_rel,
      old_path: row.old_path,
      target_repo_rel: target,
    });
    markRowFixed(row, result);
    expandedKey.value = null;
    const msg = result.unchanged ? "路径未变（已与目标一致）" : `已写回 · ${result.new_path}`;
    shell.appendLog(`[链接路径修正] ${row.host_display} ${msg}`, { source: "xlink_fix" });
    shell.setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "xlink_fix" });
    shell.setStatus(String(e));
  } finally {
    applyingKey.value = null;
  }
}

async function onAnalyze() {
  analyzing.value = true;
  applyResult.value = null;
  analysis.value = null;
  expandedKey.value = null;
  candidatesByKey.value = {};
  candidateMetaByKey.value = {};
  selectedTargetRel.value = {};
  shell.appendLog("[链接路径修正] 开始分析…", { source: "xlink_fix", open: true });
  try {
    await saveXlinkPrefs({ ...prefsPayload(), dry_run: true });
    const data = await analyzeXlinkFix(prefsPayload());
    analysis.value = data;
    const s = data.stats;
    const msg = s
      ? `分析完成：扫描 ${s.host_count} 个文件 · ${s.hosts_with_issues} 个有问题 · 可修正 ${s.fixable_count} · 未找到 ${s.not_found_count}`
      : "分析完成";
    shell.appendLog(msg, { source: "xlink_fix" });
    if (data.log?.trim()) shell.appendLog(data.log.trim(), { source: "xlink_fix" });
    shell.setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "xlink_fix" });
    shell.setStatus(String(e));
  } finally {
    analyzing.value = false;
  }
}

async function onApply() {
  if (!canApply.value) return;
  const fixable = stats.value?.fixable_count ?? 0;
  const result = await pnwPromptChoice({
    title: "执行修正",
    message: `将写回 ${fixable} 处 XLink 路径到 FCStd，是否继续？`,
    choices: [
      { id: "write", label: "写回", variant: "primary" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "write") return;

  applying.value = true;
  shell.appendLog("[链接路径修正] 执行写回…", { source: "xlink_fix", open: true });
  try {
    const data = await runXlinkFix({ ...prefsPayload(), dry_run: false });
    applyResult.value = data;
    analysis.value = data;
    const n = data.stats?.total_changes ?? data.total_changes ?? 0;
    shell.appendLog(`已写回 ${n} 处 XLink`, { source: "xlink_fix" });
    if (data.log?.trim()) shell.appendLog(data.log.trim(), { source: "xlink_fix" });
    shell.setStatus(`修正完成 · 写回 ${n} 处`);
  } catch (e) {
    shell.appendLog(String(e), { source: "xlink_fix" });
    shell.setStatus(String(e));
  } finally {
    applying.value = false;
  }
}

function openHost(row: XlinkFixIssueRow) {
  const rel = row.host_repo_rel?.replace(/^\.\//, "");
  if (!rel) return;
  shell.openFileDetailForRel(rel, { subTab: "xref" });
}

function statusLabel(row: XlinkFixIssueRow) {
  if (row.status === "fixable") return "可修正";
  if (row.status === "fixed_manual") return "已修正";
  return "未找到";
}

function statusTagType(row: XlinkFixIssueRow): "success" | "warning" | "info" {
  if (row.status === "fixable" || row.status === "fixed_manual") return "success";
  return "warning";
}

usePagePrimaryContribution("xlink_fix", props.workbenchTabId, {
  summary: computed(() => stats.value
    ? `问题 ${stats.value.issue_count} · 可修正 ${stats.value.fixable_count} · 未找到 ${stats.value.not_found_count}`
    : "尚未分析 XLink 路径"),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "scope",
      title: "分析范围",
      controls: [
        {
          id: "dir",
          kind: "text",
          label: "修正目录",
          modelValue: batchDir,
          placeholder: "相对工作空间，如 .",
          mono: true,
          onUpdate: (value) => {
            batchDir.value = value;
            schedulePrefsSave();
          },
        },
        {
          id: "all",
          kind: "boolean",
          label: "目录内全部 FCStd",
          description: "扫描所选目录下全部 FCStd，而不只处理当前候选。",
          modelValue: allInDir,
          onUpdate: (checked) => {
            allInDir.value = checked;
            schedulePrefsSave();
          },
        },
      ],
      actions: [
        { id: "save", label: "保存偏好", loading: saving, run: onSavePrefs },
        {
          id: "analyze",
          label: "分析",
          tone: "primary",
          loading: analyzing,
          disabled: applying,
          run: onAnalyze,
        },
        {
          id: "apply",
          label: computed(() => stats.value?.fixable_count ? `执行修正（${stats.value.fixable_count}）` : "执行修正"),
          tone: "danger",
          loading: applying,
          disabled: computed(() => !canApply.value || analyzing.value),
          run: onApply,
        },
      ],
    },
    {
      id: "issues",
      title: "问题 View",
      controls: [
        {
          id: "filter",
          kind: "choice",
          label: "问题类型",
          modelValue: filterTab,
          options: [
            { value: "all", label: `全部（${stats.value?.issue_count ?? 0}）` },
            { value: "fixable", label: `可修正（${stats.value?.fixable_count ?? 0}）` },
            { value: "not_found", label: `未找到（${stats.value?.not_found_count ?? 0}）` },
          ],
          onUpdate: (value) => {
            filterTab.value = value === "fixable" || value === "not_found" ? value : "all";
          },
        },
        { id: "hosts", kind: "readonly", label: "扫描宿主", value: computed(() => stats.value?.host_count ?? 0) },
        { id: "visible", kind: "readonly", label: "当前显示", value: computed(() => filteredRows.value.length) },
        {
          id: "show-log",
          kind: "boolean",
          label: "显示分析日志",
          modelValue: showLog,
          onUpdate: (checked) => { showLog.value = checked; },
        },
      ],
    },
  ]),
});

onMounted(async () => {
  try {
    await loadPrefs();
  } catch (e) {
    shell.setStatus(String(e));
  }
});
</script>

<template>
  <div class="page tool-page xlink-page">
    <PageHeader title="链接路径修正" page-id="xlink_fix">
      <template #actions>
        <div data-tour-page-xlink-analyze class="head-actions-inner">
          <el-button size="small" :loading="saving" @click="onSavePrefs">保存偏好</el-button>
          <el-button type="primary" size="small" :loading="analyzing" :disabled="applying" @click="onAnalyze">
            分析
          </el-button>
          <el-button
            type="success"
            size="small"
            :loading="applying"
            :disabled="!canApply || analyzing"
            :title="canApply ? '' : '请先分析，且存在可修正项'"
            @click="onApply"
          >
            执行修正
          </el-button>
        </div>
      </template>
    </PageHeader>

    <section v-if="analysis" class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <h2 class="card-title">问题链接</h2>
          <el-radio-group v-model="filterTab" size="small" class="filter-tabs">
            <el-radio-button value="all">全部 {{ stats?.issue_count ?? 0 }}</el-radio-button>
            <el-radio-button value="fixable">可修正 {{ stats?.fixable_count ?? 0 }}</el-radio-button>
            <el-radio-button value="not_found">未找到 {{ stats?.not_found_count ?? 0 }}</el-radio-button>
          </el-radio-group>
        </div>
        <p v-if="stats" class="scan-summary">
          <span>扫描 <strong>{{ stats.host_count }}</strong> 个 FCStd</span>
          <span class="sep">·</span>
          <span>有问题宿主 <strong>{{ stats.hosts_with_issues }}</strong></span>
          <span class="sep">·</span>
          <span class="ok">可修正 <strong>{{ stats.fixable_count }}</strong></span>
          <span class="sep">·</span>
          <span class="warn">未找到 <strong>{{ stats.not_found_count }}</strong></span>
          <template v-if="stats.skipped_count">
            <span class="sep">·</span>
            <span>跳过 {{ stats.skipped_count }}</span>
          </template>
          <template v-if="applyResult && !applyResult.dry_run">
            <span class="sep">·</span>
            <span class="applied">已写回 {{ applyResult.stats?.total_changes ?? applyResult.total_changes ?? 0 }} 处</span>
          </template>
        </p>
      </header>

      <div v-if="filteredRows.length" class="table-wrap" data-tour-page-xlink-table>
        <table class="issue-table">
          <thead>
            <tr>
              <th class="col-expand" />
              <th>宿主文件</th>
              <th>原 XLink</th>
              <th>建议 / 状态</th>
              <th>判定</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="row in filteredRows" :key="issueRowKey(row)">
              <tr
                :class="[row.status, { 'row-expandable': canExpandRow(row), expanded: isExpanded(row) }]"
                @click="canExpandRow(row) ? toggleExpand(row) : undefined"
              >
                <td class="col-expand">
                  <button
                    v-if="canExpandRow(row)"
                    type="button"
                    class="pnw-expand-btn expand-btn"
                    :aria-expanded="isExpanded(row)"
                    title="展开：按零件标识选择目标 FCStd"
                    @click.stop="toggleExpand(row)"
                  >
                    <ExpandCaret :expanded="isExpanded(row)" />
                  </button>
                </td>
                <td @click.stop>
                  <button
                    v-if="row.host_repo_rel"
                    type="button"
                    class="link-btn mono"
                    @click="openHost(row)"
                  >
                    {{ row.host_display }}
                  </button>
                  <span v-else class="mono">{{ row.host_filename }}</span>
                </td>
                <td class="mono path-cell">
                  {{ row.old_path }}<span v-if="row.count > 1" class="cnt">×{{ row.count }}</span>
                </td>
                <td class="mono path-cell">
                  <template v-if="row.status === 'fixable' || row.status === 'fixed_manual'">{{ row.new_path }}</template>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <el-tag size="small" :type="statusTagType(row)" effect="light" round>
                    {{ statusLabel(row) }}
                  </el-tag>
                </td>
                <td class="note-cell">
                  <span v-if="row.target_display" class="target">→ {{ row.target_display }}</span>
                  <span v-if="row.verdict && row.verdict !== '未找到'">{{ row.verdict }}</span>
                  <span v-if="row.note && row.verdict !== '手选'" class="muted">{{ row.note }}</span>
                </td>
              </tr>
              <tr v-if="isExpanded(row)" class="expand-detail-row">
                <td colspan="6">
                  <div class="expand-panel" @click.stop>
                    <div v-if="resolvedPartKey(row)" class="expand-meta">
                      <span>零件标识</span>
                      <button type="button" class="link-btn mono" @click="openPartKey(row)">
                        {{ resolvedPartKey(row) }}
                      </button>
                      <span class="muted">· 从原 XLink 文件名推断（编号不必六位）</span>
                    </div>
                    <p v-else-if="!candidatesLoading[issueRowKey(row)]" class="expand-hint">
                      无法从文件名推断零件标识；若已加载，请从下表按文件名选择，或到零件目录查找。
                    </p>

                    <div
                      v-if="resolvedPartKey(row) || fcstdCandidates(issueRowKey(row)).length"
                      class="expand-candidates"
                    >
                      <p v-if="candidatesLoading[issueRowKey(row)]" class="expand-hint">加载候选…</p>
                      <p v-else-if="!fcstdCandidates(issueRowKey(row)).length" class="expand-hint">
                        该零件标识下无 present 的 FCStd，请先在 KT Auto CAD 扫描工作空间。
                      </p>
                      <ul v-else class="candidate-list">
                        <li v-for="file in fcstdCandidates(issueRowKey(row))" :key="file.id">
                          <label class="candidate-item">
                            <input
                              type="radio"
                              :name="'cand-' + issueRowKey(row)"
                              :checked="isTargetSelected(issueRowKey(row), file.repo_rel_path)"
                              @change="selectTarget(issueRowKey(row), file.repo_rel_path)"
                            />
                            <span class="mono candidate-name">{{ file.filename }}</span>
                            <span class="muted candidate-path">{{ file.repo_rel_path }}</span>
                          </label>
                        </li>
                      </ul>
                    </div>

                    <div v-if="fcstdCandidates(issueRowKey(row)).length" class="expand-actions">
                      <el-button
                        type="success"
                        size="small"
                        :loading="applyingKey === issueRowKey(row)"
                        :disabled="!selectedTargetRel[issueRowKey(row)]"
                        @click="onApplyOne(row)"
                      >
                        修正此项
                      </el-button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <el-empty
        v-else
        :description="analyzing ? '分析中…' : '当前筛选下无问题链接'"
        :image-size="64"
      />

      <el-button v-if="analysis.log" link type="primary" class="log-toggle" @click="showLog = !showLog">
        {{ showLog ? "隐藏" : "显示" }}运行日志
      </el-button>
      <pre v-if="showLog && analysis.log" class="log mono">{{ analysis.log }}</pre>
    </section>

    <el-empty v-else-if="!analyzing" description="设置扫描目录后点击「分析」" :image-size="64" class="empty-hint" />
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.xlink-page strong {
  font-weight: 600;
}

.card {
  padding: 12px 16px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  margin-bottom: 14px;
}

.card-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
}

.scope-line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px 16px;
  align-items: center;
}

.scope-label {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  white-space: nowrap;
  color: var(--text);
}

.settings-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  min-width: 0;
}

.meta-tag {
  max-width: min(320px, 42vw);
  overflow: hidden;
  text-overflow: ellipsis;
}

.scope-line :deep(.el-input) {
  width: 100%;
  min-width: 0;
}

.settings-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

@media (max-width: 720px) {
  .scope-line {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      "label input"
      "check check";
  }

  .scope-label {
    grid-area: label;
  }

  .scope-line :deep(.el-input) {
    grid-area: input;
  }

  .scope-line :deep(.el-checkbox) {
    grid-area: check;
    white-space: normal;
  }

  .settings-actions {
    width: 100%;
    margin-left: 0;
  }
}

.results-head {
  margin-bottom: 10px;
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 12px;
  align-items: center;
  justify-content: space-between;
}

.scan-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 0;
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.scan-summary .sep {
  margin: 0 6px;
  color: #cbd5e1;
}

.scan-summary strong {
  font-weight: 600;
  color: var(--text);
}

.scan-summary .ok strong {
  color: #059669;
}

.scan-summary .warn strong {
  color: #b45309;
}

.scan-summary .applied {
  color: #0369a1;
  font-weight: 500;
}

.issue-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.issue-table th,
.issue-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.issue-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 1;
}

.issue-table tr.fixable {
  background: #f0fdf4;
}

.issue-table tr.not_found {
  background: #fffbeb;
}

.issue-table tr.row-expandable {
  cursor: pointer;
}

.issue-table tr.row-expandable.expanded {
  background: #fef9c3;
}

.issue-table tr.fixed_manual {
  background: #f0fdf4;
}

.col-expand {
  width: calc(var(--pnw-expand-size) + 12px);
  padding: 4px 6px;
  vertical-align: middle;
}

.expand-detail-row td {
  padding: 0;
  border-bottom: 1px solid var(--border);
  background: #fafafa;
}

.expand-panel {
  padding: 10px 14px 12px 36px;
  font-size: 0.82rem;
}

.expand-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-bottom: 8px;
}

.expand-hint {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.78rem;
}

.candidate-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.candidate-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.candidate-item:hover {
  background: #f1f5f9;
}

.candidate-name {
  font-weight: 500;
}

.candidate-path {
  font-size: 0.75rem;
  word-break: break-all;
}

.expand-actions {
  margin-top: 10px;
}

.path-cell {
  word-break: break-all;
  max-width: 220px;
}

.note-cell {
  font-size: 0.78rem;
  line-height: 1.45;
}

.note-cell .target {
  display: block;
  color: #0369a1;
}

.cnt {
  margin-left: 4px;
  color: var(--muted);
  font-size: 0.75rem;
}

.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.link-btn:hover {
  text-decoration: underline;
}

.log-toggle {
  margin-top: 10px;
}

.empty-hint {
  margin-top: 14px;
}

.muted {
  color: var(--muted);
}
</style>
