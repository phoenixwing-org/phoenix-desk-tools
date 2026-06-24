<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaDialogGrid from "../CaaDialogGrid.vue";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
  widthStyle?: Record<string, string>;
}>();

const widthOverride = computed(() => props.widthStyle);
const { isSelected, onClick, onContextmenu, helpTooltip, widthStyle: resolvedWidth } = useCaaControl(props, { widthOverride });
</script>

<template>
  <div
    class="caa-selector"
    :class="{ 'caa-selector--selected': isSelected }"
    :style="resolvedWidth"
    :title="helpTooltip"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <CaaDialogGrid v-if="node.children.length" :node="node" :fill-parent="fillParent" />
  </div>
</template>

<style scoped>
.caa-selector {
  min-height: 1.6rem;
  min-width: 60px;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  background: #fff;
  box-sizing: border-box;
  cursor: pointer;
}

.caa-selector--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}
</style>
