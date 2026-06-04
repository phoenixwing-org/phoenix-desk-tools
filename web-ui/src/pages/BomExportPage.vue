<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import {
  fetchAssemblyBomHosts,
  fetchBomXrefMeta,
  rebuildBomXrefs,
  type AssemblyBomHostRow,
  type BomXrefMeta,
} from "../api";
import OnboardingBanner from "../components/OnboardingBanner.vue";
import PageHelpButton from "../components/PageHelpButton.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import { useAppShell } from "../composables/useAppShell";
import { useOnboardingStore } from "../stores/onboarding";
import { usePageSession } from "../composables/usePageSession";
import type { TableColumnDef } from "../composables/useResizableTable";
import { useWorkspaceFileQuery } from "../composables/useWorkspaceFileQuery";
import { BOM_FIELD_LABELS as L } from "../utils/bomFieldLabels";
import { basenameFromRel, normalizeRepoRelForApi } from "../utils/workspaceFileQuery";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const SESSION_V = 2;
type PageSubTab = "catalog" | "settings";

const shell = useAppShell();
const onboarding = useOnboardingStore();
const { queryText, pickedRel, clearPickedOnInput, applyTreeSelection, registerTreeSelectHandler, unregisterTreeSelectHandler } =
  useWorkspaceFileQuery(props.workbenchTabId);

const catalogColumns: TableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "file", label: "总成文件", width: 200, minWidth: 120 },
  { key: "partKey", label: L.partKey, width: 108, minWidth: 80 },
  { key: "partName", label: L.partName, width: 140, minWidth: 80 },
  { key: "refs", label: "直接子件", width: 72, minWidth: 56 },
  { key: "incoming", label: "被引用", width: 64, minWidth: 52 },
  { key: "issues", label: "缺失/歧义", width: 88, minWidth: 64 },
  { key: "path", label: "相对路径", width: 200, minWidth: 100 },
];

const activeSubTab = ref<PageSubTab>("catalog");
const meta = ref<BomXrefMeta | null>(null);
const catalogHosts = ref<AssemblyBomHostRow[]>([]);
const catalogSearch = ref("");
const catalogLoading = ref(false);
const catalogError = ref("");
const rebuilding = ref(false);

const hasIndex = computed(() => (meta.value?.edge_count ?? 0) > 0);

const catalogFiltered = computed(() => {
  const q = catalogSearch.value.trim().toLowerCase();
  if (!q) return catalogHosts.value;
  return catalogHosts.value.filter((h) => {
    const blob = [
      h.host_repo_rel_path,
      h.filename,
      h.part_key,
      h.PartName,
      h.label,
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
});

function partKeyLabel(row: AssemblyBomHostRow) {
  return row.part_key?.trim() || "";
}

function canOpenAssembly(rel: string) {
  const r = rel?.trim();
  return Boolean(r && /\.fcstd$/i.test(basenameFromRel(r)));
}

function openAssemblyDetail(rel: string) {
  const r = normalizeRepoRelForApi(rel);
  if (!r || !canOpenAssembly(r)) return;
  shell.openFileDetailForRel(r, { subTab: "assembly" });
}

function fileRoleLabel(role: string) {
  if (role === "assembly") return "总成";
  if (role === "drawing") return "图纸";
  return "零件";
}

async function loadMeta() {
  meta.value = await fetchBomXrefMeta();
}

async function loadCatalog() {
  catalogLoading.value = true;
  catalogError.value = "";
  shell.appendLog("[BOM列表] 加载总成列表…", { source: "bom_xref", open: true });
  try {
    const data = await fetchAssemblyBomHosts();
    catalogHosts.value = data.hosts;
    shell.appendLog(
      `[BOM列表] 共 ${data.count} 个总成（引用边 ${meta.value?.edge_count ?? "—"}）`,
      { source: "bom_xref" },
    );
    shell.setStatus(`BOM 列表：${data.count} 个总成`);
  } catch (e) {
    const msg = String(e);
    catalogError.value =
      msg === "Not Found"
        ? "无法加载总成列表（API 未就绪）。请重启 python -m fcdesk.web --dev 后重试。"
        : msg;
    catalogHosts.value = [];
    shell.appendLog(`[BOM列表] ${catalogError.value}`, { source: "bom_xref" });
  } finally {
    catalogLoading.value = false;
  }
}

async function onRebuild() {
  rebuilding.value = true;
  catalogError.value = "";
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
        (out.hosts_with_xlink != null ? ` · 扫描 ${out.host_files_scanned ?? "?"} 个 FCStd` : ""),
    );
    if (activeSubTab.value === "catalog") await loadCatalog();
  } catch (e) {
    catalogError.value = String(e);
    shell.appendLog(`[BOM列表] ${catalogError.value}`, { source: "bom_xref" });
  } finally {
    rebuilding.value = false;
  }
}

async function onTreeSelect(repoRel: string) {
  applyTreeSelection(repoRel);
  const r = normalizeRepoRelForApi(repoRel) || repoRel;
  if (canOpenAssembly(r)) {
    activeSubTab.value = "catalog";
    openAssemblyDetail(r);
  }
}

function registerTreeHandler() {
  registerTreeSelectHandler(onTreeSelect);
}

function unregisterTreeHandler() {
  unregisterTreeSelectHandler();
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V && snap.v !== 1) return false;
  const tab = String(snap.subTab || "");
  if (tab === "catalog" || tab === "settings") {
    activeSubTab.value = tab;
  } else if (tab === "assembly" || tab === "all") {
    activeSubTab.value = "catalog";
  }
  if (snap.catalogSearch != null) catalogSearch.value = String(snap.catalogSearch);
  if (snap.queryText != null) queryText.value = String(snap.queryText);
  await loadMeta();
  if (activeSubTab.value === "catalog") await loadCatalog();
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) {
    void loadMeta().then(() => {
      if (hasIndex.value) void loadCatalog();
    });
    return;
  }
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  void loadMeta().then(() => {
    if (hasIndex.value) void loadCatalog();
  });
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    subTab: activeSubTab.value,
    catalogSearch: catalogSearch.value,
    queryText: queryText.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch([activeSubTab, catalogSearch, queryText], () => shell.scheduleWorkbenchSave());

