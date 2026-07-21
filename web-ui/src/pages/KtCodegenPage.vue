<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { ktCodegenBlockKeysForPreset } from "@phoenix-wing/kt-codegen";
import {
  ktCodegenDefineTableElement,
  type KtCodegenTableChangeDetail,
  type KtCodegenTableDirtyChangeDetail,
  type KtCodegenTable,
} from "@phoenix-wing/kt-codegen/table";
import KtCodegenSidebar from "../components/codegen/KtCodegenSidebar.vue";
import KtCodegenBottomContent from "../components/codegen/KtCodegenBottomContent.vue";
import { useAppShell } from "../composables/useAppShell";
import { usePageSummary } from "../composables/usePageSummary";
import { usePagePrimaryContribution } from "../composables/usePagePrimaryContribution";
import {
  useWorkbenchBottomContribution,
  useWorkbenchBottomPanelState,
  type WorkbenchBottomContributionTab,
} from "../composables/useWorkbenchBottomContribution";
import { usePageSession } from "../composables/usePageSession";
import { useKtCodegenPagePropertySheet } from "../composables/useKtCodegenPagePropertySheet";
import { createKtCodegenPageParam } from "../models/ktCodegenPageParam";
import { deriveKtCodegenPlanPresentation } from "../models/ktCodegenPlanPresentation";
import { useKtCodegenStore } from "../stores/ktCodegen";
import {
  buildKtCodegenSessionSnapshot,
  decideKtCodegenDraftRestore,
  parseKtCodegenSessionSnapshot,
} from "../utils/ktCodegenSession";

ktCodegenDefineTableElement();

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const store = useKtCodegenStore(props.workbenchTabId);
usePagePrimaryContribution("kt_codegen", props.workbenchTabId, {
  content: { component: KtCodegenSidebar },
});
const {
  active,
  applying,
  dirty,
  externalChange,
  opening,
  preflight,
  preflighting,
  problems,
  problemTone,
  recoveryConflict,
  saving,
  selectedBlockKeys,
  status,
  lastApply,
} = storeToRefs(store);
const tableRef = ref<KtCodegenTable | null>(null);
const tableItemCount = ref(0);
let draftHeartbeat: ReturnType<typeof setInterval> | null = null;
let externalPoll: ReturnType<typeof setInterval> | null = null;
let bootstrapDone = false;
const bottomPanel = useWorkbenchBottomPanelState();
const totalBlockCount = ktCodegenBlockKeysForPreset("all").length;
const boundDocumentPath = computed(() => {
  if (!props.workbenchTabId) return "";
  return shell.getTab(props.workbenchTabId)?.contextKey?.trim() ?? "";
});

const pageParam = computed(() => createKtCodegenPageParam({
  status: status.value,
  document: active.value
    ? {
        fileName: active.value.file_name,
        path: active.value.path,
        namePrefix: active.value.param.namePrefix,
        nameMiddle: active.value.param.nameMiddle,
        format: active.value.format,
        encoding: active.value.encoding,
        rowCount: tableItemCount.value,
      }
    : null,
  dirty: dirty.value,
  hasRecoveryConflict: Boolean(recoveryConflict.value),
  hasExternalChange: Boolean(externalChange.value),
  selectedBlockCount: selectedBlockKeys.value.length,
  totalBlockCount,
  preflighting: preflighting.value,
  preflight: preflight.value
    ? {
        safeToApply: preflight.value.safe_to_apply,
        planCanApply: preflight.value.plan.canApply,
        regionCount: preflight.value.plan.markerRegions.length,
        artifactCount: preflight.value.plan.artifacts.length,
        diagnosticCount: preflight.value.plan.diagnostics.length,
      }
    : null,
  applying: applying.value,
  lastApply: lastApply.value
    ? { fileCount: lastApply.value.files.length, regionCount: lastApply.value.region_count }
    : null,
}));
const {
  view: pageView,
  register: registerPropertiesSheet,
  unregister: unregisterPropertiesSheet,
} = useKtCodegenPagePropertySheet(pageParam);
const className = computed(() => pageView.value.className === "—" ? "" : pageView.value.className);
const encodingLabel = computed(() => pageView.value.encoding === "—" ? "" : pageView.value.encoding);
const planPresentation = computed(() => deriveKtCodegenPlanPresentation(preflight.value));
const bottomTabs = computed<readonly WorkbenchBottomContributionTab[]>(() => [
  { id: "preflight", label: "预检", count: preflight.value?.plan.markerRegions.length ?? 0 },
  { id: "problems", label: "问题", count: problems.value.length, tone: problemTone.value },
]);
const bottomSummary = computed(() => {
  if (applying.value) return "正在写回源码…";
  if (lastApply.value) return `已写回 ${lastApply.value.files.length} 文件 / ${lastApply.value.region_count} 区域`;
  if (!preflight.value) return "全局保留预检、问题与运行日志";
  return `${preflight.value.plan.artifacts.length} 个 Artifact · ${planPresentation.value.label}`;
});
useWorkbenchBottomContribution("kt_codegen", props.workbenchTabId, {
  sourceLabel: computed(() => active.value?.file_name ?? "KT Codegen"),
  summary: bottomSummary,
  tabs: bottomTabs,
  component: KtCodegenBottomContent,
  props: { workbenchTabId: props.workbenchTabId ?? "" },
});
const summary = computed(() => pageView.value.summary);

