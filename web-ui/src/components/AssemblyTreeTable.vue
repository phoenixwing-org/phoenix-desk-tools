<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fetchAssemblyTreeByHost,
  type AssemblyTreeNode,
  type BomXrefEdge,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import AssemblyTreeRowGroup from "./assembly-tree/AssemblyTreeRowGroup.vue";
import XlinkReplaceDialog from "./XlinkReplaceDialog.vue";
import {
  assemblyTreeApplyRuleLabels,
  assemblyTreeCanEditLabel,
  assemblyTreeFlatten,
  assemblyTreeIsAssembly as isAssemblyNode,
  assemblyTreeIsUnresolved as isUnresolved,
  assemblyTreePendingChanges,
  assemblyTreePendingPatches,
  assemblyTreePrimaryXlinkAttr as primaryXlinkAttr,
  assemblyTreeWithLabelEdit,
  walkAssemblyTree,
  type AssemblyTreeInstanceViewInput,
} from "../models/assemblyTreeViewModel";

const props = withDefaults(
  defineProps<{
    nodes: AssemblyTreeNode[];
    loading?: boolean;
    editable?: boolean;
    /** first=仅一级子件，无 children；全部展开需 full */
    treeDepth?: "first" | "full";
    /** 缺失/歧义行显示「改链接」（宿主为 node.host_repo_rel） */
    xlinkReplace?: boolean;
    labelEdits?: boolean;
    savingLabels?: boolean;
  }>(),
  { editable: true, treeDepth: "first", xlinkReplace: true, labelEdits: false, savingLabels: false },
);

const emit = defineEmits<{
  "edits-change": [hasEdits: boolean];
  "need-full-depth": [];
  "xref-replaced": [];
  "discard-label-edits": [];
  "apply-label-edits": [];
}>();

const shell = useAppShell();

const replaceOpen = ref(false);
const replaceHostRel = ref("");
const replaceEdge = ref<BomXrefEdge | null>(null);

const expanded = ref<Set<string>>(new Set());
const expandedLabels = ref<Set<string>>(new Set());
/** 装配子树懒加载（索引未嵌套或未切全部层级时） */
const lazyChildren = ref<Map<string, AssemblyTreeNode[]>>(new Map());
const loadingSubtree = ref<Set<string>>(new Set());
/** key: host\\0xlink_attr → edited label */
const edits = ref<Map<string, string>>(new Map());

function canEditLinkLabel(node: AssemblyTreeNode) {
  return assemblyTreeCanEditLabel(node, props.editable);
}

function setLabel(node: AssemblyTreeNode, instance: AssemblyTreeInstanceViewInput, value: string) {
  if (!canEditLinkLabel(node)) return;
  const host = node.host_repo_rel?.trim();
  if (!host) return;
  edits.value = assemblyTreeWithLabelEdit(edits.value, host, instance, value);
  emit("edits-change", hasPendingLabelEdits());
}

function childrenOf(node: AssemblyTreeNode): AssemblyTreeNode[] {
  if (node.children?.length) return node.children;
  return lazyChildren.value.get(node.id) ?? [];
}

function hasSubtree(node: AssemblyTreeNode) {
  return childrenOf(node).length > 0;
}

function canExpand(node: AssemblyTreeNode) {
  return hasSubtree(node) || isAssemblyNode(node);
}

async function ensureSubtree(node: AssemblyTreeNode): Promise<AssemblyTreeNode[]> {
  if (hasSubtree(node)) return childrenOf(node);
  if (!isAssemblyNode(node)) return [];
  const rel = node.repo_rel_path?.trim();
  if (!rel) return [];
  if (loadingSubtree.value.has(node.id)) return [];
  loadingSubtree.value = new Set(loadingSubtree.value).add(node.id);
  try {
    const data = await fetchAssemblyTreeByHost(rel, true);
    const kids = data.nodes ?? [];
    lazyChildren.value = new Map(lazyChildren.value).set(node.id, kids);
    return kids;
  } catch (e) {
    shell.setStatus(String(e));
    return [];
  } finally {
    const next = new Set(loadingSubtree.value);
    next.delete(node.id);
    loadingSubtree.value = next;
  }
}

async function toggle(node: AssemblyTreeNode) {
  if (!canExpand(node)) return;
  if (!hasSubtree(node) && isAssemblyNode(node)) {
    await ensureSubtree(node);
    if (!hasSubtree(node)) {
      shell.setStatus("该装配无已索引的下级引用，请先在「引用」Tab 重建索引");
      return;
    }
  }
  const next = new Set(expanded.value);
  if (next.has(node.id)) next.delete(node.id);
  else next.add(node.id);
  expanded.value = next;
}

