<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import type { BomFields, BomPreview } from "../api";
import { fetchBom, fetchBomXrefIncoming, fetchBomXrefOutgoing } from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import FileOverviewPanel from "../components/file-detail/FileOverviewPanel.vue";
import FileAttributesPanel from "../components/file-detail/FileAttributesPanel.vue";
import FileXrefPanel from "../components/file-detail/FileXrefPanel.vue";
import FileAssemblyPanel from "../components/file-detail/FileAssemblyPanel.vue";
import FileRenamePanel from "../components/file-detail/FileRenamePanel.vue";
import { provideFileDetailContext } from "../composables/useFileDetailContext";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import { promptChoice } from "../composables/choiceDialog";
import type { FileDetailSubTab } from "../types/fileDetail";
import { normalizeFileDetailSubTab } from "../types/fileDetail";

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
const preferredRenameFilename = ref("");
const assemblyLabelEdits = ref(false);
/** 已写入属性但未改盘符时的目标文件名（按 repo_rel 缓存） */
const filenameDraftByRel = ref<Record<string, string>>({});

const fileName = computed(() => rel.value.split("/").pop() ?? "");

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

const showAssemblyTab = computed(() => {
  if (!preview.value?.is_fcstd) return false;
  if (outgoingCount.value > 0) return true;
  if (preview.value.document_kinds?.assembly) return true;
  return /\.assy\.fcstd$/i.test(rel.value);
});

async function refreshXrefCounts() {
  if (!rel.value.trim()) {
    incomingCount.value = 0;
    outgoingCount.value = 0;
    return;
  }
  try {
    const [inc, out] = await Promise.all([
      fetchBomXrefIncoming({ rel: rel.value, transitive: true, limit: 500 }),
      fetchBomXrefOutgoing(rel.value, 500),
    ]);
    incomingCount.value = inc.count;
    outgoingCount.value = out.count;
  } catch {
    incomingCount.value = 0;
    outgoingCount.value = 0;
  }
}

function openRenameTab(target?: string): boolean {
  const disk = originalFilename.value.trim();
  const fromForm = (form.value.filename ?? "").trim();
  const next = (target ?? fromForm).trim();
  if (!next) {
    pageError.value = "请先填写或「推荐」生成目标文件名";
    return false;
  }
  preferredRenameFilename.value = next;
  activeSubTab.value = "rename";
  pageError.value = "";
  return true;
}

function switchSubTab(tab: FileDetailSubTab) {
  if (tab === "rename") {
    openRenameTab();
    return;
  }
  activeSubTab.value = tab;
}

async function reloadFile(targetRel?: string) {
  const path = (targetRel ?? rel.value).trim();
  if (!path) return;
  const prevRel = rel.value.trim();
  loading.value = true;
  pageError.value = "";
  try {
    const data = await fetchBom(path);
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
    await refreshXrefCounts();
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
    pageError.value = String(e);
    preview.value = null;
  } finally {
    loading.value = false;
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
  const choice = await promptChoice({
    title: "切换文件",
    message: `「${name}」有尚未写入的${hint}。\n\n要打开「${next}」？`,
    choices: [
      { id: "discard", label: "放弃修改并切换", variant: "danger" },
      { id: "cancel", label: "取消切换" },
    ],
  });
  return choice === "discard";
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
  shell.registerTreeSelect(props.workbenchTabId, (path) => onTreeSelect(path));
}

function unregisterTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerTreeSelect(props.workbenchTabId, null);
}

function applyOpenPayload() {
  if (!props.workbenchTabId) return;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const detail = payload?.fileDetail;
  const legacyRel = payload?.bomRel?.trim() || payload?.fileRename?.rel?.trim();
  const openRel = detail?.rel?.trim() || legacyRel;
  if (!openRel) return;
  if (detail?.subTab) activeSubTab.value = normalizeFileDetailSubTab(detail.subTab);
  if (detail?.preferredNewFilename) preferredRenameFilename.value = detail.preferredNewFilename;
  if (payload?.fileRename?.form) {
    form.value = { ...payload.fileRename.form };
    baseline.value = { ...(payload.fileRename.baseline ?? payload.fileRename.form) };
  }
  void reloadFile(openRel);
}

/** F5 / 会话恢复：pageState → Tab.contextKey（仓库相对路径） */
async function restoreFromWorkbenchTab() {
  if (!props.workbenchTabId) return;
  if (rel.value.trim() && preview.value) return;

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
  openRenameTab,
  reloadFile,
  refreshXrefCounts,
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

onMounted(() => {
  applyOpenPayload();
  void restoreFromWorkbenchTab();
  registerTreeHandler();
});

onActivated(() => {
  applyOpenPayload();
  void restoreFromWorkbenchTab();
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
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">文件详情</h1>
        <h2 v-if="rel && preview" class="file-name mono">{{ fileName }}</h2>
        <div class="head-help">
          <PageHelpButton page-id="file_detail" />
        </div>
      </div>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <div v-if="!rel && !loading" class="empty">在右侧工作空间树中选择 .FCStd 文件</div>
    <div v-else-if="loading && !preview" class="empty">载入中…</div>

    <template v-else-if="rel && preview">
      <div data-tour-page-filedetail-body>
      <nav class="sub-tabs" role="tablist" data-tour-page-filedetail-tabs>
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ active: activeSubTab === 'overview' }"
          @click="switchSubTab('overview')"
        >
          属性
        </button>
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ active: activeSubTab === 'edit' }"
          @click="switchSubTab('edit')"
        >
          编辑属性
        </button>
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ active: activeSubTab === 'xref' }"
          @click="switchSubTab('xref')"
        >
          引用
          <span v-if="incomingCount + outgoingCount" class="tab-badge">{{ incomingCount + outgoingCount }}</span>
        </button>
        <button
          v-if="showAssemblyTab"
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ active: activeSubTab === 'assembly' }"
          @click="switchSubTab('assembly')"
        >
          装配结构
        </button>
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ active: activeSubTab === 'rename' }"
          @click="switchSubTab('rename')"
        >
          改名
        </button>
      </nav>

      <div class="sub-panel">
        <FileOverviewPanel v-show="activeSubTab === 'overview'" />
        <FileAttributesPanel v-show="activeSubTab === 'edit'" />
        <FileXrefPanel v-show="activeSubTab === 'xref'" />
        <FileAssemblyPanel
          v-show="activeSubTab === 'assembly'"
          @edits-change="onAssemblyEditsChange"
        />
        <FileRenamePanel
          v-show="activeSubTab === 'rename'"
          :workbench-tab-id="workbenchTabId"
          :preferred-filename="preferredRenameFilename"
          @renamed="refreshXrefCounts()"
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

.file-detail-page .head-row {
  justify-content: space-between;
  width: 100%;
}

.file-name {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  text-align: right;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 32px 0;
  color: var(--muted);
}

.sub-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0;
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
  overflow: auto;
}

.banner.err {
  padding: 8px 12px;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.85rem;
  margin-bottom: 10px;
}

.mono {
  font-family: var(--font-mono);
}
</style>
