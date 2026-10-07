<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
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
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import { useCadBatchDirectory } from "../composables/useCadBatchDirectory";
import { useAppShell } from "../composables/useAppShell";
import { useXlinkFixPropertySheet } from "../composables/useXlinkFixPropertySheet";
import { useFcstdPropertyRepair } from "../composables/useFcstdPropertyRepair";
import { cadBatchToolsSection } from "../composables/cadBatchTools";
import FcstdPropertyRepairResults from "../components/file-detail/FcstdPropertyRepairResults.vue";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

type FilterTab = "all" | "fixable" | "not_found";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const sharedDirectory = useCadBatchDirectory(shell.workspacePath);
const batchDir = sharedDirectory.directory;
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
const checkLinks = ref(true);
const checkProperties = ref(true);
const linkError = ref("");
const confirming = ref(false);
const scopeKey = computed(() => JSON.stringify([shell.workspacePath.value, batchDir.value, allInDir.value, checkLinks.value, checkProperties.value]));
const propertyRepair = reactive(useFcstdPropertyRepair(scopeKey, batchDir));
const busy = computed(() => analyzing.value || applying.value || propertyRepair.analyzing || propertyRepair.applying || confirming.value || !!applyingKey.value);
sharedDirectory.bindBusy(computed(() => busy.value || saving.value));
const checking = computed(() => analyzing.value || propertyRepair.analyzing);
let scopeRevision = 0;
watch(scopeKey, () => {
  scopeRevision += 1;
  analysis.value = null;
  applyResult.value = null;
  linkError.value = "";
  expandedKey.value = null;
  candidatesByKey.value = {};
  candidateMetaByKey.value = {};
  candidatesLoading.value = {};
  selectedTargetRel.value = {};
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
}, { flush: "sync" });

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
  return Boolean(s && s.fixable_count > 0 && !applying.value && !applyResult.value);
});
const canApplySelected = computed(() => !busy.value && !sharedDirectory.disabled.value && ((checkLinks.value && canApply.value) || (checkProperties.value && propertyRepair.canApply)));
const canAnalyze = computed(() => !busy.value && !sharedDirectory.disabled.value && (checkLinks.value || checkProperties.value));

async function analyzeSelected() {
  if (!canAnalyze.value) return;
  if (!await sharedDirectory.validate()) return;
  if (checkProperties.value && !allInDir.value) {
    propertyRepair.error = "属性检查只支持 FCStd。请在 Primary 勾选“目录内全部 FCStd”，或取消属性检查。";
    return;
  }
  await Promise.all([
    checkLinks.value ? onAnalyze() : Promise.resolve(),
    checkProperties.value ? propertyRepair.analyze() : Promise.resolve(),
  ]);
}

async function applySelected() {
  if (!canApplySelected.value) return;
  const revision = scopeRevision;
  const linkCount = checkLinks.value && canApply.value ? stats.value?.fixable_count ?? 0 : 0;
  const propertyFiles = checkProperties.value && propertyRepair.canApply ? propertyRepair.selected.length : 0;
  confirming.value = true;
  try {
    const answer = await pnwPromptChoice({
      title: "执行错误修正",
      message: `将修正 ${linkCount} 处 XLink 路径，以及 ${propertyFiles} 个文件的属性计数。属性修正不覆盖字段值。请先关闭 FreeCAD 中这些文件；建议先备份。各文件独立写入，部分失败会单独报告。`,
      choices: [{ id: "write", label: "确认修正", variant: "primary" }, { id: "cancel", label: "取消" }],
    });
    if (answer.choiceId !== "write" || revision !== scopeRevision) return;
    // Count plans fingerprint the original archive: execute these before XLinks.
    if (propertyFiles) {
      await propertyRepair.apply();
      const fixed = propertyRepair.result?.results.filter(item => item.status === "fixed").length ?? 0;
      shell.appendLog(`[属性计数] 已修正 ${fixed}/${propertyFiles} 个文件${propertyRepair.error ? `：${propertyRepair.error}` : ""}`, { source: "xlink_fix", open: true });
    }
    if (linkCount && revision === scopeRevision) await onApply();
    shell.setStatus("本次修正已结束，请查看各组结果；继续操作前重新分析");
  } finally { confirming.value = false; }
}

async function loadPrefs() {
  const revision = scopeRevision;
  const prefs = await fetchXlinkPrefs();
  if (revision !== scopeRevision) return;
  allInDir.value = prefs.all_in_dir;
}

