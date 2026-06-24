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

const { isSelected, onClick, onContextmenu, bindingFor } = useCaaControl(props);
const resize = useCaaContainerResize(() => props.node);

const showFrameBorder = computed(
  () => props.node.type === "CATDlgFrame" && !props.node.style?.includes("CATDlgFraNoFrame"),
);

const isFrame = computed(() => props.node.type === "CATDlgFrame");

const frameTitleBinding = computed(() => {
  if (!props.node.nls?.title?.trim()) return null;
  return bindingFor(props.node);
});
</script>

<template>
  <fieldset
    v-if="isFrame"
    class="caa-frame"
    :class="{
      'caa-frame--plain': !showFrameBorder,
      'caa-frame--fill': fillParent,
      'caa-frame--selected': isSelected,
    }"
    :style="widthStyle"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <legend v-if="showFrameBorder && frameTitleBinding">
      <CaaInlineNlsText
        :text="frameTitleBinding.text"
        :nls-key="frameTitleBinding.key"
        :node-id="node.id"
        :prop="frameTitleBinding.prop"
      />
    </legend>
    <CaaDialogGrid :node="node" :fill-parent="fillParent" :resize="resize" />
  </fieldset>
  <div v-else class="caa-unknown" @click="onClick">
    <span class="caa-unknown-type">{{ node.type.replace(/^CATDlg/, "") }}</span>
    <span class="caa-unknown-id">{{ node.id }}</span>
  </div>
</template>

<style scoped>
.caa-frame {
  margin: 0;
  padding: 6px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 4px;
  width: fit-content;
  max-width: 100%;
  height: fit-content;
  box-sizing: border-box;
  cursor: pointer;
}

.caa-frame--fill {
  width: 100%;
}

.caa-frame--plain {
  border: none;
  padding: 0;
}

.caa-frame--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-unknown {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 6px;
  font-size: 0.75rem;
  background: #fef9c3;
  border: 1px dashed #ca8a04;
  border-radius: 4px;
  min-width: 0;
  max-width: 100%;
  cursor: pointer;
}

.caa-unknown-type {
  font-weight: 600;
  color: #92400e;
}

.caa-unknown-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.7rem;
  color: #78716c;
}
</style>
