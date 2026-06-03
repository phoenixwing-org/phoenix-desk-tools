<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BomXrefEdge, BomXrefHost } from "../../api";
import { fetchBomXrefIncoming, fetchBomXrefOutgoing, refreshBomXrefHostIndex } from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useReferenceLabelSync } from "../../composables/useReferenceLabelSync";
import { useAppShell } from "../../composables/useAppShell";
import { basenameFromRel, normalizeRepoRelForApi, repoDirFromRel } from "../../utils/workspaceFileQuery";
import { logReferenceLabelApply } from "../../utils/referenceLabelLog";

const ctx = useFileDetailContext();
const shell = useAppShell();
const loading = ref(false);
const rebuilding = ref(false);
const indexSummary = ref("");
const includeTransitive = ref(true);
const rebuildSubtree = ref(true);
const incomingHosts = ref<BomXrefHost[]>([]);
const selectedIncoming = ref<Set<string>>(new Set());
const outgoingRefs = ref<BomXrefEdge[]>([]);
const outgoingLabelMismatchCount = ref(0);
const directCount = ref(0);
const incomingCount = computed(() => ctx.incomingCount.value);
const outgoingCount = computed(() => ctx.outgoingCount.value);

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

async function loadTables(manual = false, refreshDisk = true) {
  if (!ctx.rel.value.trim()) return;
  loading.value = true;
  if (manual) {
    shell.appendLog(`[文件详情] 刷新引用关系 ${ctx.rel.value}…`, { source: "file_detail", open: true });
  }
  try {
    const [inc, out] = await Promise.all([
      fetchBomXrefIncoming({
        rel: ctx.rel.value,
        transitive: includeTransitive.value,
        limit: 500,
      }),
      fetchBomXrefOutgoing(ctx.rel.value, 500, refreshDisk),
    ]);
    incomingHosts.value = inc.hosts;
    selectedIncoming.value = new Set(inc.hosts.map((h) => h.host_repo_rel_path));
    outgoingRefs.value = out.refs;
    outgoingLabelMismatchCount.value =
      out.label_mismatch_count ??
      out.refs.filter((r) => r.label_mismatch).length;
    directCount.value = inc.direct_count ?? inc.count;
    ctx.incomingCount.value = inc.count;
    ctx.outgoingCount.value = out.count;
    if (manual) {
      shell.appendLog(
        `[文件详情] 入向 ${inc.count} · 出向 ${out.count}`,
        { source: "file_detail" },
      );
    }
  } catch (e) {
    ctx.pageError.value = String(e);
    incomingHosts.value = [];
    selectedIncoming.value = new Set();
    outgoingRefs.value = [];
    if (manual) shell.appendLog(String(e), { source: "file_detail" });
  } finally {
    loading.value = false;
  }
}

watch(
  () => ctx.rel.value,
  () => {
    void loadTables();
  },
  { immediate: true },
);

watch(includeTransitive, () => {
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
  void loadTables(false, false);
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
    <div class="toolbar">
      <button
        type="button"
        class="btn primary"
        :disabled="rebuilding || loading"
        title="从磁盘重读本文件 XLink 并写入引用表；勾选下级时一并索引子装配 FCStd"
        @click="onRebuildIndex"
      >
        {{ rebuilding ? "索引中…" : "重建本文件引用索引" }}
      </button>
      <label class="chk">
        <input v-model="rebuildSubtree" type="checkbox" :disabled="rebuilding" />
        含下级 FCStd
      </label>
      <label class="chk">
        <input v-model="includeTransitive" type="checkbox" />
        入向含间接宿主
      </label>
      <button type="button" class="btn" :disabled="loading || rebuilding" @click="loadTables(true)">
        {{ loading ? "…" : "刷新列表" }}
      </button>
      <button type="button" class="btn" @click="ctx.switchSubTab('rename')">改名后修正 XLink…</button>
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
        <button
          type="button"
          class="btn-label-sync"
          :disabled="labelSyncing || !canSyncIncomingLabels"
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
        </button>
      </div>
      <p class="section-hint muted">
        下方列出<strong>引用本文件</strong>的装配。勾选后点「更新父装配中本件名」，把这些装配树里本文件的节点名改为<strong>规则名</strong>（改名后常用）。不改 XLink 路径。
      </p>
      <p v-if="!loading && !incomingHosts.length" class="empty muted">无入向宿主</p>
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
        <button
          v-if="showAssemblyLink"
          type="button"
          class="btn-assembly-link"
          @click="goToAssemblyTab"
        >
          批量对齐子件名 → 装配结构
        </button>
      </div>
      <p v-if="outgoingRefs.length" class="section-hint muted">
        <strong>子件零件名</strong> = 本装配树里看到的名称；<strong>规则名</strong> = 目标文件的标准名。
        <template v-if="outgoingLabelMismatchCount">
          当前有 <strong>{{ outgoingLabelMismatchCount }}</strong> 处不一致（黄行）。
        </template>
        批量对齐请前往
        <button type="button" class="inline-link" @click="goToAssemblyTab">装配结构</button>
        Tab（支持按规则名更新与手工编辑）。
      </p>
      <p v-else-if="!loading" class="section-hint muted">
        本文件无下级引用。若被父装配引用，请用上方「更新父装配中本件名」。
      </p>
      <p v-if="!loading && !outgoingRefs.length" class="empty muted">无出向引用</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>目标文件</th>
            <th title="装配树 Link.Label">子件零件名</th>
            <th title="目标 FCStd 的规则显示名">规则名</th>
            <th>目标目录</th>
            <th v-if="showXlinkColumn">XLink 属性</th>
            <th>解析</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in outgoingRefs" :key="row.id" :class="rowClass(row.resolve_status, row)">
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
            <td class="tree-name-cell">
              <span v-if="row.link_label" class="mono">{{ row.link_label }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td class="tree-name-cell">
              <span v-if="row.rule_label" class="mono muted">{{ row.rule_label }}</span>
              <span v-else class="muted">—</span>
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
          </tr>
        </tbody>
      </table>
    </section>

    <p class="hint muted">
      本页展示 CAD 索引中的入向/出向关系。「重建本文件引用索引」从磁盘写入引用边；
      <strong>缺失</strong>表示索引中无目标或路径无法解析。磁盘改名后请先在「改名」Tab 写回 XLink，再重建索引。
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
</style>
