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
  () => activeSheet.value?.pageId ?? null,
  (pageId) => {
    if (!pageId) {
      collapsedGroups.value = {};
      return;
    }
    const sheet = activeSheet.value;
    if (!sheet) return;
    const next: Record<string, boolean> = {};
    for (const group of sheet.groups) {
      next[group.id] = Boolean(group.defaultCollapsed);
    }
    collapsedGroups.value = next;
  },
  { immediate: true, flush: "post" },
);

const sheetGroups = computed(() => activeSheet.value?.groups ?? []);

function visibleFields(group: { fields: Array<{ hidden?: { value: boolean } }> }) {
  return group.fields.filter((f) => !(f.hidden && unref(f.hidden)));
}

const visibleGroups = computed(() =>
  sheetGroups.value
    .filter((g) => !(g.hidden && unref(g.hidden)))
    .filter((g) => visibleFields(g).length > 0 || Boolean(g.description?.trim())),
);

function toggleGroup(id: string) {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [id]: !collapsedGroups.value[id],
  };
}

function clampNameColWidth(raw: number): number {
  const wrap = tableWrapRef.value;
  const maxByPanel = wrap
    ? Math.min(NAME_COL_MAX, Math.max(NAME_COL_MIN, wrap.clientWidth - 80))
    : NAME_COL_MAX;
  if (!Number.isFinite(raw)) return NAME_COL_MIN;
  return Math.round(Math.min(maxByPanel, Math.max(NAME_COL_MIN, raw)));
}

function onColResizeStart(e: PointerEvent) {
  const startX = e.clientX;
  const startW = nameColWidth.value;

  bindPointerDrag(e, {
    cursor: "col-resize",
    onMove(ev) {
      const next = clampNameColWidth(startW + (ev.clientX - startX));
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        properties_name_col_width_px: next,
      };
    },
    onEnd() {
      const w = clampNameColWidth(shell.shellLayout.value.properties_name_col_width_px);
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        properties_name_col_width_px: w,
      };
      void shell.persistShellLayout({ properties_name_col_width_px: w }).catch((err) => {
        shell.setStatus(String(err));
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
    <div ref="tableWrapRef" class="prop-table-wrap">
      <template v-if="visibleGroups.length">
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
        <tbody>
          <template v-for="group in visibleGroups" :key="group.id">
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
            </template>
          </template>
        </tbody>
        </table>
      </template>
      <p v-else class="prop-placeholder muted small">没有属性</p>
    </div>
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

.prop-group-row td {
  padding: 0;
  border-top: 1px solid var(--border);
  background: var(--prop-group-bg);
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

.prop-placeholder {
  margin: 0;
  padding: 12px 10px;
  line-height: 1.4;
}
</style>
