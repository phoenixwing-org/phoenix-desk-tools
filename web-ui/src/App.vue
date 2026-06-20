<script setup lang="ts">
import { onMounted } from "vue";
import zhCn from "element-plus/dist/locale/zh-cn.mjs";
import AppShell from "./layout/AppShell.vue";
import { useUiPrefsStore } from "./stores/uiPrefs";

const uiPrefs = useUiPrefsStore();

onMounted(() => {
  uiPrefs.hydrate();
});
</script>

<template>
  <el-config-provider :locale="zhCn" :z-index="10000">
    <AppShell />
  </el-config-provider>
</template>
