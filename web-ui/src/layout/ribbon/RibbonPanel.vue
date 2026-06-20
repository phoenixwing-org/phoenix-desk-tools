<script setup lang="ts">
import { computed } from "vue";
import type { NavItem } from "../../types/config";
import { WORKSPACE_GATE_MSG } from "../../utils/onboardingConstants";
import RibbonGroup, { type RibbonGroupItem } from "./RibbonGroup.vue";
import type { RibbonGroupDef, RibbonTabDef } from "./ribbonConfig";
import { ribbonIconFor } from "./ribbonIcons";

const props = defineProps<{
  tab: RibbonTabDef;
  navigation: NavItem[];
  currentPage: string;
  canOpen: (pageId: string) => boolean;
}>();

const emit = defineEmits<{
  open: [pageId: string];
}>();

function navFor(pageId: string): NavItem | undefined {
  return props.navigation.find((n) => n.page === pageId);
}

function resolveGroups(groups: RibbonGroupDef[]) {
  return groups
    .map((group) => {
      const items: RibbonGroupItem[] = [];
      for (const item of group.items) {
        const nav = navFor(item.pageId);
        if (!nav) continue;
        const disabled = !props.canOpen(item.pageId);
        items.push({
          pageId: item.pageId,
          label: item.label || nav.label,
          size: item.size || "small",
          icon: ribbonIconFor(item.pageId),
          active: props.currentPage === item.pageId,
          disabled,
          title: disabled ? WORKSPACE_GATE_MSG : nav.description || nav.label,
        });
      }
      return items.length ? { label: group.label, items } : null;
    })
    .filter((g): g is { label: string; items: RibbonGroupItem[] } => g !== null);
}

const visibleGroups = computed(() => resolveGroups(props.tab.groups));
</script>

<template>
  <div v-if="visibleGroups.length" class="ribbon-panel">
    <RibbonGroup
      v-for="(group, idx) in visibleGroups"
      :key="`${tab.id}-${idx}`"
      :label="group.label"
      :items="group.items"
      @open="emit('open', $event)"
    />
  </div>
</template>

<style scoped>
.ribbon-panel {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: var(--ribbon-panel-height, 58px);
  min-height: var(--ribbon-panel-height, 58px);
  max-height: var(--ribbon-panel-height, 58px);
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 2px;
}
</style>
