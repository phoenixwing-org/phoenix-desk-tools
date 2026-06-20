<script setup lang="ts">
import type { Component } from "vue";
import RibbonToolButton from "./RibbonToolButton.vue";

export type RibbonGroupItem = {
  pageId: string;
  label: string;
  size: "large" | "small";
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
  <div class="ribbon-group">
    <div
      class="ribbon-group-body"
      :class="{
        'has-large': items.some((i) => i.size === 'large'),
        'is-multi': items.length > 1,
      }"
    >
      <template v-for="item in items" :key="item.pageId">
        <RibbonToolButton
          :label="item.label"
          :icon="item.icon"
          :size="item.size"
          :active="item.active"
          :disabled="item.disabled"
          :title="item.title"
          @click="emit('open', item.pageId)"
        />
      </template>
    </div>
    <div class="ribbon-group-caption">{{ label }}</div>
  </div>
</template>

<style scoped>
.ribbon-group {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  padding: 0 6px;
  border-right: 1px solid var(--ribbon-group-divider);
}

.ribbon-group-body {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: center;
  gap: 1px 2px;
  flex: 1;
  min-height: 0;
  max-height: var(--ribbon-group-body-height, 40px);
  padding: 2px 0 1px;
  overflow: hidden;
}

.ribbon-group-body.is-multi:not(.has-large) {
  display: grid;
  grid-template-columns: repeat(2, minmax(108px, 1fr));
  grid-auto-rows: 20px;
  gap: 1px 4px;
  max-width: 240px;
}

.ribbon-group-body.has-large.is-multi {
  display: grid;
  grid-template-columns: auto repeat(2, minmax(100px, 1fr));
  grid-auto-rows: 20px;
  align-items: center;
  max-width: 320px;
}

.ribbon-group-body.has-large:not(.is-multi) {
  max-width: 120px;
}

.ribbon-group-caption {
  text-align: center;
  font-size: 0.62rem;
  line-height: 1.2;
  color: var(--muted);
  padding: 1px 0 2px;
  border-top: 1px solid var(--ribbon-group-divider);
  white-space: nowrap;
}
</style>
