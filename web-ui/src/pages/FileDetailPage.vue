<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import type { BomFields, BomPreview } from "../api";
import { fetchBom, fetchBomXrefCounts } from "../api";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import FileOverviewPanel from "../components/file-detail/FileOverviewPanel.vue";
import FileAttributesPanel from "../components/file-detail/FileAttributesPanel.vue";
import FileXrefPanel from "../components/file-detail/FileXrefPanel.vue";
import FileAssemblyPanel from "../components/file-detail/FileAssemblyPanel.vue";
import RenameDialog from "../components/RenameDialog.vue";
import DrawingBomReadonlyBanner from "../components/file-detail/DrawingBomReadonlyBanner.vue";
import { provideFileDetailContext } from "../composables/useFileDetailContext";
import { useDrawingBomReadonly } from "../composables/useDrawingBomReadonly";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import { pnwPromptChoice } from "phoenix-wing";
import type { FileDetailSubTab } from "../types/fileDetail";
import { normalizeFileDetailSubTab } from "../types/fileDetail";
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
const preview = ref<BomPreview | null>(null);
const form = ref<Partial<BomFields>>({});
const baseline = ref<Partial<BomFields>>({});
const originalFilename = ref("");
const loading = ref(false);
const pageError = ref("");
const activeSubTab = ref<FileDetailSubTab>("overview");
const incomingCount = ref(0);
const outgoingCount = ref(0);
const xrefCacheByRel = ref<Record<string, import("../api").FileDetailXrefsPayload>>({});
const assemblyCacheByKey = ref<Record<string, import("../api").AssemblyTreeNode[]>>({});
const assemblyLabelEdits = ref(false);
/** 已写入属性但未改盘符时的目标文件名（按 repo_rel 缓存） */
const filenameDraftByRel = ref<Record<string, string>>({});
let reloadSeq = 0;
let bootstrapDone = false;

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
  if (!rel.value.trim()) {
    incomingCount.value = 0;
    outgoingCount.value = 0;
    return;
  }
  try {
    const counts = await fetchBomXrefCounts(rel.value);
    incomingCount.value = counts.direct_incoming_count;
    outgoingCount.value = counts.outgoing_count;
  } catch {
    incomingCount.value = 0;
    outgoingCount.value = 0;
  }
}

const showRenameDialog = ref(false);
const renameDialogTarget = ref("");

function triggerRename(target?: string) {
  renameDialogTarget.value = target?.trim() || "";
  showRenameDialog.value = true;
}

function switchSubTab(tab: FileDetailSubTab) {
  activeSubTab.value = tab;
}

async function reloadFile(targetRel?: string) {
  const path = (targetRel ?? rel.value).trim();
  if (!path) return;
  const prevRel = rel.value.trim();
  const seq = ++reloadSeq;
  loading.value = true;
  pageError.value = "";
  try {
    const data = await fetchBom(path);
    if (seq !== reloadSeq) return;
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
  } catch (e) {
    if (seq !== reloadSeq) return;
    pageError.value = String(e);
    preview.value = null;
  } finally {
    if (seq === reloadSeq) loading.value = false;
  }
}

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

async function confirmSwitchFile(targetRel: string): Promise<boolean> {
  if (!rel.value || targetRel === rel.value) return true;
  if (!hasUnsavedEdits()) return true;
  const name = rel.value.split("/").pop() ?? "当前文件";
  const next = targetRel.split("/").pop() ?? targetRel;
  const hint = assemblyLabelEdits.value ? "链接标签或属性" : "属性";
  const choice = await pnwPromptChoice({
    title: "切换文件",
    message: `「${name}」有尚未写入的${hint}。\n\n要打开「${next}」？`,
    choices: [
      { id: "discard", label: "放弃修改并切换", variant: "danger" },
      { id: "cancel", label: "取消切换" },
    ],
  });
  return choice.choiceId === "discard";
}

