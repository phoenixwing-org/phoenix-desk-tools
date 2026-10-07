<script setup lang="ts">
export type SyncAction = { id: string; label: string; disabled: boolean; primary?: boolean; run: () => unknown };
defineProps<{ actions: SyncAction[] }>();
</script>
<template>
  <span class="sync-actions">
    <el-button v-for="action in actions" :key="action.id" size="small" :type="action.primary ? 'primary' : undefined" :disabled="action.disabled" @click="action.run">{{ action.label }}</el-button>
  </span>
</template>
<style scoped>
.sync-actions { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.sync-actions .el-button + .el-button { margin-left: 0; }
</style>
