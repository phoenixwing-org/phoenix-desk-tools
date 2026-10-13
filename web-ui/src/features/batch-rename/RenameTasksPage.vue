<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { pickWorkspaceDirectory } from "../../api";
import { useAppShell } from "../../composables/useAppShell";
import { usePageSession } from "../../composables/usePageSession";
import { usePagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
import { useRenameTasks } from "./useRenameTasks";
import RenamePreviewTable from "./RenamePreviewTable.vue";
import RenameExtensionFilter from "./RenameExtensionFilter.vue";
import { useRenameExtensionFilter } from "./extensionFilter";
import { handoffDraft, quickRenameDraft } from "./handoff";
const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const rename = reactive(useRenameTasks(shell.workspacePath,
  (message, error) => shell.appendLog(`[批量改名] ${message}`, { source: "rename_tasks", open: error }),
  workspace => { if (workspace === shell.workspacePath.value) shell.requestTreeRescan(); }));
const confirming = ref(false), directoryInput = ref("");
const quickOld = ref(""), quickTarget = ref("");
const busy = computed(() => rename.busy || confirming.value);
const extensions = reactive(useRenameExtensionFilter(shell.workspacePath, computed(() => rename.preview), computed({ get: () => rename.selected, set: value => { rename.selected = value; } })));
const expanded = reactive({ task: true, mappings: true, roots: true, preview: true, attempts: false });
async function guardChanges() {
  if (!rename.dirty) return true;
  const ws = shell.workspacePath.value, taskId = rename.activeId;
  confirming.value = true;
  try {
    const answer = await pnwPromptChoice({ title: "保存当前改名任务？", message: "当前规则或目录尚未保存。保存只记录任务配置，不修改目标文件。", defaultChoiceId: "cancel", choices: [{ id: "save", label: "保存任务", variant: "primary" }, { id: "discard", label: "放弃未保存修改" }, { id: "cancel", label: "取消" }] });
    if (ws !== shell.workspacePath.value || taskId !== rename.activeId) return false;
    if (answer.choiceId === "discard") { rename.choose(rename.activeId); return true; }
    return answer.choiceId === "save" ? await rename.save() : false;
  } finally { confirming.value = false; }
}
async function selectTask(id: string) { if (!busy.value && await guardChanges()) rename.choose(id); }
async function createTask(copy = false) { if (!busy.value && await guardChanges()) await rename.create(copy); }
async function reloadTasks() { if (!busy.value && await guardChanges()) await rename.load(); }
function attemptTime(at: string) { const value = new Date(at); return Number.isNaN(value.getTime()) ? at : value.toLocaleString("zh-CN", { hour12: false }); }
function addDirectory() {
  const value = directoryInput.value.trim();
  if (!busy.value && value && !rename.draft.roots.includes(value) && rename.draft.roots.length < 12) rename.draft.roots.push(value);
  directoryInput.value = "";
}
async function pickDirectory() {
  if (busy.value) return;
  const ws = shell.workspacePath.value, taskId = rename.activeId;
  let picked = "";
  confirming.value = true;
  try {
    const result = await pickWorkspaceDirectory(directoryInput.value || shell.workspacePath.value);
    if (!result.cancelled && ws === shell.workspacePath.value && taskId === rename.activeId) picked = result.path;
  } catch (error) { if (ws === shell.workspacePath.value && taskId === rename.activeId) rename.error = String(error); }
  finally { confirming.value = false; }
  if (picked && ws === shell.workspacePath.value && taskId === rename.activeId) { directoryInput.value = picked; addDirectory(); }
}
async function search() { if (!busy.value) { await rename.search(); expanded.preview = true; } }
async function confirmApply() {
  if (busy.value || !rename.canApply) return;
  await rename.apply();
}
async function quickPreview() {
  if (busy.value || !shell.workspacePath.value) return;
  const ws = shell.workspacePath.value;
  const value = quickRenameDraft(quickOld.value, quickTarget.value, ws, rename.draft);
  if (!await guardChanges() || ws !== shell.workspacePath.value) return;
  if (await rename.save(true, value)) await search();
}
watch(shell.workspacePath, () => { quickOld.value = ""; quickTarget.value = ""; });
// Wait for task loading and any existing operation; consume each handoff once.
watch(() => [busy.value, shell.activeTabId.value, shell.getTab(props.workbenchTabId || "")?.payload, shell.getTab(props.workbenchTabId || "")?.payloadConsumed], async () => {
  if (busy.value || !props.workbenchTabId || shell.activeTabId.value !== props.workbenchTabId) return;
  const payload = shell.consumeTabPayload(props.workbenchTabId)?.renameImport;
  if (!payload) return;
  const ws = shell.workspacePath.value;
  try {
    const value = handoffDraft(payload, ws);
    if (!await guardChanges() || ws !== shell.workspacePath.value) return;
    await rename.save(true, value);
  } catch (error) { rename.error = String(error); }
}, { immediate: true, flush: "post" });
usePageSession(props.workbenchTabId, { serialize: () => ({}), hydrate: () => true, isDirty: () => rename.dirty, isBusy: () => busy.value, flush: () => rename.save(), refresh: reloadTasks });
usePagePrimaryContribution("rename_tasks", props.workbenchTabId, {
  title: "批量改名", summary: computed(() => rename.error || rename.phase || rename.active?.name || "选择或新建改名任务"),
  sections: [{ id: "quick-rename", title: "普通改名", description: "沿用右侧处理目录与勾选范围，新建 A→B 任务并预览。文件名、文件夹名、内容可独立勾选并联合执行。", controls: [
    { id: "old", kind: "text", label: "查找 A", modelValue: quickOld, disabled: busy, onUpdate: value => { quickOld.value = value; } },
    { id: "target", kind: "text", label: "替换为 B", modelValue: quickTarget, disabled: busy, onUpdate: value => { quickTarget.value = value; } },
  ], actions: [{ id: "quick-preview", label: "预览 A→B", tone: "primary", disabled: computed(() => busy.value || !shell.workspacePath.value || !quickOld.value.trim() || !quickTarget.value.trim() || quickOld.value === quickTarget.value || !(rename.draft.directories || rename.draft.filenames || rename.draft.contents)), run: quickPreview }] }, { id: "task", title: "任务", actions: [
    { id: "new", label: "新建任务", disabled: busy, run: () => createTask() },
    { id: "save", label: "保存任务", disabled: computed(() => busy.value || !rename.active || !rename.dirty), run: async () => { await rename.save(); } },
  ] }, { id: "run", title: "处理", progress: computed(() => ({ label: "批量改名", state: rename.busy ? "running" as const : rename.results ? (rename.results.failed ? "warning" as const : "done" as const) : "idle" as const, detail: rename.phase || `${rename.draft.mappings.filter(row => row.enabled).length} 条规则 · ${rename.draft.roots.length} 个目录` })), actions: [
    { id: "preview", label: "搜索预览", disabled: computed(() => busy.value || !rename.canPreview), run: search },
    { id: "apply", label: "应用勾选", tone: "primary", disabled: computed(() => busy.value || !rename.canApply), run: confirmApply },
  ] }, { id: "help", title: "说明", description: "任务包含改名列表、目录列表和匹配选项，保存到当前工作空间 SQLite；可以新建多个任务或复制后尝试。保存任务不改目标文件，搜索前自动保存当前配置。\n普通文本与文件名按字面、区分大小写、最长匹配一次替换；不使用正则。连续 A→B→C 须先整理为最终映射；冲突、循环和交换规则会单独列出并跳过，其余规则继续处理。\n三个范围可联合执行，先修改选中文件内容和文件名，再从内到外修改选中文件夹名。不改处理根目录；目录改名会移动所有子项，但未选文件不修改自身名称或内容。包含 CAD 关联模型、符号链接或内部工程数据的文件夹需另行处理。\n沿用 Code 忽略规则；保留 UTF-8/BOM/GBK 编码，二进制内容不替换。FCStd 文件名仍走 CAD 专用入口。\n预览 30 分钟有效；任务配置改变、服务重启或提交应用后必须重新预览。首次预览默认不选文件，不会自动应用。\n点击应用勾选后直接执行，不自动备份；由用户自行备份。失败项不阻止其他安全项。最近 30 次尝试保存在任务中；不自动提交 Git 或运行 CAD/Code 索引。" }],
});
</script>
<template>
  <PageLayout title="批量改名" class="desk-page-layout rename-tasks-page">
    <template #header><PageHeader title="批量改名"><template #right>
      <el-button size="small" :disabled="busy || !rename.canPreview" @click="search">搜索预览</el-button>
      <el-button size="small" type="primary" :disabled="busy || !rename.canApply" @click="confirmApply">应用勾选 {{ rename.selected.length || '' }}</el-button>
    </template></PageHeader></template>
    <p v-if="rename.error" role="alert" class="notice error">{{ rename.error }}</p>
    <WingBlock v-model:expanded="expanded.task" title="改名任务" variant="card" class="rename-block">
      <template #suffix>{{ rename.tasks.length }} 个任务</template>
      <template #actions><div class="header-actions">
        <el-button size="small" :disabled="busy" @click="createTask()">新建</el-button>
        <el-button size="small" :disabled="busy || !rename.active" @click="createTask(true)">复制任务</el-button>
        <el-button size="small" :disabled="busy" @click="reloadTasks">刷新</el-button>
        <el-button size="small" type="primary" :disabled="busy || !rename.active || !rename.dirty" @click="rename.save()">保存任务</el-button>
      </div></template>
      <div class="inline-row"><el-select :model-value="rename.activeId" :disabled="busy" aria-label="选择改名任务" placeholder="请选择或新建任务" @change="selectTask"><el-option v-for="task in rename.tasks" :key="task.id" :value="task.id" :label="task.name" /></el-select><el-input v-if="rename.active" v-model="rename.draft.name" :disabled="busy" maxlength="120" aria-label="任务名称" placeholder="任务名称" /></div>
      <small v-if="rename.active">{{ rename.dirty ? '有未保存修改' : '已保存' }} · 配置版本 {{ rename.active.revision }} · 任务保存在当前工作空间；预览和应用均需主动操作。</small>
      <p v-else class="empty">新建任务，填写 A → B 规则和目录。此功能不需要 CAD 文件或改名记录。</p>
    </WingBlock>
    <template v-if="rename.active">
      <WingBlock v-model:expanded="expanded.mappings" title="改名列表" variant="card" class="rename-block">
        <template #suffix>{{ rename.draft.mappings.filter(row => row.enabled).length }} 条启用</template>
        <template #actions><el-button size="small" :disabled="busy || rename.draft.mappings.length >= 2000" @click="rename.draft.mappings.push({ old: '', target: '', enabled: true })">添加规则</el-button></template>
        <table class="rules-table"><colgroup><col class="number-col" /><col class="enabled-col" /><col /><col /><col class="action-col" /></colgroup><thead><tr><th class="number-cell">#</th><th>启用</th><th>旧名 A</th><th>新名 B</th><th>操作</th></tr></thead><tbody><tr v-for="(row, index) in rename.draft.mappings" :key="index">
          <td class="number-cell">{{ index + 1 }}</td><td><input v-model="row.enabled" type="checkbox" :disabled="busy" :aria-label="`启用规则 ${index + 1}`" /></td><td><el-input v-model="row.old" :disabled="busy" :aria-label="`旧名 ${index + 1}`" placeholder="旧文件名或文字" /></td><td><el-input v-model="row.target" :disabled="busy" :aria-label="`新名 ${index + 1}`" placeholder="改为" /></td><td><el-button size="small" link :disabled="busy" @click="rename.draft.mappings.splice(index, 1)">移除</el-button></td>
        </tr></tbody></table>
      </WingBlock>
      <WingBlock v-model:expanded="expanded.roots" title="处理目录" variant="card" class="rename-block">
        <template #suffix>{{ rename.draft.roots.length }} / 12</template>
        <template #actions><div class="header-actions"><el-button size="small" :disabled="busy || rename.draft.roots.length >= 12" @click="pickDirectory">选择目录…</el-button><el-button size="small" :disabled="busy || !rename.canPreview" @click="search">搜索预览</el-button></div></template>
        <div class="inline-row"><el-input v-model="directoryInput" :disabled="busy" aria-label="添加处理目录" placeholder="绝对路径，可来自不同 Git 仓库" @keyup.enter="addDirectory" /><el-button size="small" :disabled="busy || !directoryInput.trim() || rename.draft.roots.length >= 12" @click="addDirectory">添加</el-button></div>
        <div v-for="(root, index) in rename.draft.roots" :key="root" class="directory-row"><code>{{ root }}</code><el-button size="small" link :disabled="busy" @click="rename.draft.roots.splice(index, 1)">移除</el-button></div>
        <div class="inline-row"><el-checkbox v-model="rename.draft.directories" :disabled="busy">文件夹名</el-checkbox><el-checkbox v-model="rename.draft.filenames" :disabled="busy">文件名</el-checkbox><el-checkbox v-model="rename.draft.contents" :disabled="busy">文件内容</el-checkbox><el-checkbox v-model="rename.draft.include_stem" :disabled="busy">同时匹配不含扩展名的名称</el-checkbox><small>此选项只补充列表中没有的去扩展名规则；已导入列表的规则始终按启用状态参与。</small></div>
        <small>文件名、文件夹名、内容可联合执行。目录改名会移动全部子项；未选文件不改自身名称或内容，目录取消勾选不改变子文件勾选。</small>
        <small>STEP/STP、CATDrawing 勾选后只改文件名，内部内容及引用保持不变；CATPart、CATProduct 等需在 CATIA 中改名，FCStd 使用 CAD 专用入口。</small>
      </WingBlock>
      <WingBlock v-model:expanded="expanded.preview" title="搜索预览与结果" variant="card" class="rename-block">
        <template #suffix>已选 {{ rename.selected.length }} / {{ rename.preview?.rows.length || 0 }}</template>
        <template #actions><div class="header-actions">
          <el-button size="small" :disabled="busy || !rename.preview || rename.consumed || !!rename.preview.conflicts.length || !extensions.visibleRows.some(row => row.eligible)" @click="rename.selected = extensions.visibleRows.filter(row => row.eligible).map(row => row.id)">勾选可用项</el-button>
          <el-button size="small" :disabled="busy || !rename.selected.length" @click="rename.selected = []">取消勾选</el-button>
          <el-button size="small" :disabled="busy || !rename.canPreview" @click="search">重新预览</el-button>
          <el-button size="small" type="primary" :disabled="busy || !rename.canApply" @click="confirmApply">应用勾选</el-button>
        </div></template>
        <RenameExtensionFilter :filters="extensions.filters" :disabled="busy || rename.consumed" @toggle="extensions.toggle" />
        <RenamePreviewTable v-if="rename.preview" v-model:selected="rename.selected" :preview="{ ...rename.preview, rows: extensions.visibleRows }" :results="rename.results" :consumed="rename.consumed" :total-rows="rename.preview.rows.length" :all-rows="rename.preview.rows" :disabled="busy || rename.consumed" />
        <p v-else class="empty">先搜索预览，再勾选需要修改的文件并应用。编辑任务后需重新预览。</p>
      </WingBlock>
      <WingBlock v-model:expanded="expanded.attempts" title="尝试记录" variant="card" class="rename-block">
        <template #suffix>最近 {{ rename.active.attempts.length }} 次</template>
        <template #actions><el-button size="small" :disabled="busy" @click="reloadTasks">刷新任务</el-button></template>
        <div class="table-scroll"><table class="attempts-table"><colgroup><col class="number-col" /><col class="time-col" /><col class="operation-col" /><col /></colgroup><thead><tr><th class="number-cell">#</th><th>时间 / 配置版本</th><th>操作</th><th>结果</th></tr></thead><tbody><tr v-for="(attempt, index) in rename.active.attempts" :key="attempt.id"><td class="number-cell">{{ index + 1 }}</td><td><span class="attempt-time">{{ attemptTime(attempt.at) }}</span><small>配置 v{{ attempt.revision }}</small></td><td>{{ attempt.kind === 'preview' ? '搜索预览' : '应用' }}</td><td>{{ attempt.state === 'running' ? '运行中或上次中断；请核对文件后重新预览' : attempt.state === 'failed' ? '有错误' : '完成' }}<template v-if="attempt.matched !== undefined"> · 命中 {{ attempt.matched }} 个</template><template v-if="attempt.applied !== undefined"> · 应用 {{ attempt.applied }} / 失败 {{ attempt.failed }}</template><small>{{ attempt.message }}</small></td></tr><tr v-if="!rename.active.attempts.length"><td colspan="4" class="empty">尚无尝试记录</td></tr></tbody></table></div>
      </WingBlock>
    </template>
  </PageLayout>
</template>
<style scoped>
.rename-block { margin: 10px 0; }
.header-actions, .inline-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.header-actions .el-button + .el-button { margin-left: 0; }
.inline-row { margin: 6px 0; }.inline-row .el-input, .inline-row .el-select { flex: 1; min-width: 180px; }
.directory-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; background: var(--panel-head-bg); overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; } th, td { border: 1px solid var(--border); padding: 6px; text-align: left; vertical-align: top; } th { background: var(--panel-head-bg); }
small { display: block; color: var(--muted); font-size: .76rem; white-space: pre-wrap; overflow-wrap: anywhere; }.empty { padding: 18px; color: var(--muted); text-align: center; }.notice { padding: 10px; }.error { color: var(--phoenix-danger-text); background: var(--phoenix-danger-bg); }
.rules-table { table-layout: fixed; }
.number-cell, .number-col { width: 48px; text-align: center; color: var(--muted); font-variant-numeric: tabular-nums; }
.enabled-col { width: 54px; } .action-col { width: 64px; }
.rules-table th.number-cell { width: 48px; }
.table-scroll { overflow-x: auto; }
.attempts-table { table-layout: fixed; min-width: 640px; }
.attempts-table .number-col, .attempts-table .number-cell { width: 44px; }
.attempts-table .time-col { width: 190px; }
.attempts-table .operation-col { width: 88px; }
.attempt-time, .attempts-table th, .attempts-table td:nth-child(3) { white-space: nowrap; }
.attempts-table th, .attempts-table td { padding: 9px 10px; line-height: 1.5; }
.attempts-table tbody tr:nth-child(even) { background: var(--panel-head-bg); }
</style>
