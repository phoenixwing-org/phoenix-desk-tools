<script setup lang="ts">
import { computed, ref } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaDialogGrid from "../CaaDialogGrid.vue";
import CaaInlineNlsText from "../CaaInlineNlsText.vue";
import { useCaaControl } from "./useCaaControl";
import { useCaaContainerResize } from "./useCaaContainerResize";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
  widthStyle?: Record<string, string>;
}>();

const { isSelected, onClick, onContextmenu, bindingFor } = useCaaControl(props);

const tabPages = computed(() =>
  props.node.children.filter((c) => c.type === "CATDlgTabPage"),
);

const activeTabIndex = ref(0);

function tabBinding(tab: CaaDialogNode) {
  return bindingFor(tab);
}

const activeTabPage = computed(() =>
  tabPages.value.length ? tabPages.value[activeTabIndex.value] : props.node,
);
const resize = useCaaContainerResize(() => activeTabPage.value);
</script>

<template>
  <div
    class="caa-tabcontainer"
    :class="{ 'caa-tabcontainer--selected': isSelected }"
    :style="widthStyle"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <div v-if="tabPages.length" class="caa-tab-bar">
      <button
        v-for="(tab, idx) in tabPages"
        :key="tab.id"
        type="button"
        class="caa-tab-chip"
        :class="{ active: activeTabIndex === idx }"
        @click.stop="activeTabIndex = idx"
      >
        <CaaInlineNlsText
          :text="tabBinding(tab).text"
          :nls-key="tabBinding(tab).key"
          :node-id="tab.id"
          :prop="tabBinding(tab).prop"
          class="caa-tab-chip-label"
        />
      </button>
    </div>
    <div class="caa-tab-body">
      <CaaDialogGrid
        v-if="tabPages.length"
        :node="tabPages[activeTabIndex]"
        :fill-parent="fillParent"
        :resize="resize"
      />
      <CaaDialogGrid v-else :node="node" :fill-parent="fillParent" :resize="resize" />
    </div>
  </div>
</template>

<style scoped>
.caa-tabcontainer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 4px;
  background: #fff;
  padding: 4px;
  cursor: pointer;
}

.caa-tabcontainer--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  padding-bottom: 4px;
}

.caa-tab-chip {
  font-size: 0.72rem;
  padding: 2px 8px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 3px 3px 0 0;
  background: #f1f5f9;
  cursor: pointer;
}

.caa-tab-chip.active {
  background: #fff;
  border-bottom-color: #fff;
  font-weight: 600;
}

.caa-tab-chip-label {
  pointer-events: auto;
}

.caa-tab-body {
  min-width: 0;
  padding: 4px 2px;
}

</style>
