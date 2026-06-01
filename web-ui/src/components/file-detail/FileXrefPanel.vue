<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BomXrefEdge, BomXrefHost } from "../../api";
import { fetchBomXrefIncoming, fetchBomXrefOutgoing } from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";
import { basenameFromRel, normalizeRepoRelForApi } from "../../utils/workspaceFileQuery";

const ctx = useFileDetailContext();
const shell = useAppShell();
const loading = ref(false);
const includeTransitive = ref(true);
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

async function loadTables(manual = false) {
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
      fetchBomXrefOutgoing(ctx.rel.value, 500),
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
</script>

<template>
  <div class="xref-panel">
    <h3 class="panel-title">引用关系</h3>
    <div class="toolbar">
      <label class="chk">
        <input v-model="includeTransitive" type="checkbox" />
        含间接宿主
      </label>
      <button type="button" class="btn" :disabled="loading" @click="loadTables(true)">
        {{ loading ? "…" : "刷新" }}
      </button>
      <button type="button" class="btn" @click="ctx.switchSubTab('rename')">去改名 Tab 写回引用</button>
    </div>

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
      <h3 class="sub-title">本文件引用了谁（{{ outgoingCount }}）</h3>
      <p v-if="!loading && !outgoingRefs.length" class="empty muted">无出向引用</p>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>目标文件</th>
            <th>目标路径</th>
            <th v-if="showXlinkColumn">XLink 属性</th>
            <th>解析</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in outgoingRefs" :key="row.id">
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
                @click="openFileDetailRel(row.target_repo_rel_path!)"
              >
                {{ row.target_repo_rel_path }}
              </button>
              <span v-else>{{ row.target_repo_rel_path || "—" }}</span>
            </td>
            <td v-if="showXlinkColumn" class="mono muted">
              {{ xlinkDiffersFromTarget(row) ? row.xlink_file_attr : "—" }}
            </td>
            <td>{{ statusLabel(row.resolve_status) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="hint muted">
      修正 XLink 路径与引用名请在「改名」子 Tab 执行分析写回；本页为只读关系总览。
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
