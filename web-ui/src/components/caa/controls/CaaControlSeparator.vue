<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
}>();

const { isSelected, onClick, onContextmenu } = useCaaControl(props);

const isVertical = computed(() => props.node.style?.includes("CATDlgCtrVertical"));
</script>

<template>
  <hr
    class="caa-sep"
    :class="{
      'caa-sep--vertical': isVertical,
      'caa-sep--selected': isSelected,
    }"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  />
</template>

<style scoped>
.caa-sep {
  border: none;
  border-top: 1px solid var(--border, #cbd5e1);
  margin: 4px 0;
  width: 100%;
  cursor: pointer;
}

.caa-sep--vertical {
  border: none;
  border-left: 1px solid var(--border, #cbd5e1);
  width: 0;
  min-height: 24px;
  margin: 0 4px;
  align-self: stretch;
}

.caa-sep--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

</style>
