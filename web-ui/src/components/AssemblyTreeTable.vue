<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AssemblyTreeNode } from "../api";
import { useAppShell } from "../composables/useAppShell";

const props = defineProps<{
  nodes: AssemblyTreeNode[];
  loading?: boolean;
}>();

const shell = useAppShell();

type FlatRow = { node: AssemblyTreeNode; depth: number };

const expanded = ref<Set<string>>(new Set());

function hasChildren(node: AssemblyTreeNode): boolean {
  return (node.children?.length ?? 0) > 0;
}

function toggle(node: AssemblyTreeNode) {
  if (!hasChildren(node)) return;
  const next = new Set(expanded.value);
  if (next.has(node.id)) next.delete(node.id);
  else next.add(node.id);
  expanded.value = next;
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

watch(
  () => props.nodes,
  (nodes) => {
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
            <th>PartKey</th>
            <th>类型</th>
            <th>角色</th>
            <th>解析</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="{ node, depth } in flatRows" :key="node.id">
            <td class="name-cell">
              <div class="name-row" :style="{ paddingLeft: `${depth * 18 + 4}px` }">
                <button
                  type="button"
                  class="toggle"
                  :class="{ leaf: !hasChildren(node) }"
                  :aria-label="hasChildren(node) ? (expanded.has(node.id) ? '折叠' : '展开') : undefined"
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
  vertical-align: top;
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
  min-width: 280px;
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
  line-height: 1;
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
