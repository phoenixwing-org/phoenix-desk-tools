<script setup lang="ts">
import { computed } from "vue";
import type { NavItem } from "../../types/config";
import { useUiPrefsStore } from "../../stores/uiPrefs";
import { WORKSPACE_GATE_MSG } from "../../utils/onboardingConstants";
import RibbonGroup, { type RibbonGroupItem } from "./RibbonGroup.vue";
import RibbonModuleToggles from "./RibbonModuleToggles.vue";
import RibbonWorkspaceSwitcher from "./RibbonWorkspaceSwitcher.vue";
import RibbonToolButton from "./RibbonToolButton.vue";
import { RIBBON_SHELL_TAB_ID, type RibbonGroupDef, type RibbonTabDef } from "./ribbonConfig";
import { ribbonIconFor } from "./ribbonIcons";
import { CAA_EDITOR_PAGE_ID, CAA_HOME_PAGE_ID } from "../../constants/caaPages";

const props = defineProps<{
  tab: RibbonTabDef;
  navigation: NavItem[];
  currentPage: string;
  canOpen: (pageId: string) => boolean;
}>();

const emit = defineEmits<{
  open: [pageId: string];
}>();

const uiPrefs = useUiPrefsStore();

const isInline = computed(() => uiPrefs.ribbonLayoutMode === "inline");

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
          icon: ribbonIconFor(item.pageId),
          active:
            props.currentPage === item.pageId ||
            (item.pageId === CAA_HOME_PAGE_ID && props.currentPage === CAA_EDITOR_PAGE_ID),
          disabled,
          title: disabled ? WORKSPACE_GATE_MSG : nav.description || nav.label,
        });
      }
      return items.length ? { label: group.label, items } : null;
    })
    .filter((g): g is { label: string; items: RibbonGroupItem[] } => g !== null);
}

const visibleGroups = computed(() => resolveGroups(props.tab.groups));

const flatItems = computed(() => visibleGroups.value.flatMap((g) => g.items));

const isShellTab = computed(() => props.tab.id === RIBBON_SHELL_TAB_ID);
</script>

<template>
  <div
    v-if="visibleGroups.length"
    class="ribbon-panel"
    :class="{ 'ribbon-panel-inline': isInline }"
  >
    <div class="ribbon-panel-body">
      <template v-if="isInline">
        <RibbonToolButton
          v-for="item in flatItems"
          :key="item.pageId"
          :label="item.label"
          :icon="item.icon"
          size="small"
          layout="inline"
          :active="item.active"
          :disabled="item.disabled"
          :title="item.title"
          @click="emit('open', item.pageId)"
        />
      </template>
      <template v-else>
        <RibbonGroup
          v-for="(group, idx) in visibleGroups"
          :key="`${tab.id}-${idx}`"
          :label="group.label"
          :items="group.items"
          @open="emit('open', $event)"
        />
      </template>
      <RibbonWorkspaceSwitcher v-if="isShellTab" :layout="isInline ? 'inline' : 'group'" />
      <RibbonModuleToggles v-if="isShellTab" :layout="isInline ? 'inline' : 'group'" />
      <div class="ribbon-panel-spacer" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.ribbon-panel {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: var(--ribbon-panel-height, 66px);
  min-height: var(--ribbon-panel-height, 66px);
  max-height: var(--ribbon-panel-height, 66px);
  overflow: hidden;
  padding: 0;
  background: var(--ribbon-bg, #fff);
}

.ribbon-panel-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 2px;
}

.ribbon-panel-spacer {
  flex: 1;
  min-width: 8px;
}

.ribbon-panel-inline {
  --ribbon-panel-height: 44px;
}

.ribbon-panel-inline .ribbon-panel-body {
  flex-wrap: nowrap;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}

.ribbon-panel-inline :deep(.ribbon-tool-btn.layout-inline) {
  width: auto;
  min-width: 0;
  max-width: none;
  min-height: 36px;
  padding: 0 10px;
  gap: 5px;
  flex-shrink: 0;
}

.ribbon-panel-inline :deep(.layout-inline .ribbon-tool-label) {
  font-size: 0.72rem;
  line-height: 1.2;
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
  max-width: none;
}

.ribbon-panel-inline :deep(.layout-inline .ribbon-tool-icon) {
  width: 15px;
  height: 15px;
  font-size: 14px;
}

.ribbon-panel-inline .ribbon-layout-toggle {
  width: 36px;
  padding: 1px 2px;
}

.ribbon-layout-toggle {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 40px;
  margin: 0;
  padding: 2px 4px;
  border: none;
  border-left: 1px solid var(--ribbon-group-divider);
  background: #f4f6f8;
  color: var(--muted);
  cursor: pointer;
  font-size: 0.62rem;
  line-height: 1.1;
}

.ribbon-layout-toggle:hover {
  background: var(--ribbon-btn-hover);
  color: var(--text);
}

.toggle-icon {
  font-size: 0.85rem;
  line-height: 1;
}

.toggle-label {
  white-space: nowrap;
}
</style>
