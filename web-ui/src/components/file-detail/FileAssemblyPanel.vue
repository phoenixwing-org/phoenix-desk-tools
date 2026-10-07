<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { fetchAssemblyTreeByHost, patchLinkLabels, type AssemblyTreeNode, type LinkLabelPatch } from "../../api";
import { assemblyTreeRemainingPatches } from "../../models/assemblyTreeViewModel";
import AssemblyTreeTable from "../AssemblyTreeTable.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { logReferenceLabelApply } from "../../utils/referenceLabelLog";
import { getAssemblyTreeDepth, setAssemblyTreeDepth } from "../../utils/uiPrefs";

const emit = defineEmits<{
  "edits-change": [dirty: boolean];
  "busy-change": [busy: boolean];
}>();

const shell = useAppShell();
const { rel, pageError, activeSubTab, assemblyCacheByKey, invalidateAssemblyCache, xrefMutationSeq } =
  useFileDetailContext();

const treeMode = ref<"first" | "full">(getAssemblyTreeDepth());
const treeLoading = ref(false);
const treeNodes = ref<AssemblyTreeNode[]>([]);
const assemblyTreeRef = ref<InstanceType<typeof AssemblyTreeTable> | null>(null);
const savingLabels = ref(false);
const replacingLink = ref(false);
watch(() => savingLabels.value || replacingLink.value, busy => emit("busy-change", busy), { flush: "sync" });
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

async function saveAssemblyLabels(selected?: LinkLabelPatch[]) {
  if (savingLabels.value) return;
  const allPending = assemblyTreeRef.value?.getPendingPatches() ?? [];
  const patches = selected ?? allPending;
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
        label_changes: data.label_changes ?? (failed.length ? [] : pendingChanges),
        applied_hosts: data.applied_hosts,
        failed: failed.map((f) => ({
          host_repo_rel_path: f.host_repo_rel,
          error: f.error,
        })),
      },
      { source: "file_detail", title: "已保存链接标签" },
    );
    shell.setStatus(msg);
    const remaining = assemblyTreeRemainingPatches(allPending, patches, failed);
    invalidateAssemblyCache(rel.value);
    await loadAssemblyTree({ force: true });
    await nextTick();
    assemblyTreeRef.value?.restorePendingPatches(remaining);
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
  shell.setStatus("已放弃装配标签修改，未写入 CAD 文件");
}

function onAssemblyEditsChange(dirty: boolean) {
  labelEdits.value = dirty;
  emit("edits-change", dirty);
}

function onApplyRuleLabelsPreview() {
  const stats = assemblyTreeRef.value?.applyRuleLabelsPreview();
  if (!stats) return;
  const skipped = stats.noRule ? `；${stats.noRule} 处无法确认，已跳过` : "";
  if (stats.filled > 0) {
    shell.setStatus(`已按规则填入 ${stats.filled} 处，请逐行或点「应用全部」写回当前总成${skipped}`);
    return;
  }
  if (stats.unchanged > 0) {
    shell.setStatus(`共 ${stats.unchanged} 处已与建议一致${labelEdits.value ? '；仍有未保存修改，请点「应用」' : '，无需修改'}${skipped}`);
    return;
  }
  shell.setStatus(
    stats.noRule > 0
      ? "无法推算规则名（缺零件标识或索引），请先局部刷新当前文件引用"
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

watch([rel, treeMode, activeSubTab], () => {
  ensureAssemblyLoaded();
}, { immediate: true });

defineExpose({
  hasLabelEdits: () => Boolean(assemblyTreeRef.value?.getPendingPatches().length),
  discardLabelEdits: discardAssemblyLabelEdits,
});
</script>

<template>
  <section class="assembly-block">
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
      @operation-change="replacingLink = $event"
      @discard-label-edits="discardAssemblyLabelEdits"
      @apply-label-edits="saveAssemblyLabels"
    >
      <template #toolbar-title><h3 class="panel-title">装配结构</h3></template>
      <template #toolbar-actions>
        <div class="file-panel-actions">
          <el-button size="small" :disabled="!rel" @click="shell.openTab({ pageId: 'part_gallery', payload: { partGallery: { rel } } })">零件图册</el-button>
          <el-button size="small" :disabled="treeLoading || savingLabels || !treeNodes.length" title="仅填入草稿；应用后写入当前总成标签，不改引用路径或源文件" @click="onApplyRuleLabelsPreview">填入推荐标签</el-button>
          <el-radio-group v-model="treeMode" size="small">
            <el-radio-button value="first">第一级</el-radio-button>
            <el-radio-button value="full">全部层级</el-radio-button>
          </el-radio-group>
        </div>
      </template>
    </AssemblyTreeTable>
  </section>
</template>

<style scoped>
@import "./file-panel-header.css";
.assembly-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

</style>
