<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  value: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ commit: [value: string] }>();

const editing = ref(false);
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

watch(editing, async (on) => {
  if (on) {
    draft.value = props.value;
    await nextTick();
    inputRef.value?.focus();
    inputRef.value?.select();
  }
});

function startEdit() {
  if (props.disabled) return;
  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

function commitEdit() {
  if (!editing.value) return;
  editing.value = false;
  const v = draft.value;
  if (v !== props.value) emit("commit", v);
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
    class="caa-inline-value-input"
    type="text"
    :value="draft"
    @input="draft = ($event.target as HTMLInputElement).value"
    @keydown="onKeydown"
    @blur="commitEdit"
  />
  <span
    v-else
    class="caa-inline-value-text"
    :class="{ editable: !disabled }"
    :title="disabled ? undefined : '点击编辑，回车确认'"
    @click="startEdit"
  >
    {{ value || "（空）" }}
  </span>
</template>

<style scoped>
.caa-inline-value-text {
  display: block;
  max-width: 100%;
  word-break: break-word;
}

.caa-inline-value-text.editable {
  cursor: text;
  border-radius: 2px;
  padding: 0 2px;
}

.caa-inline-value-text.editable:hover {
  background: rgba(59, 130, 246, 0.08);
  outline: 1px dashed rgba(59, 130, 246, 0.35);
}

.caa-inline-value-input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: inherit;
  padding: 2px 4px;
  border: 1px solid var(--accent, #3b82f6);
  border-radius: 2px;
}
</style>