async function onSavePrefs() {
  if (busy.value || saving.value) return;
  const revision = scopeRevision;
  saving.value = true;
  try {
    const prefs = await saveXlinkPrefs({ ...prefsPayload(), dry_run: true });
    if (revision !== scopeRevision) return;
    allInDir.value = prefs.all_in_dir;
    shell.setStatus("已保存链接修正偏好");
  } catch (e) {
    if (revision !== scopeRevision) return;
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
  const revision = scopeRevision;
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
    if (revision !== scopeRevision) return;
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
    if (revision !== scopeRevision) return;
    shell.setStatus(String(e));
    candidatesByKey.value = { ...candidatesByKey.value, [key]: [] };
  } finally {
    if (revision === scopeRevision) {
      const next = { ...candidatesLoading.value };
      delete next[key];
      candidatesLoading.value = next;
    }
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
  if (busy.value || sharedDirectory.disabled.value) return;
  const revision = scopeRevision;
  const key = issueRowKey(row);
  const target = selectedTargetRel.value[key]?.trim();
  if (!target) {
    shell.setStatus("请先选择目标 FCStd");
    return;
  }
  confirming.value = true;
  let result;
  try { result = await pnwPromptChoice({
    title: "修正此项",
    message: "将宿主内该 XLink 指向所选文件，是否继续？",
    choices: [
      { id: "write", label: "写回", variant: "primary" },
      { id: "cancel", label: "取消" },
    ],
  }); } finally { confirming.value = false; }
  if (result.choiceId !== "write" || revision !== scopeRevision || sharedDirectory.disabled.value) return;
  applyingKey.value = key;
  try {
    const result = await applyXlinkFixOverride({
      host_repo_rel: row.host_repo_rel,
      old_path: row.old_path,
      target_repo_rel: target,
    });
    if (revision !== scopeRevision) return;
    markRowFixed(row, result);
    expandedKey.value = null;
    const msg = result.unchanged ? "路径未变（已与目标一致）" : `已写回 · ${result.new_path}`;
    shell.appendLog(`[链接路径修正] ${row.host_display} ${msg}`, { source: "xlink_fix" });
    shell.setStatus(msg);
  } catch (e) {
    if (revision !== scopeRevision) return;
    shell.appendLog(String(e), { source: "xlink_fix" });
    shell.setStatus(String(e));
  } finally {
    applyingKey.value = null;
  }
}

async function onAnalyze() {
  const revision = scopeRevision;
  const payload = prefsPayload();
  linkError.value = "";
  analyzing.value = true;
  applyResult.value = null;
  analysis.value = null;
  expandedKey.value = null;
  candidatesByKey.value = {};
  candidateMetaByKey.value = {};
  selectedTargetRel.value = {};
  shell.appendLog("[链接路径修正] 开始分析…", { source: "xlink_fix", open: true });
  try {
    await saveXlinkPrefs({ ...payload, dry_run: true });
    if (revision !== scopeRevision) return;
    const data = await analyzeXlinkFix(payload);
    if (revision !== scopeRevision) return;
    analysis.value = data;
    const s = data.stats;
    const msg = s
      ? `分析完成：扫描 ${s.host_count} 个文件 · ${s.hosts_with_issues} 个有问题 · 可修正 ${s.fixable_count} · 未找到 ${s.not_found_count}`
      : "分析完成";
    shell.appendLog(msg, { source: "xlink_fix" });
    if (data.log?.trim()) shell.appendLog(data.log.trim(), { source: "xlink_fix" });
    shell.setStatus(msg);
  } catch (e) {
    if (revision !== scopeRevision) return;
    linkError.value = String(e);
    shell.appendLog(String(e), { source: "xlink_fix" });
    shell.setStatus(String(e));
  } finally {
    analyzing.value = false;
  }
}

async function onApply() {
  if (!canApply.value) return;
  const revision = scopeRevision;
  applying.value = true;
  shell.appendLog("[链接路径修正] 执行写回…", { source: "xlink_fix", open: true });
  try {
    const data = await runXlinkFix({ ...prefsPayload(), dry_run: false });
    if (revision !== scopeRevision) return;
    applyResult.value = data;
    analysis.value = data;
    const n = data.stats?.total_changes ?? data.total_changes ?? 0;
    shell.appendLog(`已写回 ${n} 处 XLink`, { source: "xlink_fix" });
    if (data.log?.trim()) shell.appendLog(data.log.trim(), { source: "xlink_fix" });
    shell.setStatus(`修正完成 · 写回 ${n} 处`);
  } catch (e) {
    if (revision !== scopeRevision) return;
    linkError.value = String(e);
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
  title: "批量工具",
  summary: computed(() => stats.value
    ? `问题 ${stats.value.issue_count} · 可修正 ${stats.value.fixable_count} · 未找到 ${stats.value.not_found_count}`
    : "尚未分析 XLink 路径"),
  sections: computed<PagePrimarySection[]>(() => [
    cadBatchToolsSection(shell, "xlink_fix"),
    sharedDirectory.section,
    {
      id: "scope",
      title: "分析范围",
      controls: [
        {
          id: "all",
          kind: "boolean",
          label: "目录内全部 FCStd",
          description: "XLink 目录模式；取消时仅分析目录中的独立 Document.xml，不支持属性检查。",
          disabled: busy,
          modelValue: allInDir,
          onUpdate: (checked) => {
            allInDir.value = checked;
            schedulePrefsSave();
          },
        },
        { id: "check-links", kind: "boolean", label: "检查链接路径", modelValue: checkLinks, disabled: busy, onUpdate: (value) => { checkLinks.value = value; } },
        { id: "check-properties", kind: "boolean", label: "检查属性计数", modelValue: checkProperties, disabled: busy, onUpdate: (value) => { checkProperties.value = value; } },
      ],
      actions: [
        { id: "save", label: "保存偏好", loading: saving, run: onSavePrefs },
        {
          id: "analyze",
          label: "分析",
          tone: "primary",
          loading: checking,
          disabled: computed(() => !canAnalyze.value),
          run: analyzeSelected,
        },
        {
          id: "apply",
          label: "执行修正",
          tone: "danger",
          loading: applying,
          disabled: computed(() => !canApplySelected.value),
          run: applySelected,
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
onUnmounted(() => {
  scopeRevision++;
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
});
</script>

<template>
  <PageLayout title="错误修正" class="desk-page-layout tool-page xlink-page">
    <template #header>
    <PageHeader title="错误修正">
      <template #right>
        <div data-tour-page-xlink-analyze class="head-actions-inner">
          <el-button size="small" :loading="saving" :disabled="busy" @click="onSavePrefs">保存偏好</el-button>
          <el-button type="primary" size="small" :loading="checking" :disabled="!canAnalyze" @click="analyzeSelected">
            分析
          </el-button>
          <el-button
            type="success"
            size="small"
            :loading="applying || propertyRepair.applying"
            :disabled="!canApplySelected"
            :title="canApplySelected ? '' : '请先分析并选择可修正项'"
            @click="applySelected"
          >
            执行修正
          </el-button>
        </div>
      </template>
    </PageHeader>
    </template>

    <section class="check-options" aria-label="检查项">
      <span>范围：<code>{{ batchDir || '.' }}</code></span>
      <el-checkbox v-model="checkLinks" :disabled="busy">链接路径</el-checkbox>
      <el-checkbox v-model="checkProperties" :disabled="busy">属性修正（计数）</el-checkbox>
      <span class="muted">可同时分析；分析本身不修改 FCStd。</span>
    </section>
    <el-alert v-if="linkError && checkLinks" :title="`链接检查：${linkError}`" type="error" :closable="false" />
    <FcstdPropertyRepairResults v-if="checkProperties" v-model:selected="propertyRepair.selected" :analysis="propertyRepair.analysis" :result="propertyRepair.result" :error="propertyRepair.error" :busy="busy" @open="shell.openFileDetailForRel($event)" />

    <section v-if="analysis && checkLinks" class="card results-card">
      <el-alert v-if="analysis.index_pending" title="链接检查尚未完成：请先在 KT Auto CAD 建立索引。属性检查可独立运行。" type="warning" :closable="false" />
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
                        :disabled="busy || !selectedTargetRel[issueRowKey(row)]"
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

    <el-empty v-else-if="checkLinks && !checking" description="链接路径：设置目录后点击「分析」" :image-size="64" class="empty-hint" />
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";

.check-options { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 12px; font-size: .85rem; }

.xlink-page strong {
  font-weight: 600;
}

.card {
  padding: 12px 16px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg, var(--bg));
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
