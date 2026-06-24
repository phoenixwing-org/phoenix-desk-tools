<script setup lang="ts">
import { inject, computed } from "vue";
import { CAA_CONTROL_KEY } from "../../composables/useCaaControlContext";

const ctx = inject(CAA_CONTROL_KEY, null);

const style = computed(() => {
  const ind = ctx?.dropIndicator.value;
  if (!ind?.rect) return { display: "none" };
  return {
    position: "fixed" as const,
    left: `${ind.rect.left - 1}px`,
    top: `${ind.rect.top - 1}px`,
    width: `${ind.rect.width + 2}px`,
    height: `${ind.rect.height + 2}px`,
    pointerEvents: "none" as const,
    zIndex: 99999,
  };
});
</script>

<template>
  <div v-if="ctx" class="caa-drop-overlay" :style="style">
    <!-- inside → 半透明蓝底 -->
    <div v-if="ctx.dropIndicator.value.rect && ctx.dropIndicator.value.edge === 'inside'" class="caa-drop-overlay--inside" />
    <!-- right → 右侧细竖条 3px -->
    <div v-else-if="ctx.dropIndicator.value.rect && ctx.dropIndicator.value.edge === 'right'" class="caa-drop-overlay--vbar caa-drop-overlay--vbar-right" />
    <!-- left → 左侧细竖条 3px -->
    <div v-else-if="ctx.dropIndicator.value.rect && ctx.dropIndicator.value.edge === 'left'" class="caa-drop-overlay--vbar caa-drop-overlay--vbar-left" />
    <!-- bottom → 底部细横条 3px -->
    <div v-else-if="ctx.dropIndicator.value.rect && ctx.dropIndicator.value.edge === 'bottom'" class="caa-drop-overlay--hbar caa-drop-overlay--hbar-bottom" />
    <!-- top → 顶部细横条 3px -->
    <div v-else-if="ctx.dropIndicator.value.rect && ctx.dropIndicator.value.edge === 'top'" class="caa-drop-overlay--hbar caa-drop-overlay--hbar-top" />
  </div>
</template>

<style scoped>
.caa-drop-overlay {
  transition: all 0.06s ease;
}

.caa-drop-overlay--inside {
  width: 100%;
  height: 100%;
  background: rgba(59, 130, 246, 0.12);
  border: 2px solid #3b82f6;
  border-radius: 3px;
  box-sizing: border-box;
}

.caa-drop-overlay--vbar {
  position: absolute;
  top: 1px;
  width: 3px;
  height: calc(100% - 2px);
  background: #3b82f6;
  border-radius: 2px;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}

.caa-drop-overlay--vbar-right { right: 1px; }
.caa-drop-overlay--vbar-left { left: 1px; }

.caa-drop-overlay--hbar {
  position: absolute;
  left: 1px;
  width: calc(100% - 2px);
  height: 3px;
  background: #3b82f6;
  border-radius: 2px;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}

.caa-drop-overlay--hbar-bottom { bottom: 1px; }
.caa-drop-overlay--hbar-top { top: 1px; }
</style>
