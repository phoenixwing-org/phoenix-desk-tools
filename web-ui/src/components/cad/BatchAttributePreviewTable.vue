<script setup lang="ts">
import { computed } from "vue";
import type { BatchAttributeResult, BatchBomField } from "../../api";
import { BOM_FIELD_LABELS } from "../../utils/bomFieldLabels";
import { batchAttributeRowStatus, batchAttributeStatusTone, isBatchAttributeUnchanged } from "./batchAttributeStatus";
import type { BatchAttributeDisplayRow } from "./batchAttributePreviewRows";

const props = defineProps<{
  rows: BatchAttributeDisplayRow[];
  selection: Record<string, string[]>;
  busy: boolean;
  completed?: boolean;
  writing?: boolean;
  writingFiles?: string[];
  submittedSelection?: Record<string, string[]>;
  results?: BatchAttributeResult["results"];
  requiresPreview?: boolean;
}>();
const emit = defineEmits<{
  selectFile: [rel: string, checked: boolean];
  openFile: [rel: string];
  editName: [rel: string, value: string];
  writeFile: [rel: string];
}>();
const fields: BatchBomField[] = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName"];
const resultByFile = computed(() => new Map(props.results?.map(result => [result.rel, result])));
const tableRows = computed(() => props.rows.map(row => ({
  ...row,
  locked: !!props.submittedSelection?.[row.rel]?.length,
  eligibleCount: row.diagnosticMessages?.length || row.name_draft_invalid ? 0 : row.changes.filter(change => change.eligible).length,
  status: row.diagnosticMessages?.length
    ? { kind: "needs_review" as const, label: "需确认", detail: row.diagnosticMessages.join("；") }
    : batchAttributeRowStatus(row, { completed: props.completed, writing: props.writing && (!props.writingFiles || props.writingFiles.includes(row.rel)), submitted: props.submittedSelection?.[row.rel], result: resultByFile.value.get(row.rel) }),
  cells: fields.map(field => row.changes.find(change => change.field === field)),
})));
</script>

<template>
  <!-- No nested overflow container: PnwPageLayout owns BOTH scroll axes. -->
  <div class="attribute-preview-region" tabindex="0" role="region" aria-label="属性写入预览表，可横向滚动">
    <table class="attribute-preview-table">
      <thead><tr>
        <th scope="col" class="selection-column">选择</th>
        <th scope="col" class="file-column">文件 / 根对象</th>
        <th v-for="field in fields" :key="field" scope="col">{{ BOM_FIELD_LABELS[field] }}</th>
        <th scope="col">状态</th>
      </tr></thead>
      <tbody>
      <tr v-if="!tableRows.length"><td :colspan="fields.length + 3" class="empty-row">当前筛选无匹配文件</td></tr>
      <tr v-for="row in tableRows" :key="row.rel">
        <td class="selection-column"><input
          type="checkbox"
          :aria-label="`选择文件 ${row.rel}`"
          :checked="!!(completed ? submittedSelection : selection)?.[row.rel]?.length"
          :disabled="busy || completed || requiresPreview || row.locked || !row.eligibleCount"
          @change="emit('selectFile', row.rel, ($event.target as HTMLInputElement).checked)"
        ></td>
        <th scope="row" class="file-column">
          <a v-if="/\.fcstd$/i.test(row.rel)" :href="`?page=file_detail&rel=${encodeURIComponent(row.rel)}`" :title="`编辑属性：${row.rel}`"
            @click.exact.prevent="emit('openFile', row.rel)">{{ row.rel }}</a>
          <span v-else>{{ row.rel }}</span>
          <small v-if="row.object_name">{{ row.object_name }}</small>
        </th>
        <td v-if="row.diagnosticMessages?.length" :colspan="fields.length" class="diagnostic-cell">
          <small v-for="message in row.diagnosticMessages" :key="message" class="field-note-warning">{{ message }}</small>
        </td>
        <template v-else><td v-for="(change, index) in row.cells" :key="fields[index]"
          :class="{ 'value-pending': !completed && !row.locked && change?.eligible && change.current !== change.proposed }"
          :title="change ? `${change.source} · ${change.note}` : '没有字段信息'">
          <template v-if="change">
            <template v-if="change.field === 'PartName' && row.name_editable && !completed && !row.locked">
              <div><span class="value-label">当前</span>{{ change.current || '（空）' }}</div>
              <label class="name-draft"><span class="value-label">目标</span><input type="text" :aria-label="`目标零件名 ${row.rel}`" :value="change.proposed" :disabled="busy" maxlength="255" @input="emit('editName', row.rel, ($event.target as HTMLInputElement).value)" /></label>
            </template>
            <template v-else-if="change.current !== change.proposed">
              <div><span class="value-label">当前</span>{{ change.current || '（空）' }}</div>
              <div><span class="value-label">目标</span>{{ change.proposed || '（空）' }}</div>
            </template>
            <template v-else>{{ change.current || '（空）' }}</template>
            <small v-if="!change.eligible && !isBatchAttributeUnchanged(change)" class="field-note-warning">{{ change.note }}</small>
          </template>
          <span v-else>—</span>
        </td></template>
        <td class="status-column" :data-status="row.status.kind" :title="row.status.detail">
          <el-tag class="status-tag" :data-tone="batchAttributeStatusTone[row.status.kind]"
            size="small" :type="batchAttributeStatusTone[row.status.kind]" effect="light">{{ row.status.label }}</el-tag>
          <el-button v-if="row.eligibleCount && !completed && !row.locked" class="row-write" size="small" :disabled="busy || requiresPreview" :aria-label="`写入文件 ${row.rel}`" @click="emit('writeFile', row.rel)">写入</el-button>
          <small v-if="row.status.kind === 'failed' || row.status.kind === 'unknown'">{{ row.status.detail }}</small>
        </td>
      </tr></tbody>
    </table>
  </div>
