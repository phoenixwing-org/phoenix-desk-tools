<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { BomXrefEdge, BomXrefHost, FileDetailXrefsPayload } from "../../api";
import { fetchFileDetailXrefs, refreshBomXrefHostIndex } from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useReferenceLabelSync } from "../../composables/useReferenceLabelSync";
import { useAppShell } from "../../composables/useAppShell";
import {
  LINK_LABEL_COLUMN_WIDE,
  LINK_LABEL_TITLE,
} from "../../utils/bomFieldLabels";
import { basenameFromRel, normalizeRepoRelForApi, repoDirFromRel } from "../../utils/workspaceFileQuery";
import { logReferenceLabelApply } from "../../utils/referenceLabelLog";
import XlinkReplaceDialog from "../XlinkReplaceDialog.vue";

const ctx = useFileDetailContext();
const shell = useAppShell();
const loading = ref(false);
const rebuilding = ref(false);
const indexSummary = ref("");
const includeTransitive = ref(false);
const loadingIncoming = ref(false);
const rebuildSubtree = ref(true);
const incomingHosts = ref<BomXrefHost[]>([]);
const selectedIncoming = ref<Set<string>>(new Set());
const outgoingRefs = ref<BomXrefEdge[]>([]);
const outgoingLabelMismatchCount = ref(0);
const directCount = ref(0);
const indexPending = ref(false);
/** 避免 onMounted 与 watch 并发时较早的空结果覆盖较新数据 */
let loadSeq = 0;
const incomingCount = computed(() => ctx.incomingCount.value);
const outgoingCount = computed(() => ctx.outgoingCount.value);

const replaceOpen = ref(false);
const replaceEdge = ref<BomXrefEdge | null>(null);
/** 当前文件 repo 相对路径（ctx.rel 为 Ref，须解包再传给对话框） */
const hostRepoRel = computed(() => ctx.rel.value.trim());

const showXlinkReplaceActions = computed(() => Boolean(ctx.preview.value?.is_fcstd));

function canReplaceXlink(row: BomXrefEdge) {
  return Boolean((row.xlink_file_attr ?? "").trim());
}

function openReplaceDialog(row: BomXrefEdge) {
  if (!canReplaceXlink(row)) return;
  replaceEdge.value = row;
  replaceOpen.value = true;
}

function closeReplaceDialog() {
  replaceOpen.value = false;
  replaceEdge.value = null;
}

async function onReplaceApplied() {
  closeReplaceDialog();
  ctx.notifyXrefMutation();
  await loadTables(true, true);
  await ctx.refreshXrefCounts();
}

function statusLabel(s: string) {
  if (s === "ok" || s === "present" || s === "resolved") return "已解析";
  if (s === "missing") return "缺失";
  if (s === "ambiguous") return "歧义";
  return s;
}

function canOpenFileDetailRel(rel: string | null | undefined) {
  const r = rel?.trim();
  if (!r) return false;
  return /\.fcstd$/i.test(basenameFromRel(r));
}

function openFileDetailRel(rel: string) {
  const r = normalizeRepoRelForApi(rel);
  if (!r || !canOpenFileDetailRel(r)) return;
  shell.openFileDetailForRel(r);
}

/** XLink 属性与解析后的目标文件名相同时不必单独展示。 */
function xlinkDiffersFromTarget(row: BomXrefEdge) {
  const attr = (row.xlink_file_attr ?? "").trim();
  if (!attr) return false;
  const base = attr.replace(/\\/g, "/").split("/").pop() ?? attr;
  return base !== row.target_basename;
}

const showXlinkColumn = computed(() => outgoingRefs.value.some(xlinkDiffersFromTarget));

const outgoingStats = computed(() => {
  let missing = 0;
  let ambiguous = 0;
  let resolved = 0;
  for (const row of outgoingRefs.value) {
    const s = row.resolve_status;
    if (s === "missing") missing += 1;
    else if (s === "ambiguous") ambiguous += 1;
    else if (s === "resolved" || s === "self" || s === "present" || s === "ok") resolved += 1;
  }
  return { missing, ambiguous, resolved };
});

function rowClass(status: string, row?: BomXrefEdge) {
  if (row?.label_mismatch) return "row-label-mismatch";
  if (status === "missing") return "row-missing";
  if (status === "ambiguous") return "row-ambiguous";
  return "";
}

const showAssemblyLink = computed(() => {
  if (!ctx.preview.value?.is_fcstd) return false;
  if (outgoingCount.value > 0) return true;
  if (ctx.preview.value.document_kinds?.assembly) return true;
  return /\.assy\.fcstd$/i.test(ctx.rel.value);
});

