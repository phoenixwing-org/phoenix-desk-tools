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
  gap: 0;
  min-width: 0;
  height: 100%;
}

.ribbon-tab {
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  padding: 0 14px;
  font-size: 0.8rem;
  color: #64748b;
  cursor: pointer;
  white-space: nowrap;
  height: 100%;
  box-sizing: border-box;
}

.ribbon-tab:hover {
  color: #1e293b;
  background: rgba(255, 255, 255, 0.35);
}

.ribbon-tab.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.25);
}
</style>
