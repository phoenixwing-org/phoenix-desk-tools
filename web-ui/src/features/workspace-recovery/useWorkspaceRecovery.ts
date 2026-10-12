import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { ApiError, pickWorkspaceDirectory } from "../../api";
import { absoluteRecoveryDirectory, absoluteRecoveryTarget, backupWorkspaceRecovery, inspectWorkspaceRecovery, joinNewRecoveryDirectory, releaseWorkspaceRecovery, restoreWorkspaceRecovery } from "./api";
import type { WorkspaceRecoveryInspection, WorkspaceRecoveryOutcome, WorkspaceRecoveryPhase, WorkspaceRecoverySettings, WorkspaceRecoveryStatus } from "./types";

export interface WorkspaceRecoveryHost {
  appendLog: (text: string, options: { source: string; open: boolean }) => void;
  confirm: (operation: "backup" | "restore", message: string) => Promise<boolean>;
  pickDirectory?: (hint: string) => Promise<string | null>;
}
const scopeDescription = "当前数据库原始全字节 + opaque outbox（含隐藏文件、空目录）；不包含工作空间 CAD 模型/缩略图目录、其他偏好或遗留数据库。包内可能有私人数据，仅在本地受保护位置保存，不上传。";
function validDirectory(value: string): boolean { try { absoluteRecoveryDirectory(value); return true; } catch { return false; } }
function validTarget(value: string): boolean { try { absoluteRecoveryTarget(value); return true; } catch { return false; } }
function detail(cause: unknown): { message: string; incompleteDirectory: string } {
  const payload = cause instanceof ApiError && cause.payload && typeof cause.payload === "object" ? cause.payload as Record<string, unknown> : {};
  const code = typeof payload.code === "string" ? payload.code.slice(0, 128) : "";
  const entries = [cause instanceof Error ? cause.message : "操作未确认", ...(Array.isArray(payload.causes) ? payload.causes.filter((v): v is string => typeof v === "string").slice(0, 8) : [])];
  const seen = new Set<string>();
  const messages = entries.map(v => v.trim().slice(0, 4096)).filter(v => { if (!v || seen.has(v)) return false; seen.add(v); return true; });
  const incompleteDirectory = typeof payload.incompleteDirectory === "string" && validDirectory(payload.incompleteDirectory) ? payload.incompleteDirectory : "";
  return { message: `${code ? `[${code}] ` : ""}${messages.join("\n")}${incompleteDirectory ? `\n未完成目录（保留，不是成功备份/恢复）：${incompleteDirectory}` : ""}`, incompleteDirectory };
}

