<script setup lang="ts">
import { Document } from "@element-plus/icons-vue";

defineProps<{
  path: string;
  label: string;
  multiline?: boolean;
}>();
</script>

<template>
  <el-tooltip :content="path" placement="top-start" :show-after="450" :hide-after="0">
    <span class="git-file-label">
      <el-icon class="git-file-kind-icon" aria-hidden="true"><Document /></el-icon>
      <span class="git-path mono" :class="{ 'is-multiline': multiline }">{{ label }}</span>
    </span>
  </el-tooltip>
</template>

<style scoped>
.git-file-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.git-file-kind-icon {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--el-text-color-secondary);
}

.git-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.git-path.is-multiline {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: normal;
  line-height: 1.35;
  max-height: 2.7em;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

:deep(.el-tooltip__trigger) {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}
</style>
