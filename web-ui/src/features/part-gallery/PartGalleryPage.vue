<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, reactive, ref, watch } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import { useAppShell } from "../../composables/useAppShell";
import { usePagePrimaryContribution, type PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import { usePageSession } from "../../composables/usePageSession";
import { cadBatchToolsSection } from "../../composables/cadBatchTools";
import { archiveGallery, galleryDocument, thumbnailUrl } from "./api";
import { usePartGallery } from "./usePartGallery";
import { boundingBoxText, boundingBoxTitle, category, visibleGalleryRows } from "./viewModel";
import { useBatchTaskCollection } from "../batch-tasks/collection";

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell(), product = ref(""), query = ref(""), type = ref("");
const assemblies = ref(false), missing = ref(false), filenames = ref(false), outputBusy = ref(false), outputError = ref(""), archived = ref("");
const categories = ref(true), dimensions = ref(true), partNumbers = ref(true);
function consume() {
  const rel = props.workbenchTabId ? shell.consumeTabPayload(props.workbenchTabId)?.partGallery?.rel : undefined;
  if (rel) product.value = rel.replace(/^\.\//, "");
}
consume();
const gallery = reactive(usePartGallery(shell.workspacePath, product, shell.appendLog));
onActivated(() => { consume(); void gallery.load(); });
const busy = computed(() => gallery.busy || outputBusy.value);
const scopePending = computed(() => gallery.result?.scope_pending === true);
const scopeNotice = computed(() => `当前范围待确认，已隐藏${Math.max(0, gallery.result?.removed_count || 0)}个旧成员；请更新图片缓存`);
const visible = computed(() => visibleGalleryRows(gallery.result?.rows || [], query.value, type.value, assemblies.value, missing.value));
const batchCollection = useBatchTaskCollection();
const batchCollectionCount = computed(() => batchCollection.pathsFor(shell.workspacePath.value).length);
const batchNotice = ref("");
watch(shell.workspacePath, () => { batchNotice.value = ""; });
function addVisibleToBatch() {
  if (busy.value || scopePending.value || !visible.value.length) return;
  try {
    const result = batchCollection.add(shell.workspacePath.value, visible.value.map(row => row.rel));
    batchNotice.value = `本次加入 ${result.added} 个，重复 ${result.duplicates} 个；待选共 ${result.total} 个文件，尚未保存或执行。`;
    shell.setStatus(batchNotice.value);
  } catch (cause) {
    batchNotice.value = cause instanceof Error ? cause.message : String(cause);
    shell.appendLog(`[批次待选] ${batchNotice.value}`, { source: "batch_tasks", open: true });
  }
}
const ready = computed(() => visible.value.filter(row => row.status === "ready").length);
const stale = computed(() => gallery.result?.rows.some(row => row.status === "stale"));
const productOptions = computed(() => [{ value: "", label: "全库 FCStd" }, ...[...new Set([...gallery.options, ...(product.value ? [product.value] : [])])].map(rel => ({ value: rel, label: rel }))]);
const archiveOpen = ref(false), directory = ref("assets/thumbnails"), includeDocuments = ref(false);
const printOpen = ref(false), printHtml = ref(""), printReady = ref(false), printFrame = ref<HTMLIFrameElement | null>(null);
const printDownload = ref("");
watch([() => gallery.result, scopePending], ([result, pending]) => {
  if (!result || pending) { archiveOpen.value = false; printOpen.value = false; printHtml.value = ""; printReady.value = false; }
});
watch(printHtml, html => {
  if (printDownload.value) URL.revokeObjectURL(printDownload.value);
  printDownload.value = html ? URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })) : "";
});
onBeforeUnmount(() => { if (printDownload.value) URL.revokeObjectURL(printDownload.value); });
const badImages = ref(new Set<string>());
watch([product, shell.workspacePath], () => { archived.value = ""; outputError.value = ""; archiveOpen.value = false; printOpen.value = false; printHtml.value = ""; badImages.value = new Set(); });
watch(() => gallery.result?.updated_at, () => { badImages.value = new Set(); });
usePageSession(props.workbenchTabId, {
  serialize: () => ({ product: product.value, query: query.value, type: type.value, assemblies: assemblies.value, filenames: filenames.value, categories: categories.value, dimensions: dimensions.value, partNumbers: partNumbers.value }),
  hydrate: state => { product.value = typeof state.product === "string" ? state.product : ""; query.value = String(state.query || ""); type.value = String(state.type || ""); assemblies.value = state.assemblies === true; filenames.value = state.filenames === true; categories.value = state.categories !== false; dimensions.value = state.dimensions !== false; partNumbers.value = state.partNumbers !== false; return true; },
  isDirty: () => false, isBusy: () => busy.value, refresh: () => { if (!busy.value) void gallery.load(); },
});
async function preparePrint() {
  if (!visible.value.length || busy.value || stale.value || scopePending.value) return;
  const ws = shell.workspacePath.value, scope = product.value; outputBusy.value = true; outputError.value = "";
  try {
    const response = await galleryDocument(ws, scope, visible.value.map(row => row.rel), { showCategory: categories.value, showDimensions: dimensions.value, showPartNumber: partNumbers.value, showFilenames: filenames.value });
    if (ws !== shell.workspacePath.value || scope !== product.value || !gallery.result || gallery.error || scopePending.value) return;
    printHtml.value = response.html; printReady.value = false; printOpen.value = true;
  } catch (error) { if (ws === shell.workspacePath.value && scope === product.value) outputError.value = String(error); }
  finally { outputBusy.value = false; }
}
async function archive() {
  if (busy.value || !ready.value || stale.value || scopePending.value) return;
  const ws = shell.workspacePath.value, scope = product.value; outputBusy.value = true; outputError.value = "";
  try {
    const result = await archiveGallery(ws, { product: scope, rels: visible.value.map(row => row.rel), directory: directory.value, include_documents: includeDocuments.value });
    if (ws !== shell.workspacePath.value || scope !== product.value) return;
    archived.value = `${result.png_count} 张 PNG → ${result.directory}${result.skipped ? `；${result.skipped} 项缺图未导出` : ""}。${result.message}`;
    archiveOpen.value = false;
  } catch (error) { if (ws === shell.workspacePath.value && scope === product.value) outputError.value = String(error); }
  finally { outputBusy.value = false; }
}
function print() { if (!gallery.result || gallery.error || scopePending.value) return; printFrame.value?.contentWindow?.focus(); printFrame.value?.contentWindow?.print(); }
usePagePrimaryContribution("part_gallery", props.workbenchTabId, {
  title: "零件图册", summary: computed(() => gallery.job?.message || "全库图片缓存，按产品查看与打印"),
  sections: [cadBatchToolsSection(shell, "part_gallery"), {
    id: "gallery-product", title: "产品范围", controls: [{ id: "product", kind: "select", label: "总成", placeholder: "全库 FCStd", modelValue: product, options: productOptions, disabled: busy, onUpdate: value => { product.value = value; } }],
    description: computed(() => `${scopePending.value ? scopeNotice.value + "。\n" : ""}选择总成后沿文件引用展开。全库范围使用现有 CAD 索引。更新图片缓存只提取 FCStd ZIP 内嵌图片，不启动 FreeCAD；更新尺寸会启动 FreeCAD 只读测量。`), actions: [{ id: "update", label: "更新图片缓存", tone: "primary", disabled: computed(() => busy.value || !shell.workspacePath.value), run: gallery.update }, { id: "cancel-cache", label: "取消当前缓存任务", disabled: computed(() => !gallery.canCancel), loading: computed(() => gallery.cancelling), run: gallery.cancel }, { id: "update-dimensions", label: "更新尺寸", disabled: computed(() => busy.value || !shell.workspacePath.value), run: gallery.updateDimensions }],
    progress: computed<PagePrimaryProgress>(() => ({ label: gallery.jobKind === "dimensions" ? "边界盒尺寸" : "缩略图缓存", state: gallery.job?.state === "attention" ? "warning" : gallery.job?.state || (gallery.requesting ? "running" : "idle"), completed: gallery.job?.completed || 0, total: gallery.job?.total || 0, detail: gallery.job?.current_rel || gallery.job?.message || "只读 CAD，图片和尺寸使用独立缓存" })),
  }, { id: "gallery-output", title: "打印与归档", actions: [{ id: "print", label: "A4 打印 / PDF", disabled: computed(() => busy.value || !visible.value.length || !!stale.value || scopePending.value), run: preparePrint }, { id: "archive", label: "归档 PNG", disabled: computed(() => busy.value || !ready.value || !!stale.value || scopePending.value), run: () => { if (!scopePending.value) archiveOpen.value = true; } }], description: "打印当前筛选的卡片，不写文档。\nGit 归档默认只有 PNG。\n是否归档图册文档，由你选择。" },
  { id: "gallery-help", title: "使用说明", description: "「更新图片缓存」优先复用缓存，否则提取 FCStd ZIP 内嵌缩略图，不启动 FreeCAD。\n需要重新生成配色、轴测图与 Fit 缩略图时，请到单件文件详情操作；该操作会先备份，再写入 FCStd 缩略图。\n尺寸需点击「更新尺寸」，显示零件或总成的文档 X / Y / Z 几何外包络（mm），不是图片像素或加工公差。总成读取已保存/恢复的实例状态，不切换 Rigid、不求解；缺失引用不输出完整尺寸。\n名称优先用源文件 PartName。\n文件去重，不代表采购数量。\n本页只更新本地缓存，不修改 CAD 或自动提交 Git。" }],
});
</script>
<template>
  <PageLayout title="零件图册" class="desk-page-layout">
    <template #header><PageHeader title="零件图册">
      <template #center><el-input v-model="query" clearable size="small" placeholder="搜索零件号 / 名称 / 文件名" aria-label="搜索图册" /></template>
      <template #right><el-button size="small" :disabled="busy || !shell.workspacePath.value" @click="gallery.update">更新图片缓存</el-button><el-button size="small" :disabled="!gallery.canCancel" :loading="gallery.cancelling" @click="gallery.cancel">取消当前缓存任务</el-button><el-button size="small" :disabled="busy || !shell.workspacePath.value" @click="gallery.updateDimensions">更新尺寸</el-button><el-button size="small" :disabled="busy || !visible.length || stale || scopePending" @click="preparePrint">A4 打印 / PDF</el-button><el-button size="small" :disabled="busy || !ready || stale || scopePending" @click="archiveOpen = true">归档 PNG</el-button></template>
    </PageHeader></template>
    <div class="scope-bar"><el-select v-model="product" filterable :empty-values="[null, undefined]" :disabled="busy" aria-label="产品总成" placeholder="选择产品总成"><el-option v-for="option in productOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select><span class="muted">显示 {{ visible.length }} / {{ gallery.result?.rows.length || 0 }} 个文件 · {{ ready }} 张图片</span><el-button size="small" :disabled="busy || !visible.length || scopePending" @click="addVisibleToBatch">加入批次（{{ visible.length }}）</el-button><el-button v-if="batchCollectionCount" size="small" @click="shell.goToPage('batch_tasks')">打开批量任务 · 待选 {{ batchCollectionCount }}</el-button></div>
    <div class="filters"><el-radio-group v-model="type" size="small"><el-radio-button value="">全部</el-radio-button><el-radio-button value="H">一般件</el-radio-button><el-radio-button value="S">标准件</el-radio-button><el-radio-button value="R">虚拟件</el-radio-button></el-radio-group><el-checkbox v-model="assemblies">含总成</el-checkbox><el-checkbox v-model="missing">仅缺图 / 异常</el-checkbox><el-checkbox v-model="categories">显示标签</el-checkbox><el-checkbox v-model="dimensions">显示尺寸</el-checkbox><el-checkbox v-model="partNumbers">显示零件号</el-checkbox><el-checkbox v-model="filenames">显示文件名</el-checkbox></div>
    <p v-if="gallery.error || outputError" role="alert" class="notice error">{{ gallery.error || outputError }}</p>
    <p v-if="scopePending" role="status" class="muted">{{ scopeNotice }}</p>
    <p v-if="archived" role="status" class="notice">{{ archived }}</p>
    <p v-if="batchNotice" role="status" class="notice">{{ batchNotice }}</p>
    <p v-if="gallery.job" role="status" class="muted">{{ gallery.job.message }}</p>
    <p v-if="!gallery.result?.updated_at && !gallery.busy" class="empty">选择产品或全库，点击「更新图片缓存」读取已有图片，不启动 FreeCAD；点击「更新尺寸」才启动 FreeCAD 只读测量边界盒。</p>
    <p v-else-if="!visible.length && !gallery.busy" class="empty">当前筛选没有卡片。</p>
    <div class="cards" aria-label="零件卡片">
      <article v-for="row in visible" :key="row.rel" class="card">
        <a class="picture" :href="`?page=file_detail&rel=${encodeURIComponent(row.rel)}`" :title="row.rel" @click.exact.prevent="shell.openFileDetailForRel(row.rel)">
          <span v-if="categories" class="card-badges"><span>{{ category(row.type_code) }}</span><span v-if="row.role === 'assembly'">总成</span></span>
          <img v-if="row.status === 'ready' && !badImages.has(row.rel)" :src="thumbnailUrl(shell.workspacePath.value, row)" :alt="row.part_name" loading="lazy" @error="badImages.add(row.rel)" />
          <span v-else class="placeholder">{{ row.status === 'stale' ? '需要更新图片缓存' : row.status === 'error' || badImages.has(row.rel) ? '图片不可用' : '缺少缩略图' }}</span>
          <span v-if="dimensions" class="dimensions" :title="boundingBoxTitle(row)">{{ boundingBoxText(row) }}</span>
        </a>
        <div class="card-identity"><div v-if="partNumbers" class="number">{{ [row.part_number, row.part_version].filter(Boolean).join('.') || '编号未设定' }}</div><div class="part-name">{{ row.part_name }}</div></div>
        <div v-if="row.status !== 'ready'" class="card-warning">{{ row.message }}</div>
        <a v-if="filenames" class="file" :title="row.rel" :href="`?page=file_detail&rel=${encodeURIComponent(row.rel)}`" @click.exact.prevent="shell.openFileDetailForRel(row.rel)">{{ row.rel.split('/').pop() }}</a>
      </article>
    </div>
    <details v-if="gallery.result?.issues.length" class="issues"><summary>读取提示（{{ gallery.result.issues.length }}）</summary><p v-for="(issue, index) in gallery.result.issues" :key="index">{{ issue.rel }}：{{ issue.message }}</p></details>
    <el-dialog v-model="archiveOpen" title="归档缩略图 PNG" width="560px" :close-on-click-modal="!outputBusy" :close-on-press-escape="!outputBusy" :show-close="!outputBusy">
      <p>将当前筛选中的 {{ ready }} 张 PNG 保存为「目录 / 源文件第一级目录 / 同名.png」，不附加时间。相同图片复用；已登记图片更新前备份，同名冲突不覆盖。网页优先复用有效 PNG，不自动提交 Git。</p>
      <label class="field-label">Git 内目录（相对工作空间）<el-input v-model="directory" :disabled="outputBusy" placeholder="assets/thumbnails" /></label>
      <el-checkbox v-model="includeDocuments" :disabled="outputBusy">同时归档图册文档（HTML + JSON，默认不选）</el-checkbox>
      <p v-if="outputError" role="alert" class="error">{{ outputError }}</p>
      <template #footer><el-button :disabled="outputBusy" @click="archiveOpen = false">取消</el-button><el-button type="primary" :loading="outputBusy" :disabled="scopePending" @click="archive">确认导出</el-button></template>
    </el-dialog>
    <el-dialog v-model="printOpen" title="A4 图册预览" width="min(960px, 95vw)" destroy-on-close>
      <p class="muted">当前筛选与显示选项 · 每页四列五行。选择 A4、关闭浏览器页眉页脚。内嵌浏览器未弹出打印窗口时，可下载打印页，在系统浏览器中打开后另存 PDF。</p>
      <iframe ref="printFrame" class="print-preview" :srcdoc="printHtml" title="A4 零件图册" sandbox="allow-same-origin allow-modals" @load="printReady = true" />
      <template #footer><a v-if="printDownload && gallery.result && !gallery.error && !scopePending" :href="printDownload" download="part-gallery.html" class="print-download">下载打印页</a><el-button @click="printOpen = false">关闭</el-button><el-button type="primary" :disabled="!printReady || !gallery.result || !!gallery.error || scopePending" @click="print">打印 / 另存 PDF</el-button></template>
    </el-dialog>
  </PageLayout>
