<script setup lang="ts">
import GitDiffPreviewDialog from "./GitDiffPreviewDialog.vue";
import { useGitDiffPreview } from "../../composables/useGitDiffPreview";

const { open, loading, path, diff, close } = useGitDiffPreview();
</script>

<template>
  <GitDiffPreviewDialog
    :open="open"
    :loading="loading"
    :path="path"
    :diff="diff"
    @close="close"
  />
</template>
