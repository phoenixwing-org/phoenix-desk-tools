<script setup lang="ts">
defineProps<{
  label: string;
  title?: string;
  active?: boolean;
}>();
</script>

<template>
  <button
    type="button"
    class="ribbon-util-btn"
    :class="{ active }"
    :title="title || label"
  >
    <span class="ribbon-util-icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="ribbon-util-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.ribbon-util-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 36px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: transparent;
  color: var(--text, #334155);
  font-size: 0.72rem;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
}

.ribbon-util-btn:hover {
  background: var(--ribbon-btn-hover, rgba(148, 163, 184, 0.15));
  border-color: var(--border, #e2e8f0);
}

.ribbon-util-btn.active {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.ribbon-util-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.ribbon-util-icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.ribbon-util-btn.active .ribbon-util-icon {
  color: #1d4ed8;
}
</style>
