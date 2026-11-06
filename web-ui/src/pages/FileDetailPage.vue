<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import type { BomFields, BomPreview } from "../api";
import { fetchBom, fetchBomXrefCounts } from "../api";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import FileDrawingPanel from "../components/file-detail/FileDrawingPanel.vue";
import FileOverviewPanel from "../components/file-detail/FileOverviewPanel.vue";
import FileAttributesPanel from "../components/file-detail/FileAttributesPanel.vue";
import FileXrefPanel from "../components/file-detail/FileXrefPanel.vue";
import FileAssemblyPanel from "../components/file-detail/FileAssemblyPanel.vue";
import AssemblyMaintenanceDialog from "../features/assembly-maintenance/AssemblyMaintenanceDialog.vue";
import { normalizeAssemblyUpdateFilePath } from "../features/assembly-maintenance/updateController";
import CadObjectInfoPanel from "../features/cad-object-info/CadObjectInfoPanel.vue";
import { cadIndexReadStateLabel } from "../utils/cadIndexState";
import { assemblyRigidPrimary, assemblyJointIssueText } from "../models/assemblyRigidPrimary";
import RenameDialog from "../components/RenameDialog.vue";
import DrawingBomReadonlyBanner from "../components/file-detail/DrawingBomReadonlyBanner.vue";
import { provideFileDetailContext } from "../composables/useFileDetailContext";
import { useDrawingBomReadonly } from "../composables/useDrawingBomReadonly";
import { useFileThumbnail } from "../composables/useFileThumbnail";
import { useThumbnailGeneration } from "../composables/useThumbnailGeneration";
import { useAppShell } from "../composables/useAppShell";
import { useBatchTaskCollection } from "../features/batch-tasks/collection";
import { usePageSession } from "../composables/usePageSession";
import type { FileDetailSubTab } from "../types/fileDetail";
import { DEFAULT_FILE_DETAIL_SUB_TAB, normalizeFileDetailSubTab } from "../types/fileDetail";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const SESSION_V = 1;

