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
import { category, visibleGalleryRows } from "./viewModel";

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell(), product = ref(""), query = ref(""), type = ref("");
const assemblies = ref(false), missing = ref(false), outputBusy = ref(false), outputError = ref(""), archived = ref("");
function consume() {
  const rel = props.workbenchTabId ? shell.consumeTabPayload(props.workbenchTabId)?.partGallery?.rel : undefined;
  if (rel) product.value = rel.replace(/^\.\//, "");
}
consume(); onActivated(consume);
const gallery = reactive(usePartGallery(shell.workspacePath, product));
const busy = computed(() => gallery.busy || outputBusy.value);
const visible = computed(() => visibleGalleryRows(gallery.result?.rows || [], query.value, type.value, assemblies.value, missing.value));
const ready = computed(() => visible.value.filter(row => row.status === "ready").length);
const stale = computed(() => gallery.result?.rows.some(row => row.status === "stale"));
const productOptions = computed(() => [{ value: "", label: "全库 FCStd" }, ...[...new Set([...gallery.options, ...(product.value ? [product.value] : [])])].map(rel => ({ value: rel, label: rel }))]);
const archiveOpen = ref(false), directory = ref("assets/thumbnails"), includeDocuments = ref(false);
const printOpen = ref(false), printHtml = ref(""), printReady = ref(false), printFrame = ref<HTMLIFrameElement | null>(null);
const printDownload = ref("");
watch(printHtml, html => {
  if (printDownload.value) URL.revokeObjectURL(printDownload.value);
  printDownload.value = html ? URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })) : "";
});
onBeforeUnmount(() => { if (printDownload.value) URL.revokeObjectURL(printDownload.value); });
const badImages = ref(new Set<string>());
watch([product, shell.workspacePath], () => { archived.value = ""; outputError.value = ""; archiveOpen.value = false; printOpen.value = false; printHtml.value = ""; badImages.value = new Set(); });
watch(() => gallery.result?.updated_at, () => { badImages.value = new Set(); });
usePageSession(props.workbenchTabId, {
  serialize: () => ({ product: product.value, query: query.value, type: type.value, assemblies: assemblies.value }),
  hydrate: state => { product.value = typeof state.product === "string" ? state.product : ""; query.value = String(state.query || ""); type.value = String(state.type || ""); assemblies.value = state.assemblies === true; return true; },
  isDirty: () => false, isBusy: () => busy.value, refresh: () => { if (!busy.value) void gallery.load(); },
});
async function preparePrint() {
  if (!visible.value.length || busy.value || stale.value) return;
  const ws = shell.workspacePath.value, scope = product.value; outputBusy.value = true; outputError.value = "";
  try {
    const response = await galleryDocument(ws, scope, visible.value.map(row => row.rel));
    if (ws !== shell.workspacePath.value || scope !== product.value) return;
    printHtml.value = response.html; printReady.value = false; printOpen.value = true;
  } catch (error) { if (ws === shell.workspacePath.value) outputError.value = String(error); }
  finally { outputBusy.value = false; }
}
async function archive() {
  if (busy.value || !ready.value || stale.value) return;
  const ws = shell.workspacePath.value, scope = product.value; outputBusy.value = true; outputError.value = "";
  try {
    const result = await archiveGallery(ws, { product: scope, rels: visible.value.map(row => row.rel), directory: directory.value, include_documents: includeDocuments.value });
    if (ws !== shell.workspacePath.value || scope !== product.value) return;
    archived.value = `${result.png_count} 张 PNG → ${result.directory}${result.skipped ? `；${result.skipped} 项缺图未导出` : ""}。${result.message}`;
    archiveOpen.value = false;
  } catch (error) { if (ws === shell.workspacePath.value) outputError.value = String(error); }
  finally { outputBusy.value = false; }
}
function print() { printFrame.value?.contentWindow?.focus(); printFrame.value?.contentWindow?.print(); }
usePagePrimaryContribution("part_gallery", props.workbenchTabId, {
  title: "零件图册", summary: computed(() => gallery.job?.message || "全库图片缓存，按产品查看与打印"),
  sections: [cadBatchToolsSection(shell, "part_gallery"), {
    id: "gallery-product", title: "产品范围", controls: [{ id: "product", kind: "select", label: "总成", placeholder: "全库 FCStd", modelValue: product, options: productOptions, disabled: busy, onUpdate: value => { product.value = value; } }],
    description: "选择总成后沿文件引用展开。全库范围使用现有 CAD 索引。", actions: [{ id: "update", label: "更新缩略图", tone: "primary", disabled: computed(() => busy.value || !shell.workspacePath.value), run: gallery.update }],
    progress: computed<PagePrimaryProgress>(() => ({ label: "缩略图缓存", state: gallery.job?.state === "attention" ? "warning" : gallery.job?.state || (gallery.requesting ? "running" : "idle"), completed: gallery.job?.completed || 0, total: gallery.job?.total || 0, detail: gallery.job?.current_rel || gallery.job?.message || "只读 CAD，图片和元数据按文件变化更新" })),
  }, { id: "gallery-output", title: "打印与归档", actions: [{ id: "print", label: "A4 打印 / PDF", disabled: computed(() => busy.value || !visible.value.length || !!stale.value), run: preparePrint }, { id: "archive", label: "归档 PNG", disabled: computed(() => busy.value || !ready.value || !!stale.value), run: () => { archiveOpen.value = true; } }], description: "打印当前筛选的卡片，不写文档。\nGit 归档默认只有 PNG。\n是否归档图册文档，由你选择。" },
  { id: "gallery-help", title: "使用说明", description: "图片来自 FCStd 最后保存的内嵌缩略图。\n名称优先用源文件 PartName。\n文件去重，不代表采购数量。\n只更新本地缓存，不修改 CAD 或自动提交 Git。" }],
});
</script>
<template>
  <PageLayout title="零件图册" class="desk-page-layout">
    <template #header><PageHeader title="零件图册">
      <template #center><el-input v-model="query" clearable size="small" placeholder="搜索零件号 / 名称 / 文件名" aria-label="搜索图册" /></template>
      <template #right><el-button size="small" :disabled="busy || !shell.workspacePath.value" @click="gallery.update">更新缩略图</el-button><el-button size="small" :disabled="busy || !visible.length || stale" @click="preparePrint">A4 打印 / PDF</el-button><el-button size="small" :disabled="busy || !ready || stale" @click="archiveOpen = true">归档 PNG</el-button></template>
    </PageHeader></template>
    <div class="scope-bar"><el-select v-model="product" filterable :empty-values="[null, undefined]" :disabled="busy" aria-label="产品总成" placeholder="选择产品总成"><el-option v-for="option in productOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select><span class="muted">显示 {{ visible.length }} / {{ gallery.result?.rows.length || 0 }} 个文件 · {{ ready }} 张图片</span></div>
    <div class="filters"><el-radio-group v-model="type" size="small"><el-radio-button value="">全部</el-radio-button><el-radio-button value="H">自制 / 一般件</el-radio-button><el-radio-button value="S">标准件</el-radio-button><el-radio-button value="R">虚拟件</el-radio-button></el-radio-group><el-checkbox v-model="assemblies">含总成</el-checkbox><el-checkbox v-model="missing">仅缺图 / 异常</el-checkbox></div>
    <p v-if="gallery.error || outputError" role="alert" class="notice error">{{ gallery.error || outputError }}</p>
    <p v-if="archived" role="status" class="notice">{{ archived }}</p>
    <p v-if="gallery.job" role="status" class="muted">{{ gallery.job.message }}</p>
    <p v-if="!gallery.result?.updated_at && !gallery.busy" class="empty">选择产品或全库，点击「更新缩略图」。仅提取源文件已有图片，不启动 FreeCAD。</p>
    <p v-else-if="!visible.length && !gallery.busy" class="empty">当前筛选没有卡片。</p>
    <div class="cards" aria-label="零件卡片">
      <article v-for="row in visible" :key="row.rel" class="card">
        <a class="picture" :href="`?page=file_detail&rel=${encodeURIComponent(row.rel)}`" :title="row.rel" @click.exact.prevent="shell.openFileDetailForRel(row.rel)"><img v-if="row.status === 'ready' && !badImages.has(row.rel)" :src="thumbnailUrl(shell.workspacePath.value, row)" :alt="row.part_name" loading="lazy" @error="badImages.add(row.rel)" /><span v-else class="placeholder">{{ row.status === 'stale' ? '需要更新缩略图' : row.status === 'error' || badImages.has(row.rel) ? '图片不可用' : '缺少缩略图' }}</span></a>
        <div class="card-meta"><span>{{ category(row.type_code) }}</span><span v-if="row.role === 'assembly'">总成</span><span v-else-if="row.width">{{ row.width }} × {{ row.height }}</span></div>
        <div class="number">{{ [row.part_number, row.part_version].filter(Boolean).join('.') || '编号未设定' }}</div>
        <div class="part-name">{{ row.part_name }}</div><div v-if="row.status !== 'ready'" class="card-warning">{{ row.message }}</div>
        <a class="file" :title="row.rel" :href="`?page=file_detail&rel=${encodeURIComponent(row.rel)}`" @click.exact.prevent="shell.openFileDetailForRel(row.rel)">{{ row.rel.split('/').pop() }}</a>
      </article>
    </div>
    <details v-if="gallery.result?.issues.length" class="issues"><summary>读取提示（{{ gallery.result.issues.length }}）</summary><p v-for="(issue, index) in gallery.result.issues" :key="index">{{ issue.rel }}：{{ issue.message }}</p></details>
    <el-dialog v-model="archiveOpen" title="归档缩略图 PNG" width="560px" :close-on-click-modal="!outputBusy" :close-on-press-escape="!outputBusy" :show-close="!outputBusy">
      <p>将当前筛选中的 {{ ready }} 张 PNG 保存为「目录 / 源文件第一级目录 / 同名.png」，不附加时间。相同图片复用；已登记图片更新前备份，同名冲突不覆盖。网页优先复用有效 PNG，不自动提交 Git。</p>
      <label class="field-label">Git 内目录（相对工作空间）<el-input v-model="directory" :disabled="outputBusy" placeholder="assets/thumbnails" /></label>
      <el-checkbox v-model="includeDocuments" :disabled="outputBusy">同时归档图册文档（HTML + JSON，默认不选）</el-checkbox>
      <p v-if="outputError" role="alert" class="error">{{ outputError }}</p>
      <template #footer><el-button :disabled="outputBusy" @click="archiveOpen = false">取消</el-button><el-button type="primary" :loading="outputBusy" @click="archive">确认导出</el-button></template>
    </el-dialog>
    <el-dialog v-model="printOpen" title="A4 图册预览" width="min(960px, 95vw)" destroy-on-close>
      <p class="muted">当前筛选 · 每页三列四行。选择 A4、关闭浏览器页眉页脚。内嵌浏览器未弹出打印窗口时，可下载打印页，在系统浏览器中打开后另存 PDF。</p>
      <iframe ref="printFrame" class="print-preview" :srcdoc="printHtml" title="A4 零件图册" sandbox="allow-same-origin allow-modals" @load="printReady = true" />
      <template #footer><a v-if="printDownload" :href="printDownload" download="part-gallery.html" class="print-download">下载打印页</a><el-button @click="printOpen = false">关闭</el-button><el-button type="primary" :disabled="!printReady" @click="print">打印 / 另存 PDF</el-button></template>
    </el-dialog>
  </PageLayout>
