import type { AssemblyUpdateJob } from "../../../../shared/assembly-maintenance";
import type { AssemblyMaintenanceContext } from "./controller";
import type { AssemblyUpdateApi, AssemblyUpdateReconciliation } from "./updateApi";

export interface AssemblyUpdateState {
  busy: boolean; publishing: boolean; cancelling: boolean; unknown: boolean; error: string;
  selectedObjects: string[]; job: AssemblyUpdateJob | null; history: AssemblyUpdateReconciliation[]; historyLoaded: boolean; historyTruncated: boolean; reconciliation: AssemblyUpdateReconciliation | null;
}
type Uncertain = { id: string | null; job: AssemblyUpdateJob | null; kind: "start" | "preview" | "publish" };
// Retain uncertain pointers across closing/reopening this dialog in the same
// app session. They are scoped to both workspace and host, never global UI data.
const uncertain = new Map<string, Uncertain>();
const key = (context: AssemblyMaintenanceContext) => JSON.stringify([context.workspacePath, context.filePath]);
const previewOwned = (job: AssemblyUpdateJob | null) => !!job && ["preparing", "ready"].includes(job.status) && job.phase !== "publishing";
export function normalizeAssemblyUpdateFilePath(value: string): string {
  let normalized = typeof value === "string" ? value.replace(/\\/g, "/") : "";
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (!normalized || !/\.fcstd$/i.test(normalized) || /^[\/]|[:\x00-\x1f]/.test(normalized)
    || normalized.split("/").some(part => !part || part === "." || part === "..")) throw new Error("invalid_file_context");
  return normalized;
}
export function safeAssemblyUpdateDiagnostic(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const checked = value.replace(/[\p{Script=Han}]\/(?=[\p{Script=Han}])/gu, match => match.replace("/", "∕"));
  if (/[\\/\x00-\x1f]|[A-Za-z]:/.test(checked)) return "含本地路径的详细诊断仅保留在本地记录。";
  return value.slice(0, 1024);
}
export function createAssemblyUpdateController(api: AssemblyUpdateApi, hooks: {
  change: (state: AssemblyUpdateState) => void;
  busyChange?: (busy: boolean) => void;
  log?: (entry: { message: string; problem: boolean }) => void;
  published?: (event: { filePath: string; outputRel: string }) => void;
}, options: { now?: () => number; pollMs?: number } = {}) {
  let context: AssemblyMaintenanceContext | null = null, sequence = 0, timer: ReturnType<typeof setTimeout> | null = null;
  let read: AbortController | null = null;
  const publicationsInFlight = new Set<string>();
  const publicationKey = (current: AssemblyMaintenanceContext, id: string) => JSON.stringify([current.workspacePath, current.filePath, id]);
  const publishing = (current: AssemblyMaintenanceContext | null, job: AssemblyUpdateJob | null) => !!current && !!job && publicationsInFlight.has(publicationKey(current, job.id));
  let state: AssemblyUpdateState = { busy: false, publishing: false, cancelling: false, unknown: false, error: "", selectedObjects: [], job: null, history: [], historyLoaded: false, historyTruncated: false, reconciliation: null };
  const emitted = new Set<string>(), now = options.now ?? Date.now;
  function set(patch: Partial<AssemblyUpdateState>) {
    const wasBusy = state.busy; state = { ...state, ...patch };
    hooks.change({ ...state, selectedObjects: [...state.selectedObjects], history: [...state.history] });
    if (wasBusy !== state.busy) hooks.busyChange?.(state.busy);
  }
  function stop() { if (timer) clearTimeout(timer); timer = null; read?.abort(); read = null; }
  function bound(job: AssemblyUpdateJob, current: AssemblyMaintenanceContext, id?: string, selected?: string[]) {
    if (normalizeAssemblyUpdateFilePath(job.file_path) !== current.filePath || (id && job.id !== id)
      || (selected && JSON.stringify([...job.selected_objects].sort()) !== JSON.stringify([...selected].sort()))) throw new Error("job_context_mismatch");
  }
  function announce(job: AssemblyUpdateJob) {
    if (job.status === "ready" && job.preview) hooks.log?.({ message: `[装配更新] ${job.file_path}：已生成独立重开验证的暂存预览，新增 ${job.preview.added.length}、移除 ${job.preview.removed.length}；尚未发布。`, problem: false });
    else if (job.status === "unchanged") hooks.log?.({ message: `[装配更新] ${job.file_path}：未产生实际增删差异，不宣称已修复或已同步。`, problem: false });
    else if (["blocked", "failed", "needs_reconcile"].includes(job.status)) hooks.log?.({ message: `[装配更新] ${job.file_path}：${job.status === "needs_reconcile" ? "结果未知，仅可核对记录，不自动重放" : "验证未通过，未获发布许可"}。`, problem: true });
    if (job.error) {
      const code = /^[a-z][a-z0-9_]{0,63}$/.test(job.error.code) ? job.error.code : "diagnostic_unavailable";
      hooks.log?.({ message: `[装配更新] ${job.file_path}：${code} · ${safeAssemblyUpdateDiagnostic(job.error.message)}`, problem: true });
    }
    for (const warning of job.warnings.slice(0, 100)) {
      const message = safeAssemblyUpdateDiagnostic(warning);
      if (message) hooks.log?.({ message: `[装配更新范围] ${job.file_path}：${message}`, problem: false });
    }
  }
  function accept(job: AssemblyUpdateJob, current: AssemblyMaintenanceContext, notify = true) {
    const unknown = job.status === "needs_reconcile" || job.phase === "publishing";
    if (unknown) uncertain.set(key(current), { id: job.id, job, kind: "publish" });
    else uncertain.delete(key(current));
    set({ job, busy: job.status === "preparing", publishing: false, unknown, error: "" });
    if (notify) announce(job);
    if (job.status === "published" && job.output_rel && !emitted.has(job.id)) {
      emitted.add(job.id);
      hooks.log?.({ message: `[装配更新] ${job.output_rel === job.file_path ? "已发布宿主更新" : "已生成验证副本，原宿主未改写"}：${job.output_rel}。`, problem: false });
      hooks.published?.({ filePath: current.filePath, outputRel: job.output_rel });
    }
    if (job.status === "preparing") schedule();
  }
  function unknown(current: AssemblyMaintenanceContext, marker: Uncertain, message: string, token: number) {
    uncertain.set(key(current), marker);
    if (token !== sequence) return;
    stop(); set({ busy: false, publishing: false, unknown: true, error: message });
    hooks.log?.({ message: `[装配更新] ${current.filePath}：${message}`, problem: true });
  }
  function cancelDetached(current: AssemblyMaintenanceContext, job: AssemblyUpdateJob) {
    void api.cancel({ workspacePath: current.workspacePath, id: job.id }).catch(() => {
      uncertain.set(key(current), { id: job.id, job, kind: "preview" });
    });
  }
  function close() {
    const previous = context, job = state.job, isPublishing = publishing(previous, job) || state.publishing || job?.phase === "publishing";
    sequence++; stop(); context = null;
    if (previous && job && previewOwned(job) && !isPublishing && !state.cancelling && !state.unknown && uncertain.get(key(previous))?.kind !== "publish") cancelDetached(previous, job);
    set({ busy: false, publishing: false, cancelling: false, unknown: false, error: "", selectedObjects: [], job: null, history: [], historyLoaded: false, historyTruncated: false, reconciliation: null });
  }
  function setContext(next: AssemblyMaintenanceContext | null) {
    close();
    try { context = next ? { ...next, filePath: normalizeAssemblyUpdateFilePath(next.filePath) } : null; }
    catch { context = null; set({ error: "文件路径无效，请重新选择工作空间内的 FCStd 文件。" }); }
    if (!context) return;
    const marker = uncertain.get(key(context));
    if (marker) set({ unknown: true, job: marker.job, selectedObjects: [...marker.job?.selected_objects ?? []], error: "上次请求结果未确认，仅可核对记录，不自动重放。" });
  }
  function select(names: string[]) {
    if (state.busy || state.publishing || state.unknown || previewOwned(state.job)) return;
    set({ selectedObjects: [...new Set(names)], error: "" });
  }
  function canPublish() {
    const job = state.job;
    return !state.busy && !state.publishing && !publishing(context, job) && !state.unknown && !!job && job.status === "ready" && job.phase === "ready"
      && job.can_publish && !!job.preview && job.preview.added.length + job.preview.removed.length > 0 && !!job.expires_at && Date.parse(job.expires_at) > now();
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void status(); }, options.pollMs ?? 1000);
  }
  async function start() {
    const current = context; if (!current || state.busy || state.publishing || state.unknown || previewOwned(state.job) || !state.selectedObjects.length) return;
    const token = sequence, selected = [...state.selectedObjects]; stop();
    set({ busy: true, error: "", job: null, history: [], historyLoaded: false, historyTruncated: false, reconciliation: null });
    uncertain.set(key(current), { id: null, job: null, kind: "start" });
    try {
      const job = await api.start({ ...current, selectedObjects: selected }); bound(job, current, undefined, selected);
      if (token !== sequence) {
        uncertain.delete(key(current)); if (previewOwned(job)) cancelDetached(current, job); return;
      }
      accept(job, current);
    } catch { unknown(current, { id: null, job: null, kind: "start" }, "预览请求接纳结果未确认，请核对记录；不要重复生成。", token); }
  }
  async function status() {
    const current = context, job = state.job; if (!current || !job || state.publishing) return;
    if (state.unknown) { await reconcile(); return; }
    const token = sequence; read?.abort(); const request = new AbortController(); read = request;
    try {
      const next = await api.status({ workspacePath: current.workspacePath, id: job.id }, request.signal); bound(next, current, job.id, job.selected_objects);
      if (token !== sequence || request.signal.aborted) return;
      accept(next, current, next.status !== job.status);
    } catch {
      if (token !== sequence || request.signal.aborted) return;
      unknown(current, { id: job.id, job, kind: uncertain.get(key(current))?.kind ?? "preview" }, "状态读取未确认，仅可核对或取消自有预览。", token);
    }
  }
  async function cancel() {
    const current = context, job = state.job;
    if (!current || !job || !previewOwned(job) || publishing(current, job) || state.publishing || state.cancelling || uncertain.get(key(current))?.kind === "publish") return;
    const token = sequence; stop(); set({ busy: true, cancelling: true, error: "" });
    try {
      const next = await api.cancel({ workspacePath: current.workspacePath, id: job.id }); bound(next, current, job.id);
      if (token === sequence) accept(next, current);
    } catch { unknown(current, { id: job.id, job, kind: "preview" }, "取消回执未确认，请核对记录；不自动重试。", token); }
    finally { if (token === sequence) set({ cancelling: false }); }
  }
  async function publish(mode: "verified_copy" | "replace_source" = "verified_copy", confirmedClosed = false, confirmedNotReopened = false) {
    const current = context, job = state.job;
    if (!current || !job || !canPublish() || (mode === "replace_source" && (!confirmedClosed || !confirmedNotReopened))) return;
    const token = sequence, publishingKey = publicationKey(current, job.id); stop(); publicationsInFlight.add(publishingKey);
    uncertain.set(key(current), { id: job.id, job, kind: "publish" });
    set({ busy: true, publishing: true, error: "" });
    try {
      const next = await api.publish({ workspacePath: current.workspacePath, id: job.id, mode, confirmedClosed, confirmedNotReopened }); bound(next, current, job.id, job.selected_objects);
      if (token !== sequence) {
        if (next.status !== "needs_reconcile" && next.phase !== "publishing") uncertain.delete(key(current));
        else uncertain.set(key(current), { id: job.id, job: next, kind: "publish" });
        return;
      }
      accept(next, current);
    } catch { unknown(current, { id: job.id, job, kind: "publish" }, "发布结果未知，仅可核对记录，不能再次发布或取消发布。", token); }
    finally { publicationsInFlight.delete(publishingKey); }
  }
  async function loadHistory() {
    const current = context; if (!current || state.publishing || state.busy) return;
    const token = sequence; stop(); set({ busy: true, error: "", reconciliation: null }); read = new AbortController(); const request = read;
    try {
      const result = await api.history({ workspacePath: current.workspacePath, limit: 30 }, request.signal);
      if (token === sequence && !request.signal.aborted) set({ busy: false, historyLoaded: true, historyTruncated: result.truncated,
        history: result.records.filter(record => !record.operation || normalizeAssemblyUpdateFilePath(record.operation.file_path) === current.filePath) });
    } catch {
      if (token === sequence && !request.signal.aborted) set({ busy: false, error: "历史读取未完成；请使用已知任务编号只读核对，不要重放发布。" });
    }
  }
  async function reconcile(id?: string) {
    const current = context; if (!current || state.publishing || state.busy) return;
    const wanted = id === undefined ? state.job?.id ?? uncertain.get(key(current))?.id : id.trim().toLowerCase();
    if (!wanted && id === undefined) { await loadHistory(); return; }
    if (!wanted || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(wanted)) {
      set({ error: "请输入完整有效的任务 UUID；只读核对不会恢复发布权限。" }); return;
    }
    const token = sequence; stop(); set({ busy: true, error: "", reconciliation: null }); read = new AbortController(); const request = read;
    try {
      const next = await api.reconcile({ workspacePath: current.workspacePath, id: wanted }, request.signal);
      if (next.id !== wanted || (next.operation && normalizeAssemblyUpdateFilePath(next.operation.file_path) !== current.filePath)) throw new Error("job_context_mismatch");
      if (token === sequence && !request.signal.aborted) set({ busy: false, reconciliation: next });
    } catch {
      if (token === sequence && !request.signal.aborted) set({ busy: false, error: "记录核对未完成；请保留任务编号，不要重放发布。" });
    }
  }
  return { setContext, select, start, status, cancel, publish, reconcile, loadHistory, close, canPublish };
}
