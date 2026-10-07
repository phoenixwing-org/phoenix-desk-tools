<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import { usePageSession } from "../../composables/usePageSession";
import { usePagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
import { cadBatchToolsSection } from "../../composables/cadBatchTools";
import { useDocumentSync } from "./useDocumentSync";
import { resolveSync, type SyncResolution } from "./api";
import DocumentSyncActions, { type SyncAction } from "./DocumentSyncActions.vue";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const sync = reactive(useDocumentSync(shell.workspacePath, (text, error) => shell.appendLog(`[关联文档同步] ${text}`, { source: "document_sync", open: error })));
const query = ref(""), resolving = ref(false), resolution = ref<SyncResolution | null>(null);
const expanded = reactive({ history: true, mappings: true });
const busy = computed(() => sync.busy || resolving.value);
const visibleLogs = computed(() => sync.logs.filter(log => `${log.old_repo_rel_path} ${log.new_repo_rel_path}`.toLowerCase().includes(query.value.trim().toLowerCase())));
const canResolve = computed(() => !busy.value && sync.options.log_ids.length > 0);
const canTransfer = computed(() => !busy.value && !!resolution.value?.pairs.length && !resolution.value.conflicts.length);
let generation = 0;
watch(() => [shell.workspacePath.value, sync.options.log_ids, sync.options.include_stem, sync.logs], () => { generation++; resolution.value = null; resolving.value = false; }, { deep: true, flush: "sync" });
const historyActions = computed<SyncAction[]>(() => [
  { id: "refresh", label: "刷新记录", disabled: busy.value, run: sync.refreshHistory },
  { id: "select", label: "勾选筛选项", disabled: busy.value || !visibleLogs.value.length, run: () => { sync.options.log_ids = [...new Set([...sync.options.log_ids, ...visibleLogs.value.map(log => log.id)])]; } },
  { id: "clear", label: "取消勾选", disabled: busy.value || !sync.options.log_ids.length, run: () => { sync.options.log_ids = []; } },
]);
function toggleLog(id: number, checked: boolean) { sync.options.log_ids = checked ? [...new Set([...sync.options.log_ids, id])] : sync.options.log_ids.filter(value => value !== id); }
async function resolve() {
  if (!canResolve.value) return;
  const token = ++generation, ws = shell.workspacePath.value;
  resolution.value = null; resolving.value = true; sync.error = "";
  try {
    const result = await resolveSync(ws, { log_ids: [...sync.options.log_ids], include_stem: sync.options.include_stem });
    if (token === generation && ws === shell.workspacePath.value) resolution.value = result;
  } catch (error) { if (token === generation) sync.error = String(error); }
  finally { if (token === generation) resolving.value = false; }
}
function transfer() {
  if (!canTransfer.value) return;
  shell.openTab({ pageId: "rename_tasks", payload: { renameImport: {
    version: 1, workspace: shell.workspacePath.value, source: "关联文档同步",
    draft: { name: "关联文档同步", mappings: resolution.value!.pairs.map(row => ({ ...row })), roots: [...sync.options.roots], filenames: sync.options.filenames, contents: sync.options.contents, include_stem: false },
  } } });
}
usePageSession(props.workbenchTabId, { serialize: () => ({}), hydrate: () => true, isDirty: () => false, isBusy: () => busy.value, refresh: sync.refreshHistory });
usePagePrimaryContribution("document_sync", props.workbenchTabId, {
  title: "关联文档同步", showContext: false, summary: computed(() => sync.error || "选择 CAD 改名记录 → 核对规则 → 批量改名"),
  sections: [cadBatchToolsSection(shell, "document_sync"), { id: "handoff", title: "改名规则", actions: [
    { id: "resolve", label: "整理 A→B", disabled: computed(() => !canResolve.value), run: resolve },
    { id: "transfer", label: "转到批量改名", tone: "primary", disabled: computed(() => !canTransfer.value), run: transfer },
    { id: "open", label: "打开批量改名", run: () => { shell.openTab({ pageId: "rename_tasks" }); } },
  ] }, { id: "help", title: "说明", description: "这里只整理 CAD 改名历史。连续改名合并到最终名称，冲突和循环需先处理。转入后新建独立任务，原有任务不会被覆盖。\n目录、文件预览和勾选应用统一在批量改名中操作；转入本身不修改文件。原来保存的目录与选项随规则带入，文件勾选与旧预览不带入。" }],
});
</script>
<template>
  <PageLayout title="关联文档同步" class="desk-page-layout document-sync-page">
    <template #header><PageHeader title="关联文档同步"><template #right>
      <el-button size="small" :disabled="!canResolve" :loading="resolving" @click="resolve">整理 A→B</el-button>
      <el-button size="small" type="primary" :disabled="!canTransfer" @click="transfer">转到批量改名</el-button>
    </template></PageHeader></template>
    <p v-if="sync.error" class="notice error" role="alert">{{ sync.error }}</p>
    <WingBlock v-model:expanded="expanded.history" title="1. 改名记录" variant="card" class="sync-block">
      <template #suffix>已选 {{ sync.options.log_ids.length }} / {{ sync.totalLogs }}</template>
      <template #actions><DocumentSyncActions :actions="historyActions" /></template>
      <div class="actions"><el-input v-model="query" size="small" clearable placeholder="筛选旧名称 / 新名称" aria-label="筛选改名记录" /></div>
      <div class="history-scroll"><table class="history-table"><thead><tr><th>选择</th><th>旧名称 / 路径</th><th>改为</th><th>时间</th></tr></thead><tbody>
        <tr v-for="log in visibleLogs" :key="log.id"><td><input type="checkbox" :aria-label="`选择记录 ${log.id}`" :disabled="busy" :checked="sync.options.log_ids.includes(log.id)" @change="toggleLog(log.id, ($event.target as HTMLInputElement).checked)" /></td><td>{{ log.old_repo_rel_path }}</td><td>{{ log.new_repo_rel_path }}</td><td class="date">{{ log.created_at }}</td></tr>
        <tr v-if="!visibleLogs.length"><td colspan="4" class="empty">{{ sync.busy ? '读取记录中…' : '没有匹配的改名记录；普通 A→B 请直接打开批量改名' }}</td></tr>
      </tbody></table></div>
      <el-checkbox v-model="sync.options.include_stem" :disabled="busy">同时匹配不含扩展名的名称</el-checkbox>
      <small>按工作空间记住记录勾选。{{ sync.totalLogs > sync.logs.length ? '这里只列最近 2000 条，链条解析使用完整记录。' : '' }}</small>
    </WingBlock>
    <WingBlock v-model:expanded="expanded.mappings" title="2. 核对 A→B" variant="card" class="sync-block">
      <p v-if="!resolution" class="empty">选择记录后点击“整理 A→B”，核对最终规则再转入批量改名。</p>
      <template v-else>
        <p v-for="conflict in resolution.conflicts" :key="conflict" class="notice error" role="alert">{{ conflict }}</p>
        <p>{{ resolution.pairs.length }} 条替换规则 · 转入后新建任务，不自动预览或应用。</p>
        <details class="mapping-rules" open><summary>替换规则（{{ resolution.pairs.length }}）</summary><div class="history-scroll mapping-scroll"><table class="mapping-table"><colgroup><col class="number-col" /><col /><col /></colgroup><thead><tr><th class="number-cell">#</th><th>旧名 A</th><th>新名 B</th></tr></thead><tbody><tr v-for="(row, index) in resolution.pairs" :key="index"><td class="number-cell">{{ index + 1 }}</td><td>{{ row.old }}</td><td>{{ row.target }}</td></tr></tbody></table></div></details>
        <details class="mapping-history"><summary>历史路径与连续改名（{{ resolution.mappings.length }}）</summary><div class="history-scroll mapping-scroll"><table class="mapping-table"><colgroup><col class="number-col" /><col /><col /></colgroup><thead><tr><th class="number-cell">#</th><th>原路径 A</th><th>后续路径 → 最终路径</th></tr></thead><tbody><tr v-for="(row, index) in resolution.mappings" :key="row.old + row.target"><td class="number-cell">{{ index + 1 }}</td><td>{{ row.old }}</td><td><div v-for="(step, index) in row.chain.slice(Math.max(0, row.chain.indexOf(row.old)) + 1)" :key="index" class="chain-step"><span class="chain-arrow">→</span><strong v-if="step === row.target">{{ step }} <small class="final-label">最终</small></strong><span v-else>{{ step }}</span></div></td></tr></tbody></table></div></details>
      </template>
    </WingBlock>
  </PageLayout>
</template>
<style scoped>
.sync-block { margin: 10px 0; } .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; font-size: .82rem; } .actions .el-input { flex: 1; min-width: 220px; } .options { margin: 10px 0 0; }
table { width: 100%; border-collapse: collapse; font-size: .83rem; } th, td { padding: 7px 9px; border: 1px solid var(--border); vertical-align: top; text-align: left; overflow-wrap: anywhere; } th { background: var(--panel-head-bg); position: sticky; top: 0; } .history-table th:first-child { width: 40px; } .date { width: 150px; } .result { width: 22%; } .history-scroll { max-height: 280px; overflow: auto; }
small { display: block; font-size: .74rem; color: var(--muted); margin: 4px 0; } .directory-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; background: var(--panel-head-bg); margin-bottom: 4px; overflow-wrap: anywhere; } .directory-row code { min-width: 0; } .mappings { margin-bottom: 12px; }
.empty { padding: 22px; text-align: center; color: var(--muted); } .notice { padding: 9px; background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); } .error { color: var(--phoenix-danger-text); } .notice.error { background: var(--phoenix-danger-bg); } summary { cursor: pointer; padding: 5px 0; } .diff { margin-top: 6px; } .diff span { font-size: .72rem; color: var(--muted); } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: 3px 7px; } .removed { background: var(--phoenix-danger-bg); color: var(--phoenix-danger-text); } .added { background: var(--phoenix-success-bg); color: var(--phoenix-success-text); }
.mapping-table { table-layout: fixed; min-width: 600px; }
.mapping-table col:not(.number-col) { width: calc((100% - 52px) / 2); }
.mapping-table col.number-col { width: 52px; }
.mapping-table .number-cell { width: 52px; text-align: center; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.mapping-table th, .mapping-table td { padding: 10px 12px; line-height: 1.6; white-space: normal; overflow-wrap: anywhere; }
.mapping-table th { white-space: nowrap; z-index: 1; }
.mapping-table tbody tr:nth-child(even) { background: var(--panel-head-bg); }
.mapping-scroll { max-height: 420px; overflow: auto; }
.mapping-history { margin-top: 12px; }
.chain-step { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; }
.chain-step > strong, .chain-step > span:last-child { min-width: 0; }
.chain-arrow { color: var(--muted); flex-shrink: 0; }
.final-label { display: inline; font-size: .7rem; margin-left: 4px; color: var(--muted); font-weight: normal; }
</style>