</template>
<style scoped>
.print-download{margin-right:16px;color:var(--phoenix-accent);font-size:.85rem}
.scope-bar,.filters{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:10px 0}.scope-bar .el-select{flex:1;min-width:200px;max-width:600px}.filters{margin-bottom:18px}.muted{color:var(--muted);font-size:.8rem}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding-bottom:20px}.card{border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--panel-bg);min-width:0}.picture{height:160px;background:var(--panel-head-bg);border-radius:5px;display:flex;align-items:center;justify-content:center;overflow:hidden}.picture img{max-width:100%;max-height:100%;object-fit:contain}.placeholder{font-size:.85rem;color:var(--muted)}.card-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:.72rem;margin-top:10px}.number{font-weight:700;font-size:1rem;margin-top:6px}.part-name{font-size:.95rem;margin-top:5px;overflow-wrap:anywhere;line-height:1.4}.file{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--phoenix-accent);font-size:.72rem;margin-top:9px}.notice{padding:10px;background:var(--phoenix-accent-soft);font-size:.82rem;overflow-wrap:anywhere}.error,.card-warning{color:var(--phoenix-danger-text)}.card-warning{font-size:.75rem;margin-top:5px}.empty{padding:40px 8px;text-align:center;color:var(--muted)}.field-label{display:grid;gap:8px;margin:18px 0}.print-preview{width:100%;height:65vh;border:1px solid var(--border);background:white}.issues{font-size:.8rem;overflow-wrap:anywhere;margin:12px 0}
</style>
