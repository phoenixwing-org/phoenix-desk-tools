import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { ApiError } from "../../api";
import { applyDrawingAudit, cancelDrawingBatchJob, fetchDrawingBatchJob, fetchDrawingTemplates, previewDrawingAudit, previewDrawingGeneration, startDrawingGeneration } from "./api";
import type { DrawingAuditFilter, DrawingAuditPreview, DrawingAuditRow, DrawingAuditSelection, DrawingBatchJob, DrawingGenerationPreview, DrawingPaper, DrawingTemplateCatalog, GenerationRow } from "./types";
import { DRAWING_REPAIR_MAX_ISSUES_PER_FILE } from "./types";
export type DrawingBatchHost = { appendLog(text: string, options: { source: string; open: boolean }): void; confirm(kind: "repair" | "generation", message: string): Promise<boolean>; changed?(workspace: string): void };
const running = (job: DrawingBatchJob | null | undefined) => !!job && (job.status === "queued" || job.status === "running");
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Volatile, single-flight plans and jobs. Only explicit user actions start writes. */
export function useDrawingBatch(workspace: Ref<string>, directory: Ref<string>, recursive: Ref<boolean>, host: DrawingBatchHost, active: Ref<boolean> = ref(true)) {
  const audit = shallowRef<DrawingAuditPreview | null>(null), generation = shallowRef<DrawingGenerationPreview | null>(null);
  const selectedIssues = ref<Record<string, string[]>>({}), selectedGeneration = ref<string[]>([]);
  const auditExpired = ref(false), generationExpired = ref(false), auditRejected = ref(false), generationRejected = ref(false), error = ref(""), phase = ref("");
  const pending = ref(false), jobs = shallowRef(new Map<string, DrawingBatchJob>());
  const templateRoot = ref(""), template = ref(""), paper = ref<DrawingPaper>("auto"), scale = ref("auto");
  const dimensionFont = ref("osifont"), annotationFont = ref("");
  const allowWithoutPdf = ref(true);
  const templates = shallowRef<DrawingTemplateCatalog | null>(null), query = ref(""), filter = ref<DrawingAuditFilter>("all");
  const job = computed(() => jobs.value.get(workspace.value) || null);
  const jobRunning = computed(() => running(job.value));
  const busy = computed(() => pending.value || jobRunning.value);
  let epoch = 0, selectionEpoch = 0, auditSettingsEpoch = 0, generationSettingsEpoch = 0, disposed = false, request: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined, auditTimer: ReturnType<typeof setTimeout> | undefined, generationTimer: ReturnType<typeof setTimeout> | undefined;
  const logged = new Set<string>(), finished = new Set<string>();
  const scopeKey = computed(() => JSON.stringify([workspace.value, directory.value, recursive.value]));
  const auditSettingsKey = computed(() => JSON.stringify([dimensionFont.value, annotationFont.value]));
  const generationSettingsKey = computed(() => JSON.stringify([templateRoot.value, template.value, paper.value, scale.value, allowWithoutPdf.value]));
  const canInteract = computed(() => !disposed && active.value && !!workspace.value && !!directory.value.trim() && !busy.value);
  const auditSelections = computed<DrawingAuditSelection[]>(() => (audit.value?.rows || []).filter(row => !row.error).map(row => ({ id: row.id, issue_ids: row.issues.filter(issue => issue.status === "ready" && selectedIssues.value[row.id]?.includes(issue.id)).map(issue => issue.id) })).filter(row => row.issue_ids.length > 0));
  function referenceCandidate(row: GenerationRow) { return !!row.reference_pdf?.trim() && row.reference_status === "candidate_needs_review" && !row.output_paths.some(output => output.normalize("NFC").toLocaleLowerCase() === row.reference_pdf!.normalize("NFC").toLocaleLowerCase()); }
  function canGenerateRow(row: GenerationRow) { return row.eligible && (allowWithoutPdf.value || referenceCandidate(row)); }
  const generationIds = computed(() => (generation.value?.rows || []).filter(row => canGenerateRow(row) && selectedGeneration.value.includes(row.id)).map(row => row.id));
  const auditSelectionTooLarge = computed(() => auditSelections.value.length > 500 || auditSelections.value.some(row => row.issue_ids.length > DRAWING_REPAIR_MAX_ISSUES_PER_FILE));
  const generationSelectionTooLarge = computed(() => generationIds.value.length > 500);
  const canApplyAudit = computed(() => canInteract.value && !!audit.value && !auditExpired.value && !auditRejected.value && !auditSelectionTooLarge.value && auditSelections.value.length > 0);
  const canStartGeneration = computed(() => canInteract.value && !!generation.value && !generationExpired.value && !generationRejected.value && !generationSelectionTooLarge.value && generationIds.value.length > 0);
  const canCancel = computed(() => !disposed && active.value && !pending.value && jobRunning.value && !job.value?.cancel_requested);
  const visibleAuditRows = computed(() => {
    const words = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (audit.value?.rows || []).filter(row => {
      if (filter.value === "error" ? !row.error : filter.value !== "all" && (row.error || !row.issues.some(issue => issue.status === filter.value))) return false;
      const text = [row.rel, row.source_rel, row.source_node, row.error, ...row.issues.flatMap(issue => [issue.field, issue.location, issue.current, issue.proposed, issue.message])].join(" ").toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
  });
  function log(text: string, open = false) { host.appendLog(`[图纸批量] ${text}`, { source: "drawing_batch", open }); }
  function fail(cause: unknown) { error.value = message(cause); log(error.value, true); }
  function current(token: number, ws: string) { return !disposed && active.value && token === epoch && workspace.value === ws; }
  function stopPolling() { if (pollTimer) clearTimeout(pollTimer); pollTimer = undefined; }
  function invalidateAudit() { if (auditTimer) clearTimeout(auditTimer); auditTimer = undefined; audit.value = null; selectedIssues.value = {}; auditExpired.value = false; auditRejected.value = false; }
  function invalidateGeneration() { if (generationTimer) clearTimeout(generationTimer); generationTimer = undefined; generation.value = null; selectedGeneration.value = []; generationExpired.value = false; generationRejected.value = false; }
  function invalidate() { epoch++; request?.abort(); stopPolling(); invalidateAudit(); invalidateGeneration(); }
  function expire(kind: "audit" | "generation", value: { expires_at: string }, token: number, ws: string) {
    const delay = Date.parse(value.expires_at) - Date.now();
    if (!Number.isFinite(delay)) throw new Error("服务端预览有效期无效，请重新预览");
    const run = () => {
      if (!current(token, ws)) return;
      if (kind === "audit" && audit.value === value) { auditExpired.value = true; selectedIssues.value = {}; }
      if (kind === "generation" && generation.value === value) { generationExpired.value = true; selectedGeneration.value = []; }
    };
    if (delay <= 0) run(); else if (kind === "audit") auditTimer = setTimeout(run, Math.min(delay, 2147483647)); else generationTimer = setTimeout(run, Math.min(delay, 2147483647));
  }
  function reportJob(value: DrawingBatchJob) {
    for (const result of value.results) {
      const key = `${value.workspace}\0${value.id}\0${result.id}\0${result.status}\0${result.message}`;
      if (logged.has(key)) continue;
      logged.add(key);
      log(`${result.rel}：${result.message}${result.backup ? `\n备份：${result.backup}` : ""}${result.outputs?.length ? `\n输出：${result.outputs.join("；")}` : ""}${result.manual_review_required ? "\n需人工核对图纸、PDF、尺寸与图框；未视为已验收。" : ""}`, result.status === "failed");
      for (const warning of result.warnings || []) log(`${result.rel}：${warning}`, true);
    }
    if (value.error && !logged.has(`${value.id}\0${value.error}`)) { logged.add(`${value.id}\0${value.error}`); log(value.error, true); }
    if (!running(value) && !finished.has(value.id)) {
      finished.add(value.id); log(`任务 ${value.id}：完成 ${value.completed} / ${value.total}，失败 ${value.failed}，状态 ${value.status}`, value.failed > 0 || value.status === "failed"); host.changed?.(value.workspace);
    }
    if (logged.size > 4000) logged.clear();
  }
  function storeJob(value: DrawingBatchJob, ws: string, kind?: DrawingBatchJob["kind"], id?: string) {
    if (value.workspace !== ws || (kind && value.kind !== kind) || (id && value.id !== id)) throw new Error("任务回执与确认的工作空间或任务不一致");
    if (disposed) return;
    jobs.value = new Map(jobs.value).set(ws, value); reportJob(value);
  }
  function schedulePoll() {
    stopPolling();
    if (!disposed && active.value && jobRunning.value) pollTimer = setTimeout(() => { void refreshJob(); }, 1200);
  }
  async function refreshJob() {
    const value = job.value;
    if (disposed || !active.value || pending.value || !value) return;
    const token = epoch, ws = workspace.value; pending.value = true; phase.value = "更新任务状态"; error.value = ""; request = new AbortController();
    try { const result = await fetchDrawingBatchJob(ws, value.id, request.signal); if (current(token, ws)) storeJob(result, ws, value.kind, value.id); }
    catch (cause) { if (current(token, ws)) fail(cause); }
    finally { pending.value = false; phase.value = ""; request = null; if (!error.value) schedulePoll(); }
  }
  async function preview(kind: "audit" | "generation") {
    if (!canInteract.value) return;
    const token = epoch, ws = workspace.value, options = { directory: directory.value, recursive: recursive.value };
    const settingsKey = kind === "audit" ? auditSettingsKey.value : generationSettingsKey.value;
    const settingsEpoch = kind === "audit" ? auditSettingsEpoch : generationSettingsEpoch;
    if (kind === "audit") invalidateAudit(); else invalidateGeneration();
    pending.value = true; phase.value = kind === "audit" ? "扫描图纸并校核" : "扫描模型并计划出图"; error.value = ""; request = new AbortController();
    try {
      if (kind === "audit") {
        const value = await previewDrawingAudit(ws, { ...options, dimension_font: dimensionFont.value, annotation_font: annotationFont.value }, request.signal);
        if (!current(token, ws) || settingsEpoch !== auditSettingsEpoch || settingsKey !== auditSettingsKey.value) return;
        if (value.workspace !== ws || value.directory !== options.directory || value.recursive !== options.recursive) throw new Error("校核预览与当前范围不一致，请重新预览");
        audit.value = value; expire("audit", value, token, ws);
        for (const row of value.rows) if (row.error) log(`${row.rel}：${row.error}`, true);
        for (const warning of value.warnings) log(warning, true);
      } else {
        const value = await previewDrawingGeneration(ws, { ...options, template_root: templateRoot.value || undefined, template: template.value || undefined, paper: paper.value || undefined, scale: scale.value || undefined, allow_without_pdf: allowWithoutPdf.value }, request.signal);
        if (!current(token, ws) || settingsEpoch !== generationSettingsEpoch || settingsKey !== generationSettingsKey.value) return;
        if (value.workspace !== ws || value.directory !== options.directory || value.recursive !== options.recursive) throw new Error("出图预览与当前范围不一致，请重新预览");
        generation.value = value; expire("generation", value, token, ws);
        for (const warning of value.warnings) log(warning, true);
      }
    } catch (cause) { if (current(token, ws)) { if (kind === "audit") invalidateAudit(); else invalidateGeneration(); fail(cause); } }
    finally { pending.value = false; phase.value = ""; request = null; }
  }
  async function loadTemplates() {
    if (!canInteract.value) return;
    const token = epoch, ws = workspace.value, root = templateRoot.value;
    pending.value = true; phase.value = "读取图框模板"; error.value = ""; request = new AbortController();
    try { const value = await fetchDrawingTemplates(ws, root, request.signal); if (current(token, ws) && root === templateRoot.value) templates.value = value; }
    catch (cause) { if (current(token, ws)) fail(cause); }
    finally { pending.value = false; phase.value = ""; request = null; }
  }
  async function start(kind: "repair" | "generation") {
    if (kind === "repair" ? !canApplyAudit.value : !canStartGeneration.value) return;
    const token = epoch, ws = workspace.value, value = kind === "repair" ? audit.value! : generation.value!;
    const selections = clone(auditSelections.value), ids = [...generationIds.value];
    const selectionKey = JSON.stringify(kind === "repair" ? selections : ids), selectionToken = selectionEpoch;
    pending.value = true; phase.value = "确认所选操作"; error.value = ""; let sent = false;
    try {
      const count = kind === "repair" ? selections.length : ids.length;
      const yes = await host.confirm(kind, `工作空间：${ws}\n目录：${directory.value}${recursive.value ? "（含子目录）" : "（不含子目录）"}\n所选 ${count} 个文件\n${kind === "repair" ? "请先在用户 FreeCAD 中保存或另存未保存编辑，再关闭本批目标图纸；不需要关闭整个 FreeCAD。只应用勾选的可修正问题，保留人工值和冲突。原生预校验通过并备份后才修改原图，误改可用备份恢复。保持旧 GUI 文档打开后再保存，可能覆盖修正结果。" : "只串行生成勾选模型的图纸初稿；按预览输出路径创建，不覆盖已有图纸或输出。"}\n文件或选项变化将拒绝旧计划。生成结果仍需人工校核，不自动视为正式图纸。`);
      if (!current(token, ws) || !yes || (kind === "repair" ? audit.value : generation.value) !== value || selectionToken !== selectionEpoch || selectionKey !== JSON.stringify(kind === "repair" ? auditSelections.value : generationIds.value)) return;
      if (Date.parse(value.expires_at) <= Date.now()) { if (kind === "repair") auditExpired.value = true; else generationExpired.value = true; throw new Error("预览已过期，请重新预览"); }
      sent = true; phase.value = kind === "repair" ? "提交图纸修正" : "提交串行出图"; request = new AbortController();
      const result = kind === "repair" ? await applyDrawingAudit(ws, value.plan_id, selections, request.signal) : await startDrawingGeneration(ws, value.plan_id, ids, request.signal);
      storeJob(result, ws, kind);
      if ((kind === "repair" ? audit.value : generation.value) === value) { if (kind === "repair") invalidateAudit(); else invalidateGeneration(); }
    } catch (cause) {
      if (!sent) { if (current(token, ws)) fail(cause); }
      else {
        const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500;
        const payload = rejected && cause.payload && typeof cause.payload === "object" && !Array.isArray(cause.payload) ? cause.payload as Record<string, unknown> : {};
        const reusable = cause instanceof ApiError && cause.status === 400 && (payload.code === "queue_busy" || payload.code === "queue_full") && payload.plan_consumed === false;
        const detail = rejected ? `服务已拒绝提交，未启动本次任务；${reusable ? "队列票据未消费，可稍后重新确认并显式重试" : "请重新预览后重试"}。\n${message(cause)}` : `提交结果未确认，先查询任务与目标文件，勿重复提交；不会自动重试。\n${message(cause)}`;
        if (current(token, ws)) {
          if ((kind === "repair" ? audit.value : generation.value) === value) {
            if (!rejected) { if (kind === "repair") invalidateAudit(); else invalidateGeneration(); }
            else if (!reusable) { if (kind === "repair") auditRejected.value = true; else generationRejected.value = true; }
          }
          fail(detail);
        } else log(`旧上下文（${ws}）：${detail}`, true);
      }
    } finally { pending.value = false; phase.value = ""; request = null; schedulePoll(); }
  }
  async function cancelJob() {
    if (!canCancel.value || !job.value) return;
    const value = job.value, ws = workspace.value, token = epoch;
    pending.value = true; phase.value = "请求停止任务"; error.value = ""; request = new AbortController();
    try { const result = await cancelDrawingBatchJob(ws, value.id, request.signal); storeJob(result, ws, value.kind, value.id); }
    catch (cause) { if (current(token, ws)) fail(cause); }
    finally { pending.value = false; phase.value = ""; request = null; if (current(token, ws)) schedulePoll(); }
  }
  function readyIssues(row: DrawingAuditRow) { return row.error ? [] : row.issues.filter(issue => issue.status === "ready"); }
  function selectIssue(row: DrawingAuditRow, issueId: string, checked: boolean) {
    if (!canInteract.value || auditRejected.value || auditExpired.value || !readyIssues(row).some(issue => issue.id === issueId)) return;
    const next = new Set(selectedIssues.value[row.id] || []); if (checked) next.add(issueId); else next.delete(issueId);
    selectedIssues.value = { ...selectedIssues.value, [row.id]: [...next] };
  }
  function selectFile(row: DrawingAuditRow, checked: boolean) {
    if (!canInteract.value || auditRejected.value || auditExpired.value) return;
    selectedIssues.value = { ...selectedIssues.value, [row.id]: checked ? readyIssues(row).map(issue => issue.id) : [] };
  }
  function selectAllAudit(checked: boolean) { if (!canInteract.value) return; if (!checked) selectedIssues.value = {}; else if (!auditRejected.value && !auditExpired.value) for (const row of visibleAuditRows.value) selectFile(row, true); }
  function selectAllGeneration(checked: boolean) { if (canInteract.value && (!checked || !generationRejected.value && !generationExpired.value)) selectedGeneration.value = checked ? generation.value?.rows.filter(canGenerateRow).map(row => row.id) || [] : []; }
  function clearPreviews() { if (!pending.value) { invalidateAudit(); invalidateGeneration(); error.value = ""; } }
  watch(scopeKey, () => { invalidate(); error.value = ""; templates.value = null; }, { flush: "sync" });
  watch([templateRoot, template, paper, scale, allowWithoutPdf], () => { generationSettingsEpoch++; invalidateGeneration(); }, { flush: "sync" });
  watch([dimensionFont, annotationFont], () => { auditSettingsEpoch++; invalidateAudit(); }, { flush: "sync" });
  watch([selectedIssues, selectedGeneration], () => { selectionEpoch++; }, { deep: true, flush: "sync" });
  watch(active, value => { if (!value) invalidate(); else if (jobRunning.value) void refreshJob(); }, { flush: "sync" });
  watch(workspace, () => { if (active.value && jobRunning.value && !pending.value) void refreshJob(); }, { flush: "post" });
  onScopeDispose(() => { invalidate(); disposed = true; });
  return { audit, generation, selectedIssues, selectedGeneration, auditExpired, generationExpired, auditRejected, generationRejected, error, phase, busy, pending, job, jobRunning, canInteract, canApplyAudit, canStartGeneration, canCancel, auditSelections, generationIds, auditSelectionTooLarge, generationSelectionTooLarge, canGenerateRow, referenceCandidate, allowWithoutPdf, visibleAuditRows, query, filter, templateRoot, template, paper, scale, dimensionFont, annotationFont, templates, readyIssues, selectIssue, selectFile, selectAllAudit, selectAllGeneration, loadTemplates, previewAudit: () => preview("audit"), previewGeneration: () => preview("generation"), applyAudit: () => start("repair"), startGeneration: () => start("generation"), cancelJob, refreshJob, clearPreviews };
}
