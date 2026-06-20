<script setup lang="ts">
defineProps<{
  tabs: { id: string; label: string }[];
  activeTab: string;
}>();

const emit = defineEmits<{
  "update:activeTab": [id: string];
}>();
</script>

<template>
  <div class="ribbon-tabs" role="tablist" aria-label="功能区">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="ribbon-tab"
      :class="{ active: tab.id === activeTab }"
      :aria-selected="tab.id === activeTab"
      @click="emit('update:activeTab', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<style scoped>
.ribbon-tabs {
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 1px;
  height: 30px;
  padding: 2px;
  border-radius: var(--phoenix-radius-md);
  background: var(--phoenix-ribbon-tab-track);
  box-shadow: inset 0 1px 2px var(--phoenix-border-subtle);
}

.ribbon-tab {
  border: none;
  border-radius: calc(var(--phoenix-radius-md) - 2px);
  background: transparent;
  padding: 0 14px;
  height: 26px;
  font-size: 0.74rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--phoenix-text-muted);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.ribbon-tab:hover:not(.active) {
  color: var(--phoenix-text-secondary);
  background: var(--phoenix-ribbon-tab-hover);
}

.ribbon-tab.active {
  color: var(--phoenix-accent-hover);
  font-weight: 600;
  background: var(--phoenix-ribbon-tab-active-bg);
  box-shadow:
    var(--phoenix-shadow-sm),
    inset 0 0 0 1px var(--phoenix-border-subtle);
}
</style>
