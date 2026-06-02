<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BomXrefEdge, BomXrefHost } from "../../api";
import { fetchBomXrefIncoming, fetchBomXrefOutgoing, refreshBomXrefHostIndex } from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";
import { basenameFromRel, normalizeRepoRelForApi, repoDirFromRel } from "../../utils/workspaceFileQuery";

const ctx = useFileDetailContext();
const shell = useAppShell();
const loading = ref(false);
const rebuilding = ref(false);
const indexSummary = ref("");
const includeTransitive = ref(true);
const rebuildSubtree = ref(true);
const incomingHosts = ref<BomXrefHost[]>([]);
const outgoingRefs = ref<BomXrefEdge[]>([]);
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

function rowClass(status: string) {
  if (status === "missing") return "row-missing";
  if (status === "ambiguous") return "row-ambiguous";
  return "";
}

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
    outgoingRefs.value = out.refs;
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
      <button type="button" class="btn" @click="ctx.switchSubTab('rename')">去改名 Tab 写回引用</button>
    </div>
    <p v-if="indexSummary" class="index-summary">{{ indexSummary }}</p>

    <section class="block">
      <h3 class="sub-title">
        谁引用了本文件（{{ incomingCount }}）
        <span v-if="includeTransitive && directCount < incomingCount" class="muted">
          · 直接 {{ directCount }} · 间接 {{ incomingCount - directCount }}
        </span>
      </h3>
      <p v-if="!loading && !incomingHosts.length" class="empty muted">无入向宿主</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>宿主装配</th>
            <th>关系</th>
            <th>经子装配</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in incomingHosts" :key="row.host_repo_rel_path">
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
      <h3 class="sub-title">
        本文件引用了谁（{{ outgoingCount }}）
        <span v-if="outgoingStats.missing || outgoingStats.ambiguous" class="out-stats">
          · 缺失 {{ outgoingStats.missing }}
          <template v-if="outgoingStats.ambiguous"> · 歧义 {{ outgoingStats.ambiguous }}</template>
        </span>
      </h3>
      <p v-if="!loading && !outgoingRefs.length" class="empty muted">无出向引用</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>目标文件</th>
            <th>目标目录</th>
            <th v-if="showXlinkColumn">XLink 属性</th>
            <th>解析</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in outgoingRefs" :key="row.id" :class="rowClass(row.resolve_status)">
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
          </tr>
        </tbody>
      </table>
    </section>

    <p class="hint muted">
      「重建本文件引用索引」从磁盘写入本文件（及可选下级）的引用边，<strong>缺失</strong>表示 CAD 索引中无目标或路径无法解析。
      全库属性请用 CAD 索引「工程内搜索」。改 XLink 路径请到「改名」Tab 或「链接路径修正」写回后再重建索引。
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

.out-stats {
  font-size: 0.78rem;
  font-weight: 500;
  color: #b45309;
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