const shell = useAppShell();
const rel = ref("");
const batchFileWorkspace = ref("");
const batchCollection = useBatchTaskCollection();
const batchCollectionCount = computed(() => batchCollection.pathsFor(shell.workspacePath.value).length);
function addCurrentFileToBatch() {
  if (!rel.value || loading.value || !shell.workspacePath.value || batchFileWorkspace.value !== shell.workspacePath.value) return;
  try {
    const result = batchCollection.add(shell.workspacePath.value, [rel.value]);
    shell.setStatus(`已加入 ${result.added} 个文件；批次待选 ${result.total} 个，尚未保存或执行。`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    shell.setStatus(message); shell.appendLog(`[批次待选] ${message}`, { source: "batch_tasks", open: true });
  }
}
const thumbnailRel = ref("");
const thumbnailRevision = ref(0);
const thumbnail = useFileThumbnail(shell.workspacePath, thumbnailRel, thumbnailRevision);
const preview = ref<BomPreview | null>(null);
const form = ref<Partial<BomFields>>({});
const baseline = ref<Partial<BomFields>>({});
const originalFilename = ref("");
const loading = ref(false);
const pageError = ref("");
const failedObjectReadRel = ref("");
const activeSubTab = ref<FileDetailSubTab>(DEFAULT_FILE_DETAIL_SUB_TAB);
const pageActive = ref(true);
const incomingCount = ref(0);
const outgoingCount = ref(0);
const xrefCacheByRel = ref<Record<string, import("../api").FileDetailXrefsPayload>>({});
const assemblyCacheByKey = ref<Record<string, import("../api").AssemblyTreeNode[]>>({});
const assemblyLabelEdits = ref(false);
const detailOperations = ref<Record<string, boolean>>({});
const showAssemblyMaintenanceDialog = ref(false);
const hasAssemblyTools = computed(() => !!preview.value?.is_fcstd && !preview.value.bom_readonly
  && !preview.value.document_kinds?.drawing
  && (!!preview.value.document_kinds?.assembly || !!preview.value.assembly_links?.length));
const assemblyToolsDisabled = computed(() => !hasAssemblyTools.value || loading.value
  || showRenameDialog.value || hasUnsavedEdits() || Object.values(detailOperations.value).some(Boolean));
function openAssemblyMaintenance() {
  if (assemblyToolsDisabled.value) return;
  if (props.workbenchTabId) shell.keepTab(props.workbenchTabId);
  showAssemblyMaintenanceDialog.value = true;
}
function onAssemblyMaintenanceLog(event: { message: string; problem: boolean }) {
  shell.appendLog(event.message, { source: "file_detail", open: event.problem });
}
async function onAssemblyPublished(event: { filePath: string; outputRel: string }) {
  let normalizedSource: string, normalizedOutput: string;
  try { normalizedSource = normalizeAssemblyUpdateFilePath(rel.value); normalizedOutput = normalizeAssemblyUpdateFilePath(event.outputRel);
    if (normalizeAssemblyUpdateFilePath(event.filePath) !== normalizedSource) return;
  } catch { return; }
  if (disposed) return;
  const workspace = shell.workspacePath.value, sourceRel = rel.value;
  notifyXrefMutation(sourceRel);
  if (event.outputRel !== sourceRel) notifyXrefMutation(event.outputRel);
  shell.requestTreeRescan(event.outputRel);
  await reloadFile(sourceRel);
  if (disposed || workspace !== shell.workspacePath.value || sourceRel !== rel.value) return;
  await refreshXrefCounts();
  if (disposed || workspace !== shell.workspacePath.value || sourceRel !== rel.value) return;
  shell.setStatus(normalizedOutput === normalizedSource ? "当前宿主更新已发布；详情与派生缓存已重新读取，完整 BOM 状态以索引提示为准。"
    : `已生成验证副本 ${event.outputRel}；原宿主未改写，完整 BOM 状态以索引提示为准。`);
}
watch([rel, () => shell.workspacePath.value], () => { showAssemblyMaintenanceDialog.value = false; }, { flush: "sync" });
function onOperationChange(source: string, busy: boolean) {
  detailOperations.value = { ...detailOperations.value, [source]: busy };
  if (busy && props.workbenchTabId) shell.keepTab(props.workbenchTabId);
}
const thumbnailGeneration = useThumbnailGeneration(shell.workspacePath, rel, thumbnailRevision, {
  disabled: () => loading.value || showRenameDialog.value || hasUnsavedEdits() || Object.values(detailOperations.value).some(Boolean),
  operation: busy => onOperationChange("thumbnail", busy),
  log: (message, error) => shell.appendLog(`[缩略图] ${message}`, { source: "file_detail", open: error }),
});
/** 已写入属性但未改盘符时的目标文件名（按 repo_rel 缓存） */
const filenameDraftByRel = ref<Record<string, string>>({});
let reloadSeq = 0;
let xrefCountsSeq = 0;
let bootstrapDone = false;
let disposed = false;

function rememberFilenameDraft(filename: string, relPath?: string) {
  const r = (relPath ?? rel.value).trim();
  const name = filename.trim();
  if (!r || !name) return;
  filenameDraftByRel.value = { ...filenameDraftByRel.value, [r]: name };
}

function applyFilenameDraft(relPath: string) {
  const draft = filenameDraftByRel.value[relPath.trim()]?.trim();
  if (!draft) return;
  form.value = { ...form.value, filename: draft };
}

function applyXrefCountsFromPreview(data: BomPreview) {
  const counts = data.xref_counts;
  if (!counts) {
    incomingCount.value = 0;
    outgoingCount.value = 0;
    return;
  }
  incomingCount.value = counts.direct_incoming_count;
  outgoingCount.value = counts.outgoing_count;
}

const showAssemblyTab = computed(() => {
  if (!preview.value?.is_fcstd) return false;
  if (outgoingCount.value > 0) return true;
  if (preview.value.xref_counts?.outgoing_count) return true;
  if (preview.value.document_kinds?.assembly) return true;
  return /\.assy\.fcstd$/i.test(rel.value);
});

const { editSubTabLabel } = useDrawingBomReadonly(preview);

function invalidateXrefCache(relPath?: string) {
  const key = (relPath ?? rel.value).trim();
  if (!key) return;
  const next = { ...xrefCacheByRel.value };
  delete next[key];
  xrefCacheByRel.value = next;
}

function invalidateAssemblyCache(relPath?: string) {
  const prefix = `${(relPath ?? rel.value).trim()}|`;
  if (prefix === "|") return;
  const next = { ...assemblyCacheByKey.value };
  for (const k of Object.keys(next)) {
    if (k.startsWith(prefix)) delete next[k];
  }
  assemblyCacheByKey.value = next;
}

const xrefMutationSeq = ref(0);

function notifyXrefMutation(relPath?: string) {
  invalidateXrefCache(relPath);
  invalidateAssemblyCache(relPath);
  xrefMutationSeq.value += 1;
}

async function refreshXrefCounts() {
  const seq = ++xrefCountsSeq;
  const queryRel = rel.value;
  const workspace = shell.workspacePath.value;
  if (!rel.value.trim()) {
    incomingCount.value = 0;
    outgoingCount.value = 0;
    return;
  }
  try {
    const counts = await fetchBomXrefCounts(queryRel);
    if (seq !== xrefCountsSeq || queryRel !== rel.value || workspace !== shell.workspacePath.value) return;
    incomingCount.value = counts.direct_incoming_count;
    outgoingCount.value = counts.outgoing_count;
    if (preview.value) preview.value = { ...preview.value, xref_counts: counts, xref_index_pending: counts.index_pending };
  } catch (error) {
    if (seq !== xrefCountsSeq || queryRel !== rel.value || workspace !== shell.workspacePath.value) return;
    pageError.value = `引用计数读取失败：${String(error)}`;
    shell.appendLog(pageError.value, { source: "file_detail", open: true });
  }
}

const showRenameDialog = ref(false);
const renameDialogTarget = ref("");

function triggerRename(target?: string) {
  renameDialogTarget.value = target?.trim() || "";
  showRenameDialog.value = true;
}

function switchSubTab(tab: FileDetailSubTab) {
  if (Object.values(detailOperations.value).some(Boolean)) {
    shell.setStatus("当前操作尚未完成，请完成或取消后再切换详情面板");
    return;
  }
  activeSubTab.value = tab;
}

async function reloadFile(targetRel?: string) {
  const path = (targetRel ?? rel.value).trim();
  if (!path) return;
  showAssemblyMaintenanceDialog.value = false;
  const prevRel = rel.value.trim();
  const seq = ++reloadSeq;
  const workspace = shell.workspacePath.value;
  const isCurrent = () => !disposed && seq === reloadSeq && workspace === shell.workspacePath.value;
  xrefCountsSeq++;
  thumbnailRel.value = path;
  thumbnailRevision.value++;
  loading.value = true;
  pageError.value = "";
  failedObjectReadRel.value = "";
  try {
    const data = await fetchBom(path, workspace);
    if (!isCurrent()) return;
    batchFileWorkspace.value = workspace;
    rel.value = path;
    if (props.workbenchTabId && prevRel && prevRel !== path) {
      shell.rerouteFileDetailTab(prevRel, path, props.workbenchTabId);
    }
    preview.value = data;
    const diskBasename = path.replace(/\\/g, "/").split("/").pop() || "";
    originalFilename.value = diskBasename;
    form.value = { ...data.fields };
    baseline.value = { ...data.fields };
    applyFilenameDraft(path);
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: originalFilename.value,
        subtitle: path,
      });
    }
    applyXrefCountsFromPreview(data);
    if (prevRel && prevRel !== path) invalidateAssemblyCache(prevRel);
    assemblyLabelEdits.value = false;
    if (props.workbenchTabId) {
      const tab = shell.getTab(props.workbenchTabId);
      if (tab) {
        tab.contextKey = path;
        tab.subtitle = path;
      }
      shell.scheduleWorkbenchSave();
    }
    shell.setStatus(data.embedded_warning ? `警告: ${data.embedded_warning}` : data.source_note);
    const jointIssues = data.assembly_joint_issues || [];
    if (jointIssues.length) {
      shell.appendLog(`[关节检查] ${path}：${jointIssues.length} 个连接端需确认；不自动猜接或删除 Joint。\n` +
        jointIssues.slice(0, 20).map(issue => `${issue.label}（${issue.object_name}）· ${issue.reference}：${assemblyJointIssueText(issue)}`).join("\n") +
        (jointIssues.length > 20 ? "\n其余问题见 Primary。" : ""), { source: "file_detail", open: true });
    }
  } catch (e) {
    if (!isCurrent()) return;
    pageError.value = String(e);
    preview.value = null;
    // A BOM/root-selection failure must not prevent an independent read-only
    // summary. Never synthesize a writable BomPreview from the failed read.
    batchFileWorkspace.value = workspace;
    rel.value = path;
    form.value = {};
    baseline.value = {};
    originalFilename.value = "";
    incomingCount.value = 0;
    outgoingCount.value = 0;
    if (/\.fcstd$/i.test(path)) failedObjectReadRel.value = path;
  } finally {
    if (isCurrent()) loading.value = false;
  }
}

