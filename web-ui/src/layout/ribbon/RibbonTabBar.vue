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
  height: 28px;
  padding: 2px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.06);
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.06);
}

.ribbon-tab {
  border: none;
  border-radius: 5px;
  background: transparent;
  padding: 0 13px;
  height: 24px;
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #64748b;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.ribbon-tab:hover:not(.active) {
  color: #334155;
  background: rgba(255, 255, 255, 0.45);
}

.ribbon-tab.active {
  color: #1d4ed8;
  font-weight: 600;
  background: linear-gradient(180deg, #fff 0%, #f8fafc 100%);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.08),
    inset 0 0 0 1px rgba(148, 163, 184, 0.35);
}
</style>
