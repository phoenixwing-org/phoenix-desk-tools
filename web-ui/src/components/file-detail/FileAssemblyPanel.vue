<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { fetchAssemblyTreeByHost, patchLinkLabels, type AssemblyTreeNode } from "../../api";
import AssemblyTreeTable from "../AssemblyTreeTable.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { logReferenceLabelApply } from "../../utils/referenceLabelLog";
import { getAssemblyTreeDepth, setAssemblyTreeDepth } from "../../utils/uiPrefs";

const emit = defineEmits<{
  "edits-change": [dirty: boolean];
}>();

const shell = useAppShell();
const { rel, pageError, activeSubTab, assemblyCacheByKey, invalidateAssemblyCache, xrefMutationSeq } =
  useFileDetailContext();

const treeMode = ref<"first" | "full">(getAssemblyTreeDepth());
const treeLoading = ref(false);
const treeNodes = ref<AssemblyTreeNode[]>([]);
const assemblyTreeRef = ref<InstanceType<typeof AssemblyTreeTable> | null>(null);
const savingLabels = ref(false);
const labelEdits = ref(false);

let loadSeq = 0;

function assemblyCacheKey(host: string, mode: "first" | "full") {
  return `${host}|${mode}`;
}

async function loadAssemblyTree(opts?: {
  refreshDisk?: boolean;
  force?: boolean;
  allowEmptyRetry?: boolean;
}) {
  const host = rel.value.trim();
  if (!host) {
    treeNodes.value = [];
    return;
  }
  if (activeSubTab.value !== "assembly" && !opts?.force) return;

  const cacheKey = assemblyCacheKey(host, treeMode.value);
  if (!opts?.force && !opts?.refreshDisk && assemblyCacheByKey.value[cacheKey]) {
    treeNodes.value = assemblyCacheByKey.value[cacheKey];
    await nextTick();
    assemblyTreeRef.value?.resetEdits();
    return;
  }

  const seq = ++loadSeq;
  treeLoading.value = true;
  try {
    const full = treeMode.value === "full";
    let data = await fetchAssemblyTreeByHost(host, full, opts?.refreshDisk ?? false);
    if (seq !== loadSeq) return;

    if (
      opts?.allowEmptyRetry &&
      !data.nodes.length
    ) {
      await new Promise((r) => setTimeout(r, 450));
      if (seq !== loadSeq) return;
      data = await fetchAssemblyTreeByHost(host, full, false);
    }

    if (seq === loadSeq) {
      treeNodes.value = data.nodes;
      assemblyCacheByKey.value = {
        ...assemblyCacheByKey.value,
        [cacheKey]: data.nodes,
      };
    }
  } catch (e) {
    if (seq === loadSeq) treeNodes.value = [];
    shell.setStatus(String(e));
  } finally {
    if (seq === loadSeq) treeLoading.value = false;
  }
}

function ensureAssemblyLoaded(opts?: { refreshDisk?: boolean; force?: boolean }) {
  if (activeSubTab.value !== "assembly" || !rel.value.trim()) return;
  void loadAssemblyTree({ ...opts, allowEmptyRetry: true });
}

async function saveAssemblyLabels() {
  const patches = assemblyTreeRef.value?.getPendingPatches() ?? [];
  if (!patches.length) return;
  const pendingChanges = assemblyTreeRef.value?.getPendingLabelChanges() ?? [];
  savingLabels.value = true;
  pageError.value = "";
  shell.appendLog(`[文件] 保存装配链接标签 ${patches.length} 处…`, { source: "file_detail", open: true });
  try {
    const data = await patchLinkLabels(patches);
    const failed = data.failed ?? [];
    if (failed.length) {
      const msg = failed.map((f) => `${f.host_repo_rel}: ${f.error}`).join("；");
      pageError.value = msg;
    }
    const msg = logReferenceLabelApply(
      shell.appendLog,
      {
        label_patches: data.label_patches,
        label_changes:
          data.label_changes?.length ? data.label_changes : pendingChanges,
        applied_hosts: data.applied_hosts,
        failed: failed.map((f) => ({
          host_repo_rel_path: f.host_repo_rel,
          error: f.error,
        })),
      },
      { source: "file_detail", title: "已保存链接标签" },
    );
    shell.setStatus(msg);
    assemblyTreeRef.value?.resetEdits();
    labelEdits.value = false;
    emit("edits-change", false);
    invalidateAssemblyCache(rel.value);
    await loadAssemblyTree({ force: true });
  } catch (e) {
    pageError.value = String(e);
    shell.setStatus(String(e));
  } finally {
    savingLabels.value = false;
  }
}