watch(shell.workspacePath, () => {
  reloadSeq++;
  xrefCountsSeq++;
  loading.value = false;
  failedObjectReadRel.value = "";
  rel.value = "";
  thumbnailRel.value = "";
  thumbnailRevision.value++;
  preview.value = null;
  pageError.value = "";
  originalFilename.value = "";
  form.value = {};
  baseline.value = {};
  filenameDraftByRel.value = {};
  xrefCacheByRel.value = {};
  assemblyCacheByKey.value = {};
  assemblyLabelEdits.value = false;
  incomingCount.value = 0;
  outgoingCount.value = 0;
}, { flush: "sync" });

function hasUnsavedAttrs() {
  const keys = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
  for (const k of keys) {
    if (String(form.value[k] ?? "").trim() !== String(baseline.value[k] ?? "").trim()) return true;
  }
  return false;
}

function hasUnsavedEdits() {
  return hasUnsavedAttrs() || assemblyLabelEdits.value;
}

async function onRenameComplete(newRel: string, needsReview = false) {
  if (!needsReview) showRenameDialog.value = false;
  if (newRel && newRel !== rel.value) {
    await reloadFile(newRel);
  } else {
    await reloadFile();
  }
  notifyXrefMutation();
  await refreshXrefCounts();
}

function onAssemblyEditsChange(dirty: boolean) {
  assemblyLabelEdits.value = dirty;
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, hasUnsavedEdits());
}

