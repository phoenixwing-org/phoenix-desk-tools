<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  cancelFcstdMapScan,
  exportFcstdMapJson,
  fetchFcstdMap,
  fetchFcstdMapEntries,
  fetchFcstdMapScanProgress,
  purgeMissingFcstdMap,
  saveFcstdMapPrefs,
  scanFcstdMap,
  startFcstdMapScan,
  type FcstdMapEntry,
  type FcstdMapPayload,
} from "../api";
import { pnwPromptChoice } from "phoenix-wing";
import { useAppShell } from "../composables/useAppShell";
import { useAsyncProgress } from "../composables/useAsyncProgress";
import { useFcstdMapPropertySheet } from "../composables/useFcstdMapPropertySheet";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { useOnboardingStore } from "../stores/onboarding";
import { usePageSession } from "../composables/usePageSession";
import { usePageSummary } from "../composables/usePageSummary";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { PnwTableColumnDef } from "phoenix-wing";
import { BOM_FIELD_LABELS as L } from "../utils/bomFieldLabels";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const onboarding = useOnboardingStore();

const SESSION_V = 4;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

type PageSubTab = "index" | "settings";

const cadColumns: PnwTableColumnDef[] = [
  { key: "index", label: "#", width: 44, minWidth: 40, headerClass: "col-index" },
  { key: "status", label: "状态", width: 52, minWidth: 44 },
  { key: "kind", label: "类型", width: 72, minWidth: 56 },
  { key: "file", label: "文件名", width: 200, minWidth: 100 },
  { key: "partKey", label: L.partKey, width: 108, minWidth: 80 },
  { key: "partVersion", label: L.partVersion, width: 88, minWidth: 72 },
  { key: "typeCode", label: L.typeCode, width: 72, minWidth: 56 },
  { key: "modelSeries", label: L.modelSeries, width: 96, minWidth: 72 },
  { key: "partName", label: L.partName, width: 120, minWidth: 80 },
  { key: "label", label: L.label, width: 120, minWidth: 80 },
  { key: "dir", label: "相对目录", width: 140, minWidth: 80 },
  { key: "meta", label: "属性摘要", width: 220, minWidth: 120 },
];

const KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "fcstd", label: "FCStd" },
  { value: "markdown", label: "MD" },
  { value: "pdf", label: "PDF" },
  { value: "cad_exchange", label: "DXF/DWG" },
  { value: "image", label: "图片" },
] as const;

type KindFilter = (typeof KIND_OPTIONS)[number]["value"];

const activeSubTab = ref<PageSubTab>("index");
const worksetStore = useFileWorksetsStore();
const forceUpdatePartName = ref(false);
const scanWorksetId = ref(localStorage.getItem("fcstd-scan-workset-id") || "");  // 空=全部
watch(scanWorksetId, (v) => localStorage.setItem("fcstd-scan-workset-id", v || ""));
const scanScopeDirs = ref<string[]>([]);
const loading = ref(false);
const scanning = ref(false);
const saving = ref(false);
const exporting = ref(false);
const purging = ref(false);
const data = ref<FcstdMapPayload | null>(null);
const statusFilter = ref<"all" | "present" | "missing">("all");
const kindFilter = ref<KindFilter>("all");
const searchQuery = ref("");
const entries = ref<FcstdMapEntry[]>([]);
const entriesTotal = ref(0);
const pageOffset = ref(0);
const pageSize = ref(20);
const entriesLoading = ref(false);
const debugSql = ref("");

const stats = computed(() => data.value?.stats);

const pageSummary = computed(() => {
  const s = stats.value;
  if (!s) return "";
  return `条目 ${s.total_entries} · 存在 ${s.present} · 缺失 ${s.missing}`;
});

usePageSummary(pageSummary);

useFcstdMapPropertySheet("fcstd_map", {
  data,
  forceUpdatePartName,
  scanWorksetId,
  worksetName: computed(() => worksetStore.worksetById(scanWorksetId.value)?.name || ""),
  onSaveScanOptions,
});

