<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, reactive, ref, toValue, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useCadBatchDirectory } from "../../composables/useCadBatchDirectory";
import { cadBatchToolsSection } from "../../composables/cadBatchTools";
import { usePagePrimaryContribution, type PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import { usePageSession } from "../../composables/usePageSession";
import { useDrawingBatch } from "./useDrawingBatch";
import { useDrawingLineWidths } from "./useDrawingLineWidths";
import type { DrawingAuditFilter, DrawingIssueStatus } from "./types";
import { DRAWING_PAPER_OPTIONS } from "./types";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell(), shared = useCadBatchDirectory(shell.workspacePath);
const mountedActive = ref(true), recursive = ref(false), validating = ref(false);
const active = computed(() => mountedActive.value && (!props.workbenchTabId || shell.activeTabId.value === props.workbenchTabId));
const drawing = reactive(useDrawingBatch(shell.workspacePath, shared.directory, recursive, {
  appendLog: shell.appendLog,
  changed: workspace => { if (workspace === shell.workspacePath.value) shell.requestTreeRescan(); },
  confirm: async (kind, message) => (await pnwPromptChoice({ title: kind === "repair" ? "确认批量图纸修正" : "确认批量生成图纸初稿", message, defaultChoiceId: "cancel", choices: [{ id: "apply", label: kind === "repair" ? "已关闭目标，应用勾选" : "生成所选初稿", variant: "primary" }, { id: "cancel", label: "取消" }] })).choiceId === "apply",
}, active));
const lineWidths = reactive(useDrawingLineWidths(shell.workspacePath, active, computed(() => drawing.busy || validating.value), {
  invalidatePreviews: drawing.clearPreviews,
  reportError: message => shell.appendLog(`[图纸线宽] ${message}`, { source: "drawing_batch", open: true }),
}));
const busy = computed(() => drawing.busy || validating.value || !!lineWidths.pending);
shared.bindBusy(computed(() => drawing.busy || !!lineWidths.pending));
const expanded = reactive({ audit: true, generation: true });
const scopeSettings = new Map<string, { recursive: boolean; audit: boolean; generation: boolean }>();
const filters: Array<{ value: DrawingAuditFilter; label: string }> = [{ value: "all", label: "全部" }, { value: "ready", label: "可修正" }, { value: "conflict", label: "冲突" }, { value: "manual", label: "人工处理" }, { value: "error", label: "错误" }];
const statusLabel: Record<DrawingIssueStatus, string> = { ready: "可修正", manual: "人工处理", conflict: "冲突，保持原值", ok: "正常" };
const progress = computed<PagePrimaryProgress>(() => ({ label: "图纸批量", state: drawing.error ? "warning" : drawing.busy ? "running" : drawing.job?.status === "failed" ? "failed" : drawing.job?.status === "cancelled" ? "cancelled" : drawing.job ? drawing.job.failed ? "warning" : "done" : "idle", completed: drawing.job?.results.length || 0, total: drawing.job?.total || 0, detail: drawing.error || drawing.phase || drawing.job?.active_rel || "先预览，再明确勾选确认" }));
async function preview(kind: "audit" | "generation") {
  if (busy.value || !active.value || !drawing.canInteract) return;
  const ws = shell.workspacePath.value, expectedRecursive = recursive.value;
  validating.value = true;
  try {
    const valid = await shared.validate();
    if (ws !== shell.workspacePath.value || !active.value || expectedRecursive !== recursive.value) return;
    if (!valid) { drawing.error = String(toValue(shared.section.description) || "搜索目录未通过校验，请检查当前范围"); shell.appendLog(drawing.error, { source: "drawing_batch", open: true }); return; }
  } catch (cause) {
    if (ws === shell.workspacePath.value && active.value) { drawing.error = cause instanceof Error ? cause.message : String(cause); shell.appendLog(drawing.error, { source: "drawing_batch", open: true }); }
    return;
  } finally { validating.value = false; }
  if (ws !== shell.workspacePath.value || !active.value || drawing.busy) return;
  if (kind === "audit") { await drawing.previewAudit(); expanded.audit = true; }
  else { await drawing.previewGeneration(); expanded.generation = true; }
}
async function applyAudit() { if (!busy.value && active.value) await drawing.applyAudit(); }
async function startGeneration() { if (!busy.value && active.value) await drawing.startGeneration(); }
function issueChecked(rowId: string, issueId: string) { return !!drawing.selectedIssues[rowId]?.includes(issueId); }
function checked(event: Event) { return (event.target as HTMLInputElement).checked; }
function serialize() { return { workspace: shell.workspacePath.value, recursive: recursive.value, expanded: { ...expanded } }; }
function hydrate(snapshot: Record<string, unknown>) {
  if (snapshot.workspace !== shell.workspacePath.value) return false;
  drawing.clearPreviews(); recursive.value = snapshot.recursive === true;
  const value = snapshot.expanded && typeof snapshot.expanded === "object" ? snapshot.expanded as Record<string, unknown> : {};
  expanded.audit = value.audit !== false; expanded.generation = value.generation !== false; return true;
}
usePageSession(props.workbenchTabId, { serialize, hydrate, isDirty: () => false, isBusy: () => busy.value, refresh: drawing.clearPreviews });
onMounted(() => { if (props.workbenchTabId) { const value = shell.consumeTabPageState(props.workbenchTabId); if (value) hydrate(value); } });
onActivated(() => { mountedActive.value = true; });
onDeactivated(() => { mountedActive.value = false; });
watch(shell.workspacePath, (ws, previous) => {
  scopeSettings.set(previous, { recursive: recursive.value, ...expanded });
  const saved = scopeSettings.get(ws); recursive.value = saved?.recursive ?? false;
  expanded.audit = saved?.audit ?? true; expanded.generation = saved?.generation ?? true;
  drawing.templateRoot = ""; drawing.template = ""; drawing.paper = "auto"; drawing.scale = "auto";
  drawing.allowWithoutPdf = true;
  drawing.dimensionFont = "osifont"; drawing.annotationFont = "";
}, { flush: "sync" });
watch(() => [recursive.value, expanded.audit, expanded.generation], () => shell.scheduleWorkbenchSave());
usePagePrimaryContribution("drawing_batch", props.workbenchTabId, {
  title: "图纸批量", summary: computed(() => drawing.error || drawing.phase || (drawing.job ? `${drawing.job.completed} / ${drawing.job.total} · ${drawing.job.status}` : "先校核或预览出图，不自动写入")),
  sections: [cadBatchToolsSection(shell, "drawing_batch"), shared.section, { id: "scope", title: "范围与操作", progress, controls: [{ id: "recursive", kind: "boolean", label: "含子目录", modelValue: recursive, disabled: busy, onUpdate: value => { recursive.value = value; } }], actions: [
    { id: "audit-preview", label: "校核预览", disabled: computed(() => busy.value || !drawing.canInteract), run: () => preview("audit") },
    { id: "audit-apply", label: "应用所选修正", disabled: computed(() => busy.value || !drawing.canApplyAudit), run: applyAudit },
    { id: "generation-preview", label: "出图预览", disabled: computed(() => busy.value || !drawing.canInteract), run: () => preview("generation") },
    { id: "generation-start", label: "生成所选初稿", disabled: computed(() => busy.value || !drawing.canStartGeneration), run: startGeneration },
  ] }, { id: "help", title: "说明", description: "目录校核不依赖 CAD 索引，只读扫描独立 Drawing.FCStd。只有可修正问题能勾选；冲突、来源不明确和人工值保持。修正原图前请在 FreeCAD 中保存并关闭文档，确认后先备份。\n已有图纸按现状维护，不根据旧配方覆盖人工材料、尺寸、技术要求或布局。工程字体仅处理明确建议项；字体安装、PDF 页面及尺寸的视觉结果仍需人工核对。\n出图从源模型生成初稿，纸张、比例、材料来源与输出路径在预览中核对。串行执行，已有不同内容目标不覆盖。PNG 缩略图、PDF 和实际 Page 分开验收，初稿不等于正式发布。\n修改范围、选项、刷新或离开页面都会使旧预览失效；计划一用即失效。运行任务保留结果，可主动取消或恢复查看状态，不自动启动、重试或提交 Git。" }],
});
</script>
<template>
  <PageLayout class="desk-page-layout drawing-batch-page" title="图纸批量">
    <template #header><PageHeader title="图纸批量"><template #right><el-checkbox v-model="recursive" :disabled="busy">含子目录</el-checkbox><el-button size="small" :disabled="busy || !drawing.canInteract" @click="preview('audit')">校核预览</el-button><el-button size="small" :disabled="busy || !drawing.canInteract" @click="preview('generation')">出图预览</el-button></template></PageHeader></template>
    <p class="scope-line">当前目录：<code>{{ shared.directory.value }}</code> · {{ recursive ? '包含子目录' : '仅当前目录' }} · 不依赖 CAD 索引</p>
    <p v-if="drawing.error" role="alert" class="error">{{ drawing.error }}</p>
    <small>服务接受任务后消费计划。明确的队列拒绝且票据未消费时，可再次确认后重试；其它校验拒绝需重新预览。响应未确认时先查询任务与目标文件，不重复提交。</small>
    <WingBlock v-model:expanded="expanded.audit" title="1. 图纸校核与修正" variant="card" class="drawing-block">
      <template #suffix>已选 {{ drawing.auditSelections.length }} 个文件</template>
      <template #actions><div class="actions"><el-button size="small" :disabled="busy || !drawing.canInteract" @click="preview('audit')">校核预览</el-button><el-button size="small" :disabled="busy || !drawing.audit || drawing.auditExpired || drawing.auditRejected" @click="drawing.selectAllAudit(true)">勾选可修正</el-button><el-button size="small" :disabled="busy || !drawing.auditSelections.length" @click="drawing.selectAllAudit(false)">取消勾选</el-button><el-button size="small" type="primary" :disabled="busy || !drawing.canApplyAudit" @click="applyAudit">应用所选修正</el-button><el-button v-if="drawing.job?.kind === 'repair'" size="small" :disabled="!drawing.canCancel" @click="drawing.cancelJob">停止任务</el-button></div></template>
      <div class="font-options line-width-options"><label>轮廓线宽（mm）<el-input-number v-model="lineWidths.contour" :disabled="busy" :min="0" :max="5" :step="0.05" aria-label="轮廓线宽（mm）" /></label><label>尺寸及界线线宽（mm）<el-input-number v-model="lineWidths.dimension" :disabled="busy" :min="0" :max="5" :step="0.05" aria-label="尺寸及界线线宽（mm）" /></label><el-button size="small" :disabled="!lineWidths.canLoad" :loading="lineWidths.pending === 'load'" @click="lineWidths.load">读取已保存线宽</el-button><el-button size="small" :disabled="!lineWidths.canSave" :loading="lineWidths.pending === 'save'" @click="lineWidths.save">保存当前工作空间线宽</el-button></div>
      <small v-if="!lineWidths.saved">当前显示缺省线宽 0.5 / 0.25 mm，尚未读取当前工作空间有效配置；预览以服务端已保存值为准。</small>
      <small v-if="lineWidths.dirty && !lineWidths.error" class="warning">输入尚未保存，不用于当前校核或出图预览；请保存后重新预览。</small>
      <small v-if="lineWidths.validation" class="warning">{{ lineWidths.validation }}</small>
      <p v-if="lineWidths.error" role="alert" class="error">{{ lineWidths.error }}</p><small v-if="lineWidths.notice" role="status">{{ lineWidths.notice }}</small>
      <small>只保存当前工作空间的两项毫米线宽，不写机器设置；轮廓线须粗于尺寸及界线。设置本身不改 CAD，旧图仍需重新校核并明确勾选修正；新稿共用已保存规范。</small>
      <div class="font-options"><label>尺寸字体<el-input v-model="drawing.dimensionFont" :disabled="busy" placeholder="osifont；留空不建议修正" /></label><label>中文注释字体<el-input v-model="drawing.annotationFont" :disabled="busy" placeholder="输入本机可用字体 family；留空不建议修正" /></label></div>
      <small>明确请求字体才给出建议；本机未安装或实际回退时整份图纸修正失败并保留原图。字体建议不代替 PDF 视觉验收。</small>
      <div class="filter-row"><el-input v-model="drawing.query" placeholder="搜索文件、字段，空格分隔多个词" aria-label="搜索校核问题" clearable /><el-select v-model="drawing.filter" aria-label="问题状态筛选"><el-option v-for="item in filters" :key="item.value" :value="item.value" :label="item.label" /></el-select></div>
      <p v-if="drawing.auditExpired" class="warning" role="status">校核预览已过期，请重新预览。</p>
      <p v-if="drawing.auditRejected" class="warning" role="status">本次提交已被服务拒绝；旧校核列表仅供核对，需重新预览才能再提交。</p>
      <p v-if="drawing.auditSelectionTooLarge" class="warning" role="alert">每次最多 500 个文件、每份最多 100 个问题，请减少勾选后再应用；不会截断、消费预览或自动应用。</p>
      <small v-if="drawing.audit">扫描 {{ drawing.audit.scanned }} 个 · 显示 {{ drawing.visibleAuditRows.length }} / {{ drawing.audit.rows.length }} 个 · 默认不勾选；只处理勾选的可修正问题。</small>
      <div v-for="row in drawing.visibleAuditRows" :key="row.id" class="audit-file">
        <div class="file-head"><input type="checkbox" :aria-label="`选择图纸 ${row.rel}`" :checked="!!drawing.readyIssues(row).length && drawing.readyIssues(row).every(issue => issueChecked(row.id, issue.id))" :disabled="busy || !drawing.readyIssues(row).length || drawing.auditExpired || drawing.auditRejected" @change="drawing.selectFile(row, checked($event))" /><el-button link type="primary" class="file-link" @click="shell.openFileDetailForRel(row.rel)">{{ row.rel }}</el-button><small v-if="row.source_rel">来源 {{ row.source_rel }} · {{ row.source_node || '未确定节点' }}</small></div>
        <p v-if="row.error" class="error">{{ row.error }}</p>
        <div class="table-scroll"><table><thead><tr><th>选择</th><th>位置 / 字段</th><th>当前值</th><th>建议值</th><th>状态 / 原因</th></tr></thead><tbody><tr v-for="issue in row.issues" :key="issue.id"><td><input type="checkbox" :aria-label="`选择问题 ${row.rel} ${issue.field}`" :checked="issueChecked(row.id, issue.id)" :disabled="busy || !!row.error || issue.status !== 'ready' || drawing.auditExpired || drawing.auditRejected" @change="drawing.selectIssue(row, issue.id, checked($event))" /></td><td>{{ issue.location }}<small>{{ issue.field }}</small></td><td class="value">{{ issue.current || '（空）' }}</td><td class="value">{{ issue.proposed || '—' }}</td><td :class="issue.status === 'conflict' ? 'warning' : ''">{{ statusLabel[issue.status] }}<small>{{ issue.message }}</small></td></tr><tr v-if="!row.issues.length"><td colspan="5">未发现可处理问题。</td></tr></tbody></table></div>
      </div>
      <p v-if="!drawing.audit" class="empty">先校核预览，再逐文件、逐问题勾选；不自动修改原图纸。</p><p v-else-if="!drawing.visibleAuditRows.length" class="empty">当前搜索与状态筛选没有匹配图纸。</p>
      <details v-if="drawing.audit?.warnings.length"><summary>扫描提示 {{ drawing.audit.warnings.length }}</summary><p v-for="text in drawing.audit.warnings" :key="text">{{ text }}</p></details>
      <section v-if="drawing.job?.kind === 'repair'" class="job-result"><h4>修正任务 · {{ drawing.job.status }} · {{ drawing.job.completed }} / {{ drawing.job.total }} · 失败 {{ drawing.job.failed }}</h4><p>{{ drawing.job.active_rel }}</p><el-button size="small" :disabled="drawing.pending" @click="drawing.refreshJob">刷新任务状态</el-button><p v-for="result in drawing.job.results" :key="result.id" :class="result.status === 'failed' ? 'error' : ''">{{ result.rel }}：{{ result.message }}<small v-if="result.backup">备份 {{ result.backup }}</small><small v-if="result.manual_review_required">需人工核对图纸、PDF 与尺寸。</small><small v-for="warning in result.warnings" :key="warning" class="warning">{{ warning }}</small><small v-for="output in result.outputs" :key="output">{{ output }}</small></p></section>
    </WingBlock>
    <WingBlock v-model:expanded="expanded.generation" title="2. 批量出图初稿" variant="card" class="drawing-block">
      <template #suffix>已选 {{ drawing.generationIds.length }} 个模型</template>
      <template #actions><div class="actions"><el-button size="small" :disabled="busy || !drawing.canInteract" @click="preview('generation')">出图预览</el-button><el-button size="small" :disabled="busy || !drawing.generation || drawing.generationExpired || drawing.generationRejected" @click="drawing.selectAllGeneration(true)">勾选可出图</el-button><el-button size="small" :disabled="busy || !drawing.generationIds.length" @click="drawing.selectAllGeneration(false)">取消勾选</el-button><el-button size="small" type="primary" :disabled="busy || !drawing.canStartGeneration" @click="startGeneration">生成所选初稿</el-button><el-button v-if="drawing.job?.kind === 'generation'" size="small" :disabled="!drawing.canCancel" @click="drawing.cancelJob">停止任务</el-button></div></template>
      <div class="generation-options"><label>模板目录<el-input v-model="drawing.templateRoot" :disabled="busy" placeholder="留空使用本机 FreeCAD 模板目录" /></label><el-button size="small" :disabled="busy || !drawing.canInteract" @click="drawing.loadTemplates">读取模板</el-button><label>模板<el-select v-if="drawing.templates?.items.length" v-model="drawing.template" :disabled="busy" clearable filterable><el-option v-for="item in drawing.templates.items" :key="item.rel" :value="item.rel" :label="`${item.rel} · ${item.width} × ${item.height}`" /></el-select><el-input v-else v-model="drawing.template" :disabled="busy" placeholder="留空按纸张使用默认模板" /></label><label>纸张<el-select v-model="drawing.paper" :disabled="busy"><el-option v-for="value in DRAWING_PAPER_OPTIONS" :key="value" :value="value" :label="value === 'auto' ? '自动纸幅（优先 A4/A3/A2）' : value" /></el-select></label><label>比例<el-select v-model="drawing.scale" :disabled="busy"><el-option v-for="value in ['auto', '1:1', '2:1', '5:1', '1:2', '1:5']" :key="value" :value="value" :label="value === 'auto' ? '自动适配常用比例' : value" /></el-select></label></div>
      <small>自动纸幅由后端布局校核，优先 A4/A3/A2，A1/A0 仅作后备；也可手选纸幅。明确选择模板时以该模板为准；请核对预览返回的实际纸张、比例和原因。</small>
      <p v-if="drawing.generationExpired" class="warning" role="status">出图预览已过期，请重新预览。</p>
      <p v-if="drawing.generationRejected" class="warning" role="status">本次提交已被服务拒绝；旧出图计划仅供核对，需重新预览才能再提交。</p>
      <p v-if="drawing.generationSelectionTooLarge" class="warning" role="alert">每次最多 500 个模型，请缩小勾选范围；不会截断或自动出图。</p>
      <el-checkbox v-model="drawing.allowWithoutPdf" :disabled="busy">无参考PDF也生成研究稿</el-checkbox>
      <small>默认允许没有参考 PDF 的模型生成研究稿。取消此选项后，只能选择可核对的 PDF 身份候选；范围变化需重新预览。参考 PDF 的工程要求未识别，研究稿不代表生产审批；拟生成的新 PDF 不能作为原图参考。</small>
      <small>先核对输出路径、材料来源、纸张与比例。只生成初稿；已有目标不覆盖，不自动推送或修改源模型。</small>
      <div v-if="drawing.generation" class="table-scroll"><table><thead><tr><th>选择</th><th>模型 / 节点 / 参考 PDF</th><th>纸张 / 比例 / 材料</th><th>模板 / 输出</th><th>状态</th></tr></thead><tbody><tr v-for="row in drawing.generation.rows" :key="row.id"><td><input v-model="drawing.selectedGeneration" type="checkbox" :value="row.id" :aria-label="`选择出图 ${row.rel} ${row.node}`" :disabled="busy || !drawing.canGenerateRow(row) || drawing.generationExpired || drawing.generationRejected" /></td><td class="value"><el-button link type="primary" class="file-link" @click="shell.openFileDetailForRel(row.rel)">{{ row.rel }}</el-button><small>{{ row.label }} · {{ row.node }} · {{ row.kind === 'assembly' ? '总成' : '零件' }}</small>
        <small v-if="row.reference_status === 'manual'" class="warning">参考PDF来源需人工核对，未采用为原参考。<span v-if="row.reference_pdf">{{ row.reference_pdf }}</span></small>
        <small v-else>参考PDF（身份候选，工程要求未识别）：{{ drawing.referenceCandidate(row) ? row.reference_pdf : '未找到可核对候选' }}</small>
        <small v-for="candidate in row.reference_candidates" :key="candidate.rel" :class="candidate.status === 'manual' ? 'warning' : ''">{{ candidate.status === 'manual' ? '人工候选，未采用为原参考' : '可见身份候选' }}：<code>{{ candidate.rel }}</code><span v-if="candidate.message"> · {{ candidate.message }}</span></small>
      </td><td>{{ row.paper }} · {{ row.scale }}<small>材料 {{ row.material || '未指定' }} · 来源 {{ row.material_source || '未确定' }}</small><small v-if="row.contour_line_width_mm !== undefined && row.dimension_line_width_mm !== undefined">本次线宽：轮廓 {{ row.contour_line_width_mm }} mm / 尺寸及界线 {{ row.dimension_line_width_mm }} mm</small></td><td class="value">{{ row.template }}<small v-for="output in row.output_paths" :key="output">{{ output }}</small></td><td :class="drawing.canGenerateRow(row) ? '' : 'warning'">{{ drawing.canGenerateRow(row) ? '可生成初稿' : '不可出图' }}<small>{{ row.message }}</small><small v-if="row.reference_status === 'manual'">{{ drawing.allowWithoutPdf ? '未采用人工候选，仅从 3D 生成无原图研究稿，需人工审查。' : '已限定参考 PDF，人工候选不作为原参考，不出图。' }}</small><small v-else-if="!row.reference_pdf || row.reference_status === 'missing'">{{ drawing.allowWithoutPdf ? '无参考 PDF，仅生成研究稿，需人工审查。' : '已限定参考 PDF，缺失项不出图。' }}</small><small v-else-if="row.reference_status === 'ambiguous'">参考 PDF 身份有歧义，需人工处理。</small></td></tr><tr v-if="!drawing.generation.rows.length"><td colspan="5">此范围没有可计划的源模型。</td></tr></tbody></table></div>
      <p v-else class="empty">先出图预览，再勾选模型并确认串行生成。</p>
      <details v-if="drawing.generation?.warnings.length"><summary>扫描提示 {{ drawing.generation.warnings.length }}</summary><p v-for="text in drawing.generation.warnings" :key="text">{{ text }}</p></details>
      <section v-if="drawing.job?.kind === 'generation'" class="job-result"><h4>出图任务 · {{ drawing.job.status }} · {{ drawing.job.completed }} / {{ drawing.job.total }} · 失败 {{ drawing.job.failed }}</h4><p>{{ drawing.job.active_rel }}</p><el-button size="small" :disabled="drawing.pending" @click="drawing.refreshJob">刷新任务状态</el-button><p v-for="result in drawing.job.results" :key="result.id" :class="result.status === 'failed' ? 'error' : ''">{{ result.rel }}：{{ result.message }}<small v-if="result.manual_review_required">初稿需人工检查，不视为正式验收。</small><small v-for="warning in result.warnings" :key="warning" class="warning">{{ warning }}</small><small v-for="output in result.outputs" :key="output">{{ output }}</small></p></section>
    </WingBlock>
  </PageLayout>
</template>
<style scoped>
.drawing-block { margin: 10px 0; }.scope-line { margin: 6px 0; font-size: .8rem; color: var(--muted); }.actions,.filter-row,.font-options,.generation-options,.file-head { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }.actions .el-button + .el-button { margin-left:0; }.filter-row { margin:12px 0; }.filter-row .el-input { flex:1; min-width:180px; }.filter-row .el-select { width:140px; }.font-options label,.generation-options label { display:flex; align-items:center; gap:6px; flex:1; min-width:210px; }.font-options .el-input,.generation-options .el-input,.generation-options .el-select { flex:1; min-width:120px; }.font-options,.generation-options { margin-bottom:8px; }.audit-file { margin:12px 0; }.file-head { padding:6px; background:var(--panel-head-bg); }.file-link { white-space:normal; text-align:left; height:auto; min-width:0; }.file-link :deep(span) { overflow-wrap:anywhere; }.table-scroll { overflow-x:auto; }table { width:100%; border-collapse:collapse; font-size:.8rem; }th,td { border:1px solid var(--border); padding:7px; text-align:left; vertical-align:top; }th { background:var(--panel-head-bg); }th:first-child { width:44px; }.value { white-space:pre-wrap; overflow-wrap:anywhere; min-width:120px; }small { display:block; color:var(--muted); font-size:.74rem; overflow-wrap:anywhere; } .empty { padding:18px; text-align:center; color:var(--muted); }.error { color:var(--phoenix-danger-text); white-space:pre-wrap; overflow-wrap:anywhere; }.warning { color:var(--phoenix-warning-text); }.job-result { border-top:1px solid var(--border); margin-top:12px; padding-top:6px; }details { font-size:.8rem; }
</style>
