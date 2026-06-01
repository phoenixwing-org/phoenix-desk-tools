<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  analyzeXlinkFix,
  fetchXlinkPrefs,
  runXlinkFix,
  saveXlinkPrefs,
  type XlinkFixIssueRow,
  type XlinkFixResult,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

type FilterTab = "all" | "fixable" | "not_found";

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

async function onAnalyze() {
  analyzing.value = true;
  applyResult.value = null;
  analysis.value = null;
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
  if (!window.confirm(`将写回 ${fixable} 处 XLink 路径到 FCStd，是否继续？`)) return;

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
  return row.status === "fixable" ? "可修正" : "未找到";
}

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
    <header class="page-head">
      <h1 class="page-title">链接路径修正</h1>
      <p class="page-desc">
        基于 CAD 索引库扫描 FCStd 内失效的 <code>&lt;XLink file="…"&gt;</code>。
        请先<strong>分析</strong>查看问题列表，确认后再<strong>执行修正</strong>写回文件。
      </p>
    </header>

    <section class="card settings-card">
      <h2 class="card-title">扫描范围</h2>
      <label class="field-label" for="batch-dir">修正目录（相对工作空间）</label>
      <input
        id="batch-dir"
        v-model="batchDir"
        class="path-input"
        spellcheck="false"
        placeholder="."
      />
      <label class="chk-row">
        <input v-model="allInDir" type="checkbox" />
        扫描目录内全部 FCStd（推荐）
      </label>
      <p v-if="analysis?.map_path_display" class="meta-line">索引库：{{ analysis.map_path_display }}</p>
      <p v-if="analysis?.batch_dir_display" class="meta-line">目录：{{ analysis.batch_dir_display }}</p>
      <div class="action-row">
        <button type="button" class="btn" :disabled="saving" @click="onSavePrefs">
          {{ saving ? "…" : "保存偏好" }}
        </button>
        <button type="button" class="btn primary" :disabled="analyzing || applying" @click="onAnalyze">
          {{ analyzing ? "分析中…" : "分析" }}
        </button>
        <button
          type="button"
          class="btn apply-btn"
          :disabled="!canApply || analyzing"
          :title="canApply ? '' : '请先分析，且存在可修正项'"
          @click="onApply"
        >
          {{ applying ? "写回中…" : "执行修正" }}
        </button>
      </div>
    </section>

    <section v-if="stats" class="stats">
      <span>扫描 <strong>{{ stats.host_count }}</strong> 个 FCStd</span>
      <span>有问题宿主 <strong>{{ stats.hosts_with_issues }}</strong></span>
      <span class="ok">可修正 <strong>{{ stats.fixable_count }}</strong></span>
      <span class="warn">未找到 <strong>{{ stats.not_found_count }}</strong></span>
      <span v-if="stats.skipped_count">跳过 {{ stats.skipped_count }}</span>
      <span v-if="applyResult && !applyResult.dry_run" class="applied">已写回 {{ applyResult.stats?.total_changes ?? applyResult.total_changes ?? 0 }} 处</span>
    </section>

    <section v-if="analysis" class="card results-card">
      <div class="results-head">
        <h2 class="card-title">问题链接</h2>
        <div class="filter-tabs">
          <button
            type="button"
            class="tab"
            :class="{ active: filterTab === 'all' }"
            @click="filterTab = 'all'"
          >
            全部 {{ stats?.issue_count ?? 0 }}
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: filterTab === 'fixable' }"
            @click="filterTab = 'fixable'"
          >
            可修正 {{ stats?.fixable_count ?? 0 }}
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: filterTab === 'not_found' }"
            @click="filterTab = 'not_found'"
          >
            未找到 {{ stats?.not_found_count ?? 0 }}
          </button>
        </div>
      </div>

      <div v-if="filteredRows.length" class="table-wrap">
        <table class="issue-table">
          <thead>
            <tr>
              <th>宿主文件</th>
              <th>原 XLink</th>
              <th>建议 / 状态</th>
              <th>判定</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in filteredRows" :key="idx" :class="row.status">
              <td>
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
              <td class="mono path-cell">{{ row.old_path }}<span v-if="row.count > 1" class="cnt">×{{ row.count }}</span></td>
              <td class="mono path-cell">
                <template v-if="row.status === 'fixable'">{{ row.new_path }}</template>
                <span v-else class="muted">—</span>
              </td>
              <td><span class="badge" :class="row.status">{{ statusLabel(row) }}</span></td>
              <td class="note-cell">
                <span v-if="row.target_display" class="target">→ {{ row.target_display }}</span>
                <span v-if="row.verdict && row.verdict !== '未找到'">{{ row.verdict }}</span>
                <span v-if="row.note" class="muted">{{ row.note }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">{{ analyzing ? "分析中…" : "当前筛选下无问题链接" }}</p>

      <button v-if="analysis.log" type="button" class="log-toggle" @click="showLog = !showLog">
        {{ showLog ? "隐藏" : "显示" }}运行日志
      </button>
      <pre v-if="showLog && analysis.log" class="log mono">{{ analysis.log }}</pre>
    </section>

    <p v-else-if="!analyzing" class="empty-hint">设置扫描目录后点击「分析」</p>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.xlink-page strong {
  font-weight: 600;
}

.card {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  margin-bottom: 14px;
}

.card-title {
  margin: 0 0 10px;
  font-size: 0.92rem;
  font-weight: 600;
}

.chk-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  font-size: 0.85rem;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.apply-btn {
  background: #059669;
  color: #fff;
  border-color: #059669;
}

.apply-btn:disabled {
  background: var(--btn-bg);
  color: inherit;
  border-color: var(--border-strong);
}

.stats .ok strong {
  color: #059669;
}

.stats .warn strong {
  color: #b45309;
}

.stats .applied {
  color: #0369a1;
}

.results-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.filter-tabs {
  display: flex;
  gap: 6px;
}

.tab {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.78rem;
}

.tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
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

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
}

.badge.fixable {
  background: #dcfce7;
  color: #166534;
}

.badge.not_found {
  background: #fef3c7;
  color: #92400e;
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
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.78rem;
  cursor: pointer;
}

.empty-hint {
  padding: 32px;
  text-align: center;
  color: var(--muted);
  font-size: 0.88rem;
}

.muted {
  color: var(--muted);
}
</style>