usePageSummary(summary);

function bindTable(): void {
  if (!active.value || !tableRef.value) return;
  tableRef.value.setData(active.value.table);
  tableItemCount.value = active.value.table.items.length;
  tableRef.value.setStatus("idle", "");
}

watch(active, (document) => {
  void nextTick(bindTable);
  if (props.workbenchTabId && document) {
    shell.updateTab(props.workbenchTabId, {
      title: document.file_name,
      subtitle: document.path,
      contextKey: document.path,
      dirty: dirty.value || Boolean(recoveryConflict.value),
    });
  }
  shell.scheduleWorkbenchSave();
});

watch(boundDocumentPath, (path) => {
  if (bootstrapDone && path && active.value?.path !== path) void openBoundDocument(path);
});

function updateDraftHeartbeat(value: boolean): void {
  if (draftHeartbeat) {
    clearInterval(draftHeartbeat);
    draftHeartbeat = null;
  }
  if (!value) return;
  draftHeartbeat = setInterval(() => shell.scheduleWorkbenchSave(), 5_000);
}

watch(dirty, (value) => {
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, value);
  updateDraftHeartbeat(value || Boolean(recoveryConflict.value));
  shell.scheduleWorkbenchSave();
}, { immediate: true });
watch(recoveryConflict, (value) => {
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, dirty.value || Boolean(value));
  updateDraftHeartbeat(dirty.value || Boolean(value));
  shell.scheduleWorkbenchSave();
});
watch(selectedBlockKeys, () => shell.scheduleWorkbenchSave(), { deep: true });
watch(status, (message) => tableRef.value?.setStatus(
  planPresentation.value.tone === "error" ? "error" : "idle",
  message,
));
watch(
  () => shell.workspacePath.value,
  () => {
    store.reset();
    void store.discover().catch((error) => shell.setStatus(String(error)));
  },
);

function onTableDirty(event: Event): void {
  const detail = (event as CustomEvent<KtCodegenTableDirtyChangeDetail>).detail;
  if (detail?.dirty) {
    store.markDirty(detail.itemCount);
    shell.scheduleWorkbenchSave();
  }
}

function onTableChange(event: Event): void {
  const detail = (event as CustomEvent<KtCodegenTableChangeDetail>).detail;
  const table = tableRef.value?.getData();
  tableItemCount.value = typeof detail?.itemCount === "number"
    ? detail.itemCount
    : (table?.items.length ?? tableItemCount.value);
  // KeepAlive 淘汰 View 时仍把最新草稿留在该 Tab 的独立 store 中。
  if (active.value && table) {
    active.value.table = table;
    active.value.item_count = tableItemCount.value;
  }
  // dirty-change 只在 clean/dirty 跃迁时触发；change 必须在每次编辑后使旧预检失效。
  store.markDirty(tableItemCount.value);
  shell.scheduleWorkbenchSave();
}

function appendKtLog(
  text: string,
  options: { tab?: "preflight" | "problems" | "output"; expand?: boolean } = {},
): void {
  shell.appendLog(text, { source: "kt_codegen", open: false });
  if (options.tab) bottomPanel.setActiveTab(options.tab);
  if (options.expand) void shell.setLogOpen(true);
}

