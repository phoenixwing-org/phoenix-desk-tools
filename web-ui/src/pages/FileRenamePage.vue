<script setup lang="ts">
import { onActivated, onMounted, onUnmounted, ref, watch } from "vue";
import type { RefScanPayload, RenameLog } from "../api";
import {
  analyzeRenameReferences,
  applyRenameAnalysisCorrections,
  applyReferenceLabelCorrections,
  exportRenameAnalysisReport,
  fetchRenameLogs,
  loadRenameAnalysis,
} from "../api";
import RenameAnalysisPanel from "../components/RenameAnalysisPanel.vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";
import { useFileRenamePropertySheet } from "../composables/useFileRenamePropertySheet";
import { useIncomingRefQuery } from "../composables/useIncomingRefQuery";
import { usePageSession } from "../composables/usePageSession";
import { logReferenceLabelApply } from "../utils/referenceLabelLog";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const incoming = useIncomingRefQuery(props.workbenchTabId, "file_rename");
const {
  queryText,
  pickedRel,
  clearPickedOnInput,
  applyTreeSelection,
  registerTreeSelectHandler,
  unregisterTreeSelectHandler,
  includeTransitive,
  resolveIncomingQuery,
  buildRenameAnalyzeParams,
  formatHostSummary,
  logIncoming,
  logIncomingStart,
  transitiveLabel,
  setStatus,
} = incoming;

const SESSION_V = 4;

type PanelMode = "history" | "manual";

const renameLogId = ref<number | null>(null);
const panelMode = ref<PanelMode>("history");
const newBasename = ref("");
const renameLogs = ref<RenameLog[]>([]);
const scan = ref<RefScanPayload | null>(null);
const selectedHosts = ref<Set<string>>(new Set());
const busy = ref(false);
const pageError = ref("");

useFileRenamePropertySheet("file_rename", { includeTransitive, scan });

function canAnalyze() {
  if (panelMode.value === "history") return renameLogId.value != null;
  return Boolean(queryText.value.trim());
}

function canApplyRefs() {
  if (!scan.value) return false;
  if ((scan.value.pending_hit_count ?? 0) > 0) return true;
  return renameLogId.value != null || Boolean(queryText.value.trim());
}

function canApplyIncomingLabels() {
  if (!scan.value?.old_basename) return false;
  if (panelMode.value === "history") return renameLogId.value != null;
  return Boolean(queryText.value.trim());
}

function canApplyHostAllLabels() {
  return Boolean(scan.value?.host_count);
}

function toggleHost(hostRel: string, checked: boolean) {
  const next = new Set(selectedHosts.value);
  if (checked) next.add(hostRel);
  else next.delete(hostRel);
  selectedHosts.value = next;
}

function toggleAll(checked: boolean) {
  if (!scan.value) return;
  selectedHosts.value = checked
    ? new Set(scan.value.hosts.map((h) => h.host_repo_rel_path))
    : new Set();
}

function hitNeedsFix(hit: { status: string; proposed_text?: string; matched_text?: string }) {
  if (hit.status === "applied" || hit.status === "ok") return false;
  return hit.proposed_text !== hit.matched_text;
}

function chainPendingHits(
  host: {
    host_repo_rel_path: string;
    via_chain?: string[];
    hits: Array<{ status: string; proposed_text?: string; matched_text?: string }>;
  },
  all: Array<{
    host_repo_rel_path: string;
    via_chain?: string[];
    hits: Array<{ status: string; proposed_text?: string; matched_text?: string }>;
  }>,
) {
  const chain = new Set((host.via_chain ?? []).map((p) => p.replace(/\\/g, "/")));
  return all.filter(
    (h) => chain.has(h.host_repo_rel_path.replace(/\\/g, "/")) && h.hits.some(hitNeedsFix),
  );
}

function hostPending(h: {
  hits: Array<{ status: string; proposed_text?: string; matched_text?: string }>;
  via_chain?: string[];
  host_repo_rel_path?: string;
}) {
  if (h.hits.some(hitNeedsFix)) return true;
  if (!scan.value) return false;
  return chainPendingHits(h as Parameters<typeof chainPendingHits>[0], scan.value.hosts).length > 0;
}

function selectPendingHosts() {
  if (!scan.value) return;
  selectedHosts.value = new Set(
    scan.value.hosts.filter(hostPending).map((h) => h.host_repo_rel_path),
  );
}

async function loadLogs() {
  try {
    const data = await fetchRenameLogs(50);
    renameLogs.value = data.entries;
  } catch {
    renameLogs.value = [];
  }
}

