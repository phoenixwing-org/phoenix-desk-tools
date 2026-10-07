<script setup lang="ts">
defineProps<{ filters: Array<{ extension: string; label: string; count: number; checked: boolean; mixed: boolean; isNew: boolean }>; disabled: boolean }>();
defineEmits<{ toggle: [extension: string, checked: boolean] }>();
</script>
<template>
  <div v-if="filters.length" class="extension-filter" role="group" aria-label="文件后缀筛选">
    <span>文件后缀</span>
    <el-checkbox v-for="filter in filters" :key="filter.extension" :model-value="filter.checked" :indeterminate="filter.mixed" :disabled="disabled" @change="$emit('toggle', filter.extension, Boolean($event))">{{ filter.label }} ({{ filter.count }}) <small v-if="filter.isNew">新增</small></el-checkbox>
    <small>按目录记住；隐藏后缀同时取消相应文件勾选。</small>
  </div>
</template>
<style scoped>
.extension-filter { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; margin: 6px 0 10px; font-size: .8rem; }.extension-filter .el-checkbox { margin: 0; } small { color: var(--muted); font-size: .73rem; }
</style>
