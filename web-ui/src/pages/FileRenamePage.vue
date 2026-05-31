<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import type { BomFields, BomPreview, RefScanPayload, RenameLog } from "../api";
import {
  analyzeRenameReferences,
  applyFileRenameRefs,
  applyRenameAnalysisCorrections,
  executeFileRename,
  exportRenameAnalysisReport,
  fetchFileRenameContext,
  fetchRenameLogs,
  loadRenameAnalysis,
  saveBom,
} from "../api";
import RenameAnalysisPanel from "../components/RenameAnalysisPanel.vue";
import XrefQuerySection from "../components/XrefQuerySection.vue";
import { useAppShell } from "../composables/useAppShell";
import { useIncomingRefQuery } from "../composables/useIncomingRefQuery";
import { usePageSession } from "../composables/usePageSession";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const incoming = useIncomingRefQuery(props.workbenchTabId, "file_rename");
const {
  queryText,
  pickedRel,
  clearPickedOnInput,
  applyTreeSelection,
  registerTreeSelectHandler,
  unregisterTreeSelectHandler,
  includeTransitive,
  resolveIncomingQuery,
  buildRenameAnalyzeParams,
  formatHostSummary,
  logIncoming,
  logIncomingStart,
  transitiveLabel,
  setStatus,
} = incoming;

const SESSION_V = 2;

type PanelMode = "manual" | "history";

const rel = ref("");
const originalFilename = ref("");
const newFilename = ref("");
const preview = ref<BomPreview | null>(null);
const form = ref<Partial<BomFields>>({});
const baseline = ref<Partial<BomFields>>({});
const renameLogId = ref<number | null>(null);
const renamed = ref(false);
const scan = ref<RefScanPayload | null>(null);
const selectedHosts = ref<Set<string>>(new Set());
const panelMode = ref<PanelMode>("history");
const newBasename = ref("");
const excludeRepoRel = ref("");
const renameLogs = ref<RenameLog[]>([]);
const syncReferenceLabels = ref(true);
const loading = ref(false);
const busy = ref(false);
const pageError = ref("");

const standaloneMode = computed(() => !rel.value);

const canApplyRefs = computed(() => {
  if (renameLogId.value != null) return true;
  if (standaloneMode.value) {
    if (panelMode.value === "history") return renameLogId.value != null;
    return Boolean(queryText.value.trim() && newBasename.value.trim());
  }
  const o = originalFilename.value.trim();
  const n = newFilename.value.trim();
  return Boolean(o && n && o !== n);
});

const canAnalyze = computed(() => {
  if (standaloneMode.value) {
    if (panelMode.value === "history") return renameLogId.value != null;
    return Boolean(queryText.value.trim());
  }
  if (renameLogId.value != null) return true;
  return Boolean(rel.value && originalFilename.value.trim());
});

const canRename = computed(() => {
  const n = newFilename.value.trim();
  return Boolean(rel.value && n && n !== originalFilename.value);
});

const isTargetFilenameDirty = computed(() => {
  if (renamed.value || !rel.value) return false;
  return newFilename.value.trim() !== originalFilename.value.trim();
});

function hasUnsavedDocumentAttrs() {
  const keys = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
  for (const k of keys) {
    const cur = String(form.value[k] ?? "").trim();
    const base = String(baseline.value[k] ?? "").trim();
    if (cur !== base) return true;
  }
  return false;
}

function hasPageDirty() {
  return hasUnsavedDocumentAttrs() || isTargetFilenameDirty.value;
}

function toggleHost(hostRel: string, checked: boolean) {
  const next = new Set(selectedHosts.value);
  if (checked) next.add(hostRel);
  else next.delete(hostRel);
  selectedHosts.value = next;
}

function toggleAll(checked: boolean) {
  if (!scan.value) return;
  if (checked) {
    selectedHosts.value = new Set(
      scan.value.hosts.filter(hostPending).map((h) => h.host_repo_rel_path),
    );
  } else {
    selectedHosts.value = new Set();
  }
}

function hitNeedsFix(hit: { status: string; proposed_text?: string; matched_text?: string }) {
  if (hit.status === "applied" || hit.status === "ok") return false;
  return hit.proposed_text !== hit.matched_text;
}

