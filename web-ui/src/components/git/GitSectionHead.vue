<script setup lang="ts">
import { Minus, Plus, RefreshLeft } from "@element-plus/icons-vue";
import ExpandCaret from "phoenix-wing/components/PnwExpandCaret.vue";

defineProps<{
  title: string;
  count: number | string;
  expanded: boolean;
  primaryAction?: "plus" | "minus";
  primaryTooltip?: string;
  showRevert?: boolean;
  revertTooltip?: string;
  busy?: "primary" | "revert" | null;
}>();

const emit = defineEmits<{
  toggle: [];
  primary: [];
  revert: [];
}>();
</script>

<template>
  <div class="git-section-head">
    <button
      type="button"
      class="section-head-toggle"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <ExpandCaret :expanded="expanded" />
      <h2 class="section-title">
        {{ title }} <span class="section-count">{{ count }}</span>
      </h2>
    </button>
    <div v-if="primaryAction || showRevert" class="section-head-actions">
      <el-tooltip
        v-if="showRevert"
        :content="revertTooltip ?? '放弃所有的更改'"
        placement="top"
        :show-after="400"
      >
        <el-button
          link
          size="small"
          class="git-icon-btn"
          :aria-label="revertTooltip ?? '放弃所有的更改'"
          :loading="busy === 'revert'"
          @click.stop="emit('revert')"
        >
          <el-icon><RefreshLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip
        v-if="primaryAction === 'plus'"
        :content="primaryTooltip ?? '全部暂存'"
        placement="top"
        :show-after="400"
      >
        <el-button
          link
          size="small"
          class="git-icon-btn"
          :aria-label="primaryTooltip ?? '全部暂存'"
          :loading="busy === 'primary'"
          @click.stop="emit('primary')"
        >
          <el-icon><Plus /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip
        v-else-if="primaryAction === 'minus'"
        :content="primaryTooltip ?? '全部取消暂存'"
        placement="top"
        :show-after="400"
      >
        <el-button
          link
          size="small"
          class="git-icon-btn"
          :aria-label="primaryTooltip ?? '全部取消暂存'"
          :loading="busy === 'primary'"
          @click.stop="emit('primary')"
        >
          <el-icon><Minus /></el-icon>
        </el-button>
      </el-tooltip>
    </div>
  </div>
</template>

<style scoped>
.git-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
}

.section-head-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}

.section-head-toggle:hover .section-title {
  color: var(--el-text-color-primary);
}

.section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.section-count {
  color: var(--el-text-color-secondary);
  font-weight: 400;
}

.section-head-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.git-icon-btn {
  padding: 0;
  margin: 0;
  width: 22px;
  height: 22px;
  min-height: 22px;
  border: none;
  color: var(--el-text-color-regular);
}

.git-icon-btn:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color);
  border-radius: 3px;
}

.git-icon-btn :deep(.el-icon) {
  font-size: 16px;
}
</style>