</template>

<style scoped>
.attribute-preview-region:focus-visible { outline: 2px solid var(--phoenix-focus-ring); outline-offset: -2px; }
.attribute-preview-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
th, td { padding: 8px; border: 1px solid var(--border); text-align: left; vertical-align: top; min-width: 70px; overflow-wrap: anywhere; }
thead th { background: var(--phoenix-bg-elevated); white-space: nowrap; }
.file-column { min-width: 200px; max-width: 320px; font-weight: 400; }
.file-column a { color: var(--el-color-primary); text-decoration: underline; text-underline-offset: 2px; }
.file-column a:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.selection-column { min-width: 36px; width: 36px; text-align: center; }
.status-column { min-width: 120px; max-width: 240px; }
.status-tag[data-tone="warning"] { --el-tag-bg-color: var(--phoenix-warning-bg); --el-tag-border-color: var(--phoenix-warning-border); --el-tag-text-color: var(--phoenix-warning-text); }
.status-tag[data-tone="success"] { --el-tag-bg-color: var(--phoenix-success-bg); --el-tag-border-color: var(--phoenix-success-border); --el-tag-text-color: var(--phoenix-success-text); }
.status-tag[data-tone="danger"] { --el-tag-bg-color: var(--phoenix-danger-bg); --el-tag-border-color: var(--phoenix-danger-border); --el-tag-text-color: var(--phoenix-danger-text); }
.status-tag[data-tone="primary"] { --el-tag-bg-color: var(--phoenix-accent-soft); --el-tag-border-color: var(--phoenix-accent-border); --el-tag-text-color: var(--phoenix-accent); }
.status-tag[data-tone="info"] { --el-tag-bg-color: var(--phoenix-bg-muted); --el-tag-border-color: var(--phoenix-border); --el-tag-text-color: var(--phoenix-text-muted); }
td:nth-last-child(2) { min-width: 170px; }
small { display: block; color: var(--muted); font-size: .75rem; margin-top: 4px; }
.value-pending { background: var(--phoenix-warning-bg); }
.field-note-warning { padding: 4px 6px; border-left: 2px solid var(--phoenix-warning-border); border-radius: 3px; background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); line-height: 1.5; }
.diagnostic-cell { vertical-align: middle; }
.diagnostic-cell .field-note-warning:first-child { margin-top: 0; }
.empty-row { padding: 24px 8px; color: var(--muted); text-align: center; }
.value-label { display: inline-block; margin-right: 6px; color: var(--muted); font-size: .75rem; white-space: nowrap; }
.name-draft { display: flex; align-items: center; margin-top: 3px; }
.name-draft input { width: 100%; min-width: 120px; box-sizing: border-box; padding: 3px 5px; border: 1px solid var(--border); border-radius: 4px; color: var(--phoenix-text); background: var(--phoenix-bg-elevated); font: inherit; }
.name-draft input:focus { outline: 2px solid var(--phoenix-focus-ring); }
.row-write { margin-left: 6px; }
input[type="checkbox"] { accent-color: var(--accent); }
</style>
