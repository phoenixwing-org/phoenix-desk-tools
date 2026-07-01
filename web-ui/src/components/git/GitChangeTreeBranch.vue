<script setup lang="ts">
import { computed, inject, ref } from "vue";
import ExpandCaret from "phoenix-wing/components/PnwExpandCaret.vue";
import GitChangePathLabel from "./GitChangePathLabel.vue";
import GitChangeRowActions from "./GitChangeRowActions.vue";
import GitChangeStatusBadge from "./GitChangeStatusBadge.vue";
import GitChangeTreeBranch from "./GitChangeTreeBranch.vue";
import {
  GIT_LIST_SELECTION_KEY,
  type GitListSelectionContext,
} from "../../composables/useGitListSelection";
import { type GitChangeTreeNode } from "../../utils/gitChangeView";
import type { GitChangeEntry } from "../../types/gitWorkspace";

const props = defineProps<{
  node: GitChangeTreeNode;
  depth?: number;
  staged?: boolean;
  revertable?: boolean;
  revertTooltip?: string;
  actionPaths: string[] | null;
  revertPaths?: string[] | null;
}>();

const emit = defineEmits<{
  stage: [paths: string[]];
  unstage: [paths: string[]];
  revert: [paths: string[]];
}>();

const selection = inject<GitListSelectionContext | null>(GIT_LIST_SELECTION_KEY, null);

const expanded = ref((props.depth ?? 0) < 2);
const childCount = computed(() => props.node.children?.length ?? 0);
const hasChildren = computed(() => childCount.value > 0);

function toggleDir() {
  if (!hasChildren.value) return;
  expanded.value = !expanded.value;
}

function resolvePaths(path: string): string[] {
  return selection?.resolveActionPaths(path) ?? [path];
}

function onAction(entry: GitChangeEntry) {
  const paths = resolvePaths(entry.path);
  if (props.staged) emit("unstage", paths);
  else emit("stage", paths);
}

function rowBusy(path: string) {
  return props.actionPaths?.includes(path) || props.revertPaths?.includes(path);
}

function onFileRowClick(e: MouseEvent, path: string) {
  selection?.onRowClick(e, path);
}
</script>

<template>
  <div
    v-if="node.type === 'file' && node.entry"
    class="git-tree-file git-file-row git-change-file-row"
    :class="{
      'is-selected': selection?.isSelected(node.path),
      'git-row-busy': rowBusy(node.path),
    }"
    :data-path="node.path"
    @click="onFileRowClick($event, node.path)"
  >
    <GitChangePathLabel class="git-path-cell" :path="node.path" :label="node.name" />
    <div class="git-row-tail">
      <GitChangeRowActions
        :path="node.path"
        :staged="staged"
        :revertable="revertable"
        :revert-tooltip="revertTooltip"
        :action-paths="actionPaths"
        :revert-paths="revertPaths ?? null"
        :diff-scope="staged ? 'staged' : 'worktree'"
        @stage="onAction(node.entry)"
        @unstage="onAction(node.entry)"
        @revert="emit('revert', resolvePaths(node.path))"
      />
      <GitChangeStatusBadge class="git-status-tail" :entry="node.entry" />
    </div>
  </div>
  <div v-else class="git-tree-dir">
    <button
      type="button"
      class="git-tree-dir-head"
      :aria-expanded="hasChildren ? expanded : undefined"
      @click="toggleDir"
    >
      <ExpandCaret :expanded="expanded" inline />
      <el-tooltip :content="node.path" placement="top-start" :show-after="450" :hide-after="0">
        <span class="git-tree-dir-name">{{ node.name }}</span>
      </el-tooltip>
      <span v-if="hasChildren" class="git-tree-dir-count">{{ childCount }}</span>
    </button>
    <div v-show="expanded && hasChildren" class="git-tree-children">
      <GitChangeTreeBranch
        v-for="child in node.children ?? []"
        :key="`${child.type}-${child.path}`"
        :node="child"
        :depth="(depth ?? 0) + 1"
        :staged="staged"
        :revertable="revertable"
        :revert-tooltip="revertTooltip"
        :action-paths="actionPaths"
        :revert-paths="revertPaths ?? null"
        @stage="(paths) => emit('stage', paths)"
        @unstage="(paths) => emit('unstage', paths)"
        @revert="(paths) => emit('revert', paths)"
      />
    </div>
  </div>
</template>

<style src="./git-row-actions.css"></style>

<style scoped>
.git-tree-dir-head {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin: 0;
  padding: 4px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}

.git-tree-dir-head:hover {
  color: var(--el-text-color-primary);
}

.git-tree-dir-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.git-tree-dir-head :deep(.el-tooltip__trigger) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.git-tree-dir-count {
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.git-tree-children {
  margin-left: 0.55em;
  padding-left: 0.45em;
  border-left: 1px solid var(--el-border-color-lighter);
}

.git-tree-file {
  padding-left: 0.2em;
  padding-right: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
  padding-bottom: 2px;
  min-height: 26px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  cursor: default;
  user-select: none;
}

.git-tree-file:last-child {
  border-bottom: none;
}

.git-tree-file:hover {
  background: var(--el-fill-color-light);
}

.git-tree-file.is-selected {
  background: var(--el-fill-color);
}

.git-path-cell {
  flex: 1;
  min-width: 0;
}
</style>