watch(showAssemblyTab, (show) => {
  if (!show && activeSubTab.value === "assembly") {
    activeSubTab.value = DEFAULT_FILE_DETAIL_SUB_TAB;
  }
});

async function onTreeSelect(targetRel: string): Promise<boolean> {
  if (targetRel === rel.value) return true;
  shell.openFileDetailForRel(targetRel);
  return true;
}

function registerTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerPageMessages(props.workbenchTabId, (msg) => {
    if (msg.type === "tree:select-file") return onTreeSelect(msg.path);
  });
}

function unregisterTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerPageMessages(props.workbenchTabId, null);
}

function applyOpenPayload(): boolean {
  if (!props.workbenchTabId) return false;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const detail = payload?.fileDetail;
  const legacyRel = payload?.bomRel?.trim() || payload?.fileRename?.rel?.trim();
  const openRel = detail?.rel?.trim() || legacyRel;
  if (!openRel) return false;
  if (detail?.subTab) activeSubTab.value = normalizeFileDetailSubTab(detail.subTab);
  if (detail?.preferredNewFilename) renameDialogTarget.value = detail.preferredNewFilename;
  if (payload?.fileRename?.form) {
    form.value = { ...payload.fileRename.form };
    baseline.value = { ...(payload.fileRename.baseline ?? payload.fileRename.form) };
  }
  void reloadFile(openRel);
  return true;
}

