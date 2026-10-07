<script setup lang="ts">
import { computed } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const item = computed(() => shell.currentNavItem.value);
const pageId = computed(() => shell.currentPage.value);
</script>

<template>
  <PageLayout :title="item?.label ?? pageId" class="desk-page-layout" :body-inset="false">
    <template #header>
      <PageHeader :title="item?.label ?? pageId" />
    </template>
    <PageMainBlock class="placeholder">
      <el-empty :image-size="80">
        <template #description>
          <p class="desc">{{ item?.description ?? "功能开发中" }}</p>
          <p class="hint">
            当前版本没有与页面标识 <code>{{ pageId }}</code> 匹配的实现，请检查应用导航配置。
          </p>
        </template>
      </el-empty>
    </PageMainBlock>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";

.desc {
  margin: 0 0 12px;
  color: var(--muted);
}

.hint {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.6;
  color: #64748b;
  max-width: 520px;
}

code {
  font-size: 0.85em;
}
</style>