const incomingLabelActionLabel = computed(() => {
  if (labelSyncing.value) return "…";
  if (selectedIncomingCount.value) {
    return `更新父装配中本件名（${selectedIncomingCount.value} 个）`;
  }
  return "更新父装配中本件名";
});

function applyOutgoingPayload(data: FileDetailXrefsPayload) {
  const out = data.outgoing;
  outgoingRefs.value = out.refs;
  outgoingLabelMismatchCount.value =
    out.label_mismatch_count ?? out.refs.filter((r) => r.label_mismatch).length;
  ctx.outgoingCount.value = out.count;
}

function applyIncomingPayload(data: FileDetailXrefsPayload) {
  const inc = data.incoming;
  incomingHosts.value = inc.hosts;
  selectedIncoming.value = new Set(inc.hosts.map((h) => h.host_repo_rel_path));
  directCount.value = inc.direct_count ?? inc.count;
  ctx.incomingCount.value = inc.count;
}

function applyXrefPayload(data: FileDetailXrefsPayload) {
  if (data.outgoing) applyOutgoingPayload(data);
  if (data.incoming) applyIncomingPayload(data);
}

function clearTables() {
  incomingHosts.value = [];
  selectedIncoming.value = new Set();
  outgoingRefs.value = [];
  outgoingLabelMismatchCount.value = 0;
  directCount.value = 0;
}

