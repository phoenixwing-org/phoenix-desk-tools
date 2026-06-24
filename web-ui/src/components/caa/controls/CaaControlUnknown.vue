<script setup lang="ts">
/**
 * 未识别 CAA 控件类型 · 灰盒占位。
 * 显示类型名 + ID，保留子控件 Grid 渲染。
 */
import { computed, inject } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import { CAA_CONTROL_KEY } from "../../../composables/useCaaControlContext";
import CaaDialogGrid from "../CaaDialogGrid.vue";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
}>();

const ctx = inject(CAA_CONTROL_KEY, null);

const isSelected = computed(() => ctx?.selectedId.value === props.node.id);

function onClick(e: MouseEvent) {
  e.stopPropagation();
  if (ctx) ctx.select(props.node.id);
}

function onContextmenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (!ctx) return;
  ctx.select(props.node.id);
  ctx.showContextMenu(props.node.id, [
    { label: `类型: ${props.node.type}`, disabled: true, action: () => {} },
    { label: "此控件类型未注册组件", disabled: true, action: () => {} },
  ], { x: e.clientX, y: e.clientY });
}
</script>

<template>
  <div
    class="caa-unknown"
    :class="{ 'caa-unknown--selected': isSelected }"
    @click="onClick"
    @contextmenu="onContextmenu"
  >
    <span class="caa-unknown-type">{{ node.type.replace(/^CATDlg/, "") }}</span>
    <span class="caa-unknown-id">{{ node.id }}</span>
    <CaaDialogGrid
      v-if="node.children.length"
      :node="node"
      class="caa-unknown-children"
      :fill-parent="fillParent"
    />
  </div>
</template>

<style scoped>
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

.caa-unknown--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
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

.caa-unknown-children {
  margin-top: 4px;
}
</style>
