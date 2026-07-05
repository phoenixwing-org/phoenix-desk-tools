<script setup lang="ts">
import { computed } from "vue";
import { getCaaControlCatalogEntry } from "@desk-tools/catdlg-core";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaDialogGrid from "../CaaDialogGrid.vue";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
}>();

const { isSelected, onClick, onContextmenu } = useCaaControl(props);

const entry = computed(() => getCaaControlCatalogEntry(props.node.type));
const label = computed(() => entry.value?.label ?? props.node.type.replace(/^CATDlg/, ""));
const canContainChildren = computed(() => Boolean(entry.value?.canContainChildren));
const visualKind = computed(() => {
  if (props.node.type === "CATDlgProgress") return "progress";
  if (props.node.type === "CATDlgSlider") return "slider";
  if (props.node.type === "CATDlgScrollbar") return "scrollbar";
  if (props.node.type === "CATDlgSplitter") return "splitter";
  if (props.node.type === "CATDlgIconBox") return "iconbox";
  if (props.node.type === "CATDlgMenuBar") return "menubar";
  if (props.node.type === "CATDlgToolBar") return "toolbar";
  if (props.node.type === "CATDlgStatusBar") return "statusbar";
  if (/Item$/.test(props.node.type) || props.node.type === "CATDlgSubMenu") return "item";
  return "generic";
});
</script>

<template>
  <div
    class="caa-catalog-box"
    :class="[
      `caa-catalog-box--${visualKind}`,
      { 'caa-catalog-box--selected': isSelected, 'caa-catalog-box--fill': fillParent },
    ]"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <div class="caa-catalog-head">
      <span class="caa-catalog-label">{{ label }}</span>
      <span class="caa-catalog-id mono">{{ node.id }}</span>
    </div>
    <div v-if="visualKind === 'progress'" class="caa-catalog-progress">
      <span />
    </div>
    <div v-else-if="visualKind === 'slider'" class="caa-catalog-slider">
      <span />
    </div>
    <div v-else-if="visualKind === 'scrollbar'" class="caa-catalog-scrollbar">
      <span />
    </div>
    <div v-else-if="visualKind === 'splitter'" class="caa-catalog-splitter">
      <span />
      <span />
    </div>
    <div v-else-if="visualKind === 'iconbox'" class="caa-catalog-iconbox">
      <span />
      <span />
      <span />
    </div>
    <div v-else-if="visualKind === 'menubar'" class="caa-catalog-menubar">
      <span />
      <span />
      <span />
    </div>
    <div v-else-if="visualKind === 'toolbar'" class="caa-catalog-toolbar">
      <span />
      <span />
      <span />
      <span />
    </div>
    <div v-else-if="visualKind === 'statusbar'" class="caa-catalog-statusbar">
      <span />
    </div>
    <div v-else-if="visualKind === 'item'" class="caa-catalog-item">
      <span />
    </div>
    <CaaDialogGrid
      v-if="canContainChildren && node.children.length"
      :node="node"
      class="caa-catalog-children"
      :fill-parent="fillParent"
    />
  </div>
</template>

<style scoped>
.caa-catalog-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 92px;
  max-width: 100%;
  padding: 6px 8px;
  border: 1px dashed #94a3b8;
  border-radius: 4px;
  background: #f8fafc;
  color: #334155;
  cursor: pointer;
  box-sizing: border-box;
}

.caa-catalog-box--fill {
  width: 100%;
}

.caa-catalog-box--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-catalog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.caa-catalog-label {
  font-size: 0.75rem;
  font-weight: 700;
}

.caa-catalog-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.68rem;
  color: #64748b;
}

.caa-catalog-progress,
.caa-catalog-slider,
.caa-catalog-scrollbar {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.caa-catalog-progress span {
  display: block;
  width: 46%;
  height: 100%;
  background: #60a5fa;
}

.caa-catalog-slider span {
  position: absolute;
  left: 52%;
  top: 50%;
  width: 12px;
  height: 12px;
  border: 2px solid #64748b;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
}

.caa-catalog-scrollbar span {
  display: block;
  width: 32%;
  height: 100%;
  border-radius: 999px;
  background: #94a3b8;
}

.caa-catalog-splitter,
.caa-catalog-iconbox,
.caa-catalog-menubar,
.caa-catalog-toolbar {
  display: grid;
  gap: 4px;
}

.caa-catalog-splitter {
  grid-template-columns: 1fr 1fr;
  min-height: 36px;
}

.caa-catalog-splitter span,
.caa-catalog-iconbox span,
.caa-catalog-menubar span,
.caa-catalog-toolbar span,
.caa-catalog-statusbar span,
.caa-catalog-item span {
  display: block;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  background: #fff;
}

.caa-catalog-iconbox {
  grid-template-columns: repeat(3, 18px);
}

.caa-catalog-iconbox span {
  width: 18px;
  height: 18px;
}

.caa-catalog-menubar {
  grid-template-columns: repeat(3, minmax(30px, 1fr));
}

.caa-catalog-menubar span {
  height: 12px;
}

.caa-catalog-toolbar {
  grid-template-columns: repeat(4, 18px);
}

.caa-catalog-toolbar span {
  width: 18px;
  height: 18px;
}

.caa-catalog-statusbar span {
  height: 10px;
  background: #e2e8f0;
}

.caa-catalog-item span {
  width: 70%;
  height: 10px;
}

.caa-catalog-children {
  margin-top: 2px;
}
</style>
