<script setup lang="ts">
/**
 * Builder 控件面板 —— 左侧工具箱，分组展示可拖拽控件。
 */
import { inject } from "vue";
import { CAA_CONTROL_KEY } from "../../composables/useCaaControlContext";

const ctx = inject(CAA_CONTROL_KEY, null);

interface PaletteItem {
  type: string;
  label: string;
}

interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

const groups: PaletteGroup[] = [
  {
    label: "基础控件",
    items: [
      { type: "CATDlgLabel", label: "Label" },
      { type: "CATDlgEditor", label: "Editor" },
      { type: "CATDlgPushButton", label: "Button" },
      { type: "CATDlgCombo", label: "Combo" },
      { type: "CATDlgCheckButton", label: "Check" },
      { type: "CATDlgRadioButton", label: "Radio" },
      { type: "CATDlgSpinner", label: "Spinner" },
      { type: "CATDlgSelectorList", label: "SelList" },
    ],
  },
  {
    label: "列表",
    items: [
      { type: "CATDlgMultiList", label: "MultiList" },
    ],
  },
  {
    label: "容器",
    items: [
      { type: "CATDlgFrame", label: "Frame" },
      { type: "CATDlgTabContainer", label: "Tab" },
      { type: "CATDlgContainer", label: "Container" },
    ],
  },
  {
    label: "装饰",
    items: [
      { type: "CATDlgSeparator", label: "Separator" },
    ],
  },
];

function onDragStart(e: DragEvent, type: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("text/plain", `caa:COPY:${type}`);
}
</script>

<template>
  <aside v-if="ctx" class="caa-palette">
    <div v-for="group in groups" :key="group.label" class="palette-group">
      <p class="palette-group-label">{{ group.label }}</p>
      <div class="palette-grid">
        <button
          v-for="item in group.items"
          :key="item.type"
          class="palette-btn"
          draggable="true"
          :title="item.type"
          @dragstart="onDragStart($event, item.type)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.caa-palette {
  width: 176px;
  flex-shrink: 0;
  padding: 8px;
  border-right: 1px solid var(--border, #e2e8f0);
  background: #f8fafc;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.palette-group-label {
  margin: 6px 0 4px;
  font-size: 0.68rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.palette-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
}

.palette-btn {
  padding: 4px 6px;
  font-size: 0.7rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #fff;
  cursor: grab;
  text-align: center;
  color: #334155;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
}

.palette-btn:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.palette-btn:active {
  cursor: grabbing;
  background: #dbeafe;
}
</style>
