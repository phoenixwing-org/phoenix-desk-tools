<script setup lang="ts">
import type { Component } from "vue";
import RibbonToolButton from "./RibbonToolButton.vue";

export type RibbonGroupItem = {
  pageId: string;
  label: string;
  icon: Component;
  active: boolean;
  disabled: boolean;
  title: string;
};

defineProps<{
  label: string;
  items: RibbonGroupItem[];
}>();

const emit = defineEmits<{
  open: [pageId: string];
}>();
</script>

<template>
  <div class="ribbon-group" :aria-label="label">
    <div class="ribbon-group-body">
      <RibbonToolButton
        v-for="item in items"
        :key="item.pageId"
        :label="item.label"
        :icon="item.icon"
        size="large"
        layout="stacked"
        :active="item.active"
        :disabled="item.disabled"
        :title="item.title"
        @click="emit('open', item.pageId)"
      />
    </div>
  </div>
</template>

<style scoped>
.ribbon-group {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  padding: 0 8px;
  border-right: 1px solid var(--ribbon-group-divider);
  justify-content: center;
}

.ribbon-group-body {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
</style>
