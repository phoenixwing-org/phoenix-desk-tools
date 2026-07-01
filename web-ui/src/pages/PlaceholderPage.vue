<script setup lang="ts">
import { computed } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const item = computed(() => shell.currentNavItem.value);
const pageId = computed(() => shell.currentPage.value);
</script>

<template>
  <div class="page placeholder">
    <PageHeader :title="item?.label ?? pageId" :page-id="pageId" />
    <el-empty :image-size="80">
      <template #description>
        <p class="desc">{{ item?.description ?? "功能开发中" }}</p>
        <p class="hint">
          此页对应桌面壳中的同名功能，后续将通过 Python 服务层 API 接入（逻辑复用
          <code>phoenix/</code> 核心模块，不重写算法）。
        </p>
      </template>
    </el-empty>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.placeholder {
  width: 100%;
  box-sizing: border-box;
  padding: 32px 28px;
}

.page-title {
  margin: 0;
  font-size: 1.2rem;
}

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
