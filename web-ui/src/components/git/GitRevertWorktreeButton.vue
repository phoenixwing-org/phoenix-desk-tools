<script setup lang="ts">
import { RefreshLeft } from "@element-plus/icons-vue";

const props = withDefaults(
  defineProps<{
    path: string;
    loading?: boolean;
    disabled?: boolean;
    tooltip?: string;
  }>(),
  {
    loading: false,
    disabled: false,
    tooltip: "放弃更改",
  },
);

const emit = defineEmits<{
  click: [];
}>();

function onClick() {
  if (props.loading || props.disabled) return;
  emit("click");
}
</script>

<template>
  <el-tooltip :content="props.tooltip" placement="top" :show-after="400">
    <el-button
      link
      size="small"
      class="git-icon-btn"
      :disabled="props.disabled"
      :loading="props.loading"
      :aria-label="`${props.tooltip} ${props.path}`"
      @click.stop="onClick"
    >
      <el-icon><RefreshLeft /></el-icon>
    </el-button>
  </el-tooltip>
</template>

<style src="./git-row-actions.css"></style>
