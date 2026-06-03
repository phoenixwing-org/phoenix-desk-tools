<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  fetchAssemblyTreeByHost,
  type AssemblyTreeNode,
  type AssemblyXrefInstance,
  type BomXrefEdge,
  type LinkLabelPatch,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import XlinkReplaceDialog from "./XlinkReplaceDialog.vue";
import { resolveRuleLabelForNode } from "../utils/fcstdRuleLabel";

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

type FlatRow = { node: AssemblyTreeNode; depth: number };
type InstanceRow = {
  node: AssemblyTreeNode;
  depth: number;
  instance: AssemblyXrefInstance;
  instanceIndex: number;
};

const expanded = ref<Set<string>>(new Set());
const expandedLabels = ref<Set<string>>(new Set());
/** 装配子树懒加载（索引未嵌套或未切全部层级时） */
const lazyChildren = ref<Map<string, AssemblyTreeNode[]>>(new Map());
const loadingSubtree = ref<Set<string>>(new Set());
/** key: host\\0xlink_attr → edited label */
const edits = ref<Map<string, string>>(new Map());

function editKey(host: string, attr: string) {
  return `${host}\x00${attr}`;
}

function instancesOf(node: AssemblyTreeNode): AssemblyXrefInstance[] {
  if (node.xref_instances?.length) return node.xref_instances;
  const attr = node.xlink_file_attr?.trim();
  if (!attr) return [];
  return [{ xlink_file_attr: attr, link_label: node.link_label ?? "" }];
}

function baselineLabel(host: string, inst: AssemblyXrefInstance) {
  return inst.link_label ?? "";
}

function displayLabel(host: string, inst: AssemblyXrefInstance) {
  const key = editKey(host, inst.xlink_file_attr);
  if (edits.value.has(key)) return edits.value.get(key)!;
  return baselineLabel(host, inst);
}

function isMissingNode(node: AssemblyTreeNode) {
  return node.resolve_status === "missing";
}

function isResolvedNode(node: AssemblyTreeNode) {
  const s = node.resolve_status;
  return s === "resolved" || s === "ok" || s === "present" || s === "self";
}

function missingRowTitle(node: AssemblyTreeNode) {
  const parts = ["链接缺失"];
  const xlink = primaryXlinkAttr(node);
  if (xlink) parts.push(xlink);
  return parts.join(" · ");
}

function canEditLinkLabel(node: AssemblyTreeNode) {
  return props.editable && !isMissingNode(node);
}

function setLabel(node: AssemblyTreeNode, inst: AssemblyXrefInstance, value: string) {
  if (!canEditLinkLabel(node)) return;
  const host = node.host_repo_rel?.trim();
  if (!host) return;
  const key = editKey(host, inst.xlink_file_attr);
  const base = baselineLabel(host, inst);
  const next = new Map(edits.value);
  if (value.trim() === base.trim()) next.delete(key);
  else next.set(key, value);
  edits.value = next;
  emit("edits-change", next.size > 0);
}

