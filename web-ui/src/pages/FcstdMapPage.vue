<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  cancelFcstdMapScan,
  exportFcstdMapJson,
  fetchFcstdMap,
  fetchFcstdMapScanProgress,
  purgeMissingFcstdMap,
  saveFcstdMapPrefs,
  startFcstdMapScan,
  type FcstdMapPayload,
} from "../api";
import { pnwPromptChoice } from "phoenix-wing";
import { useAppShell } from "../composables/useAppShell";
import { useAsyncProgress } from "../composables/useAsyncProgress";
import { useFcstdMapPropertySheet } from "../composables/useFcstdMapPropertySheet";
import { useFcstdMapEntries } from "../composables/useFcstdMapEntries";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { useOnboardingStore } from "../stores/onboarding";
import { usePageSession } from "../composables/usePageSession";
import { usePageSummary } from "../composables/usePageSummary";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import FcstdMapIndexPane from "../components/fcstd-map/FcstdMapIndexPane.vue";
import FcstdMapSettingsPane from "../components/fcstd-map/FcstdMapSettingsPane.vue";
import {
  FCSTD_MAP_KIND_OPTIONS as KIND_OPTIONS,
  fcstdMapCanOpenFileDetail as canOpenFileDetail,
  type FcstdMapEntryViewInput,
  hydrateFcstdMapPageSession,
  serializeFcstdMapPageSession,
  type FcstdMapKindFilter as KindFilter,
  type FcstdMapPageSubTab as PageSubTab,
} from "../models/fcstdMapViewModel";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const onboarding = useOnboardingStore();

const activeSubTab = ref<PageSubTab>("index");
const worksetStore = useFileWorksetsStore();
const primaryWorksetOptions = computed(() => [
  { value: "", label: "全工作空间" },
  ...worksetStore.worksetOptions.map((workset) => ({
    value: workset.id,
    label: `${workset.label}（${workset.count}）`,
  })),
]);
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

function setStatus(msg: string) {
  shell.setStatus(msg);
}

const entriesController = useFcstdMapEntries({
  exists: computed(() => Boolean(data.value?.exists)),
  onError: (error) => setStatus(String(error)),
});
const {
  statusFilter,
  kindFilter,
  searchQuery,
  entries,
  entriesTotal,
  pageOffset,
  pageSize,
  entriesLoading,
  debugSql,
  pageEnd,
  currentPage,
  load: loadEntries,
  onPagerCurrentChange,
  onPagerSizeChange,
} = entriesController;

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
        `扫描完成：CAD ${result.stats.cad_file_count} · FCStd ${result.stats.fcstd_file_count}`,
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

function openPartKey(row: FcstdMapEntryViewInput) {
  if (!row.PartNumber || !row.PartVersion) return;
  shell.openPartKeyDetail(row.PartNumber, row.PartVersion);
}

