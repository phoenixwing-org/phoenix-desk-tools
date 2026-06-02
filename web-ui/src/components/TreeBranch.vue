<script setup lang="ts">
import { computed, ref } from "vue";
import TreeBranch from "./TreeBranch.vue";
import type { TreeNode } from "../api";

const props = defineProps<{
  node: TreeNode;
  selected: string | null;
  depth?: number;
}>();

const emit = defineEmits<{
  selectFile: [path: string];
}>();

const expanded = ref(true);
const childCount = computed(() => props.node.children?.length ?? 0);
const hasChildren = computed(() => childCount.value > 0);

const pad = `${(props.depth ?? 0) * 14 + 8}px`;

function toggleDir() {
  if (!hasChildren.value) return;
  expanded.value = !expanded.value;
}

function treeKindTag(kind?: string) {
  const k = (kind ?? "").trim();
  if (!k) return "?";
  if (k === "FCStd" || k === "FC") return "FC";
  if (k.startsWith("SW")) return "SW";
  return k.length <= 4 ? k.toUpperCase() : k.slice(0, 4);
}
</script>

<template>
  <div v-if="node.type === 'file'" class="tree-file" :class="{ active: selected === node.path }" :style="{ paddingLeft: pad }" @click="emit('selectFile', node.path)">
    <span class="tree-kind">[{{ treeKindTag(node.kind) }}]</span> {{ node.name }}
  </div>
  <div v-else class="tree-dir">
    <button
      type="button"
      class="tree-dir-label"
      :class="{ 'is-collapsed': hasChildren && !expanded }"
      :style="{ paddingLeft: pad }"
      :aria-expanded="hasChildren ? expanded : undefined"
      @click="toggleDir"
    >
      <span v-if="hasChildren" class="tree-twistie" aria-hidden="true">{{ expanded ? "▾" : "▸" }}</span>
      <span v-else class="tree-twistie tree-twistie-placeholder" aria-hidden="true" />
      <span class="tree-dir-name">{{ node.name || "/" }}</span>
    </button>
    <TreeBranch
      v-for="child in node.children ?? []"
      v-show="expanded"
      :key="child.path + child.name + child.type"
      :node="child"
      :selected="selected"
      :depth="(depth ?? 0) + 1"
      @select-file="(p) => emit('selectFile', p)"
    />
  </div>
</template>

<style scoped>
.tree-file {
  padding: 3px 8px 3px 0;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.82rem;
}

.tree-kind {
  display: inline-block;
  min-width: 2.4em;
  margin-right: 2px;
  font-size: 0.68rem;
  font-weight: 600;
  color: #64748b;
  letter-spacing: -0.02em;
}

.tree-file:hover {
  background: #eef2ff;
}

.tree-file.active {
  background: #dbeafe;
  font-weight: 500;
}

.tree-dir-label {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 4px 8px 4px 0;
  border: none;
  background: transparent;
  font: inherit;
  font-weight: 600;
  color: #334155;
  text-align: left;
  cursor: pointer;
}

.tree-dir-label:hover {
  background: #f1f5f9;
}

.tree-dir-name {
  white-space: nowrap;
}

.tree-twistie {
  flex-shrink: 0;
  width: 1em;
  font-size: 0.72rem;
  color: #64748b;
  line-height: 1;
}

.tree-twistie-placeholder {
  visibility: hidden;
}
</style>
