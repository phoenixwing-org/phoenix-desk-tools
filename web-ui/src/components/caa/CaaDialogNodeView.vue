<script setup lang="ts">
/**
 * 控件分发器 —— 按 CAA 类型解析对应 Vue 组件并渲染。
 * 替代旧版 v-if/else-if 长链，每个 CATDlg* 类型由独立的 controls/ 组件负责。
 */
import { computed } from "vue";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import { resolveCaaControl } from "./controls/registry";

const props = withDefaults(
  defineProps<{
    node: CaaDialogNode;
    depth?: number;
    fillParent?: boolean;
    /** 对话框根节点（子控件 NLS 路径计算与递归 Grid 用） */
    dialogRoot?: CaaDialogNode;
    /** 外部计算的宽度样式（来自 useCaaContainerResize） */
    widthStyle?: Record<string, string>;
  }>(),
  { fillParent: false },
);

/** 若未传 dialogRoot 且当前即为 Dialog 根，则自引用 */
const effectiveRoot = computed(() =>
  props.dialogRoot ?? (props.node.type === "CATDlgDialog" ? props.node : undefined),
);

/** 按类型解析组件 */
const controlComponent = computed(() => resolveCaaControl(props.node.type));
</script>

<template>
  <component
    :is="controlComponent"
    :node="node"
    :fill-parent="fillParent"
    :dialog-root="effectiveRoot"
    :depth="depth"
    :width-style="widthStyle"
  />
</template>
