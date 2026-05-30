<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const item = computed(() => shell.currentNavItem.value);
const pageId = computed(() => shell.currentPage.value);
</script>

<template>
  <div class="page placeholder">
    <h1 class="page-title">{{ item?.label ?? pageId }}</h1>
    <p class="desc">{{ item?.description ?? "功能开发中" }}</p>
    <p class="hint">
      此页对应桌面壳中的同名功能，后续将通过 Python 服务层 API 接入（逻辑复用
      <code>fcdesk/</code> 核心模块，不重写算法）。
    </p>
  </div>
</template>

<style scoped>
.placeholder {
  padding: 32px 28px;
  max-width: 640px;
}

.page-title {
  margin: 0 0 8px;
  font-size: 1.2rem;
}

.desc {
  margin: 0 0 16px;
  color: var(--muted);
}

.hint {
  font-size: 0.88rem;
  line-height: 1.6;
  color: #64748b;
}

code {
  font-size: 0.85em;
}
</style>
