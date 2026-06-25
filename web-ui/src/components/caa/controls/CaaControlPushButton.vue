<script setup lang="ts">
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaInlineNlsText from "../CaaInlineNlsText.vue";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
}>();

const { isSelected, onClick, onContextmenu, titleBinding, helpTooltip } = useCaaControl(props);
</script>

<template>
  <button
    type="button"
    class="caa-btn"
    :class="{ 'caa-btn--selected': isSelected }"
    :title="helpTooltip" @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <CaaInlineNlsText
      :text="titleBinding.text"
      :nls-key="titleBinding.key"
      :node-id="node.id"
      :prop="titleBinding.prop"
    />
  </button>
</template>

<style scoped>
.caa-btn {
  font-size: 0.8rem;
  padding: 2px 10px;
  cursor: pointer;
}

.caa-btn--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}
</style>
