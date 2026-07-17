<script setup lang="ts">
import CaaDialogIndexPanel from "./CaaDialogIndexPanel.vue";
import CaaDialogTreePanel from "./CaaDialogTreePanel.vue";
import { CAA_EDITOR_PAGE_ID } from "../../constants/caaPages";

const props = withDefaults(defineProps<{
  pageId?: string;
  workbenchTabId?: string;
}>(), {
  pageId: "",
  workbenchTabId: "",
});
</script>

<template>
  <div class="caa-primary-block" aria-label="CAA Primary">
    <CaaDialogIndexPanel />
    <CaaDialogTreePanel v-if="props.pageId === CAA_EDITOR_PAGE_ID" />
  </div>
</template>

<style scoped>
.caa-primary-block {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.caa-primary-block > :deep(.caa-dialog-index-panel),
.caa-primary-block > :deep(.caa-dialog-tree-panel) { flex: 1 1 50%; min-height: 150px; }
.caa-primary-block > :deep(.caa-dialog-tree-panel) { border-top: 2px solid var(--border-strong); }
</style>
