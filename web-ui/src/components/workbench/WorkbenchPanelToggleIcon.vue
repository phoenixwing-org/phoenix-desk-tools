<script setup lang="ts">
defineProps<{
  side: "left" | "bottom" | "right";
  active: boolean;
}>();
</script>

<template>
  <svg
    class="workbench-panel-toggle-icon"
    :class="[`side-${side}`, { active }]"
    viewBox="0 0 20 20"
    aria-hidden="true"
  >
    <rect class="frame" x="2.25" y="2.25" width="15.5" height="15.5" rx="2.35" />
    <path v-if="side === 'left'" class="panel-fill" d="M3 4.6A1.6 1.6 0 0 1 4.6 3h3.1v14H4.6A1.6 1.6 0 0 1 3 15.4Z" />
    <path v-else-if="side === 'bottom'" class="panel-fill" d="M3 12.3h14v3.1a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 15.4Z" />
    <path v-else class="panel-fill" d="M12.3 3h3.1A1.6 1.6 0 0 1 17 4.6v10.8a1.6 1.6 0 0 1-1.6 1.6h-3.1Z" />
    <line v-if="side === 'left'" class="divider" x1="7.75" y1="3" x2="7.75" y2="17" />
    <line v-else-if="side === 'bottom'" class="divider" x1="3" y1="12.25" x2="17" y2="12.25" />
    <line v-else class="divider" x1="12.25" y1="3" x2="12.25" y2="17" />
  </svg>
</template>

<style scoped>
.workbench-panel-toggle-icon { width: 20px; height: 20px; overflow: visible; }
.frame { fill: none; stroke: currentColor; stroke-width: 1.5; }
.divider { stroke: currentColor; stroke-width: 1.25; }
.panel-fill { fill: transparent; transition: fill 120ms ease; }
.active .panel-fill { fill: currentColor; }
.active .divider { stroke: color-mix(in srgb, var(--page-bg, #fff) 88%, transparent); }
</style>
