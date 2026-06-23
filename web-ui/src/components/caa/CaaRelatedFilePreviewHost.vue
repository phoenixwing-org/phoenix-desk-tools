<script setup lang="ts">
import CaaRelatedFilePreviewDialog from "./CaaRelatedFilePreviewDialog.vue";
import { useCaaRelatedFilePreview } from "../../composables/useCaaRelatedFilePreview";

const { open, loading, path, kindLabel, preview, errorText, close } = useCaaRelatedFilePreview();
</script>

<template>
  <CaaRelatedFilePreviewDialog
    :open="open"
    :loading="loading"
    :path="path"
    :kind-label="kindLabel"
    :preview="preview"
    :error-text="errorText"
    @close="close"
  />
</template>