function chainPendingHits(
  host: { host_repo_rel_path: string; host_filename: string; via_chain?: string[]; hits: Array<{ status: string; proposed_text?: string; matched_text?: string }> },
  all: Array<{ host_repo_rel_path: string; host_filename: string; via_chain?: string[]; hits: Array<{ status: string; proposed_text?: string; matched_text?: string }> }>,
) {
  const chain = new Set((host.via_chain ?? []).map((p) => p.replace(/\\/g, "/")));
  return all.filter((h) => chain.has(h.host_repo_rel_path.replace(/\\/g, "/")) && h.hits.some(hitNeedsFix));
}

function hostPending(h: {
  hits: Array<{ status: string; proposed_text?: string; matched_text?: string }>;
  depth?: number;
  via_chain?: string[];
  host_repo_rel_path?: string;
  host_filename?: string;
}) {
  if (h.hits.some(hitNeedsFix)) return true;
  if (!scan.value) return false;
  return chainPendingHits(h as Parameters<typeof chainPendingHits>[0], scan.value.hosts).length > 0;
}

function selectPendingHosts() {
  if (!scan.value) return;
  selectedHosts.value = new Set(
    scan.value.hosts.filter(hostPending).map((h) => h.host_repo_rel_path),
  );
}

async function loadLogs() {
  try {
    const data = await fetchRenameLogs(50);
    renameLogs.value = data.entries;
  } catch {
    renameLogs.value = [];
  }
}

async function applyAnalysisPayload(payload: {
  renameLogId?: number;
  oldBasename?: string;
  newBasename?: string;
  excludeRepoRel?: string;
  autoAnalyze?: boolean;
}) {
  if (payload.renameLogId != null) {
    panelMode.value = "history";
    renameLogId.value = payload.renameLogId;
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, { title: `改名 #${payload.renameLogId}` });
    }
    try {
      const data = await loadRenameAnalysis(payload.renameLogId);
      queryText.value = data.rename_log.old_basename;
      newBasename.value = data.rename_log.new_basename;
      scan.value = data.scan;
      selectPendingHosts();
    } catch (e) {
      pageError.value = String(e);
    }
    return;
  }
  panelMode.value = "manual";
  if (payload.oldBasename) queryText.value = payload.oldBasename;
  if (payload.newBasename) newBasename.value = payload.newBasename;
  if (payload.excludeRepoRel) excludeRepoRel.value = payload.excludeRepoRel;
  if (payload.autoAnalyze) await onScanRefs();
}

async function loadFileForRename(
  repoRel: string,
  opts?: {
    form?: Partial<BomFields>;
    baseline?: Partial<BomFields>;
    preferredNewFilename?: string;
  },
) {
  const targetRel = repoRel.trim();
  if (!targetRel) return;

  loading.value = true;
  pageError.value = "";
  try {
    const data = await fetchFileRenameContext(targetRel);
    rel.value = targetRel;
    preview.value = data.preview;
    originalFilename.value = data.preview.fields.filename || targetRel.split("/").pop() || "";
    newFilename.value = opts?.preferredNewFilename?.trim() || originalFilename.value;
    if (opts?.form) {
      form.value = { ...opts.form };
      baseline.value = { ...(opts.baseline ?? opts.form) };
    } else {
      form.value = { ...data.preview.fields };
      baseline.value = { ...form.value };
    }
    renamed.value = false;
    renameLogId.value = null;
    scan.value = null;
    selectedHosts.value = new Set();
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: originalFilename.value,
        subtitle: targetRel,
      });
    }
    shell.setStatus(`已选文件：${originalFilename.value}`);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function confirmSwitchFile(targetRel: string): Promise<boolean> {
  if (!rel.value || targetRel === rel.value) return true;
  const name = rel.value.split("/").pop() ?? "当前文件";
  const next = targetRel.split("/").pop() ?? targetRel;
  const hasDraft =
    hasUnsavedDocumentAttrs() ||
    (!renamed.value && newFilename.value.trim() !== originalFilename.value.trim()) ||
    Boolean(scan.value);
  if (!hasDraft) return true;
  return window.confirm(
    `「${name}」有未完成的改名或分析。\n\n确定切换为「${next}」？\n（未保存内容将丢失）`,
  );
}

