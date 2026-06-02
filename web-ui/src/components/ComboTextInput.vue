<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { ComboOption } from "../utils/typeCodeOptions";

const model = defineModel<string>({ default: "" });

const props = withDefaults(
  defineProps<{
    options?: ComboOption[];
    disabled?: boolean;
    readonly?: boolean;
    placeholder?: string;
  }>(),
  {
    options: () => [],
    disabled: false,
    readonly: false,
  },
);

const root = ref<HTMLElement | null>(null);
const open = ref(false);

function setOpen(next: boolean) {
  if (props.disabled || props.readonly) {
    open.value = false;
    return;
  }
  open.value = next && props.options.length > 0;
}

function toggleList() {
  setOpen(!open.value);
}

function onInputFocus() {
  setOpen(true);
}

function pick(opt: ComboOption) {
  model.value = opt.value;
  setOpen(false);
}

function onDocPointer(e: PointerEvent) {
  const el = root.value;
  if (!el || !open.value) return;
  if (!el.contains(e.target as Node)) setOpen(false);
}

function onDocKey(e: KeyboardEvent) {
  if (e.key === "Escape") setOpen(false);
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onDocKey);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onDocKey);
});
</script>

<template>
  <div ref="root" class="combo-wrap">
    <div class="combo-field">
      <input
        v-model="model"
        class="combo-text-input"
        :class="{ readonly }"
        :disabled="disabled"
        :readonly="readonly"
        :placeholder="placeholder"
        spellcheck="false"
        @focus="onInputFocus"
      />
      <button
        v-if="options.length"
        type="button"
        class="combo-toggle"
        :disabled="disabled || readonly"
        :aria-expanded="open"
        aria-haspopup="listbox"
        title="展开全部选项"
        tabindex="-1"
        @mousedown.prevent
        @click="toggleList"
      >
        ▾
      </button>
    </div>
    <ul v-show="open" class="combo-menu" role="listbox">
      <li
        v-for="opt in options"
        :key="opt.value"
        role="option"
        :class="{ active: (model ?? '').trim().toUpperCase() === opt.value.toUpperCase() }"
        @mousedown.prevent="pick(opt)"
      >
        <span class="combo-opt-val">{{ opt.value }}</span>
        <span class="combo-opt-label">{{ opt.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.combo-wrap {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
}

.combo-field {
  display: flex;
  align-items: stretch;
  width: 100%;
}

.combo-text-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px 0 0 6px;
  font-size: 0.82rem;
  color: inherit;
}

.combo-field:has(.combo-toggle) .combo-text-input {
  border-right: none;
  border-radius: 6px 0 0 6px;
}

.combo-field:not(:has(.combo-toggle)) .combo-text-input {
  border-radius: 6px;
}

.combo-toggle {
  flex-shrink: 0;
  width: 28px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-left: none;
  border-radius: 0 6px 6px 0;
  background: #f8fafc;
  color: var(--muted);
  font-size: 0.75rem;
  cursor: pointer;
  line-height: 1;
}

.combo-toggle:hover:not(:disabled) {
  background: #eef2ff;
  color: var(--text);
}

.combo-toggle:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.combo-text-input.readonly {
  background: #f3f4f6;
}

.combo-text-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.combo-menu {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 0;
  top: calc(100% + 2px);
  margin: 0;
  padding: 4px 0;
  list-style: none;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
  max-height: 160px;
  overflow-y: auto;
}

.combo-menu li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  font-size: 0.82rem;
  cursor: pointer;
}

.combo-menu li:hover,
.combo-menu li.active {
  background: #eff6ff;
}

.combo-opt-val {
  font-weight: 600;
  font-family: ui-monospace, monospace;
  min-width: 1.2em;
}

.combo-opt-label {
  color: var(--muted);
}
</style>
