<script setup lang="ts">
import { computed, ref } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
  widthStyle?: Record<string, string>;
}>();

const widthOverride = computed(() => props.widthStyle);
const { isSelected, onClick, onContextmenu, helpTooltip, widthStyle: resolvedWidth } = useCaaControl(props, { widthOverride });

const min = computed(() => props.node.spinner?.min);
const max = computed(() => props.node.spinner?.max);
const step = computed(() => props.node.spinner?.step ?? 1);
const precision = computed(() => props.node.spinner?.prec);
const spinnerValue = ref(min.value ?? 0);

const displayValue = computed(() => {
  const value = spinnerValue.value;
  return precision.value != null ? value.toFixed(precision.value) : String(value);
});

function clamp(value: number): number {
  let next = value;
  if (min.value != null) next = Math.max(min.value, next);
  if (max.value != null) next = Math.min(max.value, next);
  return next;
}

function stepUp(e: MouseEvent) {
  e.stopPropagation();
  spinnerValue.value = clamp(spinnerValue.value + step.value);
}
function stepDown(e: MouseEvent) {
  e.stopPropagation();
  spinnerValue.value = clamp(spinnerValue.value - step.value);
}
</script>

<template>
  <div
    class="caa-spinner"
    :class="{ 'caa-spinner--selected': isSelected }"
    :style="resolvedWidth"
    :title="helpTooltip"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <input
      class="caa-spinner-input"
      type="text"
      :value="displayValue"
      readonly
    />
    <span class="caa-spinner-btns">
      <span class="caa-spinner-arrow caa-spinner-arrow--up" @click.stop="stepUp" />
      <span class="caa-spinner-arrow caa-spinner-arrow--down" @click.stop="stepDown" />
    </span>
  </div>
</template>

<style scoped>
.caa-spinner {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  height: 22px;
  box-sizing: border-box;
  cursor: pointer;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  background: #fff;
  overflow: hidden;
}

.caa-spinner:hover {
  border-color: #94a3b8;
}

.caa-spinner--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-spinner-input {
  flex: 1;
  min-width: 36px;
  width: 100%;
  height: 100%;
  font-size: 0.75rem;
  text-align: right;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: #1e293b;
  box-sizing: border-box;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.caa-spinner-btns {
  display: flex;
  flex-direction: column;
  width: 14px;
  flex-shrink: 0;
  border-left: 1px solid #cbd5e1;
}

.caa-spinner-arrow {
  flex: 1;
  display: block;
  position: relative;
  background: #f1f5f9;
  cursor: pointer;
}

.caa-spinner-arrow:hover { background: #dbeafe; }

.caa-spinner-arrow--up::after {
  content: "";
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -70%);
  width: 0; height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 5px solid #64748b;
}

.caa-spinner-arrow--down::after {
  content: "";
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -30%);
  width: 0; height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #64748b;
}

.caa-spinner-arrow--up:hover::after { border-bottom-color: #1e40af; }
.caa-spinner-arrow--down:hover::after { border-top-color: #1e40af; }
</style>