watch(activeSubTab, (tab) => {
  if (tab === "catalog" && !catalogHosts.value.length && hasIndex.value) {
    void loadCatalog();
  }
});

onMounted(() => {
  void onboarding.refreshStatus();
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
            <template v-if="catalogHosts.length">
              总成 {{ catalogHosts.length }} 个
            </template>
            <template v-else-if="hasIndex">总成 —</template>
            · 引用边 {{ meta.edge_count }} · 宿主 {{ meta.host_count }}
            <span v-if="meta.last_bom_xref_at"> · 更新 {{ meta.last_bom_xref_at }}</span>
          </p>
        </div>
        <div class="head-trailing">
          <button
            type="button"
            class="btn head-rebuild"
            :disabled="rebuilding"
            title="仅重读各 FCStd 的 XLink 并刷新引用表，不重扫 CAD 索引属性。"
            @click="onRebuild"
          >
            {{ rebuilding ? "重建中…" : "仅重建引用表" }}
          </button>
          <div class="head-help">
            <PageHelpButton page-id="bom_export" />
          </div>
        </div>
      </div>
    </header>

    <OnboardingBanner
      v-if="!onboarding.indexScanned"
      message="建议先在「CAD 索引」执行工程内搜索，BOM 属性与 PartKey 才完整。"
      action-label="去 CAD 索引"
      @action="shell.goToPage('fcstd_map')"
    />

    <p v-if="!hasIndex" class="warn-line">
      引用表为空。请先在「CAD 索引」执行「工程内搜索」（会一并重建引用表）。
    </p>

    <nav class="sub-tabs" role="tablist" data-tour-page-bom-tabs>
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'catalog' }"
        @click="activeSubTab = 'catalog'"
      >
        总成列表
        <span v-if="catalogHosts.length" class="tab-badge">{{ catalogHosts.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="sub-tab"
        :class="{ active: activeSubTab === 'settings' }"
        @click="activeSubTab = 'settings'"
      >
        说明
      </button>
    </nav>

    <div v-show="activeSubTab === 'catalog'" class="sub-panel">
      <section class="toolbar">
        <input
          v-model="catalogSearch"
          class="search-input"
          type="search"
          spellcheck="false"
          placeholder="筛选总成文件名、路径、零件号…"
        />
        <button type="button" class="btn primary" :disabled="catalogLoading" @click="loadCatalog">
          {{ catalogLoading ? "加载中…" : "刷新列表" }}
        </button>
        <span v-if="catalogFiltered.length" class="toolbar-hint muted">
          显示 {{ catalogFiltered.length }} / {{ catalogHosts.length }} 个总成 · 点击行打开装配结构
        </span>
      </section>
      <p class="catalog-hint muted">
        仅列出<strong>总成</strong>（<code>*.assy.fcstd</code> 或出向引用 ≥ 2 件）；<strong>图纸</strong>与单零件不显示。
        子件明细请在<strong>文件详情 → 装配结构</strong>查看。重建引用表时会写入物化路径表，便于统计各文件在 BOM 树中的出现次数。
      </p>
      <p v-if="pickedRel" class="picked-hint mono">已从树选择：{{ pickedRel }}</p>
      <div v-if="catalogError" class="banner err">{{ catalogError }}</div>

      <ResizableDataTable
        v-if="catalogFiltered.length"
        :columns="catalogColumns"
        wrap-class="table-grow"
        table-class="bom-table bom-catalog-table"
        data-tour-page-bom-table
      >
        <tbody>
          <tr
            v-for="(row, i) in catalogFiltered"
            :key="row.host_repo_rel_path"
            class="catalog-row"
            @click="openAssemblyDetail(row.host_repo_rel_path)"
          >
            <td class="col-index">{{ i + 1 }}</td>
            <td class="mono">
              <button
                v-if="canOpenAssembly(row.host_repo_rel_path)"
                type="button"
                class="link-key"
                :title="row.host_repo_rel_path"
                @click.stop="openAssemblyDetail(row.host_repo_rel_path)"
              >
                {{ row.filename }}
              </button>
              <span v-else>{{ row.filename }}</span>
              <span class="role-tag muted">{{ fileRoleLabel(row.file_role) }}</span>
            </td>
            <td>
              <button
                v-if="partKeyLabel(row)"
                type="button"
                class="link-key"
                @click.stop="shell.openPartKeyDetail(row.part_number, row.part_version, { partName: row.PartName })"
              >
                {{ partKeyLabel(row) }}
              </button>
              <span v-else class="muted">—</span>
            </td>
            <td>{{ row.PartName || row.label || "—" }}</td>
            <td>{{ row.ref_count }}</td>
            <td :title="row.incoming_host_count ? '直接引用本总成的宿主文件数' : ''">
              {{ row.incoming_host_count || "—" }}
            </td>
            <td>
              <span v-if="row.missing_count || row.ambiguous_count" class="issue-count">
                <template v-if="row.missing_count">{{ row.missing_count }} 缺失</template>
                <template v-if="row.missing_count && row.ambiguous_count"> · </template>
                <template v-if="row.ambiguous_count">{{ row.ambiguous_count }} 歧义</template>
              </span>
              <span v-else class="muted">—</span>
            </td>
            <td class="mono muted path-cell" :title="row.host_repo_rel_path">
              {{ row.host_repo_rel_path }}
            </td>
          </tr>
        </tbody>
      </ResizableDataTable>
      <div v-else-if="catalogLoading" class="empty-wrap table-grow">
        <p class="empty">加载总成列表…</p>
      </div>
      <div v-else class="empty-wrap table-grow">
        <p class="empty">
          {{ hasIndex ? "当前无符合条件的总成（需 .assy 命名或子件≥2）" : "尚无引用表，请先在 CAD 索引「工程内搜索」" }}
        </p>
      </div>
    </div>

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
        <h2 class="block-title">总成列表</h2>
        <p class="block-desc">
          一次 SQL 汇总各装配宿主及直接子件数量；不展开全部引用边。点击行进入<strong>文件详情 → 装配结构</strong>（多级树已预计算缓存）。
        </p>
        <p class="block-desc">
          计入规则：<code>*.assy.fcstd</code>，或出向 XLink ≥ 2；排除 <code>*.drawing.fcstd</code> 图纸。
        </p>
      </section>
      <section class="settings-block">
        <h2 class="block-title">引用表</h2>
        <p class="block-desc">
          「CAD 索引 · 工程内搜索」结束时自动重建。仅改 XLink 未重扫时，可用页顶「仅重建引用表」。
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

.catalog-hint {
  margin: 0 0 8px;
  font-size: 0.78rem;
  line-height: 1.45;
  flex-shrink: 0;
}

.toolbar-hint {
  font-size: 0.78rem;
  white-space: nowrap;
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
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 12rem;
  max-width: 360px;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.picked-hint {
  margin: 0 0 6px;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.empty-wrap {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
}

.bom-catalog-table :deep(tbody tr.catalog-row) {
  cursor: pointer;
}

.bom-catalog-table :deep(tbody tr.catalog-row:hover) {
  background: #f8fafc;
}

.role-tag {
  margin-left: 6px;
  font-size: 0.72rem;
}

.path-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-count {
  font-size: 0.78rem;
  color: #b45309;
}

.settings-panel {
  overflow: auto;
}

.settings-block {
  margin-bottom: 20px;
}

.block-title {
  margin: 0 0 8px;
  font-size: 0.95rem;
}

.block-desc {
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.55;
}

.project-dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  margin: 0;
  font-size: 0.82rem;
}

.project-dl dt {
  color: var(--muted);
}

.project-dl dd {
  margin: 0;
}
</style>
