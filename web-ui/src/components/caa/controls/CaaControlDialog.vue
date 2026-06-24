<script setup lang="ts">
import { computed } from "vue";
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

const { isSelected, onClick, onContextmenu, titleBinding, dialogStyle } = useCaaControl(props);
const resize = useCaaContainerResize(() => props.node);

const hasDialogButtons = computed(() =>
  props.node.style?.some((s) => s.includes("CATDlgWndBtn")),
);
</script>

<template>
  <div
    class="caa-dialog"
    :class="{ 'caa-dialog--selected': isSelected }"
    :style="widthStyle ?? dialogStyle"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <div class="caa-dialog-title">
      <CaaInlineNlsText
        :text="titleBinding.text"
        :nls-key="titleBinding.key"
        :node-id="node.id"
        :prop="titleBinding.prop"
      />
    </div>
    <CaaDialogGrid :node="node" class="caa-dialog-body" fill-parent :dialog-root="node" :resize="resize" />
    <div v-if="hasDialogButtons" class="caa-dialog-actions">
      <button type="button" class="caa-btn" disabled>OK</button>
      <button type="button" class="caa-btn" disabled>Cancel</button>
      <button type="button" class="caa-btn" disabled>Preview</button>
    </div>
  </div>
</template>

<style scoped>
.caa-dialog {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-width: 100%;
  height: fit-content;
  box-sizing: border-box;
  border: 1px solid var(--border-strong, #94a3b8);
  border-radius: 6px;
  background: var(--page-bg, #f8fafc);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
  cursor: pointer;
}

.caa-dialog--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-dialog-title {
  flex: 0 0 auto;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: linear-gradient(180deg, #f1f5f9, #e2e8f0);
}

.caa-dialog-body {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
}

.caa-dialog-actions {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border, #e2e8f0);
}

.caa-btn {
  font-size: 0.8rem;
  padding: 2px 10px;
}
</style>
