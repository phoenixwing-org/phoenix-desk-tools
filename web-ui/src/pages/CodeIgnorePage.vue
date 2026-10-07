<script setup lang="ts">
import { computed, onMounted, provide } from "vue";
import CodeIgnorePanel from "../components/CodeIgnorePanel.vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import { codeIgnoreFormKey } from "../composables/codeIgnoreFormKey";
import { useCodeIgnoreForm } from "../composables/useCodeIgnoreForm";
import { useCodeIgnorePropertySheet } from "../composables/useCodeIgnorePropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const form = useCodeIgnoreForm();
const { loading, loadPrefs } = form;

provide(codeIgnoreFormKey, form);
useCodeIgnorePropertySheet("code_ignore", form);

const presetOptions = computed(() => [
  { value: "", label: "（无）" },
  ...form.ignorePresets.value.map((preset) => ({
    value: preset.id,
    label: preset.label,
  })),
]);

usePagePrimaryContribution("code_ignore", props.workbenchTabId, {
  summary: computed(() => `合并 ${form.mergedIgnoreCount.value} 条忽略规则`),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "source",
      title: "规则来源",
      description: "独立保留工作空间忽略设定；保存不会触发源码扫描。",
      controls: [
        {
          id: "file",
          kind: "readonly",
          label: "code.ignore",
          value: computed(() => form.ignoreFileDisplay.value || ".phoenix/code.ignore"),
          mono: true,
        },
        {
          id: "file-count",
          kind: "readonly",
          label: "文件规则",
          value: computed(() => form.ignoreFilePatterns.value.length),
        },
        {
          id: "merged-count",
          kind: "readonly",
          label: "合并规则",
          value: form.mergedIgnoreCount,
        },
        {
          id: "consumers",
          kind: "readonly",
          label: "使用范围",
          value: form.consumerScope,
        },
      ],
      actions: [
        { id: "refresh", label: "刷新", loading: form.loading, run: form.loadPrefs },
      ],
    },
    {
      id: "custom",
      title: "自定义配置",
      controls: [
        {
          id: "preset",
          kind: "select",
          label: "预设",
          modelValue: form.ignorePreset,
          options: presetOptions,
          onUpdate: (value) => {
            form.ignorePreset.value = value;
            form.onApplyPreset();
          },
        },
        {
          id: "patterns",
          kind: "textarea",
          label: "忽略规则",
          description: "每行一条，支持 Git 式通配；当前仅保存配置。",
          modelValue: form.customIgnoreText,
          placeholder: "# 每行一条\nImportedInterfaces",
          rows: 8,
          mono: true,
          onUpdate: (value) => { form.customIgnoreText.value = value; },
        },
      ],
      actions: [
        ...(form.hasProcessSuggestions.value ? [{
          id: "suggestions",
          label: `加入推荐（${form.processDirSuggestions.value.length}）`,
          run: form.onApplySuggestions,
        }] : []),
        {
          id: "save",
          label: "保存配置",
          tone: "primary" as const,
          loading: form.saving,
          run: async () => { await form.onSave(); },
        },
      ],
    },
  ]),
});

onMounted(() => {
  void loadPrefs();
});
</script>

<template>
  <PageLayout title="Code 忽略设定" class="desk-page-layout" :body-inset="false">
    <template #header>
      <PageHeader title="Code 忽略设定">
        <template #right>
          <el-button size="small" :loading="loading" @click="loadPrefs">刷新</el-button>
        </template>
      </PageHeader>
    </template>
    <PageMainBlock class="tool-page code-ignore-page">
      <CodeIgnorePanel layout="page" />
    </PageMainBlock>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";
</style>