async function loadTables(manual = false, refreshDisk = false) {
  const rel = ctx.rel.value.trim();
  if (!rel) {
    clearTables();
    return;
  }
  if (ctx.activeSubTab.value !== "xref" && !manual) return;

  const cacheKey = rel;
  if (!manual && !refreshDisk && ctx.xrefCacheByRel.value[cacheKey]) {
    applyXrefPayload(ctx.xrefCacheByRel.value[cacheKey]);
    return;
  }

  const seq = ++loadSeq;
  loading.value = true;
  loadingIncoming.value = true;
  if (manual) {
    shell.appendLog(`[文件详情] 刷新引用关系 ${rel}…`, { source: "file_detail", open: true });
  }
  try {
    const outData = await fetchFileDetailXrefs({
      rel,
      scope: "outgoing",
      limit: 500,
      refreshDisk,
    });
    if (seq !== loadSeq) return;
    indexPending.value = Boolean(outData.index_pending);
    if (outData.index_pending) {
      clearTables();
      return;
    }
    applyOutgoingPayload(outData);
    loading.value = false;

    const inData = await fetchFileDetailXrefs({
      rel,
      scope: "incoming",
      transitive: includeTransitive.value,
      limit: 500,
    });
    if (seq !== loadSeq) return;
    applyIncomingPayload(inData);
    const merged: FileDetailXrefsPayload = {
      rel,
      incoming: inData.incoming,
      outgoing: outData.outgoing,
    };
    ctx.xrefCacheByRel.value = { ...ctx.xrefCacheByRel.value, [cacheKey]: merged };
    if (manual) {
      shell.appendLog(
        `[文件详情] 入向 ${inData.incoming.count} · 出向 ${outData.outgoing.count}`,
        { source: "file_detail" },
      );
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    ctx.pageError.value = String(e);
    clearTables();
    if (manual) shell.appendLog(String(e), { source: "file_detail" });
  } finally {
    if (seq === loadSeq) {
      loading.value = false;
      loadingIncoming.value = false;
    }
  }
}

watch(
  () => ctx.rel.value,
  (host) => {
    if (!host.trim()) clearTables();
  },
);

watch(
  () => [ctx.rel.value, ctx.activeSubTab.value] as const,
  ([host, tab]) => {
    if (tab === "xref" && host.trim()) void loadTables();
  },
);

onMounted(() => {
  if (ctx.activeSubTab.value === "xref" && ctx.rel.value.trim()) {
    void loadTables();
  }
});

watch(includeTransitive, () => {
  if (ctx.activeSubTab.value !== "xref") return;
  ctx.invalidateXrefCache();
  void loadTables(true);
});

async function onRebuildIndex() {
  if (!ctx.rel.value.trim() || rebuilding.value) return;
  rebuilding.value = true;
  indexSummary.value = "";
  shell.appendLog(`[文件详情] 重建引用索引 ${ctx.rel.value}…`, { source: "file_detail", open: true });
  try {
    const out = await refreshBomXrefHostIndex({
      host_repo_rel: ctx.rel.value,
      recursive: rebuildSubtree.value,
    });
    if (out.log) shell.appendLog(out.log, { source: "file_detail" });
    indexSummary.value = `已索引 ${out.hosts_refreshed} 个宿主 · 出向 ${out.outgoing_count} 条（缺失 ${out.outgoing_missing} · 歧义 ${out.outgoing_ambiguous}）`;
    shell.setStatus(indexSummary.value);
    ctx.notifyXrefMutation(ctx.rel.value);
    await loadTables(false, false);
  } catch (e) {
    ctx.pageError.value = String(e);
    shell.appendLog(String(e), { source: "file_detail" });
    shell.setStatus(String(e));
  } finally {
    rebuilding.value = false;
  }
}

const selectedIncomingPaths = computed(() => [...selectedIncoming.value]);
const selectedIncomingCount = computed(() => selectedIncomingPaths.value.length);
const canSyncIncomingLabels = computed(
  () => selectedIncomingCount.value > 0 && Boolean(ctx.rel.value.trim()),
);

const { syncing: labelSyncing, syncIncomingLabels } = useReferenceLabelSync(
  () => ctx.rel.value,
);

function toggleIncoming(hostRel: string, checked: boolean) {
  const next = new Set(selectedIncoming.value);
  if (checked) next.add(hostRel);
  else next.delete(hostRel);
  selectedIncoming.value = next;
}

function toggleAllIncoming(checked: boolean) {
  selectedIncoming.value = checked
    ? new Set(incomingHosts.value.map((h) => h.host_repo_rel_path))
    : new Set();
}

const allIncomingSelected = computed(
  () =>
    incomingHosts.value.length > 0 &&
    incomingHosts.value.every((h) => selectedIncoming.value.has(h.host_repo_rel_path)),
);

function onLabelSyncDone(msg: string) {
  shell.setStatus(msg);
  ctx.notifyXrefMutation();
  void loadTables(true, false);
  void ctx.refreshXrefCounts();
}

function goToAssemblyTab() {
  ctx.switchSubTab("assembly");
}

function onLabelSyncError(msg: string) {
  ctx.pageError.value = msg;
  shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
}

async function onSyncIncomingLabels() {
  if (!canSyncIncomingLabels.value) return;
  try {
    const data = await syncIncomingLabels(selectedIncomingPaths.value, includeTransitive.value);
    const msg = logReferenceLabelApply(shell.appendLog, data, {
      source: "file_detail",
      title: "更新父装配中本件名",
    });
    onLabelSyncDone(msg);
  } catch (e) {
    onLabelSyncError(String(e));
  }
}
</script>

<template>
  <div class="xref-panel">
    <h3 class="panel-title">引用关系</h3>
    <p v-if="loading && !outgoingRefs.length" class="empty muted">载入出向引用…</p>
    <p v-else-if="indexPending" class="banner warn">
      引用表尚未构建。请先在「CAD 索引」页执行工程内搜索，或点下方「重建本文件引用索引」。
    </p>
    <div class="toolbar">
      <el-button
        type="primary"
        size="small"
        :loading="rebuilding"
        :disabled="loading"
        title="从磁盘重读本文件 XLink 并写入引用表；勾选下级时一并索引子装配 FCStd"
        @click="onRebuildIndex"
      >
        重建本文件引用索引
      </el-button>
      <el-checkbox v-model="rebuildSubtree" :disabled="rebuilding">含下级 FCStd</el-checkbox>
      <el-checkbox v-model="includeTransitive">入向含间接宿主</el-checkbox>
      <el-button size="small" :loading="loading" :disabled="rebuilding" @click="loadTables(true, true)">
        刷新列表
      </el-button>
      <el-button size="small" @click="ctx.triggerRename()">改名后修正 XLink…</el-button>
    </div>
    <p v-if="indexSummary" class="index-summary">{{ indexSummary }}</p>

    <section class="block">
      <div class="sub-title-row">
        <h3 class="sub-title">
          谁引用了本文件（{{ incomingCount }}）
          <span v-if="includeTransitive && directCount < incomingCount" class="muted">
            · 直接 {{ directCount }} · 间接 {{ incomingCount - directCount }}
          </span>
        </h3>
        <el-button
          type="success"
          plain
          size="small"
          :loading="labelSyncing"
          :disabled="!canSyncIncomingLabels"
          :title="
            canSyncIncomingLabels
              ? '将勾选装配树里「引用本文件」那一项的 Label 更新为本文件的规则名'
              : incomingHosts.length
                ? '请先在下方表格勾选至少一个父装配'
                : '当前无装配引用本文件'
          "
          @click="onSyncIncomingLabels"
        >
          {{ incomingLabelActionLabel }}
        </el-button>
      </div>
      <p class="section-hint muted">
        下方列出<strong>引用本文件</strong>的装配。勾选后点「更新父装配中本件名」，把这些装配树里本文件的节点名改为<strong>规则名</strong>（改名后常用）。不改 XLink 路径。
      </p>
      <p v-if="loadingIncoming" class="empty muted">载入入向引用…</p>
      <p v-else-if="!incomingHosts.length" class="empty muted">无入向宿主</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th class="col-chk">
              <input
                type="checkbox"
                :checked="allIncomingSelected"
                :disabled="loading"
                @change="toggleAllIncoming(($event.target as HTMLInputElement).checked)"
              />
            </th>
            <th>宿主装配</th>
            <th>关系</th>
            <th>经子装配</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in incomingHosts" :key="row.host_repo_rel_path">
            <td class="col-chk">
              <input
                type="checkbox"
                :checked="selectedIncoming.has(row.host_repo_rel_path)"
                @change="toggleIncoming(row.host_repo_rel_path, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="mono">
              <button
                v-if="canOpenFileDetailRel(row.host_repo_rel_path)"
                type="button"
                class="link-key"
                :title="row.host_repo_rel_path"
                @click="openFileDetailRel(row.host_repo_rel_path)"
              >
                {{ basenameFromRel(row.host_repo_rel_path) }}
              </button>
              <span v-else :title="row.host_repo_rel_path">{{ row.host_repo_rel_path }}</span>
            </td>
            <td>{{ row.depth === 0 ? "直接" : `间接 · ${row.depth}` }}</td>
            <td class="mono muted">{{ row.via_chain.length ? row.via_chain.join(" → ") : "—" }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="block">
      <div class="sub-title-row">
        <h3 class="sub-title">
          本文件引用了谁（{{ outgoingCount }}）
          <span v-if="outgoingStats.missing || outgoingStats.ambiguous" class="out-stats">
            · 缺失 {{ outgoingStats.missing }}
            <template v-if="outgoingStats.ambiguous"> · 歧义 {{ outgoingStats.ambiguous }}</template>
          </span>
        </h3>
        <el-button v-if="showAssemblyLink" size="small" @click="goToAssemblyTab">
          批量对齐子件名 → 装配结构
        </el-button>
      </div>
      <p v-if="outgoingRefs.length" class="section-hint muted">
        <strong>链接标签（子件名）</strong> = 装配树里该引用的显示名（Link.Label）。
        <template v-if="outgoingLabelMismatchCount">
          当前有 <strong>{{ outgoingLabelMismatchCount }}</strong> 处与目标标准名不一致（黄行）。
        </template>
        批量对齐请前往
        <el-button link size="small" @click="goToAssemblyTab">装配结构</el-button>
        Tab。单条改 XLink 路径请用右侧「改链接」。
      </p>
      <p v-else-if="!loading" class="section-hint muted">
        本文件无下级引用。若被父装配引用，请用上方「更新父装配中本件名」。
      </p>
      <p v-if="!loading && !outgoingRefs.length" class="empty muted">无出向引用</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th :title="LINK_LABEL_TITLE">{{ LINK_LABEL_COLUMN_WIDE }}</th>
            <th>目标文件</th>
            <th>目标目录</th>
            <th v-if="showXlinkColumn">XLink 属性</th>
            <th>解析</th>
            <th v-if="showXlinkReplaceActions" class="col-action">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in outgoingRefs" :key="row.id" :class="rowClass(row.resolve_status, row)">
            <td class="tree-name-cell">
              <span v-if="row.link_label" class="mono">{{ row.link_label }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td class="mono">
              <button
                v-if="canOpenFileDetailRel(row.target_repo_rel_path)"
                type="button"
                class="link-key"
                :title="row.target_repo_rel_path || row.target_basename"
                @click="openFileDetailRel(row.target_repo_rel_path!)"
              >
                {{ row.target_basename }}
              </button>
              <span v-else>{{ row.target_basename }}</span>
            </td>
            <td class="mono muted">
              <button
                v-if="canOpenFileDetailRel(row.target_repo_rel_path)"
                type="button"
                class="link-key muted-link"
                :title="row.target_repo_rel_path || undefined"
                @click="openFileDetailRel(row.target_repo_rel_path!)"
              >
                {{ repoDirFromRel(row.target_repo_rel_path || "") }}
              </button>
              <span v-else :title="row.target_repo_rel_path || undefined">
                {{ row.target_repo_rel_path ? repoDirFromRel(row.target_repo_rel_path) : "—" }}
              </span>
            </td>
            <td v-if="showXlinkColumn" class="mono muted">
              {{ xlinkDiffersFromTarget(row) ? row.xlink_file_attr : "—" }}
            </td>
            <td>
              <span class="tag" :class="row.resolve_status">{{ statusLabel(row.resolve_status) }}</span>
            </td>
            <td v-if="showXlinkReplaceActions" class="col-action">
              <button
                type="button"
                class="btn-row-action"
                :disabled="!canReplaceXlink(row)"
                :title="
                  canReplaceXlink(row)
                    ? '按零件标识搜索候选并写回本文件内该 XLink'
                    : '无 XLink 路径，无法写回'
                "
                @click="openReplaceDialog(row)"
              >
                改链接
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <XlinkReplaceDialog
      :open="replaceOpen"
      :host-repo-rel="hostRepoRel"
      :edge="replaceEdge"
      @close="closeReplaceDialog"
      @applied="onReplaceApplied"
    />

    <p class="hint muted">
      本页展示 CAD 索引中的入向/出向关系。「重建本文件引用索引」从磁盘写入引用边；
      <strong>缺失</strong>表示索引中无目标或路径无法解析。单条 XLink 写回用出向表「改链接」；
      批量改名写回请用「改名」Tab，再重建索引。
    </p>
  </div>
</template>

<style scoped>
.xref-panel {
  padding-top: 4px;
}
.panel-title {
  margin: 0 0 10px;
  font-size: 0.92rem;
  font-weight: 600;
}

.sub-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.sub-title-row .sub-title {
  margin: 0;
}

.section-hint {
  margin: 0 0 10px;
  font-size: 0.76rem;
  line-height: 1.4;
}

.btn-label-sync {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid #059669;
  background: #059669;
  color: #fff;
  font-size: 0.78rem;
  white-space: nowrap;
}

.btn-label-sync:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-assembly-link {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid #86efac;
  background: #fff;
  color: #047857;
  font-size: 0.78rem;
  white-space: nowrap;
  cursor: pointer;
}

.btn-assembly-link:hover {
  background: #f0fdf4;
}

.inline-link {
  padding: 0;
  border: none;
  background: none;
  color: #047857;
  font: inherit;
  font-size: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.inline-link:hover {
  color: #065f46;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 14px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
}
.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.index-summary {
  margin: 0 0 12px;
  font-size: 0.78rem;
  color: #0369a1;
}

.col-chk {
  width: 36px;
}

.out-stats {
  font-size: 0.78rem;
  font-weight: 500;
  color: #b45309;
}

.data-table tr.row-label-mismatch {
  background: #fefce8;
}

.tree-name-cell {
  max-width: 180px;
  font-size: 0.78rem;
  word-break: break-all;
}

.section-hint code {
  font-size: 0.9em;
}

.data-table tr.row-missing {
  background: #fffbeb;
}

.data-table tr.row-ambiguous {
  background: #fff7ed;
}

.tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
}

.tag.resolved,
.tag.self,
.tag.present,
.tag.ok {
  background: #d1fae5;
  color: #047857;
}

.tag.missing {
  background: #fee2e2;
  color: #b91c1c;
}

.tag.ambiguous {
  background: #fef3c7;
  color: #b45309;
}
.block {
  margin-bottom: 20px;
}
.sub-title {
  margin: 0 0 8px;
  font-size: 0.9rem;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.data-table th,
.data-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
}
.data-table th {
  background: #f8fafc;
  font-weight: 600;
}
.empty {
  margin: 0;
  font-size: 0.85rem;
}
.hint {
  font-size: 0.78rem;
  line-height: 1.5;
}

.banner.warn {
  padding: 8px 12px;
  border-radius: 6px;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.85rem;
  margin-bottom: 10px;
}
.muted {
  color: var(--muted);
}
.mono {
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.link-key {
  padding: 0;
  border: none;
  background: none;
  color: #1d4ed8;
  font: inherit;
  cursor: pointer;
  text-align: left;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.link-key:hover {
  color: #1e40af;
}

.muted-link {
  color: var(--muted);
}

.muted-link:hover {
  color: #1d4ed8;
}

.col-action {
  width: 72px;
  white-space: nowrap;
}

.btn-row-action {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: #fff;
  font-size: 0.74rem;
  cursor: pointer;
}

.btn-row-action:hover:not(:disabled) {
  background: #f0f9ff;
  border-color: #7dd3fc;
  color: #0369a1;
}

.btn-row-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
