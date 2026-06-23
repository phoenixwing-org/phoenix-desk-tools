<script setup lang="ts">
import { computed } from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import type { GitFileDiff } from "../../types/gitWorkspace";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  path: string;
  diff: GitFileDiff | null;
}>();

defineEmits<{ close: [] }>();

const diffHtml = computed(() => {
  const text = props.diff?.unified_diff?.trim();
  if (!text) return "";
  try {
    return renderDiffHtml(text, {
      drawFileList: false,
      matching: "lines",
      outputFormat: "side-by-side",
    });
  } catch {
    return "";
  }
});

const showHtml = computed(
  () => props.diff?.has_diff && !props.diff?.is_binary && Boolean(diffHtml.value),
);
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="path ? `Git diff · ${path}` : 'Git diff'"
    width="92%"
    top="4vh"
    class="git-diff-dialog"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && $emit('close')"
  >
    <div v-loading="loading" class="diff-body">
      <el-alert
        v-if="diff?.is_binary"
        type="warning"
        :closable="false"
        :title="diff.message || '二进制文件有变更，无法在 Web 中预览 diff'"
        show-icon
      />
      <el-alert
        v-else-if="diff && !diff.has_diff"
        type="info"
        :closable="false"
        :title="diff.message || '与 Git 无差异'"
        show-icon
      />
      <el-alert
        v-else-if="diff?.truncated"
        type="warning"
        :closable="false"
        title="diff 已截断，仅显示前 512KB"
        show-icon
        class="trunc-warn"
      />
      <div v-if="showHtml" class="d2h-host" v-html="diffHtml" />
      <el-empty v-else-if="!loading && diff?.has_diff && !diff?.is_binary" description="无法渲染 diff" />
    </div>
    <template #footer>
      <el-button @click="$emit('close')">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.diff-body {
  min-height: 120px;
  max-height: min(72vh, 900px);
  overflow: auto;
}
.trunc-warn {
  margin-bottom: 8px;
}
.d2h-host {
  max-width: 100%;
}
.d2h-host :deep(.d2h-wrapper) {
  font-size: 12px;
}
</style>

<style>
/* diff2html 在 dialog 内滚动：行号勿 absolute，否则最后一行会「溢出」到表格外 */
.git-diff-dialog .el-dialog__body {
  padding-top: 8px;
}

.git-diff-dialog .d2h-host {
  overflow-x: auto;
}

.git-diff-dialog .d2h-diff-table {
  position: relative;
}

.git-diff-dialog .d2h-code-side-linenumber,
.git-diff-dialog .d2h-code-linenumber {
  position: relative !important;
  display: table-cell !important;
  vertical-align: top;
  box-sizing: border-box;
}

.git-diff-dialog .d2h-code-side-line,
.git-diff-dialog .d2h-code-line {
  vertical-align: top;
}

.git-diff-dialog .d2h-code-side-linenumber::after,
.git-diff-dialog .d2h-code-linenumber::after {
  content: none;
}
</style>
