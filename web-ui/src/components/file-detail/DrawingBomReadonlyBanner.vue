<script setup lang="ts">
import { toRef } from "vue";
import type { BomPreview } from "../../api";
import { useDrawingBomReadonly } from "../../composables/useDrawingBomReadonly";

const props = withDefaults(
  defineProps<{
    preview: BomPreview | null;
    /** 紧凑模式：用于概览区一行提示 */
    compact?: boolean;
    /** 是否显示「打开模型」按钮（有来源路径时） */
    showOpenButton?: boolean;
  }>(),
  {
    compact: false,
    showOpenButton: true,
  },
);

const {
  bomReadonly,
  bomSourceRel,
  canOpenSourceModel,
  readonlyTitle,
  readonlyDescription,
  openSourceModel,
} = useDrawingBomReadonly(toRef(props, "preview"));
</script>

<template>
  <el-alert
    v-if="bomReadonly"
    type="info"
    :closable="false"
    :title="compact ? undefined : readonlyTitle"
    class="drawing-readonly-banner"
    :class="{ compact }"
  >
    <template v-if="compact" #default>
      <span>{{ readonlyTitle }}</span>
      <span v-if="bomSourceRel">
        · 来源
        <button type="button" class="link-btn mono" @click="openSourceModel">{{ bomSourceRel }}</button>
      </span>
      <span v-else> · {{ readonlyDescription }}</span>
    </template>
    <template v-else #default>
      <p class="banner-text">{{ readonlyDescription }}</p>
      <p v-if="bomSourceRel" class="source-line">
        来源模型：
        <button type="button" class="link-btn mono" @click="openSourceModel">{{ bomSourceRel }}</button>
      </p>
      <div v-if="showOpenButton && canOpenSourceModel" class="banner-actions">
        <el-button type="primary" size="small" @click="openSourceModel">打开模型</el-button>
      </div>
    </template>
  </el-alert>
</template>

<style scoped>
.drawing-readonly-banner {
  margin-bottom: 10px;
}
.drawing-readonly-banner.compact {
  margin-bottom: 0;
}
.drawing-readonly-banner.compact :deep(.el-alert__content) {
  font-size: 0.82rem;
  line-height: 1.45;
}
.banner-text {
  margin: 0 0 6px;
  font-size: 0.84rem;
}
.source-line {
  margin: 0 0 8px;
  font-size: 0.82rem;
}
.banner-actions {
  margin-top: 4px;
}
.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--el-color-primary);
  cursor: pointer;
  font: inherit;
}
.link-btn:hover {
  text-decoration: underline;
}
.mono {
  font-family: var(--font-mono);
}
</style>
