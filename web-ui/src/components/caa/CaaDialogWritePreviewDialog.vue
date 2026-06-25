<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogWriteResult } from "../../api/caaDialog";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  catDlgRel: string;
  preview: CaaDialogWriteResult | null;
}>();

defineEmits<{
  close: [];
  confirm: [];
}>();

const catDlgBefore = computed(() => props.preview?.preview?.catDlg?.before ?? "");
const catDlgAfter = computed(() => props.preview?.preview?.catDlg?.after ?? "");
const catDlgChanged = computed(() => Boolean(props.preview?.changed?.catDlg));
const headerBefore = computed(() => props.preview?.preview?.header?.before ?? "");
const headerAfter = computed(() => props.preview?.preview?.header?.after ?? "");
const headerChanged = computed(() => Boolean(props.preview?.changed?.header));
const hasHeaderPreview = computed(() => Boolean(props.preview?.preview?.header));
const cppBefore = computed(() => props.preview?.preview?.cpp?.before ?? "");
const cppAfter = computed(() => props.preview?.preview?.cpp?.after ?? "");
const cppChanged = computed(() => Boolean(props.preview?.changed?.cpp));
const hasCppPreview = computed(() => Boolean(props.preview?.preview?.cpp));
const validationWarnings = computed(() => props.preview?.validation?.warnings ?? []);
const hasAnyChange = computed(() => catDlgChanged.value || headerChanged.value || cppChanged.value);
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="catDlgRel ? `写回预览 · ${catDlgRel}` : '写回预览'"
    width="92%"
    top="4vh"
    class="caa-write-preview-dialog"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && $emit('close')"
  >
    <div v-loading="loading" class="caa-write-preview-body">
      <el-alert
        v-if="preview && !hasAnyChange"
        type="info"
        :closable="false"
        title=".CATDlg / Wizard .h/.cpp 与当前 IR 生成结果一致，没有可写回差异"
        show-icon
      />
      <el-alert
        v-if="validationWarnings.length"
        type="warning"
        :closable="false"
        show-icon
        class="caa-write-preview-warning"
      >
        <template #title>
          写回校验警告：{{ validationWarnings.length }} 条
        </template>
        <ul class="caa-write-preview-warnings">
          <li v-for="w in validationWarnings" :key="w">{{ w }}</li>
        </ul>
      </el-alert>

      <div v-if="preview" class="caa-write-preview-grid">
        <section class="caa-write-preview-pane">
          <header>当前磁盘 .CATDlg</header>
          <pre>{{ catDlgBefore }}</pre>
        </section>
        <section class="caa-write-preview-pane">
          <header>IR 生成后的 .CATDlg</header>
          <pre>{{ catDlgAfter }}</pre>
        </section>
      </div>

      <div v-if="hasHeaderPreview" class="caa-write-preview-grid">
        <section class="caa-write-preview-pane">
          <header>当前磁盘 Wizard .h</header>
          <pre>{{ headerBefore }}</pre>
        </section>
        <section class="caa-write-preview-pane">
          <header>IR 生成后的 Wizard .h</header>
          <pre>{{ headerAfter }}</pre>
        </section>
      </div>

      <div v-if="hasCppPreview" class="caa-write-preview-grid">
        <section class="caa-write-preview-pane">
          <header>当前磁盘 Wizard .cpp</header>
          <pre>{{ cppBefore }}</pre>
        </section>
        <section class="caa-write-preview-pane">
          <header>IR 生成后的 Wizard .cpp</header>
          <pre>{{ cppAfter }}</pre>
        </section>
      </div>
    </div>
    <template #footer>
      <el-button @click="$emit('close')">关闭</el-button>
      <el-button
        type="success"
        :disabled="loading || !preview || !hasAnyChange"
        @click="$emit('confirm')"
      >
        确认写回
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.caa-write-preview-body {
  min-height: 160px;
  max-height: min(72vh, 900px);
  overflow: auto;
}

.caa-write-preview-warning {
  margin-top: 8px;
}

.caa-write-preview-warnings {
  margin: 6px 0 0;
  padding-left: 18px;
}

.caa-write-preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  height: min(42vh, 520px);
  margin-top: 10px;
  min-height: 260px;
}

.caa-write-preview-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-bg-color);
}

.caa-write-preview-pane header {
  flex: none;
  padding: 7px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
}

.caa-write-preview-pane pre {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
}

@media (max-width: 900px) {
  .caa-write-preview-grid {
    grid-template-columns: 1fr;
    height: min(68vh, 760px);
  }
}
</style>