async function onTreeSelect(repoRel: string) {
  if (standaloneMode.value && panelMode.value === "manual") {
    applyTreeSelection(repoRel);
    pageError.value = "";
    await onScanRefs();
    return;
  }
  if (repoRel === rel.value) return;
  if (!(await confirmSwitchFile(repoRel))) return;
  await loadFileForRename(repoRel);
}

function registerTreeHandler() {
  registerTreeSelectHandler(onTreeSelect);
}

function unregisterTreeHandler() {
  unregisterTreeSelectHandler();
}

async function loadFromPending() {
  const tabPayload = props.workbenchTabId
    ? shell.consumeTabPayload(props.workbenchTabId)
    : undefined;
  if (tabPayload?.renameAnalysis) {
    await applyAnalysisPayload(tabPayload.renameAnalysis);
    return;
  }
  const pending = tabPayload?.fileRename;
  if (!pending?.rel) return;

  if (props.workbenchTabId) {
    shell.updateTab(props.workbenchTabId, {
      title: pending.rel.split("/").pop() ?? pending.rel,
      subtitle: pending.rel,
    });
  }
  await loadFileForRename(pending.rel, {
    form: pending.form,
    baseline: pending.baseline,
    preferredNewFilename: String(pending.form.filename ?? "").trim() || undefined,
  });
}

async function onRename() {
  if (!rel.value || !canRename.value) return;
  let writeAttrsFirst = false;
  if (hasUnsavedDocumentAttrs()) {
    if (
      !window.confirm(
        `有尚未写入文件的属性。\n\n是否先写入 Document.xml，再重命名？\n\n${originalFilename.value}\n    ↓\n${newFilename.value.trim()}\n\n请确认 FreeCAD 等已关闭占用。`,
      )
    ) {
      shell.setStatus("改名已取消");
      return;
    }
    writeAttrsFirst = true;
  } else if (
    !window.confirm(
      `将重命名磁盘文件：\n\n${originalFilename.value}\n    ↓\n${newFilename.value.trim()}\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  try {
    const payload = {
      ...form.value,
      filename: newFilename.value.trim(),
    };
    const data = await executeFileRename(rel.value, payload, baseline.value, { writeAttrsFirst });
    renamed.value = true;
    renameLogId.value = data.rename_log_id ?? data.rename_log?.id ?? null;
    rel.value = data.rel_path;
    originalFilename.value = data.filename;
    form.value = { ...form.value, filename: data.filename };
    baseline.value = { ...form.value };
    scan.value = null;
    selectedHosts.value = new Set();
    shell.requestTreeRescan(data.rel_path);
    const parts = [
      data.attrs_saved ? "已写入属性" : null,
      `已重命名为 ${data.filename}`,
      data.map_updated ? "已更新索引库" : null,
    ].filter(Boolean);
    shell.setStatus(parts.join(" · "));
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onScanRefs() {
  if (!canAnalyze.value) {
    const msg = standaloneMode.value
      ? panelMode.value === "manual"
        ? "请填写文件名（可部分），或在右侧树中点击文件"
        : "请选择改名记录"
      : "请先载入文件";
    pageError.value = msg;
    logIncoming(`取消：${msg}`);
    return;
  }
  busy.value = true;
  pageError.value = "";
  logIncoming(`开始扫描（${transitiveLabel()}）…`);
  const transitive = includeTransitive.value;
  try {
    let data: RefScanPayload;
    if (standaloneMode.value) {
      if (panelMode.value === "history" && renameLogId.value != null) {
        logIncoming(`模式=历史记录 #${renameLogId.value}`, { open: false });
        data = await analyzeRenameReferences(
          buildRenameAnalyzeParams({ basename: "" }, {
            renameLogId: renameLogId.value,
            newBasename: "",
            transitive,
            persist: true,
          }),
        );
      } else {
        const q = resolveIncomingQuery();
        if (!q) {
          pageError.value = "请填写文件名（可部分），或在右侧树中点击文件";
          logIncoming("取消：未指定目标文件");
          return;
        }
        logIncomingStart(q, "分析");
        data = await analyzeRenameReferences(
          buildRenameAnalyzeParams(q, {
            newBasename: newBasename.value,
            excludeRepoRel: excludeRepoRel.value,
            transitive,
            persist: false,
          }),
        );
      }
    } else if (renameLogId.value != null) {
      logIncoming(`已载入文件 · 记录 #${renameLogId.value}`, { open: false });
      data = await analyzeRenameReferences(
        buildRenameAnalyzeParams({ basename: "" }, {
          renameLogId: renameLogId.value,
          newBasename: "",
          transitive,
          persist: true,
        }),
      );
    } else {
      const old = originalFilename.value.trim();
      const neu = newFilename.value.trim() || old;
      const targetRel = rel.value.trim() || undefined;
      logIncoming(`basename=${old}${targetRel ? ` · 路径=${targetRel}` : ""}`, { open: false });
        data = await analyzeRenameReferences(
          buildRenameAnalyzeParams(
            { basename: old },
            {
              newBasename: neu,
              oldRepoRel: targetRel,
              transitive,
              persist: false,
            },
          ),
        );
    }
    scan.value = data;
    selectPendingHosts();
    const summary = formatHostSummary({
      hostCount: data.host_count,
      directHostCount: data.direct_host_count ?? data.host_count,
      hitCount: data.hit_count,
      pendingHitCount: data.pending_hit_count ?? data.hit_count,
      mode: "analyze",
    });
    logIncoming(summary);
    setStatus(summary);
  } catch (e) {
    const msg = String(e);
    pageError.value = msg;
    logIncoming(`失败：${msg}`);
    setStatus(`引用分析失败：${msg}`);
  } finally {
    busy.value = false;
  }
}

