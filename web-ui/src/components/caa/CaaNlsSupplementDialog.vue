<script setup lang="ts">
import { computed, ref } from "vue";

export type NlsSupplementDirection = "en-to-cn" | "cn-to-en";

const props = defineProps<{
  open: boolean;
  direction: NlsSupplementDirection;
  missingKeys: string[];
  applying: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update:direction": [value: NlsSupplementDirection];
  "apply:keys": [payload: { keys: string[]; copyValues: boolean }];
}>();

const checkedKeys = ref<string[]>([]);
const copyValues = ref(true);

const title = computed(() => `补全缺失的 NLS 键（${props.missingKeys.length} 个）`);

function onOpen() {
  checkedKeys.value = [...props.missingKeys];
  copyValues.value = true;
}

function onApply() {
  if (!checkedKeys.value.length) return;
  emit("apply:keys", { keys: [...checkedKeys.value], copyValues: copyValues.value });
}
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="min(92vw, 640px)"
    top="8vh"
    class="caa-nls-supplement-dialog"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && $emit('close')"
    @open="onOpen"
  >
    <div class="supplement-controls">
      <label class="supplement-field">
        <span class="supplement-field-label">补全方向</span>
        <el-select
          :model-value="direction"
          size="small"
          style="width: 180px"
          @update:model-value="(v: NlsSupplementDirection) => emit('update:direction', v)"
        >
          <el-option label="英文 → 简体中文" value="en-to-cn" />
          <el-option label="简体中文 → 英文" value="cn-to-en" />
        </el-select>
      </label>
      <label class="supplement-field supplement-field-switch">
        <el-switch v-model="copyValues" size="small" />
        <span class="supplement-switch-label">同时复制源语言值作为占位</span>
      </label>
    </div>

    <p class="supplement-hint muted small">
      以下键在目标语言中缺失，将从源语言补充。取消勾选可跳过不需要的键。
    </p>

    <el-checkbox-group v-model="checkedKeys" class="supplement-key-list">
      <el-checkbox v-for="key in missingKeys" :key="key" :label="key" class="supplement-key-item">
        <span class="mono">{{ key }}</span>
      </el-checkbox>
    </el-checkbox-group>

    <p v-if="!missingKeys.length" class="muted small supplement-empty">无缺失键</p>

    <template #footer>
      <div class="supplement-footer">
        <el-button size="small" :disabled="applying" @click="$emit('close')">取消</el-button>
        <el-button
          type="primary"
          size="small"
          :loading="applying"
          :disabled="!checkedKeys.length"
          @click="onApply"
        >
          补全 {{ checkedKeys.length }} 个键
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.supplement-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}

.supplement-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.supplement-field-label {
  font-size: 0.82rem;
  color: var(--muted, #64748b);
}

.supplement-field-switch {
  gap: 8px;
}

.supplement-switch-label {
  font-size: 0.82rem;
}

.supplement-hint {
  margin: 0 0 8px;
}

.supplement-key-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px 8px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 4px;
  background: var(--phoenix-bg-elevated, #fafafa);
}

.supplement-key-item {
  font-size: 0.78rem;
}

.supplement-empty {
  text-align: center;
  padding: 16px;
}

.supplement-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