function currentTable() {
  return tableRef.value?.getData() ?? active.value?.table ?? null;
}

async function save(): Promise<boolean> {
  const table = currentTable();
  if (!table) return false;
  try {
    const document = await store.save(table);
    if (document) {
      await nextTick();
      bindTable();
      shell.setStatus(store.status);
      shell.scheduleWorkbenchSave();
      return true;
    }
    shell.setStatus(store.status);
    return false;
  } catch (error) {
    tableRef.value?.setStatus("error", String(error));
    shell.setStatus(String(error));
    return false;
  }
}

async function revert(): Promise<void> {
  if (!active.value) return;
  if (dirty.value) {
    const choice = await pnwPromptChoice({
      title: "还原 Codegen 配置",
      message: `放弃 ${active.value.file_name} 尚未保存的表格与文档属性修改？`,
      defaultChoiceId: "cancel",
      choices: [
        { id: "cancel", label: "取消" },
        { id: "confirm", label: "从磁盘还原", variant: "danger" },
      ],
    });
    if (choice.choiceId !== "confirm") return;
  }
  try {
    await store.revert();
    await nextTick();
    bindTable();
    shell.setStatus("已从磁盘还原 Codegen 配置");
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function runPreflight(): Promise<boolean> {
  const table = currentTable();
  if (!table) return false;
  store.clearRuntimeProblems("预检");
  bottomPanel.setActiveTab("preflight");
  void shell.setLogOpen(true);
  tableRef.value?.setStatus("idle", "正在扫描工作空间控制标记…");
  appendKtLog(`[KT Codegen] 预检 ${active.value?.path ?? ""}…`);
  try {
    const result = await store.runPreflight(table);
    if (!result) return false;
    const cacheSuffix = result.reused ? "；复用指纹缓存" : "";
    const sourceCacheSuffix = result.source_cache_hits
      ? `；源文件缓存 ${result.source_cache_hits}/${result.source_cache_hits + result.source_files_read}`
      : "";
    const scanSuffix = result.source_scan_byte_limit_reached
      ? "；源码快照已达 64 MiB 上限，Apply 已关闭"
      : result.source_scan_truncated ? "；源码扫描已达 5000 文件上限，Apply 已关闭" : "";
    const message = `${result.candidate_file_count} 个候选文件，${result.plan.markerRegions.length} 个区域，${result.plan.artifacts.length} 个产物，${result.plan.diagnostics.length} 条诊断${cacheSuffix}${sourceCacheSuffix}${scanSuffix}`;
    appendKtLog(`[KT Codegen] ${message}`);
    for (const diagnostic of result.plan.diagnostics) {
      appendKtLog(`[KT Codegen][${diagnostic.severity}] ${diagnostic.code}：${diagnostic.message}`);
    }
    tableRef.value?.setStatus(
      !result.safe_to_apply && result.plan.diagnostics.some((item) => item.severity === "error")
        ? "error"
        : "idle",
      message,
    );
    if (result.plan.diagnostics.some((item) => item.severity === "error")) bottomPanel.setActiveTab("problems");
    shell.setStatus(message);
    return true;
  } catch (error) {
    tableRef.value?.setStatus("error", String(error));
    store.reportRuntimeProblem("预检", "host.preflight-failed", error);
    appendKtLog(`[KT Codegen] 预检失败：${String(error)}`, { tab: "output", expand: true });
    bottomPanel.setActiveTab("problems");
    shell.setStatus(String(error));
    return false;
  }
}

function cancelPreflight(): void {
  store.cancelPreflight();
  tableRef.value?.setStatus("idle", store.status);
  appendKtLog("[KT Codegen] 用户取消预检", { tab: "output", expand: true });
  shell.setStatus(store.status);
}

async function applySource(): Promise<void> {
  const table = currentTable();
  if (!table) return;
  store.clearRuntimeProblems("Apply");
  appendKtLog(
    preflight.value
      ? "[KT Codegen][Apply] 写回前重新校验配置、控制符、源码与计划指纹…"
      : "[KT Codegen][Apply] 当前没有预检，先自动预检…",
    { tab: "output", expand: true },
  );
  if (!await runPreflight()) return;
  const result = preflight.value;
  if (!result) return;
  const plan = result.plan;
  if (!result.safe_to_apply) {
    bottomPanel.setActiveTab("problems");
    shell.setStatus("预检未通过安全 Apply 门禁；未修改源码");
    appendKtLog("[KT Codegen][Apply] 安全门禁未通过，未修改源码", { tab: "problems", expand: true });
    return;
  }
  bottomPanel.setActiveTab("output");
  appendKtLog(`[KT Codegen][Apply] 开始写回 ${plan.markerRegions.length} 个区域…`);
  try {
    const applied = await store.apply(table);
    if (!applied) return;
    store.clearRuntimeProblems("Apply");
    appendKtLog(`[KT Codegen][Apply] 成功：${applied.files.length} 个文件，${applied.region_count} 个区域；临时文件复读与最终写回复读均通过`);
    for (const file of applied.files) {
      appendKtLog(`[KT Codegen][Apply] ${file.path} · ${file.region_count} 区域 · ${file.encoding.toUpperCase()} · ${file.eol.toUpperCase()} · ${file.bytes_before}→${file.bytes_after} bytes`);
    }
    for (const diagnostic of applied.diagnostics) {
      appendKtLog(`[KT Codegen][Apply][${diagnostic.severity}] ${diagnostic.code}：${diagnostic.message}`);
    }
    shell.setStatus(store.status);
  } catch (error) {
    store.reportRuntimeProblem("Apply", "host.apply-failed", error);
    appendKtLog(`[KT Codegen][Apply] 失败：${String(error)}`, { tab: "output", expand: true });
    bottomPanel.setActiveTab("problems");
    shell.setStatus(String(error));
  }
}

async function hydratePageSession(raw: Record<string, unknown>): Promise<boolean> {
  const snapshot = parseKtCodegenSessionSnapshot(raw);
  if (!snapshot) return false;
  store.setSelectedBlocks(snapshot.selectedBlockKeys);
  if (!snapshot.path) return true;

  try {
    const document = await store.open(snapshot.path);
    const decision = decideKtCodegenDraftRestore(snapshot, document.fingerprint);
    if (decision === "restore" && snapshot.draft) {
      if (!store.restoreDraft(snapshot.draft.param, snapshot.draft.table)) {
        store.status = "会话草稿结构不兼容，已打开磁盘版本";
      }
    } else if (decision === "conflict" && snapshot.draft) {
      store.rememberRecoveryConflict({
        path: snapshot.path,
        snapshotFingerprint: snapshot.fingerprint,
        diskFingerprint: document.fingerprint,
        param: snapshot.draft.param,
        table: snapshot.draft.table,
      });
    }
    await nextTick();
    bindTable();
    shell.setStatus(store.status);
    return true;
  } catch (error) {
    shell.setStatus(`Codegen 会话恢复失败：${String(error)}`);
    return true;
  }
}

async function writeClipboardText(text: string): Promise<void> {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    // 浏览器拒绝 Clipboard API 时退回同步复制。
  }
  if (!copied) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    copied = document.execCommand("copy");
    textarea.remove();
  }
  if (!copied) throw new Error("当前运行环境未允许剪贴板写入");
}