const pageEnd = computed(() => Math.min(pageOffset.value + entries.value.length, entriesTotal.value));
const hasPrevPage = computed(() => pageOffset.value > 0);
const hasNextPage = computed(() => pageOffset.value + pageSize.value < entriesTotal.value);
const currentPage = computed(() => Math.floor(pageOffset.value / pageSize.value) + 1);

function setStatus(msg: string) {
  shell.setStatus(msg);
}

function assetKindLabel(row: FcstdMapEntry) {
  const map: Record<string, string> = {
    fcstd: "FCStd",
    markdown: "MD",
    pdf: "PDF",
    cad_exchange: "DXF/DWG",
    image: "图片",
    other: "其他",
  };
  return map[row.asset_kind] ?? row.asset_kind ?? "—";
}

async function onPurgeMissing() {
  const n = stats.value?.missing ?? 0;
  if (n <= 0) {
    setStatus("当前没有缺失条目");
    return;
  }
  const choice = await pnwPromptChoice({
    title: "删除缺失记录",
    defaultChoiceId: "cancel",
    message:
      `将从 CAD 索引库永久删除 ${n} 条「缺失」记录（磁盘上已不存在的文件）。\n\n` +
      "零件目录、BOM 引用中指向这些条目的关联会一并清理。\n" +
      "此操作不可撤销。",
    choices: [
      { id: "cancel", label: "取消", variant: "default" },
      { id: "confirm", label: `删除 ${n} 条`, variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;
  purging.value = true;
  shell.appendLog(`[CAD 索引] 删除缺失记录 ${n} 条…`, { source: "fcstd_map", open: true });
  try {
    const out = await purgeMissingFcstdMap();
    data.value = { ...out, entries: [] };
    const deleted = out.purge_deleted ?? 0;
    const msg = deleted ? `已删除 ${deleted} 条缺失记录` : "没有缺失记录可删除";
    shell.appendLog(`[CAD 索引] ${msg}`, { source: "fcstd_map" });
    setStatus(msg);
    if (deleted && statusFilter.value === "missing") {
      statusFilter.value = "all";
    }
    pageOffset.value = 0;
    await loadEntries();
  } catch (e) {
    shell.appendLog(String(e), { source: "fcstd_map" });
    setStatus(String(e));
  } finally {
    purging.value = false;
  }
}

async function loadMeta() {
  data.value = await fetchFcstdMap();
  forceUpdatePartName.value = Boolean(data.value.prefs.force_update_part_name);
  setStatus(data.value.exists ? `索引 ${data.value.stats.total_entries} 条` : "尚无索引库");
}

async function refresh(resetPage = true) {
  loading.value = true;
  try {
    if (resetPage) pageOffset.value = 0;
    await loadMeta();
    await loadEntries();
  } catch (e) {
    setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function onSaveScanOptions() {
  saving.value = true;
  try {
    const prefs = await saveFcstdMapPrefs(forceUpdatePartName.value);
    forceUpdatePartName.value = Boolean(prefs.force_update_part_name);
    setStatus("已保存扫描选项");
  } catch (e) {
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

// 异步扫描 — 委托给 useAsyncProgress
const scanProgressUI = useAsyncProgress("fcstd-scan");

async function onScan() {
  if (scanning.value) return; // 已在扫描中，防重复点击
  scanning.value = true;
  const ws = shell.workspacePath.value || "（工作空间）";
  const scopeLabel = scanWorksetId.value ? `工作集「${worksetStore.worksetById(scanWorksetId.value)?.name || "?"}」` : "全部";
  shell.appendLog(`工程内搜索：${scopeLabel}`, { source: "fcstd_map", open: true });

    try {
      try {
        await scanProgressUI.startPolling(
          () => startFcstdMapScan(forceUpdatePartName.value, scanWorksetId.value || undefined),
          (id) => fetchFcstdMapScanProgress(id),
          (id) => cancelFcstdMapScan(id),
          { taskName: scanWorksetId.value ? `工程内搜索 · ${worksetStore.worksetById(scanWorksetId.value)?.name || "工作集"}` : "FCStd 工程内搜索", singleton: true },
        );
        // startPolling 返回了但没启动新任务 → singleton 拒绝了
        if (!scanProgressUI.isRunning.value) {
          scanning.value = false;
          setStatus("扫描已在运行中，详情见浮层面板");
          return;
        }
      } catch (e: unknown) {
        if (e && typeof e === "object" && "__conflict" in e) {
          const ce = e as { __conflict: true; taskId: string; taskName: string; status?: string };
          const isDone = ce.status === "done" || ce.status === "error" || ce.status === "cancelled";
          const choice = await pnwPromptChoice({
            title: isDone ? "上次任务已完成" : "上次扫描未完成",
            defaultChoiceId: "view",
            message: isDone
              ? `上次「${ce.taskName}」已完成，可以查看结果或开始新搜索。`
              : `检测到上次「${ce.taskName}」未完成。BOM 缓存已保留，继续扫描会跳过已读取的文件。`,
            choices: isDone
              ? [
                  { id: "view", label: "查看上次结果", variant: "primary" },
                  { id: "new", label: "新搜索", variant: "default" },
                ]
              : [
                  { id: "cancel", label: "取消", variant: "default" },
                  { id: "continue", label: "继续上次扫描", variant: "primary" },
                  { id: "restart", label: "放弃缓存，重新开始", variant: "danger" },
                ],
          });
          if (isDone) {
            if (!choice.choiceId) {
              // X 关闭 → 不操作
              scanning.value = false;
              return;
            }
            if (choice.choiceId === "view") {
              // 展开浮层让用户查看
              scanProgressUI.store.setFullscreen(true);
            } else {
              // 新搜索 → 确认旧任务 + 启动新扫描
              scanProgressUI.store.confirmTask(ce.taskId);
            }
            scanning.value = false;
            if (choice.choiceId !== "view") await onScan();
            return;
          }
          // orphaned 逻辑不变
          if (!choice.choiceId || choice.choiceId === "cancel") {
            scanning.value = false;
            return;
          }
          scanProgressUI.store.removeTask(ce.taskId);
          scanning.value = false;
          await onScan();
          return;
        }
        throw e; // 非冲突异常 → 外层 catch 处理
      }

    // 轮询结束 → 检查结果
    const finalState = scanProgressUI.state.value;
    if (finalState?.status === "done") {
      const result = await fetchFcstdMap();
      data.value = { ...result, entries: [] };
      shell.appendLog(
        `扫描完成：CAD ${result.stats.cad_file_count} · FCStd ${result.stats.fcstd_count ?? result.stats.present}`,
        { source: "fcstd_map" },
      );
      setStatus(
        `扫描完成：存在 ${result.stats.present} · CAD ${result.stats.cad_file_count}`,
      );
      activeSubTab.value = "index";
      pageOffset.value = 0;
      await loadEntries();
      await onboarding.refreshStatus();
    } else if (finalState?.status === "error") {
      shell.appendLog(`[CAD 索引] 扫描出错: ${finalState.error}`, { source: "fcstd_map" });
      setStatus(finalState.error || "扫描出错");
      await pnwPromptChoice({
        title: "扫描出错",
        defaultChoiceId: "ok",
        message: finalState.error || "扫描过程中发生未知错误",
        choices: [{ id: "ok", label: "确认", variant: "primary" }],
      });
    } else if (finalState?.status === "cancelled") {
      shell.appendLog("[CAD 索引] 扫描已取消", { source: "fcstd_map" });
      setStatus("扫描已取消");
    }
  } catch (e) {
    const msg = String(e);
    shell.appendLog(msg, { source: "fcstd_map" });
    setStatus(msg);
    await pnwPromptChoice({
      title: "扫描失败",
      defaultChoiceId: "ok",
      message: msg || "扫描请求失败，请检查后端是否正常运行",
      choices: [{ id: "ok", label: "确认", variant: "primary" }],
    });
  } finally {
    scanning.value = false;
  }
}

async function onCancelScan() {
  await scanProgressUI.cancel();
  scanning.value = false;
  setStatus("扫描已取消");
}

onMounted(async () => {
  await scanProgressUI.resume();
});

async function onExportJson() {
  exporting.value = true;
  shell.appendLog("[CAD索引] 导出 fcstd_map.json…", { source: "fcstd_map", open: true });
  try {
    const out = await exportFcstdMapJson();
    shell.appendLog(`已导出 → ${out.path_display}`, { source: "fcstd_map" });
    setStatus(`已导出 fcstd_map.json（仅 FCStd）→ ${out.path_display}`);
    await refresh();
  } catch (e) {
    shell.appendLog(String(e), { source: "fcstd_map" });
    setStatus(String(e));
  } finally {
    exporting.value = false;
  }
}

function statusLabel(row: FcstdMapEntry) {
  return row.file_status === "missing" ? "缺失" : "存在";
}

function partKeyLabel(row: FcstdMapEntry) {
  if (!row.PartNumber || !row.PartVersion) return "";
  return `${row.PartNumber}.${row.PartVersion}`;
}

function openPartKey(row: FcstdMapEntry) {
  if (!row.PartNumber || !row.PartVersion) return;
  shell.openPartKeyDetail(row.PartNumber, row.PartVersion);
}

function canOpenFileDetail(row: FcstdMapEntry) {
  return (
    row.file_status === "present" &&
    (row.asset_kind === "fcstd" || /\.fcstd$/i.test(row.filename))
  );
}

function openFileDetail(row: FcstdMapEntry) {
  const rel = row.repo_rel_path?.trim();
  if (!rel || !canOpenFileDetail(row)) return;
  shell.openFileDetailForRel(rel);
}

function metaCell(row: FcstdMapEntry) {
  if (row.asset_kind && row.asset_kind !== "fcstd") return "—";
  return [row.PartNumber, row.PartVersion, row.TypeCode, row.ModelSeries, row.PartName, row.label]
    .filter(Boolean)
    .join(" · ");
}

function relDir(row: FcstdMapEntry): string {
  const p = row.repo_rel_path.replace(/\\/g, "/").replace(/^\.\//, "");
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  const dir = p.slice(0, i);
  return dir || ".";
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined;

async function loadEntries() {
  if (!data.value?.exists) {
    entries.value = [];
    entriesTotal.value = 0;
    debugSql.value = "";
    return;
  }
  entriesLoading.value = true;
  try {
    const out = await fetchFcstdMapEntries({
      offset: pageOffset.value,
      limit: pageSize.value,
      status: statusFilter.value,
      kind: kindFilter.value,
      search: searchQuery.value,
    });
    entries.value = out.entries;
    entriesTotal.value = out.total;
    debugSql.value = out.debug_sql;
  } catch (e) {
    entries.value = [];
    entriesTotal.value = 0;
    debugSql.value = "";
    setStatus(String(e));
  } finally {
    entriesLoading.value = false;
  }
}

function goPrevPage() {
  if (!hasPrevPage.value) return;
  pageOffset.value = Math.max(0, pageOffset.value - pageSize.value);
  void loadEntries();
}

function goNextPage() {
  if (!hasNextPage.value) return;
  pageOffset.value += pageSize.value;
  void loadEntries();
}

function onPageSizeChange(ev: Event) {
  const n = Number((ev.target as HTMLSelectElement).value);
  if (!PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) return;
  pageSize.value = n;
  pageOffset.value = 0;
  void loadEntries();
}

function onPagerCurrentChange(page: number) {
  pageOffset.value = (page - 1) * pageSize.value;
  void loadEntries();
}

function onPagerSizeChange(size: number) {
  if (!PAGE_SIZE_OPTIONS.includes(size as (typeof PAGE_SIZE_OPTIONS)[number])) return;
  pageSize.value = size;
  pageOffset.value = 0;
  void loadEntries();
}

function scheduleEntriesReload(resetPage = true) {
  if (resetPage) pageOffset.value = 0;
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    void loadEntries();
  }, 280);
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V && snap.v !== 3 && snap.v !== 2) return false;
  if (snap.subTab === "index" || snap.subTab === "settings") {
    activeSubTab.value = snap.subTab;
  }
  if (typeof snap.forceUpdatePartName === "boolean") {
    forceUpdatePartName.value = snap.forceUpdatePartName;
  }
  const sf = snap.statusFilter;
  if (sf === "all" || sf === "present" || sf === "missing") {
    statusFilter.value = sf;
  }
  const kf = snap.kindFilter;
  if (KIND_OPTIONS.some((o) => o.value === kf)) {
    kindFilter.value = kf as KindFilter;
  }
  if (snap.searchQuery != null) {
    searchQuery.value = String(snap.searchQuery);
  }
  if (typeof snap.pageOffset === "number") {
    pageOffset.value = Math.max(0, snap.pageOffset);
  }
  if (typeof snap.pageSize === "number" && PAGE_SIZE_OPTIONS.includes(snap.pageSize as 20 | 50 | 100)) {
    pageSize.value = snap.pageSize;
  }
  await refresh(false);
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) {
    void refresh();
    return;
  }
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  void refresh();
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    subTab: activeSubTab.value,
    forceUpdatePartName: forceUpdatePartName.value,
    statusFilter: statusFilter.value,
    kindFilter: kindFilter.value,
    searchQuery: searchQuery.value,
    pageOffset: pageOffset.value,
    pageSize: pageSize.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => false,
});

watch([forceUpdatePartName, statusFilter, kindFilter, searchQuery, pageOffset, pageSize, activeSubTab], () =>
  shell.scheduleWorkbenchSave(),
);

watch([statusFilter, kindFilter], () => scheduleEntriesReload(true));
watch(searchQuery, () => scheduleEntriesReload(true));

onMounted(() => {
  applyInitialTabState();
  // 注册页面消息：从工作空间树 pick 的目录加入扫描范围列表
  shell.registerPageMessages("fcstd_map", (msg) => {
    if (msg.type === "tree:pick-dir") {
      if (!scanScopeDirs.value.includes(msg.path)) {
        scanScopeDirs.value = [...scanScopeDirs.value, msg.path];
        shell.toast(`已添加扫描目录: ${msg.path.split("/").filter(Boolean).pop() || msg.path}`, "success");
      }
      return true;
    }
  });
});
onUnmounted(() => {
  shell.registerPageMessages("fcstd_map", null);
});
</script>

<template>
  <div class="page fcstd-map-page">
    <PageHeader title="CAD 索引" page-id="fcstd_map">
      <template #actions>
        <div data-tour-page-fcstd-scan class="head-actions-inner">
          <el-select v-model="scanWorksetId" size="small" placeholder="全部" clearable style="width:140px" :disabled="scanning">
            <el-option label="全部" value="" />
            <el-option v-for="w in worksetStore.worksets" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
          <el-button type="primary" size="small" :loading="scanning" @click="onScan">工程内搜索</el-button>
          <el-button
            v-if="scanning"
            size="small"
            type="danger"
            plain
            @click="onCancelScan"
          >
            取消
          </el-button>
          <el-button size="small" :loading="loading" @click="refresh">刷新</el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :loading="purging"
            :disabled="loading || scanning || !(stats?.missing)"
            :title="stats?.missing ? '从索引库移除缺失条目' : '当前无缺失条目'"
            @click="onPurgeMissing"
          >
            删除缺失{{ stats?.missing ? `（${stats.missing}）` : "" }}
          </el-button>
        </div>
      </template>
    </PageHeader>

    <!-- 扫描状态（详细进度见浮层面板） -->
    <div v-if="scanning" class="scan-status-bar">
      <span class="scan-status-text">扫描中… 进度详情见右侧浮层</span>
    </div>

    <el-radio-group v-model="activeSubTab" size="small" class="sub-tabs">
      <el-radio-button value="index">索引列表</el-radio-button>
      <el-radio-button value="settings">扫描设置</el-radio-button>
    </el-radio-group>

    <div v-show="activeSubTab === 'index'" class="sub-panel index-panel">
      <section class="index-toolbar">
        <el-input
          id="cad-index-search"
          v-model="searchQuery"
          size="small"
          clearable
          type="search"
          spellcheck="false"
          placeholder="搜索文件名、零件标识、路径…"
          class="search-field"
        />
      </section>

      <section class="filters">
        <el-radio-group v-model="statusFilter" size="small">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="present">存在</el-radio-button>
          <el-radio-button value="missing">缺失</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="kindFilter" size="small" class="kind-filter">
          <el-radio-button v-for="opt in KIND_OPTIONS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
        <span class="count">
          显示 <strong>{{ entriesTotal ? `${pageOffset + 1}–${pageEnd}` : 0 }}</strong>
          / {{ entriesTotal }} 条
        </span>
      </section>

      <div class="table-area">
      <ResizableDataTable
        v-if="entries.length"
        :columns="cadColumns"
        wrap-class="table-grow"
        data-tour-page-fcstd-table
      >
        <tbody>
          <tr
            v-for="(row, idx) in entries"
            :key="row.repo_rel_path + row.file_status"
            :class="row.file_status"
          >
            <td class="col-index">{{ pageOffset + idx + 1 }}</td>
            <td>
              <el-tag size="small" :type="row.file_status === 'present' ? 'success' : 'warning'" effect="plain">
                {{ statusLabel(row) }}
              </el-tag>
            </td>
            <td>
              <el-tag size="small" effect="plain">{{ assetKindLabel(row) }}</el-tag>
            </td>
            <td class="mono">
              <button
                v-if="canOpenFileDetail(row)"
                type="button"
                class="link-key"
                :title="row.repo_rel_path"
                @click="openFileDetail(row)"
              >
                {{ row.filename }}
              </button>
              <span v-else>{{ row.filename }}</span>
            </td>
            <td class="mono">
              <button
                v-if="partKeyLabel(row)"
                type="button"
                class="link-key"
                @click="openPartKey(row)"
              >
                {{ partKeyLabel(row) }}
              </button>
              <span v-else>{{ row.PartNumber }}</span>
            </td>
            <td class="mono">{{ row.PartVersion }}</td>
            <td>{{ row.TypeCode }}</td>
            <td>{{ row.ModelSeries }}</td>
            <td>{{ row.PartName }}</td>
            <td>{{ row.label }}</td>
            <td class="mono">{{ relDir(row) }}</td>
            <td class="meta">{{ metaCell(row) }}</td>
          </tr>
        </tbody>
      </ResizableDataTable>
      <el-empty
        v-else-if="entriesLoading || loading"
        class="empty-wrap table-grow"
        description="加载索引列表…"
        :image-size="72"
      />
      <el-empty
        v-else
        class="empty-wrap table-grow"
        :description="
          data?.exists
            ? searchQuery.trim()
              ? '无匹配条目，请调整搜索或筛选'
              : '当前筛选无条目'
            : '尚无索引，点击「工程内搜索」开始扫描'
        "
        :image-size="72"
      />
      </div>

      <el-pagination
        v-if="data?.exists && entriesTotal > 0"
        class="pager"
        size="small"
        layout="total, sizes, prev, pager, next"
        :total="entriesTotal"
        :page-size="pageSize"
        :current-page="currentPage"
        :page-sizes="[...PAGE_SIZE_OPTIONS]"
        :disabled="entriesLoading"
        @current-change="onPagerCurrentChange"
        @size-change="onPagerSizeChange"
      />
    </div>

    <div v-show="activeSubTab === 'settings'" class="sub-panel settings-panel">
      <section class="settings-block">
        <h2 class="block-title">扫描</h2>
        <p class="block-desc">
          从<strong>当前工作空间根</strong>递归扫描 FCStd、Markdown、PDF、图片、DXF/DWG 等，写入
          <code>.phoenix/phoenix-workspace.sqlite</code>。请使用页顶「工程内搜索」；再次扫描时磁盘上已不存在的条目标记为缺失。
        </p>
        <p v-if="shell.workspacePath" class="meta-line mono">工作空间：{{ shell.workspacePath }}</p>
        <p class="hint">
          「强制更新零件名」变更后自动保存。重新扫描会覆盖索引中已有零件名（不写回 FCStd）。
        </p>
      </section>

      <section class="settings-block">
        <h2 class="block-title">导出</h2>
        <p class="block-desc">
          导出 <code>fcstd_map.json</code> 仅含 FCStd 条目，供 xlink 脚本等外部工具使用。
        </p>
        <el-button size="small" :loading="exporting" :disabled="!data?.exists" @click="onExportJson">
          导出 fcstd_map.json
        </el-button>
      </section>

      <section v-if="debugSql" class="settings-block">
        <h2 class="block-title">调试 SQL</h2>
        <p class="block-desc">最近一次列表查询（可复制到 SQLite 客户端执行）。</p>
        <pre class="debug-sql mono">{{ debugSql }}</pre>
      </section>
    </div>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.fcstd-map-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
  height: 100%;
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

.sub-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.index-panel {
  min-height: 0;
}

.table-area {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
  flex-shrink: 0;
  font-size: 0.82rem;
}

.pager-info {
  color: var(--muted);
}

.pager-size {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--muted);
}

.pager-size select {
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.82rem;
}

.debug-sql {
  margin: 0;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.72rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow: auto;
}

.index-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.index-toolbar .search-input {
  flex: 1;
  min-width: 200px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.82rem;
  flex-shrink: 0;
}

.filter {
  display: flex;
  align-items: center;
  gap: 4px;
}

.filter-sep {
  color: var(--muted);
}

.count {
  color: var(--muted);
  margin-left: auto;
}

.settings-panel {
  overflow: auto;
  gap: 16px;
  padding-bottom: 8px;
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

.field-label {
  display: block;
  font-size: 0.78rem;
  color: var(--muted);
  margin-bottom: 6px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.path-input {
  flex: 1;
  min-width: 180px;
  max-width: 420px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.force-opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text);
}

.hint {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.45;
}

.stats-grid {
  display: grid;
  grid-template-columns: 100px 1fr 100px 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 0.85rem;
}

.stats-grid dt {
  margin: 0;
  color: var(--muted);
}

.stats-grid dd {
  margin: 0;
}

.stats-grid .ok {
  color: #15803d;
}

.stats-grid .warn {
  color: #b45309;
}

.meta-block .meta-line {
  margin: 0 0 6px;
  font-size: 0.78rem;
  color: var(--muted);
  word-break: break-all;
}

.meta-block .meta-line:last-child {
  margin-bottom: 0;
}

.btn {
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.btn.mini {
  padding: 6px 10px;
  font-size: 0.78rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn.danger {
  color: #b91c1c;
  border-color: #fecaca;
  background: #fef2f2;
}

.btn.danger:hover:not(:disabled) {
  background: #fee2e2;
}

.btn:disabled {
  opacity: 0.55;
}

.table-grow {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

:deep(.resizable-data-table tr.missing) {
  background: #fff7ed;
}

:deep(.resizable-data-table tr.missing td:nth-child(2)) {
  color: #c2410c;
  font-weight: 600;
}

:deep(.resizable-data-table .col-index),
:deep(.resizable-data-table td.col-index) {
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
}

.meta {
  color: #64748b;
}

.link-key {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  text-decoration: underline;
}

.link-key:hover {
  color: #1d4ed8;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
}

code {
  font-size: 0.9em;
}

/* 扫描状态条（详细进度见浮层面板） */
.scan-status-bar {
  margin-bottom: 16px;
  padding: 8px 16px;
  border-radius: 6px;
  background: var(--accent-soft, #ecf5ff);
}

.scan-status-text {
  font-size: 0.82rem;
  color: var(--accent, #409eff);
}
</style>
