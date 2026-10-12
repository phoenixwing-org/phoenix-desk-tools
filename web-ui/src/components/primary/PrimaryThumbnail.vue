<script setup lang="ts">
import { ref, watch } from "vue";
import { isBlankThumbnail } from "./thumbnailPixels";
import type { ThumbnailGeneration } from "../../types/thumbnail";
const props = defineProps<{ image: { src: string; alt: string }; generation?: ThumbnailGeneration | null }>();
const failed = ref(false);
const blank = ref(false);
watch(() => props.image.src, () => { failed.value = false; blank.value = false; });
function loaded(event: Event) {
  const image = event.target as HTMLImageElement;
  try {
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    blank.value = isBlankThumbnail(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch { /* Preview remains useful when pixel inspection is unavailable. */ }
}
</script>
<template>
  <figure class="primary-thumbnail">
    <img v-if="image.src" v-show="!blank && !failed" :src="image.src" :alt="image.alt" @load="loaded" @error="failed = true" />
    <figcaption>{{ !image.src || failed || blank ? '无缩略图' : '文件缩略图' }}</figcaption>
    <div v-if="generation" class="thumbnail-generator">
      <label class="color-option">配色
        <select aria-label="缩略图配色" :value="generation.options.color" :disabled="generation.disabled" @change="generation.update({ color: ($event.target as HTMLSelectElement).value as 'original' | 'neutral' })">
          <option value="original">模型原色</option><option value="neutral">统一浅灰</option>
        </select>
      </label>
      <div class="view-options">
        <label><input type="checkbox" :checked="generation.options.axonometric" :disabled="generation.disabled" @change="generation.update({ axonometric: ($event.target as HTMLInputElement).checked })" />轴测图</label>
        <label title="自动缩放，让模型完整显示"><input type="checkbox" :checked="generation.options.fit" :disabled="generation.disabled" @change="generation.update({ fit: ($event.target as HTMLInputElement).checked })" />Fit</label>
      </div>
      <el-button size="small" :loading="generation.busy" :disabled="generation.disabled" @click="generation.run">重新生成缩略图</el-button>
      <small title="通过当前 FreeCAD MCP 本地 RPC 开启并持久化‘保存缩略图’，供后续普通保存使用">白色背景 · 备份并写入 FCStd 缩略图，不改模型</small>
      <p v-if="generation.message" :role="generation.error ? 'alert' : 'status'" :class="{ error: generation.error }">{{ generation.message }}</p>
    </div>
  </figure>
</template>
<style scoped>
.primary-thumbnail { margin: 8px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; text-align: center; background: var(--phoenix-bg-elevated); }
img { display: block; width: 100%; height: 144px; object-fit: contain; }
figcaption { margin-top: 4px; font-size: 11px; color: var(--muted); }
.thumbnail-generator { display: grid; gap: 6px; margin-top: 8px; text-align: left; font-size: 12px; }
.color-option { display: flex; align-items: center; gap: 8px; }
select { min-width: 0; flex: 1; color: var(--phoenix-text-primary); background: var(--phoenix-bg-elevated); border: 1px solid var(--border); border-radius: 4px; padding: 3px; }
.view-options { display: flex; gap: 14px; flex-wrap: wrap; }
.view-options label { display: inline-flex; gap: 3px; align-items: center; }
small { color: var(--muted); font-size: 11px; }
p { margin: 0; overflow-wrap: anywhere; font-size: 11px; }
.error { color: var(--el-color-danger); }
</style>
