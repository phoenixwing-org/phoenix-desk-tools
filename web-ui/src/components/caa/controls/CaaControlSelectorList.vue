<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaInlineNlsText from "../CaaInlineNlsText.vue";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
  widthStyle?: Record<string, string>;
}>();

const widthOverride = computed(() => props.widthStyle);
const { isSelected, onClick, onContextmenu, selectorBinding, helpTooltip, widthStyle: resolvedWidth } = useCaaControl(props, { widthOverride });
</script>

<template>
  <div
    class="caa-selector caa-selector--mock"
    :class="{ 'caa-selector--selected': isSelected }"
    :style="resolvedWidth"
    :title="helpTooltip"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <CaaInlineNlsText
      :text="selectorBinding.text"
      :nls-key="selectorBinding.key"
      :node-id="node.id"
      :prop="selectorBinding.prop"
      allow-placeholder
    />
  </div>
</template>

<style scoped>
.caa-selector--mock {
  min-height: 1.6rem;
  padding: 2px 2px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 3px;
  background: #fff;
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  box-sizing: border-box;
  cursor: pointer;
}

.caa-selector--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

</style>
