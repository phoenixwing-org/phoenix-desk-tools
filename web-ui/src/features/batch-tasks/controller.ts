import { computed, reactive } from "vue";
import { isActiveRun, isCurrentPlan, type ActionDescriptor, type ActionSelection, type BatchPlan, type BatchRun, type BatchTask, type RunDetail, type TaskDraft } from "../../../../shared/batch-tasks/contracts";
import { batchTasksApi, type AdmissionRequest, type AdmissionRecovery, type BatchTasksApi, type RetryDraftGroup } from "./api";
import { batchStepTargetLabel, parseSubjectLines, runStatusLabel } from "./projection";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const RECOVERY_KEY = "phoenix-desk.batch-admission.v1:";
const CREATION_KEY = "phoenix-desk.batch-creation.v1:";
const emptyDraft = (): TaskDraft => ({ name: "新批量任务", subjects: [], actions: [] });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const httpStatus = (error: unknown) => error !== null && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Application-scoped projection of the server ledger, never an execution authority. */
export function createBatchTasksController(api: BatchTasksApi = batchTasksApi, storage?: StoragePort) {
  const state = reactive({
    workspace: "", actions: [] as ActionDescriptor[], tasks: [] as BatchTask[], runs: [] as BatchRun[],
    editingId: "", editingRevision: 0, draft: emptyDraft(), paths: "", baseline: "", plan: null as BatchPlan | null,
    selectedRunId: "", detail: null as RunDetail | null, loading: false, pending: "", error: "", notice: "", stale: false,
    admission: null as AdmissionRecovery | null,
    creationId: "", creationFingerprint: "", creationUncertain: false,
    retryRunId: "", retryGroups: [] as RetryDraftGroup[],
  });
  let generation = 0, projectionRevision = 0, refreshing = false, editorInitialized = false, timer: ReturnType<typeof setInterval> | undefined;
  const activeRuns = computed(() => state.runs.filter(run => isActiveRun(run.status)));
  const currentRun = computed(() => state.runs.find(run => run.id === state.selectedRunId) ?? activeRuns.value[0] ?? state.runs[0]);
  const draftSnapshot = () => JSON.stringify({ name: state.draft.name, actions: state.draft.actions, paths: state.paths });
  const dirty = computed(() => draftSnapshot() !== state.baseline);
  const busy = computed(() => !!state.pending);
  const currentTask = computed(() => state.tasks.find(task => task.id === state.editingId));
  const canRetryAdmission = computed(() => state.admission?.protocol_version === 2);
  function error(value: unknown) { state.error = message(value); }
  function saveRecovery() {
    try { if (state.admission) storage?.setItem(RECOVERY_KEY + state.workspace, JSON.stringify(state.admission)); else storage?.removeItem(RECOVERY_KEY + state.workspace); } catch { /* Local pointer only; DB remains authoritative. */ }
  }
  function saveCreationRecovery() {
    try {
      if (state.creationUncertain) storage?.setItem(CREATION_KEY + state.workspace, JSON.stringify({ id: state.creationId, fingerprint: state.creationFingerprint }));
      else storage?.removeItem(CREATION_KEY + state.workspace);
    } catch { /* Without storage, the current application session retains the key. */ }
  }
  function updateRun(run: BatchRun) { state.runs = [run, ...state.runs.filter(item => item.id !== run.id)]; if (state.detail?.run.id === run.id) state.detail.run = run; }
  function selectTask(task: BatchTask) {
    editorInitialized = true;
    state.creationId = ""; state.creationFingerprint = ""; state.creationUncertain = false; saveCreationRecovery();
    state.editingId = task.id; state.editingRevision = task.revision; state.draft = copy({ name: task.name, subjects: task.subjects, actions: task.actions });
    state.paths = task.subjects.map(subject => subject.rel).join("\n"); state.baseline = draftSnapshot(); state.plan = null; state.error = "";
  }
  function newTask(duplicate = false) {
    if (state.creationUncertain) { state.error = `原新建保存结果未确认（${state.creationId}），请刷新列表核对；不要另建同一任务。`; return; }
    editorInitialized = true;
    const draft = duplicate ? copy(state.draft) : emptyDraft();
    if (duplicate) draft.name += "（副本）";
    else if (state.actions[0]) draft.actions = [{ instance_id: requestId(), key: state.actions[0].key, version: state.actions[0].version, params: {} }];
    state.editingId = ""; state.editingRevision = 0; state.draft = draft; if (!duplicate) state.paths = "";
    state.baseline = ""; state.plan = null; state.error = "";
    state.creationId = requestId(); state.creationFingerprint = "";
  }
  function editName(value: string) { state.draft.name = value; state.plan = null; }
  function editPaths(value: string) { state.paths = value; state.plan = null; }
  function toggleAction(key: string, enabled: boolean) {
    const descriptor = state.actions.find(action => action.key === key);
    if (enabled && descriptor && !state.draft.actions.some(action => action.key === key)) state.draft.actions.push({ instance_id: requestId(), key, version: descriptor.version, params: {} });
    if (!enabled) state.draft.actions = state.draft.actions.filter(action => action.key !== key);
    state.plan = null;
  }
  function moveAction(instanceId: string, direction: "up" | "down") {
    if (busy.value || state.creationUncertain || !["up", "down"].includes(direction)) return false;
    const index = state.draft.actions.findIndex(action => action.instance_id === instanceId), target = index + (direction === "up" ? -1 : 1);
    if (index < 0 || target < 0 || target >= state.draft.actions.length) return false;
    const actions = [...state.draft.actions]; [actions[index], actions[target]] = [actions[target], actions[index]];
    state.draft.actions = actions; state.plan = null; return true;
  }
  async function operation<T>(name: string, action: (workspace: string) => Promise<T>, apply: (value: T) => void): Promise<boolean> {
    if (!state.workspace || busy.value) return false;
    const own = generation, workspace = state.workspace; state.pending = name; state.error = "";
    try { const value = await action(workspace); if (own !== generation) return false; projectionRevision++; apply(value); return true; }
    catch (cause) { if (own === generation) error(cause); return false; }
    finally { if (own === generation) state.pending = ""; }
  }
  async function refresh(): Promise<void> {
    if (!state.workspace || refreshing) return;
    const own = generation, revision = projectionRevision, workspace = state.workspace; refreshing = true; state.loading = true;
    try {
      const [catalog, tasks, runs] = await Promise.all([api.actions(workspace), api.tasks(workspace), api.runs(workspace)]);
      if (own !== generation || revision !== projectionRevision) return;
      const prior = new Map(state.runs.map(run => [run.id, run]));
      const issues = runs.runs.filter(run => prior.has(run.id) && isActiveRun(prior.get(run.id)!.status) && ["partial", "failed", "interrupted"].includes(run.status));
      const issue = issues[0];
      state.actions = catalog.actions; state.tasks = tasks.tasks; state.runs = runs.runs; state.stale = false;
      if (!editorInitialized) {
        editorInitialized = true;
        const task = !state.creationUncertain ? tasks.tasks.find(item => !item.archived) : undefined; if (task) selectTask(task);
      }
      let issueDetail: RunDetail | undefined;
      if (issue) {
        try { issueDetail = await api.detail(workspace, issue.id); } catch { /* Keep the proven terminal run visible even when its detail request fails. */ }
        if (own !== generation || revision !== projectionRevision) return;
        const problems = issueDetail?.run.id === issue.id ? issueDetail.steps.filter(step => ["failed", "blocked", "interrupted"].includes(step.status)) : [];
        const causes = problems.slice(0, 3).map(step => `${batchStepTargetLabel(step)} · ${step.action_key}：${step.message || "未完成，请查阅步骤"}`).join("；");
        state.error = `运行「${issue.task_name}」${runStatusLabel[issue.status]}：${causes.slice(0, 1400) || issue.message || "请打开步骤明细核对原因"}${problems.length > 3 ? `；另有 ${problems.length - 3} 项，请查看明细` : ""}。成功项已保留。${issues.length > 1 ? `另有 ${issues.length - 1} 个问题运行：${issues.slice(1, 4).map(run => run.task_name).join("、")}，请查看历史。` : ""}`;
      }
      if (state.selectedRunId) { const id = state.selectedRunId; const detail = issueDetail?.run.id === id ? issueDetail : await api.detail(workspace, id); if (own === generation && revision === projectionRevision && state.selectedRunId === id) state.detail = detail; }
    } catch (cause) { if (own === generation && revision === projectionRevision) { state.stale = true; error(cause); } }
    finally { if (own === generation) { state.loading = false; refreshing = false; } }
  }
  function setWorkspace(workspace: string) {
    if (workspace === state.workspace) return;
    generation++; refreshing = false; editorInitialized = false; Object.assign(state, { workspace, actions: [], tasks: [], runs: [], editingId: "", editingRevision: 0, draft: emptyDraft(), paths: "", baseline: "", plan: null, selectedRunId: "", detail: null, loading: false, pending: "", error: "", notice: "", stale: false, admission: null, creationId: "", creationFingerprint: "", creationUncertain: false, retryRunId: "", retryGroups: [] });
    try { const saved = JSON.parse(storage?.getItem(RECOVERY_KEY + workspace) ?? "null") as AdmissionRecovery | null;
      if (saved?.confirmed === true && typeof saved.client_request_id === "string" && typeof saved.plan_id === "string" && typeof saved.digest === "string" && [undefined, 1, 2].includes(saved.protocol_version)) {
        state.admission = { plan_id: saved.plan_id, digest: saved.digest, client_request_id: saved.client_request_id, confirmed: true, ...(saved.protocol_version === undefined ? {} : { protocol_version: saved.protocol_version }) };
      }
    } catch { /* Ignore corrupt local pointers, never restore run state. */ }
    try { const saved = JSON.parse(storage?.getItem(CREATION_KEY + workspace) ?? "null") as { id?: unknown; fingerprint?: unknown } | null;
      if (typeof saved?.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(saved.id) && typeof saved.fingerprint === "string") { state.creationId = saved.id; state.creationFingerprint = saved.fingerprint; state.creationUncertain = true; state.notice = `此空间有未确认的新建保存（${saved.id}），请刷新任务列表核对；没有自动恢复或执行草稿。`; }
    } catch { /* A pointer does not hydrate editable draft contents or authorize a run. */ }
    const own = generation;
    void refresh().then(() => { if (own === generation && state.admission) void recoverAdmission(); });
  }
  async function save() {
    if (busy.value || !state.workspace) return false;
    let draft: TaskDraft;
    try { draft = { name: state.draft.name.trim(), subjects: parseSubjectLines(state.paths).map(subject => ({ ...subject, kind: state.draft.subjects.find(original => original.rel === subject.rel)?.kind ?? subject.kind })), actions: copy(state.draft.actions) as ActionSelection[] };
      if (!draft.name || !draft.actions.length) throw new Error("请填写名称并选择至少一个动作");
    } catch (cause) { error(cause); return false; }
    const id = state.editingId || undefined, revision = id ? state.editingRevision : undefined;
    const own = generation;
    if (!id) {
      const fingerprint = JSON.stringify(draft);
      if (state.creationUncertain && fingerprint !== state.creationFingerprint) { state.error = `原新建保存结果未确认，草稿内容已经变化；请刷新列表核对原任务 ${state.creationId}，未发送新的定义。`; return false; }
      state.creationId ||= requestId(); state.creationFingerprint = fingerprint; state.creationUncertain = true; saveCreationRecovery();
    }
    const creationId = id ? undefined : state.creationId;
    let provenCreationRejected = false;
    const result = await operation("save", async workspace => {
      try { return await api.save(workspace, draft, id, revision, creationId); }
      catch (cause) {
        if (creationId && [400, 409, 410, 413, 422].includes(httpStatus(cause) ?? 0)) {
          // This endpoint returns the complete ledger, including archived tasks.
          // A 4xx alone is not proof that no task was committed before the error.
          try { const ledger = await api.tasks(workspace); provenCreationRejected = Array.isArray(ledger.tasks) && !ledger.tasks.some(task => task.id === creationId); }
          catch { /* Lookup failure preserves the original creation identity. */ }
        }
        throw cause;
      }
    }, ({ task }) => { state.tasks = [task, ...state.tasks.filter(item => item.id !== task.id)]; selectTask(task); state.notice = "任务定义已保存"; });
    if (!result && own === generation && creationId && provenCreationRejected && state.creationId === creationId) {
      state.creationId = ""; state.creationFingerprint = ""; state.creationUncertain = false; saveCreationRecovery();
      state.error = `新建已被拒绝，并确认完整任务列表不存在原创建标识；可以修正草稿后保存或新建。${state.error}`; return false;
    }
    if (!result && own === generation) state.error = `${id ? "定义保存结果未确认，请刷新列表核对 revision。" : "新建保存结果未确认；重试将复用原创建标识，请勿修改后另建。"}${state.error}`;
    return result;
  }
  async function archive(archived: boolean) {
    const task = currentTask.value; if (!task || dirty.value) return false;
    if (task.revision !== state.editingRevision) { state.error = "定义已被其他页面更新，请重新选择该任务后再操作。"; return false; }
    return operation("archive", workspace => api.archive(workspace, task, archived), ({ task: updated }) => { state.tasks = state.tasks.map(item => item.id === updated.id ? updated : item); selectTask(updated); });
  }
  async function preview() {
    const task = currentTask.value; if (!task || dirty.value || task.archived) return false;
    if (task.revision !== state.editingRevision) { state.plan = null; state.error = "定义已被其他页面更新，请重新选择该任务后预览；未使用旧界面确认新范围。"; return false; }
    return operation("preview", workspace => api.preview(workspace, task), ({ plan }) => { state.plan = plan; state.notice = "预览已冻结；确认后才接纳运行"; });
  }
  async function admit() {
    if (busy.value) return false;
    const plan = state.plan;
    if (!plan || dirty.value || plan.status !== "fresh" || !plan.summary.executable || Date.parse(plan.expires_at) <= Date.now()) { state.error = "请先生成有效预览"; return false; }
    if (!isCurrentPlan(plan) || plan.prepared?.protocol_version !== 2) { state.error = "旧版预览不能升级为 V2 接纳权限，请重新准备运行 / 预览。"; return false; }
    if (state.admission && state.admission.protocol_version !== 2) { state.error = "旧版接纳指针仅可核对原请求；请先核对，没有运行记录时重新预览。"; return false; }
    if (state.admission && state.admission.plan_id !== plan.id) { state.error = "存在结果未确认的接纳请求，请先核对"; return false; }
    state.admission ??= { protocol_version: 2, plan_id: plan.id, digest: plan.digest, client_request_id: requestId(), confirmed: true }; saveRecovery();
    return submitAdmission();
  }
  async function submitAdmission() {
    if (busy.value) return false;
    const admission = state.admission; if (!admission) return false;
    if (admission.protocol_version !== 2) { state.error = "旧版接纳指针仅可核对原请求，不能按 V2 重发旧计划；没有运行记录时请重新预览。"; return false; }
    const request: AdmissionRequest = { ...copy(admission), protocol_version: 2 };
    const own = generation;
    let provenRejected = false;
    const result = await operation("admit", async workspace => {
      try { return await api.admit(workspace, request); }
      catch (cause) {
        if (![400, 409, 410, 413, 422].includes(httpStatus(cause) ?? 0)) throw cause;
        // A rejected response alone is not proof: a commit could precede an error.
        try { return await api.byRequest(workspace, admission.client_request_id); }
        catch (lookupError) { provenRejected = httpStatus(lookupError) === 404; throw cause; }
      }
    }, ({ run }) => { updateRun(run); state.selectedRunId = run.id; state.admission = null; saveRecovery(); if (state.plan?.id === admission.plan_id) state.plan.status = "consumed"; state.notice = "运行已持久接纳；关闭显示不会取消"; });
    if (!result && own === generation && provenRejected && state.admission?.client_request_id === admission.client_request_id) {
      state.admission = null; saveRecovery(); state.plan = null; state.error = `后台已拒绝接纳，并确认原请求没有运行记录。请重新预览。${state.error}`; return false;
    }
    if (!result && own === generation && state.admission?.client_request_id === admission.client_request_id) state.error = `接纳结果未确认，请核对原请求；不要另建运行。${state.error}`;
    return result;
  }
  async function recoverAdmission() {
    const admission = state.admission; if (!admission) return false;
    const own = generation; let missing = false;
    const result = await operation("recover", async workspace => {
      try { return await api.byRequest(workspace, admission.client_request_id); }
      catch (cause) { missing = httpStatus(cause) === 404; throw cause; }
    }, ({ run }) => { updateRun(run); state.selectedRunId = run.id; state.admission = null; saveRecovery(); state.notice = "已找到原接纳请求的运行"; });
    if (!result && missing && admission.protocol_version !== 2 && own === generation && state.admission?.client_request_id === admission.client_request_id) {
      state.admission = null; state.plan = null; saveRecovery(); state.error = "已确认旧版请求没有运行记录；旧计划不会按 V2 重发，请重新准备运行 / 预览。";
    }
    return result;
  }
  async function selectRun(id: string) {
    state.selectedRunId = id; state.detail = null; state.retryRunId = ""; state.retryGroups = [];
    const own = generation, revision = projectionRevision, workspace = state.workspace;
    try { const detail = await api.detail(workspace, id); if (own === generation && revision === projectionRevision && state.selectedRunId === id) state.detail = detail; }
    catch (cause) { if (own === generation && revision === projectionRevision && state.selectedRunId === id) error(cause); }
  }
  async function loadRetryGroups(id = state.selectedRunId) {
    if (!id || busy.value || !state.workspace) return false;
    state.retryRunId = ""; state.retryGroups = [];
    return operation("retry-drafts", workspace => api.retryDrafts(workspace, id), value => {
      if (state.selectedRunId !== id || value.run_id !== id) return;
      state.retryRunId = id; state.retryGroups = copy(value.groups);
      state.notice = value.groups.length ? "按原动作实例拆分失败项；选择一组后仍须保存、重新预览、确认运行" : "没有可准备重试的失败、阻断或中断项；已成功、不适用和取消项不纳入";
    });
  }
  function startRetryGroup(value: RetryDraftGroup) {
    if (busy.value) return false;
    if (state.creationUncertain) { state.error = `原新建保存结果未确认（${state.creationId}），请先核对任务列表，未覆盖草稿。`; return false; }
    if (state.admission) { state.error = "接纳结果未确认，请先核对原请求，未建立重试草稿。"; return false; }
    const group = state.retryRunId === state.selectedRunId ? state.retryGroups.find(item => item.id === value.id) : undefined;
    if (!group?.available || !group.draft) { state.error = group?.reason || "重试候选已失效，请重新读取原运行的失败项"; return false; }
    const draft = copy(group.draft);
    if (draft.actions.length !== 1 || draft.actions[0].instance_id !== group.action_instance_id
      || !state.actions.some(action => action.key === draft.actions[0].key && action.version === draft.actions[0].version)) { state.error = "原动作精确版本已不可用，未自动升级或创建草稿"; return false; }
    newTask(); state.draft = draft; state.paths = draft.subjects.map(subject => subject.rel).join("\n");
    state.baseline = ""; state.plan = null; state.notice = "已准备独立重试草稿；未保存或执行。请核对范围后保存、重新预览并确认。"; return true;
  }
  async function cancel(id: string) {
    if (busy.value) return false;
    const own = generation;
    const result = await operation("cancel", workspace => api.cancel(workspace, id), ({ run }) => { updateRun(run); state.notice = "已记录取消请求；以后台安全边界后的状态为准"; });
    if (!result && own === generation) { const cancellationError = state.error; await refresh(); if (own === generation) state.error = `取消请求未确认；没有将任务标记为已取消。${cancellationError}`; }
    return result;
  }
  async function backup(): Promise<unknown | undefined> {
    let output: unknown;
    await operation("backup", workspace => api.backup(workspace), value => { output = value; state.notice = "逻辑任务备份已生成；不含源文件、缓存或外部输出"; });
    return output;
  }
  function startPolling() { if (!timer) timer = setInterval(() => { void refresh(); }, 2000); }
  function stopPolling() { if (timer) clearInterval(timer); timer = undefined; }
  return { state, activeRuns, currentRun, currentTask, canRetryAdmission, dirty, busy, setWorkspace, refresh, selectTask, newTask, editName, editPaths, toggleAction, moveAction, save, archive, preview, admit, submitAdmission, recoverAdmission, selectRun, loadRetryGroups, startRetryGroup, cancel, backup, startPolling, stopPolling };
}
export type BatchTasksController = ReturnType<typeof createBatchTasksController>;
