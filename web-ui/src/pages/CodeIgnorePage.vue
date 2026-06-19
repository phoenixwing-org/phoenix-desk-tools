<script setup lang="ts">
import { onMounted } from "vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import PageHelpButton from "../components/PageHelpButton.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

onMounted(() => {
  void shell.openCodeIgnoreSidebar();
});
</script>

<template>
  <div class="page tool-page code-ignore-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">Code 忽略设定</h1>
        <p class="page-desc">
          所有 Code 工具共用；亦可在右侧栏「忽略」Tab 中编辑（Code 模块页面下）
        </p>
        <div class="head-help">
          <PageHelpButton page-id="code_ignore" />
        </div>
      </div>
    </header>
    <CodeIgnorePanel layout="page" />
  </div>
</template>

<style scoped>
@import "./page-shared.css";
</style>
