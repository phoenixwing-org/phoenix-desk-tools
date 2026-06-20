<script setup lang="ts">
import type { Component } from "vue";

defineProps<{
  label: string;
  icon: Component;
  size?: "large" | "small";
  active?: boolean;
  disabled?: boolean;
  title?: string;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    type="button"
    class="ribbon-tool-btn"
    :class="[
      size === 'large' ? 'size-large' : 'size-small',
      { active, disabled },
    ]"
    :disabled="disabled"
    :title="title || label"
    @click="emit('click')"
  >
    <span class="ribbon-tool-icon" aria-hidden="true">
      <component :is="icon" />
    </span>
    <span class="ribbon-tool-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.ribbon-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  min-width: 0;
}

.ribbon-tool-btn.size-large {
  flex-direction: row;
  width: auto;
  min-width: 52px;
  max-width: 88px;
  min-height: 22px;
  padding: 2px 6px;
  gap: 4px;
}

.ribbon-tool-btn.size-small {
  flex-direction: row;
  width: 100%;
  min-height: 20px;
  padding: 1px 6px;
  justify-content: flex-start;
}

.ribbon-tool-btn:hover:not(:disabled) {
  background: var(--ribbon-btn-hover);
  border-color: var(--border);
}

.ribbon-tool-btn.active {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.ribbon-tool-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.ribbon-tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #334155;
}

.ribbon-tool-btn.active .ribbon-tool-icon {
  color: #1d4ed8;
}

.size-large .ribbon-tool-icon {
  width: 16px;
  height: 16px;
  font-size: 15px;
}

.size-small .ribbon-tool-icon {
  width: 14px;
  height: 14px;
  font-size: 13px;
}

.ribbon-tool-label {
  font-size: 0.68rem;
  line-height: 1.1;
  text-align: left;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size-large .ribbon-tool-label {
  font-weight: 600;
  font-size: 0.7rem;
}

.size-small .ribbon-tool-label {
  font-size: 0.68rem;
}
</style>
