<script setup lang="ts">
import { ref, watch } from "vue";
import { isBlankThumbnail } from "./thumbnailPixels";
const props = defineProps<{ image: { src: string; alt: string } }>();
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
  <figure class="primary-thumbnail" :title="!image.src || failed || blank ? '文件没有可用的已保存缩略图；请在 FreeCAD 中显示模型并重新保存缩略图' : 'FCStd 中已保存的缩略图（不会自动重新渲染）'">
    <img v-if="image.src" v-show="!blank && !failed" :src="image.src" :alt="image.alt" @load="loaded" @error="failed = true" />
    <figcaption>{{ !image.src || failed || blank ? '无缩略图' : '文件缩略图' }}</figcaption>
  </figure>
</template>
<style scoped>
.primary-thumbnail { margin: 8px; padding: 6px; border: 1px solid var(--border); border-radius: 6px; text-align: center; background: var(--phoenix-bg-elevated); }
img { display: block; width: 100%; height: 144px; object-fit: contain; }
figcaption { margin-top: 4px; font-size: 11px; color: var(--muted); }
</style>