/** Manual, context-bound operations. Server inspections and receipts are volatile. */
export function useWorkspaceRecovery(workspace: Ref<string>, host: WorkspaceRecoveryHost, active: Ref<boolean> = ref(true)) {
  const backupTarget = ref(""), backupDirectory = ref(""), restoreTarget = ref("");
  const inspection = shallowRef<WorkspaceRecoveryInspection | null>(null), outcome = shallowRef<WorkspaceRecoveryOutcome | null>(null);
  const phase = ref<WorkspaceRecoveryPhase>("idle"), status = ref<WorkspaceRecoveryStatus>("idle"), error = ref(""), incompleteDirectory = ref(""), expired = ref(false);
  let generation = 0, disposed = false, controller: AbortController | null = null, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let inspectionWorkspace = "", inspectedTarget = "", writingTarget = "", writingOperation: "backup" | "restore" | null = null, hydrating = false;
  let writingInspection: { workspace: string; value: WorkspaceRecoveryInspection } | null = null;
  const released = new Set<string>(), settings = new Map<string, Omit<WorkspaceRecoverySettings, "workspace">>();
  const busy = computed(() => phase.value !== "idle");
  const canInteract = computed(() => !disposed && active.value && validDirectory(workspace.value) && !busy.value);
  const backupTargetValid = computed(() => validTarget(backupTarget.value)), backupDirectoryValid = computed(() => validDirectory(backupDirectory.value)), restoreTargetValid = computed(() => validTarget(restoreTarget.value));
  const canBackup = computed(() => canInteract.value && backupTargetValid.value);
  const canInspect = computed(() => canInteract.value && backupDirectoryValid.value);
  const canRestore = computed(() => canInteract.value && restoreTargetValid.value && !!inspection.value && !expired.value && inspectedTarget === restoreTarget.value);
  function log(text: string, open = true) { host.appendLog(`[备份与恢复] ${text}`, { source: "workspace_recovery", open }); }
  function current(token: number, ws: string): boolean { return !disposed && active.value && generation === token && workspace.value === ws; }
  function clearTimer() { if (expiryTimer !== undefined) clearTimeout(expiryTimer); expiryTimer = undefined; }
  function release(ws: string, value: WorkspaceRecoveryInspection | null) {
    if (!value) return;
    const key = `${ws}\0${value.inspection_id}`;
    if (released.has(key)) return;
    released.add(key);
    if (released.size > 128) released.delete(released.values().next().value!);
    // Cleanup has an independent request, never the aborted write/read signal.
    void releaseWorkspaceRecovery(ws, value.inspection_id).catch(cause => {
      if (cause instanceof ApiError && cause.status === 410) return; // Consumed/expired is already released.
      log(`检查释放未确认；将在服务端到期：${detail(cause).message}`);
    });
  }
  function clearInspection() { clearTimer(); release(inspectionWorkspace, inspection.value); inspection.value = null; expired.value = false; inspectedTarget = ""; }
  function invalidate(reason: "cancel" | "settings" | "context" | "dispose") {
    const wasWriting = phase.value === "backing-up" || phase.value === "restoring", target = writingTarget;
    generation++; controller?.abort(); controller = null; clearInspection(); phase.value = "idle";
    if (writingInspection) release(writingInspection.workspace, writingInspection.value);
    writingInspection = null;
    if (wasWriting) {
      error.value = `结果未确认，请核对目标：${target}\n取消或失联不能证明没有写入；不会自动重试。`; status.value = "unconfirmed"; log(error.value);
    } else if (reason === "cancel") { error.value = "已取消；检查已释放，未发送新的写入。"; status.value = "cancelled"; }
    else if (reason === "settings") { error.value = "路径已变化；恢复前请重新检查并确认。"; status.value = "idle"; }
    writingTarget = ""; writingOperation = null;
  }
  function armExpiry(value: WorkspaceRecoveryInspection, token: number, ws: string) {
    clearTimer();
    const expire = () => {
      if (!current(token, ws) || inspection.value !== value) return;
      expired.value = true; release(ws, value); status.value = "expired"; error.value = "检查已到期，请重新检查；不会自动恢复。";
    };
    const delay = Date.parse(value.expires_at) - Date.now();
    if (delay <= 0) expire(); else expiryTimer = setTimeout(expire, Math.min(delay, 2147483647));
  }
  async function runInspect() {
    if (!canInspect.value) return;
    clearInspection(); error.value = ""; incompleteDirectory.value = "";
    const token = ++generation, ws = workspace.value, directory = backupDirectory.value, target = restoreTarget.value;
    phase.value = "inspecting"; controller = new AbortController();
    try {
      const value = await inspectWorkspaceRecovery(ws, directory, controller.signal);
      if (!current(token, ws)) { release(ws, value); return; }
      if (value.backup_directory !== directory) { release(ws, value); throw new Error("检查结果与所选备份目录不一致"); }
      inspectionWorkspace = ws; inspectedTarget = target; inspection.value = value; status.value = "checked"; armExpiry(value, token, ws);
    } catch (cause) {
      if (!current(token, ws)) return;
      const failure = detail(cause); error.value = failure.message; incompleteDirectory.value = failure.incompleteDirectory; status.value = "failed"; log(error.value);
    } finally { if (current(token, ws)) { phase.value = "idle"; controller = null; } }
  }
  async function runBackup() {
    if (!canBackup.value) return;
    const ws = workspace.value, target = backupTarget.value, token = generation;
    phase.value = "confirming-backup"; error.value = ""; incompleteDirectory.value = "";
    try {
      const yes = await host.confirm("backup", `工作空间：${ws}\n备份范围：${scopeDescription}\n新绝对目标：${target}\n父目录必须已存在，目标必须尚不存在。不覆盖、不删除、不重建索引、不切换工作空间。outbox 无共同写锁，不承诺跨资源原子快照。`);
      if (!current(token, ws) || backupTarget.value !== target) return;
      if (!yes) return;
      clearInspection(); writingTarget = target; writingOperation = "backup"; phase.value = "backing-up"; controller = new AbortController();
      const receipt = await backupWorkspaceRecovery(ws, target, controller.signal);
      if (receipt.backupDirectory !== target) throw new Error("备份回执目标与确认目标不一致");
      const result: WorkspaceRecoveryOutcome = { operation: "backup", receipt };
      if (!current(token, ws)) { log(`旧上下文已确认备份（${ws}）：${receipt.backupDirectory}${receipt.warnings.length ? `\n${receipt.warnings.join("\n")}` : ""}`); return; }
      outcome.value = result; status.value = "backup-complete";
      log(`备份完成：${receipt.backupDirectory} · ${receipt.fileCount} 文件 · ${receipt.totalBytes} bytes${receipt.warnings.length ? `\n${receipt.warnings.join("\n")}` : ""}`, receipt.warnings.length > 0);
    } catch (cause) { if (current(token, ws)) reportWriteFailure(cause, target); }
    finally { if (current(token, ws)) { phase.value = "idle"; controller = null; writingTarget = ""; writingOperation = null; } }
  }
  function reportWriteFailure(cause: unknown, target: string) {
    const failure = detail(cause); incompleteDirectory.value = failure.incompleteDirectory;
    if (writingOperation && (!(cause instanceof ApiError) || cause.status >= 500)) {
      status.value = "unconfirmed"; error.value = `结果未确认，请核对目标：${target}\n${failure.message}\n不会自动重试。`;
    } else if (cause instanceof ApiError && cause.status === 410) {
      status.value = "expired"; expired.value = true; error.value = `${failure.message}\n检查已到期、已消费或服务重启，请重新检查；不会自动恢复。`;
    } else { status.value = "failed"; error.value = failure.message; }
    log(error.value);
  }
  async function runRestore() {
    if (!canRestore.value) return;
    const value = inspection.value!, ws = workspace.value, target = restoreTarget.value, directory = backupDirectory.value, token = generation;
    let attempted = false;
    phase.value = "confirming-restore"; error.value = ""; incompleteDirectory.value = "";
    try {
      const yes = await host.confirm("restore", `当前工作空间：${ws}\n已检查备份：${value.backup_directory}\n恢复范围：${scopeDescription}\nmanifest SHA-256：${value.manifest_sha256}\n${value.file_count} 文件 · ${value.directory_count} 目录 · ${value.total_bytes} bytes · schema ${value.database_schema_version ?? "未知"}\n新绝对目标：${target}\n只恢复到新的隔离目录，不覆盖、不删除、不激活、不切换工作空间、不重建索引。检查句柄仅本次尝试可用，清单/hash 证明包自洽而非来源签名。`);
      if (!current(token, ws) || inspection.value !== value || backupDirectory.value !== directory || restoreTarget.value !== target) return;
      if (!yes) return;
      if (expired.value || Date.parse(value.expires_at) <= Date.now()) { expired.value = true; status.value = "expired"; error.value = "检查已到期，请重新检查；不会自动恢复。"; release(ws, value); return; }
      // Restore consumes the server handle even on explicit failure. Do not
      // offer a second attempt without a new server inspection.
      clearTimer(); inspection.value = null; inspectedTarget = ""; writingTarget = target; writingOperation = "restore";
      phase.value = "restoring"; controller = new AbortController(); attempted = true; writingInspection = { workspace: ws, value };
      const receipt = await restoreWorkspaceRecovery(ws, value.inspection_id, target, controller.signal);
      if (receipt.workspace !== target || receipt.fileCount !== value.file_count || receipt.totalBytes !== value.total_bytes) throw new Error("恢复回执与确认的目标/检查统计不一致");
      if (!current(token, ws)) { log(`旧上下文已确认隔离恢复（${ws}）：${receipt.workspace}${receipt.warnings.length ? `\n${receipt.warnings.join("\n")}` : ""}`); return; }
      outcome.value = { operation: "restore", receipt }; status.value = "restore-complete";
      log(`隔离恢复完成（未激活）：${receipt.workspace} · ${receipt.fileCount} 文件 · ${receipt.totalBytes} bytes${receipt.warnings.length ? `\n${receipt.warnings.join("\n")}` : ""}`, receipt.warnings.length > 0);
    } catch (cause) { if (current(token, ws)) reportWriteFailure(cause, target); }
    finally { if (attempted) release(ws, value); if (current(token, ws)) { phase.value = "idle"; controller = null; writingTarget = ""; writingOperation = null; writingInspection = null; } }
  }
  async function chooseDirectory(kind: "inspect" | "backup" | "restore", newName = "") {
    if (!canInteract.value) return;
    if (kind !== "inspect") {
      try { joinNewRecoveryDirectory(workspace.value, newName); }
      catch (cause) { error.value = detail(cause).message; log(error.value); return; }
    }
    const token = generation, ws = workspace.value; phase.value = "choosing";
    try {
      const hint = kind === "inspect" ? backupDirectory.value || ws : ws;
      const picked = host.pickDirectory ? await host.pickDirectory(hint) : await pickWorkspaceDirectory(hint);
      const directory = typeof picked === "string" ? picked : picked && !picked.cancelled ? picked.path : null;
      if (!current(token, ws) || !directory) return;
      absoluteRecoveryDirectory(directory);
      if (kind === "inspect") backupDirectory.value = directory;
      else if (kind === "backup") backupTarget.value = joinNewRecoveryDirectory(directory, newName);
      else restoreTarget.value = joinNewRecoveryDirectory(directory, newName);
    } catch (cause) { if (current(token, ws)) { error.value = detail(cause).message; log(error.value); } }
    finally { if (current(token, ws)) phase.value = "idle"; }
  }
  function serialize(): WorkspaceRecoverySettings { return { workspace: workspace.value, backupTarget: backupTarget.value, backupDirectory: backupDirectory.value, restoreTarget: restoreTarget.value }; }
  function hydrate(snapshot: Record<string, unknown>): boolean {
    if (snapshot.workspace !== workspace.value) return false;
    invalidate("context"); outcome.value = null; error.value = ""; incompleteDirectory.value = ""; status.value = "idle";
    hydrating = true;
    for (const [key, setting] of [["backupTarget", backupTarget], ["backupDirectory", backupDirectory], ["restoreTarget", restoreTarget]] as const) setting.value = typeof snapshot[key] === "string" && new TextEncoder().encode(snapshot[key]).byteLength <= 4096 ? snapshot[key] : "";
    hydrating = false;
    return true;
  }
  watch([backupTarget, backupDirectory, restoreTarget], () => { if (!hydrating) invalidate("settings"); }, { flush: "sync" });
  watch(workspace, (ws, previous) => {
    const saved = serialize(); settings.set(previous, { backupTarget: saved.backupTarget, backupDirectory: saved.backupDirectory, restoreTarget: saved.restoreTarget });
    invalidate("context"); outcome.value = null; error.value = ""; incompleteDirectory.value = ""; status.value = "idle";
    hydrating = true; const value = settings.get(ws); backupTarget.value = value?.backupTarget ?? ""; backupDirectory.value = value?.backupDirectory ?? ""; restoreTarget.value = value?.restoreTarget ?? ""; hydrating = false;
  }, { flush: "sync" });
  watch(active, value => { if (!value) invalidate("context"); }, { flush: "sync" });
  onScopeDispose(() => { invalidate("dispose"); disposed = true; });
  return { backupTarget, backupDirectory, restoreTarget, inspection, outcome, phase, status, error, incompleteDirectory, expired, busy, canInteract, backupTargetValid, backupDirectoryValid, restoreTargetValid, canBackup, canInspect, canRestore, runBackup, runInspect, runRestore, chooseDirectory, serialize, hydrate, cancel: () => invalidate("cancel") };
}
