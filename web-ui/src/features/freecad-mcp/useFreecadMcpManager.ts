import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import type { FreecadMcpConnection, FreecadMcpInstallPlan, FreecadMcpSettings, FreecadMcpStatus } from "../../../../shared/freecad-mcp/contracts";
import type { OwnedWorkerObservation } from "../../../../shared/freecad-mcp/worker";
import { freecadMcpApi, type FreecadMcpApi } from "./api";

const defaultSettings = (): FreecadMcpSettings => ({ mode: "owned_batch", mod_directory: "", mod_directory_confirmed: false, existing_port: 9876 });
const copy = (settings: FreecadMcpSettings): FreecadMcpSettings => ({ ...settings });
export function useFreecadMcpManager(api: FreecadMcpApi = freecadMcpApi, prompt = pnwPromptChoice) {
  const opened = ref(false), status = ref<FreecadMcpStatus | null>(null), draft = reactive(defaultSettings());
  const operation = ref(""), error = ref(""), message = ref(""), plan = ref<FreecadMcpInstallPlan | null>(null);
  const connection = ref<FreecadMcpConnection | null>(null), outcomeUnknown = ref(false);
  const worker = ref<OwnedWorkerObservation | null>(null), workerOutcomeUnknown = ref(false), workerStale = ref(false), workerConfirming = ref(false);
  let workerPending: { kind: "start" | "stop"; id: string | null; revision: string } | undefined;
  let workerBoundId: string | null = null, workerBoundRevision: string | null = null, draftEpoch = 0;
  let workerTimer: ReturnType<typeof setTimeout> | undefined, workerRead: AbortController | undefined, workerReadEpoch = 0;
  const planClock = ref(Date.now());
  let epoch = 0, read: AbortController | undefined, accepting = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  function clearExpiryTimer() { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; }
  // One local expiry wake-up only: no service polling or automatic re-preview.
  watch([opened, plan], () => {
    clearExpiryTimer(); planClock.value = Date.now();
    if (!opened.value || plan.value?.state !== "ready") return;
    const expiry = Date.parse(plan.value.expires_at || "");
    if (!Number.isFinite(expiry) || expiry <= planClock.value) return;
    expiryTimer = setTimeout(() => { expiryTimer = undefined; planClock.value = Date.now(); }, Math.min(expiry - planClock.value, 2_147_483_647));
  }, { flush: "sync" });
  const busy = computed(() => Boolean(operation.value) || workerConfirming.value);
  const writing = computed(() => operation.value === "save" || operation.value === "apply");
  const dirty = computed(() => {
    const saved = status.value?.settings;
    return Boolean(saved && (draft.mode !== saved.mode || draft.mod_directory !== saved.mod_directory
      || draft.mod_directory_confirmed !== saved.mod_directory_confirmed || draft.existing_port !== saved.existing_port));
  });
  const currentConnection = computed(() => dirty.value ? null : connection.value ?? status.value?.connection ?? null);
  const configurationLocked = computed(() => Boolean(worker.value?.owned || workerOutcomeUnknown.value));
  const workerLabel = computed(() => workerOutcomeUnknown.value ? "操作结果未知，须刷新原实例（不重新启动）" : workerStale.value || dirty.value ? "设置已修改，旧实例不代表此配置就绪" : worker.value ? ({ idle: "未启动", starting: "正在启动", ready: "连接测试就绪（非批次授权）", leased: "专用实例使用中", stopping: "正在停止，等待实际退出", stopped: "自有实例已退出", failed: "启动或会话失败", unknown: "结果未知，须核对原实例" })[worker.value.phase] : "尚未观察独立 worker");
  const workerReason = computed(() => status.value?.owned_worker?.reason || "未启用宿主开发候选或未配置固定候选资源，不能启动；不会自动下载或回退。");
  const canStartWorker = computed(() => Boolean(opened.value && status.value && !busy.value && !dirty.value && !outcomeUnknown.value && !workerOutcomeUnknown.value
    && status.value.settings.mode === "owned_batch" && status.value.resource.state === "ready" && status.value.freecad.state === "available"
    && status.value.owned_worker?.enabled && !workerStale.value && worker.value && !worker.value.owned && ["idle", "stopped", "failed"].includes(worker.value.phase)));
  // A disabled candidate does not revoke responsibility for an already-owned child.
  const canStopWorker = computed(() => Boolean(opened.value && !busy.value && !workerOutcomeUnknown.value && worker.value?.owned && worker.value.id && worker.value.phase !== "stopping"));
  const canPreview = computed(() => Boolean(status.value && !busy.value && !configurationLocked.value && !dirty.value && !outcomeUnknown.value
    && status.value.resource.state === "ready" && status.value.mod_directory.state === "filesystem_checked"
    && status.value.mod_directory.evidence === "user_confirmed" && ["absent", "managed"].includes(status.value.installation.state)));
  const planExpired = computed(() => plan.value?.state === "ready" && Date.parse(plan.value.expires_at || "") <= planClock.value);
  const canApply = computed(() => !busy.value && !configurationLocked.value && !dirty.value && !outcomeUnknown.value && plan.value?.state === "ready"
    && Boolean(plan.value.plan_id) && !planExpired.value && Date.parse(plan.value.expires_at || "") > planClock.value);
  const summary = computed(() => {
    if (!status.value) return "尚未检测插件与连接";
    const installation = ({ not_checked: "插件未检测", absent: "插件未安装", managed: "插件文件已安装", unmanaged: "非受管安装", modified: "插件文件有改动", invalid: "插件文件无效" })[status.value.installation.state];
    const ready = currentConnection.value?.state === "ready" && currentConnection.value.mcp_verified && currentConnection.value.phase === "mcp";
    return `${installation}${status.value.installation.version ? ` ${status.value.installation.version}` : ""} · ${ready ? "上次 MCP 检查通过（非持续连接）" : "MCP 未就绪"}`;
  });
  function observeWorker(next: OwnedWorkerObservation | undefined, revision: string) {
    if (!next) { worker.value = null; return; }
    if (workerPending && (workerPending.kind === "start" && revision !== workerPending.revision || workerPending.id && next.id !== workerPending.id)) {
      worker.value = null; workerOutcomeUnknown.value = true; return;
    }
    if (next.id && (next.id !== workerBoundId || !next.owned && ["stopped", "failed"].includes(next.phase))) { workerBoundId = next.id; workerBoundRevision = revision; }
    workerStale.value = Boolean(next.id && workerBoundRevision !== revision);
    worker.value = { ...next };
    if (workerPending && next.id && (next.owned || ["stopped", "failed"].includes(next.phase))) { workerPending = undefined; workerOutcomeUnknown.value = false; }
  }
  function accept(next: FreecadMcpStatus, acceptWorker = true) {
    const previous = status.value, previousWorker = worker.value;
    accepting = true; status.value = next; Object.assign(draft, copy(next.settings)); accepting = false;
    plan.value = null; connection.value = null;
    if (acceptWorker) {
      if (!workerPending) workerOutcomeUnknown.value = false;
      if (previous && previous.revision !== next.revision && previousWorker?.id && previousWorker.id === next.owned_worker?.observation.id) workerStale.value = true;
      else if (!previous || previousWorker?.id !== next.owned_worker?.observation.id) workerStale.value = false;
      observeWorker(next.owned_worker?.observation, next.revision);
    }
  }
  function observeConnection(next: FreecadMcpConnection) {
    const observed = { ...next, supported_methods: [...next.supported_methods] };
    connection.value = observed;
    // Keep the fallback snapshot current too, without mutating an API response.
    // Draft reset and failed refreshes must not revive an invalidated old ready.
    if (status.value) status.value = { ...status.value, connection: { ...observed, supported_methods: [...observed.supported_methods] } };
  }
  watch(() => draft.mod_directory, () => { if (!accepting) draft.mod_directory_confirmed = false; }, { flush: "sync" });
  watch(draft, () => { if (!accepting) { ++draftEpoch; plan.value = null; connection.value = null; workerStale.value = true; message.value = ""; stopWorkerPolling(); } }, { flush: "sync" });
  function resetDraft() { if (!busy.value && status.value) accept(status.value, false); }
  function stopWorkerPolling() { if (workerTimer !== undefined) clearTimeout(workerTimer); workerTimer = undefined; ++workerReadEpoch; workerRead?.abort(); workerRead = undefined; }
  function scheduleWorkerPoll() {
    if (workerTimer !== undefined) clearTimeout(workerTimer); workerTimer = undefined;
    if (!opened.value || dirty.value || busy.value || workerStale.value || !worker.value || !["starting", "ready", "leased", "stopping"].includes(worker.value.phase)) return;
    workerTimer = setTimeout(() => { workerTimer = undefined; void refreshWorker(); }, 5000);
  }
  async function refreshWorker() {
    if (!opened.value || !status.value || dirty.value || busy.value) return;
    const ticket = epoch, revision = status.value.revision, observationId = workerPending?.id ?? worker.value?.id ?? null, readTicket = ++workerReadEpoch;
    workerRead?.abort(); workerRead = new AbortController();
    try {
      const result = await api.status(workerRead.signal);
      if (ticket !== epoch || readTicket !== workerReadEpoch || !opened.value || dirty.value || status.value?.revision !== revision) return;
      if (result.revision !== revision) { workerStale.value = true; worker.value = null; error.value = "服务设置已变化，请重新检测；旧 worker 观察不会继承。"; return; }
      if (observationId && result.owned_worker?.observation.id !== observationId) { worker.value = null; workerOutcomeUnknown.value = true; error.value = "原 worker 身份已变化，请重新检测；不会自动启动替代实例。"; return; }
      status.value = { ...status.value, owned_worker: result.owned_worker };
      observeWorker(result.owned_worker?.observation, revision);
    } catch {
      if (ticket === epoch && readTicket === workerReadEpoch && opened.value) {
        error.value = "worker 状态暂未取得；不会自动启动或重放，请核对原实例。";
        if (worker.value) worker.value = { ...worker.value, phase: "unknown", reason_code: "session_lost", message: "本次状态未取得，旧的就绪观察不代表当前仍然就绪。" };
      }
    }
    finally { if (readTicket === workerReadEpoch) { workerRead = undefined; scheduleWorkerPoll(); } }
  }
  watch([opened, operation, worker, dirty, workerConfirming], scheduleWorkerPoll, { flush: "sync" });
  async function refresh() {
    if (busy.value || dirty.value) return;
    const ticket = ++epoch; read?.abort(); read = new AbortController(); operation.value = "inspect"; error.value = "";
    try { const result = await api.status(read.signal); if (ticket === epoch && opened.value) { accept(result); outcomeUnknown.value = false; } }
    catch (cause) {
      if (ticket === epoch && opened.value) {
        error.value = String(cause);
        if (worker.value) worker.value = { ...worker.value, phase: "unknown", reason_code: "session_lost", message: "本次检测未完成，旧观察不代表当前仍然就绪。" };
      }
    }
    finally { if (ticket === epoch) operation.value = ""; }
  }
  async function open() { opened.value = true; await refresh(); }
  function close() {
    if (writing.value) return;
    if (operation.value === "check") observeConnection({ state: "not_checked", phase: "none", reason: "本次 MCP 连接检查已取消；未取得新的成功观察。", bridge_version: null, supported_methods: [], mcp_verified: false });
    opened.value = false; ++epoch; read?.abort(); stopWorkerPolling(); operation.value = ""; plan.value = null;
  }
  async function save() {
    if (!status.value || busy.value || configurationLocked.value || !dirty.value) return;
    const ticket = ++epoch, settings = copy(draft), revision = status.value.revision;
    operation.value = "save"; error.value = ""; plan.value = null;
    try { const result = await api.save(settings, revision); if (ticket === epoch && opened.value) { accept(result); message.value = "设置已保存。安装文件与运行连接须分别检查。"; } }
    catch (cause) { if (ticket === epoch) error.value = String(cause); }
    finally { if (ticket === epoch) operation.value = ""; }
  }
  async function preview() {
    if (!canPreview.value || !status.value) return;
    const ticket = ++epoch; read = new AbortController(); operation.value = "preview"; error.value = ""; plan.value = null;
    try { const result = await api.preview(status.value.revision, read.signal); if (ticket === epoch && opened.value) plan.value = result; }
    catch (cause) { if (ticket === epoch) error.value = String(cause); }
    finally { if (ticket === epoch) operation.value = ""; }
  }
  async function check() {
    if (!status.value || busy.value || configurationLocked.value || dirty.value || outcomeUnknown.value) return;
    const ticket = ++epoch; read = new AbortController(); operation.value = "check"; error.value = "";
    observeConnection({ state: "not_checked", phase: "none", reason: "正在检查本次 MCP 连接；旧的成功观察不表示当前连接有效。", bridge_version: null, supported_methods: [], mcp_verified: false });
    try { const result = await api.check(status.value.revision, read.signal); if (ticket === epoch && opened.value) observeConnection(result); }
    catch (cause) {
      if (ticket === epoch && opened.value) {
        observeConnection({ state: "failed", phase: "none", reason: "本次 MCP 连接检查未完成，旧的成功观察已失效；不会自动重试。", bridge_version: null, supported_methods: [], mcp_verified: false });
        error.value = String(cause);
      }
    }
    finally { if (ticket === epoch) operation.value = ""; }
  }
  async function apply() {
    if (!canApply.value || !plan.value) return;
    if (Date.parse(plan.value.expires_at || "") <= Date.now()) { plan.value = null; return; }
    const selected = plan.value, ticket = epoch;
    const answer = await prompt({ title: "确认 FreeCAD 插件安装 / 更新", message: `仅安装计划中的插件文件，不重启 FreeCAD，不保存 CAD。\n本地固定资源；摘要核验不代表已发布。\n版本：${selected.source_version}\n摘要：${selected.source_digest}\n目标：${selected.target}\n备份目录：${selected.backup_parent}\n变更：${selected.changes?.length ?? 0} 项`, defaultChoiceId: "cancel", choices: [{ id: "cancel", label: "取消" }, { id: "apply", label: "确认安装", variant: "primary" }] });
    if (answer.choiceId !== "apply" || ticket !== epoch || !opened.value || plan.value !== selected || !canApply.value) return;
    if (Date.parse(selected.expires_at || "") <= Date.now()) { plan.value = null; return; }
    operation.value = "apply"; error.value = ""; plan.value = null;
    try {
      const result = await api.apply(selected.plan_id!);
      if (ticket === epoch && opened.value) { accept(result.status); message.value = `${result.state === "unchanged" ? "文件无变化" : "插件文件已安装"}。${result.restart_required ? "当前 FreeCAD 可能尚未加载，需用户择机重启并检查连接。" : "请单独检查运行连接。"}${result.backup ? ` 备份：${result.backup}` : ""}`; }
    } catch (cause) {
      if (ticket === epoch) { outcomeUnknown.value = true; error.value = `${String(cause)}\n未取得明确完成回执，不会自动重发。请重新检测文件状态后重新预览。`; }
    } finally { if (ticket === epoch) operation.value = ""; }
  }
  async function workerCommand(kind: "start" | "stop") {
    if (kind === "start" ? !canStartWorker.value : !canStopWorker.value) return;
    const ticket = epoch, draftTicket = draftEpoch, revision = status.value!.revision, selected = worker.value, selectedId = selected?.id;
    workerConfirming.value = true;
    let answer;
    try { answer = await prompt({ title: kind === "start" ? "启动独立 worker（连接测试）" : "停止自有 worker", message: kind === "start"
      ? "将启动一个专用 FreeCAD GUI 进程，仅用于连接测试，仍是开发候选，不代表批次能力已开放。\n不接管或关闭现有 FreeCAD / CAD，不打开或保存工程。关闭设置面板不会停止该进程。\n是否明确授权启动？"
      : "只请求停止当前 manager UUID 负责的专用 worker，等待自有子进程实际退出；不按 PID 查杀，不关闭其他 FreeCAD 或 CAD。\n关闭面板不会代替本次停止。是否确认？", defaultChoiceId: "cancel", choices: [{ id: "cancel", label: "取消" }, { id: kind, label: kind === "start" ? "确认启动连接测试" : "确认停止自有 worker", variant: "primary" }] }); }
    catch { error.value = "未取得明确确认，不会启动或停止进程。"; return; }
    finally { workerConfirming.value = false; }
    if (answer.choiceId !== kind || ticket !== epoch || !opened.value || worker.value !== selected || (kind === "start" && (draftTicket !== draftEpoch || status.value?.revision !== revision)) || (kind === "start" ? !canStartWorker.value : !canStopWorker.value)) return;
    stopWorkerPolling(); operation.value = "worker-" + kind; error.value = ""; message.value = "";
    workerPending = { kind, id: kind === "stop" ? selectedId! : null, revision }; workerOutcomeUnknown.value = true;
    let observeAfterFailure = false;
    try {
      const result = kind === "start" ? await api.start(revision) : await api.stop(selectedId!);
      if (ticket === epoch && opened.value && (kind === "stop" || draftTicket === draftEpoch && !dirty.value && status.value?.revision === revision)) {
        observeWorker(result, status.value!.revision);
        message.value = kind === "start" ? "已提交独立 worker 连接测试；owned 只表示 manager 负责，不等于 Native 已就绪或批次可用。" : result.phase === "stopped" && !result.owned ? "已收到自有进程实际退出后的停止观察。" : "停止状态尚待核对；不会将请求当作退出证明。";
      }
    } catch {
      if (ticket === epoch && opened.value) { error.value = "worker 操作结果未知；先刷新原实例状态，不会自动重新启动或重发。"; observeAfterFailure = true; }
    } finally { if (ticket === epoch) operation.value = ""; }
    if (observeAfterFailure) await refreshWorker();
  }
  const startWorker = () => workerCommand("start"), stopWorker = () => workerCommand("stop");
  onScopeDispose(() => { ++epoch; read?.abort(); clearExpiryTimer(); stopWorkerPolling(); });
  return { opened, status, draft, operation, error, message, plan, connection: currentConnection, outcomeUnknown, worker, workerLabel, workerReason, workerOutcomeUnknown, workerStale, configurationLocked, canStartWorker, canStopWorker, busy, writing, dirty, canPreview, canApply, planExpired, summary, open, close, refresh, refreshWorker, resetDraft, save, preview, check, apply, startWorker, stopWorker };
}
export type FreecadMcpManager = ReturnType<typeof useFreecadMcpManager>;