function openFileDetail(row: FcstdMapEntryViewInput) {
  const rel = row.repo_rel_path?.trim();
  if (!rel || !canOpenFileDetail(row)) return;
  shell.openFileDetailForRel(rel);
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  const hydrated = hydrateFcstdMapPageSession(snap, {
    subTab: activeSubTab.value,
    forceUpdatePartName: forceUpdatePartName.value,
    statusFilter: statusFilter.value,
    kindFilter: kindFilter.value,
    searchQuery: searchQuery.value,
    pageOffset: pageOffset.value,
    pageSize: pageSize.value,
  });
  if (!hydrated) return false;
  activeSubTab.value = hydrated.subTab;
  forceUpdatePartName.value = hydrated.forceUpdatePartName;
  statusFilter.value = hydrated.statusFilter;
  kindFilter.value = hydrated.kindFilter;
  searchQuery.value = hydrated.searchQuery;
  pageOffset.value = hydrated.pageOffset;
  pageSize.value = hydrated.pageSize;
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
  serialize: () => serializeFcstdMapPageSession({
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

usePagePrimaryContribution("fcstd_map", props.workbenchTabId, {
  summary: computed(() => pageSummary.value || "尚未建立 CAD 索引"),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "scan",
      title: "工程内搜索",
      description: "扫描 CAD 资产与零件元数据，写入当前工作空间索引。",
      controls: [
        {
          id: "workset",
          kind: "select",
          label: "扫描工作集",
          modelValue: scanWorksetId,
          options: primaryWorksetOptions,
          clearable: true,
          disabled: scanning,
          onUpdate: (value) => { scanWorksetId.value = value; },
        },
        {
          id: "force-part-name",
          kind: "boolean",
          label: "强制更新零件名称",
          description: "覆盖索引中已有的 PartName；默认保留人工调整。",
          modelValue: forceUpdatePartName,
          disabled: scanning,
          onUpdate: (checked) => { forceUpdatePartName.value = checked; },
        },
        { id: "total", kind: "readonly", label: "索引条目", value: computed(() => stats.value?.total_entries ?? 0) },
        { id: "present", kind: "readonly", label: "存在", value: computed(() => stats.value?.present ?? 0) },
        { id: "missing", kind: "readonly", label: "缺失", value: computed(() => stats.value?.missing ?? 0) },
      ],
      actions: [
        {
          id: "scan",
          label: "工程内搜索",
          tone: "primary",
          loading: scanning,
          disabled: scanning,
          run: onScan,
        },
        {
          id: "cancel",
          label: "取消扫描",
          tone: "danger",
          plain: true,
          disabled: computed(() => !scanning.value),
          run: onCancelScan,
        },
        { id: "save-options", label: "保存设置", loading: saving, run: onSaveScanOptions },
      ],
    },
    {
      id: "view",
      title: "索引 View",
      controls: [
        {
          id: "sub-view",
          kind: "choice",
          label: "中央内容",
          modelValue: activeSubTab,
          options: [
            { value: "index", label: "索引列表" },
            { value: "settings", label: "扫描设置" },
          ],
          onUpdate: (value) => { activeSubTab.value = value === "settings" ? "settings" : "index"; },
        },
        {
          id: "search",
          kind: "text",
          label: "搜索",
          modelValue: searchQuery,
          placeholder: "文件名、零件标识或路径",
          mono: true,
          onUpdate: (value) => { searchQuery.value = value; },
        },
        {
          id: "status",
          kind: "choice",
          label: "状态",
          modelValue: statusFilter,
          options: [
            { value: "all", label: "全部" },
            { value: "present", label: "存在" },
            { value: "missing", label: "缺失" },
          ],
          onUpdate: (value) => {
            statusFilter.value = value === "present" || value === "missing" ? value : "all";
          },
        },
        {
          id: "kind",
          kind: "select",
          label: "资产类型",
          modelValue: kindFilter,
          options: KIND_OPTIONS,
          onUpdate: (value) => {
            kindFilter.value = KIND_OPTIONS.some((option) => option.value === value)
              ? value as KindFilter
              : "all";
          },
        },
        { id: "result-count", kind: "readonly", label: "当前结果", value: entriesTotal },
      ],
      actions: [
        { id: "refresh", label: "刷新", loading, run: () => refresh() },
        {
          id: "export",
          label: "导出 JSON",
          loading: exporting,
          disabled: computed(() => !data.value?.exists),
          run: onExportJson,
        },
        {
          id: "purge",
          label: computed(() => stats.value?.missing ? `删除缺失（${stats.value.missing}）` : "删除缺失"),
          tone: "danger",
          plain: true,
          loading: purging,
          disabled: computed(() => loading.value || scanning.value || !(stats.value?.missing)),
          run: onPurgeMissing,
        },
      ],
    },
  ]),
});

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
  entriesController.dispose();
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
      <FcstdMapIndexPane
        v-model:search-query="searchQuery"
        v-model:status-filter="statusFilter"
        v-model:kind-filter="kindFilter"
        :exists="Boolean(data?.exists)"
        :loading="loading"
        :entries-loading="entriesLoading"
        :entries="entries"
        :entries-total="entriesTotal"
        :page-offset="pageOffset"
        :page-end="pageEnd"
        :page-size="pageSize"
        :current-page="currentPage"
        @page-change="onPagerCurrentChange"
        @page-size-change="onPagerSizeChange"
        @open-file-detail="openFileDetail"
        @open-part-key="openPartKey"
      />
    </div>

    <div v-show="activeSubTab === 'settings'" class="sub-panel settings-panel">
      <FcstdMapSettingsPane
        :workspace-path="shell.workspacePath.value"
        :has-index="Boolean(data?.exists)"
        :exporting="exporting"
        :debug-sql="debugSql"
        @export-json="onExportJson"
      />
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

.settings-panel {
  overflow: auto;
  padding-bottom: 8px;
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
