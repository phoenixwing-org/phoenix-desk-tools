<script setup lang="ts">
import { computed } from "vue";
import { resolveGitStatusDisplay } from "../../utils/gitChangeView";
import type { GitChangeEntry } from "../../types/gitWorkspace";

const props = defineProps<{
  entry: GitChangeEntry;
}>();

const display = computed(() => resolveGitStatusDisplay(props.entry));
</script>

<template>
  <el-tooltip :content="display.title" placement="top" :show-after="400">
    <span class="git-status-badge" :class="`kind-${display.kind}`">{{ display.label }}</span>
  </el-tooltip>
</template>

<style scoped>
.git-status-badge {
  flex-shrink: 0;
  min-width: 28px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  cursor: default;
}

.kind-modified {
  color: #c69026;
}

.kind-added {
  color: var(--el-color-success);
}

.kind-untracked {
  color: #73c991;
}

.kind-deleted {
  color: var(--el-color-danger);
}

.kind-renamed,
.kind-copied {
  color: var(--el-color-primary);
}

.kind-typechange {
  color: var(--el-color-warning);
}

.kind-conflict {
  color: var(--el-color-danger);
  font-weight: 700;
}
</style>
