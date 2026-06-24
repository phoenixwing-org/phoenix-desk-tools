<script setup lang="ts">
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaInlineNlsText from "../CaaInlineNlsText.vue";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
}>();

const { isSelected, onClick, onContextmenu, titleBinding } = useCaaControl(props);
</script>

<template>
  <label
    class="caa-label"
    :class="{ 'caa-label--selected': isSelected }"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <CaaInlineNlsText
      :text="titleBinding.text"
      :nls-key="titleBinding.key"
      :node-id="node.id"
      :prop="titleBinding.prop"
    />
  </label>
</template>

<style scoped>
.caa-label {
  font-size: 0.82rem;
  align-self: center;
  cursor: pointer;
}

.caa-label--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
  border-radius: 2px;
}
</style>
