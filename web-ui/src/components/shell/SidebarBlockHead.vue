<script setup lang="ts">
import ExpandCaret from "../ExpandCaret.vue";

withDefaults(
  defineProps<{
    expanded: boolean;
    collapsible?: boolean;
  }>(),
  {
    collapsible: true,
  },
);

const emit = defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <div class="sidebar-block-head" :class="{ 'has-actions': Boolean($slots.actions) }">
    <component
      :is="collapsible ? 'button' : 'div'"
      type="button"
      class="sidebar-block-head-toggle"
      :aria-expanded="collapsible ? expanded : undefined"
      @click="collapsible ? emit('toggle') : undefined"
    >
      <ExpandCaret v-if="collapsible" :expanded="expanded" inline />
      <span class="sidebar-block-title">
        <slot name="title" />
      </span>
      <span v-if="$slots.suffix" class="sidebar-block-suffix">
        <slot name="suffix" />
      </span>
    </component>
    <div v-if="$slots.actions" class="sidebar-block-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.sidebar-block-head {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 26px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.sidebar-block-head-toggle {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  box-sizing: border-box;
}

.sidebar-block-head.has-actions .sidebar-block-head-toggle {
  flex: 1 1 0;
  width: auto;
}

div.sidebar-block-head-toggle {
  cursor: default;
}

.sidebar-block-head-toggle:hover {
  color: var(--el-text-color-primary);
}

.sidebar-block-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-block-suffix {
  flex-shrink: 0;
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.sidebar-block-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px 0 0;
  border-left: 1px solid var(--border);
  background: var(--panel-head-bg);
}
</style>
