<script setup lang="ts">
import { ref, watch } from "vue";
import { fetchAssemblyTreeByHost, patchLinkLabels, type AssemblyTreeNode } from "../../api";
import AssemblyTreeTable from "../AssemblyTreeTable.vue";
import ReferenceLabelSyncBar from "../ReferenceLabelSyncBar.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useFileDetailContext } from "../../composables/useFileDetailContext";

const emit = defineEmits<{
  "edits-change": [dirty: boolean];
}>();

const shell = useAppShell();
const { rel, pageError } = useFileDetailContext();

const treeMode = ref<"first" | "full">("first");
const treeLoading = ref(false);
const treeNodes = ref<AssemblyTreeNode[]>([]);
const assemblyTreeRef = ref<InstanceType<typeof AssemblyTreeTable> | null>(null);
const savingLabels = ref(false);
const labelEdits = ref(false);

async function loadAssemblyTree() {
  const host = rel.value.trim();
  if (!host) {
    treeNodes.value = [];
    return;
  }

  treeLoading.value = true;
  try {
    const data = await fetchAssemblyTreeByHost(host, treeMode.value === "full");
    treeNodes.value = data.nodes;
  } catch (e) {
    treeNodes.value = [];
    shell.setStatus(String(e));
  } finally {
    treeLoading.value = false;
  }
}

async function saveAssemblyLabels() {
  const patches = assemblyTreeRef.value?.getPendingPatches() ?? [];
  if (!patches.length) return;
  savingLabels.value = true;
  pageError.value = "";
  shell.appendLog(`[文件] 保存装配子件零件名 ${patches.length} 处…`, { source: "file_detail", open: true });
  try {
    const data = await patchLinkLabels(patches);
    const failed = data.failed ?? [];
    if (failed.length) {
      const msg = failed.map((f) => `${f.host_repo_rel}: ${f.error}`).join("；");
      pageError.value = msg;
      shell.appendLog(msg, { source: "file_detail" });
    }
    const msg = `已保存子件零件名 · ${data.label_patches ?? 0} 处 · ${data.applied_hosts?.length ?? 0} 个宿主`;
    shell.appendLog(msg, { source: "file_detail" });
    shell.setStatus(msg);
    assemblyTreeRef.value?.resetEdits();
    labelEdits.value = false;
    emit("edits-change", false);
    await loadAssemblyTree();
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

function onSyncDone(msg: string) {
  shell.setStatus(msg);
  void loadAssemblyTree();
}

function onSyncError(msg: string) {
  pageError.value = msg;
  shell.setStatus(msg);
}

watch([rel, treeMode], () => {
  void loadAssemblyTree();
}, { immediate: true });

defineExpose({
  hasLabelEdits: () => Boolean(assemblyTreeRef.value?.getPendingPatches().length),
  discardLabelEdits: discardAssemblyLabelEdits,
});
</script>

<template>
  <section class="assembly-block">
    <div class="section-head">
      <div class="section-controls">
        <label class="mode-opt">
          <input v-model="treeMode" type="radio" value="first" />
          第一级
        </label>
        <label class="mode-opt">
          <input v-model="treeMode" type="radio" value="full" />
          全部层级
        </label>
      </div>
    </div>
    <ReferenceLabelSyncBar
      v-if="rel"
      compact
      :target-repo-rel="rel"
      :show-incoming="false"
      @done="onSyncDone"
      @error="onSyncError"
    />
    <div v-if="labelEdits" class="label-save-bar">
      <span class="label-save-hint">子件零件名已修改，尚未写回 FCStd</span>
      <button type="button" class="btn" :disabled="savingLabels" @click="discardAssemblyLabelEdits">
        放弃
      </button>
      <button type="button" class="btn primary" :disabled="savingLabels" @click="saveAssemblyLabels">
        {{ savingLabels ? "保存中…" : "保存子件零件名" }}
      </button>
    </div>
    <AssemblyTreeTable
      ref="assemblyTreeRef"
      :nodes="treeNodes"
      :loading="treeLoading"
      @edits-change="onAssemblyEditsChange"
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

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
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

.label-save-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  background: #fffbeb;
  flex-shrink: 0;
}

.label-save-hint {
  flex: 1;
  min-width: 160px;
  font-size: 0.78rem;
  color: #92400e;
}

.label-save-bar .btn {
  padding: 5px 12px;
  font-size: 0.78rem;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
}

.label-save-bar .btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
</style>
