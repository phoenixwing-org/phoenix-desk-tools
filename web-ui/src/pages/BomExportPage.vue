<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import {
  fetchBomXrefEdges,
  fetchBomXrefMeta,
  fetchBomXrefOutgoing,
  fetchFcstdMap,
  rebuildBomXrefs,
  type BomXrefEdge,
  type BomXrefMeta,
  type FcstdMapEntry,
} from "../api";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import type { TableColumnDef } from "../composables/useResizableTable";
import { useWorkspaceFileQuery } from "../composables/useWorkspaceFileQuery";
import { BOM_FIELD_LABELS as L, LINK_LABEL_COLUMN_WIDE } from "../utils/bomFieldLabels";
import {
  basenameFromRel,
  normalizeRepoRel,
  normalizeRepoRelForApi,
  repoDirFromRel,
  resolveOutgoingHostQuery,
} from "../utils/workspaceFileQuery";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const SESSION_V = 1;
type PageSubTab = "assembly" | "all" | "settings";
const PAGE_SIZES = [50, 100, 200] as const;

const shell = useAppShell();
const {
  queryText,
  pickedRel,
  clearPickedOnInput,
  applyTreeSelection,
  registerTreeSelectHandler,
  unregisterTreeSelectHandler,
} = useWorkspaceFileQuery(props.workbenchTabId);

type BomRow = {
  index: number;
  hostBasename: string;
  hostRel: string;
  PartNumber: string;
  PartVersion: string;
  TypeCode: string;
  PartName: string;
  linkLabel: string;
  filename: string;
  repoRel: string;
  resolveStatus: string;
  labelMismatch?: boolean;
};

const assemblyColumns: TableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "linkLabel", label: LINK_LABEL_COLUMN_WIDE, width: 160, minWidth: 120 },
  { key: "partKey", label: L.partKey, width: 108, minWidth: 80 },
  { key: "typeCode", label: L.typeCode, width: 36, minWidth: 28 },
  { key: "partName", label: L.partName, width: 120, minWidth: 80 },
  { key: "file", label: "文件名", width: 180, minWidth: 100 },
  { key: "path", label: "相对目录", width: 160, minWidth: 100 },
  { key: "resolve", label: "解析", width: 72, minWidth: 56 },
];

const allColumns: TableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "linkLabel", label: LINK_LABEL_COLUMN_WIDE, width: 160, minWidth: 120 },
  { key: "host", label: "宿主文件", width: 160, minWidth: 100 },
  { key: "partKey", label: L.partKey, width: 108, minWidth: 80 },
  { key: "typeCode", label: L.typeCode, width: 36, minWidth: 28 },
  { key: "partName", label: L.partName, width: 120, minWidth: 80 },
  { key: "file", label: "子件文件名", width: 160, minWidth: 100 },
  { key: "path", label: "子件目录", width: 160, minWidth: 100 },
  { key: "resolve", label: "解析", width: 72, minWidth: 56 },
];

const activeSubTab = ref<PageSubTab>("assembly");
const meta = ref<BomXrefMeta | null>(null);
const hostRel = ref("");
const refs = ref<BomXrefEdge[]>([]);
const allRefs = ref<BomXrefEdge[]>([]);
const allTotal = ref(0);
const allOffset = ref(0);
const pageSize = ref(100);
const allSearch = ref("");
const mapEntries = ref<FcstdMapEntry[]>([]);
const loading = ref(false);
const loadingAll = ref(false);
const rebuilding = ref(false);
const assemblyError = ref("");
const allRefsError = ref("");
const allGroupByHost = ref(true);
const expandedAllHosts = ref<Set<string>>(new Set());

type AllHostGroup = {
  hostRel: string;
  hostBasename: string;
  rows: BomRow[];
};

const allChildColumns = computed(() => allColumns.filter((c) => c.key !== "host"));

const hasIndex = computed(() => (meta.value?.edge_count ?? 0) > 0);