async function applyAnalysisPayload(payload: {
  renameLogId?: number;
  oldBasename?: string;
  newBasename?: string;
  autoAnalyze?: boolean;
}) {
  if (payload.renameLogId != null) {
    panelMode.value = "history";
    renameLogId.value = payload.renameLogId;
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, { title: `改名 #${payload.renameLogId}` });
    }
    try {
      const data = await loadRenameAnalysis(payload.renameLogId);
      queryText.value = data.rename_log.old_basename;
      newBasename.value = data.rename_log.new_basename;
      if (!payload.autoAnalyze) {
        scan.value = data.scan;
        selectPendingHosts();
      }
    } catch (e) {
      pageError.value = String(e);
    }
    if (payload.autoAnalyze) {
      await onScanRefs();
    }
    return;
  }
  panelMode.value = "manual";
  if (payload.oldBasename) queryText.value = payload.oldBasename;
  if (payload.newBasename) newBasename.value = payload.newBasename;
  if (payload.autoAnalyze) await onScanRefs();
}

async function onTreeSelect(repoRel: string): Promise<boolean> {
  if (panelMode.value !== "manual") return false;
  applyTreeSelection(repoRel);
  pageError.value = "";
  await onScanRefs();
  return true;
}

function registerTreeHandler() {
  registerTreeSelectHandler(onTreeSelect);
}

function unregisterTreeHandler() {
  unregisterTreeSelectHandler();
}

async function loadFromPending() {
  const tabPayload = props.workbenchTabId
    ? shell.consumeTabPayload(props.workbenchTabId)
    : undefined;
  if (tabPayload?.renameAnalysis) {
    await applyAnalysisPayload(tabPayload.renameAnalysis);
  }
}

async function onScanRefs() {
  if (!canAnalyze()) {
    const msg =
      panelMode.value === "manual"
        ? "请填写旧文件名，或在右侧树中点击文件"
        : "请选择改名记录";
    pageError.value = msg;
    logIncoming(`取消：${msg}`);
    return;
  }
  busy.value = true;
  pageError.value = "";
  logIncoming(`开始扫描（${transitiveLabel()}）…`);
  const transitive = includeTransitive.value;
  try {
    let data: RefScanPayload;
    if (panelMode.value === "history" && renameLogId.value != null) {
      logIncoming(`模式=历史记录 #${renameLogId.value}`, { open: false });
      data = await analyzeRenameReferences(
        buildRenameAnalyzeParams(
          { basename: "" },
          {
            renameLogId: renameLogId.value,
            newBasename: "",
            transitive,
            persist: true,
          },
        ),
      );
    } else {
      const q = resolveIncomingQuery();
      if (!q) {
        pageError.value = "请填写旧文件名，或在右侧树中点击文件";
        logIncoming("取消：未指定目标文件");
        return;
      }
      logIncomingStart(q, "分析");
      data = await analyzeRenameReferences(
        buildRenameAnalyzeParams(q, {
          newBasename: newBasename.value,
          oldRepoRel: pickedRel.value.trim() || undefined,
          transitive,
          persist: false,
        }),
      );
    }
    scan.value = data;
    selectPendingHosts();
    const summary = formatHostSummary({
      hostCount: data.host_count,
      directHostCount: data.direct_host_count ?? data.host_count,
      hitCount: data.hit_count,
      pendingHitCount: data.pending_hit_count ?? data.hit_count,
      mode: "analyze",
    });
    logIncoming(summary);
    setStatus(summary);
  } catch (e) {
    const msg = String(e);
    pageError.value = msg;
    logIncoming(`失败：${msg}`);
    setStatus(`引用分析失败：${msg}`);
  } finally {
    busy.value = false;
  }
}

function buildApplyOpts() {
  return {
    renameLogId: panelMode.value === "history" ? (renameLogId.value ?? undefined) : undefined,
    oldBasename:
      scan.value?.old_basename ??
      (panelMode.value === "manual" ? queryText.value.trim() : undefined),
    newBasename:
      scan.value?.new_basename ||
      (panelMode.value === "manual" ? newBasename.value.trim() : "") ||
      scan.value?.old_basename ||
      "",
    targetRepoRel: pickedRel.value.trim() || undefined,
    transitive: includeTransitive.value,
  };
}

