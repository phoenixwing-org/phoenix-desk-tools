<script setup lang="ts">
/** @deprecated 使用 FileDetailPage；保留 pageId bom_apply 以兼容会话恢复 */
import FileDetailPage from "./FileDetailPage.vue";

defineProps<{ workbenchTabId?: string }>();
</script>

<template>
  <FileDetailPage :workbench-tab-id="workbenchTabId" />
</template>
