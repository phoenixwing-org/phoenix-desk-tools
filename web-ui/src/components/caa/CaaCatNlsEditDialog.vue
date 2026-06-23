<script setup lang="ts">
import { computed } from "vue";
import { CAA_NLS_LOCALE_SIMPLIFIED_CHINESE } from "@phoenix/catdlg-core";
import CaaInlineNlsValue from "./CaaInlineNlsValue.vue";

export type CaaNlsFlatRow = { key: string; value: string };

export type CaaNlsLocaleOption = {
  id: string;
  label: string;
  catNlsRel: string;
};

const props = defineProps<{
  open: boolean;
  activeLocale: string;
  localeOptions: CaaNlsLocaleOption[];
  rows: CaaNlsFlatRow[];
  dirty: boolean;
  canCreateChinese: boolean;
  creatingChinese: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update:locale": [localeId: string];
  "update:value": [key: string, value: string];
  "create-chinese": [];
}>();

const activeOption = computed(
  () => props.localeOptions.find((o) => o.id === props.activeLocale) ?? props.localeOptions[0],
);

const title = computed(() => {
  const name = activeOption.value?.catNlsRel.split("/").pop() ?? ".CATNls";
  return `编辑 .CATNls · ${name}`;
});
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="min(92vw, 720px)"
    top="8vh"
    class="caa-nls-edit-dialog"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && $emit('close')"
  >
    <div class="caa-nls-edit-toolbar">
      <el-radio-group
        v-if="localeOptions.length > 1"
        :model-value="activeLocale"
        size="small"
        @update:model-value="(v: string) => emit('update:locale', v)"
      >
        <el-radio-button v-for="opt in localeOptions" :key="opt.id" :value="opt.id">
          {{ opt.label }}
        </el-radio-button>
      </el-radio-group>
      <el-button
        v-if="canCreateChinese"
        type="primary"
        size="small"
        :loading="creatingChinese"
        @click="emit('create-chinese')"
      >
        添加简体中文（{{ CAA_NLS_LOCALE_SIMPLIFIED_CHINESE }}）
      </el-button>
    </div>

    <p v-if="activeOption" class="caa-nls-edit-path mono muted small">{{ activeOption.catNlsRel }}</p>
    <p class="caa-nls-edit-hint muted small">
      中文文件路径：
      <span class="mono">msgcatalog/{{ CAA_NLS_LOCALE_SIMPLIFIED_CHINESE }}/&lt;同名&gt;.CATNls</span>
      · 点击「值」编辑，回车确认 · 页头「保存」写入磁盘
      <span v-if="dirty" class="caa-nls-edit-dirty">· 有未保存修改</span>
    </p>

    <el-table :data="rows" size="small" stripe empty-text="无 NLS 键" class="caa-nls-edit-table">
      <el-table-column label="键" prop="key" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ row.key }}</span>
        </template>
      </el-table-column>
      <el-table-column label="值" min-width="280">
        <template #default="{ row }">
          <CaaInlineNlsValue :value="row.value" @commit="(v) => emit('update:value', row.key, v)" />
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<style scoped>
.caa-nls-edit-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.caa-nls-edit-path {
  margin: 0 0 6px;
  word-break: break-all;
}

.caa-nls-edit-hint {
  margin: 0 0 10px;
}

.caa-nls-edit-dirty {
  color: var(--accent, #2563eb);
  font-weight: 600;
}

.caa-nls-edit-table {
  font-size: 0.8rem;
}
</style>
