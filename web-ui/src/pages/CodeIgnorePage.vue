<script setup lang="ts">
import { onMounted, provide } from "vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import PageHelpButton from "../components/PageHelpButton.vue";
import { codeIgnoreFormKey } from "../composables/codeIgnoreFormKey";
import { useAppShell } from "../composables/useAppShell";
import { useCodeIgnoreForm } from "../composables/useCodeIgnoreForm";
import { useCodeIgnorePropertySheet } from "../composables/useCodeIgnorePropertySheet";

const shell = useAppShell();
const form = useCodeIgnoreForm();
const { loading, loadPrefs } = form;

provide(codeIgnoreFormKey, form);
useCodeIgnorePropertySheet("code_ignore", form);

onMounted(() => {
  void loadPrefs();
  void shell.openCodeIgnoreSidebar();
});
</script>

<template>
  <div class="page tool-page code-ignore-page">
    <header class="page-head">
      <div class="head-row head-row-toolbar">
        <div class="head-left">
          <h1 class="page-title">Code 忽略设定</h1>
        </div>
        <div class="head-actions">
          <el-button size="small" :loading="loading" @click="loadPrefs">刷新</el-button>
        </div>
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
