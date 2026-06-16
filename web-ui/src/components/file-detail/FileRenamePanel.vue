<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RenameLog } from "../../api";
import { executeFileRename, fetchRenameLogs } from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";

const props = defineProps<{
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
  activeSubTab,
} = useFileDetailContext();
const shell = useAppShell();

const newFilename = ref("");
const renamed = ref(false);
const lastRenameLog = ref<RenameLog | null>(null);
const fileRenameLogs = ref<RenameLog[]>([]);
const logsLoading = ref(false);
const busy = ref(false);

const canRename = computed(
  () =>
    Boolean(rel.value) &&
    !renamed.value &&
    newFilename.value.trim() !== originalFilename.value.trim(),
);

function resolveRenameTargetFilename(): string {
  return (
    props.preferredFilename?.trim() ||
    (form.value.filename ?? "").trim() ||
    ""
  );
}

function applyRenameTargets() {
  const disk = originalFilename.value.trim();
  const target = resolveRenameTargetFilename();
  if (target && target !== disk) renamed.value = false;
  if (!renamed.value) {
    newFilename.value = target || disk;
  }
}

function resetRenameWorkflow() {
  renamed.value = false;
  lastRenameLog.value = null;
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

function formatLogTime(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

/** 改名记录列表：本次改名置顶，并与接口结果去重。 */
const displayRenameLogs = computed(() => {
  const logs = fileRenameLogs.value;
  const latest = lastRenameLog.value;
  if (!latest) return logs;
  const idx = logs.findIndex((l) => l.id === latest.id);
  if (idx < 0) return [latest, ...logs];
  if (idx === 0) return logs;
  return [logs[idx], ...logs.slice(0, idx), ...logs.slice(idx + 1)];
});

function isCurrentRenameLog(log: RenameLog) {
  return lastRenameLog.value?.id === log.id;
}

async function loadFileRenameLogs() {
  const path = rel.value.trim();
  if (!path) {
    fileRenameLogs.value = [];
    return;
  }
  logsLoading.value = true;
  try {
    const data = await fetchRenameLogs(20, path);
    fileRenameLogs.value = data.entries ?? [];
  } catch {
    fileRenameLogs.value = [];
  } finally {
    logsLoading.value = false;
  }
}

async function onRefreshLogs() {
  if (logsLoading.value || !rel.value.trim()) return;
  await loadFileRenameLogs();
  shell.setStatus("已刷新改名记录");
}

function openRenameAnalysisForLog(log: RenameLog) {
  shell.openRenameAnalysis({
    renameLogId: log.id,
    oldBasename: log.old_basename,
    newBasename: log.new_basename,
    excludeRepoRel: log.new_repo_rel_path,
    autoAnalyze: true,
  });
}

watch(
  () => rel.value,
  (path, prev) => {
    if (!prev || path === prev) return;
    if (renamed.value && isSameDirPathRename(prev, path)) return;
    resetRenameWorkflow();
    void loadFileRenameLogs();
  },
);

watch(
  () => [originalFilename.value, props.preferredFilename, form.value.filename] as const,
  () => {
    if (activeSubTab.value === "rename") applyRenameTargets();
  },
);

watch(
  () => activeSubTab.value,
  (tab) => {
    if (tab === "rename") {
      applyRenameTargets();
      void loadFileRenameLogs();
    }
  },
  { immediate: true },
);

function hasUnsavedDocumentAttrs() {
  const keys = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
  for (const k of keys) {
    if (String(form.value[k] ?? "").trim() !== String(baseline.value[k] ?? "").trim()) return true;
  }
  return false;
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
  shell.appendLog(
    `[文件详情] 重命名 ${originalFilename.value} → ${newFilename.value.trim()}…`,
    { source: "file_detail", open: true },
  );
  try {
    const data = await executeFileRename(
      rel.value,
      { ...form.value, filename: newFilename.value.trim() },
      baseline.value,
      { writeAttrsFirst },
    );
    renamed.value = true;
    lastRenameLog.value = data.rename_log ?? null;
    originalFilename.value = data.filename;
    form.value = { ...form.value, filename: data.filename };
    baseline.value = { ...form.value };
    await reloadFile(data.rel_path);
    shell.requestTreeRescan(data.rel_path);
    await loadFileRenameLogs();
    const log = data.rename_log ?? null;
    if (log) {
      const msg = `已重命名为 ${data.filename} · 记录 #${log.id}，请在下方点「改名分析」修正引用`;
      shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
      shell.setStatus(msg);
    } else {
      const msg = `已重命名为 ${data.filename}`;
      shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
      shell.setStatus(msg);
    }
    emit("renamed");
  } catch (e) {
    pageError.value = String(e);
    shell.appendLog(String(e), { source: "file_detail" });
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
          type="button"
          class="btn"
          :disabled="busy || logsLoading || !rel.trim()"
          title="从数据库重新加载本文件的改名记录"
          @click="onRefreshLogs"
        >
          {{ logsLoading ? "…" : "刷新记录" }}
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
      </div>
      <p v-if="renamed && newFilename.trim() === originalFilename.trim()" class="rename-warn muted">
        目标名与磁盘当前名相同。若属性里填了新的文件名，请点「再次改名」或回「编辑属性」确认后重新点「去改名」。
      </p>
    </section>

    <section class="records-block">
      <h3 class="block-title">改名记录</h3>
      <p class="section-hint muted">历史改名（新→旧倒序）；点右侧按钮进入改名分析。</p>
      <div v-if="logsLoading && !displayRenameLogs.length" class="empty muted">正在查询改名记录…</div>
      <div v-else-if="!displayRenameLogs.length" class="empty muted">暂无改名记录</div>
      <ul v-else class="record-list" :class="{ dimmed: logsLoading }">
        <li
          v-for="log in displayRenameLogs"
          :key="log.id"
          class="record-card"
          :class="{ latest: isCurrentRenameLog(log) }"
          :title="
            isCurrentRenameLog(log)
              ? `装配里可能仍引用旧名 ${log.old_basename}，请在改名分析中扫描并写回 XLink`
              : undefined
          "
        >
          <div class="record-row">
            <div class="record-row-main">
              <span v-if="isCurrentRenameLog(log)" class="record-badge">本次</span>
              <span class="mono old" :title="log.old_repo_rel_path">{{ log.old_basename }}</span>
              <span class="arrow" aria-hidden="true">→</span>
              <span class="mono new" :title="log.new_repo_rel_path">{{ log.new_basename }}</span>
            </div>
            <button
              type="button"
              class="btn btn-compact"
              :class="isCurrentRenameLog(log) ? 'primary' : 'accent'"
              @click="openRenameAnalysisForLog(log)"
            >
              {{ isCurrentRenameLog(log) ? "改名分析" : "分析引用" }}
            </button>
          </div>
          <div class="record-row-meta muted">
            #{{ log.id }} · {{ formatLogTime(log.created_at) }}
            <span v-if="isCurrentRenameLog(log)" class="record-meta-tip"> · 可能仍有旧名引用</span>
          </div>
        </li>
      </ul>
      <p v-if="logsLoading && displayRenameLogs.length" class="records-loading muted">正在刷新…</p>
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
.btn.accent {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #3b82f6;
  font-weight: 600;
}
.btn.accent:hover {
  background: #bfdbfe;
  border-color: #2563eb;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.rename-warn {
  margin: 8px 0 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #b45309;
}
.records-block {
  margin-bottom: 8px;
}
.section-hint {
  margin: 0 0 10px;
  font-size: 0.76rem;
  line-height: 1.4;
}
.record-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.record-list.dimmed {
  opacity: 0.65;
  pointer-events: none;
}
.record-card {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafbfc;
}
.record-card.latest {
  border-color: #93c5fd;
  background: #eff6ff;
}
.record-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.record-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: 0.82rem;
  font-weight: 600;
}
.record-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  color: #1d4ed8;
  background: #dbeafe;
  border: 1px solid #93c5fd;
  flex-shrink: 0;
}
.record-row-main .old {
  color: #64748b;
  text-decoration: line-through;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 42%;
}
.record-row-main .new {
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 42%;
}
.arrow {
  color: var(--muted);
  flex-shrink: 0;
}
.record-row-meta {
  margin-top: 4px;
  font-size: 0.72rem;
  line-height: 1.3;
}
.record-meta-tip {
  color: #1d4ed8;
}
.btn-compact {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 0.76rem;
}
.records-loading {
  margin: 6px 0 0;
  font-size: 0.74rem;
  text-align: center;
}
.empty {
  padding: 12px;
  text-align: center;
  font-size: 0.8rem;
}
.mono {
  font-family: var(--font-mono);
}
.muted {
  color: var(--muted);
}
</style>
