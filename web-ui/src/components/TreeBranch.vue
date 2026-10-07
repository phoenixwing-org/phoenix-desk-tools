<script setup lang="ts">
import { Document, Folder, FolderOpened } from "@element-plus/icons-vue";
import { computed } from "vue";
import TreeBranch from "./TreeBranch.vue";
import type { TreeNode } from "../api";

const props = defineProps<{
  node: TreeNode;
  selected: string | null;
  depth?: number;
  expansion: ReadonlyMap<string, boolean>;
  searching?: boolean;
}>();

const emit = defineEmits<{
  selectFile: [path: string];
  keepFile: [path: string];
  pickDir: [path: string];
  toggleDir: [path: string, expanded: boolean];
}>();

// Keep the workspace root visible; all child folders start collapsed outside search.
const expanded = computed(() => props.expansion.get(props.node.path) ?? (props.searching || (props.depth ?? 0) === 0));
const childCount = computed(() => props.node.children?.length ?? 0);
const hasChildren = computed(() => childCount.value > 0);

function toggleDir() {
  if (!hasChildren.value) return;
  emit("toggleDir", props.node.path, !expanded.value);
}

function treeKindTag(kind?: string) {
  const k = (kind ?? "").trim().toLowerCase();
  if (!k) return "?";
  if (k === "fcstd" || k === "fc") return "FC";
  if (k.startsWith("sw")) return "SW";
  if (k === "cpp") return "CPP";
  if (k === "hpp") return "HPP";
  if (k === "h") return "H";
  return k.length <= 4 ? k.toUpperCase() : k.slice(0, 4).toUpperCase();
}
</script>

<template>
  <div v-if="node.type === 'file'" class="tree-row tree-file" :class="{ active: selected === node.path }"
    @click="emit('selectFile', node.path)" @dblclick="emit('keepFile', node.path)">
    <span class="tree-twistie tree-twistie-leaf" aria-hidden="true">·</span>
    <el-tooltip :content="treeKindTag(node.kind)" placement="top" :show-after="400">
      <el-icon class="tree-kind-icon tree-file-icon" aria-hidden="true">
        <Document />
      </el-icon>
    </el-tooltip>
    <span class="tree-label" :title="node.path">{{ node.name }}</span>
  </div>
  <div v-else class="tree-dir">
    <button
      type="button"
      class="tree-row tree-dir-label"
      :class="{ 'is-collapsed': hasChildren && !expanded }"
      :aria-expanded="hasChildren ? expanded : undefined"
      @click="toggleDir"
    >
      <span v-if="hasChildren" class="tree-twistie" aria-hidden="true">{{ expanded ? "▼" : "▶" }}</span>
      <span v-else class="tree-twistie tree-twistie-leaf" aria-hidden="true">·</span>
      <el-icon class="tree-kind-icon tree-dir-icon" aria-hidden="true">
        <FolderOpened v-if="hasChildren && expanded" />
        <Folder v-else />
      </el-icon>
      <span class="tree-label tree-dir-name" :title="node.path || node.name">{{ node.name || "/" }}</span>
      <span v-if="hasChildren" class="tree-dir-count">{{ childCount }}</span>
      <span
        class="tree-dir-pick"
        title="pick 此目录"
        @click.stop="emit('pickDir', node.path)"
      >📌</span>
    </button>
    <div v-if="expanded && hasChildren" class="tree-children">
      <TreeBranch
        v-for="child in node.children ?? []"
        :key="child.path + child.name + child.type"
        :node="child"
        :selected="selected"
        :depth="(depth ?? 0) + 1"
        :expansion="expansion"
        :searching="searching"
        @select-file="(p) => emit('selectFile', p)"
        @keep-file="(p) => emit('keepFile', p)"
        @pick-dir="(p) => emit('pickDir', p)"
        @toggle-dir="(p, open) => emit('toggleDir', p, open)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
  padding: 2px 6px 2px 2px;
  border-radius: 4px;
  font-size: 0.82rem;
  line-height: 1.35;
  color: var(--phoenix-text);
}

.tree-twistie {
  flex-shrink: 0;
  width: 1.1em;
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--phoenix-text-muted);
  user-select: none;
}

.tree-twistie-leaf {
  font-weight: 400;
  color: var(--phoenix-text-muted);
}

.tree-kind-icon {
  flex-shrink: 0;
  font-size: 16px;
}

.tree-dir-icon {
  color: var(--phoenix-text-secondary);
}

.tree-file-icon {
  color: var(--phoenix-text-secondary);
}

.tree-label {
  min-width: 0;
  white-space: nowrap;
}

.tree-dir-name {
  font-weight: 600;
  color: var(--phoenix-text-secondary);
}

.tree-dir-count {
  flex-shrink: 0;
  padding-left: 6px;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--phoenix-text-muted);
}

.tree-dir-pick {
  flex-shrink: 0;
  margin-left: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.68rem;
  padding: 0 2px;
  opacity: 0.65;
  transition: opacity 0.15s;
}

.tree-dir-pick:hover {
  opacity: 1;
}

.tree-dir-label:hover .tree-dir-pick {
  opacity: 0.7;
}

.tree-file {
  cursor: pointer;
}

.tree-file:hover {
  background: var(--phoenix-hover-overlay);
  color: var(--phoenix-text);
}

.tree-file.active {
  background: var(--phoenix-accent-soft);
  color: var(--phoenix-accent);
  box-shadow: inset 2px 0 var(--phoenix-accent);
  font-weight: 500;
}

.tree-file.active .tree-kind-icon,
.tree-file.active .tree-twistie { color: inherit; }

.tree-dir-label {
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tree-dir-label:hover {
  background: var(--phoenix-hover-overlay);
}

.tree-dir-label:focus-visible { outline: 2px solid var(--phoenix-focus-ring); outline-offset: -2px; }

.tree-dir-label.is-collapsed .tree-dir-name {
  color: var(--phoenix-text-secondary);
}

.tree-children {
  margin-left: 0.55em;
  padding-left: 0.45em;
  border-left: 1px solid var(--phoenix-border);
}
</style>