</template>
<style scoped>
.print-download{margin-right:16px;color:var(--phoenix-accent);font-size:.85rem}
.scope-bar,.filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0}.scope-bar .el-select{flex:1;min-width:200px;max-width:600px}.filters{margin-bottom:18px}.muted{color:var(--muted);font-size:.8rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,176px),1fr));gap:10px;padding-bottom:20px}
.card{border:1px solid var(--border);border-radius:7px;padding:8px;background:var(--panel-bg);min-width:0;break-inside:avoid}
.picture{position:relative;isolation:isolate;height:160px;padding:3px;box-sizing:border-box;background:var(--panel-head-bg);border-radius:4px;display:flex;align-items:center;justify-content:center;overflow:hidden;text-decoration:none}
.picture img{width:100%;height:100%;object-fit:contain}
.card-badges{position:absolute;z-index:1;top:5px;left:5px;max-width:calc(100% - 10px);display:flex;align-items:center;gap:4px;color:var(--muted);font-size:.65rem;line-height:1.3;pointer-events:none}
.card-badges span{padding:1px 5px;border:1px solid var(--border);border-radius:3px;background:var(--panel-head-bg);white-space:nowrap}
.dimensions{padding:2px 5px;border-radius:3px;background:var(--panel-bg);background:color-mix(in srgb,var(--panel-bg) 90%,transparent)}
.dimensions{position:absolute;right:5px;bottom:5px;max-width:calc(100% - 10px);box-sizing:border-box;color:var(--muted);font-size:.65rem;line-height:1.25;text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.placeholder{font-size:.78rem;color:var(--muted);text-align:center}
.card-identity{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;margin-top:7px}
.number{font-weight:700;font-size:.95rem;max-width:100%;overflow-wrap:anywhere}
.part-name{font-size:.85rem;min-width:0;max-width:100%;overflow-wrap:anywhere;line-height:1.35}
.file{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--phoenix-accent);font-size:.67rem;margin-top:5px}
.notice{padding:10px;background:var(--phoenix-accent-soft);font-size:.82rem;overflow-wrap:anywhere}.error,.card-warning{color:var(--phoenix-danger-text)}.card-warning{font-size:.75rem;margin-top:5px}.empty{padding:40px 8px;text-align:center;color:var(--muted)}.field-label{display:grid;gap:8px;margin:18px 0}.print-preview{width:100%;height:65vh;border:1px solid var(--border);background:white}.issues{font-size:.8rem;overflow-wrap:anywhere;margin:12px 0}
@media print{.cards{grid-template-columns:repeat(3,minmax(0,1fr));gap:3mm}.card{box-shadow:none}.picture{height:36mm}.card-badges span,.dimensions{background:var(--panel-bg)}}
</style>
