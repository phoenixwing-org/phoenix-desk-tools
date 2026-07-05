<script setup lang="ts">
/**
 * Builder 控件面板 —— 工具箱，分组展示可拖拽控件。
 * 布局: vertical(侧边) / horizontal(水平条)
 * 密度: grid(双列) / ribbon(单行)
 */
import { inject, watch, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { caaControlPaletteGroups } from "@desk-tools/catdlg-core";
import { CAA_CONTROL_KEY } from "../../composables/useCaaControlContext";
import { useCaaDialogPageStore } from "../../stores/caaDialogPage";
import { controlIcon } from "../../assets/caa/controlIcons";

const ctx = inject(CAA_CONTROL_KEY, null);
const store = useCaaDialogPageStore();
const { paletteCollapsed: collapsed, paletteLayout: layout, paletteDensity: density } = storeToRefs(store);

const emit = defineEmits<{
  (e: "layout-change", layout: "vertical" | "horizontal"): void;
}>();

watch(layout, (v) => emit("layout-change", v));
onMounted(() => emit("layout-change", layout.value));

const groups = caaControlPaletteGroups();

function onDragStart(e: DragEvent, type: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("text/plain", `caa:COPY:${type}`);
}
</script>

<template>
  <aside v-if="ctx?.editMode.value" class="caa-palette" :class="{
    'caa-palette--collapsed': collapsed,
    'caa-palette--horizontal': layout === 'horizontal',
    'caa-palette--ribbon': density === 'ribbon',
  }">
    <!-- 标题栏 -->
    <div class="palette-header">
      <div v-if="!collapsed" class="palette-header-left">
        <button class="palette-toggle" :title="layout === 'vertical' ? '切换水平布局' : '切换垂直布局'"
          @click="layout = layout === 'vertical' ? 'horizontal' : 'vertical'">↕</button>
        <button class="palette-toggle" :title="density === 'grid' ? '切换单行' : '切换双列'"
          @click="density = density === 'grid' ? 'ribbon' : 'grid'">{{ density === 'grid' ? '☰' : '⊞' }}</button>
      </div>
      <span v-if="!collapsed" class="palette-title">工具箱</span>
      <button class="palette-toggle" :title="collapsed ? '展开工具箱' : '折叠工具箱'" @click="collapsed = !collapsed">
        {{ collapsed ? '🧰' : '📌' }}
      </button>
    </div>

    <!-- 控件列表 -->
    <div v-if="!collapsed" class="palette-body">
      <template v-if="density === 'grid'">
        <div v-for="group in groups" :key="group.label" class="palette-group">
          <p v-if="layout === 'vertical'" class="palette-group-label">{{ group.label }}</p>
          <div class="palette-grid">
            <button v-for="item in group.items" :key="item.type" class="palette-btn" draggable="true" :title="item.type"
              @dragstart="onDragStart($event, item.type)">
              <img :src="controlIcon(item.type)" class="palette-icon" alt="" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <!-- ribbon 单行模式：分组 + 竖线分隔 -->
        <div class="palette-ribbon">
          <template v-for="(group, gi) in groups" :key="group.label">
            <span v-if="gi > 0" class="palette-ribbon-sep"></span>
            <button v-for="item in group.items" :key="item.type" class="palette-btn"
              draggable="true" :title="item.type"
              @dragstart="onDragStart($event, item.type)">
              <img :src="controlIcon(item.type)" class="palette-icon" alt="" />
              <span>{{ item.label }}</span>
            </button>
          </template>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.caa-palette {
  width: 176px;
  flex-shrink: 0;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
}

.caa-palette--collapsed {
  width: 30px;
  min-height: auto;
  flex: 0 0 auto;
  position: absolute;
  top: 4px;
  left: -16px;
  z-index: 10;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* 水平模式折叠 → 右上角悬浮 */
.caa-palette--horizontal.caa-palette--collapsed {
  left: auto;
  right: 4px;
}

.caa-palette--collapsed .palette-header {
  border-bottom: none;
  padding: 2px;
  justify-content: center;
}

.caa-palette--collapsed .palette-header-left,
.caa-palette--collapsed .palette-title {
  display: none;
}

.caa-palette--collapsed .palette-toggle {
  font-size: 16px;
}

.caa-palette--horizontal:not(.caa-palette--collapsed) {
  width: 100%;
  max-height: 120px;
}

/* ribbon 大图标 */
.caa-palette--ribbon .palette-btn {
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  min-width: 52px;
}

.caa-palette--ribbon .palette-icon {
  width: 20px;
  height: 20px;
}

.palette-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  flex-shrink: 0;
  gap: 4px;
}

.palette-header-left {
  display: flex;
  gap: 1px;
}

.palette-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
  flex: 1;
  text-align: center;
}

.palette-toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  padding: 1px 3px;
  border-radius: 3px;
  line-height: 1;
}

.palette-toggle:hover {
  background: #e2e8f0;
}

.palette-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 6px;
  font-size: 0.7rem;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #fff;
  cursor: grab;
  text-align: left;
  color: #334155;
  transition: border-color 0.15s, background 0.15s;
  user-select: none;
}

.palette-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}

.palette-btn:hover {
  border-color: #3b82f6;
  background: #eff6ff;
}

.palette-btn:active {
  cursor: grabbing;
  background: #dbeafe;
}

/* ── ribbon 单行 ── */
.palette-ribbon {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.palette-ribbon-sep {
  display: inline-block;
  width: 1px;
  height: 28px;
  background: #cbd5e1;
  margin: 0 2px;
  flex-shrink: 0;
}

/* ── 水平布局 ── */
.caa-palette--horizontal .palette-body {
  flex-direction: row;
  gap: 8px;
}

.caa-palette--horizontal .palette-group-label {
  margin: 2px 0;
}
</style>
