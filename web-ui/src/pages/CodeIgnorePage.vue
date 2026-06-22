<script setup lang="ts">
import { onMounted, provide } from "vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import PageHeader from "../components/PageHeader.vue";
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
    <PageHeader title="Code 忽略设定" page-id="code_ignore">
      <template #actions>
        <el-button size="small" :loading="loading" @click="loadPrefs">刷新</el-button>
      </template>
    </PageHeader>
    <CodeIgnorePanel layout="page" />
  </div>
</template>

<style scoped>
@import "./page-shared.css";
</style>
