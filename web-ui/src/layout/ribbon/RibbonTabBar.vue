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
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
}

.ribbon-tab {
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  padding: 4px 14px;
  font-size: 0.82rem;
  color: var(--muted);
  cursor: pointer;
  white-space: nowrap;
  height: 44px;
  box-sizing: border-box;
}

.ribbon-tab:hover {
  color: var(--text);
  background: var(--ribbon-btn-hover);
}

.ribbon-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
</style>
