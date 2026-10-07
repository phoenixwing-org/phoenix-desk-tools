<script setup lang="ts">
import { computed, toValue } from "vue";
import type { PagePrimaryDirectoryControl } from "../../composables/usePagePrimaryContribution";

const props = defineProps<{ control: PagePrimaryDirectoryControl }>();
const disabled = computed(() => Boolean(toValue(props.control.disabled)));
const options = computed(() => toValue(props.control.options).map(item => ({ value: item.value, label: item.label })));
function suggestions(query: string, callback: (items: { value: string; label: string }[]) => void) {
  const selected = options.value.some(item => item.value === query);
  callback(selected ? options.value : options.value.filter(item => `${item.label} ${item.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
}
</script>

<template>
  <div class="directory-control">
    <!-- Autocomplete commits every keystroke; unconfirmed text must never scan the old directory. -->
    <el-autocomplete
      :model-value="toValue(control.modelValue)"
      :fetch-suggestions="suggestions"
      :disabled="disabled"
      :placeholder="control.placeholder"
      :aria-label="control.label"
      :debounce="0"
      size="small"
      clearable
      select-when-unmatched
      @update:model-value="control.onUpdate(String($event ?? ''))"
      @focus="control.onRefresh"
    >
      <template #default="{ item }"><span>{{ item.label }}</span></template>
    </el-autocomplete>
    <el-button :disabled="disabled" size="small" title="选择工作空间内的目录" aria-label="选择搜索目录" @click="control.onPick">选目录</el-button>
    <el-button :disabled="disabled" :loading="Boolean(toValue(control.loading))" size="small" title="重新探测一级目录" aria-label="刷新一级目录" @click="control.onRefresh">刷新</el-button>
  </div>
</template>

<style scoped>
.directory-control { display: flex; align-items: center; gap: 4px; min-width: 0; }
.directory-control :deep(.el-autocomplete) { flex: 1 1 auto; min-width: 0; }
.directory-control :deep(.el-button) { flex: 0 0 auto; margin: 0; padding-inline: 6px; }
</style>
