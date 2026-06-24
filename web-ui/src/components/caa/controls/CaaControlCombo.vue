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
  <div
    class="caa-combo"
    :class="{ 'caa-combo--selected': isSelected }"
    :style="resolvedWidth"
    :title="helpTooltip"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <span class="caa-combo-arrow">▾</span>
  </div>
</template>

<style scoped>
.caa-combo {
  min-height: 1.6rem;
  min-width: 80px;
  padding: 2px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  box-sizing: border-box;
  cursor: pointer;
}

.caa-combo--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-combo-arrow {
  color: #94a3b8;
  font-size: 0.6rem;
}
</style>
