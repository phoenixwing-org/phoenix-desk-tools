<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RefScanPayload } from "../../api";
import {
  analyzeRenameReferences,
  applyReferenceLabelCorrections,
  applyRenameAnalysisCorrections,
  executeFileRename,
} from "../../api";
import RenameAnalysisPanel from "../RenameAnalysisPanel.vue";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";
import { useIncomingRefQuery } from "../../composables/useIncomingRefQuery";

const props = defineProps<{
  workbenchTabId?: string;
  preferredFilename?: string;
}>();

const emit = defineEmits<{
  renamed: [];
}>();

const {
  rel,
  form,
  baseline,
  originalFilename,
  pageError,
  reloadFile,
  refreshXrefCounts,
} = useFileDetailContext();
const shell = useAppShell();
const incoming = useIncomingRefQuery(props.workbenchTabId, "file_rename");
const { includeTransitive, formatHostSummary, logIncoming, transitiveLabel } = incoming;

const newFilename = ref("");
const renamed = ref(false);
const renameLogId = ref<number | null>(null);
const scan = ref<RefScanPayload | null>(null);
const selectedHosts = ref<Set<string>>(new Set());
const busy = ref(false);

const canRename = computed(
  () =>
    Boolean(rel.value) &&
    !renamed.value &&
    newFilename.value.trim() !== originalFilename.value.trim(),
);

const canApplyRefs = computed(() => Boolean(scan.value && (scan.value.pending_hit_count ?? 0) > 0));
const canApplyIncomingLabels = computed(() => Boolean(scan.value?.old_basename && rel.value));
const canApplyHostAllLabels = computed(() => Boolean(scan.value?.host_count || rel.value));

watch(
  () => originalFilename.value,
  (name) => {
    if (!renamed.value) newFilename.value = props.preferredFilename?.trim() || name;
  },
  { immediate: true },
);

watch(
  () => props.preferredFilename,
  (name) => {
    if (name?.trim() && !renamed.value) newFilename.value = name.trim();
  },
);

function hasUnsavedDocumentAttrs() {
  const keys = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
  for (const k of keys) {
    if (String(form.value[k] ?? "").trim() !== String(baseline.value[k] ?? "").trim()) return true;
  }
  return false;
}

function toggleHost(hostRel: string, checked: boolean) {
  const next = new Set(selectedHosts.value);
  if (checked) next.add(hostRel);
  else next.delete(hostRel);
  selectedHosts.value = next;
}

function toggleAll(checked: boolean) {
  if (!scan.value) return;
  selectedHosts.value = checked
    ? new Set(scan.value.hosts.map((h) => h.host_repo_rel_path))
    : new Set();
}

function buildApplyOpts() {
  return {
    oldBasename: originalFilename.value.trim(),
    newBasename: newFilename.value.trim() || originalFilename.value.trim(),
    targetRepoRel: rel.value.trim(),
    transitive: includeTransitive.value,
    renameLogId: renameLogId.value ?? undefined,
  };
}

