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

const isMultiline = computed(() => props.node.style?.includes("CATDlgEdtMultiline"));
const controlRows = computed(() => props.node.size?.textHeight ?? 3);
</script>

<template>
  <textarea
    v-if="isMultiline"
    class="caa-editor caa-editor--multi"
    :class="{ 'caa-editor--selected': isSelected }"
    :style="resolvedWidth"
    :rows="controlRows"
    readonly
    placeholder=""
    :title="helpTooltip"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  />
  <input
    v-else
    class="caa-editor"
    :class="{ 'caa-editor--selected': isSelected }"
    :style="resolvedWidth"
    type="text"
    readonly
    placeholder=""
    :title="helpTooltip"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  />
</template>

<style scoped>
.caa-editor {
  width: auto;
  max-width: 100%;
  font-size: 0.8rem;
  box-sizing: border-box;
  cursor: pointer;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 2px 6px;
  background: #fff;
  color: #1e293b;
}

.caa-editor--multi {
  resize: none;
  min-height: 0;
}

.caa-editor--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}
</style>
