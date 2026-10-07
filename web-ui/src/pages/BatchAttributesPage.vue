<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import { useCadBatchDirectory } from "../composables/useCadBatchDirectory";
import { useAppShell } from "../composables/useAppShell";
import { usePagePrimaryContribution } from "../composables/usePagePrimaryContribution";
import { cadBatchToolsSection } from "../composables/cadBatchTools";
import { useBatchAttributes } from "../composables/useBatchAttributes";
import BatchAttributePreviewTable from "../components/cad/BatchAttributePreviewTable.vue";
import { usePageSession } from "../composables/usePageSession";
import { filterBatchAttributeRows, hiddenBatchSelectionCount, type BatchAttributeFilter } from "../components/cad/batchAttributeFilter";
import { batchAttributePreviewRows } from "../components/cad/batchAttributePreviewRows";
import { bomNameSourceOptions, bomNameSourceHint, type BomNameSource } from "../utils/bomNameSource";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const sharedDirectory = useCadBatchDirectory(shell.workspacePath);
const directory = sharedDirectory.directory;
const overwrite = ref(false); const confirming = ref(false);
const nameSource = ref<BomNameSource>("label");
const includeDrawings = ref(false);
const batch = reactive(useBatchAttributes(shell.workspacePath, directory, overwrite, nameSource, includeDrawings));
const busy = computed(() => batch.busy || confirming.value);
sharedDirectory.bindBusy(busy);
usePageSession(props.workbenchTabId, {
  serialize: () => ({ nameSource: nameSource.value, overwrite: overwrite.value, includeDrawings: includeDrawings.value }),
  hydrate: snapshot => { nameSource.value = snapshot.nameSource === "filename" ? "filename" : "label"; overwrite.value = snapshot.overwrite === true; includeDrawings.value = snapshot.includeDrawings === true; return true; }, isDirty: () => false,
  isBusy: () => busy.value, refresh: () => { batch.reset(); },
});
const fieldCount = computed(() => batch.selections.reduce((sum, row) => sum + row.fields.length, 0));
const filenameSearch = ref("");
const statusFilter = ref<BatchAttributeFilter>("all");
const statusOptions = [{ value: "all", label: "全部" }, { value: "pending", label: "待写入" }, { value: "problem", label: "问题" }];
const previewRows = computed(() => batchAttributePreviewRows(batch.displayPreview));
const visibleRows = computed(() => filterBatchAttributeRows(previewRows.value, filenameSearch.value, statusFilter.value, {
  completed: batch.completed, writing: batch.writing, writingFiles: batch.writingFiles, submittedSelection: batch.submittedSelection, results: batch.result?.results,
}));
const hiddenSelectedCount = computed(() => hiddenBatchSelectionCount(visibleRows.value, batch.selections));
const visibleResults = computed(() => {
  const visible = new Set(visibleRows.value.map(row => row.rel));
  return batch.result?.results.filter(row => visible.has(row.rel)) ?? [];
});
function selectVisible() {
  if (busy.value || batch.completed) return;
  for (const row of visibleRows.value) {
    if (!row.diagnosticMessages?.length) batch.selectFile(row.rel, true);
  }
}
function clearFilters() { filenameSearch.value = ""; statusFilter.value = "all"; }
async function analyze() {
  if (busy.value || !await sharedDirectory.validate()) return;
  await batch.analyze();
}
async function apply() {
  if (!batch.canApply || confirming.value || sharedDirectory.disabled.value) return;
  const plan = batch.preview!;
  confirming.value = true;
  try {
    const hiddenNotice = hiddenSelectedCount.value ? `其中 ${hiddenSelectedCount.value} 个已勾选文件被当前筛选隐藏，仍会写入。` : "";
    const answer = await pnwPromptChoice({ title: "批量写入 FreeCAD 属性", defaultChoiceId: "cancel", message: `将向 ${batch.selections.length} 个文件写入 ${fieldCount.value} 个字段。${hiddenNotice}范围：${plan.batch_dir}。${plan.overwrite ? "已开启覆盖已有值，请核对预览。" : "只补空值/缺失属性。"}不会改 Label、文件名或 XLink。请先关闭 FreeCAD 中相关文件并备份；各文件独立执行，部分失败会单独报告。`, choices: [{ id: "write", label: "确认写入", variant: "primary" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId !== "write") return;
    await batch.apply(plan.plan_id);
    if (batch.result) shell.appendLog(`[批量属性] ${batch.result.results.filter(row => row.status === 'written').length}/${batch.result.results.length} 个文件写入成功`, { source: "batch_attributes", open: true });
  } finally { confirming.value = false; }
}
async function writeFile(rel: string) {
  if (busy.value || !batch.preview || !batch.rowFields(rel).length || sharedDirectory.disabled.value) return;
  const plan = batch.preview;
  const changes = batch.displayPreview!.rows.find(item => item.rel === rel)!.changes.filter(change => change.eligible);
  confirming.value = true;
  try {
    const answer = await pnwPromptChoice({ title: "写入当前文件属性", defaultChoiceId: "cancel", message: `${rel}\n将只写入本行 ${changes.length} 个可写字段；不改 Label、文件名或引用。${plan.overwrite ? "覆盖已有值已开启。" : "只补空值/缺失属性。"}\n${changes.map(change => `${change.field}：${change.proposed}`).join("\n")}\n请先关闭 FreeCAD 中该文件并备份。`, choices: [{ id: "write", label: "确认写入", variant: "primary" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId === "write") await batch.applyOne(plan.plan_id, rel);
  } finally { confirming.value = false; }
}
usePagePrimaryContribution("batch_attributes", props.workbenchTabId, {
  title: "批量工具",
  summary: computed(() => batch.error || (batch.completed ? "本次执行已结束，逐文件状态见表格；再次操作请重新预览" : batch.preview ? `预览 ${batch.preview.scanned} 个文件，已选 ${batch.selections.length} 个 / ${fieldCount.value} 字段` : "点击预览后勾选文件，再确认写入可写字段")),
  sections: [cadBatchToolsSection(shell, "batch_attributes"), sharedDirectory.section, { id: "scope", title: "写入选项", controls: [
    { id: "name-source", kind: "choice", label: "名称补全来源", description: `${bomNameSourceHint} 改变后需重新预览。`, modelValue: nameSource, options: bomNameSourceOptions, disabled: busy, onUpdate: value => { nameSource.value = value as BomNameSource; } },
    { id: "include-drawings", kind: "boolean", label: "包含图纸", modelValue: includeDrawings, disabled: busy, description: "默认跳过图纸；开启后仅显示原因，不写图纸属性。更改后重新预览。", onUpdate: value => { includeDrawings.value = value; } },
    { id: "overwrite", kind: "boolean", label: "允许覆盖已有值", modelValue: overwrite, disabled: busy, tone: "warning", description: "默认关闭；改变后必须重新预览", onUpdate: value => { overwrite.value = value; } },
  ], actions: [
    { id: "preview", label: "预览", tone: "primary", disabled: sharedDirectory.disabled, run: analyze },
    { id: "write", label: "写入勾选项", disabled: computed(() => !batch.canApply || busy.value), run: apply },
  ] }, { id: "batch-help", title: "使用说明", description: "只处理搜索目录及子目录，不沿引用扩展。\n向根 Body/Part 的 CustomDefine 写入五项属性，不改 Label、文件名或 XLink。\n已有 PartName 优先；缺失时按标签名（默认）或文件名补全。\n目标零件名可手工编辑，本机草稿刷新后保留；恢复后需重新预览校验磁盘。\n每行可单独写入，也可勾选后批量写入；始终先确认。\n黄色表示待写差异，绿色表示一致；需确认项不会写入。\n默认只补空值；覆盖已有值须开启选项。歧义对象、图纸或类型不符请到文件详情确认。\n请先关闭相关 FreeCAD 文件并备份。" }],
});
</script>

<template>
  <PageLayout title="批量属性写入" class="desk-page-layout batch-attributes-page">
    <template #header>
    <PageHeader title="批量属性写入">
      <template #center>
        <div class="batch-result-filters" role="search" aria-label="筛选已预览结果">
          <el-input v-model="filenameSearch" class="filename-search" size="small" clearable placeholder="搜索结果中的文件名 / 路径…" aria-label="搜索结果中的文件名或路径" />
          <el-radio-group v-model="statusFilter" class="status-filter" size="small" aria-label="结果状态" title="待写入：有可写字段；问题：需确认、失败，含部分字段冲突和读取异常">
            <el-radio-button v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <template #right>
        <el-button size="small" :loading="batch.busy" :disabled="sharedDirectory.disabled.value" @click="analyze">预览</el-button>
        <el-button size="small" type="primary" :disabled="!batch.canApply || busy" @click="apply">写入勾选项</el-button>
      </template>
    </PageHeader>
    </template>
    <div class="preview-actions">
      <el-radio-group v-model="nameSource" size="small" aria-label="名称补全来源" :disabled="busy" :title="bomNameSourceHint">
        <el-radio-button v-for="option in bomNameSourceOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
      </el-radio-group>
      <small class="muted">已有 PartName 优先</small>
      <el-checkbox v-model="includeDrawings" size="small" :disabled="busy" title="默认跳过图纸；开启后只显示，不写入 BOM 属性。更改后重新预览。">包含图纸</el-checkbox>
      <template v-if="batch.displayPreview">
        <span>扫描 {{ batch.displayPreview.scanned }} · 显示 {{ visibleRows.length }} / {{ previewRows.length }} · 已选 {{ batch.selections.length }} 个 / {{ fieldCount }} 项</span>
        <el-button size="small" :disabled="busy || batch.completed || batch.restored || !visibleRows.length" @click="selectVisible">勾选当前可写项</el-button>
        <el-button size="small" :disabled="busy || batch.completed || batch.restored" @click="batch.selectAll(false)">取消勾选</el-button>
      </template>
      <small v-else class="muted">预览后可编辑零件名，单行或勾选写入。</small>
    </div>
    <el-alert v-if="batch.error" :title="batch.error" type="error" :closable="false" />
    <el-alert v-if="batch.cacheWarning" :title="batch.cacheWarning" type="warning" :closable="false" />
    <p v-if="batch.restored" class="restore-notice">已恢复本机草稿；请点击「预览」核对磁盘后再写入。</p>
    <section v-if="batch.displayPreview" aria-label="属性写入预览">
      <p v-if="hiddenSelectedCount" class="hidden-selection-notice" role="status">当前筛选隐藏了 {{ hiddenSelectedCount }} 个已勾选文件，执行时仍会写入。<el-button link size="small" @click="clearFilters">显示全部核对</el-button></p>
      <p v-if="!previewRows.length">没有可预览的模型，请检查搜索目录。</p>
      <p v-else-if="!visibleRows.length" class="filter-empty" role="status">当前筛选无匹配文件。<el-button link size="small" @click="clearFilters">清除筛选</el-button></p>
      <p v-if="batch.completed">表格保留本次写入前的预览值，状态以后台结果为准。本次计划不可重用，请重新预览核对最新值。</p>
      <BatchAttributePreviewTable v-if="previewRows.length" :rows="visibleRows" :selection="batch.selection" :busy="busy"
        :completed="batch.completed" :writing="batch.writing" :writing-files="batch.writingFiles" :submitted-selection="batch.submittedSelection" :results="batch.result?.results"
        :requires-preview="batch.restored" @edit-name="batch.setName" @write-file="writeFile"
        @select-file="batch.selectFile" @open-file="shell.openFileDetailForRel($event, { subTab: 'edit' })" />
    </section>
    <p v-else-if="!batch.result" class="empty">选择搜索目录后点击「预览」。进入页面不会扫描或写入文件。</p>
    <section v-if="batch.result" aria-label="批量属性写入结果" role="status">
      <h2>写入结果</h2>
      <ul><li v-for="row in visibleResults" :key="row.rel">{{ row.status === 'written' ? '成功' : '失败' }} · {{ row.rel }}：{{ row.message }}</li></ul>
      <p v-if="batch.completed">本次计划已使用；再次操作前请重新预览。</p>
    </section>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";
p { color: var(--muted); line-height: 1.6; }
.batch-result-filters { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.filename-search { flex: 1 1 200px; min-width: 100px; }
.status-filter { flex: 0 0 auto; flex-wrap: nowrap; }
.hidden-selection-notice { padding: 6px 10px; border-left: 2px solid var(--phoenix-warning-border); background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); }
.preview-actions { display: flex; align-items: center; gap: 8px; margin-block: 8px; white-space: nowrap; }
.preview-actions .el-radio-group { flex-shrink: 0; }
.restore-notice { margin-block: 6px; color: var(--phoenix-warning-text); }
</style>