async function onRenameComplete(newRel: string) {
  showRenameDialog.value = false;
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
    activeSubTab.value = "overview";
  }
});

async function onTreeSelect(targetRel: string): Promise<boolean> {
  if (targetRel === rel.value) return true;
  if (!(await confirmSwitchFile(targetRel))) return false;
  activeSubTab.value = "overview";
  await reloadFile(targetRel);
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

usePagePrimaryContribution("file_detail", props.workbenchTabId, {
  summary: computed(() => rel.value
    ? `${originalFilename.value || rel.value} · 入向 ${incomingCount.value} · 出向 ${outgoingCount.value}`
    : "请从工作空间树选择文件"),
  sections: computed<PagePrimarySection[]>(() => [
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
            { value: "edit", label: editSubTabLabel.value },
            { value: "xref", label: `引用（${incomingCount.value + outgoingCount.value}）` },
            ...(showAssemblyTab.value ? [{ value: "assembly", label: "装配结构" }] : []),
          ],
          onUpdate: (value) => switchSubTab(normalizeFileDetailSubTab(value)),
        },
        { id: "incoming", kind: "readonly", label: "被引用", value: incomingCount },
        { id: "outgoing", kind: "readonly", label: "出向引用", value: outgoingCount },
        { id: "dirty", kind: "readonly", label: "未保存", value: computed(() => hasUnsavedEdits() ? "是" : "否") },
      ],
      actions: [
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
  ]),
});

onMounted(() => {
  void bootstrapFileDetail();
});

onActivated(() => {
  if (bootstrapDone) applyOpenPayload();
  registerTreeHandler();
});
onDeactivated(() => {});

onUnmounted(() => {
  unregisterTreeHandler();
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, false);
});
</script>

<template>
  <div class="page file-detail-page">
    <PageHeader title="文件详情" page-id="file_detail">
      <template #actions>
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

    <el-alert v-if="pageError" type="error" :title="pageError" show-icon :closable="false" class="err-alert" />

    <div v-if="!rel && !loading" class="empty">在树中选择 .FCStd</div>
    <div v-else-if="loading && !preview" class="empty">载入中…</div>

    <template v-else-if="rel && preview">
      <div data-tour-page-filedetail-body>
      <DrawingBomReadonlyBanner :preview="preview" :show-open-button="true" />
      <el-radio-group
        :model-value="activeSubTab"
        size="small"
        class="sub-tabs"
        data-tour-page-filedetail-tabs
        @change="switchSubTab($event as FileDetailSubTab)"
      >
        <el-radio-button value="overview">属性</el-radio-button>
        <el-radio-button value="edit">{{ editSubTabLabel }}</el-radio-button>
        <el-radio-button value="xref">
          引用
          <span v-if="incomingCount + outgoingCount" class="tab-badge">{{ incomingCount + outgoingCount }}</span>
        </el-radio-button>
        <el-radio-button v-if="showAssemblyTab" value="assembly">装配结构</el-radio-button>
      </el-radio-group>

      <div class="sub-panel">
        <FileOverviewPanel v-show="activeSubTab === 'overview'" />
        <FileAttributesPanel v-show="activeSubTab === 'edit'" />
        <FileXrefPanel v-if="activeSubTab === 'xref'" :key="rel" />
        <FileAssemblyPanel
          v-show="activeSubTab === 'assembly'"
          @edits-change="onAssemblyEditsChange"
        />
        <RenameDialog
          :open="showRenameDialog"
          :rel="rel"
          :original-filename="originalFilename"
          :preferred-new-filename="renameDialogTarget"
          :form="form"
          :baseline="baseline"
          @close="showRenameDialog = false"
          @renamed="onRenameComplete"
        />
      </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.file-detail-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  height: 100%;
  overflow: hidden;
  padding: 16px 20px;
}

.empty {
  padding: 32px 0;
  color: var(--muted);
}

.sub-tabs {
  margin-bottom: 12px;
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

.mono {
  font-family: var(--font-mono);
}
</style>
