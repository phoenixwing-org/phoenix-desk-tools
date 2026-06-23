<script setup lang="ts">
import { computed, ref } from "vue";
import {
  nlsDisplayBinding,
  nlsKeyForProp,
  nlsPathSegments,
  type NlsStringProp,
} from "@phoenix/catdlg-core";
import type { CaaDialogNode } from "../../types/caaDialogIr";
import CaaDialogGrid from "./CaaDialogGrid.vue";
import CaaInlineNlsText from "./CaaInlineNlsText.vue";
import { CAA_DIALOG_PREVIEW_WIDTH_PX, caaControlWidthStyle } from "../../utils/caaControlMetrics";

const props = withDefaults(
  defineProps<{
    node: CaaDialogNode;
    depth?: number;
    fillParent?: boolean;
    /** 对话框根节点（子控件 NLS 路径用） */
    dialogRoot?: CaaDialogNode;
  }>(),
  { fillParent: false },
);

const rootNode = computed(() => props.dialogRoot ?? (props.node.type === "CATDlgDialog" ? props.node : null));

const isDialog = computed(() => props.node.type === "CATDlgDialog");
const isFrame = computed(() => props.node.type === "CATDlgFrame");
const showFrameBorder = computed(
  () => isFrame.value && !props.node.style?.includes("CATDlgFraNoFrame"),
);
const isMultiline = computed(() => props.node.style?.includes("CATDlgEdtMultiline"));
const isVerticalSep = computed(() => props.node.style?.includes("CATDlgCtrVertical"));
const hasDialogButtons = computed(() =>
  props.node.style?.some((s) => s.includes("CATDlgWndBtn")),
);

const controlRows = computed(() => props.node.size?.textHeight ?? 3);
const widthStyle = computed(() => caaControlWidthStyle(props.node.size?.textWidth));

const columnTitleBindings = computed(() => {
  const root = rootNode.value;
  if (!root) return [];
  const segments = nlsPathSegments(props.node, root);
  const cc = props.node.size?.columnCount ?? props.node.nls?.columnTitles?.length ?? 0;
  const out: Array<{ text: string; key: string; index: number }> = [];
  for (let i = 0; i < cc; i++) {
    const titles = props.node.nls?.columnTitles ?? [];
    const text = titles[i]?.trim() || `Col ${i + 1}`;
    out.push({
      text,
      key: nlsKeyForProp(segments, "title", i),
      index: i,
    });
  }
  return out;
});

const dialogStyle = computed(() =>
  isDialog.value ? { width: `${CAA_DIALOG_PREVIEW_WIDTH_PX}px` } : undefined,
);

const tabPages = computed(() =>
  props.node.children.filter((c) => c.type === "CATDlgTabPage"),
);

const activeTabIndex = ref(0);

function bindingFor(node: CaaDialogNode, opts?: { selectorPlaceholder?: string }) {
  const root = rootNode.value;
  if (!root) {
    return { text: node.id, prop: "title" as NlsStringProp, key: "Title" };
  }
  return nlsDisplayBinding(node, root, opts);
}

function tabBinding(tab: CaaDialogNode) {
  return bindingFor(tab);
}

const dialogTitleBinding = computed(() => bindingFor(props.node));

const labelBinding = computed(() => bindingFor(props.node));
const radioBinding = computed(() => bindingFor(props.node));
const checkBinding = computed(() => bindingFor(props.node));
const pushBinding = computed(() => bindingFor(props.node));
const comboBinding = computed(() => bindingFor(props.node));
const selectorBinding = computed(() =>
  bindingFor(props.node, { selectorPlaceholder: "（选择列表）" }),
);

const frameTitleBinding = computed(() => {
  if (!props.node.nls?.title?.trim()) return null;
  return bindingFor(props.node);
});

const isContainerLike = computed(() =>
  ["CATDlgTabContainer", "CATDlgContainer", "CATDlgTabPage"].includes(props.node.type),
);
</script>

