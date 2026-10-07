<script setup lang="ts">
import GitDiffPreviewButton from "./GitDiffPreviewButton.vue";
import GitRevertWorktreeButton from "./GitRevertWorktreeButton.vue";

withDefaults(
  defineProps<{
    path: string;
    staged?: boolean;
    revertable?: boolean;
    revertTooltip?: string;
    actionPaths: string[] | null;
    revertPaths?: string[] | null;
    diffScope?: "worktree" | "staged";
  }>(),
  {
    staged: false,
    revertable: false,
    diffScope: "worktree",
  },
);

const emit = defineEmits<{
  stage: [];
  unstage: [];
  revert: [];
}>();
</script>

<template>
  <div class="git-row-actions">
    <GitDiffPreviewButton :path="path" :scope="diffScope" />
    <GitRevertWorktreeButton
      v-if="revertable"
      :path="path"
      :tooltip="revertTooltip"
      :loading="revertPaths?.includes(path)"
      @click="emit('revert')"
    />
    <el-tooltip :content="staged ? '取消暂存' : '暂存'" placement="top" :show-after="400">
      <el-button
        link
        size="small"
        class="git-action-btn"
        :aria-label="staged ? `取消暂存 ${path}` : `暂存 ${path}`"
        :loading="actionPaths?.includes(path)"
        @click.stop="staged ? emit('unstage') : emit('stage')"
      >
        {{ staged ? '取消暂存' : '暂存' }}
      </el-button>
    </el-tooltip>
  </div>
</template>

<style src="./git-row-actions.css"></style>
