<script setup lang="ts">
import ShellPanelToggleBar from "../../components/ShellPanelToggleBar.vue";

defineProps<{
  layout?: "group" | "inline";
}>();
</script>

<template>
  <ShellPanelToggleBar variant="ribbon" :layout="layout" />
</template>
