<script setup lang="ts">
import type { NavItem } from "../../types/config";
import RibbonPanel from "./RibbonPanel.vue";
import type { RibbonTabDef } from "./ribbonConfig";

defineProps<{
  navigation: NavItem[];
  currentPage: string;
  canOpen: (pageId: string) => boolean;
  activeTabDef: RibbonTabDef | undefined;
  collapsed?: boolean;
}>();

const emit = defineEmits<{
  open: [pageId: string];
}>();
</script>

<template>
  <section class="ribbon-shell" :class="{ collapsed }" data-tour="ribbon-bar">
    <RibbonPanel
      v-if="!collapsed && activeTabDef"
      :tab="activeTabDef"
      :navigation="navigation"
      :current-page="currentPage"
      :can-open="canOpen"
      @open="emit('open', $event)"
    />
  </section>
</template>

<style scoped>
.ribbon-shell {
  flex-shrink: 0;
  background: #fff;
  border-bottom: 1px solid var(--border);
}
</style>
