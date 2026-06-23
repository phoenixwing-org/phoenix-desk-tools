<script setup lang="ts">
import { computed, inject, nextTick, ref, unref, watch } from "vue";
import { CAA_NLS_EDIT_KEY } from "../../composables/caaNlsEdit";

const props = withDefaults(
  defineProps<{
    text: string;
    nlsKey: string;
    nodeId: string;
    prop: import("@phoenix/catdlg-core").NlsStringProp;
    columnIndex?: number;
    /** 占位文案（如选择列表）仍允许点击编辑 */
    allowPlaceholder?: boolean;
    class?: string;
    mono?: boolean;
  }>(),
  { allowPlaceholder: false, mono: false },
);

const editCtx = inject(CAA_NLS_EDIT_KEY, null);

const editing = ref(false);
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

const canEdit = computed(
  () =>
    Boolean(unref(editCtx?.enabled)) &&
    (props.allowPlaceholder || props.text.trim().length > 0 || props.prop === "title"),
);

watch(editing, async (on) => {
  if (on) {
    draft.value = props.allowPlaceholder && props.text.startsWith("（") ? "" : props.text;
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
  }
});

function startEdit() {
  if (!canEdit.value) return;
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

function commitEdit() {
  if (!editing.value) return;
  const value = draft.value.trim();
  editing.value = false;
  if (!editCtx) return;
  if (!value && !props.allowPlaceholder) return;
  editCtx.commit(props.nlsKey, value, {
    nodeId: props.nodeId,
    prop: props.prop,
    columnIndex: props.columnIndex,
  });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    commitEdit();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  }
}
</script>

<template>
  <input
    v-if="editing"
    ref="inputRef"
    class="caa-inline-nls-input"
    :class="[{ mono: mono }, props.class]"
    type="text"
    :value="draft"
    @input="draft = ($event.target as HTMLInputElement).value"
    @keydown="onKeydown"
    @blur="commitEdit"
  />
  <span
    v-else
    class="caa-inline-nls-text"
    :class="[{ editable: canEdit, mono: mono, placeholder: allowPlaceholder }, props.class]"
    :title="canEdit ? '点击编辑，回车确认' : undefined"
    @click="startEdit"
  >
    {{ text }}
  </span>
</template>

<style scoped>
.caa-inline-nls-text {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: baseline;
}

.caa-inline-nls-text.editable {
  cursor: text;
  border-radius: 2px;
  padding: 0 2px;
}

.caa-inline-nls-text.editable:hover {
  background: rgba(59, 130, 246, 0.1);
  outline: 1px dashed rgba(59, 130, 246, 0.35);
}

.caa-inline-nls-text.placeholder {
  color: var(--muted, #64748b);
}

.caa-inline-nls-input {
  font: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  min-width: 4ch;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0 2px;
  border: 1px solid var(--accent, #3b82f6);
  border-radius: 2px;
  background: #fff;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