/** F5 / 会话恢复：pageState → Tab.contextKey（仓库相对路径） */
async function restoreFromWorkbenchTab() {
  if (!props.workbenchTabId) return;
  if (rel.value.trim() && preview.value) return;
  if (loading.value) return;

  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    await hydratePageSession(pageState);
    if (rel.value.trim()) return;
  }

  const tab = shell.getTab(props.workbenchTabId);
  if (tab?.pageId !== "file_detail" && tab?.pageId !== "bom_apply") return;
  const fallbackRel = (tab.contextKey || tab.subtitle || "").trim();
  if (!fallbackRel || fallbackRel === rel.value) return;
  void reloadFile(fallbackRel);
}

async function bootstrapFileDetail() {
  const openedFromPayload = applyOpenPayload();
  if (!bootstrapDone) {
    bootstrapDone = true;
    if (!openedFromPayload) await restoreFromWorkbenchTab();
  }
  registerTreeHandler();
}

provideFileDetailContext({
  rel,
  preview,
  form,
  baseline,
  originalFilename,
  loading,
  pageError,
  activeSubTab,
  incomingCount,
  outgoingCount,
  switchSubTab,
  triggerRename,
  reloadFile,
  refreshXrefCounts,
  xrefCacheByRel,
  invalidateXrefCache,
  assemblyCacheByKey,
  invalidateAssemblyCache,
  xrefMutationSeq,
  notifyXrefMutation,
  rememberFilenameDraft,
});

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V) return false;
  if (snap.subTab) activeSubTab.value = normalizeFileDetailSubTab(snap.subTab);
  const savedRel = String(snap.rel ?? "").trim();
  if (!savedRel) return false;
  const drafts = snap.filenameDraftByRel;
  if (drafts && typeof drafts === "object" && !Array.isArray(drafts)) {
    filenameDraftByRel.value = { ...(drafts as Record<string, string>) };
  }
  form.value = { ...(snap.form as Partial<BomFields>) };
  baseline.value = { ...(snap.baseline as Partial<BomFields>) };
  await reloadFile(savedRel);
  return true;
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    rel: rel.value,
    subTab: activeSubTab.value,
    form: form.value,
    baseline: baseline.value,
    filenameDraftByRel: { ...filenameDraftByRel.value },
  }),
  hydrate: hydratePageSession,
  isDirty: hasUnsavedEdits,
  isBusy: () => showRenameDialog.value || Object.values(detailOperations.value).some(Boolean),
});

watch([rel, form, baseline, activeSubTab, filenameDraftByRel], () => shell.scheduleWorkbenchSave(), {
  deep: true,
});

watch(
  () => hasUnsavedEdits(),
  (dirty) => {
    if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, dirty);
  },
  { immediate: true },
);

// Entering the rename workflow owns state even before the first field edit.
watch(showRenameDialog, (open) => {
  if (open && props.workbenchTabId) shell.keepTab(props.workbenchTabId);
}, { flush: "sync" });

