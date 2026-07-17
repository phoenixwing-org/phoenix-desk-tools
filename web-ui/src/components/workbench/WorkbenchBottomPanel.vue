<script setup lang="ts">
import { computed, ref } from "vue";
import { pnwBindPointerDrag } from "phoenix-wing";
import { resolveWorkbenchBottomPanelHeight } from "../../utils/workbenchBottomPanelLayout";

export type WorkbenchBottomPanelTab = {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
  tone?: "default" | "warning" | "error";
};

const props = withDefaults(defineProps<{
  tabs: readonly WorkbenchBottomPanelTab[];
  modelValue: string;
  expanded: boolean;
  height: number;
  ariaLabel?: string;
  minHeight?: number;
  minPrimaryHeight?: number;
}>(), {
  ariaLabel: "页面输出面板",
  minHeight: 112,
  minPrimaryHeight: 260,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:expanded": [value: boolean];
  "update:height": [value: number];
}>();

const panelRef = ref<HTMLElement | null>(null);

function resolvedHeight(requested = props.height): number {
  const hostHeight = panelRef.value?.parentElement?.clientHeight ?? window.innerHeight;
  return resolveWorkbenchBottomPanelHeight(requested, {
    hostHeight,
    minPanelHeight: props.minHeight,
    minPrimaryHeight: props.minPrimaryHeight,
    layoutGap: 0,
    maxViewportHeight: window.innerHeight * 0.68,
  });
}

const panelStyle = computed(() => props.expanded
  ? { height: `${resolvedHeight()}px` }
  : undefined);

function activate(tab: WorkbenchBottomPanelTab): void {
  if (tab.disabled) return;
  emit("update:modelValue", tab.id);
  if (!props.expanded) emit("update:expanded", true);
}

function updateHeight(requested: number): void {
  emit("update:height", resolvedHeight(requested));
}

function onResizeStart(event: PointerEvent): void {
  if (!props.expanded || !panelRef.value) return;
  const startY = event.clientY;
  const startHeight = panelRef.value.getBoundingClientRect().height;
  pnwBindPointerDrag(event, {
    cursor: "row-resize",
    onMove(nextEvent) {
      updateHeight(startHeight + startY - nextEvent.clientY);
    },
    onEnd() {
      updateHeight(props.height);
    },
  });
}

function onResizeKeydown(event: KeyboardEvent): void {
  if (!props.expanded) return;
  const step = event.shiftKey ? 40 : 12;
  if (event.key === "ArrowUp") updateHeight(props.height + step);
  else if (event.key === "ArrowDown") updateHeight(props.height - step);
  else if (event.key === "Home") updateHeight(props.minHeight);
  else if (event.key === "End") updateHeight(Number.MAX_SAFE_INTEGER);
  else return;
  event.preventDefault();
}
</script>

<template>
  <section
    ref="panelRef"
    class="workbench-bottom-panel"
    :class="{ collapsed: !expanded }"
    :style="panelStyle"
    :aria-label="ariaLabel"
  >
    <div
      v-show="expanded"
      class="panel-resizer"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="`调节${ariaLabel}高度`"
      :aria-valuenow="Math.round(height)"
      :aria-valuemin="minHeight"
      tabindex="0"
      title="拖拽调节面板高度"
      @pointerdown="onResizeStart"
      @keydown="onResizeKeydown"
    />
    <header class="panel-head">
      <div class="panel-tabs" role="tablist" :aria-label="`${ariaLabel}标签`">
        <button
          v-for="tab in tabs"
          :id="`workbench-bottom-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :class="[`tone-${tab.tone ?? 'default'}`, { active: tab.id === modelValue }]"
          :aria-selected="tab.id === modelValue"
          :aria-controls="`workbench-bottom-panel-${tab.id}`"
          :disabled="tab.disabled"
          @click="activate(tab)"
        >
          <span>{{ tab.label }}</span>
          <small v-if="typeof tab.count === 'number'">{{ tab.count }}</small>
        </button>
      </div>
      <div class="panel-summary"><slot name="summary" /></div>
      <button
        type="button"
        class="collapse-action"
        :aria-expanded="expanded"
        :aria-label="expanded ? `收起${ariaLabel}` : `展开${ariaLabel}`"
        @click="emit('update:expanded', !expanded)"
      >
        {{ expanded ? "收起" : "展开" }}
      </button>
    </header>
    <div
      v-show="expanded"
      :id="`workbench-bottom-panel-${modelValue}`"
      class="panel-body"
      role="tabpanel"
      :aria-labelledby="`workbench-bottom-tab-${modelValue}`"
    >
      <slot :name="modelValue" />
    </div>
  </section>
</template>

<style scoped>
.workbench-bottom-panel {
  display: flex;
  min-height: 0;
  flex: 0 0 auto;
  flex-direction: column;
  overflow: hidden;
  background: var(--page-bg);
  border-top: 1px solid var(--border);
}

.workbench-bottom-panel.collapsed { min-height: 36px; height: 36px; }
.panel-resizer {
  position: relative;
  z-index: 2;
  height: 6px;
  flex: 0 0 6px;
  margin-top: -1px;
  cursor: row-resize;
  touch-action: none;
  background: var(--panel-head-bg);
  border-bottom: 1px solid var(--border);
}
.panel-resizer::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 28px;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted) 48%, transparent);
  content: "";
  transform: translate(-50%, -50%);
}
.panel-resizer:hover,
.panel-resizer:focus-visible { background: color-mix(in srgb, var(--accent) 10%, var(--panel-head-bg)); outline: 0; }
.panel-resizer:hover::after,
.panel-resizer:focus-visible::after { background: var(--accent); }
.panel-head { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; min-height: 35px; padding: 0 7px; background: var(--panel-head-bg); border-bottom: 1px solid var(--border); }
.collapsed .panel-head { border-bottom: 0; }
.panel-tabs { display: flex; align-self: stretch; min-width: 0; gap: 2px; }
.panel-tabs button,
.collapse-action {
  color: var(--muted);
  background: transparent;
  border: 0;
  cursor: pointer;
  font: inherit;
}
.panel-tabs button { position: relative; display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; font-size: 0.68rem; }
.panel-tabs button::after { position: absolute; right: 7px; bottom: 0; left: 7px; height: 2px; background: transparent; content: ""; }
.panel-tabs button.active { color: var(--text); }
.panel-tabs button.active::after { background: var(--accent); }
.panel-tabs button:disabled { opacity: 0.45; cursor: default; }
.panel-tabs small { min-width: 16px; padding: 0 4px; border-radius: 999px; background: color-mix(in srgb, var(--muted) 12%, transparent); font-size: 0.58rem; text-align: center; }
.panel-tabs .tone-warning small { color: #b45309; }
.panel-tabs .tone-error small { color: #b91c1c; }
.panel-summary { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--muted); font-size: 0.64rem; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.collapse-action { flex: 0 0 auto; padding: 4px 5px; font-size: 0.64rem; }
.panel-tabs button:focus-visible,
.collapse-action:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.panel-body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
</style>
