<script setup lang="ts">
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useCadBatchDirectory } from "../composables/useCadBatchDirectory";
import { useAppShell } from "../composables/useAppShell";
import { CAD_BATCH_TOOLS, cadBatchToolsSection } from "../composables/cadBatchTools";
import { usePagePrimaryContribution } from "../composables/usePagePrimaryContribution";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const sharedDirectory = useCadBatchDirectory(shell.workspacePath);
usePagePrimaryContribution("cad_batch_tools", props.workbenchTabId, {
  title: "批量工具",
  summary: "低频 CAD 批处理与维护工具",
  sections: [cadBatchToolsSection(shell, "cad_batch_tools"), sharedDirectory.section],
});
</script>

<template>
  <PageLayout title="批量工具" class="desk-page-layout">
    <template #header><PageHeader title="批量工具" /></template>
    <p>从左侧「功能」选择工具，在右侧工作台独立打开。搜索目录在各工具间共用；其他参数独立保留，打开入口不会执行批处理。</p>
    <ul class="tools">
      <li v-for="tool in CAD_BATCH_TOOLS" :key="tool.page">
        <el-button link type="primary" @click="shell.openTab({ pageId: tool.page })">{{ tool.label }}</el-button>
        <p>{{ tool.description }}</p>
      </li>
    </ul>
    <p class="note">「批量属性写入」填充业务字段；「错误修正 → 属性修正」只修正计数。两者均需先预览/分析，再确认写入。</p>
  </PageLayout>
</template>

<style scoped>
.tools { list-style: none; padding: 0; }
.tools li { padding: 12px 0; border-bottom: 1px solid var(--border); }
p { color: var(--muted); line-height: 1.6; }
.tools p { margin: 4px 0 0; font-size: .9rem; }
.note { font-size: .85rem; }
</style>
