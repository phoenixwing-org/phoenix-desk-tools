import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
const api = vi.hoisted(() => ({ inspect: vi.fn(), backup: vi.fn(), restore: vi.fn(), release: vi.fn() }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), inspectWorkspaceRecovery: api.inspect, backupWorkspaceRecovery: api.backup, restoreWorkspaceRecovery: api.restore, releaseWorkspaceRecovery: api.release }));
import { useWorkspaceRecovery } from "./useWorkspaceRecovery";
import { deferred, syntheticBackupReceipt, syntheticBackupTarget, syntheticInspection, syntheticRestoreReceipt, syntheticRestoreTarget, syntheticWorkspace } from "./fixtures.test-support";
let scope: EffectScope;
const ws = ref(syntheticWorkspace), active = ref(true), log = vi.fn(), confirm = vi.fn(), picker = vi.fn();
function setup() { scope = effectScope(); return scope.run(() => useWorkspaceRecovery(ws, { appendLog: log, confirm, pickDirectory: picker }, active))!; }
function configure(d: ReturnType<typeof setup>) { d.backupTarget.value = syntheticBackupTarget; d.backupDirectory.value = syntheticBackupTarget; d.restoreTarget.value = syntheticRestoreTarget; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z")); vi.clearAllMocks();
  ws.value = syntheticWorkspace; active.value = true;
  api.inspect.mockResolvedValue(syntheticInspection()); api.backup.mockResolvedValue(syntheticBackupReceipt()); api.restore.mockResolvedValue(syntheticRestoreReceipt()); api.release.mockResolvedValue(undefined); confirm.mockResolvedValue(true); picker.mockResolvedValue(null);
});
afterEach(() => { scope?.stop(); vi.useRealTimers(); });
describe("workspace recovery manual and context-bound controller", () => {
  it("does not read, inspect, backup, restore or release on construction and configuration", () => {
    const d = setup(); configure(d); expect(d.canRestore.value).toBe(false); expect(d.canBackup.value).toBe(true);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
  it("performs an explicit inspection and binds it to selected backup and new target", async () => {
    const d = setup(); configure(d); await d.runInspect();
    expect(api.inspect).toHaveBeenCalledWith(syntheticWorkspace, syntheticBackupTarget, expect.any(AbortSignal));
    expect(d.inspection.value).toEqual(syntheticInspection()); expect(d.canRestore.value).toBe(true); expect(api.restore).not.toHaveBeenCalled();
  });
  it("blocks duplicate actions while any confirmation or request is busy", async () => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise); const d = setup(); configure(d);
    const pending = d.runBackup(); await d.runBackup(); await d.runInspect(); await d.runRestore();
    expect(confirm).toHaveBeenCalledTimes(1); expect(api.inspect).not.toHaveBeenCalled(); answer.resolve(true); await pending; expect(api.backup).toHaveBeenCalledTimes(1);
  });
  it.each(["workspace", "inactive", "cancel", "dispose"])("aborts an old inspection and releases its late success on %s", async kind => {
    const result = deferred<ReturnType<typeof syntheticInspection>>(); api.inspect.mockReturnValue(result.promise);
    const d = setup(); configure(d); const pending = d.runInspect(), signal = api.inspect.mock.calls[0][2] as AbortSignal;
    if (kind === "workspace") ws.value = "/other-workspace"; else if (kind === "inactive") active.value = false; else if (kind === "cancel") d.cancel(); else scope.stop();
    expect(signal.aborted).toBe(true); result.resolve(syntheticInspection()); await pending;
    expect(d.inspection.value).toBeNull(); expect(api.release).toHaveBeenCalledWith(syntheticWorkspace, syntheticInspection().inspection_id); expect(api.release.mock.calls[0]).toHaveLength(2);
  });
  it.each(["workspace", "inactive", "dispose"])("ignores a late inspection rejection after %s", async kind => {
    const result = deferred<ReturnType<typeof syntheticInspection>>(); api.inspect.mockReturnValue(result.promise);
    const d = setup(); configure(d); const pending = d.runInspect();
    if (kind === "workspace") ws.value = "/other-workspace"; else if (kind === "inactive") active.value = false; else scope.stop();
    result.reject(new Error("Old read failure")); await pending; expect(log).not.toHaveBeenCalled(); expect(d.inspection.value).toBeNull();
  });
  it("reports inspection failures and distinct causes in the automatically opened Bottom", async () => {
    api.inspect.mockRejectedValue(new ApiError("Invalid backup", 409, { code: "invalid_backup", causes: ["Invalid backup", "Manifest changed", " Manifest changed "] }));
    const d = setup(); configure(d); await d.runInspect(); expect(d.error.value).toBe("[invalid_backup] Invalid backup\nManifest changed");
    expect(d.canRestore.value).toBe(false); expect(log).toHaveBeenLastCalledWith(expect.stringContaining("Manifest changed"), { source: "workspace_recovery", open: true });
  });
  it("refuses a mismatched inspected backup path and releases its server handle", async () => {
    api.inspect.mockResolvedValue({ ...syntheticInspection(), backup_directory: "/foreign-backup" });
    const d = setup(); configure(d); await d.runInspect(); expect(d.inspection.value).toBeNull(); expect(d.error.value).toContain("不一致"); expect(api.release).toHaveBeenCalledTimes(1);
  });
  it.each(["backupTarget", "backupDirectory", "restoreTarget"] as const)("setting change %s invalidates and releases a prior inspection", async key => {
    const d = setup(); configure(d); await d.runInspect(); d[key].value = "/changed-target";
    expect(d.inspection.value).toBeNull(); expect(d.canRestore.value).toBe(false); expect(api.release).toHaveBeenCalledTimes(1); expect(d.error.value).toContain("重新检查");
  });
  it("expires without an implicit re-inspection or restore", async () => {
    const d = setup(); configure(d); await d.runInspect(); vi.advanceTimersByTime(600000);
    expect(d.status.value).toBe("expired"); expect(d.canRestore.value).toBe(false); await d.runRestore(); expect(api.restore).not.toHaveBeenCalled(); expect(api.inspect).toHaveBeenCalledTimes(1); expect(api.release).toHaveBeenCalledTimes(1);
  });
  it("expires during confirmation without dispatching restore", async () => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise); const d = setup(); configure(d); await d.runInspect(); const pending = d.runRestore();
    vi.advanceTimersByTime(600000); answer.resolve(true); await pending; expect(api.restore).not.toHaveBeenCalled(); expect(d.status.value).toBe("expired");
  });
  it.each(["backup", "restore"] as const)("confirmation cancellation sends no %s write", async operation => {
    const d = setup(); configure(d); await d.runInspect(); confirm.mockResolvedValue(false);
    if (operation === "backup") await d.runBackup(); else await d.runRestore();
    expect(api[operation]).not.toHaveBeenCalled(); expect(d.canRestore.value).toBe(true); expect(api.release).not.toHaveBeenCalled();
    const message = confirm.mock.calls[0][1] as string; expect(message).toContain("不覆盖"); expect(message).toContain("私人数据"); expect(message).toContain("不上传");
    if (operation === "restore") { expect(message).toContain(syntheticInspection().manifest_sha256); expect(message).toContain("不激活"); expect(message).toContain("2 文件 · 2 目录 · 128 bytes"); }
    else expect(message).toContain("当前数据库原始全字节");
  });
  it.each(["workspace", "backupDirectory", "restoreTarget", "inactive", "cancel"])("does not restore after confirmation context changes: %s", async kind => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise); const d = setup(); configure(d); await d.runInspect(); const pending = d.runRestore();
    if (kind === "workspace") ws.value = "/other-workspace"; else if (kind === "inactive") active.value = false; else if (kind === "cancel") d.cancel(); else d[kind as "backupDirectory" | "restoreTarget"].value = "/changed-target";
    answer.resolve(true); await pending; expect(api.restore).not.toHaveBeenCalled();
  });
  it("does not back up an edited target after a stale confirmation", async () => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise); const d = setup(); configure(d); const pending = d.runBackup(); d.backupTarget.value = "/new-target";
    answer.resolve(true); await pending; expect(api.backup).not.toHaveBeenCalled();
  });
  it("restores once, consumes inspection, retains confirmed receipt and does not activate the workspace", async () => {
    const d = setup(); configure(d); await d.runInspect(); await d.runRestore(); await d.runRestore();
    expect(api.restore).toHaveBeenCalledTimes(1); expect(d.inspection.value).toBeNull(); expect(d.canRestore.value).toBe(false);
    expect(d.outcome.value).toEqual({ operation: "restore", receipt: syntheticRestoreReceipt() }); expect(ws.value).toBe(syntheticWorkspace); expect(d.status.value).toBe("restore-complete");
  });
  it("does not release an in-flight restore when its original inspection TTL elapses", async () => {
    const result = deferred<ReturnType<typeof syntheticRestoreReceipt>>(); api.restore.mockReturnValue(result.promise); const d = setup(); configure(d); await d.runInspect(); const pending = d.runRestore(); await Promise.resolve();
    vi.advanceTimersByTime(600000); expect(api.release).not.toHaveBeenCalled(); result.resolve(syntheticRestoreReceipt()); await pending; expect(d.status.value).toBe("restore-complete"); expect(api.release).toHaveBeenCalledTimes(1);
  });
  it("410 after a server restart requires fresh inspection and never retries automatically", async () => {
    api.restore.mockRejectedValue(new ApiError("Inspection unavailable", 410, { code: "inspection_expired" })); const d = setup(); configure(d); await d.runInspect(); await d.runRestore(); await d.runRestore();
    expect(d.status.value).toBe("expired"); expect(d.error.value).toContain("服务重启"); expect(api.restore).toHaveBeenCalledTimes(1); expect(api.inspect).toHaveBeenCalledTimes(1); expect(d.canRestore.value).toBe(false);
  });
  it("even an explicit restore failure consumes the inspection and surfaces an incomplete directory in page and Bottom", async () => {
    api.restore.mockRejectedValue(new ApiError("Destination conflict", 409, { code: "conflict", causes: ["Marker occupied"], incompleteDirectory: syntheticRestoreTarget }));
    const d = setup(); configure(d); await d.runInspect(); await d.runRestore(); expect(d.status.value).toBe("failed"); expect(d.incompleteDirectory.value).toBe(syntheticRestoreTarget); expect(d.error.value).toContain("未完成目录"); expect(d.canRestore.value).toBe(false);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining(syntheticRestoreTarget), { source: "workspace_recovery", open: true });
  });
  it.each(["backup", "restore"] as const)("lost %s response marks the target unconfirmed and never silently retries", async operation => {
    api[operation].mockRejectedValue(new TypeError("Connection lost")); const d = setup(); configure(d);
    if (operation === "restore") { await d.runInspect(); await d.runRestore(); } else await d.runBackup();
    expect(d.status.value).toBe("unconfirmed"); expect(d.error.value).toContain("结果未确认，请核对目标"); expect(d.error.value).toContain(operation === "backup" ? syntheticBackupTarget : syntheticRestoreTarget); expect(api[operation]).toHaveBeenCalledTimes(1); expect(d.outcome.value).toBeNull();
  });
  it.each(["backup", "restore"] as const)("cancelling a dispatched %s cannot claim no write; a late receipt is logged, not reapplied", async operation => {
    const result = deferred<ReturnType<typeof syntheticBackupReceipt> | ReturnType<typeof syntheticRestoreReceipt>>(); api[operation].mockReturnValue(result.promise); const d = setup(); configure(d); if (operation === "restore") await d.runInspect();
    const pending = operation === "backup" ? d.runBackup() : d.runRestore(); await Promise.resolve(); const signal = api[operation].mock.calls[0].at(-1) as AbortSignal;
    d.cancel(); expect(signal.aborted).toBe(true); expect(d.status.value).toBe("unconfirmed"); expect(d.error.value).not.toContain("未发送新的写入");
    result.resolve(operation === "backup" ? syntheticBackupReceipt() : syntheticRestoreReceipt()); await pending;
    expect(d.outcome.value).toBeNull(); expect(d.status.value).toBe("unconfirmed"); expect(log.mock.calls.at(-1)?.[0]).toContain("旧上下文已确认");
  });
  it.each(["backup", "restore"] as const)("workspace switch during %s preserves only old-target logs, not a receipt in the new workspace", async operation => {
    const result = deferred<ReturnType<typeof syntheticBackupReceipt> | ReturnType<typeof syntheticRestoreReceipt>>(); api[operation].mockReturnValue(result.promise); const d = setup(); configure(d); if (operation === "restore") await d.runInspect();
    const pending = operation === "backup" ? d.runBackup() : d.runRestore(); await Promise.resolve(); ws.value = "/other-workspace";
    expect(d.status.value).toBe("idle"); expect(d.error.value).toBe(""); result.resolve(operation === "backup" ? syntheticBackupReceipt() : syntheticRestoreReceipt()); await pending;
    expect(d.outcome.value).toBeNull(); expect(log.mock.calls.at(-1)?.[0]).toContain(syntheticWorkspace); expect(log.mock.calls.at(-1)?.[0]).not.toContain("/other-workspace");
  });
  it("late write rejection after unmount does not overwrite state or log an invented outcome", async () => {
    const result = deferred<ReturnType<typeof syntheticBackupReceipt>>(); api.backup.mockReturnValue(result.promise); const d = setup(); configure(d); const pending = d.runBackup(); await Promise.resolve(); scope.stop(); const count = log.mock.calls.length;
    result.reject(new Error("Old failure")); await pending; expect(log).toHaveBeenCalledTimes(count); expect(d.outcome.value).toBeNull();
  });
  it.each(["inactive", "dispose"])("aborts and releases the active restore attempt on %s, retaining only a late receipt log", async kind => {
    const result = deferred<ReturnType<typeof syntheticRestoreReceipt>>(); api.restore.mockReturnValue(result.promise); const d = setup(); configure(d); await d.runInspect(); const pending = d.runRestore(); await Promise.resolve();
    const signal = api.restore.mock.calls[0][3] as AbortSignal;
    if (kind === "inactive") active.value = false; else scope.stop();
    expect(signal.aborted).toBe(true); expect(api.release).toHaveBeenCalledWith(syntheticWorkspace, syntheticInspection().inspection_id); expect(d.status.value).toBe("unconfirmed");
    result.resolve(syntheticRestoreReceipt()); await pending; expect(d.outcome.value).toBeNull(); expect(log.mock.calls.at(-1)?.[0]).toContain("旧上下文已确认隔离恢复");
  });
  it("treats cleanup 410 after a consumed restore as already released, without opening an error Bottom", async () => {
    api.release.mockRejectedValue(new ApiError("Already consumed", 410, { code: "inspection_expired" }));
    const d = setup(); configure(d); await d.runInspect(); await d.runRestore(); await Promise.resolve();
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("隔离恢复完成"), { source: "workspace_recovery", open: false });
  });
  it("bounds cleanup deduplication to 128 handles in a long-lived tab", async () => {
    const d = setup(); configure(d);
    for (let index = 0; index < 130; index++) {
      api.inspect.mockResolvedValue({ ...syntheticInspection(), inspection_id: `${index.toString(16).padStart(8, "0")}-2222-4333-8444-555555555555` });
      await d.runInspect();
    }
    api.inspect.mockResolvedValue({ ...syntheticInspection(), inspection_id: "00000000-2222-4333-8444-555555555555" }); await d.runInspect(); d.cancel();
    expect(api.release.mock.calls.filter(call => call[1] === "00000000-2222-4333-8444-555555555555")).toHaveLength(2);
  });
  it.each(["backup", "restore"] as const)("retains successful %s warnings and automatically opens Output", async operation => {
    const d = setup(); configure(d);
    if (operation === "backup") { api.backup.mockResolvedValue({ ...syntheticBackupReceipt(), warnings: ["Completed but directory sync unconfirmed"] }); await d.runBackup(); }
    else { api.restore.mockResolvedValue({ ...syntheticRestoreReceipt(), warnings: ["Completed but directory sync unconfirmed"] }); await d.runInspect(); await d.runRestore(); }
    expect(d.outcome.value?.receipt.warnings).toEqual(["Completed but directory sync unconfirmed"]); expect(d.status.value).toBe(`${operation}-complete`);
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining("directory sync unconfirmed"), { source: "workspace_recovery", open: true });
  });
  it("mismatched receipt statistics are an unconfirmed result, not successful recovery", async () => {
    api.restore.mockResolvedValue({ ...syntheticRestoreReceipt(), fileCount: 3 }); const d = setup(); configure(d); await d.runInspect(); await d.runRestore(); expect(d.status.value).toBe("unconfirmed"); expect(d.outcome.value).toBeNull();
  });
  it("an invalid manual target disables writes before prompting or HTTP", async () => {
    const d = setup(); configure(d); d.backupTarget.value = "relative"; d.restoreTarget.value = "/bad/../target"; await d.runBackup(); await d.runInspect(); await d.runRestore(); expect(confirm).not.toHaveBeenCalled(); expect(api.backup).not.toHaveBeenCalled(); expect(api.restore).not.toHaveBeenCalled();
  });
  it("picker uses a parent plus new basename for new targets, but an existing directory for inspection", async () => {
    const d = setup(); picker.mockResolvedValue("/local-output"); await d.chooseDirectory("backup", "new-backup"); expect(d.backupTarget.value).toBe("/local-output/new-backup");
    await d.chooseDirectory("restore", "new-restored"); expect(d.restoreTarget.value).toBe("/local-output/new-restored"); await d.chooseDirectory("inspect"); expect(d.backupDirectory.value).toBe("/local-output"); expect(api.backup).not.toHaveBeenCalled(); expect(api.restore).not.toHaveBeenCalled();
  });
  it("refuses malformed new names before opening a directory picker", async () => {
    const d = setup(); await d.chooseDirectory("backup", "../bad"); expect(picker).not.toHaveBeenCalled(); expect(d.backupTarget.value).toBe(""); expect(log).toHaveBeenCalled();
  });
  it("does not apply a stale parent picker result to another workspace", async () => {
    const result = deferred<string | null>(); picker.mockReturnValue(result.promise); const d = setup(); const pending = d.chooseDirectory("backup", "new-backup"); ws.value = "/other-workspace"; result.resolve("/local-output"); await pending; expect(d.backupTarget.value).toBe("");
  });
  it("stores three paths by workspace, never inspections or outcomes, and hydrates without APIs", async () => {
    const d = setup(); configure(d); await d.runInspect(); const saved = d.serialize(); expect(Object.keys(saved).sort()).toEqual(["backupDirectory", "backupTarget", "restoreTarget", "workspace"]);
    ws.value = "/other-workspace"; expect(d.backupTarget.value).toBe(""); ws.value = syntheticWorkspace; expect(d.backupTarget.value).toBe(syntheticBackupTarget); expect(d.inspection.value).toBeNull();
    vi.clearAllMocks(); expect(d.hydrate({ ...saved, inspection: syntheticInspection(), receipt: syntheticRestoreReceipt() })).toBe(true); expect(d.inspection.value).toBeNull(); expect(d.outcome.value).toBeNull(); expect(d.canRestore.value).toBe(false);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled(); expect(d.hydrate({ ...saved, workspace: "/foreign" })).toBe(false);
  });
});
