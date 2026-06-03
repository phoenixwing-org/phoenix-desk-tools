<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AssemblyTreeNode, AssemblyXrefInstance, LinkLabelPatch } from "../api";
import { useAppShell } from "../composables/useAppShell";

const props = withDefaults(
  defineProps<{
    nodes: AssemblyTreeNode[];
    loading?: boolean;
    editable?: boolean;
  }>(),
  { editable: true },
);

const emit = defineEmits<{
  "edits-change": [hasEdits: boolean];
}>();

const shell = useAppShell();

type FlatRow = { node: AssemblyTreeNode; depth: number };
type InstanceRow = {
  node: AssemblyTreeNode;
  depth: number;
  instance: AssemblyXrefInstance;
  instanceIndex: number;
};

const expanded = ref<Set<string>>(new Set());
const expandedLabels = ref<Set<string>>(new Set());
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

function setLabel(host: string, inst: AssemblyXrefInstance, value: string) {
  const key = editKey(host, inst.xlink_file_attr);
  const base = baselineLabel(host, inst);
  const next = new Map(edits.value);
  if (value.trim() === base.trim()) next.delete(key);
  else next.set(key, value);
  edits.value = next;
  emit("edits-change", next.size > 0);
}

function hasChildren(node: AssemblyTreeNode) {
  return (node.children?.length ?? 0) > 0;
}

function toggle(node: AssemblyTreeNode) {
  if (!hasChildren(node)) return;
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

function flatten(nodes: AssemblyTreeNode[], depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (hasChildren(node) && expanded.value.has(node.id)) {
      flatten(node.children, depth + 1, out);
    }
  }
  return out;
}

const flatRows = computed(() => flatten(props.nodes));

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

function expandAll(nodes: AssemblyTreeNode[]) {
  const next = new Set(expanded.value);
  for (const node of nodes) {
    if (hasChildren(node)) {
      next.add(node.id);
      expandAll(node.children);
    }
  }
  expanded.value = next;
}

function collapseAll() {
  expanded.value = new Set();
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    part: "零件",
    drawing: "工程图",
    assembly: "装配",
  };
  return map[role] ?? role;
}

function openFileDetail(node: AssemblyTreeNode) {
  const rel = node.repo_rel_path?.trim();
  if (!rel) return;
  shell.openFileDetailForRel(rel);
}

function openPartKey(node: AssemblyTreeNode) {
  const pn = node.part_number?.trim();
  const pv = node.part_version?.trim();
  if (!pn || !pv) return;
  shell.openPartKeyDetail(pn, pv, { partName: node.PartName?.trim() || undefined });
}

function walkNodes(nodes: AssemblyTreeNode[], fn: (n: AssemblyTreeNode) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.children?.length) walkNodes(n.children, fn);
  }
}