function toggleLabelExpand(node: AssemblyTreeNode) {
  const next = new Set(expandedLabels.value);
  if (next.has(node.id)) next.delete(node.id);
  else next.add(node.id);
  expandedLabels.value = next;
}

const flatRows = computed(() => {
  void lazyChildren.value;
  return assemblyTreeFlatten(props.nodes, expanded.value, childrenOf);
});

function expandAllLabels(nodes: AssemblyTreeNode[]) {
  const next = new Set(expandedLabels.value);
  walkAssemblyTree(nodes, childrenOf, (node) => {
    if ((node.ref_count ?? 1) > 1) next.add(node.id);
  });
  expandedLabels.value = next;
}

async function expandAllTree(nodes: AssemblyTreeNode[]) {
  const next = new Set<string>();

  async function walk(ns: AssemblyTreeNode[]) {
    for (const node of ns) {
      if (isAssemblyNode(node)) await ensureSubtree(node);
      if (hasSubtree(node)) {
        next.add(node.id);
        await walk(childrenOf(node));
      }
    }
  }

  await walk(nodes);
  expanded.value = next;
  expandAllLabels(nodes);
}

async function onExpandAllClick() {
  if (props.treeDepth !== "full") {
    emit("need-full-depth");
    return;
  }
  await expandAllTree(props.nodes);
}

function collapseAll() {
  expanded.value = new Set();
  expandedLabels.value = new Set();
}

/** 将各行的规则名填入链接标签文本框（不写盘，需再点「应用」） */
function applyRuleLabelsPreview(): { filled: number; unchanged: number; noRule: number } {
  const result = assemblyTreeApplyRuleLabels(props.nodes, edits.value, childrenOf);
  edits.value = new Map(result.edits);
  emit("edits-change", hasPendingLabelEdits());
  return { filled: result.filled, unchanged: result.unchanged, noRule: result.noRule };
}

function hasPendingLabelEdits(): boolean {
  return assemblyTreePendingPatches(props.nodes, edits.value, childrenOf).length > 0;
}

function nodeToReplaceEdge(node: AssemblyTreeNode): BomXrefEdge | null {
  const attr = primaryXlinkAttr(node);
  if (!attr) return null;
  return {
    id: 0,
    host_repo_rel_path: node.host_repo_rel,
    host_file_asset_id: 0,
    xlink_file_attr: attr,
    target_basename: node.basename,
    target_repo_rel_path: node.repo_rel_path?.trim() || null,
    target_file_asset_id: null,
    resolve_status: node.resolve_status,
    ref_kind: "xlink_file_attr",
    link_label: node.link_label,
    rule_label: node.rule_label,
  };
}

function openReplaceDialog(node: AssemblyTreeNode) {
  const edge = nodeToReplaceEdge(node);
  if (!edge) return;
  replaceHostRel.value = node.host_repo_rel;
  replaceEdge.value = edge;
  replaceOpen.value = true;
}

function closeReplaceDialog() {
  replaceOpen.value = false;
  replaceEdge.value = null;
  replaceHostRel.value = "";
}

function onReplaceApplied() {
  closeReplaceDialog();
  emit("xref-replaced");
}

const issueRowCount = computed(
  () => flatRows.value.filter(({ node }) => isUnresolved(node)).length,
);

const showXlinkActionCol = computed(
  () => props.xlinkReplace && flatRows.value.some((r) => Boolean(primaryXlinkAttr(r.node))),
);

function openFileDetail(node: AssemblyTreeNode) {
  const rel = node.repo_rel_path?.trim();
  if (!rel) return;
  shell.openFileDetailForRel(rel);
}

function getPendingPatches() {
  return assemblyTreePendingPatches(props.nodes, edits.value, childrenOf);
}

function getPendingLabelChanges() {
  return assemblyTreePendingChanges(props.nodes, edits.value, childrenOf);
}

function hasEdits() {
  return hasPendingLabelEdits();
}

function resetEdits() {
  edits.value = new Map();
  emit("edits-change", false);
}

defineExpose({
  getPendingPatches,
  getPendingLabelChanges,
  hasEdits,
  resetEdits,
  expandAllTree,
  applyRuleLabelsPreview,
});

watch(
  () => props.nodes,
  (nodes) => {
    edits.value = new Map();
    expandedLabels.value = new Set();
    lazyChildren.value = new Map();
    loadingSubtree.value = new Set();
    emit("edits-change", false);
    expanded.value = new Set();
    for (const node of nodes) {
      if (hasSubtree(node)) expanded.value.add(node.id);
    }
  },
  { immediate: true, deep: true },
);
</script>

