<script setup lang="ts">
import PageHelpButton from "./PageHelpButton.vue";

defineProps<{
  title: string;
  subtitle?: string;
  pageId: string;
  /** 默认 true：三栏网格（标题 · 居中工具条 · ?） */
  toolbar?: boolean;
}>();
</script>

<template>
  <header class="page-head">
    <div class="head-row" :class="{ 'head-row-toolbar': toolbar !== false }">
      <div class="head-left">
        <h1 class="page-title">{{ title }}</h1>
        <span v-if="subtitle" class="head-subtitle">{{ subtitle }}</span>
      </div>
      <div v-if="$slots.actions" class="head-actions">
        <slot name="actions" />
      </div>
      <div class="head-help">
        <PageHelpButton :page-id="pageId" />
      </div>
    </div>
  </header>
</template>

<!-- 页头样式须在组件内非 scoped 引入，否则父页 scoped @import 无法作用到子组件 DOM -->
<style>
@import "../pages/page-shared.css";
</style>
