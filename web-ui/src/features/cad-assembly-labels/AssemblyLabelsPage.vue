<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useCadBatchDirectory } from "../../composables/useCadBatchDirectory";
import { usePagePrimaryContribution, type PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import { usePageSession } from "../../composables/usePageSession";
import { cadBatchToolsSection } from "../../composables/cadBatchTools";
import { useAssemblyLabels } from "./useAssemblyLabels";
import { labelRowState } from "./resultViewModel";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell(), shared = useCadBatchDirectory(shell.workspacePath);
const batch = reactive(useAssemblyLabels(shell.workspacePath, shared.directory));
const confirming = ref(false), query = ref(""), filter = ref("all");
const busy = computed(() => batch.busy || confirming.value);
shared.bindBusy(busy);
usePageSession(props.workbenchTabId, { serialize: () => ({}), hydrate: () => false, isDirty: () => false, isBusy: () => busy.value, refresh: () => { batch.reset(); } });
const rows = computed(() => (batch.preview?.rows || []).map(row => ({ row, state: labelRowState(row, batch.job, batch.submitted, batch.consumed) })));
const visible = computed(() => rows.value.filter(({ row, state }) => row.rel.toLowerCase().includes(query.value.trim().toLowerCase()) && (filter.value === "all" || filter.value === state.group)));
const hiddenSelected = computed(() => batch.selected.filter(rel => !visible.value.some(({ row }) => row.rel === rel)).length);
const labelCount = computed(() => rows.value.filter(({ row }) => batch.selected.includes(row.rel)).reduce((sum, { row }) => sum + row.pending, 0));
async function preview() { if (!busy.value && await shared.validate()) await batch.analyze(); }
function selectVisible() { for (const { row } of visible.value) batch.select(row.rel, true); }
function openDetail(rel: string) { shell.openFileDetailForRel(rel, { subTab: "assembly" }); }
async function apply() {
  if (!batch.canApply || busy.value || shared.disabled.value) return;
  const plan = batch.preview!; confirming.value = true;
  try {
    const answer = await pnwPromptChoice({ title: "确认总成链接标签修正", defaultChoiceId: "cancel",
      message: `范围：${plan.batch_dir}。将处理 ${batch.selected.length} 个总成、${labelCount.value} 个标签。${hiddenSelected.value ? `其中 ${hiddenSelected.value} 个已勾选总成被筛选隐藏。` : ""}只修改选中总成的引用实例 Label，不改文件名、引用路径、几何或源文件。请先关闭相关 FreeCAD 文档。写前自动备份，文件或引用目标变化会拒绝该项；各文件独立处理。结束后仅集中刷新已修改总成的引用索引，不全量扫描。`,
      choices: [{ id: "apply", label: "确认应用", variant: "primary" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId === "apply") await batch.apply(plan.plan_id);
  } finally { confirming.value = false; }
}
usePagePrimaryContribution("assembly_labels", props.workbenchTabId, {
  title: "批量工具", summary: computed(() => batch.error || batch.job?.message || "一行一个 ASSY，先预览后勾选应用"),
  sections: [cadBatchToolsSection(shell, "assembly_labels"), shared.section, {
    id: "assembly-label-actions", title: "引用标签修正",
    progress: computed<PagePrimaryProgress>(() => ({ label: "总成链接标签", state: batch.job?.state === "attention" ? "warning" : batch.job?.state || (batch.requesting ? "running" : "idle"),
      ...(batch.requesting && !batch.job ? {} : { completed: batch.job?.completed || 0, total: batch.job?.total || batch.selected.length }),
      detail: batch.job?.current_rel || batch.job?.message || (batch.requesting ? "正在读取总成与推荐标签" : "先预览，不自动勾选") })),
    actions: [{ id: "preview", label: "预览标签", disabled: shared.disabled, run: preview },
      { id: "apply", label: "应用勾选", tone: "primary", disabled: computed(() => !batch.canApply || busy.value || shared.disabled.value), run: apply }],
  }, { id: "assembly-label-help", title: "使用说明", description: "仅列出搜索目录中的 .ASSY.FCStd。\n复用文件详情推荐，同级重复件从 .001 编号。\n一行一个总成，点文件名查看具体标签。\n只改所选总成标签，不改引用路径或源文件。\n结束后集中刷新这些总成的引用索引，无需全量扫描。\n备份：.phoenix/reference-label-backups。" }],
});
</script>
<template>
  <PageLayout title="总成链接标签修正" class="desk-page-layout">
    <template #header><PageHeader title="总成标签" layout="right">
      <template #center><div class="filters"><el-input v-model="query" size="small" clearable placeholder="搜索文件名 / 路径…" aria-label="搜索总成文件" /><el-radio-group v-model="filter" size="small"><el-radio-button value="all">全部</el-radio-button><el-radio-button value="pending">待修正</el-radio-button><el-radio-button value="problem">问题</el-radio-button></el-radio-group></div></template>
      <template #right><el-button size="small" :disabled="busy || shared.disabled.value" @click="preview">预览标签</el-button><el-button size="small" type="primary" :disabled="!batch.canApply || busy || shared.disabled.value" @click="apply">应用勾选</el-button></template>
    </PageHeader></template>
    <p v-if="batch.error" class="notice error" role="alert">{{ batch.error }}</p>
    <p v-if="batch.job" class="notice" role="status">{{ batch.job.message }}</p>
    <p v-if="!batch.preview">点击「预览标签」读取总成；打开页面不会扫描或写入。</p>
    <template v-else>
      <div class="summary"><span>扫描 {{ batch.preview.scanned }} 个文件 · 显示 {{ visible.length }} / {{ rows.length }} 个总成 · 已选 {{ batch.selected.length }} 个 / {{ labelCount }} 个标签</span><el-button size="small" :disabled="busy || batch.consumed" @click="selectVisible">勾选当前可修正项</el-button><el-button size="small" :disabled="busy" @click="batch.clearSelection">取消全部勾选</el-button></div>
      <p v-if="hiddenSelected" class="notice">有 {{ hiddenSelected }} 个已勾选总成被筛选隐藏，应用时仍会处理。<el-button link size="small" @click="query = ''; filter = 'all'">显示全部</el-button></p>
      <table class="preview-table"><thead><tr><th>选择</th><th>总成文件</th><th>引用实例</th><th>待修正</th><th>状态 / 结果</th></tr></thead><tbody>
        <tr v-if="!visible.length"><td colspan="5" class="empty">{{ rows.length ? '当前筛选无匹配总成' : '当前目录没有 ASSY 文件' }}</td></tr>
        <tr v-for="{ row, state } in visible" :key="row.rel"><td><input type="checkbox" :aria-label="`选择 ${row.rel}`" :checked="batch.selected.includes(row.rel)" :disabled="busy || batch.consumed || !row.eligible" @change="batch.select(row.rel, ($event.target as HTMLInputElement).checked)" /></td>
          <td><a :href="`?page=file_detail&rel=${encodeURIComponent(row.rel)}`" @click.exact.prevent="openDetail(row.rel)">{{ row.rel }}</a></td><td>{{ row.total }}</td><td :class="{ warning: row.pending > 0 }">{{ row.pending }}<small v-if="batch.consumed">预览值</small></td>
          <td><span class="status" :data-tone="state.tone">{{ state.label }}</span><small>{{ state.detail }}</small><small v-if="batch.job?.results.find(result => result.rel === row.rel)?.backup">备份：{{ batch.job.results.find(result => result.rel === row.rel)?.backup }}</small></td>
        </tr>
      </tbody></table>
      <details v-if="batch.preview.errors.length"><summary>目录扫描提示（{{ batch.preview.errors.length }}）</summary><p v-for="item in batch.preview.errors" :key="item.rel">{{ item.rel }}：{{ item.message }}</p></details>
    </template>
  </PageLayout>
</template>
<style scoped>
.filters, .summary { display: flex; align-items: center; gap: 8px; min-width: 0; }
.filters { width: 100%; gap: 4px; } .filters .el-input { flex: 1; min-width: 80px; } .filters .el-radio-group { flex-shrink: 0; }
.summary { flex-wrap: wrap; margin-block: 12px; font-size: .82rem; }
.preview-table { width: 100%; border-collapse: collapse; font-size: .84rem; }
th, td { border: 1px solid var(--border); padding: 8px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: var(--panel-head-bg); white-space: nowrap; }
th:first-child { width: 38px; } th:nth-child(3), th:nth-child(4) { width: 64px; }
a { color: var(--phoenix-accent); text-decoration: underline; } small { display: block; color: var(--muted); margin-top: 4px; }
.notice { padding: 8px; background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); } .error { background: var(--phoenix-danger-bg); color: var(--phoenix-danger-text); }
.warning { color: var(--phoenix-warning-text); } .status { font-size: .75rem; border: 1px solid currentColor; border-radius: 3px; padding: 1px 4px; }
.status[data-tone='success'] { color: var(--phoenix-success-text); background: var(--phoenix-success-bg); }
.status[data-tone='warning'] { color: var(--phoenix-warning-text); background: var(--phoenix-warning-bg); }
.status[data-tone='danger'] { color: var(--phoenix-danger-text); background: var(--phoenix-danger-bg); }
.status[data-tone='primary'] { color: var(--phoenix-accent); background: var(--phoenix-accent-soft); }
.empty { padding: 24px; text-align: center; color: var(--muted); }
</style>