<template>
  <div v-if="isDialog" class="caa-dialog" :style="dialogStyle">
    <div class="caa-dialog-title">
      <CaaInlineNlsText
        :text="dialogTitleBinding.text"
        :nls-key="dialogTitleBinding.key"
        :node-id="node.id"
        :prop="dialogTitleBinding.prop"
      />
    </div>
    <CaaDialogGrid :node="node" class="caa-dialog-body" fill-parent :dialog-root="node" />
    <div v-if="hasDialogButtons" class="caa-dialog-actions">
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
    <legend v-if="showFrameBorder && frameTitleBinding">
      <CaaInlineNlsText
        :text="frameTitleBinding.text"
        :nls-key="frameTitleBinding.key"
        :node-id="node.id"
        :prop="frameTitleBinding.prop"
      />
    </legend>
    <CaaDialogGrid :node="node" :fill-parent="fillParent" :dialog-root="dialogRoot" />
  </fieldset>

  <div
    v-else-if="node.type === 'CATDlgTabContainer'"
    class="caa-tabcontainer"
    :class="{ 'caa-control--fill': fillParent }"
  >
    <div v-if="tabPages.length" class="caa-tab-bar">
      <button
        v-for="(tab, idx) in tabPages"
        :key="tab.id"
        type="button"
        class="caa-tab-chip"
        :class="{ active: activeTabIndex === idx }"
        @click="activeTabIndex = idx"
      >
        <CaaInlineNlsText
          :text="tabBinding(tab).text"
          :nls-key="tabBinding(tab).key"
          :node-id="tab.id"
          :prop="tabBinding(tab).prop"
          class="caa-tab-chip-label"
        />
      </button>
    </div>
    <div class="caa-tab-body">
      <CaaDialogGrid
        v-if="tabPages.length"
        :node="tabPages[activeTabIndex]"
        :fill-parent="fillParent"
        :dialog-root="dialogRoot"
      />
      <CaaDialogGrid v-else :node="node" :fill-parent="fillParent" :dialog-root="dialogRoot" />
    </div>
  </div>

  <div
    v-else-if="node.type === 'CATDlgTabPage'"
    class="caa-tabpage"
    :class="{ 'caa-control--fill': fillParent }"
  >
    <CaaDialogGrid :node="node" :fill-parent="fillParent" :dialog-root="dialogRoot" />
  </div>

  <div
    v-else-if="node.type === 'CATDlgContainer'"
    class="caa-container"
    :class="{ 'caa-control--fill': fillParent }"
  >
    <CaaDialogGrid :node="node" :fill-parent="fillParent" :dialog-root="dialogRoot" />
  </div>

  <label v-else-if="node.type === 'CATDlgLabel'" class="caa-label">
    <CaaInlineNlsText
      :text="labelBinding.text"
      :nls-key="labelBinding.key"
      :node-id="node.id"
      :prop="labelBinding.prop"
    />
  </label>

  <label v-else-if="node.type === 'CATDlgRadioButton'" class="caa-check caa-radio">
    <input type="radio" disabled />
    <CaaInlineNlsText
      :text="radioBinding.text"
      :nls-key="radioBinding.key"
      :node-id="node.id"
      :prop="radioBinding.prop"
    />
  </label>

  <label v-else-if="node.type === 'CATDlgCheckButton'" class="caa-check">
    <input type="checkbox" disabled />
    <CaaInlineNlsText
      :text="checkBinding.text"
      :nls-key="checkBinding.key"
      :node-id="node.id"
      :prop="checkBinding.prop"
    />
  </label>

  <button v-else-if="node.type === 'CATDlgPushButton'" type="button" class="caa-btn" disabled>
    <CaaInlineNlsText
      :text="pushBinding.text"
      :nls-key="pushBinding.key"
      :node-id="node.id"
      :prop="pushBinding.prop"
    />
  </button>

  <hr
    v-else-if="node.type === 'CATDlgSeparator'"
    class="caa-sep"
    :class="{ 'caa-sep--vertical': isVerticalSep, 'caa-control--fill': fillParent }"
  />

  <div
    v-else-if="node.type === 'CATDlgCombo'"
    class="caa-selector caa-combo caa-selector--mock"
    :class="{ 'caa-control--fill': fillParent }"
    :style="widthStyle"
  >
    <CaaInlineNlsText
      :text="comboBinding.text"
      :nls-key="comboBinding.key"
      :node-id="node.id"
      :prop="comboBinding.prop"
    />
  </div>

  <textarea
    v-else-if="node.type === 'CATDlgEditor' && isMultiline"
    class="caa-editor caa-editor--multi"
    :class="{ 'caa-control--fill': fillParent }"
    :style="widthStyle"
    :rows="controlRows"
    readonly
    :placeholder="node.id"
  />

  <input
    v-else-if="node.type === 'CATDlgEditor'"
    class="caa-editor"
    :class="{ 'caa-control--fill': fillParent }"
    :style="widthStyle"
    type="text"
    readonly
    :placeholder="node.id"
  />

  <input
    v-else-if="node.type === 'CATDlgSpinner'"
    class="caa-spinner"
    :class="{ 'caa-control--fill': fillParent }"
    :style="widthStyle"
    type="number"
    readonly
    :placeholder="node.id"
  />

  <div
    v-else-if="node.type === 'CATDlgSelectorList'"
    class="caa-selector caa-selector--mock"
    :class="{ 'caa-control--fill': fillParent }"
    :style="widthStyle"
  >
    <CaaInlineNlsText
      :text="selectorBinding.text"
      :nls-key="selectorBinding.key"
      :node-id="node.id"
      :prop="selectorBinding.prop"
      allow-placeholder
    />
  </div>

  <div
    v-else-if="node.type === 'CATDlgMultiList'"
    class="caa-multilist"
    :class="{ 'caa-control--fill': fillParent }"
    :style="widthStyle"
  >
    <table>
      <thead>
        <tr>
          <th v-for="col in columnTitleBindings" :key="col.key">
            <CaaInlineNlsText
              :text="col.text"
              :nls-key="col.key"
              :node-id="node.id"
              prop="title"
              :column-index="col.index"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in controlRows" :key="r">
          <td v-for="col in columnTitleBindings" :key="`${r}-${col.index}`">&nbsp;</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-else class="caa-unknown" :title="node.type">
    <span class="caa-unknown-type">{{ node.type.replace(/^CATDlg/, "") }}</span>
    <span class="caa-unknown-id">{{ node.id }}</span>
    <CaaDialogGrid
      v-if="node.children.length && !isContainerLike"
      :node="node"
      class="caa-unknown-children"
      :fill-parent="fillParent"
      :dialog-root="dialogRoot"
    />
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