usePagePrimaryContribution("file_detail", props.workbenchTabId, {
  thumbnail,
  thumbnailGeneration: computed(() => preview.value?.is_fcstd && !preview.value.document_kinds?.drawing ? thumbnailGeneration.value : null),
  summary: computed(() => rel.value
    ? `${originalFilename.value || rel.value} · 入向 ${incomingCount.value} · 出向 ${outgoingCount.value}`
    : "请从工作空间树选择文件"),
  sections: computed<PagePrimarySection[]>(() => [
    ...(hasAssemblyTools.value ? [{
      id: "assembly-tools", title: "装配工具", actionLayout: "grid" as const,
      description: "子装配增删后父总成显示未更新，可先检查。\n检查只读已保存文件；不切换 Rigid、不删除或猜接 Joint。",
      actions: [
        { id: "assembly-maintenance", label: "检查 / 更新装配", tone: "primary" as const,
          disabled: assemblyToolsDisabled, run: openAssemblyMaintenance },
        { id: "assembly-references", label: "查看引用", disabled: loading, run: () => switchSubTab("xref") },
      ],
    }] : []),
    {
      id: "document",
      title: "当前文件",
      controls: [
        { id: "name", kind: "readonly", label: "文件", value: computed(() => originalFilename.value || "—"), mono: true },
        { id: "path", kind: "readonly", label: "路径", value: computed(() => rel.value || "—"), mono: true },
        {
          id: "view",
          kind: "choice",
          label: "中央内容",
          modelValue: activeSubTab,
          options: [
            { value: "overview", label: "属性" },
            ...(preview.value?.is_fcstd ? [{ value: "drawing", label: "出图" }] : []),
            ...(preview.value?.is_fcstd ? [{ value: "objects", label: "对象信息" }] : []),
            { value: "edit", label: editSubTabLabel.value },
            { value: "xref", label: `引用（${incomingCount.value + outgoingCount.value}）` },
            ...(showAssemblyTab.value ? [{ value: "assembly", label: "装配结构" }] : []),
          ],
          onUpdate: (value) => switchSubTab(normalizeFileDetailSubTab(value)),
        },
        { id: "incoming", kind: "readonly", label: "被引用", value: incomingCount },
        { id: "outgoing", kind: "readonly", label: "出向引用", value: outgoingCount },
        { id: "index-state", kind: "readonly", label: "索引状态", value: computed(() => cadIndexReadStateLabel(preview.value?.xref_counts)) },
        { id: "dirty", kind: "readonly", label: "未保存", value: computed(() => hasUnsavedEdits() ? "是" : "否") },
      ],
      actions: [
        { id: "batch-add", label: "加入批次", disabled: computed(() => !rel.value || loading.value || batchFileWorkspace.value !== shell.workspacePath.value), run: addCurrentFileToBatch },
        {
          id: "reload",
          label: "重新载入",
          loading,
          disabled: computed(() => !rel.value),
          run: () => reloadFile(),
        },
        {
          id: "rename",
          label: "改名",
          tone: "primary",
          disabled: computed(() => !rel.value || !originalFilename.value),
          run: () => triggerRename(),
        },
      ],
    },
    ...assemblyRigidPrimary(preview.value),
    ...(activeSubTab.value === "assembly" ? [{
      id: "assembly-help", title: "装配标签说明",
      description: "显示磁盘中的真实节点标签。\n推荐取目标零件显示名；同级重复件按树序加 .001 起编号。\n点击数量展开实例；悬停行可撤销或应用。\n推荐仅填入草稿，应用才写盘。\n只改当前总成标签，不改引用路径或源文件。\n目标文件为最终零件；经由总成见悬浮提示。",
    }] : []),
  ]),
});

onMounted(() => {
  void bootstrapFileDetail();
});

onActivated(() => {
  pageActive.value = true;
  if (bootstrapDone) applyOpenPayload();
  registerTreeHandler();
});
onDeactivated(() => { pageActive.value = false; showAssemblyMaintenanceDialog.value = false; });

onUnmounted(() => {
  disposed = true;
  reloadSeq++;
  xrefCountsSeq++;
  unregisterTreeHandler();
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, false);
});
</script>