function discardAssemblyLabelEdits() {
  assemblyTreeRef.value?.resetEdits();
  labelEdits.value = false;
  emit("edits-change", false);
}

function onAssemblyEditsChange(dirty: boolean) {
  labelEdits.value = dirty;
  emit("edits-change", dirty);
}

function onApplyRuleLabelsPreview() {
  const stats = assemblyTreeRef.value?.applyRuleLabelsPreview();
  if (!stats) return;
  if (stats.filled > 0) {
    shell.setStatus(`已按规则填入 ${stats.filled} 处，请点「应用」写回 FCStd`);
    return;
  }
  if (stats.unchanged > 0) {
    shell.setStatus(`共 ${stats.unchanged} 处标签已与规则名一致，无需修改`);
    return;
  }
  shell.setStatus(
    stats.noRule > 0
      ? "无法推算规则名（缺零件标识或索引），请先重建引用索引"
      : "当前树无子件可填",
  );
}

async function onExpandAllTree() {
  if (treeMode.value !== "full") {
    treeMode.value = "full";
    await loadAssemblyTree({ force: true });
  }
  await nextTick();
  await assemblyTreeRef.value?.expandAllTree(treeNodes.value);
}

async function onXrefReplaced() {
  invalidateAssemblyCache(rel.value);
  await loadAssemblyTree({ force: true });
}

watch(
  () => xrefMutationSeq.value,
  () => {
    if (activeSubTab.value !== "assembly" || !rel.value.trim()) return;
    void loadAssemblyTree({ force: true });
  },
);

watch(rel, (host) => {
  if (!host.trim()) treeNodes.value = [];
});

watch(treeMode, (mode) => {
  setAssemblyTreeDepth(mode);
});

watch([rel, treeMode], () => {
  ensureAssemblyLoaded();
});

watch(
  () => activeSubTab.value,
  (tab) => {
    if (tab === "assembly") ensureAssemblyLoaded();
  },
);

defineExpose({
  hasLabelEdits: () => Boolean(assemblyTreeRef.value?.getPendingPatches().length),
  discardLabelEdits: discardAssemblyLabelEdits,
});
</script>

<template>
  <section class="assembly-block">
    <div class="section-head">
      <el-button
        size="small"
        :disabled="treeLoading || !treeNodes.length"
        title="将规则名填入各行链接标签文本框，不写盘"
        @click="onApplyRuleLabelsPreview"
      >
        按规则填入标签
      </el-button>
      <el-radio-group v-model="treeMode" size="small" class="section-controls">
        <el-radio-button value="first">第一级</el-radio-button>
        <el-radio-button value="full">全部层级</el-radio-button>
      </el-radio-group>
    </div>
    <p class="asm-hint muted">
      链接标签列仿 FreeCAD 零件树（图标 + 可编辑名）；目标文件单独一列。<strong>缺失</strong>行不可改标签，请用「改链接」；歧义在标签下显示 ⚠。
      「按规则填入标签」只改已解析行，确认后点底部「应用」写回。
    </p>
    <AssemblyTreeTable
      ref="assemblyTreeRef"
      :nodes="treeNodes"
      :loading="treeLoading"
      :tree-depth="treeMode"
      :label-edits="labelEdits"
      :saving-labels="savingLabels"
      @need-full-depth="onExpandAllTree"
      @edits-change="onAssemblyEditsChange"
      @xref-replaced="onXrefReplaced"
      @discard-label-edits="discardAssemblyLabelEdits"
      @apply-label-edits="saveAssemblyLabels"
    />
  </section>
</template>

<style scoped>
.assembly-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.asm-hint {
  margin: 0 0 8px;
  font-size: 0.76rem;
  line-height: 1.45;
  flex-shrink: 0;
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.section-head .btn.subtle {
  padding: 5px 12px;
  font-size: 0.78rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: #047857;
  cursor: pointer;
}

.section-head .btn.subtle:hover:not(:disabled) {
  background: #f0fdf4;
  border-color: #86efac;
}

.section-head .btn.subtle:disabled {
  opacity: 0.5;
  cursor: default;
}

.section-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.mode-opt {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
}

</style>