async function onApplyRefs() {
  const hosts = [...selectedHosts.value];
  if (!hosts.length) {
    pageError.value = "请勾选至少一个宿主文件";
    return;
  }
  if (!canApplyRefs.value) {
    pageError.value = "请先执行改名或填写有效的旧名/新名";
    return;
  }
  if (
    !window.confirm(
      `将修正 ${hosts.length} 个宿主文件内的 XLink${syncReferenceLabels.value ? "，并同步装配树引用名（Label）" : ""}。\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  try {
    if (standaloneMode.value) {
      const data = await applyRenameAnalysisCorrections(hosts, {
        renameLogId: panelMode.value === "history" ? (renameLogId.value ?? undefined) : undefined,
        oldBasename:
          scan.value?.old_basename ??
          (panelMode.value === "manual" ? queryText.value.trim() : undefined),
        newBasename:
          scan.value?.new_basename ??
          (panelMode.value === "manual" ? newBasename.value.trim() : undefined),
        targetRepoRel: pickedRel.value.trim() || undefined,
        transitive: includeTransitive.value,
        syncReferenceLabels: syncReferenceLabels.value,
      });
      scan.value = data.scan;
      selectPendingHosts();
      if (data.failed.length) {
        shell.appendLog(
          data.failed.map((f) => `${f.host_repo_rel_path}: ${f.error}`).join("\n"),
          { source: "file_rename" },
        );
      }
      shell.setStatus(
        `已修正 ${data.applied_hosts.length} 个宿主 · ${data.xlink_patches} 处 XLink` +
          (data.label_patches ? ` · ${data.label_patches} 处引用名` : "") +
          (data.failed.length ? ` · ${data.failed.length} 失败` : ""),
      );
    } else {
      const data = await applyFileRenameRefs(hosts, {
        renameLogId: renameLogId.value ?? undefined,
        oldBasename: scan.value?.old_basename ?? originalFilename.value.trim(),
        newBasename: scan.value?.new_basename ?? newFilename.value.trim(),
        targetRepoRel: rel.value.trim() || undefined,
        transitive: includeTransitive.value,
        syncReferenceLabels: syncReferenceLabels.value,
      });
      scan.value = data.scan;
      selectPendingHosts();
      if (data.failed.length) {
        shell.appendLog(
          data.failed.map((f) => `${f.host_repo_rel_path}: ${f.error}`).join("\n"),
          { source: "file_rename" },
        );
      }
      shell.setStatus(
        `已修正 ${data.applied_hosts.length} 个宿主 · ${data.xlink_patches} 处 XLink` +
          (data.label_patches ? ` · ${data.label_patches} 处引用名` : "") +
          (data.failed.length ? ` · ${data.failed.length} 失败` : ""),
      );
    }
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onExportReport() {
  if (!scan.value) return;
  busy.value = true;
  try {
    const out = await exportRenameAnalysisReport({
      scan: scan.value,
      rename_log_id: renameLogId.value ?? undefined,
    });
    shell.setStatus(`报告已写入 ${out.report_path_display}`);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  const v = snap.v;
  if (v !== SESSION_V && v !== 1) return false;

  rel.value = String(snap.rel ?? "");
  form.value = { ...(snap.form as Partial<BomFields>) };
  baseline.value = { ...(snap.baseline as Partial<BomFields>) };
  newFilename.value = String(snap.newFilename ?? "");
  originalFilename.value = String(snap.originalFilename ?? "");
  renamed.value = Boolean(snap.renamed);
  renameLogId.value = snap.renameLogId != null ? Number(snap.renameLogId) : null;
  if (Array.isArray(snap.selectedHosts)) {
    selectedHosts.value = new Set(snap.selectedHosts.map(String));
  }
  if (snap.scan && typeof snap.scan === "object") {
    scan.value = snap.scan as RefScanPayload;
  }
  if (v === SESSION_V) {
    panelMode.value = snap.panelMode === "manual" ? "manual" : "history";
    queryText.value = String(snap.oldBasename ?? "");
    newBasename.value = String(snap.newBasename ?? "");
    excludeRepoRel.value = String(snap.excludeRepoRel ?? "");
    if (snap.syncReferenceLabels != null) {
      syncReferenceLabels.value = Boolean(snap.syncReferenceLabels);
    }
  }

  if (!rel.value) return true;

  loading.value = true;
  pageError.value = "";
  try {
    const data = await fetchFileRenameContext(rel.value);
    preview.value = data.preview;
    if (!originalFilename.value) {
      originalFilename.value = data.preview.fields.filename || rel.value.split("/").pop() || "";
    }
    if (!newFilename.value) newFilename.value = originalFilename.value;
  } catch (e) {
    pageError.value = String(e);
  } finally {
    loading.value = false;
  }
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) return;
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  void loadFromPending();
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    rel: rel.value,
    form: form.value,
    baseline: baseline.value,
    newFilename: newFilename.value,
    originalFilename: originalFilename.value,
    renamed: renamed.value,
    renameLogId: renameLogId.value,
    scan: scan.value,
    selectedHosts: [...selectedHosts.value],
    panelMode: panelMode.value,
    oldBasename: queryText.value,
    newBasename: newBasename.value,
    excludeRepoRel: excludeRepoRel.value,
    syncReferenceLabels: syncReferenceLabels.value,
  }),
  hydrate: hydratePageSession,
  isDirty: hasPageDirty,
  flush: async () => {
    if (!hasUnsavedDocumentAttrs()) return true;
    if (!rel.value || renamed.value) return true;
    if (!preview.value?.is_fcstd) {
      pageError.value = "当前非 FCStd，无法写入属性";
      return false;
    }
    busy.value = true;
    pageError.value = "";
    try {
      await saveBom(rel.value, form.value);
      baseline.value = { ...form.value };
      shell.setStatus("已写入属性");
      return true;
    } catch (e) {
      pageError.value = String(e);
      return false;
    } finally {
      busy.value = false;
    }
  },
});

watch(
  () => hasPageDirty(),
  (dirty) => {
    if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, dirty);
  },
  { immediate: true },
);

watch(panelMode, () => {
  if (standaloneMode.value) {
    scan.value = null;
    selectedHosts.value = new Set();
  }
});

watch(renameLogId, (id) => {
  if (!standaloneMode.value || panelMode.value !== "history" || id == null) return;
  const row = renameLogs.value.find((e) => e.id === id);
  if (row) {
    queryText.value = row.old_basename;
    newBasename.value = row.new_basename;
  }
});

watch(
  [
    rel,
    form,
    baseline,
    newFilename,
    scan,
    selectedHosts,
    renamed,
    renameLogId,
    panelMode,
    queryText,
    newBasename,
    excludeRepoRel,
    syncReferenceLabels,
  ],
  () => shell.scheduleWorkbenchSave(),
  { deep: true },
);

onMounted(async () => {
  await loadLogs();
  applyInitialTabState();
  registerTreeHandler();
});

onActivated(() => {
  registerTreeHandler();
});

onDeactivated(() => {
  /* handler 保留在 Tab map 中，由 activeTabId 路由 */
});

onUnmounted(() => {
  unregisterTreeHandler();
});
</script>

<template>
  <div class="page rename-page">
    <header class="page-head">
      <h1 class="page-title">改名与引用</h1>
      <p class="page-desc">
        同一页完成：磁盘改名、XLink 引用分析与写回，以及只读引用查询。可从「属性回写」跳转，或在下方独立分析（不改名先扫引用）。
      </p>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <div v-if="loading" class="empty">载入中…</div>

    <!-- 无当前文件：独立分析 / 历史继续 -->
    <template v-else-if="standaloneMode">
      <p class="entry-hint">
        在右侧工作空间树中<strong>点击文件名</strong>开始改名（目标名默认与当前相同，再修改即可）；或从「属性回写」跳转。下方也可<strong>不改名</strong>先分析 XLink 影响。
      </p>

      <section class="input-mode">
        <label class="mode-opt">
          <input v-model="panelMode" type="radio" value="history" />
          从改名历史
        </label>
        <label class="mode-opt">
          <input v-model="panelMode" type="radio" value="manual" />
          手填旧名 / 新名
        </label>
      </section>

      <section v-if="panelMode === 'manual'" class="rename-fields">
        <span class="rename-label">旧文件名</span>
        <div class="rename-value-col">
          <input
            v-model="queryText"
            class="mono"
            spellcheck="false"
            placeholder="部分文件名即可；或右侧树点击自动分析"
            @input="clearPickedOnInput"
            @keydown.enter.prevent="onScanRefs"
          />
          <p v-if="pickedRel" class="picked-hint mono">已从树选择：{{ pickedRel }}</p>
        </div>
        <span class="rename-label">新文件名</span>
        <input v-model="newBasename" class="mono" spellcheck="false" placeholder="例如 new-child.FCStd" />
        <span class="rename-label">排除路径</span>
        <input
          v-model="excludeRepoRel"
          class="mono"
          spellcheck="false"
          placeholder="可选：改名后的文件路径，分析时跳过"
        />
      </section>

      <section v-else class="rename-fields history-pick">
        <span class="rename-label">改名记录</span>
        <div class="rename-value-col">
          <select v-model.number="renameLogId">
            <option :value="null">— 选择 —</option>
            <option v-for="row in renameLogs" :key="row.id" :value="row.id">
              #{{ row.id }} · {{ row.old_filename }} → {{ row.new_filename }} · {{ row.created_at }}
            </option>
          </select>
          <p v-if="!renameLogs.length" class="muted inline-hint">尚无改名记录；请先从属性回写跳转执行改名。</p>
        </div>
      </section>

      <section class="toolbar">
        <label class="chk-transitive">
          <input v-model="includeTransitive" type="checkbox" />
          含间接宿主（总装配等；勾选后写回子装配链上的 XLink 相对路径）
        </label>
        <button type="button" class="btn primary" :disabled="busy || !canAnalyze" @click="onScanRefs">
          {{ busy ? "…" : "开始分析" }}
        </button>
        <button type="button" class="btn" :disabled="busy" @click="loadLogs">刷新历史</button>
      </section>

      <RenameAnalysisPanel
        v-model:sync-reference-labels="syncReferenceLabels"
        :scan="scan"
        :selected-hosts="selectedHosts"
        :busy="busy"
        :can-apply="canApplyRefs"
        show-export
        @toggle-host="toggleHost"
        @toggle-all="toggleAll"
        @apply="onApplyRefs"
        @export-report="onExportReport"
      />
    </template>

    <!-- 已载入文件：改名 + 分析 -->
    <template v-else>
      <section class="file-block">
        <h2 class="mono file-name">{{ preview?.fields.filename || rel.split("/").pop() }}</h2>
        <p v-if="preview" class="meta">{{ preview.abs_path_display }}</p>
        <p v-if="renamed && renameLogId" class="meta ok">已改名 · 记录 #{{ renameLogId }}</p>
      </section>

      <section class="rename-fields rename-fields-marked">
        <span class="rename-mark" aria-hidden="true" />
        <span class="rename-label">当前文件名</span>
        <input :value="originalFilename" readonly class="readonly mono" />
        <span
          class="rename-mark"
          :class="{ dirty: isTargetFilenameDirty }"
          :aria-label="isTargetFilenameDirty ? '已修改' : undefined"
        >
          {{ isTargetFilenameDirty ? "●" : "" }}
        </span>
        <span class="rename-label">目标文件名</span>
        <input v-model="newFilename" class="mono" :readonly="renamed" spellcheck="false" />
      </section>

      <section class="toolbar">
        <button type="button" class="btn primary" :disabled="busy || renamed || !canRename" @click="onRename">
          {{ busy ? "…" : "执行改名" }}
        </button>
        <label class="chk-transitive">
          <input v-model="includeTransitive" type="checkbox" />
          含间接宿主（写回子装配链 XLink）
        </label>
        <button type="button" class="btn" :disabled="busy || !canAnalyze" @click="onScanRefs">分析引用</button>
      </section>

      <RenameAnalysisPanel
        v-model:sync-reference-labels="syncReferenceLabels"
        :scan="scan"
        :selected-hosts="selectedHosts"
        :busy="busy"
        :can-apply="canApplyRefs"
        show-export
        @toggle-host="toggleHost"
        @toggle-all="toggleAll"
        @apply="onApplyRefs"
        @export-report="onExportReport"
      />
    </template>

    <XrefQuerySection :incoming="incoming" embedded />

    <section class="help-panel">
      <h3 class="help-title">说明</h3>
      <ul class="help-list">
        <li>FreeCAD 每条 XLink 都记录相对路径；分析按<strong>文件名</strong>全库查找。间接宿主（总装配）勾选「修正选中引用」时，会写回经子装配链上待修正的 XLink。</li>
        <li>下方「引用查询」仅浏览入向/出向关系；要批量修正 XLink 请用上方「分析引用」与勾选写回。</li>
        <li>独立分析 · 手填模式：可输入<strong>部分文件名</strong>，或在右侧树点击后自动填入并分析。</li>
        <li>在右侧树中点击文件即可载入；目标文件名默认与当前相同。未改目标名也可「分析引用」查看谁在用此文件；修改后再执行改名。</li>
        <li>与「链接路径修正」不同：此处按<strong>已知旧名 → 新名</strong>替换 XLink 的 <code>file</code> 末尾 basename。</li>
        <li>已载入文件时，<strong>修正写回</strong>须先「执行改名」；独立分析模式可不改名先预览。</li>
        <li>扫描范围与工作空间 CAD 索引的扫描根一致；被改名的文件本身不会作为宿主。</li>
        <li>结构化结果在数据库；Markdown 报告需点「导出报告」才写盘。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.rename-page {
  padding: 20px 24px 24px;
  max-width: 920px;
  height: 100%;
  overflow: auto;
}

.page-head {
  margin-bottom: 12px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.page-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.55;
}

.entry-hint {
  margin: 0 0 12px;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.55;
}

.empty {
  padding: 32px 0;
  color: var(--muted);
}

.banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 10px;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
}

.input-mode {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 0.85rem;
}

.mode-opt {
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-block {
  margin-bottom: 12px;
}

.file-name {
  margin: 0 0 4px;
  font-size: 1rem;
}

.meta {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.meta.ok {
  color: #047857;
  margin-top: 4px;
}

.rename-fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 12px;
  row-gap: 8px;
  align-items: center;
  max-width: 560px;
  margin-bottom: 12px;
}

.rename-fields-marked {
  grid-template-columns: 1.25rem max-content minmax(0, 1fr);
}

.rename-mark {
  text-align: center;
  color: #c2410c;
  font-size: 1rem;
  line-height: 1.6rem;
}

.rename-mark.dirty {
  font-weight: 700;
}

.rename-fields.history-pick {
  align-items: start;
}

.rename-fields.history-pick .rename-label {
  padding-top: 8px;
}

.rename-label {
  font-size: 0.82rem;
  color: var(--muted);
  white-space: nowrap;
  text-align: right;
}

.rename-fields input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
  box-sizing: border-box;
}

.rename-fields input.readonly {
  background: #f3f4f6;
  color: var(--muted);
}

.rename-fields select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
  box-sizing: border-box;
}

.rename-value-col {
  min-width: 0;
}

.picked-hint {
  margin: 4px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.inline-hint {
  margin: 6px 0 0;
  font-size: 0.78rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
}

.chk-transitive {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--muted);
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
}

.muted {
  color: var(--muted);
  font-size: 0.85rem;
  grid-column: 1 / -1;
}

.help-panel {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.help-title {
  margin: 0 0 8px;
  font-size: 0.88rem;
}

.help-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.55;
}

.help-list li + li {
  margin-top: 6px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
