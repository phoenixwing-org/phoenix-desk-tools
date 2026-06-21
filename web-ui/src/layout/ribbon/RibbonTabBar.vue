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
  align-items: stretch;
  align-self: stretch;
  gap: 0;
  height: 100%;
  min-height: 32px;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.ribbon-tab {
  position: relative;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 0 18px;
  margin: 0;
  height: auto;
  min-height: 32px;
  font-size: 0.78rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--phoenix-text-secondary, #475569);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s ease;
}

.ribbon-tab:hover:not(.active) {
  color: var(--phoenix-text, #1e293b);
  background: rgba(148, 163, 184, 0.1);
}

.ribbon-tab.active {
  color: var(--phoenix-wps-accent, #217346);
  font-weight: 600;
  background: transparent;
  box-shadow: none;
}

.ribbon-tab.active::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--phoenix-wps-accent, #217346);
}
</style>
