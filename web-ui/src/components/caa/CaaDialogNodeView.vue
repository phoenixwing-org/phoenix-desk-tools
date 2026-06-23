<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import CaaDialogGrid from "./CaaDialogGrid.vue";
import { CAA_DIALOG_PREVIEW_WIDTH_PX } from "../../utils/caaControlMetrics";

const props = withDefaults(
  defineProps<{
    node: CaaDialogNode;
    depth?: number;
    fillParent?: boolean;
  }>(),
  { fillParent: false },
);

const isDialog = computed(() => props.node.type === "CATDlgDialog");
const isFrame = computed(() => props.node.type === "CATDlgFrame");
const showFrameBorder = computed(
  () => isFrame.value && !props.node.style?.includes("CATDlgFraNoFrame"),
);
const isMultiline = computed(() => props.node.style?.includes("CATDlgEdtMultiline"));
const hasDialogButtons = computed(() =>
  props.node.style?.some((s) => s.includes("CATDlgWndBtn")),
);

const labelText = computed(() => props.node.nls?.title ?? props.node.id);

const controlRows = computed(() => props.node.size?.textHeight ?? 3);

const columnTitles = computed(() => {
  const titles = props.node.nls?.columnTitles?.filter(Boolean) ?? [];
  const cc = props.node.size?.columnCount ?? titles.length;
  const out: string[] = [];
  for (let i = 0; i < cc; i++) out.push(titles[i] ?? `Col ${i + 1}`);
  return out;
});

const dialogStyle = computed(() =>
  isDialog.value ? { width: `${CAA_DIALOG_PREVIEW_WIDTH_PX}px` } : undefined,
);
</script>

<template>
  <div
    v-if="isDialog"
    class="caa-dialog"
    :style="dialogStyle"
  >
    <div class="caa-dialog-title">{{ node.nls?.title ?? node.id }}</div>
    <CaaDialogGrid
      :node="node"
      class="caa-dialog-body"
      fill-parent
    />
    <div
      v-if="hasDialogButtons"
      class="caa-dialog-actions"
    >
      <button type="button" class="caa-btn" disabled>OK</button>
      <button type="button" class="caa-btn" disabled>Cancel</button>
      <button type="button" class="caa-btn" disabled>Preview</button>
    </div>
  </div>

  <fieldset
    v-else-if="isFrame"
    class="caa-frame"
    :class="{ 'caa-frame--plain': !showFrameBorder, 'caa-frame--fill': fillParent }"
  >
    <legend v-if="showFrameBorder && node.nls?.title">{{ node.nls.title }}</legend>
    <CaaDialogGrid :node="node" :fill-parent="fillParent" />
  </fieldset>

  <label
    v-else-if="node.type === 'CATDlgLabel'"
    class="caa-label"
  >
    {{ labelText }}
  </label>

  <button
    v-else-if="node.type === 'CATDlgPushButton'"
    type="button"
    class="caa-btn"
    disabled
  >
    {{ labelText }}
  </button>

  <textarea
    v-else-if="node.type === 'CATDlgEditor' && isMultiline"
    class="caa-editor caa-editor--multi"
    :class="{ 'caa-control--fill': fillParent }"
    :rows="controlRows"
    readonly
    :placeholder="node.id"
  />

  <input
    v-else-if="node.type === 'CATDlgEditor'"
    class="caa-editor"
    :class="{ 'caa-control--fill': fillParent }"
    type="text"
    readonly
    :placeholder="node.id"
  />

  <select
    v-else-if="node.type === 'CATDlgSelectorList'"
    class="caa-selector"
    :class="{ 'caa-control--fill': fillParent }"
    :size="controlRows"
    disabled
  >
    <option>（SelectorList）</option>
  </select>

  <div
    v-else-if="node.type === 'CATDlgMultiList'"
    class="caa-multilist"
    :class="{ 'caa-control--fill': fillParent }"
  >
    <table>
      <thead>
        <tr>
          <th v-for="(col, idx) in columnTitles" :key="idx">{{ col }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in controlRows" :key="r">
          <td v-for="(col, idx) in columnTitles" :key="`${r}-${idx}`">&nbsp;</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div
    v-else
    class="caa-unknown"
    :title="node.type"
  >
    {{ node.type }} · {{ node.id }}
  </div>
</template>

<style scoped>
.caa-dialog {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-width: 100%;
  height: fit-content;
  box-sizing: border-box;
  border: 1px solid var(--border-strong, #94a3b8);
  border-radius: 6px;
  background: var(--page-bg, #f8fafc);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
}

.caa-dialog-title {
  flex: 0 0 auto;
  padding: 6px 10px;
  font-weight: 600;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: linear-gradient(180deg, #f1f5f9, #e2e8f0);
}

.caa-dialog-body {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
}

.caa-dialog-actions {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--border, #e2e8f0);
}

.caa-frame {
  margin: 0;
  padding: 6px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 4px;
  width: fit-content;
  max-width: 100%;
  height: fit-content;
  box-sizing: border-box;
}

.caa-frame--fill {
  width: 100%;
}

.caa-frame--plain {
  border: none;
  padding: 0;
}

.caa-label {
  font-size: 0.82rem;
  align-self: center;
}

.caa-btn {
  font-size: 0.8rem;
  padding: 2px 10px;
}

.caa-editor {
  width: auto;
  max-width: 100%;
  font-size: 0.8rem;
  box-sizing: border-box;
}

.caa-editor--multi {
  resize: none;
  min-height: 0;
}

.caa-selector {
  width: auto;
  max-width: 100%;
  font-size: 0.75rem;
}

.caa-multilist {
  width: auto;
  max-width: 100%;
  overflow: auto;
  font-size: 0.75rem;
}

.caa-control--fill {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.caa-multilist.caa-control--fill table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

.caa-multilist table {
  width: auto;
  table-layout: fixed;
  border-collapse: collapse;
}

.caa-multilist th,
.caa-multilist td {
  border: 1px solid var(--border, #e2e8f0);
  padding: 2px 6px;
}

.caa-multilist th {
  background: #f1f5f9;
  text-align: left;
}

.caa-unknown {
  padding: 4px 6px;
  font-size: 0.75rem;
  background: #fef3c7;
  border: 1px dashed #d97706;
  border-radius: 4px;
}
</style>