function getPendingPatches(): LinkLabelPatch[] {
  const patches: LinkLabelPatch[] = [];
  walkNodes(props.nodes, (node) => {
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

function hasEdits() {
  return edits.value.size > 0;
}

function resetEdits() {
  edits.value = new Map();
  emit("edits-change", false);
}

defineExpose({ getPendingPatches, hasEdits, resetEdits });

watch(
  () => props.nodes,
  (nodes) => {
    edits.value = new Map();
    expandedLabels.value = new Set();
    emit("edits-change", false);
    expanded.value = new Set();
    for (const node of nodes) {
      if (hasChildren(node)) expanded.value.add(node.id);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="asm-tree-wrap">
    <div class="asm-tree-toolbar">
      <button type="button" class="btn mini" :disabled="loading || !nodes.length" @click="expandAll(nodes)">
        全部展开
      </button>
      <button type="button" class="btn mini" :disabled="loading || !nodes.length" @click="collapseAll">
        全部折叠
      </button>
      <span class="count">{{ flatRows.length }} 行 · 根 {{ nodes.length }}</span>
    </div>

    <div v-if="loading" class="empty">加载装配树…</div>
    <div v-else-if="!nodes.length" class="empty">无下级引用（或引用表未构建）</div>
    <div v-else class="table-scroll">
      <table class="asm-tree-table">
        <thead>
          <tr>
            <th>名称</th>
            <th title="装配树 Link.Label">子件零件名</th>
            <th title="目标文件规则显示名" class="col-rule">规则名</th>
            <th class="col-qty">数量</th>
            <th>零件标识</th>
            <th>类型码</th>
            <th>角色</th>
            <th>解析</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="{ node, depth } in flatRows" :key="node.id">
            <tr :class="{ 'row-edited': editable && instancesOf(node).some((i) => edits.has(editKey(node.host_repo_rel, i.xlink_file_attr))) }">
              <td class="name-cell">
                <div class="name-row" :style="{ paddingLeft: `${depth * 18 + 4}px` }">
                  <button
                    type="button"
                    class="toggle"
                    :class="{ leaf: !hasChildren(node) }"
                    :disabled="!hasChildren(node)"
                    @click="toggle(node)"
                  >
                    {{ hasChildren(node) ? (expanded.has(node.id) ? "▾" : "▸") : "·" }}
                  </button>
                  <button
                    v-if="node.repo_rel_path"
                    type="button"
                    class="basename mono file-link"
                    :title="node.repo_rel_path"
                    @click="openFileDetail(node)"
                  >
                    {{ node.basename }}
                  </button>
                  <span v-else class="basename mono">{{ node.basename }}</span>
                </div>
              </td>
              <td class="link-label-cell">
                <template v-if="editable && instancesOf(node)[0]">
                  <input
                    class="label-input mono"
                    :value="displayLabel(node.host_repo_rel, instancesOf(node)[0])"
                    spellcheck="false"
                    @input="setLabel(node.host_repo_rel, instancesOf(node)[0], ($event.target as HTMLInputElement).value)"
                  />
                </template>
                <span v-else-if="node.link_label" class="mono clamp-2" :title="node.link_label">{{ node.link_label }}</span>
                <span v-else class="muted">—</span>
              </td>
              <td class="rule-cell mono muted">
                <span class="clamp-2" :title="node.rule_label || undefined">{{ node.rule_label || "—" }}</span>
              </td>
              <td class="col-qty">
                <button
                  v-if="(node.ref_count ?? 1) > 1"
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
              <td class="mono">
                <button
                  v-if="node.part_number && node.part_version"
                  type="button"
                  class="file-link"
                  @click="openPartKey(node)"
                >
                  {{ node.part_key || `${node.part_number}.${node.part_version}` }}
                </button>
                <span v-else>{{ node.part_key || "—" }}</span>
              </td>
              <td>{{ node.TypeCode || "—" }}</td>
              <td>{{ roleLabel(node.file_role) }}</td>
              <td>{{ node.resolve_status }}</td>
            </tr>
            <tr
              v-for="extra in instanceExtraRows(node, depth)"
              :key="`${node.id}-inst-${extra.instanceIndex}`"
              class="instance-row"
              :class="{ 'row-edited': edits.has(editKey(node.host_repo_rel, extra.instance.xlink_file_attr)) }"
            >
              <td class="name-cell instance-indent" :style="{ paddingLeft: `${depth * 18 + 28}px` }">
                <span class="muted instance-tag">#{{ extra.instanceIndex + 1 }}</span>
              </td>
              <td class="link-label-cell">
                <input
                  v-if="editable"
                  class="label-input mono"
                  :value="displayLabel(node.host_repo_rel, extra.instance)"
                  spellcheck="false"
                  @input="setLabel(node.host_repo_rel, extra.instance, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td colspan="6" class="muted instance-hint">同目标第 {{ extra.instanceIndex + 1 }} 个引用实例</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.asm-tree-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.asm-tree-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: #f8fafc;
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
  margin-left: auto;
  font-size: 0.78rem;
  color: var(--muted);
}

.table-scroll {
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

.name-cell {
  min-width: 220px;
}

.name-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.toggle {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: #64748b;
  font-size: 0.72rem;
}

.toggle.leaf {
  cursor: default;
  color: #cbd5e1;
}

.basename {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-label-cell {
  min-width: 100px;
  max-width: 200px;
  vertical-align: middle;
}

.label-input {
  width: 100%;
  min-width: 120px;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.76rem;
  box-sizing: border-box;
}

.rule-cell {
  min-width: 88px;
  max-width: 160px;
  font-size: 0.76rem;
  vertical-align: middle;
}

.col-rule {
  min-width: 88px;
}

.clamp-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  overflow-wrap: break-word;
  word-break: normal;
  line-height: 1.35;
  max-height: calc(1.35em * 2);
}

.col-qty {
  width: 52px;
  text-align: center;
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
