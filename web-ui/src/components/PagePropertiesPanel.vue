<script setup lang="ts">
import { computed, onUnmounted, ref, unref, watch } from "vue";
import PagePropertyFieldRow from "./PagePropertyFieldRow.vue";
import { useAppShell } from "../composables/useAppShell";
import { usePagePropertiesHost } from "../composables/pagePropertiesHost";
import { bindPointerDrag } from "../utils/pointerDrag";

const NAME_COL_MIN = 72;
const NAME_COL_MAX = 240;

const shell = useAppShell();
const { activeSheet } = usePagePropertiesHost();

const collapsedGroups = ref<Record<string, boolean>>({});
const tableWrapRef = ref<HTMLElement | null>(null);

const nameColWidth = computed(() => shell.shellLayout.value.properties_name_col_width_px);

watch(
  () => [activeSheet.value?.pageId, activeSheet.value?.schemaVersion] as const,
  ([pageId]) => {
    if (!pageId) {
      collapsedGroups.value = {};
      return;
    }
    const next: Record<string, boolean> = {};
    for (const group of activeSheet.value?.groups ?? []) {
      next[group.id] = Boolean(group.defaultCollapsed);
    }
    collapsedGroups.value = next;
  },
  { immediate: true },
);

const panelTitle = computed(() => activeSheet.value?.title ?? "属性");

function toggleGroup(id: string) {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [id]: !collapsedGroups.value[id],
  };
}

function visibleFields(group: { fields: Array<{ hidden?: { value: boolean } }> }) {
  return group.fields.filter((f) => !(f.hidden && unref(f.hidden)));
}

function onColResizeStart(e: PointerEvent) {
  const startX = e.clientX;
  const startW = nameColWidth.value;

  bindPointerDrag(e, {
    cursor: "col-resize",
    onMove(ev) {
      const wrap = tableWrapRef.value;
      const maxByPanel = wrap ? Math.min(NAME_COL_MAX, wrap.clientWidth - 80) : NAME_COL_MAX;
      const next = Math.min(maxByPanel, Math.max(NAME_COL_MIN, startW + (ev.clientX - startX)));
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        properties_name_col_width_px: next,
      };
    },
    onEnd() {
      void shell.persistShellLayout({
        properties_name_col_width_px: shell.shellLayout.value.properties_name_col_width_px,
      });
    },
  });
}

onUnmounted(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});
</script>

<template>
  <section class="page-props">
    <header class="page-props-head">
      <span class="page-props-title">{{ panelTitle }}</span>
    </header>
    <div v-if="activeSheet" ref="tableWrapRef" class="prop-table-wrap">
      <div
        class="prop-col-resizer"
        :style="{ left: `${nameColWidth}px` }"
        title="拖拽调整名称列宽"
        @pointerdown="onColResizeStart"
      />
      <table class="prop-table">
        <colgroup>
          <col :style="{ width: `${nameColWidth}px` }" />
          <col />
        </colgroup>
        <thead class="prop-table-head">
          <tr>
            <th class="prop-head-name">名称</th>
            <th class="prop-head-value">值</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in activeSheet.groups" :key="group.id">
            <tr class="prop-group-row">
              <td colspan="2">
                <button type="button" class="prop-group-head" @click="toggleGroup(group.id)">
                  <span class="prop-group-chevron" :class="{ open: !collapsedGroups[group.id] }">▶</span>
                  <span>{{ group.label }}</span>
                </button>
                <p
                  v-if="group.description && !collapsedGroups[group.id]"
                  class="prop-group-desc muted small"
                >
                  {{ group.description }}
                </p>
              </td>
            </tr>
            <template v-if="!collapsedGroups[group.id]">
              <PagePropertyFieldRow
                v-for="(field, fi) in visibleFields(group)"
                :key="field.id"
                :field="field"
                :stripe="fi % 2 === 1"
              />
              <tr v-if="!visibleFields(group).length" class="prop-empty-row">
                <td colspan="2" class="prop-empty muted small">（无属性）</td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else class="prop-placeholder muted small">当前页无可配置项</p>
  </section>
</template>

<style scoped>
.page-props {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--sidebar-bg);
  border-top: 1px solid var(--border);
}

.page-props-head {
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
}

.page-props-title {
  font-size: 0.78rem;
  font-weight: 600;
}

.prop-table-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.prop-col-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
  margin-left: -2px;
  cursor: col-resize;
  touch-action: none;
  z-index: 2;
}

.prop-col-resizer:hover {
  background: var(--accent);
  opacity: 0.35;
}

.prop-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.prop-table-head {
  position: sticky;
  top: 0;
  z-index: 1;
}

.prop-table-head th {
  padding: 3px 8px;
  font-size: 0.66rem;
  font-weight: 600;
  color: var(--muted);
  text-align: left;
  background: var(--panel-head-bg);
  border-bottom: 1px solid var(--border);
}

.prop-head-name {
  border-right: 1px solid var(--border);
}

.prop-group-row td {
  padding: 0;
  border-top: 1px solid var(--border);
  background: var(--panel-head-bg);
}

.prop-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.prop-group-desc {
  margin: 0;
  padding: 0 8px 4px 22px;
  line-height: 1.35;
}

.prop-group-chevron {
  font-size: 0.62rem;
  color: var(--muted);
  transition: transform 0.15s ease;
}

.prop-group-chevron.open {
  transform: rotate(90deg);
}

.prop-table :deep(.prop-field-row td) {
  border-top: 1px solid var(--border);
}

.prop-empty-row td {
  padding: 8px;
  border-top: 1px solid var(--border);
}

.prop-placeholder {
  margin: 0;
  padding: 12px 10px;
  line-height: 1.4;
}
</style>