async function copyRecoveryDraft(): Promise<void> {
  const conflict = recoveryConflict.value;
  if (!conflict) return;
  try {
    await writeClipboardText(JSON.stringify({
      path: conflict.path,
      base_fingerprint: conflict.snapshotFingerprint,
      disk_fingerprint: conflict.diskFingerprint,
      param: conflict.param,
      table: conflict.table,
    }, null, 2));
    shell.setStatus("旧 Codegen 草稿已复制到剪贴板，可用于手动合并");
  } catch (error) {
    shell.setStatus(`复制旧草稿失败：${String(error)}`);
  }
}

async function copyCurrentDraft(): Promise<void> {
  const document = active.value;
  const table = currentTable();
  if (!document || !table) return;
  try {
    await writeClipboardText(JSON.stringify({
      path: document.path,
      base_fingerprint: document.fingerprint,
      detected_disk_fingerprint: externalChange.value?.fingerprint ?? "",
      param: document.param,
      table,
    }, null, 2));
    shell.setStatus("当前 Codegen 草稿已复制，可在重载磁盘版本后手动合并");
  } catch (error) {
    shell.setStatus(`复制当前草稿失败：${String(error)}`);
  }
}

async function discardRecoveryDraft(): Promise<void> {
  const choice = await pnwPromptChoice({
    title: "放弃冲突草稿",
    message: "确认丢弃会话中保留的旧 Codegen 草稿，继续使用当前磁盘版本？",
    defaultChoiceId: "cancel",
    choices: [
      { id: "cancel", label: "取消" },
      { id: "confirm", label: "放弃旧草稿", variant: "danger" },
    ],
  });
  if (choice.choiceId !== "confirm") return;
  store.clearRecoveryConflict();
  shell.setStatus("已放弃旧 Codegen 草稿，保留当前磁盘版本");
  shell.scheduleWorkbenchSave();
}

