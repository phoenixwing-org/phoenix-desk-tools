<script setup lang="ts">
import { onMounted } from "vue";
import AppShell from "./layout/AppShell.vue";
import { useUiPrefsStore } from "./stores/uiPrefs";

const uiPrefs = useUiPrefsStore();

onMounted(() => {
  uiPrefs.hydrate();
});
</script>

<template>
  <AppShell />
</template>
