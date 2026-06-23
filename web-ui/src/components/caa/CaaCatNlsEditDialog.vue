<script setup lang="ts">
import { computed } from "vue";
import CaaInlineNlsValue from "./CaaInlineNlsValue.vue";

export type CaaNlsFlatRow = { key: string; value: string };

export type CaaNlsLocaleOption = {
  id: string;
  label: string;
  catNlsRel: string;
};

export type CaaNlsDisplayMode = "en" | "cn" | "compare";

export type CaaNlsCompareRow = { key: string; enValue: string; cnValue: string };

const props = defineProps<{
  open: boolean;
  rows: CaaNlsFlatRow[];
  dirty: boolean;
  activePath?: string;
  displayMode: CaaNlsDisplayMode;
  enRows?: CaaNlsFlatRow[];
  cnRows?: CaaNlsFlatRow[];
  hasChinese?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update:value": [key: string, value: string, locale?: "en" | "cn"];
  "update:displayMode": [mode: CaaNlsDisplayMode];
  "auto-fill": [];
}>();

const title = computed(() => {
  const name = props.activePath?.split("/").pop() ?? ".CATNls";
  if (props.displayMode === "compare") return `编辑 .CATNls · 双语对比`;
  return `编辑 .CATNls · ${name}`;
});

const modeOptions = computed(() => {
  const opts: Array<{ label: string; value: CaaNlsDisplayMode }> = [
    { label: "英文", value: "en" },
  ];
  if (props.hasChinese) {
    opts.push({ label: "中文", value: "cn" });
    opts.push({ label: "双语对比", value: "compare" });
  }
  return opts;
});

const tableRows = computed(() => {
  if (props.displayMode === "compare") {
    return []; // compare mode uses compareRows
  }
  return props.rows;
});

/** 双语对比：合并英文+中文所有键，每行三列 */
const compareRows = computed((): CaaNlsCompareRow[] => {
  const enMap = new Map((props.enRows ?? []).map((r) => [r.key, r.value]));
  const cnMap = new Map((props.cnRows ?? []).map((r) => [r.key, r.value]));
  const allKeys = new Set([...enMap.keys(), ...cnMap.keys()]);
  return Array.from(allKeys)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((key) => ({
      key,
      enValue: enMap.get(key) ?? "",
      cnValue: cnMap.get(key) ?? "",
    }));
});
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="min(92vw, 900px)"
    top="8vh"
    class="caa-nls-edit-dialog"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && $emit('close')"
  >
    <div class="caa-nls-edit-toolbar">
      <el-radio-group
        v-if="modeOptions.length > 1"
        :model-value="displayMode"
        size="small"
        @update:model-value="(v: CaaNlsDisplayMode) => emit('update:displayMode', v)"
      >
        <el-radio-button v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </el-radio-button>
      </el-radio-group>
      <el-button
        v-if="displayMode === 'compare'"
        size="small"
        @click="emit('auto-fill')"
      >
        自动填写
      </el-button>
    </div>

    <p v-if="activePath" class="caa-nls-edit-path mono muted small">{{ activePath }}</p>
    <p class="caa-nls-edit-hint muted small">
      点击「值」编辑，回车确认 · 页头「保存」写入磁盘
      <span v-if="dirty" class="caa-nls-edit-dirty">· 有未保存修改</span>
    </p>

    <!-- 单语言模式 -->
    <el-table
      v-if="displayMode !== 'compare'"
      :data="tableRows"
      size="small"
      stripe
      empty-text="无 NLS 键"
      class="caa-nls-edit-table"
    >
      <el-table-column label="值" min-width="260">
        <template #default="{ row }">
          <CaaInlineNlsValue :value="row.value" @commit="(v) => emit('update:value', row.key, v)" />
        </template>
      </el-table-column>
      <el-table-column label="键" prop="key" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ row.key }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 双语对比模式 -->
    <el-table
      v-else
      :data="compareRows"
      size="small"
      stripe
      empty-text="无 NLS 键"
      class="caa-nls-edit-table caa-nls-compare-table"
    >
      <el-table-column label="英文" min-width="220">
        <template #default="{ row }">
          <CaaInlineNlsValue
            :value="row.enValue"
            @commit="(v) => emit('update:value', row.key, v, 'en')"
          />
        </template>
      </el-table-column>
      <el-table-column label="简体中文" min-width="220">
        <template #default="{ row }">
          <CaaInlineNlsValue
            :value="row.cnValue"
            @commit="(v) => emit('update:value', row.key, v, 'cn')"
          />
        </template>
      </el-table-column>
      <el-table-column label="键" prop="key" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono">{{ row.key }}</span>
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

.caa-nls-compare-table {
  font-size: 0.78rem;
}
</style>