async function onApplyRefs() {
  const hosts = [...selectedHosts.value];
  if (!hosts.length) {
    pageError.value = "请勾选至少一个宿主文件";
    return;
  }
  if (!canApplyRefs()) {
    pageError.value = "请先完成分析并指定有效的旧名/新名";
    return;
  }
  if (
    !window.confirm(
      `将修正 ${hosts.length} 个宿主文件内的 XLink（file 路径 / 文件名）。\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  logIncoming(`开始修正 XLink · ${hosts.length} 个宿主…`);
  try {
    const data = await applyRenameAnalysisCorrections(hosts, buildApplyOpts());
    scan.value = data.scan;
    selectPendingHosts();
    if (data.failed.length) {
      shell.appendLog(
        data.failed.map((f) => `${f.host_repo_rel_path}: ${f.error}`).join("\n"),
        { source: "file_rename" },
      );
    }
    const msg =
      `第一步完成 · 已修正 ${data.applied_hosts.length} 个宿主 · ${data.xlink_patches} 处 XLink` +
      (data.failed.length ? ` · ${data.failed.length} 失败` : "") +
      " · 可选：同步引用显示名，或到文件详情·引用操作";
    logIncoming(msg);
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

async function onApplyIncomingLabels() {
  const hosts = [...selectedHosts.value];
  if (!hosts.length) {
    pageError.value = "请勾选至少一个宿主文件";
    return;
  }
  if (!canApplyIncomingLabels()) {
    pageError.value = "请先执行分析";
    return;
  }
  if (
    !window.confirm(
      `将把 ${hosts.length} 个宿主内「引用当前目标」的实例 Label 同步为 CAD 索引规则名。\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  await runReferenceLabelApply("incoming", hosts);
}

async function onApplyHostAllLabels() {
  const hosts = [...selectedHosts.value];
  if (!hosts.length) {
    pageError.value = "请勾选至少一个宿主文件";
    return;
  }
  if (!canApplyHostAllLabels()) {
    pageError.value = "请先执行分析";
    return;
  }
  if (
    !window.confirm(
      `将把 ${hosts.length} 个宿主文件内的全部外部引用 Label 同步为 CAD 索引规则名。\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  await runReferenceLabelApply("host_all", hosts);
}

async function runReferenceLabelApply(scope: "incoming" | "host_all", hosts: string[]) {
  busy.value = true;
  pageError.value = "";
  const scopeLabel = scope === "host_all" ? "宿主内全部引用名" : "引用名";
  logIncoming(`开始修正${scopeLabel} · ${hosts.length} 个宿主…`);
  try {
    const data = await applyReferenceLabelCorrections(hosts, { ...buildApplyOpts(), labelScope: scope });
    if (data.scan) scan.value = data.scan;
    const msg = logReferenceLabelApply(shell.appendLog, data, {
      source: "file_rename",
      title: `已同步${scopeLabel}`,
    });
    logIncoming(msg);
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

async function onExportReport() {
  if (!scan.value) return;
  busy.value = true;
  logIncoming("导出改名分析报告…");
  try {
    const out = await exportRenameAnalysisReport({
      scan: scan.value,
      rename_log_id: renameLogId.value ?? undefined,
    });
    const msg = `报告已写入 ${out.report_path_display}`;
    logIncoming(msg);
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  const v = snap.v;
  if (v !== SESSION_V && v !== 2 && v !== 1) return false;

  renameLogId.value = snap.renameLogId != null ? Number(snap.renameLogId) : null;
  if (Array.isArray(snap.selectedHosts)) {
    selectedHosts.value = new Set(snap.selectedHosts.map(String));
  }
  if (snap.scan && typeof snap.scan === "object") {
    scan.value = snap.scan as RefScanPayload;
  }
  panelMode.value = snap.panelMode === "manual" ? "manual" : "history";
  queryText.value = String(snap.oldBasename ?? snap.queryText ?? "");
  newBasename.value = String(snap.newBasename ?? "");
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) return;
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  void loadFromPending();
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    renameLogId: renameLogId.value,
    scan: scan.value,
    selectedHosts: [...selectedHosts.value],
    panelMode: panelMode.value,
    oldBasename: queryText.value,
    newBasename: newBasename.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch(panelMode, () => {
  scan.value = null;
  selectedHosts.value = new Set();
});

watch(renameLogId, (id) => {
  if (panelMode.value !== "history" || id == null) return;
  const row = renameLogs.value.find((e) => e.id === id);
  if (row) {
    queryText.value = row.old_basename;
    newBasename.value = row.new_basename;
  }
});

watch(
  [scan, selectedHosts, renameLogId, panelMode, queryText, newBasename],
  () => shell.scheduleWorkbenchSave(),
  { deep: true },
);

onMounted(async () => {
  await loadLogs();
  applyInitialTabState();
  registerTreeHandler();
});

onActivated(() => {
  registerTreeHandler();
});

onUnmounted(() => {
  unregisterTreeHandler();
});
</script>

<template>
  <div class="page rename-page">
    <PageHeader title="改名分析" page-id="file_rename">
      <template #actions>
        <el-button type="primary" size="small" :loading="busy" :disabled="!canAnalyze()" @click="onScanRefs">
          开始分析
        </el-button>
        <el-button size="small" :disabled="busy" @click="loadLogs">刷新历史</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="pageError" type="error" :title="pageError" show-icon :closable="false" class="err-alert" />

    <section class="source-block">
      <el-radio-group v-model="panelMode" size="small" class="mode-tabs" data-tour-page-rename-modes>
        <el-radio-button value="history">改名历史</el-radio-button>
        <el-radio-button value="manual">手填旧名 / 新名</el-radio-button>
      </el-radio-group>

      <div v-if="panelMode === 'history'" class="mode-body">
        <label class="field">
          <span class="field-label">记录</span>
          <el-select v-model="renameLogId" class="field-input" placeholder="— 选择改名记录 —" clearable>
            <el-option
              v-for="row in renameLogs"
              :key="row.id"
              :label="`#${row.id} · ${row.old_filename} → ${row.new_filename} · ${row.created_at}`"
              :value="row.id"
            />
          </el-select>
        </label>
        <p v-if="!renameLogs.length" class="field-hint">
          尚无记录。请在文件详情页头点「改名」按钮（弹出对话框）执行磁盘改名。
        </p>
      </div>

      <div v-else class="mode-body manual-grid">
        <label class="field">
          <span class="field-label">旧文件名</span>
          <el-input
            v-model="queryText"
            class="field-input mono"
            spellcheck="false"
            placeholder="部分文件名；或右侧树点击"
            @input="clearPickedOnInput"
            @keydown.enter.prevent="onScanRefs"
          />
        </label>
        <label class="field">
          <span class="field-label">新文件名</span>
          <el-input
            v-model="newBasename"
            class="field-input mono"
            spellcheck="false"
            placeholder="留空则仅按旧名检查引用"
          />
        </label>
        <p v-if="pickedRel" class="picked-hint mono field-span">已从树选择：{{ pickedRel }}</p>
      </div>
    </section>

    <div data-tour-page-rename-panel>
    <RenameAnalysisPanel
      :scan="scan"
      :selected-hosts="selectedHosts"
      :busy="busy"
      :can-apply="canApplyRefs()"
      :can-apply-incoming-labels="canApplyIncomingLabels()"
      :can-apply-host-all-labels="canApplyHostAllLabels()"
      :target-label="scan?.new_basename"
      label-sync-ui="incoming-only"
      show-export
      @toggle-host="toggleHost"
      @toggle-all="toggleAll"
      @apply="onApplyRefs"
      @apply-incoming-labels="onApplyIncomingLabels"
      @apply-host-all-labels="onApplyHostAllLabels"
      @export-report="onExportReport"
    />
    </div>

    <details class="help-panel">
      <summary class="help-summary">说明</summary>
      <ul class="help-list">
        <li>改名写回：先修正 XLink 路径；显示名（Label）可在「文件详情 → 引用」随时同步，改名页亦可操作。</li>
        <li>手填模式用于无历史时的预览；日常请在文件详情页头点「改名」按钮（弹出对话框）改名。</li>
        <li>右侧树选文件时会自动带入路径，被改名文件本身不会作为宿主。</li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.rename-page {
  width: 100%;
  box-sizing: border-box;
  padding: 16px 20px 24px;
  height: 100%;
  overflow: auto;
}

.err-alert {
  margin-bottom: 10px;
}

.source-block {
  margin-bottom: 16px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.mode-tabs {
  margin-bottom: 14px;
}

.mode-body {
  margin-bottom: 0;
}

.manual-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}

.field-span {
  grid-column: 1 / -1;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field-label {
  font-size: 0.78rem;
  color: var(--muted);
}

.field-input {
  width: 100%;
}

.field-input.mono :deep(.el-input__inner) {
  font-family: ui-monospace, monospace;
}

.field-hint {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.picked-hint {
  margin: 0;
  font-size: 0.78rem;
  color: #1d4ed8;
}

.help-panel {
  margin-top: 16px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafafa;
}

.help-summary {
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--muted);
}

.help-list {
  margin: 10px 0 0;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.55;
}

.help-list li + li {
  margin-top: 4px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .manual-grid {
    grid-template-columns: 1fr;
  }
}
</style>
