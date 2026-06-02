<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RefScanPayload, RenameLog } from "../../api";
import {
  analyzeRenameReferences,
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
  switchSubTab,
} = useFileDetailContext();
const shell = useAppShell();
const incoming = useIncomingRefQuery(props.workbenchTabId, "file_rename");
const { includeTransitive, formatHostSummary, logIncoming, transitiveLabel } = incoming;

const newFilename = ref("");
const renamed = ref(false);
const renameLogId = ref<number | null>(null);
const lastRenameLog = ref<RenameLog | null>(null);
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

function applyRenameTargets() {
  const disk = originalFilename.value.trim();
  const pref = props.preferredFilename?.trim();
  if (pref && pref !== disk) renamed.value = false;
  if (!renamed.value) {
    newFilename.value = pref && pref !== disk ? pref : newFilename.value.trim() || disk;
  }
}

function resetRenameWorkflow() {
  renamed.value = false;
  renameLogId.value = null;
  lastRenameLog.value = null;
  scan.value = null;
  selectedHosts.value = new Set();
  applyRenameTargets();
}

function isSameDirPathRename(prev: string, next: string) {
  const norm = (p: string) => p.replace(/\\/g, "/").trim();
  const a = norm(prev);
  const b = norm(next);
  if (a === b) return true;
  const slash = (s: string) => (s.includes("/") ? s.lastIndexOf("/") : -1);
  const ai = slash(a);
  const bi = slash(b);
  const ad = ai >= 0 ? a.slice(0, ai) : "";
  const bd = bi >= 0 ? b.slice(0, bi) : "";
  return ad === bd;
}

watch(
  () => rel.value,
  (path, prev) => {
    if (!prev || path === prev) return;
    if (renamed.value && isSameDirPathRename(prev, path)) return;
    resetRenameWorkflow();
  },
);

watch(
  () => [originalFilename.value, props.preferredFilename] as const,
  () => applyRenameTargets(),
  { immediate: true },
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
  const log = lastRenameLog.value;
  const oldBasename = log?.old_basename ?? originalFilename.value.trim();
  const newBasename =
    log?.new_basename ?? (newFilename.value.trim() || originalFilename.value.trim());
  return {
    oldBasename,
    newBasename,
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
    lastRenameLog.value = data.rename_log ?? null;
    renameLogId.value = data.rename_log_id ?? data.rename_log?.id ?? null;
    originalFilename.value = data.filename;
    form.value = { ...form.value, filename: data.filename };
    baseline.value = { ...form.value };
    await reloadFile(data.rel_path);
    scan.value = null;
    selectedHosts.value = new Set();
    shell.requestTreeRescan(data.rel_path);
    const msg = `已重命名为 ${data.filename} · 正在按旧名扫描引用…`;
    logIncoming(msg);
    shell.setStatus(msg);
    emit("renamed");
    await onScanRefs();
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
    const log = lastRenameLog.value;
    const body: Parameters<typeof analyzeRenameReferences>[0] = {
      target_repo_rel: rel.value,
      transitive: includeTransitive.value,
      persist: Boolean(renameLogId.value),
    };
    if (renameLogId.value) {
      body.rename_log_id = renameLogId.value;
    } else {
      body.old_basename = originalFilename.value.trim();
      body.new_basename = newFilename.value.trim() || originalFilename.value.trim();
      body.old_repo_rel_path = rel.value;
    }
    if (log?.new_repo_rel_path) body.new_repo_rel_path = log.new_repo_rel_path;
    const data = await analyzeRenameReferences(body);
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

</script>

<template>
  <div class="rename-panel">
    <section class="rename-block">
      <h3 class="block-title">磁盘改名</h3>
      <div class="rename-grid">
        <span class="label">磁盘当前名</span>
        <input :value="originalFilename" readonly class="readonly mono" />
        <span class="label">目标文件名</span>
        <input v-model="newFilename" class="mono" :readonly="renamed || busy" spellcheck="false" />
      </div>
      <div class="actions">
        <button type="button" class="btn primary" :disabled="busy || renamed || !canRename" @click="onRename">
          {{ busy ? "…" : "执行改名" }}
        </button>
        <button
          v-if="renamed"
          type="button"
          class="btn"
          :disabled="busy"
          title="若目标名填错或要继续改新名，解锁后可编辑"
          @click="resetRenameWorkflow"
        >
          再次改名
        </button>
        <span v-if="renamed && renameLogId" class="ok">本页已执行过改名 · 记录 #{{ renameLogId }}</span>
      </div>
      <p v-if="renamed && newFilename.trim() === originalFilename.trim()" class="rename-warn muted">
        目标名与磁盘当前名相同。若属性里填了新的文件名，请点「再次改名」或回「编辑属性」确认后重新点「去改名」。
      </p>
    </section>

    <section class="refs-block">
      <h3 class="block-title">引用写回</h3>
      <p v-if="renamed && lastRenameLog" class="next-step">
        磁盘已改为 <strong class="mono">{{ lastRenameLog.new_basename }}</strong>。
        请用下方「分析引用」查找仍引用旧名
        <strong class="mono">{{ lastRenameLog.old_basename }}</strong>
        的装配，勾选后写回 XLink。
        <button type="button" class="link-inline" @click="switchSubTab('xref')">显示名同步请到「引用」Tab →</button>
      </p>
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
        label-sync-ui="off"
        @toggle-host="toggleHost"
        @toggle-all="toggleAll"
        @apply="onApplyRefs"
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
.next-step {
  margin: 0 0 12px;
  padding: 10px 12px;
  font-size: 0.82rem;
  line-height: 1.5;
  color: #0f172a;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}
.next-step strong.mono {
  font-family: var(--font-mono);
  font-weight: 600;
}
.rename-warn {
  margin: 8px 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #b45309;
}
.link-inline {
  margin-left: 4px;
  padding: 0;
  border: none;
  background: none;
  color: #1d4ed8;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.mono {
  font-family: var(--font-mono);
}
</style>