const mapByRel = computed(() => {
  const m = new Map<string, FcstdMapEntry>();
  for (const e of mapEntries.value) {
    m.set(normalizeRepoRel(e.repo_rel_path), e);
  }
  return m;
});

function enrichTarget(edge: BomXrefEdge) {
  const rel = edge.target_repo_rel_path ? normalizeRepoRel(edge.target_repo_rel_path) : "";
  const entry = rel ? mapByRel.value.get(rel) : undefined;
  return {
    PartNumber: entry?.PartNumber || "—",
    PartVersion: entry?.PartVersion || "—",
    TypeCode: entry?.TypeCode || "—",
    PartName: entry?.PartName || "—",
    linkLabel: edge.link_label?.trim() || "—",
    filename: edge.target_basename,
    repoRel: edge.target_repo_rel_path || "—",
    resolveStatus: edge.resolve_status,
    labelMismatch: Boolean(edge.label_mismatch),
  };
}

const bomRows = computed((): BomRow[] => {
  return refs.value.map((row, i) => ({
    index: i + 1,
    hostBasename: basenameFromRel(hostRel.value),
    hostRel: hostRel.value,
    ...enrichTarget(row),
  }));
});

const allRows = computed((): BomRow[] => {
  return allRefs.value.map((row, i) => ({
    index: allOffset.value + i + 1,
    hostBasename: basenameFromRel(row.host_repo_rel_path),
    hostRel: row.host_repo_rel_path,
    ...enrichTarget(row),
  }));
});

