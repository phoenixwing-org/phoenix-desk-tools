<script setup lang="ts">
defineProps<{
  side: "left" | "right";
}>();
</script>

<template>
  <svg
    class="panel-side-icon"
    :class="`panel-side-icon--${side}`"
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    aria-hidden="true"
  >
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25" />
    <line
      v-if="side === 'left'"
      x1="5.5"
      y1="2.5"
      x2="5.5"
      y2="13.5"
      stroke="currentColor"
      stroke-width="1.25"
    />
    <line
      v-else
      x1="10.5"
      y1="2.5"
      x2="10.5"
      y2="13.5"
      stroke="currentColor"
      stroke-width="1.25"
    />
  </svg>
</template>

<style scoped>
.panel-side-icon {
  display: block;
}
</style>
