<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useCadBatchDirectory } from "../../composables/useCadBatchDirectory";
import { usePagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
import { cadBatchToolsSection } from "../../composables/cadBatchTools";
import { useNameNormalization } from "./useNameNormalization";
import { useNameNormalizationLog } from "./useNameNormalizationLog";
import { filterNameRows, nameDetailRel, namePreviewRows, nameRowState, renameRowState, type NameResultFilter } from "./resultViewModel";
import { useRenamePreferencesStore } from "../../stores/renamePreferences";
import { cadIndexProgress } from "../../models/cadIndexProgress";
import type { PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import { bomNameSourceOptions, bomNameSourceHint, type BomNameSource } from "../../utils/bomNameSource";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const shared = useCadBatchDirectory(shell.workspacePath);
const preferences = useRenamePreferencesStore();
const renameOptions = computed(() => ({ fixXref: preferences.fixXref, syncLabels: preferences.syncLabels, fixBasename: preferences.fixBasename }));
const nameSource = ref<BomNameSource>("label");
const mode = ref<"models" | "drawings">("models");
const showDrawings = ref(false);
const expanded = reactive({ preview: true, analysis: true, attributes: false, backups: false });
const batch = reactive(useNameNormalization(shell.workspacePath, shared.directory, renameOptions, nameSource, mode, workspace => {
  if (workspace === shell.workspacePath.value) shell.requestTreeRescan();
}));
useNameNormalizationLog(batch, shell.appendLog);
const confirming = ref(false);
const busy = computed(() => batch.busy || batch.indexing || confirming.value);
shared.bindBusy(busy);
const filenameSearch = ref("");
const statusFilter = ref<NameResultFilter>("all");
const statusOptions = [{ value: "all", label: "全部" }, { value: "normal", label: "正常" }, { value: "needs_fix", label: "需修正" }, { value: "needs_review", label: "需确认" }];
const previewRows = computed(() => namePreviewRows(batch.preview).filter(row => mode.value === "drawings" || showDrawings.value || (row.kind !== "drawing" && !/\.drawing\.fcstd$/i.test(row.rel))).map(row => ({ row, state: nameRowState(row, batch) })));
watch(showDrawings, value => { if (!value && mode.value === "models") for (const row of batch.preview?.rows || []) if (row.kind === "drawing") batch.select(row.rel, false); });
const canDirectRename = computed(() => batch.canAnalyze && !busy.value && (batch.attributeDone ? batch.attributes?.results.some(row => row.status !== "failed") : batch.selected.some(rel => batch.preview?.rows.some(row => row.rel === rel && row.rename_changed))));
const renameRows = computed(() => (batch.analysis?.rows ?? []).map(row => ({ row, state: renameRowState(row, batch) })));
const visibleRows = computed(() => filterNameRows(previewRows.value, filenameSearch.value, statusFilter.value));
const visibleRenameRows = computed(() => filterNameRows(renameRows.value, filenameSearch.value, statusFilter.value));
const hiddenSelected = computed(() => batch.selected.filter(rel => !visibleRows.value.some(item => item.row.rel === rel)).length);
const hiddenRenameSelected = computed(() => batch.renameSelected.filter(rel => !visibleRenameRows.value.some(item => item.row.rel === rel)).length);
function selectVisible(phase: "attributes" | "rename" = "attributes") {
  if (busy.value) return;
  for (const { row } of phase === "attributes" ? visibleRows.value : visibleRenameRows.value) batch.select(row.rel, true, phase);
}
function clearFilters() { filenameSearch.value = ""; statusFilter.value = "all"; }
function detailRel(rel: string) { return nameDetailRel(rel, batch.renamed); }
function openDetail(rel: string) { shell.openFileDetailForRel(detailRel(rel), { subTab: "edit" }); }
async function preview() { if (!busy.value && await shared.validate()) { expanded.preview = true; await batch.analyzePreview(); } }
async function directRename() {
  if (!canDirectRename.value) return;
  const selected = batch.attributeDone ? batch.attributes!.results.filter(row => row.status !== "failed").map(row => row.rel) : [...batch.selected];
  await batch.analyzeRename();
  expanded.analysis = true;
  if (!batch.analysis || batch.error) return;
  for (const rel of selected) batch.select(rel, true, "rename");
  const blocked = selected.filter(rel => !batch.analysis!.rows.some(row => row.rel === rel && row.eligible));
  if (blocked.length) shell.appendLog(`[名称统一] ${blocked.length} 个所选文件未通过改名检查：\n${blocked.map(rel => `${rel}：${batch.analysis!.rows.find(row => row.rel === rel)?.message || "不可改名"}`).join("\n")}`, { source: "name_normalize", open: true });
  if (batch.canRename) { expanded.preview = false; await confirmRename(); }
}
async function write() {
  if (!batch.canWrite || busy.value || shared.disabled.value) return;
  const plan = batch.preview!; const count = batch.selected.length; confirming.value = true;
  try {
    const hiddenNotice = hiddenSelected.value ? `其中 ${hiddenSelected.value} 个已勾选文件被筛选隐藏，仍会处理。` : "";
    const answer = await pnwPromptChoice({ title: "确认名称属性写入", defaultChoiceId: "cancel", message: `范围：${plan.batch_dir}。将处理已勾选的 ${count} 个文件。${hiddenNotice}以已有 PartName 为准，未设定时按${nameSource.value === "label" ? "标签名（空标签回退文件名）" : "文件名"}补全；装配名称去除末尾 .ASSY，Label 据此规范化。其他业务属性保持不变。本阶段不改文件名、不改宿主引用。先关闭 FreeCAD 相关文档；将保存原文件到 .phoenix/name-normalize-backups。各文件独立执行，无跨文件事务。`, choices: [{ id: "write", label: "确认写入属性", variant: "primary" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId === "write") await batch.write(plan.plan_id);
  } finally { confirming.value = false; }
}
async function confirmRename() {
  if (!batch.canRename || busy.value || shared.disabled.value) return;
  const id = batch.analysis!.analysis_id; const count = batch.renameSelected.length; confirming.value = true;
  try {
    const hiddenNotice = hiddenRenameSelected.value ? `其中 ${hiddenRenameSelected.value} 个已勾选文件被筛选隐藏，仍会改名。` : "";
    const options = batch.analysis!.options || renameOptions.value;
    const optionNotice = `XLink 路径：${options.fixXref ? "开启" : "关闭"}；引用标签：${options.syncLabels ? "开启" : "关闭"}；basename 引用：${options.fixBasename ? "开启" : "关闭"}。`;
    const hostCount = new Set(batch.analysis!.rows.filter(row => batch.renameSelected.includes(row.rel)).flatMap(row => row.hosts.filter(host => host.hits.length).map(host => host.host_repo_rel_path))).size;
    const attributeNotice = mode.value === "drawings" ? "仅同步图纸文件名，不写 BOM 属性，不修改源模型。" : batch.attributes ? "属性阶段已独立完成，改名失败不会撤销属性。" : "本次仅改文件名，不写入当前模型的 PartName / Label；推荐属性差异保留。";
    const answer = await pnwPromptChoice({ title: "确认改名并修正引用", defaultChoiceId: "cancel", message: `将改名已勾选的 ${count} 个文件，并处理整个 CAD 索引中 ${hostCount} 个直接宿主，包含搜索目录外的文件。${hiddenNotice}${optionNotice}先备份源文件与宿主，再改名、修正引用并校验；缺少宿主、文件变化、歧义或冲突会阻止执行，部分失败会逐文件保留记录，不会冒报全部完成。${attributeNotice}不能保证覆盖未入索引或工作空间外的依赖；外部修改后请先更新索引。确认已关闭相关 FreeCAD 文件。`, choices: [{ id: "rename", label: "确认改名并修正引用", variant: "primary" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId === "rename") await batch.submitRenamePlan(id);
  } finally { confirming.value = false; }
}
function openReferences(rel: string, target: string, logId?: number) {
  shell.openTab({ pageId: "file_rename", payload: { renameAnalysis: logId ? { renameLogId: logId } : { oldBasename: rel.split("/").pop(), newBasename: target.split("/").pop(), autoAnalyze: false } } });
}
usePagePrimaryContribution("name_normalize", props.workbenchTabId, {
  title: "批量工具", summary: computed(() => batch.error || "预览 → 勾选 → 改名；属性写入为可选操作"),
  sections: [cadBatchToolsSection(shell, "name_normalize"), shared.section, { id: "name-source", title: "名称推荐", controls: [
    { id: "mode", kind: "choice", label: "处理内容", modelValue: mode, options: [{ value: "models", label: "3D 名称统一" }, { value: "drawings", label: "图纸名称同步" }], disabled: busy, onUpdate: value => { mode.value = value as "models" | "drawings"; } },
    { id: "show-drawings", kind: "boolean", label: "普通预览显示图纸", modelValue: showDrawings, disabled: busy, onUpdate: value => { showDrawings.value = value; } },
    { id: "name-source", kind: "choice", label: "名称补全来源", description: `${bomNameSourceHint} 改变后需重新预览。`, modelValue: nameSource, options: bomNameSourceOptions, disabled: busy, onUpdate: value => { nameSource.value = value as BomNameSource; } },
  ] }, { id: "name-actions", title: "分阶段执行", progress: computed<PagePrimaryProgress>(() => {
    const index = batch.indexUpdate;
    if (index && "scanned" in index) return cadIndexProgress(index);
    if (index?.state === "failed") return { label: "CAD 索引更新", state: "failed", detail: index.message };
    const job = batch.renameJob;
    return { label: "逐项改名与引用修正", state: job?.state === "attention" ? "warning" : job?.state || "idle", completed: job?.completed || 0, total: job?.total || batch.renameSelected.length,
      detail: job?.current_rel || job?.message || "每项完成后更新结果；整批结束后统一刷新 CAD 索引" };
  }), actions: [
    { id: "document-sync", label: "关联文档同步…", disabled: busy, run: () => { shell.openTab({ pageId: "document_sync" }); } },
    { id: "preview", label: "1. 预览名称", tone: "primary", disabled: shared.disabled, run: preview },
    { id: "direct-rename", label: "2. 改名勾选项", tone: "primary", disabled: computed(() => !canDirectRename.value || shared.disabled.value), run: directRename },
    { id: "write", label: "可选：写入属性", disabled: computed(() => !batch.canWrite || busy.value || shared.disabled.value), run: write },
    { id: "analyze", label: "可选：查看引用分析", disabled: computed(() => !batch.canAnalyze || busy.value || shared.disabled.value), run: async () => { expanded.analysis = true; await batch.analyzeRename(); } },
  ] }, { id: "name-references", title: "引用修正选项", description: "与单文件改名共用选择记忆；改变选项后需重新分析。", controls: [
    ...([{ id: "fixXref", label: "修改引用（XLink path）", description: "修正整个 CAD 索引内宿主的文件路径" },
      { id: "syncLabels", label: "同步引用标签（Label）", description: "同步引用实例显示名为 CAD 索引规则名" },
      { id: "fixBasename", label: "引用名字（basename）", description: "包含仅按唯一文件名匹配的引用" }] as const).map(option => ({ ...option, kind: "boolean" as const,
      modelValue: computed(() => preferences[option.id]), disabled: computed(() => busy.value || batch.renameDone),
      onUpdate: (value: boolean) => preferences.setOption(option.id, value),
    })),
  ] }, { id: "name-help", title: "使用说明", description: "预览 → 勾选 → 改名；执行前自动检查引用，属性写入可选。直接改名保留当前模型 PartName / Label。\n3D：已有 PartName 优先，缺失时按标签名或文件名补全；普通预览默认隐藏图纸。\n图纸：先完成源模型改名，再切换图纸名称同步。按唯一实际引用匹配；保持目录，.ASSY 换为 .Drawing，不写 BOM 属性。多源、缺失或冲突需人工确认。\n两类操作均默认零勾选、执行前确认并备份。引用检查覆盖整个 CAD 索引；未入索引或工作空间外依赖需另行核对。先关闭相关 FreeCAD 文件；备份在 .phoenix/name-normalize-backups。" }],
});
</script>
<template>
  <PageLayout title="名称统一" class="desk-page-layout name-normalize-page">
    <template #header><PageHeader title="名称统一">
      <template #center>
        <div class="name-result-filters" role="search" aria-label="筛选已有名称结果">
          <el-input v-model="filenameSearch" class="filename-search" size="small" clearable placeholder="搜索文件名 / 路径…" aria-label="搜索结果中的文件名或路径" />
          <el-radio-group v-model="statusFilter" class="status-filter" size="small" aria-label="名称结果状态" title="正常：无需修正；需修正：名称差异或引用待处理；需确认：阻塞、失败或结果不明">
            <el-radio-button v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <template #right><el-button size="small" :disabled="shared.disabled.value" :loading="batch.action === 'preview'" @click="preview">预览名称</el-button></template>
    </PageHeader></template>
    <div class="actions">
      <el-radio-group v-model="mode" size="small" aria-label="名称处理内容" :disabled="busy">
        <el-radio-button value="models">3D 名称统一</el-radio-button><el-radio-button value="drawings">图纸名称同步</el-radio-button>
      </el-radio-group>
      <el-checkbox v-if="mode === 'models'" v-model="showDrawings" :disabled="busy">显示图纸</el-checkbox>
      <el-radio-group v-if="mode === 'models'" v-model="nameSource" size="small" aria-label="名称补全来源" :disabled="busy" :title="bomNameSourceHint">
        <el-radio-button v-for="option in bomNameSourceOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
      </el-radio-group>
      <span class="muted">{{ mode === 'models' ? '已有 PartName 优先' : '先完成模型改名；图纸沿用源模型当前文件名，.ASSY 替换为 .Drawing' }}</span>
    </div>
    <el-alert v-if="batch.error" class="normalization-notice" :title="batch.error" type="error" :closable="false" />
    <el-alert v-if="batch.renameJob && ['attention', 'failed'].includes(batch.renameJob.state)" class="normalization-notice" :title="`${batch.renameJob.message}；具体文件、宿主及原因见 Bottom 运行日志`" type="warning" :closable="false" />
    <p v-if="batch.indexUpdate" class="index-update" role="status">
      <strong>{{ batch.indexUpdate.state === 'running' ? '正在更新整个 CAD 索引' : batch.indexUpdate.state === 'done' ? 'CAD 索引已更新' : 'CAD 索引需要检查' }}</strong>
      · {{ batch.indexUpdate.message }}<template v-if="'scanned' in batch.indexUpdate"> · {{ batch.indexUpdate.scanned }} 个文件</template>
      <el-button link size="small" @click="shell.openTab({ pageId: 'cad_index' })">打开 CAD 索引</el-button>
    </p>
    <p v-if="!batch.preview">点击「预览名称」后再勾选。进入页面不会扫描、写入或改名。</p>
    <WingBlock v-if="batch.preview" v-model:expanded="expanded.preview" variant="card" class="name-block" title="名称预览" aria-label="名称统一预览">
      <template #suffix>{{ visibleRows.length }} 个 · 已选 {{ batch.selected.length }} 个</template>
      <div class="actions"><span>扫描 {{ batch.preview.scanned }} 个 · 显示 {{ visibleRows.length }} / {{ previewRows.length }}</span><el-button size="small" :disabled="busy || batch.attributeDone || !visibleRows.length" @click="selectVisible()">勾选当前可用文件</el-button><el-button size="small" :disabled="busy || batch.attributeDone" @click="batch.selectAll(false)">取消全部勾选</el-button><el-button size="small" type="primary" :disabled="!canDirectRename || shared.disabled.value" @click="directRename">改名勾选项</el-button><el-button v-if="mode === 'models'" size="small" :disabled="!batch.canWrite || busy || shared.disabled.value" @click="write">写入属性（可选）</el-button></div>
      <p v-if="hiddenSelected" class="hidden-selection-notice" role="status">当前筛选隐藏了 {{ hiddenSelected }} 个已勾选文件，执行时仍会处理。<el-button link size="small" @click="clearFilters">显示全部核对</el-button></p>
      <p v-if="batch.attributeDone">保留本次预览快照；属性结果与改名结果分别显示。本次计划不可重用，重新预览会清除当前结果。</p>
      <table class="preview-table"><thead><tr><th>选择</th><th>{{ mode === 'drawings' ? '图纸 / 源模型' : '文件 / 主对象' }}</th><th v-if="mode === 'models'">PartName 原值 → 目标</th><th v-if="mode === 'models'">Label 原值 → 目标</th><th>目标文件名</th><th>状态</th></tr></thead><tbody>
        <tr v-if="!visibleRows.length"><td :colspan="mode === 'models' ? 6 : 4" class="empty-row">当前筛选无匹配文件。<el-button link size="small" @click="clearFilters">清除筛选</el-button></td></tr>
        <tr v-for="{ row, state } in visibleRows" :key="row.rel">
          <td><input type="checkbox" :aria-label="`选择 ${row.rel}`" :checked="batch.selected.includes(row.rel)" :disabled="busy || batch.attributeDone || !row.eligible" @change="batch.select(row.rel, ($event.target as HTMLInputElement).checked)" /></td>
          <td><a class="file-detail-link" :href="`?page=file_detail&rel=${encodeURIComponent(detailRel(row.rel))}`" :title="`文件详情：${detailRel(row.rel)}`" @click.exact.prevent="openDetail(row.rel)">{{ detailRel(row.rel) }}</a><small>{{ row.source_rel ? `源模型：${row.source_rel}` : row.object_name || (row.kind === 'drawing' ? '图纸（不写 BOM 属性）' : '未能确定属性对象') }}</small><ul v-if="row.warnings.length" class="warning"><li v-for="message in row.warnings" :key="message">{{ message }}</li></ul></td>
          <td v-if="mode === 'models'" :class="{ difference: !batch.attributeDone && row.eligible && row.current_name !== row.proposed_name }"><span>{{ row.object_name ? row.current_name || '（空）' : '—' }}</span><strong v-if="row.proposed_name && row.proposed_name !== row.current_name">→ {{ row.proposed_name }}</strong></td>
          <td v-if="mode === 'models'" :class="{ difference: !batch.attributeDone && row.eligible && row.current_label !== row.proposed_label }"><span>{{ row.object_name ? row.current_label || '（空）' : '—' }}</span><strong v-if="row.proposed_label && row.proposed_label !== row.current_label">→ {{ row.proposed_label }}</strong></td>
          <td>{{ row.target_rel || '—' }}</td><td class="status-column" :data-status="state.group"><el-tag class="status-tag" size="small" :type="state.tone" :data-tone="state.tone">{{ state.label }}</el-tag><small>{{ state.detail }}</small></td>
        </tr>
      </tbody></table>
    </WingBlock>
    <WingBlock v-if="batch.preview" v-model:expanded="expanded.analysis" variant="card" class="name-block" title="引用检查与改名结果" aria-label="改名分析与结果">
      <div class="actions"><el-button size="small" :disabled="!batch.canAnalyze || busy || shared.disabled.value" @click="batch.analyzeRename">分析改名与引用</el-button><template v-if="batch.analysis"><span>显示 {{ visibleRenameRows.length }} / {{ renameRows.length }}</span><el-button size="small" :disabled="busy || batch.renameDone || !visibleRenameRows.length" @click="selectVisible('rename')">勾选当前可改名文件</el-button><el-button size="small" :disabled="busy || batch.renameDone" @click="batch.selectAll(false, 'rename')">取消全部勾选</el-button><el-button size="small" type="primary" :disabled="!batch.canRename || busy || shared.disabled.value" @click="confirmRename">执行 {{ batch.renameSelected.length }} 个改名</el-button></template></div>
      <p v-if="hiddenRenameSelected" class="hidden-selection-notice" role="status">当前筛选隐藏了 {{ hiddenRenameSelected }} 个已勾选文件，执行时仍会改名。<el-button link size="small" @click="clearFilters">显示全部核对</el-button></p>
      <p v-if="!batch.analysis">可以直接在预览中点「改名勾选项」，执行前会自动检查引用。无需先写入属性，也可在这里单独查看检查结果。</p>
      <template v-if="batch.analysis"><el-alert class="normalization-notice" :title="batch.analysis.warning" type="warning" :closable="false" />
        <table class="preview-table"><thead><tr><th>选择</th><th>源 → 目标</th><th>引用宿主 / 范围</th><th>改名阶段状态</th><th>操作</th></tr></thead><tbody>
          <tr v-if="!visibleRenameRows.length"><td colspan="5" class="empty-row">当前筛选无匹配文件。<el-button link size="small" @click="clearFilters">清除筛选</el-button></td></tr>
          <tr v-for="{ row, state } in visibleRenameRows" :key="row.rel"><td><input type="checkbox" :aria-label="`改名 ${row.rel}`" :checked="batch.renameSelected.includes(row.rel)" :disabled="busy || batch.renameDone || !row.eligible" @change="batch.select(row.rel, ($event.target as HTMLInputElement).checked, 'rename')" /></td><td>{{ row.rel }}<strong>→ {{ row.target_rel }}</strong></td><td><div v-for="host in row.hosts" :key="host.host_repo_rel_path">{{ host.host_repo_rel_path }} · {{ host.usage_kind === 'indirect' ? '间接引用' : `${host.hit_count} 处直接引用` }} <span v-if="row.outside_scope.includes(host.host_repo_rel_path)" class="warning">（搜索目录外，已纳入分析）</span></div><span v-if="!row.hosts.length">索引内未列出宿主；未入索引的依赖仍需核对</span></td><td class="status-column" :data-status="state.group"><el-tag class="status-tag" size="small" :type="state.tone" :data-tone="state.tone">{{ state.label }}</el-tag><small>{{ state.detail }}</small><small v-for="failure in batch.renamed?.results.find(item => item.rel === row.rel)?.failed_hosts" :key="`${failure.host_repo_rel_path}:${failure.error}`" class="warning">{{ failure.host_repo_rel_path }}：{{ failure.error }}</small></td><td><el-button link type="primary" @click="openReferences(row.rel, row.target_rel, batch.renamed?.results.find(item => item.rel === row.rel)?.rename_log_id)">打开引用分析</el-button></td></tr>
        </tbody></table>
      </template>
    </WingBlock>
    <WingBlock v-if="batch.attributes" v-model:expanded="expanded.attributes" variant="card" class="name-block" title="属性写入结果与备份"><ul><li v-for="row in batch.attributes.results" :key="row.rel">{{ row.rel }}：{{ row.message }}<small v-if="row.backup">备份：{{ row.backup }}</small></li></ul></WingBlock>
    <WingBlock v-if="batch.renamed" v-model:expanded="expanded.backups" variant="card" class="name-block" title="改名备份"><ul><template v-for="row in batch.renamed.results" :key="row.rel"><li v-if="row.backup">{{ row.rel }}：{{ row.backup }}</li><li v-for="backup in row.host_backups" :key="backup.rel">{{ backup.rel }}：{{ backup.backup }}</li></template></ul></WingBlock>
  </PageLayout>
</template>

<style scoped>
p { color: var(--muted); line-height: 1.6; }
.name-block { height: auto; flex: 0 0 auto !important; margin-block: 10px; }
.name-block :deep(.pnw-sidebar-block-body) { overflow-x: auto; }
.name-result-filters { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.filename-search { flex: 1 1 200px; min-width: 100px; }
.status-filter { flex: 0 0 auto; flex-wrap: nowrap; }
.hidden-selection-notice { padding: 6px 10px; border-left: 2px solid var(--phoenix-warning-border); background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block: 12px; }
.preview-table { border-collapse: collapse; width: 100%; font-size: .86rem; color: var(--phoenix-text); }
th, td { padding: 8px; border: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { white-space: nowrap; background: var(--phoenix-bg-panel-head); color: var(--phoenix-text-secondary); }
td strong, small { display: block; margin-top: 4px; }
small { color: var(--muted); }
.difference { background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); }
.warning { color: var(--phoenix-warning-text); }
.file-detail-link { color: var(--phoenix-accent); text-decoration: underline; text-underline-offset: 2px; }
.file-detail-link:focus-visible { outline: 2px solid var(--phoenix-accent); outline-offset: 2px; border-radius: 2px; }
.status-column { min-width: 120px; max-width: 240px; }
.status-tag[data-tone="warning"] { --el-tag-bg-color: var(--phoenix-warning-bg); --el-tag-border-color: var(--phoenix-warning-border); --el-tag-text-color: var(--phoenix-warning-text); }
.status-tag[data-tone="success"] { --el-tag-bg-color: var(--phoenix-success-bg); --el-tag-border-color: var(--phoenix-success-border); --el-tag-text-color: var(--phoenix-success-text); }
.status-tag[data-tone="danger"] { --el-tag-bg-color: var(--phoenix-danger-bg); --el-tag-border-color: var(--phoenix-danger-border); --el-tag-text-color: var(--phoenix-danger-text); }
.status-tag[data-tone="primary"] { --el-tag-bg-color: var(--phoenix-accent-soft); --el-tag-border-color: var(--phoenix-accent-border); --el-tag-text-color: var(--phoenix-accent); }
.empty-row { padding: 24px 8px; text-align: center; color: var(--muted); }
.normalization-notice {
  --el-color-warning-light-9: var(--phoenix-warning-bg);
  --el-color-warning: var(--phoenix-warning-text);
  --el-color-error-light-9: var(--phoenix-danger-bg);
  --el-color-error: var(--phoenix-danger-text);
}
h2 { margin-top: 24px; font-size: 1rem; }
</style>
