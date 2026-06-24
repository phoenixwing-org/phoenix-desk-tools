<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
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
  <input
    class="caa-spinner"
    :class="{ 'caa-spinner--selected': isSelected }"
    :style="resolvedWidth"
    type="number"
    readonly
    :placeholder="node.id"
    :title="helpTooltip" @click="onClick"
    @contextmenu="onContextmenu($event)"
  />
</template>

<style scoped>
.caa-spinner {
  width: auto;
  max-width: 100%;
  font-size: 0.75rem;
  box-sizing: border-box;
  cursor: pointer;
}

.caa-spinner--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

</style>
