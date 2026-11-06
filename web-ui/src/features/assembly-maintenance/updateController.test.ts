import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssemblyUpdateJob } from "../../../../shared/assembly-maintenance";
import type { AssemblyUpdateApi } from "./updateApi";
import { createAssemblyUpdateController, normalizeAssemblyUpdateFilePath, safeAssemblyUpdateDiagnostic, type AssemblyUpdateState } from "./updateController";
import { syntheticReconciliation, syntheticUpdateJob } from "./updateFixtures.test-support";
let index = 0;
const owned: ReturnType<typeof createAssemblyUpdateController>[] = [];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function setup() {
  const context = { workspacePath: `/synthetic/workspace-${++index}`, filePath: "examples/Assembly.FCStd" };
  const ready = syntheticUpdateJob(context.filePath), preparing = { ...ready, status: "preparing" as const, phase: "native_update" as const, can_publish: false, preview: null, expires_at: null };
  const api = { start: vi.fn().mockResolvedValue(ready), status: vi.fn().mockResolvedValue(ready), cancel: vi.fn().mockResolvedValue({ ...ready, status: "cancelled", phase: "completed", can_publish: false }),
    publish: vi.fn().mockResolvedValue({ ...ready, status: "published", phase: "completed", can_publish: false, output_rel: ready.suggested_copy_rel }),
    reconcile: vi.fn().mockResolvedValue(syntheticReconciliation()), history: vi.fn().mockResolvedValue({ protocol_version: 1, records: [], truncated: false }) } satisfies AssemblyUpdateApi;
  const log = vi.fn(), published = vi.fn(), busyChange = vi.fn(); let state!: AssemblyUpdateState;
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const controller = createAssemblyUpdateController(api, { change: next => { state = next; }, log, published, busyChange }, { now: () => now });
  owned.push(controller); controller.setContext(context);
  return { context, ready, preparing, api, controller, state: () => state, log, published, busyChange, advance: (ms: number) => { now += ms; } };
}
afterEach(() => { for (const controller of owned.splice(0)) controller.close(); vi.useRealTimers(); });
describe("explicit assembly update preview / publication controller", () => {
  it("does not silently select all instances or start Native on opening", async () => {
    const s = setup(); await s.controller.start(); expect(s.api.start).not.toHaveBeenCalled(); expect(s.state().selectedObjects).toEqual([]);
    s.controller.select(["Selected"]); await s.controller.start();
    expect(s.api.start).toHaveBeenCalledExactlyOnceWith({ ...s.context, selectedObjects: ["Selected"] });
    expect(s.state().job?.status).toBe("ready"); expect(s.controller.canPublish()).toBe(true);
  });
  it("normalizes repeated leading ./ and slashes once without permitting parent traversal", async () => {
    const s = setup(); s.controller.setContext({ ...s.context, filePath: ".\\.\\examples\\Assembly.FCStd" });
    s.controller.select(["Selected"]); await s.controller.start();
    expect(s.api.start.mock.calls[0][0].filePath).toBe("examples/Assembly.FCStd"); expect(s.state().unknown).toBe(false);
    expect(normalizeAssemblyUpdateFilePath("././Host.FCStd")).toBe("Host.FCStd");
    for (const value of ["../Host.FCStd", "folder/../Host.FCStd", "/Host.FCStd", "C:/Host.FCStd"]) expect(() => normalizeAssemblyUpdateFilePath(value)).toThrow();
  });
  it("polls a preparing preview every 1000 ms without overlapping or repeating Native start", async () => {
    vi.useFakeTimers(); const s = setup(); s.api.start.mockResolvedValue(s.preparing);
    s.controller.select(["Selected"]); await s.controller.start(); expect(s.state().busy).toBe(true);
    await vi.advanceTimersByTimeAsync(999); expect(s.api.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(s.api.status).toHaveBeenCalledTimes(1); expect(s.state().job?.status).toBe("ready");
    await vi.advanceTimersByTimeAsync(5000); expect(s.api.status).toHaveBeenCalledTimes(1); expect(s.api.start).toHaveBeenCalledTimes(1);
  });
  it("defaults to verified copy and requires both fresh confirmations for explicit replacement", async () => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start();
    await s.controller.publish("replace_source", true, false); expect(s.api.publish).not.toHaveBeenCalled();
    await s.controller.publish(); expect(s.api.publish).toHaveBeenCalledExactlyOnceWith({ workspacePath: s.context.workspacePath, id: s.ready.id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false });
    expect(s.published).toHaveBeenCalledExactlyOnceWith({ filePath: s.context.filePath, outputRel: s.ready.suggested_copy_rel });
    expect(s.log.mock.calls.at(-1)?.[0].message).toContain("原宿主未改写");
    const r = setup(); r.controller.select(["Selected"]); await r.controller.start();
    r.api.publish.mockResolvedValue({ ...r.ready, status: "published", phase: "completed", can_publish: false, output_rel: r.context.filePath });
    await r.controller.publish("replace_source", true, true); expect(r.api.publish.mock.calls[0][0].mode).toBe("replace_source");
  });
  it("does not publish expired or unchanged previews, or claim an unchanged assembly was repaired", async () => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start(); s.advance(600001);
    expect(s.controller.canPublish()).toBe(false); await s.controller.publish(); expect(s.api.publish).not.toHaveBeenCalled();
    const u = setup(); u.api.start.mockResolvedValue({ ...u.ready, status: "unchanged", can_publish: false, phase: "completed", preview: { ...u.ready.preview!, added: [], removed: [] } });
    u.controller.select(["Selected"]); await u.controller.start(); expect(u.log.mock.calls.at(-1)?.[0].message).toContain("不宣称已修复"); expect(u.controller.canPublish()).toBe(false);
  });
  it("close cancels only a known owned preview; a late accepted start is cancelled against its original context", async () => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start(); s.controller.close();
    expect(s.api.cancel).toHaveBeenCalledExactlyOnceWith({ workspacePath: s.context.workspacePath, id: s.ready.id });
    const late = setup(), pending = deferred<AssemblyUpdateJob>(); late.api.start.mockReturnValue(pending.promise);
    late.controller.select(["Selected"]); const starting = late.controller.start(); late.controller.setContext({ ...late.context, workspacePath: "/synthetic/replacement" });
    pending.resolve(late.preparing); await starting;
    expect(late.api.cancel).toHaveBeenCalledExactlyOnceWith({ workspacePath: late.context.workspacePath, id: late.ready.id });
    expect(late.state().job).toBeNull(); expect(late.log).not.toHaveBeenCalled();
  });
  it("does not submit cancellation twice when close follows an in-flight explicit cancellation", async () => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start(); const pending = deferred<AssemblyUpdateJob>(); s.api.cancel.mockReturnValue(pending.promise);
    const cancellation = s.controller.cancel(); await s.controller.cancel(); s.controller.close(); expect(s.api.cancel).toHaveBeenCalledTimes(1);
    pending.resolve({ ...s.ready, status: "cancelled", phase: "completed", can_publish: false }); await cancellation;
    expect(s.state().job).toBeNull();
  });
  it("does not cancel publication on close or leak a late published result into another workspace", async () => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start(); const pending = deferred<AssemblyUpdateJob>(); s.api.publish.mockReturnValue(pending.promise);
    const publishing = s.controller.publish(); s.controller.setContext({ ...s.context, workspacePath: "/synthetic/elsewhere" });
    expect(s.api.cancel).not.toHaveBeenCalled(); pending.resolve({ ...s.ready, status: "published", phase: "completed", can_publish: false, output_rel: s.ready.suggested_copy_rel }); await publishing;
    expect(s.published).not.toHaveBeenCalled(); expect(s.state().job).toBeNull();
  });
  it.each(["close", "cancel"] as const)("an old context's pending publication does not block %s of a new context's owned preview", async action => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start(); const pending = deferred<AssemblyUpdateJob>(); s.api.publish.mockReturnValue(pending.promise);
    const oldPublication = s.controller.publish();
    const other = { workspacePath: `/synthetic/other-${++index}`, filePath: "examples/Other.FCStd" };
    s.controller.setContext(other);
    const next = syntheticUpdateJob(other.filePath, { id: "00000000-0000-4000-a000-000000000002" });
    s.api.start.mockResolvedValue(next); s.api.cancel.mockResolvedValue({ ...next, status: "cancelled", phase: "completed", can_publish: false });
    s.controller.select(["Selected"]); await s.controller.start();
    if (action === "close") s.controller.close(); else await s.controller.cancel();
    expect(s.api.cancel).toHaveBeenCalledExactlyOnceWith({ workspacePath: other.workspacePath, id: next.id });
    pending.resolve({ ...s.ready, status: "published", phase: "completed", can_publish: false, output_rel: s.ready.suggested_copy_rel }); await oldPublication;
    expect(s.published).not.toHaveBeenCalled();
  });
  it("keeps a lost publication response unknown across close/reopen and never restores write authority from reconciliation", async () => {
    const s = setup(); s.controller.select(["Selected"]); await s.controller.start(); s.api.publish.mockRejectedValue(new Error("private /artifact/path"));
    await s.controller.publish(); expect(s.state().unknown).toBe(true); await s.controller.publish(); await s.controller.start();
    expect(s.api.publish).toHaveBeenCalledTimes(1); expect(s.api.start).toHaveBeenCalledTimes(1); expect(JSON.stringify(s.log.mock.calls)).not.toContain("/artifact");
    s.controller.close(); expect(s.api.cancel).not.toHaveBeenCalled(); s.controller.setContext(s.context); expect(s.state().unknown).toBe(true);
    await s.controller.status(); expect(s.api.status).not.toHaveBeenCalled(); expect(s.api.reconcile).toHaveBeenCalledTimes(1);
    expect(s.state().reconciliation?.read_only).toBe(true); expect(s.controller.canPublish()).toBe(false); await s.controller.publish(); expect(s.api.publish).toHaveBeenCalledTimes(1);
  });
  it("uses history for an unacknowledged start without guessing a job or automatically restarting", async () => {
    const s = setup(); s.api.start.mockRejectedValue(new Error("lost response")); s.controller.select(["Selected"]); await s.controller.start();
    const record = syntheticReconciliation({ operation: { file_path: s.context.filePath, status: "preparing", phase: "capturing", created_at: s.ready.created_at, output_rel: null } });
    s.api.history.mockResolvedValue({ protocol_version: 1, records: [record], truncated: false }); await s.controller.reconcile();
    expect(s.state().history).toEqual([record]); expect(s.state().job).toBeNull(); expect(s.state().unknown).toBe(true); expect(s.api.reconcile).not.toHaveBeenCalled();
    await s.controller.reconcile(record.id); expect(s.api.reconcile).toHaveBeenCalledTimes(1); expect(s.api.start).toHaveBeenCalledTimes(1); expect(s.controller.canPublish()).toBe(false);
  });
  it("always permits bounded history and an explicit task id without an in-memory uncertain pointer or live job", async () => {
    const s = setup(), record = syntheticReconciliation({ operation: { file_path: s.context.filePath, status: "published", phase: "completed", created_at: s.ready.created_at, output_rel: s.ready.suggested_copy_rel } });
    s.api.history.mockResolvedValue({ protocol_version: 1, records: [record], truncated: false }); s.api.reconcile.mockResolvedValue(record);
    await s.controller.loadHistory(); expect(s.state().historyLoaded).toBe(true); expect(s.state().history).toEqual([record]);
    await s.controller.reconcile(` ${record.id.toUpperCase()} `);
    expect(s.api.reconcile).toHaveBeenCalledExactlyOnceWith({ workspacePath: s.context.workspacePath, id: record.id }, expect.any(AbortSignal));
    expect(s.state().job).toBeNull(); expect(s.controller.canPublish()).toBe(false); expect(s.published).not.toHaveBeenCalled();
    expect(s.api.start).not.toHaveBeenCalled(); expect(s.api.publish).not.toHaveBeenCalled();
  });
  it("exposes truncated history after current-host filtering instead of treating an empty batch as complete", async () => {
    const s = setup(), unrelated = syntheticReconciliation({ operation: { file_path: "examples/Other.FCStd", status: "ready", phase: "ready", created_at: s.ready.created_at, output_rel: null } });
    s.api.history.mockResolvedValue({ protocol_version: 1, records: [unrelated], truncated: true });
    await s.controller.loadHistory(); expect(s.api.history).toHaveBeenCalledExactlyOnceWith({ workspacePath: s.context.workspacePath, limit: 30 }, expect.any(AbortSignal));
    expect(s.state().historyLoaded).toBe(true); expect(s.state().historyTruncated).toBe(true); expect(s.state().history).toEqual([]);
    expect(s.state().job).toBeNull(); expect(s.controller.canPublish()).toBe(false);
  });
  it("validates explicit UUIDs locally and rejects a different file's reconciliation without restoring authority", async () => {
    const s = setup();
    for (const id of ["", "../operation.json", "/private/receipt", "not-a-uuid"]) await s.controller.reconcile(id);
    expect(s.api.reconcile).not.toHaveBeenCalled(); expect(s.state().error).toContain("UUID");
    s.api.reconcile.mockResolvedValue(syntheticReconciliation({ operation: { file_path: "Other.FCStd", status: "published", phase: "completed", created_at: s.ready.created_at, output_rel: "Other.FCStd" } }));
    await s.controller.reconcile(s.ready.id); expect(s.state().reconciliation).toBeNull(); expect(s.state().error).toContain("未完成");
    expect(s.controller.canPublish()).toBe(false); expect(s.api.publish).not.toHaveBeenCalled();
  });
  it("does not stop a preparing preview's polling for a separate history or manual-id request", async () => {
    vi.useFakeTimers(); const s = setup(); s.api.start.mockResolvedValue(s.preparing); s.controller.select(["Selected"]); await s.controller.start();
    await s.controller.loadHistory(); await s.controller.reconcile(s.ready.id);
    expect(s.api.history).not.toHaveBeenCalled(); expect(s.api.reconcile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(s.api.status).toHaveBeenCalledTimes(1); expect(s.state().job?.status).toBe("ready");
  });
  it("aborts an old history read and drops its late result when the workspace changes", async () => {
    const s = setup(), pending = deferred<Awaited<ReturnType<AssemblyUpdateApi["history"]>>>(); s.api.history.mockReturnValue(pending.promise);
    const loading = s.controller.loadHistory(), signal = s.api.history.mock.calls[0][1]!;
    s.controller.setContext({ ...s.context, workspacePath: "/synthetic/new-history-workspace" }); expect(signal.aborted).toBe(true);
    pending.resolve({ protocol_version: 1, records: [syntheticReconciliation()], truncated: true }); await loading;
    expect(s.state().history).toEqual([]); expect(s.state().historyLoaded).toBe(false); expect(s.state().historyTruncated).toBe(false); expect(s.state().reconciliation).toBeNull();
  });
  it("ignores an aborted old status read and preserves the new context's state", async () => {
    vi.useFakeTimers(); const s = setup(), pending = deferred<AssemblyUpdateJob>(); s.api.start.mockResolvedValue(s.preparing); s.api.status.mockReturnValue(pending.promise);
    s.controller.select(["Selected"]); await s.controller.start(); await vi.advanceTimersByTimeAsync(1000);
    const signal = s.api.status.mock.calls[0][1]!; s.controller.setContext({ ...s.context, filePath: "examples/Other.FCStd" }); expect(signal.aborted).toBe(true);
    pending.resolve(s.ready); await Promise.resolve(); expect(s.state().job).toBeNull(); expect(s.state().selectedObjects).toEqual([]);
  });
  it("logs actionable safe diagnosis and warning messages without private artifact paths", async () => {
    const s = setup(); s.api.start.mockResolvedValue({ ...s.ready, status: "blocked", phase: "completed", can_publish: false,
      error: { code: "connected_component_deletion", message: "待移除副本仍被关节连接，需人工处理。" }, warnings: ["只更新当前宿主", "详情 /private/opaque-artifact/result.json"] });
    s.controller.select(["Selected"]); await s.controller.start(); const messages = s.log.mock.calls.map(call => call[0].message).join("\n");
    expect(messages).toContain("connected_component_deletion"); expect(messages).toContain("待移除副本仍被关节连接"); expect(messages).toContain("只更新当前宿主"); expect(messages).not.toContain("/private/");
    expect(safeAssemblyUpdateDiagnostic("引用索引/缓存刷新失败")).toBe("引用索引/缓存刷新失败");
    expect(safeAssemblyUpdateDiagnostic("详情/Users/opaque/evidence.json")).not.toContain("/Users");
  });
});
