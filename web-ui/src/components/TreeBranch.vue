<script setup lang="ts">
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

const pad = `${(props.depth ?? 0) * 14 + 8}px`;
</script>

<template>
  <div v-if="node.type === 'file'" class="tree-file" :class="{ active: selected === node.path }" :style="{ paddingLeft: pad }" @click="emit('selectFile', node.path)">
    [{{ node.kind ?? "?" }}] {{ node.name }}
  </div>
  <div v-else class="tree-dir">
    <div class="tree-dir-label" :style="{ paddingLeft: pad }">{{ node.name || "/" }}</div>
    <TreeBranch
      v-for="child in node.children ?? []"
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
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-file:hover {
  background: #eef2ff;
}

.tree-file.active {
  background: #dbeafe;
  font-weight: 500;
}

.tree-dir-label {
  padding: 4px 8px 4px 0;
  font-weight: 600;
  color: #334155;
}
</style>
