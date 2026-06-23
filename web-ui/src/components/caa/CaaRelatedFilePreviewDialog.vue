<script setup lang="ts">
import { computed } from "vue";
import { caaImageDataUrl } from "../../utils/caaRelatedFilePreview";
import type { CaaFilePreviewPayload } from "../../utils/caaRelatedFilePreview";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  path: string;
  kindLabel: string;
  preview: CaaFilePreviewPayload | null;
  errorText: string;
}>();

defineEmits<{ close: [] }>();

const title = computed(() => {
  const name = props.path.split("/").pop() ?? props.path;
  const tag = props.kindLabel ? ` · ${props.kindLabel}` : "";
  return props.path ? `${name}${tag}` : "关联文件预览";
});

const imageSrc = computed(() => {
  if (!props.preview || props.preview.kind !== "image") return "";
  return caaImageDataUrl(props.preview.mime, props.preview.base64);
});

const sizeNote = computed(() => {
  const bytes = props.preview?.sizeBytes;
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
});
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="min(92vw, 880px)"
    top="6vh"
    class="caa-file-preview-dialog"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && $emit('close')"
  >
    <p v-if="path" class="caa-file-preview-path mono muted small">{{ path }}</p>
    <div v-loading="loading" class="caa-file-preview-body">
      <el-alert
        v-if="errorText"
        type="error"
        :closable="false"
        :title="errorText"
        show-icon
      />
      <template v-else-if="preview">
        <p v-if="sizeNote" class="caa-file-preview-meta muted small">大小 {{ sizeNote }}</p>
        <div v-if="preview.kind === 'image'" class="caa-file-preview-image-wrap">
          <el-image
            :src="imageSrc"
            :preview-src-list="[imageSrc]"
            fit="contain"
            class="caa-file-preview-image"
          />
        </div>
        <pre v-else class="caa-file-preview-text mono">{{ preview.text }}</pre>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.caa-file-preview-path {
  margin: 0 0 8px;
  word-break: break-all;
}

.caa-file-preview-body {
  min-height: 120px;
}

.caa-file-preview-meta {
  margin: 0 0 8px;
}

.caa-file-preview-text {
  margin: 0;
  max-height: min(65vh, 560px);
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: #f8fafc;
  font-size: 0.78rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.caa-file-preview-image-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 120px;
  max-height: min(65vh, 560px);
  padding: 8px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 50% / 16px 16px;
}

.caa-file-preview-image {
  max-width: 100%;
  max-height: min(60vh, 520px);
}
</style>
