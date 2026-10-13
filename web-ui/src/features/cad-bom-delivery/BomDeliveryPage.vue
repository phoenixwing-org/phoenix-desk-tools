<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, reactive, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import { usePageSession } from "../../composables/usePageSession";
import { usePagePrimaryContribution, type PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import { useCadBomDelivery } from "./useCadBomDelivery";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell(), activated = ref(true);
const active = computed(() => activated.value && (!props.workbenchTabId || shell.activeTabId.value === props.workbenchTabId));
onActivated(() => { activated.value = true; });
onDeactivated(() => { activated.value = false; });
const delivery = reactive(useCadBomDelivery(shell.workspacePath, {
  appendLog: shell.appendLog,
  confirmExport: async message => (await pnwPromptChoice({ title: "确认离线 BOM 导出", message, defaultChoiceId: "cancel", choices: [{ id: "export", label: "确认导出（不覆盖）", variant: "primary" }, { id: "cancel", label: "取消" }] })).choiceId === "export",
}, active));
const expanded = reactive({ preflight: true });
const collapseByWorkspace = new Map<string, typeof expanded>();
watch(shell.workspacePath, (workspace, previous) => {
  collapseByWorkspace.set(previous, { preflight: expanded.preflight });
  Object.assign(expanded, collapseByWorkspace.get(workspace) ?? { preflight: true });
}, { flush: "sync" });
const dataTab = ref<"boms" | "parts">("boms"), bomPage = ref(1), itemPage = ref(1), partPage = ref(1), selectedBom = ref(0);
const pageSize = 50;
const boms = computed(() => delivery.preview?.envelope.boms ?? []), parts = computed(() => delivery.preview?.envelope.parts ?? []);
const bomPages = computed(() => Math.max(1, Math.ceil(boms.value.length / pageSize))), partPages = computed(() => Math.max(1, Math.ceil(parts.value.length / pageSize)));
const visibleBoms = computed(() => boms.value.slice((bomPage.value - 1) * pageSize, bomPage.value * pageSize));
const currentBom = computed(() => boms.value[selectedBom.value]);
const itemPages = computed(() => Math.max(1, Math.ceil((currentBom.value?.items.length ?? 0) / pageSize)));
const visibleItems = computed(() => currentBom.value?.items.slice((itemPage.value - 1) * pageSize, itemPage.value * pageSize) ?? []);
const visibleParts = computed(() => parts.value.slice((partPage.value - 1) * pageSize, partPage.value * pageSize));
watch(() => delivery.preview, () => { bomPage.value = itemPage.value = partPage.value = 1; selectedBom.value = 0; });
function browseBom(index: number) { selectedBom.value = index; itemPage.value = 1; }
const stateLabel = computed(() => ({ idle: "待预览", ready: "预检通过", expired: "预览已到期", published: "已发布", failed: "需处理", cancelled: "已取消", unconfirmed: "结果未确认" })[delivery.status]);
const progress = computed<PagePrimaryProgress>(() => ({ label: "离线交付", state: delivery.busy ? "running" : delivery.status === "published" ? delivery.receipt?.warnings.length || delivery.receipt?.directorySync === "failed" ? "warning" : "done" : delivery.status === "failed" ? "failed" : delivery.status === "cancelled" ? "cancelled" : delivery.status === "unconfirmed" || delivery.status === "expired" ? "warning" : "idle", stages: ["预检", "确认", "导出"], activeStage: delivery.phase === "exporting" ? 2 : delivery.phase === "confirming" ? 1 : 0, detail: delivery.error || stateLabel.value }));
usePagePrimaryContribution("bom_delivery", props.workbenchTabId, {
  title: "BOM 离线导出", showContext: false, summary: computed(() => delivery.error || "整个工作空间 → 只读预检 → 确认离线导出"),
  sections: [{ id: "scope", title: "预检与导出", progress, controls: [
    { id: "workspace", kind: "readonly", label: "范围", value: computed(() => `整个工作空间：${shell.workspacePath.value}`), mono: true },
    { id: "counts", kind: "readonly", label: "预览", value: computed(() => `${delivery.counts.parts} 零件 · ${delivery.counts.boms} 直接 BOM · ${delivery.counts.items} 直接行`) },
  ], actions: [
    { id: "preview", label: "预检预览", disabled: computed(() => !delivery.canPreview), loading: computed(() => delivery.phase === "previewing"), run: delivery.runPreview },
    { id: "export", label: "确认导出", tone: "primary", disabled: computed(() => !delivery.canExport), loading: computed(() => delivery.phase === "exporting"), run: delivery.runExport },
    { id: "cancel", label: "取消 / 释放预览", disabled: computed(() => !delivery.busy && !delivery.preview), run: delivery.cancel },
    { id: "index", label: "打开 CAD 索引", run: () => { shell.openTab({ pageId: "cad_index" }); } },
  ] }, { id: "help", title: "说明", description: "只导出当前工作空间的完整索引，不做产品或文件筛选。预检不扫描、不修改 CAD；索引缺失、部分可用或过期时请先更新 CAD 索引。直接数量不是递归展开数量。\n默认写入 .phoenix/outbox；自选目录须已存在。不覆盖不同内容、不自动联网。取消或失联时可能已发布，需核对目标。" }],
});
function hydrateSettings(snapshot: Record<string, unknown>): boolean {
  if (snapshot.workspace !== shell.workspacePath.value) return false;
  if (delivery.preview || delivery.busy) delivery.cancel();
  delivery.targetSetting = typeof snapshot.target === "string" ? snapshot.target : "";
  delivery.directorySetting = typeof snapshot.directory === "string" ? snapshot.directory : "";
  const saved = snapshot.expanded && typeof snapshot.expanded === "object" ? snapshot.expanded as Record<string, unknown> : {};
  // Legacy push/history settings are deliberately ignored, like volatile handles.
  expanded.preflight = typeof saved.preflight === "boolean" ? saved.preflight : true;
  return true;
}
usePageSession(props.workbenchTabId, {
  serialize: () => ({ workspace: shell.workspacePath.value, target: delivery.targetSetting, directory: delivery.directorySetting, expanded: { preflight: expanded.preflight } }),
  hydrate: hydrateSettings, isDirty: () => false, isBusy: () => delivery.busy, refresh: delivery.cancel,
});
onMounted(() => {
  if (!props.workbenchTabId) return;
  const settings = shell.consumeTabPageState(props.workbenchTabId);
  if (settings) hydrateSettings(settings);
});
watch(() => [delivery.targetSetting, delivery.directorySetting, ...Object.values(expanded)], () => shell.scheduleWorkbenchSave(), { deep: true });
</script>
<template>
  <PageLayout title="BOM 离线导出" class="desk-page-layout bom-delivery-page">
    <template #header><PageHeader title="BOM 离线导出"><template #right>
      <el-button size="small" :disabled="!delivery.canPreview" :loading="delivery.phase === 'previewing'" @click="delivery.runPreview">预检预览</el-button>
      <el-button size="small" type="primary" :disabled="!delivery.canExport" :loading="delivery.phase === 'exporting'" @click="delivery.runExport">确认导出</el-button>
      <el-button size="small" :disabled="!delivery.busy && !delivery.preview" @click="delivery.cancel">取消</el-button>
    </template></PageHeader></template>
    <WingBlock v-model:expanded="expanded.preflight" title="1. 预检与导出" variant="card" class="delivery-block">
      <template #suffix>{{ stateLabel }}</template>
      <template #actions>
        <el-button size="small" :disabled="!delivery.canPreview" :loading="delivery.phase === 'previewing'" @click="delivery.runPreview">预检预览</el-button>
        <el-button size="small" type="primary" :disabled="!delivery.canExport" :loading="delivery.phase === 'exporting'" @click="delivery.runExport">确认导出</el-button>
        <el-button size="small" :disabled="!delivery.busy && !delivery.preview" @click="delivery.cancel">取消</el-button>
      </template>
      <p class="scope">整个工作空间：<code>{{ shell.workspacePath.value }}</code></p>
      <p class="muted">不自动扫描或创建目录。预检要求完整且新鲜的 CAD 索引；部分可用索引不能交付。只修改离线 JSON，不修改 CAD。</p>
      <div class="target-row"><label for="bom-delivery-target">输出 JSON</label><input id="bom-delivery-target" :value="delivery.targetPath" :disabled="delivery.busy" placeholder="预览后提供默认绝对路径；也可手工填写" @input="delivery.targetSetting = ($event.target as HTMLInputElement).value" /><el-button size="small" :disabled="!delivery.canPreview" @click="delivery.chooseDirectory">选择输出文件夹…</el-button></div>
      <small>默认 {{ delivery.directorySetting || '.phoenix/outbox' }}；自选目录须已存在，不自动递归创建。不覆盖已有不同内容，相同原字节可返回“已存在”。</small>
      <p v-if="delivery.targetPath && !delivery.targetValid" role="alert" class="notice error">输出路径必须是绝对路径，以 .json 结尾，且不能包含 . 或 .. 路径段。</p>
      <p v-if="delivery.error" role="alert" class="notice error">{{ delivery.error }}</p>
      <p v-if="delivery.expired" class="notice">预览已失效，必须重新预览。不会自动重复导出。</p>
      <p v-if="!delivery.preview" class="empty">点击“预检预览”读取整个工作空间的离线导出快照；不自动联网。</p>
      <template v-else>
        <dl class="metadata"><dt>交付 ID</dt><dd>{{ delivery.preview.envelope.transferId }}</dd><dt>载荷哈希</dt><dd>{{ delivery.preview.envelope.payloadHash }}</dd><dt>生产者</dt><dd>phoenix-desk-tools {{ delivery.preview.envelope.producer.version }}</dd><dt>扫描</dt><dd>{{ delivery.preview.envelope.workspace.scanId }} · {{ delivery.preview.envelope.workspace.scannedAt }}</dd><dt>预览到期</dt><dd>{{ delivery.preview.expires_at }}</dd><dt>载荷</dt><dd>{{ delivery.preview.bytes }} bytes · {{ delivery.counts.parts }} 零件 · {{ delivery.counts.boms }} 直接 BOM · {{ delivery.counts.items }} 直接行</dd></dl>
        <div class="actions"><el-button size="small" :disabled="!delivery.canExport" type="primary" @click="delivery.runExport">确认导出</el-button><el-button size="small" :disabled="!delivery.canPreview" @click="delivery.runPreview">重新预览</el-button><el-button size="small" @click="delivery.cancel">释放预览</el-button></div>
        <div class="data-tabs" role="tablist" aria-label="交付数据浏览"><button role="tab" :aria-selected="dataTab === 'boms'" @click="dataTab = 'boms'">直接 BOM</button><button role="tab" :aria-selected="dataTab === 'parts'" @click="dataTab = 'parts'">零件</button><span class="muted">仅分页浏览；导出始终包含整个工作空间，数量为直接 qty，非递归展开。</span></div>
        <div v-if="dataTab === 'boms'">
          <div class="pagination"><span>直接 BOM {{ bomPage }} / {{ bomPages }}（每页 50）</span><button :disabled="bomPage <= 1" @click="bomPage--">上一页</button><button :disabled="bomPage >= bomPages" @click="bomPage++">下一页</button></div>
          <div class="table-scroll"><table><thead><tr><th>BOM</th><th>宿主零件 / 版本</th><th>名称</th><th>直接行</th></tr></thead><tbody><tr v-for="(bom, index) in visibleBoms" :key="bom.bomKey"><td><button @click="browseBom((bomPage - 1) * pageSize + index)">{{ bom.bomKey }}</button></td><td>{{ bom.partNo }} / {{ bom.revision }}</td><td>{{ bom.name }}</td><td>{{ bom.items.length }}</td></tr><tr v-if="!boms.length"><td colspan="4">没有直接 BOM</td></tr></tbody></table></div>
          <template v-if="currentBom"><p>{{ currentBom.name }} · {{ currentBom.bomKey }}（浏览选择不改变交付载荷）</p><div class="pagination"><span>直接行 {{ itemPage }} / {{ itemPages }}（每页 50）</span><button :disabled="itemPage <= 1" @click="itemPage--">上一页</button><button :disabled="itemPage >= itemPages" @click="itemPage++">下一页</button></div><div class="table-scroll"><table><thead><tr><th>子零件号</th><th>版本</th><th>直接数量 qty（非递归）</th></tr></thead><tbody><tr v-for="item in visibleItems" :key="`${item.partNo}@${item.revision}`"><td>{{ item.partNo }}</td><td>{{ item.revision }}</td><td>{{ item.qty }}</td></tr></tbody></table></div></template>
        </div>
        <div v-else><div class="pagination"><span>零件 {{ partPage }} / {{ partPages }}（每页 50）</span><button :disabled="partPage <= 1" @click="partPage--">上一页</button><button :disabled="partPage >= partPages" @click="partPage++">下一页</button></div><div class="table-scroll"><table><thead><tr><th>零件号</th><th>版本</th><th>名称</th><th>类型</th><th>描述</th></tr></thead><tbody><tr v-for="part in visibleParts" :key="`${part.partNo}@${part.revision}`"><td>{{ part.partNo }}</td><td>{{ part.revision }}</td><td>{{ part.name }}</td><td>{{ part.type }}</td><td>{{ part.description }}</td></tr><tr v-if="!parts.length"><td colspan="5">没有零件</td></tr></tbody></table></div></div>
      </template>
      <section v-if="delivery.receipt" class="receipt"><h3>最近已确认回执：{{ delivery.receipt.status === 'created' ? '已发布' : '已存在相同字节' }}</h3><p><code>{{ delivery.receipt.targetPath }}</code></p><p>{{ delivery.receipt.transferId }} · {{ delivery.receipt.bytes }} bytes</p><p>{{ delivery.receipt.payloadHash }}</p><p v-if="delivery.receipt.directorySync === 'failed'" class="notice">文件已发布，但目录同步未确认；不保证断电耐久。</p><p v-for="warning in delivery.receipt.warnings" :key="warning" class="notice">{{ warning }}</p></section>
    </WingBlock>
  </PageLayout>
</template>
<style scoped>
.delivery-block { margin: 10px 0; } p, small { overflow-wrap: anywhere; } .muted, small { color: var(--muted); font-size: .8rem; } small { display: block; margin: 6px 0; } .scope { font-size: .86rem; } .target-row, .actions, .data-tabs, .pagination { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; } .target-row label { font-size: .82rem; } .target-row input { flex: 1; min-width: 200px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel-bg); color: inherit; } .metadata { display: grid; grid-template-columns: 90px 1fr; font-size: .8rem; gap: 5px 10px; } .metadata dt { color: var(--muted); } .metadata dd { margin: 0; overflow-wrap: anywhere; } .notice { padding: 8px; white-space: pre-wrap; background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); } .notice.error { background: var(--phoenix-danger-bg); color: var(--phoenix-danger-text); } .empty { padding: 20px; color: var(--muted); text-align: center; } button { padding: 4px 8px; background: var(--panel-head-bg); border: 1px solid var(--border); color: inherit; border-radius: 4px; cursor: pointer; } button:disabled { opacity: .5; cursor: default; } [aria-selected="true"] { color: var(--primary); } table { width: 100%; border-collapse: collapse; font-size: .8rem; } th, td { padding: 6px 8px; border: 1px solid var(--border); text-align: left; overflow-wrap: anywhere; } th { background: var(--panel-head-bg); } .table-scroll { overflow: auto; max-height: 420px; } .pagination { font-size: .8rem; } .receipt { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 8px; font-size: .82rem; } .receipt h3 { font-size: .92rem; margin: 4px 0; }
</style>
