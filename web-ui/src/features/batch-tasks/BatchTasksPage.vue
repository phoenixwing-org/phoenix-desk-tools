<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { isActiveRun, isBatchStep, isCurrentPlan, isNativePlan, type BatchTask } from "../../../../shared/batch-tasks/contracts";
import { usePagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
import { usePageSession } from "../../composables/usePageSession";
import { batchTasksController as controller, openBatchTasksTool, batchTasksAutoMonitorEnabled, setBatchTasksAutoMonitorEnabled } from "./application";
import { batchStepMatchesFile, batchStepSubjects, batchStepTargetLabel, describeAction, describeEffects, mergeBatchInputPaths, projectPreviewSteps, projectRunProgress, runStatusLabel, stepStatusLabel } from "./projection";
import { createBatchWorksetInput } from "./worksetInput";
import BatchTaskBasket from "./BatchTaskBasket.vue";
import BatchTaskResult from "./BatchTaskResult.vue";
import type { RetryDraftGroup } from "./api";
import BatchTasksPrimaryContent from "./BatchTasksPrimaryContent.vue";

const props = defineProps<{ workbenchTabId?: string }>();
const worksetInput = createBatchWorksetInput();
const worksets = worksetInput.state;
const state = controller.state;
watch(() => state.workspace, workspace => { worksetInput.setWorkspace(workspace); worksetId.value = ""; }, { immediate: false, flush: "sync" });
const showArchived = ref(false), worksetId = ref(""), filterStatus = ref(""), filterFile = ref("");
const expanded = reactive({ definition: true, plan: true, history: true });
const definitionAnchor = ref<HTMLElement | null>(null), previewAnchor = ref<HTMLElement | null>(null), historyAnchor = ref<HTMLElement | null>(null);
const navigationTarget = ref("definition");
const closePending = ref(false);
const observedNow = ref(Date.now());
watch([() => state.runs, () => state.plan], () => { observedNow.value = Date.now(); if (state.plan?.status === "fresh") expanded.plan = true; });
const tasks = computed(() => state.tasks.filter(task => showArchived.value || !task.archived));
worksetInput.setWorkspace(state.workspace);
const availableWorksets = computed(() => worksets.workspace === state.workspace ? worksets.worksets : []);
const steps = computed(() => state.detail?.steps.filter(step => (!filterStatus.value || (filterStatus.value === "issues" ? ["failed", "blocked", "interrupted"].includes(step.status) : step.status === filterStatus.value)) && batchStepMatchesFile(step, filterFile.value)) ?? []);
const progress = computed(() => projectRunProgress(controller.currentRun.value));
const currentPlan = computed(() => state.plan && isCurrentPlan(state.plan) ? state.plan : null);
const nativePlan = computed(() => state.plan && isNativePlan(state.plan) ? state.plan : null);
const previewSteps = computed(() => state.plan ? projectPreviewSteps(state.plan) : []);
const cacheResources = computed(() => currentPlan.value?.prepared.resources.filter(resource => resource.kind === "cache") ?? []);
const planFresh = computed(() => currentPlan.value?.status === "fresh" && Date.parse(currentPlan.value.expires_at) > observedNow.value && !controller.dirty.value);
const previewHint = computed(() => controller.busy.value ? "正在处理，请稍候。" : controller.dirty.value ? "请先保存定义，再预览。" : !controller.currentTask.value ? "先填写文件和动作并保存定义。" : controller.currentTask.value.archived ? "请先取消归档，或复制为新任务。" : "预览只核对范围，不执行动作。");
const admissionHint = computed(() => nativePlan.value ? "Native 试点仅供查看，网页不能执行。" : state.admission ? "先核对上一次接纳请求。" : !currentPlan.value ? "请重新生成当前版本的预览。" : !planFresh.value ? "预览已过期、已使用或草稿已变化，请重新预览。" : !state.plan?.summary.executable ? "没有可执行步骤，请先处理阻塞原因。" : "核对下方范围后确认，才会加入后台队列。");
const hasRetryableSteps = computed(() => !!state.detail && !isActiveRun(state.detail.run.status) && !state.detail.steps.some(step => step.action_key === "cad.saved-shape-measurement") && state.detail.steps.some(step => ["failed", "blocked", "interrupted"].includes(step.status)));
const canSave = computed(() => !!state.workspace && !controller.busy.value && controller.dirty.value && !state.admission && !controller.currentTask.value?.archived);
const canCheck = computed(() => !!state.workspace && !controller.busy.value && !controller.dirty.value && !!controller.currentTask.value && !controller.currentTask.value.archived);
const canRun = computed(() => !controller.busy.value && planFresh.value && !!state.plan?.summary.executable && !state.admission);
const nextStepHint = computed(() => !state.workspace ? "先选择工作空间" : state.admission ? "先核对上一次接纳请求，不能另建运行" : controller.busy.value ? "正在处理，请稍候" : controller.currentTask.value?.archived ? "任务已归档，请在 Primary 新建或复制任务" : controller.dirty.value ? "下一步：保存任务，再点检执行范围" : canRun.value ? `点检完成：${state.plan!.summary.files} 个文件、${state.plan!.summary.actions} 个动作，可运行 ${state.plan!.summary.executable} 步；核对后点击【运行】` : !controller.currentTask.value ? "在 Primary 新建任务，填写文件和动作" : state.plan?.status === "consumed" ? "本次预览已运行；可查看结果，或重新点检后再次运行" : "下一步：点击【点检】，核对范围后再运行");
const workflowSteps = computed(() => [
  { id: "definition", title: "任务设置", description: `${state.paths.split(/\r?\n/).filter(line => line.trim()).length} 个文件 · ${state.draft.actions.length} 个动作${controller.dirty.value ? " · 未保存" : ""}`, state: navigationTarget.value === "definition" ? "current" as const : controller.currentTask.value && !controller.dirty.value ? "done" as const : "pending" as const },
  { id: "preview", title: "点检与预览", description: controller.dirty.value ? "任务有修改，保存后重新点检" : currentPlan.value?.status === "consumed" ? "本次已运行；重新点检后可再运行" : currentPlan.value && !planFresh.value ? "预览已过期，请重新点检" : currentPlan.value ? `就绪 ${currentPlan.value.prepared.summary.ready} · 阻塞 ${currentPlan.value.prepared.summary.blocked} · 不适用 ${currentPlan.value.prepared.summary.not_applicable}` : "核对文件、动作和执行范围", state: navigationTarget.value === "preview" ? "current" as const : currentPlan.value?.status === "consumed" && !controller.dirty.value ? "done" as const : canRun.value ? "ready" as const : "pending" as const },
  { id: "history", title: "运行与结果", description: `${controller.activeRuns.value.length} 个活动运行 · 关闭显示不取消`, state: navigationTarget.value === "history" ? "current" as const : state.runs.length ? "done" as const : "pending" as const },
]);
async function navigateTaskSection(id: string) {
  if (!["definition", "preview", "history"].includes(id)) return;
  navigationTarget.value = id;
  if (id === "definition") expanded.definition = true;
  if (id === "preview") { expanded.plan = true; if (!state.plan) state.notice = "尚无点检预览。请在详情 header 保存任务，再点击【点检】。"; }
  if (id === "history") expanded.history = true;
  await nextTick();
  const target = id === "history" ? historyAnchor.value : id === "preview" && state.plan ? previewAnchor.value : definitionAnchor.value;
  target?.scrollIntoView?.({ block: "start", behavior: "auto" });
}
async function saveTask() { if (canSave.value) await controller.save(); }
async function checkTask() { if (canCheck.value && await controller.preview()) await navigateTaskSection("preview"); }
async function runTask() { if (canRun.value && await controller.admit()) await navigateTaskSection("history"); }
const closeContext = () => JSON.stringify([state.workspace, state.editingId, state.editingRevision, state.draft, state.paths, state.creationId, state.creationUncertain, state.admission]);
async function requestClose() {
  if (controller.busy.value || closePending.value) return false;
  if (!controller.dirty.value) return true;
  const context = closeContext();
  closePending.value = true;
  try {
    const uncertain = state.creationUncertain || !!state.admission;
    const answer = await pnwPromptChoice({
      title: "关闭批量任务详情",
      message: "当前任务定义有未保存的修改。关闭显示不会取消后台运行。"
        + (uncertain ? "\n\n存在结果未确认的请求，请返回核对；本次不能保存。放弃仅清除本地草稿，核对信息仍保留，不会撤销可能已保存的定义或运行。" : ""),
      defaultChoiceId: "cancel",
      choices: [
        { id: "save", label: "保存任务定义并关闭", variant: "primary", disabled: !canSave.value || uncertain },
        { id: "discard", label: "放弃草稿并关闭", variant: "danger" },
        { id: "cancel", label: "返回" },
      ],
    });
    if (context !== closeContext() || controller.busy.value) return false;
    if (answer.choiceId === "discard") return controller.discardDraft();
    if (answer.choiceId === "save" && canSave.value && !state.creationUncertain) {
      return await controller.save() && !controller.dirty.value;
    }
    return false;
  } finally { closePending.value = false; }
}
const actionTitle = (instanceId: string) => {
  const selected = state.plan?.actions.find(action => action.instance_id === instanceId);
  return selected ? `${state.actions.find(action => action.key === selected.key)?.title || selected.key} (${selected.key}@${selected.version})` : instanceId;
};
async function confirmDiscard() {
  if (!controller.dirty.value) return true;
  return (await pnwPromptChoice({ title: "未保存的任务定义", message: state.creationUncertain ? "新建保存结果尚未确认。请先核对已保存任务列表；切换只放弃当前草稿，不会撤销可能已保存的原任务，也不会取消运行。确认已核对并切换？" : "当前草稿修改尚未保存。是否放弃这些修改？已接纳运行不会受影响。", defaultChoiceId: "cancel", choices: [{ id: "discard", label: "放弃草稿修改" }, { id: "cancel", label: "保留并返回" }] })).choiceId === "discard";
}
async function selectTask(task: BatchTask) {
  if (!await confirmDiscard()) return;
  controller.selectTask(task); await navigateTaskSection("definition");
}
async function newTask() { if (await confirmDiscard()) { controller.newTask(); await navigateTaskSection("definition"); } }
async function duplicateTask() { controller.newTask(true); await navigateTaskSection("definition"); }
async function loadWorksets() { const workspace = state.workspace; await worksetInput.load(); if (workspace === state.workspace && worksets.error) state.error = worksets.error; }
function importWorkset() {
  if (worksets.workspace !== state.workspace) { state.error = "工作集不属于当前空间，请先读取当前工作空间的工作集。"; return; }
  const workset = availableWorksets.value.find(item => item.id === worksetId.value); if (!workset) return;
  const entries = workset.entries?.length ? workset.entries : (workset.paths ?? []).map(path => ({ path, type: "file" as const }));
  if (entries.some(entry => entry.type !== "file")) { state.error = "首期只导入明确文件，工作集含目录；请先创建仅含文件的工作集。"; return; }
  importBasket(entries.map(entry => entry.path));
}
function importBasket(paths: readonly string[]) {
  if (controller.busy.value || state.creationUncertain || state.admission) { state.error = "当前请求尚待确认，请先核对；没有替换或保存草稿。"; return; }
  try {
    const merged = mergeBatchInputPaths(state.paths, paths);
    if (controller.currentTask.value?.archived) { state.error = "当前定义已归档，请先新建或复制任务再导入文件。"; return; }
    controller.editPaths(merged); void navigateTaskSection("definition");
    state.error = ""; state.notice = "已合并文件到当前草稿，原文件清单未覆盖；保存成功后才计入任务。待选篮保留，不会自动运行。";
  } catch (cause) { state.error = cause instanceof Error ? cause.message : String(cause); }
}
async function startRetry(group: RetryDraftGroup) {
  if (!await confirmDiscard()) return;
  if (controller.startRetryGroup(group)) { expanded.plan = true; await navigateTaskSection("definition"); }
}
function showOnlyIssues() { filterStatus.value = "issues"; expanded.history = true; }
async function backup() {
  const output = await controller.backup(); if (output === undefined) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "batch-tasks-backup.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
usePagePrimaryContribution("batch_tasks", props.workbenchTabId, {
  title: "批量任务管理", showContext: false,
  summary: computed(() => `${controller.activeRuns.value.length} 个活动运行 · 关闭显示不取消`),
  content: { component: BatchTasksPrimaryContent, props: computed(() => ({
    tasks: tasks.value, selectedTaskId: state.editingId, busy: controller.busy.value, showArchived: showArchived.value,
    onShowArchived: (value: boolean) => { showArchived.value = value; }, onSelectTask: selectTask,
    onNew: newTask, onDuplicate: duplicateTask, steps: workflowSteps.value, onNavigate: navigateTaskSection,
    onRefresh: controller.refresh, onBackup: backup, progress: progress.value, onOpenMonitor: openBatchTasksTool,
  })) },
  sections: [{ id: "batch-monitor", title: "当前运行", progress, controls: [
    { id: "files", kind: "readonly", label: "草稿文件", value: computed(() => state.paths.split(/\r?\n/).filter(line => line.trim()).length) },
    { id: "actions", kind: "readonly", label: "采集动作", value: computed(() => state.draft.actions.length) },
  ], actions: [
    { id: "monitor", label: "浮出任务监控", run: openBatchTasksTool },
    { id: "refresh", label: "查询后台回执", disabled: computed(() => state.loading), run: controller.refresh },
  ] }, { id: "batch-boundary", title: "只读边界", description: "源文件只读，观察结果写任务 DB；缓存只读查询可创建/释放自有临时读锁，不回收已有锁，freshness 始终 unverified。仅明确文件清单，不递归、不启动 Native、不写 CAD；关闭、停靠、切换工作空间都不会取消运行。任务库备份不含 CAD、缓存或输出；网页未提供恢复操作，后端仅支持空账本恢复。" }],
});
usePageSession(props.workbenchTabId, {
  serialize: () => ({ workspace: state.workspace, filterStatus: filterStatus.value, filterFile: filterFile.value }),
  hydrate: snapshot => { if (snapshot.workspace !== state.workspace) return false; filterStatus.value = typeof snapshot.filterStatus === "string" ? snapshot.filterStatus : ""; filterFile.value = typeof snapshot.filterFile === "string" ? snapshot.filterFile : ""; return true; },
  isDirty: () => controller.dirty.value, isBusy: () => controller.busy.value || closePending.value,
  flush: () => controller.save(), requestClose, refresh: controller.refresh,
});
</script>
<template>
  <PageLayout title="批量任务管理" class="desk-page-layout batch-tasks-page">
    <template #header><PageHeader title="批量任务详情" :subtitle="state.draft.name"><template #right>
      <div class="header-task-actions" aria-label="当前任务操作">
        <button type="button" :disabled="!canSave" :title="controller.dirty.value ? '保存当前任务定义，不执行' : '当前定义已保存'" @click="saveTask">保存</button>
        <button type="button" :disabled="!canCheck" :title="previewHint" @click="checkTask">点检</button>
        <button type="button" class="primary" :disabled="!canRun" :title="admissionHint" @click="runTask">运行</button>
      </div>
      <button type="button" @click="openBatchTasksTool">任务监控</button>
    </template></PageHeader></template>
    <div class="task-next-step" role="status"><div><strong>{{ nextStepHint }}</strong><small>已保存任务和流程导航在左侧 Primary。步骤可直接定位；只有明确点击【运行】并通过点检，才会接纳任务。关闭显示不取消任务。</small></div><label class="auto-monitor"><input type="checkbox" :checked="batchTasksAutoMonitorEnabled" @change="setBatchTasksAutoMonitorEnabled(($event.target as HTMLInputElement).checked)" />自动监控</label></div>
    <p v-if="!state.workspace" role="status">请先选择工作空间。</p>
    <p v-if="state.stale" class="notice" role="alert">暂未连接后台，以下为上次回执；不会自行把运行标记完成或取消。</p>
    <p v-if="state.error" class="error" role="alert">{{ state.error }}</p><p v-if="state.notice" role="status">{{ state.notice }}</p>
    <p v-if="state.creationUncertain" class="notice" role="status">新建保存尚待核对：{{ state.creationId }}。关闭或放弃草稿不会撤销可能已保存的定义。请核对已保存任务列表；同内容重试复用此标识，内容变化将被阻止，不会静默另建。
      <button type="button" :disabled="controller.busy.value || state.loading" @click="controller.refresh()">核对已保存任务</button>
    </p>
    <section v-if="state.admission" class="notice" aria-label="接纳结果未确认">
      <strong>存在结果未确认的接纳请求</strong><p>请求 {{ state.admission.client_request_id }}。先核对，不新建另一运行。</p>
      <p v-if="!controller.canRetryAdmission.value">旧版指针仅用于核对原运行，不会升级为 V2 权限；确认没有运行记录后必须重新预览。</p>
      <button type="button" :disabled="controller.busy.value" @click="controller.recoverAdmission()">核对原请求</button>
      <button v-if="controller.canRetryAdmission.value" type="button" :disabled="controller.busy.value" @click="controller.submitAdmission()">按原请求重试接纳</button>
    </section>
    <BatchTaskBasket v-if="state.workspace" :workspace="state.workspace" :disabled="controller.busy.value || state.creationUncertain || !!state.admission" @import="importBasket" />
    <div v-if="state.workspace" class="task-layout">
      <div class="task-editor">
        <div ref="definitionAnchor" class="task-anchor">
        <WingBlock v-model:expanded="expanded.definition" title="1. 任务定义" variant="card" class="task-flow-block" aria-label="任务定义">
          <template #suffix>{{ state.editingId ? `r${state.editingRevision}` : '新草稿' }}{{ controller.dirty.value ? ' · 未保存' : '' }}</template>
          <template #actions><div class="actions block-actions">
            <button type="button" :disabled="!canSave" @click="saveTask">保存定义</button>
            <button type="button" :disabled="!canCheck" :title="previewHint" @click="checkTask">准备运行 / 预览</button>
          </div></template>
          <label>名称<input :value="state.draft.name" maxlength="120" :disabled="controller.busy.value" @input="controller.editName(($event.target as HTMLInputElement).value)" /></label>
          <label>明确文件清单（每行一个工作空间相对路径，最多 200 个）<textarea :value="state.paths" rows="7" spellcheck="false" :disabled="controller.busy.value" placeholder="samples/notes.txt&#10;samples/model.FCStd" @input="controller.editPaths(($event.target as HTMLTextAreaElement).value)" /></label>
          <p class="muted">不接受目录，不默认全空间，不自动展开图纸或引用。FCStd 仅表示 CAD 文件输入，不按装配实例汇总。</p>
          <div class="workset-import"><button type="button" :disabled="worksets.loading || controller.busy.value" @click="loadWorksets">读取工作集</button><select v-model="worksetId" aria-label="输入工作集"><option value="">选择工作集</option><option v-for="workset in availableWorksets" :key="workset.id" :value="workset.id">{{ workset.name }}</option></select><button type="button" :disabled="!worksetId || controller.busy.value || !availableWorksets.length" @click="importWorkset">复制文件选择到草稿</button></div>
          <fieldset :disabled="controller.busy.value"><legend>只读动作（服务端白名单）</legend><div v-for="action in state.actions" :key="action.key" class="action-choice"><label><input type="checkbox" :checked="state.draft.actions.some(selected => selected.key === action.key)" @change="controller.toggleAction(action.key, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ action.title }} <em>{{ action.scope === 'batch' ? '整批一次' : '逐文件' }}</em></strong><small>{{ action.description }}</small><small v-if="state.draft.actions.some(selected => selected.key === action.key && selected.version !== action.version)">草稿保留旧动作版本；请取消后重新选择当前版本，再保存和预览核对。</small></span></label><details class="action-contract"><summary>执行边界与版本</summary><small>{{ describeAction(action) }}</small></details></div></fieldset>
          <div v-if="state.draft.actions.length" class="action-order" aria-label="动作执行顺序">
            <strong>执行顺序</strong><p class="muted">按下面顺序逐个动作执行；文件动作处理所选文件，整批动作只执行一次。调整后需保存并重新预览。</p>
            <ol><li v-for="(action, index) in state.draft.actions" :key="action.instance_id"><span>{{ state.actions.find(descriptor => descriptor.key === action.key)?.title || action.key }} <small>v{{ action.version }} · {{ state.actions.find(descriptor => descriptor.key === action.key)?.scope === 'batch' ? '整批一次' : '逐文件' }}</small></span><div class="actions"><button type="button" :aria-label="`上移 ${action.key}`" :disabled="controller.busy.value || index === 0 || state.creationUncertain || !!state.admission" @click="controller.moveAction(action.instance_id, 'up')">↑ 上移</button><button type="button" :aria-label="`下移 ${action.key}`" :disabled="controller.busy.value || index === state.draft.actions.length - 1 || state.creationUncertain || !!state.admission" @click="controller.moveAction(action.instance_id, 'down')">↓ 下移</button></div></li></ol>
          </div>
          <div class="actions"><button v-if="controller.currentTask.value" type="button" :disabled="controller.busy.value || controller.dirty.value" @click="controller.archive(!controller.currentTask.value!.archived)">{{ controller.currentTask.value.archived ? '取消归档' : '归档定义' }}</button></div>
          <p class="muted">编辑按 revision 校验；修改只影响下一次运行，已排队运行的范围与参数不变。归档不删除源文件或历史。</p>
          <p class="muted" role="status">{{ previewHint }}</p>
        </WingBlock>
        </div>
        <div v-if="state.plan" ref="previewAnchor" class="task-anchor">
        <WingBlock v-model:expanded="expanded.plan" title="2. 运行预览" variant="card" class="plan task-flow-block" aria-label="冻结预览">
          <template #actions><button type="button" class="primary" :disabled="!canRun" :title="admissionHint" @click="runTask">确认只读范围并加入队列</button></template>
          <p v-if="currentPlan">{{ currentPlan.prepared.summary.files }} 文件 · {{ currentPlan.prepared.summary.actions }} 动作 · 文件步骤 {{ currentPlan.prepared.summary.file_steps }} · 整批步骤 {{ currentPlan.prepared.summary.batch_steps }} · 就绪 {{ currentPlan.prepared.summary.ready }} · 阻塞 {{ currentPlan.prepared.summary.blocked }} · 不适用 {{ currentPlan.prepared.summary.not_applicable }}</p>
          <p v-else-if="nativePlan">Native V3 试点预览：{{ nativePlan.summary.files }} 文件 · {{ nativePlan.steps.length }} 步骤；当前页面仅供只读查看，不授予执行权。</p>
          <p v-else>旧版预览：{{ state.plan.summary.files }} 文件 · {{ state.plan.summary.actions }} 动作 · {{ state.plan.steps.length }} 步骤；仅供查看，请重新准备运行 / 预览。</p>
          <p>计划 {{ state.plan.id }} · {{ state.plan.status }} · 到期 {{ state.plan.expires_at }}</p><p>冻结效果：{{ describeEffects(currentPlan?.prepared.effects || state.plan.effects) }}。{{ nativePlan ? '历史与预览数据不授予执行或终止进程权限。' : '不写 CAD、不生成缩略图、不启动 Native，不修改全局偏好。' }}</p>
          <ol v-if="currentPlan"><li v-for="action in currentPlan.prepared.descriptors" :key="`${action.key}@${action.version}`">{{ action.key }}@{{ action.version }} · {{ action.scope === 'batch' ? '整批一次' : '逐文件' }} · 源文件只读 · 结果 v{{ action.result_schema_version }} · 算法 {{ action.algorithm_version }}<small>{{ describeEffects(action.effects) }}</small></li></ol>
          <p v-if="cacheResources.length" class="notice">缓存 freshness: unverified（未验证）。缓存 hash/stamp 是历史来源信息，不代表当前 CAD SHA 新鲜；只查询已有缓存，不读取清单外依赖、不补建缓存。只读租约创建/释放自有临时协调锁，不回收已有锁。缓存键：{{ cacheResources.map(resource => resource.key).join('、') }}</p>
          <details><summary>冻结的明确文件清单（{{ state.plan.items.length }}）</summary><ul><li v-for="item in state.plan.items" :key="item.id">{{ item.subject.rel }} · {{ item.bytes === null ? '大小未知' : `${item.bytes} bytes` }} <small>{{ ('error' in item && item.error) || item.sha256 || 'SHA 未取得' }}</small></li></ul></details>
          <details open><summary>实际冻结步骤（{{ previewSteps.length }}）</summary><ul><li v-for="step in previewSteps" :key="step.id">{{ step.label }} · {{ actionTitle(step.action_instance_id) }} · {{ step.status === 'ready' ? '就绪' : step.status === 'blocked' ? '已阻塞' : '不适用' }}<small v-if="step.reason">{{ step.reason }}</small></li></ul></details>
          <p class="muted" role="status">{{ admissionHint }}</p>
          <p class="muted">确认摘要绑定所选文件、指纹和动作版本；过期或内容变化需重新预览。后台接纳后立即排队，不等待呈现动画。</p>
        </WingBlock>
        </div>
      </div>
    </div>
    <div v-if="state.workspace" ref="historyAnchor" class="task-anchor history-anchor">
    <WingBlock v-model:expanded="expanded.history" title="3. 运行与历史" variant="card" class="run-history task-flow-block" aria-label="运行历史">
      <template #suffix>{{ controller.activeRuns.value.length }} 个活动运行</template>
      <template #actions><div class="actions block-actions"><button type="button" :disabled="state.loading" @click="controller.refresh()">刷新回执</button><button type="button" :disabled="!state.detail" @click="showOnlyIssues">只看问题项</button><button type="button" :disabled="controller.busy.value || !hasRetryableSteps" @click="controller.loadRetryGroups(state.detail!.run.id)">失败/中断项再试</button></div></template>
      <div class="table-scroll"><table><thead><tr><th>任务 / revision</th><th>状态</th><th>结果 / 总步骤</th><th>操作</th></tr></thead><tbody><tr v-for="run in state.runs" :key="run.id"><td>{{ run.task_name }} · r{{ run.task_revision }}<small>{{ run.id }}</small></td><td>{{ runStatusLabel[run.status] }}<small>{{ run.message }}</small></td><td>成功 {{ run.completed }} · 问题 {{ run.failed }} / 共 {{ run.total }}</td><td><button type="button" @click="controller.selectRun(run.id)">明细</button><button v-if="isActiveRun(run.status)" type="button" :disabled="controller.busy.value || run.cancel_requested" @click="controller.cancel(run.id)">{{ run.cancel_requested ? '等待安全边界' : '请求取消' }}</button></td></tr></tbody></table></div>
      <p v-if="!state.runs.length" class="muted">尚无运行；保存和预览不会自动执行。</p>
      <div v-if="state.detail" class="run-detail"><h3>步骤明细（文件 / 整批） · {{ runStatusLabel[state.detail.run.status] }}</h3>
        <div class="actions"><input v-model="filterFile" aria-label="按文件筛选" placeholder="筛选文件" /><select v-model="filterStatus" aria-label="按步骤状态筛选"><option value="">全部步骤状态</option><option value="issues">问题项（失败 / 阻塞 / 中断）</option><option v-for="(label, status) in stepStatusLabel" :key="status" :value="status">{{ label }}</option></select></div>
        <div class="table-scroll"><table><thead><tr><th>文件 / 整批范围</th><th>动作</th><th>状态</th><th>观察结果 / 原因</th></tr></thead><tbody><tr v-for="step in steps" :key="step.id"><td>{{ batchStepTargetLabel(step) }}<details v-if="isBatchStep(step)"><summary>所选文件（{{ batchStepSubjects(step).length }}）</summary><ul><li v-for="subject in batchStepSubjects(step)" :key="subject.rel">{{ subject.rel }}</li></ul></details></td><td>{{ state.actions.find(action => action.key === step.action_key)?.title || step.action_key }}<small>{{ step.action_key }}</small></td><td>{{ stepStatusLabel[step.status] }}</td><td><p v-if="step.result?.freshness === 'unverified'" class="muted">缓存新鲜度：unverified（未验证，不代表当前 CAD 哈希匹配）</p><BatchTaskResult :step="step" /></td></tr></tbody></table></div>
        <p v-if="!steps.length" class="muted">没有符合当前筛选的步骤。</p>
        <section v-if="state.retryRunId === state.detail.run.id" class="retry-groups" aria-label="失败项重试候选">
          <h3>失败项重试候选</h3><p class="muted">按原动作实例分组，只复制失败、阻塞或中断项。每组成为独立新草稿，必须保存、重新预览并再次确认；不会重跑原运行的成功项。</p>
          <p v-if="!state.retryGroups.length" class="muted">没有可重试的问题步骤。</p>
          <article v-for="group in state.retryGroups" :key="group.id" class="retry-group"><div><strong>{{ group.action_title }} · v{{ group.action_version }}</strong><small>{{ group.failed_steps }} 个问题步骤 · {{ group.scope === 'batch' ? '保留原整批范围' : `${group.draft?.subjects.length ?? 0} 个文件` }}</small><p v-if="group.scope === 'batch'" class="muted">整批分析保持原完整文件清单，不缩小为一个文件。</p><p v-if="group.reason" class="error">{{ group.reason }}</p></div><button type="button" :disabled="controller.busy.value || !group.available || !group.draft || state.creationUncertain || !!state.admission" @click="startRetry(group)">载入重试草稿</button></article>
        </section>
        <details><summary>事件记录（{{ state.detail.events.length }}）</summary><ol><li v-for="event in state.detail.events" :key="event.seq">{{ event.seq }} · {{ event.created_at }} · {{ event.message }}</li></ol></details>
      </div>
    </WingBlock>
    </div>
    <p class="boundary">独立任务备份仅导出定义与历史的逻辑 JSON；不代表工作空间主库、源文件、图片缓存、外部输出或备份文件已包含。可能含私人路径和观察值，仅保存在本地。网页暂不提供恢复操作；后台恢复仅允许空任务库且旧计划失效，不自动续跑。</p>
  </PageLayout>
</template>
<style scoped>
.batch-tasks-page { color: var(--text); } h2 { font-size: 15px; margin: 0 0 12px; } h3 { font-size: 14px; } small { display: block; color: var(--muted); font-size: 11px; font-weight: normal; overflow-wrap: anywhere; } h2 small { display: inline; margin-left: 6px; } p { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.boundary, .notice { margin: 10px 0; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-head-bg); font-size: 12px; } .error { padding: 10px; background: var(--phoenix-danger-bg); color: var(--phoenix-danger-text, #b42318); white-space: pre-wrap; } .muted { color: var(--muted); }
.task-layout { display: block; min-width: 0; } .task-editor { display: grid; gap: 12px; min-width: 0; } .task-anchor { min-width: 0; height: auto; scroll-margin-top: 10px; } .history-anchor { margin-top: 12px; }
/* Sidebar blocks fill their host by default. Main uses natural document flow, not a fixed-height sidebar stack. */
.batch-tasks-page .task-flow-block.pnw-sidebar-block { height: auto; flex: 0 0 auto; min-height: auto; margin: 0; overflow: hidden; }
.task-flow-block :deep(.pnw-sidebar-block-body) { display: block; flex: 0 0 auto; min-height: auto; overflow: visible; }
.header-task-actions { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.header-task-actions button { min-width: 54px; }
.task-next-step { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: 0 0 10px; padding: 9px 11px; background: var(--panel-head-bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.task-next-step > div { min-width: 0; } .task-next-step small { margin-top: 5px; line-height: 1.5; }
button, input, textarea, select { box-sizing: border-box; color: inherit; font: inherit; font-size: 12px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; } button { cursor: pointer; } button:disabled, fieldset:disabled { opacity: .55; cursor: default; } button:hover:not(:disabled) { border-color: var(--accent); } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; } button.primary { color: white; background: var(--accent); }
label { display: grid; gap: 6px; font-size: 12px; margin: 8px 0; } .task-list > label { display: flex; align-items: center; } textarea { width: 100%; resize: vertical; font-family: var(--font-mono); } fieldset { border: 1px solid var(--border); border-radius: 4px; margin: 14px 0; padding: 10px; } legend { font-size: 12px; color: var(--muted); } .action-choice { padding: 5px 0; border-bottom: 1px solid var(--border); } .action-choice:last-child { border-bottom: 0; } .action-choice > label { display: flex; gap: 10px; align-items: flex-start; margin: 4px 0; } .action-choice input { margin-top: 3px; } .action-choice small { margin-top: 3px; } .action-choice em { font-style: normal; font-weight: normal; color: var(--muted); font-size: 11px; margin-left: 5px; } .action-contract { margin: 4px 0 5px 23px; color: var(--muted); } .actions, .workset-import { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; } .workset-import select { max-width: 240px; }
.table-scroll { overflow: auto; } table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; } th, td { border-bottom: 1px solid var(--border); vertical-align: top; padding: 8px; overflow-wrap: anywhere; } th { color: var(--muted); font-weight: 500; } pre { margin: 4px 0; white-space: pre-wrap; max-height: 220px; overflow: auto; font-size: 11px; } .run-detail { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; } details { margin-top: 10px; font-size: 12px; } .plan ol, .plan ul { font-size: 12px; line-height: 1.7; } @media(max-width: 860px) { .task-layout { grid-template-columns: 1fr; } }
.auto-monitor { display: inline-flex; align-items: center; gap: 5px; margin: 0; white-space: nowrap; } .block-actions { margin: 0; } .action-order { border: 1px solid var(--border); border-radius: 5px; padding: 10px; margin: 10px 0; font-size: 12px; } .action-order ol { padding-left: 24px; } .action-order li { padding: 6px 0; } .action-order li > span { display: inline-block; min-width: 190px; margin-right: 10px; } .action-order li > .actions { display: inline-flex; } .retry-groups { margin: 14px 0; } .retry-group { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 5px; margin: 8px 0; } .retry-group > div { min-width: 0; } .retry-group > button { flex-shrink: 0; }
</style>
