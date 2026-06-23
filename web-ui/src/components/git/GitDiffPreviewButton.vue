<script setup lang="ts">
import { DocumentCopy } from "@element-plus/icons-vue";
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
      class="git-icon-btn"
      :disabled="disabled"
      :aria-label="`${tooltip} ${path}`"
      @click.stop="onClick"
    >
      <el-icon><DocumentCopy /></el-icon>
    </el-button>
  </el-tooltip>
</template>

<style src="./git-row-actions.css"></style>
