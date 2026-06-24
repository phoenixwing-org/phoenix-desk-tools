<script setup lang="ts">
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaDialogGrid from "../CaaDialogGrid.vue";
import { useCaaControl } from "./useCaaControl";
import { useCaaContainerResize } from "./useCaaContainerResize";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
  widthStyle?: Record<string, string>;
}>();

const { isSelected, onClick, onContextmenu } = useCaaControl(props);
const resize = useCaaContainerResize(() => props.node);
</script>

<template>
  <div
    class="caa-container"
    :class="{ 'caa-container--selected': isSelected }"
    :style="widthStyle"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <CaaDialogGrid :node="node" :fill-parent="fillParent" :resize="resize" />
  </div>
</template>

<style scoped>
.caa-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  cursor: pointer;
}

.caa-container--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
  border-radius: 2px;
}

</style>
