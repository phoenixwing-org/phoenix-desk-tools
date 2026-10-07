<script setup lang="ts">
import { useGitDiffPreview } from "../../composables/useGitDiffPreview";

const props = withDefaults(
  defineProps<{
    path: string;
    scope?: "worktree" | "staged";
    disabled?: boolean;
    tooltip?: string;
  }>(),
  {
    scope: "worktree",
    disabled: false,
    tooltip: "预览 diff",
  },
);

const { preview } = useGitDiffPreview();

function onClick() {
  if (props.disabled || !props.path.trim()) return;
  void preview(props.path, props.scope);
}
</script>

<template>
  <el-tooltip :content="tooltip" placement="top" :show-after="400">
    <el-button
      link
      size="small"
      class="git-action-btn"
      :disabled="disabled"
      :aria-label="`${tooltip} ${path}`"
      @click.stop="onClick"
    >
      差异
    </el-button>
  </el-tooltip>
</template>

<style src="./git-row-actions.css"></style>
