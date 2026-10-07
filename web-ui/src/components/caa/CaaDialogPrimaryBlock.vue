<script setup lang="ts">
import PrimaryPanel from "phoenix-wing/layout/PnwPrimaryPanel.vue";
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
  <PrimaryPanel class="caa-primary-block" title="CAA 对话框" aria-label="CAA Primary">
    <CaaDialogIndexPanel />
    <CaaDialogTreePanel v-if="props.pageId === CAA_EDITOR_PAGE_ID" />
  </PrimaryPanel>
</template>