.caa-tabcontainer,
.caa-tabpage,
.caa-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

.caa-tabcontainer {
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 4px;
  background: #fff;
  padding: 4px;
}

.caa-tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  padding-bottom: 4px;
}

.caa-tab-chip {
  font-size: 0.72rem;
  padding: 2px 8px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 3px 3px 0 0;
  background: #f1f5f9;
  cursor: pointer;
}

.caa-tab-chip.active {
  background: #fff;
  border-bottom-color: #fff;
  font-weight: 600;
}

.caa-tab-chip-label {
  pointer-events: auto;
}

.caa-tab-body {
  min-width: 0;
  padding: 4px 2px;
}

.caa-label {
  font-size: 0.82rem;
  align-self: center;
}

.caa-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  cursor: default;
}

.caa-check input {
  flex-shrink: 0;
}

.caa-btn {
  font-size: 0.8rem;
  padding: 2px 10px;
}

.caa-sep {
  border: none;
  border-top: 1px solid var(--border, #cbd5e1);
  margin: 4px 0;
  width: 100%;
}

.caa-sep--vertical {
  border: none;
  border-left: 1px solid var(--border, #cbd5e1);
  width: 0;
  min-height: 24px;
  margin: 0 4px;
  align-self: stretch;
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

.caa-selector,
.caa-combo,
.caa-spinner {
  width: auto;
  max-width: 100%;
  font-size: 0.75rem;
  box-sizing: border-box;
}

.caa-selector--mock {
  min-height: 1.6rem;
  padding: 2px 6px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 3px;
  background: #fff;
  display: flex;
  align-items: center;
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
}

.caa-unknown-type {
  font-weight: 600;
  color: #92400e;
}

.caa-unknown-id {
  font-family: ui-monospace, monospace;
  font-size: 0.7rem;
  color: #78716c;
}

.caa-unknown-children {
  margin-top: 4px;
}
</style>