const allGrouped = computed((): AllHostGroup[] => {
  const groups: AllHostGroup[] = [];
  const seen = new Map<string, AllHostGroup>();
  for (const row of allRows.value) {
    let g = seen.get(row.hostRel);
    if (!g) {
      g = { hostRel: row.hostRel, hostBasename: row.hostBasename, rows: [] };
      seen.set(row.hostRel, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
});

const allHostCount = computed(() => allGrouped.value.length);

function syncExpandedAllHosts(expandAll = true) {
  if (!expandAll) return;
  expandedAllHosts.value = new Set(allGrouped.value.map((g) => g.hostRel));
}

function isAllHostExpanded(hostRel: string) {
  return expandedAllHosts.value.has(hostRel);
}

function toggleAllHost(hostRel: string) {
  const next = new Set(expandedAllHosts.value);
  if (next.has(hostRel)) next.delete(hostRel);
  else next.add(hostRel);
  expandedAllHosts.value = next;
}

function expandAllHosts() {
  expandedAllHosts.value = new Set(allGrouped.value.map((g) => g.hostRel));
}

function collapseAllHosts() {
  expandedAllHosts.value = new Set();
}

const totalPages = computed(() => Math.max(1, Math.ceil(allTotal.value / pageSize.value)));
const currentPage = computed(() => Math.floor(allOffset.value / pageSize.value) + 1);

async function loadMeta() {
  meta.value = await fetchBomXrefMeta();
}

async function loadMapIndex() {
  try {
    const data = await fetchFcstdMap();
    mapEntries.value = data.entries ?? [];
  } catch {
    mapEntries.value = [];
  }
}

function resolveHostQuery() {
  const q = resolveOutgoingHostQuery(queryText.value, pickedRel.value);
  if (!q) return null;
  return { rel: normalizeRepoRelForApi(q.rel) };
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    resolved: "已解析",
    ambiguous: "歧义",
    missing: "未找到",
    self: "自引用",
    non_fcstd: "非 FCStd",
  };
  return map[status] ?? status;
}

function partKeyLabel(row: BomRow) {
  if (!row.PartNumber?.trim() || row.PartNumber === "—") return "";
  if (!row.PartVersion?.trim() || row.PartVersion === "—") return "";
  return `${row.PartNumber}.${row.PartVersion}`;
}

function canOpenFileDetailRel(rel: string) {
  const r = rel?.trim();
  if (!r || r === "—") return false;
  return /\.fcstd$/i.test(basenameFromRel(r));
}

function openFileDetailRel(rel: string) {
  const r = normalizeRepoRelForApi(rel);
  if (!r || !canOpenFileDetailRel(r)) return;
  shell.openFileDetailForRel(r);
}

function openPartKeyFromRow(row: BomRow) {
  const pk = partKeyLabel(row);
  if (!pk) return;
  shell.openPartKeyDetail(row.PartNumber, row.PartVersion, {
    partName: row.PartName !== "—" ? row.PartName : undefined,
  });
}

async function onLoadBom() {
  assemblyError.value = "";
  refs.value = [];
  hostRel.value = "";

  const q = resolveHostQuery();
  if (!q) {
    const msg = "请填写装配路径，或在右侧树中点击总成/装配文件";
    shell.setStatus(msg);
    return;
  }

  if (!hasIndex.value) {
    shell.appendLog("[BOM列表] 提示：引用表为空，请先「重建引用表」", { source: "bom_xref", open: true });
  }

  loading.value = true;
  shell.appendLog(`[BOM列表] 加载装配 BOM：${q.rel}`, { source: "bom_xref", open: true });
  try {
    const data = await fetchBomXrefOutgoing(q.rel);
    hostRel.value = data.host_repo_rel_path;
    refs.value = data.refs;
    shell.appendLog(
      `[BOM列表] 完成：${basenameFromRel(hostRel.value)} · ${data.count} 个子件`,
      { source: "bom_xref" },
    );
    shell.setStatus(`BOM：${basenameFromRel(hostRel.value)} · ${data.count} 个子件`);
  } catch (e) {
    assemblyError.value = String(e);
    shell.appendLog(`[BOM列表] ${String(e)}`, { source: "bom_xref" });
    shell.setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function loadAllEdges(resetOffset = false) {
  if (resetOffset) allOffset.value = 0;
  loadingAll.value = true;
  allRefsError.value = "";
  const searchHint = allSearch.value.trim() ? ` · 搜索「${allSearch.value.trim()}」` : "";
  shell.appendLog(`[BOM列表] 加载全部引用边${searchHint}…`, { source: "bom_xref", open: true });
  try {
    const data = await fetchBomXrefEdges({
      offset: allOffset.value,
      limit: pageSize.value,
      search: allSearch.value,
    });
    allRefs.value = data.refs;
    allTotal.value = data.total;
    syncExpandedAllHosts(true);
    shell.appendLog(
      `[BOM列表] 共 ${data.total} 条 · 本页 ${data.count} 条（第 ${Math.floor(allOffset.value / pageSize.value) + 1} 页）`,
      { source: "bom_xref" },
    );
    shell.setStatus(`全部引用：${data.total} 条 · 本页 ${data.count} 条`);
  } catch (e) {
    const msg = String(e);
    allRefsError.value =
      msg === "Not Found"
        ? "无法加载引用边（API 未就绪）。请重启 python -m fcdesk.web --dev 后重试。"
        : msg;
    shell.appendLog(`[BOM列表] ${allRefsError.value}`, { source: "bom_xref" });
    allRefs.value = [];
    allTotal.value = 0;
  } finally {
    loadingAll.value = false;
  }
}

function goPrevPage() {
  if (allOffset.value <= 0) return;
  allOffset.value = Math.max(0, allOffset.value - pageSize.value);
  void loadAllEdges();
}

function goNextPage() {
  if (allOffset.value + pageSize.value >= allTotal.value) return;
  allOffset.value += pageSize.value;
  void loadAllEdges();
}

async function onTreeSelect(repoRel: string) {
  applyTreeSelection(repoRel);
  assemblyError.value = "";
  activeSubTab.value = "assembly";
  await onLoadBom();
}

function registerTreeHandler() {
  registerTreeSelectHandler(onTreeSelect);
}

function unregisterTreeHandler() {
  unregisterTreeSelectHandler();
}

async function onRebuild() {
  rebuilding.value = true;
  assemblyError.value = "";
  allRefsError.value = "";
  shell.appendLog(
    "[BOM列表] 重建 BOM 引用表（从 CAD 索引 present FCStd 提取 XLink）…",
    { source: "bom_xref", open: true },
  );
  try {
    const out = await rebuildBomXrefs();
    await loadMeta();
    shell.appendLog(out.log ?? `[BOM列表] 完成：${out.edge_count} 条 · ${out.host_count} 个宿主`, {
      source: "bom_xref",
    });
    shell.setStatus(
      `引用表已重建：${out.edge_count} 条边 · ${out.host_count} 个宿主` +
        (out.hosts_with_xlink != null
          ? ` · 扫描 ${out.host_files_scanned ?? "?"} 个 FCStd`
          : ""),
    );
    if (activeSubTab.value === "all") {
      await loadAllEdges(true);
    } else if (hostRel.value) {
      await onLoadBom();
    }
  } catch (e) {
    const msg = String(e);
    shell.appendLog(`[BOM列表] ${msg}`, { source: "bom_xref" });
    if (activeSubTab.value === "all") allRefsError.value = msg;
    else assemblyError.value = msg;
  } finally {
    rebuilding.value = false;
  }
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V) return false;
  if (snap.subTab === "assembly" || snap.subTab === "all" || snap.subTab === "settings") {
    activeSubTab.value = snap.subTab;
  }
  if (snap.queryText != null) queryText.value = String(snap.queryText);
  if (snap.allSearch != null) allSearch.value = String(snap.allSearch);
  if (typeof snap.pageSize === "number" && PAGE_SIZES.includes(snap.pageSize as (typeof PAGE_SIZES)[number])) {
    pageSize.value = snap.pageSize;
  }
  if (typeof snap.allOffset === "number") allOffset.value = snap.allOffset;
  await loadMeta();
  await loadMapIndex();
  if (activeSubTab.value === "all") await loadAllEdges();
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) {
    void loadMeta().catch((e) => {
      assemblyError.value = String(e);
    });
    void loadMapIndex();
    return;
  }
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  void loadMeta().catch((e) => {
    assemblyError.value = String(e);
  });
  void loadMapIndex();
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    subTab: activeSubTab.value,
    queryText: queryText.value,
    allSearch: allSearch.value,
    pageSize: pageSize.value,
    allOffset: allOffset.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch([activeSubTab, queryText, allSearch, pageSize, allOffset], () => shell.scheduleWorkbenchSave());

watch(activeSubTab, (tab) => {
  if (tab === "all") {
    assemblyError.value = "";
    if (!allRefs.value.length && hasIndex.value) void loadAllEdges(true);
  } else if (tab === "assembly") {
    allRefsError.value = "";
  }
});

watch(pageSize, () => {
  if (activeSubTab.value === "all") void loadAllEdges(true);
});

onMounted(() => {
  applyInitialTabState();
  registerTreeHandler();
});

onActivated(() => {
  registerTreeHandler();
});

onDeactivated(() => {});

onUnmounted(() => {
  unregisterTreeHandler();
});
</script>

<template>
  <div class="page bom-list-page">
    <header class="page-head">
      <div class="head-row">
        <div class="head-left">
          <h1 class="page-title">BOM 列表</h1>
          <p v-if="meta" class="head-meta">
            引用边 {{ meta.edge_count }} · 宿主 {{ meta.host_count }}
            <span v-if="meta.last_bom_xref_at"> · 更新 {{ meta.last_bom_xref_at }}</span>
            <span class="head-meta-hint"> · 随 CAD 索引「工程内搜索」自动重建</span>
          </p>
        </div>
        <button
          type="button"
          class="btn head-rebuild"
          :disabled="rebuilding"
          title="仅重读各 FCStd 的 XLink 并刷新引用表，不重扫 CAD 索引属性。日常请在「CAD 索引」工程内搜索；改 XLink 后若未重扫可用此按钮。"
          @click="onRebuild"
        >
          {{ rebuilding ? "重建中…" : "仅重建引用表" }}
        </button>
      </div>
    </header>

    <p v-if="!hasIndex" class="warn-line">
      引用表为空。请先在「CAD 索引」执行「工程内搜索」（会一并重建引用表）。
    </p>

    <nav class="sub-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'assembly' }"
        @click="activeSubTab = 'assembly'"
      >
        装配 BOM
      </button>
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'all' }"
        @click="activeSubTab = 'all'"
      >
        全部引用
        <span v-if="meta?.edge_count" class="tab-badge">{{ meta.edge_count }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'settings' }"
        @click="activeSubTab = 'settings'"
      >
        引用设置
      </button>
    </nav>

    <!-- 装配一层 BOM -->
    <div v-show="activeSubTab === 'assembly'" class="sub-panel">
      <section class="toolbar">
        <input
          v-model="queryText"
          class="search-input mono"
          spellcheck="false"
          placeholder="装配路径或文件名；或右侧树点击"
          @input="clearPickedOnInput"
          @keydown.enter.prevent="onLoadBom"
        />
        <button type="button" class="btn primary" :disabled="loading" @click="onLoadBom">
          {{ loading ? "加载中…" : "加载 BOM" }}
        </button>
      </section>
      <div v-if="assemblyError" class="banner err">{{ assemblyError }}</div>
      <p v-if="pickedRel" class="picked-hint mono">已从树选择：{{ pickedRel }}</p>
      <p v-if="hostRel" class="host-line mono">
        {{ hostRel }} · {{ bomRows.length }} 个子件
      </p>

      <ResizableDataTable
        v-if="bomRows.length"
        :columns="assemblyColumns"
        wrap-class="table-grow"
        table-class="bom-table"
      >
        <tbody>
          <tr
            v-for="row in bomRows"
            :key="`${row.index}-${row.filename}`"
            :class="{ 'row-label-mismatch': row.labelMismatch }"
          >
            <td class="col-index">{{ row.index }}</td>
            <td class="mono link-label-cell">
              <button
                v-if="canOpenFileDetailRel(row.repoRel)"
                type="button"
                class="link-key"
                :title="row.repoRel"
                @click="openFileDetailRel(row.repoRel)"
              >
                {{ row.linkLabel }}
              </button>
              <span v-else :title="row.linkLabel">{{ row.linkLabel }}</span>
            </td>
            <td>
              <button
                v-if="partKeyLabel(row)"
                type="button"
                class="link-key"
                @click="openPartKeyFromRow(row)"
              >
                {{ partKeyLabel(row) }}
              </button>
              <span v-else>{{ row.PartNumber }}</span>
            </td>
            <td>{{ row.TypeCode }}</td>
            <td>{{ row.PartName }}</td>
            <td class="mono">
              <button
                v-if="canOpenFileDetailRel(row.repoRel)"
                type="button"
                class="link-key"
                :title="row.repoRel"
                @click="openFileDetailRel(row.repoRel)"
              >
                {{ row.filename }}
              </button>
              <span v-else>{{ row.filename }}</span>
            </td>
            <td class="mono muted" :title="row.repoRel">{{ repoDirFromRel(row.repoRel) }}</td>
            <td>
              <span class="tag" :class="row.resolveStatus">{{ statusLabel(row.resolveStatus) }}</span>
            </td>
          </tr>
        </tbody>
      </ResizableDataTable>
      <div v-else-if="hostRel && !loading" class="empty-wrap table-grow">
        <p class="empty">该装配暂无出向 XLink 引用。</p>
      </div>
      <div v-else-if="!hostRel && !loading" class="empty-wrap table-grow">
        <p class="empty">选择装配文件并点击「加载 BOM」。</p>
      </div>
    </div>

    <!-- 全部引用边 -->
    <div v-show="activeSubTab === 'all'" class="sub-panel">
      <section class="toolbar">
        <input
          v-model="allSearch"
          class="search-input"
          type="search"
          spellcheck="false"
          placeholder="搜索宿主、子件文件名、路径…"
          @keydown.enter.prevent="loadAllEdges(true)"
        />
        <button type="button" class="btn primary" :disabled="loadingAll" @click="loadAllEdges(true)">
          {{ loadingAll ? "…" : "搜索" }}
        </button>
        <label class="page-size">
          每页
          <select v-model.number="pageSize">
            <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <div class="pager">
          <button type="button" class="btn mini" :disabled="loadingAll || allOffset <= 0" @click="goPrevPage">
            上一页
          </button>
          <span class="page-info">
            第 {{ currentPage }} / {{ totalPages }} 页 · 共 {{ allTotal }} 条
            <template v-if="allGroupByHost && allHostCount">
              · {{ allHostCount }} 个宿主
            </template>
          </span>
          <button
            type="button"
            class="btn mini"
            :disabled="loadingAll || allOffset + pageSize >= allTotal"
            @click="goNextPage"
          >
            下一页
          </button>
        </div>
        <label v-if="allRows.length" class="view-opt">
          <input v-model="allGroupByHost" type="checkbox" />
          按宿主分组
        </label>
        <template v-if="allGroupByHost && allRows.length">
          <button type="button" class="btn mini" @click="expandAllHosts">展开宿主</button>
          <button type="button" class="btn mini" @click="collapseAllHosts">折叠宿主</button>
        </template>
      </section>

      <div v-if="allRefsError" class="banner err">{{ allRefsError }}</div>

      <ResizableDataTable
        v-if="allRows.length && allGroupByHost"
        :columns="allChildColumns"
        wrap-class="table-grow"
        table-class="bom-table bom-table-grouped"
      >
        <tbody>
          <template v-for="group in allGrouped" :key="group.hostRel">
            <tr class="host-group-row" @click="toggleAllHost(group.hostRel)">
              <td :colspan="allChildColumns.length" class="host-group-cell">
                <span class="host-toggle">{{
                  isAllHostExpanded(group.hostRel) ? "▾" : "▸"
                }}</span>
                <button
                  v-if="canOpenFileDetailRel(group.hostRel)"
                  type="button"
                  class="link-key host-link"
                  :title="group.hostRel"
                  @click.stop="openFileDetailRel(group.hostRel)"
                >
                  {{ group.hostBasename }}
                </button>
                <span v-else class="mono host-link" :title="group.hostRel">{{ group.hostBasename }}</span>
                <span class="host-meta muted">{{ group.rows.length }} 条引用</span>
              </td>
            </tr>
            <template v-if="isAllHostExpanded(group.hostRel)">
              <tr
                v-for="row in group.rows"
                :key="`${group.hostRel}-${row.index}-${row.filename}`"
                class="child-ref-row"
                :class="{ 'row-label-mismatch': row.labelMismatch }"
              >
                <td class="col-index">{{ row.index }}</td>
                <td class="mono link-label-cell">
                  <button
                    v-if="canOpenFileDetailRel(row.repoRel)"
                    type="button"
                    class="link-key"
                    :title="row.repoRel"
                    @click="openFileDetailRel(row.repoRel)"
                  >
                    {{ row.linkLabel }}
                  </button>
                  <span v-else :title="row.linkLabel">{{ row.linkLabel }}</span>
                </td>
                <td>
                  <button
                    v-if="partKeyLabel(row)"
                    type="button"
                    class="link-key"
                    @click="openPartKeyFromRow(row)"
                  >
                    {{ partKeyLabel(row) }}
                  </button>
                  <span v-else>—</span>
                </td>
                <td>{{ row.TypeCode }}</td>
                <td>{{ row.PartName }}</td>
                <td class="mono">
                  <button
                    v-if="canOpenFileDetailRel(row.repoRel)"
                    type="button"
                    class="link-key"
                    :title="row.repoRel"
                    @click="openFileDetailRel(row.repoRel)"
                  >
                    {{ row.filename }}
                  </button>
                  <span v-else>{{ row.filename }}</span>
                </td>
                <td class="mono muted" :title="row.repoRel">{{ repoDirFromRel(row.repoRel) }}</td>
                <td>
                  <span class="tag" :class="row.resolveStatus">{{ statusLabel(row.resolveStatus) }}</span>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </ResizableDataTable>

      <ResizableDataTable
        v-else-if="allRows.length"
        :columns="allColumns"
        wrap-class="table-grow"
        table-class="bom-table"
      >
        <tbody>
          <tr
            v-for="row in allRows"
            :key="`${row.hostRel}-${row.index}-${row.filename}`"
            :class="{ 'row-label-mismatch': row.labelMismatch }"
          >
            <td class="col-index">{{ row.index }}</td>
            <td class="mono link-label-cell">
              <button
                v-if="canOpenFileDetailRel(row.repoRel)"
                type="button"
                class="link-key"
                :title="row.repoRel"
                @click="openFileDetailRel(row.repoRel)"
              >
                {{ row.linkLabel }}
              </button>
              <span v-else :title="row.linkLabel">{{ row.linkLabel }}</span>
            </td>
            <td class="mono">
              <button
                v-if="canOpenFileDetailRel(row.hostRel)"
                type="button"
                class="link-key"
                :title="row.hostRel"
                @click="openFileDetailRel(row.hostRel)"
              >
                {{ row.hostBasename }}
              </button>
              <span v-else :title="row.hostRel">{{ row.hostBasename }}</span>
            </td>
            <td>
              <button
                v-if="partKeyLabel(row)"
                type="button"
                class="link-key"
                @click="openPartKeyFromRow(row)"
              >
                {{ partKeyLabel(row) }}
              </button>
              <span v-else>—</span>
            </td>
            <td>{{ row.TypeCode }}</td>
            <td>{{ row.PartName }}</td>
            <td class="mono">
              <button
                v-if="canOpenFileDetailRel(row.repoRel)"
                type="button"
                class="link-key"
                :title="row.repoRel"
                @click="openFileDetailRel(row.repoRel)"
              >
                {{ row.filename }}
              </button>
              <span v-else>{{ row.filename }}</span>
            </td>
            <td class="mono muted" :title="row.repoRel">{{ repoDirFromRel(row.repoRel) }}</td>
            <td>
              <span class="tag" :class="row.resolveStatus">{{ statusLabel(row.resolveStatus) }}</span>
            </td>
          </tr>
        </tbody>
      </ResizableDataTable>
      <div v-else-if="loadingAll" class="empty-wrap table-grow">
        <p class="empty">加载中…</p>
      </div>
      <div v-else class="empty-wrap table-grow">
        <p class="empty">{{ hasIndex ? "无匹配引用边" : "尚无引用表，请先在 CAD 索引「工程内搜索」" }}</p>
      </div>
    </div>

    <!-- 设置与说明 -->
    <div v-show="activeSubTab === 'settings'" class="sub-panel settings-panel">
      <section v-if="shell.workspacePath || meta" class="settings-block project-block">
        <h2 class="block-title">当前工程</h2>
        <dl class="project-dl">
          <dt>工作区</dt>
          <dd class="mono">{{ shell.workspacePath || "—" }}</dd>
          <dt>CAD 索引库</dt>
          <dd class="mono">{{ meta?.database_path_display || "—" }}</dd>
          <template v-if="meta">
            <dt>引用边</dt>
            <dd>{{ meta.edge_count ?? "—" }}</dd>
            <dt>宿主数</dt>
            <dd>{{ meta.host_count ?? "—" }}</dd>
            <dt v-if="meta.last_bom_xref_at">引用表更新</dt>
            <dd v-if="meta.last_bom_xref_at">{{ meta.last_bom_xref_at }}</dd>
          </template>
        </dl>
      </section>
      <section class="settings-block">
        <h2 class="block-title">说明</h2>
        <p class="block-desc">
          选择<strong>装配/总成 FCStd</strong>，在「装配 BOM」列出其 XLink 直接子件；属性列来自 CAD 索引。
          「全部引用」展示数据库中所有引用边（分页）。引用关系需先构建引用表。
        </p>
      </section>
      <section class="settings-block">
        <h2 class="block-title">引用表</h2>
        <p class="block-desc">
          引用表在「CAD 索引 · 工程内搜索」结束时自动按 present 的 FCStd 重建。
          若只改了磁盘上的 XLink（如链接路径修正）而未重扫索引，可用页顶「仅重建引用表」同步引用边，不更新 PartNumber 等属性。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.bom-list-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
  height: 100%;
}

.head-rebuild {
  flex-shrink: 0;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.warn-line {
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: #b45309;
  flex-shrink: 0;
}

.sub-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.sub-tab {
  padding: 8px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--muted);
  margin-bottom: -1px;
}

.sub-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.tab-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.72rem;
  background: #e0e7ff;
  color: #3730a3;
}

