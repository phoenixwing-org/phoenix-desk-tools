<script setup lang="ts">
defineProps<{
  expanded?: boolean;
  /** 仅图标、无按钮外框（用于数量芯片内等） */
  inline?: boolean;
}>();
</script>

<template>
  <span
    class="phoenix-expand-twistie"
    :class="{ 'is-expanded': expanded, 'phoenix-expand-twistie-inline': inline }"
    aria-hidden="true"
  />
</template>
