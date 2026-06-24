<script setup lang="ts">
import type { CaaDialogIr } from "../../types/caaDialogIr";
import CaaDialogNodeView from "./CaaDialogNodeView.vue";

defineProps<{
  ir: CaaDialogIr | null;
  selectedId?: string | null;
}>();
</script>

<template>
  <div class="caa-editor-main">
    <div class="caa-canvas-wrap">
      <div v-if="!ir" class="caa-canvas-empty muted">加载对话框后在此预览</div>
      <CaaDialogNodeView v-else :node="ir.root" />
    </div>
  </div>
</template>

<style scoped>
.caa-editor-main {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-width: 0;
  gap: 10px;
}

.caa-canvas-wrap {
  flex: 0 0 auto;
  min-width: 0;
  padding: 12px;
  background: #e8ecf1;
  border-radius: 6px;
  border: 1px solid var(--border, #e2e8f0);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

.caa-canvas-empty {
  padding: 24px;
  text-align: center;
}
</style>
