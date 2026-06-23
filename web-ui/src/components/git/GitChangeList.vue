<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import GitChangeTreeBranch from "./GitChangeTreeBranch.vue";
import GitChangePathLabel from "./GitChangePathLabel.vue";
import GitChangeRowActions from "./GitChangeRowActions.vue";
import GitChangeStatusBadge from "./GitChangeStatusBadge.vue";
import {
  buildGitChangeTree,
  gitFileName,
  type GitListViewMode,
} from "../../utils/gitChangeView";
import {
  GIT_LIST_SELECTION_KEY,
  useGitListSelection,
} from "../../composables/useGitListSelection";
import type { GitChangeEntry } from "../../types/gitWorkspace";

const props = defineProps<{
  rows: GitChangeEntry[];
  mode: GitListViewMode;
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

const rowPaths = computed(() => props.rows.map((row) => row.path));
const listRoot = ref<HTMLElement | null>(null);

const {
  selectedPaths,
  marquee,
  isSelected,
  onRowClick,
  onListPointerDown,
  resolveActionPaths,
  clearSelection,
} = useGitListSelection(rowPaths);

provide(GIT_LIST_SELECTION_KEY, {
  isSelected,
  onRowClick,
  resolveActionPaths,
});

const treeRoots = computed(() => buildGitChangeTree(props.rows));

function rowBusy(path: string) {
  return props.actionPaths?.includes(path) || props.revertPaths?.includes(path);
}

function onListRootPointerDown(e: PointerEvent) {
  if (!listRoot.value) return;
  onListPointerDown(e, listRoot.value);
}

function emitStage(path: string) {
  emit("stage", resolveActionPaths(path));
}

function emitUnstage(path: string) {
  emit("unstage", resolveActionPaths(path));
}

function emitRevert(path: string) {
  emit("revert", resolveActionPaths(path));
}

watch(
  () => [props.actionPaths, props.revertPaths] as const,
  ([nextAction, nextRevert], [prevAction, prevRevert]) => {
    const wasBusy = Boolean(prevAction?.length || prevRevert?.length);
    const isBusy = Boolean(nextAction?.length || nextRevert?.length);
    if (wasBusy && !isBusy) clearSelection();
  },
);
</script>

<template>
  <div
    ref="listRoot"
    class="git-change-list-root"
    :class="{ 'has-selection': selectedPaths.size > 0 }"
    @pointerdown="onListRootPointerDown"
  >
    <div
      v-if="marquee"
      class="git-marquee"
      :style="{
        left: `${marquee.left}px`,
        top: `${marquee.top}px`,
        width: `${marquee.width}px`,
        height: `${marquee.height}px`,
      }"
    />
    <ul v-if="mode === 'file'" class="git-file-list">
      <li
        v-for="row in rows"
        :key="row.path"
        class="git-file-row git-change-file-row"
        :class="{
          'is-selected': isSelected(row.path),
          'git-row-busy': rowBusy(row.path),
        }"
        :data-path="row.path"
        @click="onRowClick($event, row.path)"
      >
        <GitChangePathLabel class="git-path-cell" :path="row.path" :label="gitFileName(row.path)" />
        <div class="git-row-tail">
          <GitChangeRowActions
            :path="row.path"
            :staged="staged"
            :revertable="revertable"
            :revert-tooltip="revertTooltip"
            :action-paths="actionPaths"
            :revert-paths="revertPaths ?? null"
            :diff-scope="staged ? 'staged' : 'worktree'"
            @stage="emitStage(row.path)"
            @unstage="emitUnstage(row.path)"
            @revert="emitRevert(row.path)"
          />
          <GitChangeStatusBadge class="git-status-tail" :entry="row" />
        </div>
      </li>
    </ul>
    <div v-else class="git-change-tree">
      <GitChangeTreeBranch
        v-for="node in treeRoots"
        :key="`${node.type}-${node.path}`"
        :node="node"
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
.git-change-list-root {
  position: relative;
}

.git-marquee {
  position: absolute;
  border: 1px solid var(--el-color-primary);
  background: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
  pointer-events: none;
  z-index: 2;
}

.git-file-list,
.git-change-tree {
  list-style: none;
  margin: 0;
  padding: 0;
}

.git-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 0;
  min-height: 26px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  cursor: default;
  user-select: none;
}

.git-file-row:last-child {
  border-bottom: none;
}

.git-file-row:hover {
  background: var(--el-fill-color-light);
}

.git-file-row.is-selected {
  background: var(--el-fill-color);
}

.git-path-cell {
  flex: 1;
  min-width: 0;
}
</style>