.sub-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 200px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.picked-hint {
  margin: 0 0 6px;
  font-size: 0.78rem;
  color: #1d4ed8;
  flex-shrink: 0;
}

.host-line {
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: var(--muted);
  flex-shrink: 0;
}

.page-size {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--muted);
}

.page-size select {
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.page-info {
  font-size: 0.82rem;
  color: var(--muted);
  white-space: nowrap;
}

.settings-panel {
  overflow: auto;
  gap: 16px;
}

.settings-block {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.block-title {
  margin: 0 0 8px;
  font-size: 0.92rem;
}

.block-desc {
  margin: 0 0 12px;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
}

.project-dl {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 0.82rem;
}

.project-dl dt {
  margin: 0;
  color: var(--muted);
}

.project-dl dd {
  margin: 0;
  word-break: break-all;
}

.table-grow {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
  font-size: 0.85rem;
}

.btn {
  padding: 7px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.btn.mini {
  padding: 5px 10px;
  font-size: 0.78rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
}

.mono {
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.muted {
  color: var(--muted);
}

.tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  background: #e5e7eb;
}

.tag.resolved {
  background: #d1fae5;
  color: #047857;
}

.tag.ambiguous {
  background: #fef3c7;
  color: #b45309;
}

.bom-table tr.row-label-mismatch {
  background: #fffbeb;
}

.bom-table-grouped .host-group-row {
  background: #f1f5f9;
  cursor: pointer;
}

.bom-table-grouped .host-group-cell {
  padding: 6px 10px;
  font-weight: 600;
}

.bom-table-grouped .host-toggle {
  display: inline-block;
  width: 18px;
  color: #64748b;
  font-size: 0.72rem;
}

.bom-table-grouped .host-meta {
  margin-left: 10px;
  font-size: 0.76rem;
  font-weight: 500;
}

.bom-table-grouped .child-ref-row td {
  background: #fff;
}

/* 子件行链接标签列相对宿主分组行略缩进，与展开三角对齐 */
.bom-table-grouped .child-ref-row .link-label-cell {
  padding-left: 20px;
}

.bom-table-grouped .child-ref-row .col-index {
  color: var(--muted);
}

.view-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  margin-left: 8px;
}

.link-label-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
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

:deep(.col-index),
:deep(td.col-index) {
  text-align: right;
  color: var(--muted);
}
</style>
