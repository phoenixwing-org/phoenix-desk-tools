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
    class="caa-check"
    :class="{ 'caa-check--selected': isSelected }"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <input type="checkbox" @click.prevent />
    <CaaInlineNlsText
      :text="titleBinding.text"
      :nls-key="titleBinding.key"
      :node-id="node.id"
      :prop="titleBinding.prop"
    />
  </label>
</template>

<style scoped>
.caa-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  cursor: pointer;
}

.caa-check input {
  flex-shrink: 0;
}

.caa-check--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
  border-radius: 2px;
}
</style>