function isAssemblyNode(node: AssemblyTreeNode) {
  if (node.file_role === "assembly") return true;
  const name = node.basename || node.repo_rel_path || "";
  return /\.assy\.fcstd$/i.test(name);
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

/** 展开钮视觉状态：loading | expanded | collapsed | lazy | leaf */
function toggleVisualState(node: AssemblyTreeNode) {
  if (loadingSubtree.value.has(node.id)) return "loading";
  if (hasSubtree(node)) return expanded.value.has(node.id) ? "expanded" : "collapsed";
  if (isAssemblyNode(node)) return "lazy";
  return "leaf";
}

function toggleAriaLabel(node: AssemblyTreeNode) {
  if (loadingSubtree.value.has(node.id)) return "加载子件";
  if (hasSubtree(node)) {
    return expanded.value.has(node.id) ? "折叠子件" : "展开子件";
  }
  if (isAssemblyNode(node)) return "加载并展开该装配的下级子件";
  return "无子件";
}

function toggleLabelExpand(node: AssemblyTreeNode) {
  const next = new Set(expandedLabels.value);
  if (next.has(node.id)) next.delete(node.id);
  else next.add(node.id);
  expandedLabels.value = next;
}

function flatten(nodes: AssemblyTreeNode[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (expanded.value.has(node.id) && hasSubtree(node)) {
      flatten(childrenOf(node), depth + 1, out);
    }
  }
  return out;
}

const flatRows = computed(() => {
  void lazyChildren.value;
  return flatten(props.nodes);
});

function instanceExtraRows(node: AssemblyTreeNode, depth: number): InstanceRow[] {
  const insts = instancesOf(node);
  if (!expandedLabels.value.has(node.id) || insts.length <= 1) return [];
  return insts.slice(1).map((instance, i) => ({
    node,
    depth,
    instance,
    instanceIndex: i + 1,
  }));
}

function expandAllLabels(nodes: AssemblyTreeNode[]) {
  const next = new Set(expandedLabels.value);
  walkNodes(nodes, (node) => {
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

function roleLabel(role: string) {
  const map: Record<string, string> = {
    part: "零件",
    drawing: "工程图",
    assembly: "装配",
  };
  return map[role] ?? role;
}

function resolveRole(node: AssemblyTreeNode) {
  if (node.file_role?.trim()) return node.file_role.trim();
  return isAssemblyNode(node) ? "assembly" : "part";
}

function roleIconClass(node: AssemblyTreeNode) {
  const role = resolveRole(node);
  return {
    "icon-assembly": role === "assembly",
    "icon-part": role === "part",
    "icon-drawing": role === "drawing",
    "icon-broken": isUnresolved(node),
  };
}

/** 将各行的规则名填入链接标签文本框（不写盘，需再点「应用」） */
function applyRuleLabelsPreview(): { filled: number; unchanged: number; noRule: number } {
  const next = new Map(edits.value);
  let filled = 0;
  let unchanged = 0;
  let noRule = 0;

  walkNodes(props.nodes, (node) => {
    if (isMissingNode(node)) return;
    const host = node.host_repo_rel?.trim();
    if (!host) return;
    const rule = resolveRuleLabelForNode(node);
    if (!rule) {
      noRule += 1;
      return;
    }
    for (const inst of instancesOf(node)) {
      const attr = inst.xlink_file_attr?.trim();
      if (!attr) continue;
      const current = displayLabel(host, inst).trim();
      if (rule === current) {
        unchanged += 1;
        continue;
      }
      next.set(editKey(host, attr), rule);
      filled += 1;
    }
  });

  edits.value = next;
  emit("edits-change", next.size > 0);
  return { filled, unchanged, noRule };
}

function statusLabel(s: string) {
  if (s === "ok" || s === "present" || s === "resolved") return "已解析";
  if (s === "missing") return "缺失";
  if (s === "ambiguous") return "歧义";
  if (s === "self") return "自身";
  return s || "—";
}

function isUnresolved(node: AssemblyTreeNode) {
  const s = node.resolve_status;
  return s === "missing" || s === "ambiguous";
}

function rowStatusClass(node: AssemblyTreeNode) {
  if (node.resolve_status === "missing") return "row-missing";
  if (node.resolve_status === "ambiguous") return "row-ambiguous";
  return "";
}

function primaryXlinkAttr(node: AssemblyTreeNode) {
  return instancesOf(node)[0]?.xlink_file_attr?.trim() || node.xlink_file_attr?.trim() || "";
}

function canReplaceXlink(node: AssemblyTreeNode) {
  return props.xlinkReplace && Boolean(primaryXlinkAttr(node));
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

function walkNodes(nodes: AssemblyTreeNode[], fn: (n: AssemblyTreeNode) => void) {
  for (const n of nodes) {
    fn(n);
    const ch = childrenOf(n);
    if (ch.length) walkNodes(ch, fn);
  }
}

function getPendingPatches(): LinkLabelPatch[] {
  const patches: LinkLabelPatch[] = [];
  walkNodes(props.nodes, (node) => {
    if (isMissingNode(node)) return;
    const host = node.host_repo_rel?.trim();
    if (!host) return;
    for (const inst of instancesOf(node)) {
      const attr = inst.xlink_file_attr?.trim();
      if (!attr) continue;
      const key = editKey(host, attr);
      if (!edits.value.has(key)) continue;
      patches.push({
        host_repo_rel: host,
        xlink_file_attr: attr,
        link_label: edits.value.get(key)!.trim(),
      });
    }
  });
  return patches;
}

function getPendingLabelChanges() {
  const rows: Array<{
    host_repo_rel: string;
    xlink_file_attr: string;
    old_label: string;
    new_label: string;
  }> = [];
  walkNodes(props.nodes, (node) => {
    if (isMissingNode(node)) return;
    const host = node.host_repo_rel?.trim();
    if (!host) return;
    for (const inst of instancesOf(node)) {
      const attr = inst.xlink_file_attr?.trim();
      if (!attr) continue;
      const key = editKey(host, attr);
      if (!edits.value.has(key)) continue;
      rows.push({
        host_repo_rel: host,
        xlink_file_attr: attr,
        old_label: baselineLabel(host, inst),
        new_label: edits.value.get(key)!.trim(),
      });
    }
  });
  return rows;
}

function hasEdits() {
  return edits.value.size > 0;
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
  { immediate: true },
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
          <template v-for="{ node, depth } in flatRows" :key="node.id">
            <tr
              :class="[
                rowStatusClass(node),
                {
                  'row-edited':
                    canEditLinkLabel(node) &&
                    instancesOf(node).some((i) => edits.has(editKey(node.host_repo_rel, i.xlink_file_attr))),
                },
              ]"
            >
              <td class="tree-cell">
                <div
                  class="tree-item"
                  :class="{ 'tree-item-missing': isMissingNode(node) }"
                  :style="{ paddingLeft: `${depth * 18 + 4}px` }"
                >
                  <button
                    type="button"
                    class="toggle"
                    :class="[`toggle-${toggleVisualState(node)}`, { leaf: !canExpand(node) }]"
                    :disabled="!canExpand(node) || loadingSubtree.has(node.id)"
                    :aria-expanded="
                      hasSubtree(node) ? expanded.has(node.id) : isAssemblyNode(node) ? false : undefined
                    "
                    :aria-label="toggleAriaLabel(node)"
                    :title="
                      isAssemblyNode(node) && !hasSubtree(node)
                        ? '点击加载该装配的下级子件'
                        : toggleAriaLabel(node)
                    "
                    @click="toggle(node)"
                  >
                    <span class="toggle-glyph" aria-hidden="true" />
                  </button>
                  <span
                    class="role-icon"
                    :class="roleIconClass(node)"
                    :title="roleLabel(resolveRole(node))"
                    aria-hidden="true"
                  />
                  <div class="tree-body">
                    <div class="tree-label-row">
                      <input
                        v-if="canEditLinkLabel(node) && instancesOf(node)[0]"
                        class="label-input"
                        :value="displayLabel(node.host_repo_rel, instancesOf(node)[0])"
                        spellcheck="false"
                        :placeholder="resolveRuleLabelForNode(node) || '链接标签'"
                        :key="`${node.id}-${editKey(node.host_repo_rel, instancesOf(node)[0].xlink_file_attr)}`"
                        @input="setLabel(node, instancesOf(node)[0], ($event.target as HTMLInputElement).value)"
                      />
                      <span
                        v-else-if="isMissingNode(node)"
                        class="tree-label-read muted"
                        :title="missingRowTitle(node)"
                      >
                        {{ node.link_label || node.basename || "—" }}
                      </span>
                      <span v-else class="tree-label-read">{{ node.link_label || "—" }}</span>
                    </div>
                    <div v-if="isUnresolved(node) && !isMissingNode(node)" class="tree-issue">
                      <span class="issue-icon" :title="statusLabel(node.resolve_status)">⚠</span>
                      <span class="issue-text">{{ statusLabel(node.resolve_status) }}</span>
                      <span
                        v-if="primaryXlinkAttr(node)"
                        class="issue-xlink mono"
                        :title="primaryXlinkAttr(node)"
                      >
                        {{ primaryXlinkAttr(node) }}
                      </span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="col-file mono">
                <button
                  v-if="node.repo_rel_path"
                  type="button"
                  class="file-link"
                  :title="node.repo_rel_path"
                  @click="openFileDetail(node)"
                >
                  {{ node.basename }}
                </button>
                <span v-else :title="primaryXlinkAttr(node) || undefined">{{ node.basename }}</span>
              </td>
              <td class="col-qty">
                <button
                  v-if="(node.ref_count ?? 1) > 1 && canEditLinkLabel(node)"
                  type="button"
                  class="qty-btn"
                  :title="expandedLabels.has(node.id) ? '折叠各实例' : '展开编辑各实例标签'"
                  @click="toggleLabelExpand(node)"
                >
                  {{ node.ref_count }}
                  <span class="qty-caret">{{ expandedLabels.has(node.id) ? "▾" : "▸" }}</span>
                </button>
                <span v-else class="qty-num">{{ node.ref_count ?? 1 }}</span>
              </td>
              <td class="col-status">
                <span v-if="isMissingNode(node)" class="status-badge missing">缺失</span>
                <span v-else-if="node.resolve_status === 'ambiguous'" class="status-badge ambiguous">歧义</span>
                <span v-else-if="isResolvedNode(node)" class="status-ok" title="已解析">✓</span>
                <span v-else class="status-muted muted">{{ statusLabel(node.resolve_status) }}</span>
              </td>
              <td v-if="showXlinkActionCol" class="col-action">
                <button
                  v-if="canReplaceXlink(node)"
                  type="button"
                  class="btn-row-action"
                  title="搜索候选并写回该宿主装配内此 XLink（已解析/缺失均可，宿主可能为子装配）"
                  @click="openReplaceDialog(node)"
                >
                  改链接
                </button>
                <span v-else class="muted">—</span>
              </td>
            </tr>
            <tr
              v-for="extra in instanceExtraRows(node, depth)"
              :key="`${node.id}-inst-${extra.instanceIndex}`"
              class="instance-row"
              :class="{
                'row-edited':
                  canEditLinkLabel(node) &&
                  edits.has(editKey(node.host_repo_rel, extra.instance.xlink_file_attr)),
              }"
            >
              <td class="tree-cell" colspan="1">
                <div class="tree-item instance-indent" :style="{ paddingLeft: `${depth * 18 + 36}px` }">
                  <span class="role-icon icon-instance" title="同目标多实例" aria-hidden="true" />
                  <div class="tree-body">
                    <div class="tree-label-row">
                      <span class="muted instance-tag">#{{ extra.instanceIndex + 1 }}</span>
                      <input
                        v-if="canEditLinkLabel(node)"
                        class="label-input"
                        :value="displayLabel(node.host_repo_rel, extra.instance)"
                        spellcheck="false"
                        @input="setLabel(node, extra.instance, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </div>
                </div>
              </td>
              <td class="col-file muted instance-hint">—</td>
              <td class="col-qty muted instance-hint">—</td>
              <td class="col-status muted instance-hint">—</td>
              <td v-if="showXlinkActionCol" class="col-action muted">—</td>
            </tr>
          </template>
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
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.asm-tree-table th,
.asm-tree-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.asm-tree-table th {
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

.tree-cell {
  vertical-align: top;
}

.tree-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.tree-item-missing {
  align-items: center;
}

.tree-body {
  flex: 1;
  min-width: 0;
}

.tree-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.tree-label-read {
  font-weight: 600;
  font-size: 0.84rem;
}

.col-file {
  min-width: 160px;
  max-width: 280px;
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-issue {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-top: 4px;
  font-size: 0.72rem;
  color: #b45309;
}

.issue-icon {
  font-size: 0.85rem;
  line-height: 1;
}

.issue-xlink {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #92400e;
}

.role-icon {
  flex-shrink: 0;
  align-self: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #e2e8f0 center / 14px 14px no-repeat;
}

.role-icon.icon-assembly {
  background-color: #dbeafe;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%231d4ed8'%3E%3Cpath d='M2 5h5V2h2v3h5v2h-5v5H9V7H2V5z'/%3E%3C/svg%3E");
}

.role-icon.icon-part {
  background-color: #f1f5f9;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23475569'%3E%3Cpath d='M3 3h10v10H3V3zm2 2v6h6V5H5z'/%3E%3C/svg%3E");
}

.role-icon.icon-drawing {
  background-color: #fef3c7;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23b45309'%3E%3Cpath d='M4 2h8l2 2v10H4V2zm1 3h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z'/%3E%3C/svg%3E");
}

.role-icon.icon-broken {
  box-shadow: inset 0 -2px 0 #f59e0b;
}

.role-icon.icon-instance {
  background-color: #f8fafc;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%2394a3b8'%3E%3Ccircle cx='8' cy='8' r='3'/%3E%3C/svg%3E");
}

.toggle {
  flex-shrink: 0;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: 0 1px 0 0;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  color: #475569;
}

.toggle:hover:not(:disabled):not(.leaf) {
  background: #f1f5f9;
}

.toggle:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 1px;
}

.toggle-glyph {
  width: 14px;
  height: 14px;
  background: center / 14px 14px no-repeat;
}

.toggle-collapsed .toggle-glyph,
.toggle-lazy .toggle-glyph {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23475569' d='M6.2 3.8 11.4 8l-5.2 4.2z'/%3E%3C/svg%3E");
}

.toggle-expanded .toggle-glyph {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23475569' d='M3.8 5.8 8 11l4.2-5.2z'/%3E%3C/svg%3E");
}

.toggle-leaf .toggle-glyph {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
  background-image: none;
}

.toggle-loading {
  font-size: 0.9rem;
  font-weight: 600;
  color: #64748b;
}

.toggle-loading .toggle-glyph {
  display: none;
}

.toggle-loading::after {
  content: "…";
  line-height: 1;
}

.toggle.leaf {
  cursor: default;
}

.toggle.leaf:hover {
  background: transparent;
}

.label-input {
  flex: 1;
  min-width: 120px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.84rem;
  font-weight: 600;
  box-sizing: border-box;
}

.col-qty {
  width: 52px;
  text-align: center;
}

.col-status {
  width: 56px;
  text-align: center;
  vertical-align: middle;
}

.status-ok {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #d1fae5;
  color: #047857;
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1;
}

.status-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-badge.missing {
  background: #fee2e2;
  color: #b91c1c;
}

.status-badge.ambiguous {
  background: #fef3c7;
  color: #b45309;
}

.status-muted {
  font-size: 0.72rem;
}

.qty-btn {
  padding: 2px 8px;
  border: 1px solid #93c5fd;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.qty-caret {
  margin-left: 2px;
  font-size: 0.65rem;
}

.qty-num {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--text);
}

.instance-row {
  background: #fafbfc;
}

.instance-indent {
  font-size: 0.72rem;
}

.instance-tag {
  font-size: 0.72rem;
}

.instance-hint {
  font-size: 0.72rem;
}

.issue-count {
  color: #b45309;
  font-weight: 500;
}

.asm-tree-table tr.row-missing {
  background: #fffbeb;
}

.asm-tree-table tr.row-ambiguous {
  background: #fff7ed;
}

.col-action {
  width: 72px;
  white-space: nowrap;
}

.btn-row-action {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: #fff;
  font-size: 0.74rem;
  cursor: pointer;
}

.btn-row-action:hover {
  background: #f0f9ff;
  border-color: #7dd3fc;
  color: #0369a1;
}

.row-edited {
  background: #fffbeb;
}

.file-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.file-link:hover {
  text-decoration: underline;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
}

.muted {
  color: var(--muted);
}

.empty {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