async function flushPageSession(): Promise<boolean> {
  if (recoveryConflict.value) {
    shell.setStatus("旧 Codegen 草稿与磁盘冲突；请先复制或明确放弃草稿");
    return false;
  }
  return save();
}

usePageSession(props.workbenchTabId, {
  serialize: () => buildKtCodegenSessionSnapshot({
    active: active.value,
    dirty: dirty.value,
    selectedBlockKeys: selectedBlockKeys.value,
    table: currentTable(),
    recoveryConflict: recoveryConflict.value,
  }),
  hydrate: hydratePageSession,
  isDirty: () => dirty.value || Boolean(recoveryConflict.value),
  flush: flushPageSession,
});

function registerTreeOpen(): void {
  shell.registerTreeSelect(props.workbenchTabId, (rel) => {
    if (!/\.(json|csv)$/i.test(rel)) return false;
    shell.openKtCodegenDocument(rel);
    return true;
  });
}

async function openBoundDocument(path: string): Promise<void> {
  if (!path || active.value?.path === path || opening.value) return;
  try {
    const document = await store.open(path);
    if (active.value?.path !== document.path) return;
    await nextTick();
    bindTable();
    shell.setStatus(`已打开 Codegen 配置：${document.path}`);
  } catch (error) {
    shell.setStatus(String(error));
  }
}

async function bootstrapPage(): Promise<void> {
  if (bootstrapDone) return;
  bootstrapDone = true;
  registerTreeOpen();
  const pageState = props.workbenchTabId
    ? shell.consumeTabPageState(props.workbenchTabId)
    : undefined;
  if (pageState) await hydratePageSession(pageState);
  if (boundDocumentPath.value && active.value?.path !== boundDocumentPath.value) {
    await openBoundDocument(boundDocumentPath.value);
  }
  if (!store.documents.length) {
    await store.discover().catch((error) => shell.setStatus(String(error)));
  }
  await nextTick();
  bindTable();
}

function stopExternalPoll(): void {
  if (externalPoll) clearInterval(externalPoll);
  externalPoll = null;
}

function startExternalPoll(): void {
  stopExternalPoll();
  void store.checkExternalChange();
  void store.checkPreflightSourceChanges();
  externalPoll = setInterval(() => {
    void store.checkExternalChange();
    void store.checkPreflightSourceChanges();
  }, 5_000);
}

onMounted(() => {
  registerPropertiesSheet();
  void bootstrapPage();
  startExternalPoll();
});
onActivated(() => {
  registerPropertiesSheet();
  registerTreeOpen();
  startExternalPoll();
});
onDeactivated(stopExternalPoll);
onUnmounted(() => {
  unregisterPropertiesSheet();
  shell.registerTreeSelect(props.workbenchTabId, null);
  if (draftHeartbeat) clearInterval(draftHeartbeat);
  draftHeartbeat = null;
  stopExternalPoll();
});
</script>