<template>
  <PageLayout title="文件详情" class="desk-page-layout" :body-inset="false" :body-scroll="false">
    <template #header>
      <PageHeader title="文件详情">
        <template #center>
          <el-radio-group
            v-if="rel && preview"
            :model-value="activeSubTab"
            size="small"
            class="sub-tabs"
            aria-label="文件详情内容"
            data-tour-page-filedetail-tabs
            @change="switchSubTab($event as FileDetailSubTab)"
          >
            <el-radio-button value="overview">属性</el-radio-button>
            <el-radio-button v-if="preview.is_fcstd" value="drawing">出图</el-radio-button>
            <el-radio-button v-if="preview.is_fcstd" value="objects">对象信息</el-radio-button>
            <el-radio-button value="edit">{{ editSubTabLabel }}</el-radio-button>
            <el-radio-button value="xref">
              引用
              <span v-if="incomingCount + outgoingCount" class="tab-badge">{{ incomingCount + outgoingCount }}</span>
            </el-radio-button>
            <el-radio-button v-if="showAssemblyTab" value="assembly">装配结构</el-radio-button>
          </el-radio-group>
        </template>
        <template #right>
          <el-button v-if="hasAssemblyTools" size="small" :disabled="assemblyToolsDisabled" @click="openAssemblyMaintenance">装配工具</el-button>
          <el-button v-if="rel" size="small" :disabled="loading || batchFileWorkspace !== shell.workspacePath.value" @click="addCurrentFileToBatch">加入批次</el-button>
          <el-button v-if="batchCollectionCount" size="small" @click="shell.goToPage('batch_tasks')">批量任务 · 待选 {{ batchCollectionCount }}</el-button>
          <el-button
            v-if="rel"
            size="small"
            type="primary"
            plain
            :disabled="!originalFilename"
            @click="triggerRename()"
          >
            改名
          </el-button>
        </template>
      </PageHeader>
    </template>
    <PageMainBlock class="file-detail-page desk-page-body--fill">
      <el-alert v-if="pageError" type="error" :title="pageError" show-icon :closable="false" class="err-alert" />

      <div v-if="!rel && !loading" class="empty">在树中选择 .FCStd</div>
      <div v-else-if="loading && !preview" class="empty">载入中…</div>

      <section v-else-if="failedObjectReadRel && !preview" class="file-detail-readonly-fallback" aria-label="独立只读摘要">
        <p>{{ failedObjectReadRel }}：常规属性读取失败；仍可尝试独立摘要。此处不提供属性写入或改名。</p>
        <CadObjectInfoPanel :key="failedObjectReadRel" :workspace-path="shell.workspacePath.value" :file-path="failedObjectReadRel" :active="pageActive" initial-mode="light" />
      </section>

      <template v-else-if="rel && preview">
        <div class="file-detail-content" data-tour-page-filedetail-body>
        <DrawingBomReadonlyBanner :preview="preview" :show-open-button="true" />
        <div class="sub-panel" :class="{ 'sub-panel--assembly': activeSubTab === 'assembly' }">
          <FileDrawingPanel v-if="activeSubTab === 'drawing'" :key="rel" />
          <CadObjectInfoPanel v-if="activeSubTab === 'objects' && preview.is_fcstd" :key="rel" :workspace-path="shell.workspacePath.value" :file-path="rel" :active="pageActive && activeSubTab === 'objects'" />
          <FileOverviewPanel v-show="activeSubTab === 'overview'" />
          <FileAttributesPanel v-show="activeSubTab === 'edit'" @busy-change="onOperationChange('attributes', $event)" />
          <FileXrefPanel v-if="activeSubTab === 'xref'" :key="rel" @busy-change="onOperationChange('xref', $event)" />
          <FileAssemblyPanel
            v-show="activeSubTab === 'assembly'"
            @edits-change="onAssemblyEditsChange"
            @busy-change="onOperationChange('assembly', $event)"
          />
          <RenameDialog
            :open="showRenameDialog"
            :rel="rel"
            :original-filename="originalFilename"
            :preferred-new-filename="renameDialogTarget"
            :form="form"
            :baseline="baseline"
            :bom-readonly="preview?.bom_readonly"
            @close="showRenameDialog = false"
            @renamed="onRenameComplete"
          />
          <AssemblyMaintenanceDialog
            v-if="showAssemblyMaintenanceDialog && pageActive"
            :open="showAssemblyMaintenanceDialog"
            :workspace-path="shell.workspacePath.value"
            :file-path="rel"
            @close="showAssemblyMaintenanceDialog = false"
            @busy-change="onOperationChange('assembly-maintenance', $event)"
            @log="onAssemblyMaintenanceLog"
            @published="onAssemblyPublished"
          />
        </div>
        </div>
      </template>
    </PageMainBlock>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";

.file-detail-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.empty {
  padding: 32px 0;
  color: var(--muted);
}

.sub-tabs {
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.tab-badge {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 0.68rem;
  background: #e0e7ff;
  color: #3730a3;
  vertical-align: middle;
}

.err-alert {
  margin-bottom: 10px;
}

.sub-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.sub-panel--assembly { display: flex; flex-direction: column; overflow: hidden; }

.mono {
  font-family: var(--font-mono);
}
</style>