async function onRename() {
  if (!rel.value || !canRename.value) return;
  let writeAttrsFirst = false;
  if (hasUnsavedDocumentAttrs()) {
    if (
      !window.confirm(
        `有尚未写入的属性。是否先写入 Document.xml，再重命名？\n\n${originalFilename.value}\n    ↓\n${newFilename.value.trim()}`,
      )
    ) {
      return;
    }
    writeAttrsFirst = true;
  } else if (
    !window.confirm(
      `将重命名磁盘文件：\n\n${originalFilename.value}\n    ↓\n${newFilename.value.trim()}`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  logIncoming(`开始重命名 ${originalFilename.value} → ${newFilename.value.trim()}…`);
  try {
    const data = await executeFileRename(
      rel.value,
      { ...form.value, filename: newFilename.value.trim() },
      baseline.value,
      { writeAttrsFirst },
    );
    renamed.value = true;
    renameLogId.value = data.rename_log_id ?? data.rename_log?.id ?? null;
    originalFilename.value = data.filename;
    form.value = { ...form.value, filename: data.filename };
    baseline.value = { ...form.value };
    await reloadFile(data.rel_path);
    scan.value = null;
    selectedHosts.value = new Set();
    shell.requestTreeRescan(data.rel_path);
    const msg = `已重命名为 ${data.filename} · 请「分析引用」并修正 XLink / 引用名`;
    logIncoming(msg);
    shell.setStatus(msg);
    emit("renamed");
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`重命名失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

async function onScanRefs() {
  if (!rel.value) return;
  busy.value = true;
  logIncoming(`开始扫描（${transitiveLabel()}）…`);
  try {
    const old = originalFilename.value.trim();
    const neu = newFilename.value.trim() || old;
    const data = await analyzeRenameReferences({
      old_basename: old,
      new_basename: neu,
      old_repo_rel_path: rel.value,
      target_repo_rel: rel.value,
      transitive: includeTransitive.value,
      persist: false,
    });
    scan.value = data;
    selectedHosts.value = new Set(data.hosts.map((h) => h.host_repo_rel_path));
    const summary = formatHostSummary({
      hostCount: data.host_count,
      directHostCount: data.direct_host_count ?? data.host_count,
      hitCount: data.hit_count,
      pendingHitCount: data.pending_hit_count ?? data.hit_count,
      mode: "analyze",
    });
    logIncoming(summary);
    shell.setStatus(summary);
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

async function onApplyRefs() {
  const hosts = [...selectedHosts.value];
  if (!hosts.length || !scan.value) return;
  busy.value = true;
  logIncoming(`开始修正 XLink · ${hosts.length} 个宿主…`);
  try {
    const data = await applyRenameAnalysisCorrections(hosts, buildApplyOpts());
    scan.value = data.scan;
    const msg = `已修正 ${data.applied_hosts.length} 个宿主 · ${data.xlink_patches} 处 XLink`;
    logIncoming(msg);
    shell.setStatus(msg);
    await refreshXrefCounts();
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

async function runLabelApply(scope: "incoming" | "host_all", hostsOverride?: string[]) {
  const hosts = hostsOverride?.length ? hostsOverride : [...selectedHosts.value];
  if (!hosts.length) return;
  busy.value = true;
  const scopeLabel = scope === "host_all" ? "宿主内全部引用名" : "引用名";
  logIncoming(`开始修正${scopeLabel} · ${hosts.length} 个宿主…`);
  try {
    const data = await applyReferenceLabelCorrections(hosts, { ...buildApplyOpts(), labelScope: scope });
    if (data.scan) scan.value = data.scan;
    const msg = `已修正${scopeLabel} · ${data.label_patches ?? 0} 处 Label`;
    logIncoming(msg);
    shell.setStatus(msg);
    await refreshXrefCounts();
  } catch (e) {
    pageError.value = String(e);
    logIncoming(`失败：${String(e)}`);
  } finally {
    busy.value = false;
  }
}

function applyCurrentFileHostLabels() {
  if (!rel.value) return;
  void runLabelApply("host_all", [rel.value]);
}
</script>

<template>
  <div class="rename-panel">
    <section class="rename-block">
      <h3 class="block-title">磁盘改名</h3>
      <div class="rename-grid">
        <span class="label">当前文件名</span>
        <input :value="originalFilename" readonly class="readonly mono" />
        <span class="label">目标文件名</span>
        <input v-model="newFilename" class="mono" :readonly="renamed" spellcheck="false" />
      </div>
      <div class="actions">
        <button type="button" class="btn primary" :disabled="busy || renamed || !canRename" @click="onRename">
          {{ busy ? "…" : "执行改名" }}
        </button>
        <span v-if="renamed && renameLogId" class="ok">已改名 · 记录 #{{ renameLogId }}</span>
      </div>
    </section>

    <section class="refs-block">
      <h3 class="block-title">引用写回</h3>
      <div class="toolbar">
        <label class="chk">
          <input v-model="includeTransitive" type="checkbox" />
          含间接宿主
        </label>
        <button type="button" class="btn" :disabled="busy" @click="onScanRefs">分析引用</button>
      </div>

      <RenameAnalysisPanel
        :scan="scan"
        :selected-hosts="selectedHosts"
        :busy="busy"
        :can-apply="canApplyRefs"
        :can-apply-incoming-labels="canApplyIncomingLabels"
        :can-apply-host-all-labels="canApplyHostAllLabels"
        :show-current-file-host-all="Boolean(rel)"
        @toggle-host="toggleHost"
        @toggle-all="toggleAll"
        @apply="onApplyRefs"
        @apply-incoming-labels="runLabelApply('incoming')"
        @apply-host-all-labels="runLabelApply('host_all')"
        @apply-current-file-host-all="applyCurrentFileHostLabels"
      />
    </section>
  </div>
</template>

<style scoped>
.block-title {
  margin: 0 0 10px;
  font-size: 0.92rem;
}
.rename-block {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.rename-grid {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 10px;
}
.label {
  font-size: 0.82rem;
  color: var(--muted);
}
.rename-grid input {
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}
.readonly {
  background: #f3f4f6;
}
.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
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
.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
}
.ok {
  font-size: 0.82rem;
  color: #047857;
}
.mono {
  font-family: var(--font-mono);
}
</style>