<template>
  <div class="asm-tree-wrap">
    <div v-if="loading" class="empty">加载装配树…</div>
    <div v-else-if="!nodes.length" class="empty">无下级引用（或引用表未构建）</div>
    <div v-else class="table-scroll">
      <table class="asm-tree-table">
        <thead>
          <tr>
            <th class="col-tree">链接标签</th>
            <th class="col-file">目标文件</th>
            <th class="col-qty">数量</th>
            <th class="col-status">状态</th>
            <th v-if="showXlinkActionCol" class="col-action">操作</th>
          </tr>
        </thead>
        <tbody>
          <AssemblyTreeRowGroup
            v-for="{ node, depth } in flatRows"
            :key="node.id"
            :node="node"
            :depth="depth"
            :edits="edits"
            :tree-expanded="expanded.has(node.id)"
            :instance-expanded="expandedLabels.has(node.id)"
            :has-subtree="hasSubtree(node)"
            :subtree-loading="loadingSubtree.has(node.id)"
            :editable="editable"
            :xlink-replace="xlinkReplace"
            :show-xlink-action-col="showXlinkActionCol"
            @toggle="toggle"
            @toggle-instances="toggleLabelExpand"
            @label-input="setLabel"
            @open-file="openFileDetail"
            @replace-xlink="openReplaceDialog"
          />
        </tbody>
      </table>
    </div>

    <div v-if="nodes.length || loading" class="asm-tree-toolbar">
      <div class="toolbar-start">
        <button
          type="button"
          class="btn mini"
          :disabled="loading || !nodes.length"
          :title="treeDepth === 'full' ? '展开所有子装配层级与同目标多实例' : '将切换到「全部层级」并展开'"
          @click="onExpandAllClick"
        >
          全部展开
        </button>
        <button type="button" class="btn mini" :disabled="loading || !nodes.length" @click="collapseAll">
          全部折叠
        </button>
      </div>
      <div v-if="labelEdits" class="label-save-bar">
        <span class="label-save-hint">标签已修改，点「应用」后写回 FCStd</span>
        <button type="button" class="btn mini" :disabled="savingLabels" @click="emit('discard-label-edits')">
          放弃
        </button>
        <button type="button" class="btn mini primary" :disabled="savingLabels" @click="emit('apply-label-edits')">
          {{ savingLabels ? "应用中…" : "应用" }}
        </button>
      </div>
      <div class="toolbar-end" :class="{ 'push-end': !labelEdits }">
        <span class="count">
          {{ flatRows.length }} 行 · 根 {{ nodes.length }}
          <template v-if="issueRowCount">
            · <span class="issue-count">缺失/歧义 {{ issueRowCount }}</span>
          </template>
        </span>
      </div>
    </div>

    <XlinkReplaceDialog
      :open="replaceOpen"
      :host-repo-rel="replaceHostRel"
      :edge="replaceEdge"
      @close="closeReplaceDialog"
      @applied="onReplaceApplied"
    />
  </div>
</template>

<style scoped>
.asm-tree-wrap {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
  min-height: 200px;
}

.asm-tree-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  background: #f8fafc;
  flex-shrink: 0;
}

.toolbar-start {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-end {
  flex-shrink: 0;
}

.toolbar-end.push-end {
  margin-left: auto;
}

.label-save-bar {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 10px;
  border: 1px solid #fcd34d;
  border-radius: 6px;
  background: #fffbeb;
}

.label-save-hint {
  font-size: 0.76rem;
  color: #92400e;
  white-space: nowrap;
}

.label-save-bar .btn.mini.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn.mini {
  padding: 4px 8px;
  font-size: 0.76rem;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  cursor: pointer;
}

.btn.mini:disabled {
  opacity: 0.5;
  cursor: default;
}

.count {
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  max-height: 420px;
}

.asm-tree-table {
  --asm-tree-file-min-width: 160px;
  --asm-tree-file-max-width: 280px;
  --asm-tree-qty-width: 52px;
  --asm-tree-status-width: 56px;
  --asm-tree-action-width: 72px;
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.asm-tree-table th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
  position: sticky;
  top: 0;
  background: #f1f5f9;
  z-index: 1;
  font-weight: 600;
  color: #475569;
}

.col-tree {
  min-width: 280px;
}

.col-file {
  min-width: var(--asm-tree-file-min-width);
  max-width: var(--asm-tree-file-max-width);
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-qty {
  width: var(--asm-tree-qty-width);
  text-align: center;
}

.col-status {
  width: var(--asm-tree-status-width);
  text-align: center;
  vertical-align: middle;
}

.issue-count {
  color: #b45309;
  font-weight: 500;
}

.col-action {
  width: var(--asm-tree-action-width);
  white-space: nowrap;
}

.empty {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