<template>
  <div class="page tool-page codegen-page">
    <PageHeader title="KT Codegen" page-id="kt_codegen">
      <template #actions>
        <template v-if="active">
          <div class="document-title" :title="active.path">
            <strong>{{ active.file_name }}<span v-if="dirty"> *</span></strong>
            <small>{{ className || "未命名" }} · {{ encodingLabel }}</small>
          </div>
          <el-button v-if="preflighting" size="small" :disabled="opening || saving || applying || Boolean(recoveryConflict)" @click="cancelPreflight">取消预检</el-button>
          <el-button v-else size="small" :disabled="opening || saving || applying || Boolean(recoveryConflict)" @click="runPreflight">预检</el-button>
          <el-button
            size="small"
            :loading="applying"
            :disabled="opening || preflighting || saving || Boolean(recoveryConflict)"
            @click="applySource"
          >Apply 源码</el-button>
          <span class="toolbar-divider" aria-hidden="true" />
          <el-button
            size="small"
            :disabled="opening || saving || applying || Boolean(recoveryConflict) || (!dirty && !externalChange)"
            @click="revert"
          >还原</el-button>
          <el-button
            type="primary"
            size="small"
            :loading="saving"
            :disabled="opening || preflighting || applying || Boolean(recoveryConflict)"
            @click="save"
          >
            保存{{ active.format === "legacy-17-column-csv" ? " CSV" : " JSON" }}
          </el-button>
        </template>
      </template>
    </PageHeader>

    <section v-if="recoveryConflict" class="recovery-banner" role="alert">
      <div>
        <strong>旧草稿未自动恢复</strong>
        <span>
          {{ recoveryConflict.path }} 的磁盘内容已在会话外变化。当前显示磁盘版本，旧草稿仍被保留。
        </span>
      </div>
      <el-button size="small" @click="copyRecoveryDraft">复制草稿 JSON</el-button>
      <el-button size="small" type="danger" plain @click="discardRecoveryDraft">放弃草稿</el-button>
    </section>
    <section v-else-if="externalChange" class="external-change-banner" role="alert">
      <div>
        <strong>{{ externalChange.exists ? "磁盘文件已在外部修改" : "磁盘文件已被删除" }}</strong>
        <span>当前 View 与未保存草稿仍保留；保存使用指纹保护，不会静默覆盖外部版本。</span>
      </div>
      <el-button size="small" @click="copyCurrentDraft">复制当前草稿</el-button>
      <el-button size="small" :disabled="!externalChange.exists" @click="revert">从磁盘重载</el-button>
    </section>

    <div v-if="opening && !active" class="empty-view">正在打开 Codegen 配置…</div>
    <div v-else-if="!active" class="empty-view">
      <div class="empty-card">
        <strong>从左侧 Block 选择 Codegen 配置</strong>
        <p>也可以保持本页激活，在工作空间树中点击旧 v4 JSON 或 17 列 CSV。</p>
        <p>表格、Reader、Adapter、Analyze 和 Renderer 均直接消费 Phoenix Wing。</p>
      </div>
    </div>

    <div
      v-else
      class="editor-layout"
      :inert="opening || saving || applying || Boolean(recoveryConflict) || undefined"
      :aria-busy="opening || saving || applying"
    >
      <kt-codegen-table
        ref="tableRef"
        class="parameter-table"
        layout="page"
        collapsible
        @kt-codegen-table-dirty-change="onTableDirty"
        @kt-codegen-table-change="onTableChange"
      />
    </div>
  </div>
</template>

<style scoped>
.codegen-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.recovery-banner {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  color: #92400e;
  background: color-mix(in srgb, #f59e0b 13%, var(--panel-head-bg));
  border-bottom: 1px solid color-mix(in srgb, #f59e0b 45%, var(--border));
  font-size: 0.7rem;
}

.recovery-banner div { flex: 1 1 auto; min-width: 0; }
.recovery-banner strong,
.recovery-banner span { display: block; }
.recovery-banner span { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.external-change-banner {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  color: #b91c1c;
  background: color-mix(in srgb, #dc2626 10%, var(--panel-head-bg));
  border-bottom: 1px solid color-mix(in srgb, #dc2626 38%, var(--border));
  font-size: 0.7rem;
}
.external-change-banner div { flex: 1 1 auto; min-width: 0; }
.external-change-banner strong,
.external-change-banner span { display: block; }
.external-change-banner span { margin-top: 2px; }

.document-title { min-width: 150px; max-width: 260px; margin-right: 4px; }
.document-title strong,
.document-title small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.document-title strong { font-size: 0.78rem; }
.document-title small { color: var(--muted); font-size: 0.66rem; }

.editor-layout {
  display: block;
  flex: 1 1 auto;
  min-height: 0;
  padding: 0;
  overflow: auto;
}

.parameter-table { width: 100%; min-height: 0; height: auto; }
.empty-view { display: grid; flex: 1 1 auto; min-height: 0; place-items: center; padding: 24px; }
.empty-card { max-width: 520px; padding: 28px; text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: 8px; }
.empty-card strong { color: var(--text); }
.empty-card p { margin: 8px 0 0; font-size: 0.8rem; }
</style>
