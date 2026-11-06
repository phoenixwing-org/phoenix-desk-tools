import { effectScope, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FreecadMcpApi } from "./api";
import type { FreecadMcpStatus } from "../../../../shared/freecad-mcp/contracts";
import type { OwnedWorkerObservation, OwnedWorkerPhase } from "../../../../shared/freecad-mcp/worker";
import { useFreecadMcpManager } from "./useFreecadMcpManager";
import { syntheticPlan, syntheticStatus } from "./fixtures.test-support";

const scopes: ReturnType<typeof effectScope>[] = [];
function setup() {
  const api = { status: vi.fn().mockResolvedValue(syntheticStatus()), save: vi.fn(), preview: vi.fn().mockResolvedValue(syntheticPlan()), apply: vi.fn(), check: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const prompt = vi.fn().mockResolvedValue({ choiceId: "apply" }), scope = effectScope(); scopes.push(scope);
  const manager = scope.run(() => useFreecadMcpManager(api as FreecadMcpApi, prompt))!;
  return { api, prompt, manager, scope };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const managerId = "11111111-1111-4111-8111-111111111111";
function workerObservation(phase: OwnedWorkerPhase = "idle"): OwnedWorkerObservation {
  const owned = ["starting", "ready", "leased", "stopping"].includes(phase);
  return { schema_version: 1, id: phase === "idle" ? null : managerId, phase, owned,
    reason_code: phase === "idle" ? "not_started" : phase === "stopped" ? "stopped_after_owned_close" : phase === "starting" ? "launching" : "worker_ready", message: "独立合成观察", configuration_revision: phase === "idle" ? null : "combined-resource-and-executable-digest" };
}
function workerStatus(phase: OwnedWorkerPhase = "idle", enabled = true) { return { ...syntheticStatus(), owned_worker: { enabled, reason: "显式开发候选开关", observation: workerObservation(phase) } }; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z")); });
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); vi.useRealTimers(); });
describe("FreeCAD MCP explicit settings lifecycle", () => {
  it("does nothing on setup, then opens with GET status only and defaults to an owned batch instance", async () => {
    const { api, manager } = setup(); expect(manager.draft.mode).toBe("owned_batch");
    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
    await manager.open(); expect(api.status).toHaveBeenCalledOnce();
    for (const key of ["save", "preview", "apply", "check", "start"] as const) expect(api[key]).not.toHaveBeenCalled();
    expect(manager.summary.value).toContain("MCP 未就绪");
  });
  it("cannot call any action before a status revision is loaded", async () => {
    const { api, manager } = setup(); await manager.save(); await manager.preview(); await manager.check(); await manager.apply();
    for (const call of Object.values(api)) expect(call).not.toHaveBeenCalled();
  });
  it("compares settings semantically, not by response property order", async () => {
    const { api, manager } = setup(), status = syntheticStatus();
    status.settings = { existing_port: 9876, mod_directory_confirmed: true, mod_directory: "/synthetic-config/Mod", mode: "owned_batch" }; api.status.mockResolvedValue(status);
    await manager.open(); expect(manager.dirty.value).toBe(false); expect(manager.canPreview.value).toBe(true);
  });
  it("distinguishes an available FreeCAD program from plugin installation and a validated MCP connection", async () => {
    const { api, manager } = setup(); const status = syntheticStatus(); status.installation = { state: "managed", version: "1.2.3", reason: "文件已安装" }; api.status.mockResolvedValue(status);
    api.check.mockResolvedValue({ state: "blocked", phase: "bridge", reason: "JSON 桥接可用，stdio 未验证", bridge_version: "1.2.3", supported_methods: ["get_selection"], mcp_verified: false });
    await manager.open(); expect(manager.summary.value).toContain("插件文件已安装 1.2.3"); expect(manager.summary.value).toContain("MCP 未就绪");
    await manager.check(); expect(api.check).toHaveBeenCalledWith(status.revision, expect.any(AbortSignal)); expect(manager.connection.value?.phase).toBe("bridge"); expect(manager.summary.value).not.toContain("MCP 已验证"); expect(api.start).not.toHaveBeenCalled();
  });
  it("invalidates a saved ready observation on a new check and never falls back after a transport failure", async () => {
    const { api, manager } = setup(), status = syntheticStatus(); status.settings.mode = "existing";
    status.connection = { state: "ready", phase: "mcp", reason: "previous observation", bridge_version: "1.2.3", supported_methods: ["get_status"], mcp_verified: true };
    Object.freeze(status.connection); Object.freeze(status);
    api.status.mockResolvedValue(status); await manager.open(); expect(manager.summary.value).toContain("上次 MCP 检查通过（非持续连接）");
    api.check.mockRejectedValue(new Error("connection request interrupted")); const checking = manager.check();
    expect(manager.connection.value).toMatchObject({ state: "not_checked", mcp_verified: false }); expect(manager.summary.value).not.toContain("检查通过");
    await checking; expect(manager.connection.value).toMatchObject({ state: "failed", mcp_verified: false }); expect(manager.connection.value?.reason).toContain("旧的成功观察已失效");
    expect(manager.status.value?.connection.state).toBe("failed"); expect(status.connection.state).toBe("ready"); expect(manager.summary.value).not.toContain("检查通过"); expect(manager.error.value).toContain("interrupted"); expect(api.check).toHaveBeenCalledOnce();
    manager.draft.existing_port = 9988; manager.resetDraft(); expect(manager.dirty.value).toBe(false);
    expect(manager.connection.value?.state).toBe("failed"); expect(manager.summary.value).not.toContain("检查通过");
  });
  it("does not revive pre-check ready after a failed check, draft reset or failed reopen refresh", async () => {
    const { api, manager } = setup(), status = syntheticStatus(); status.settings.mode = "existing";
    status.connection = { state: "ready", phase: "mcp", reason: "previous observation", bridge_version: "1.2.3", supported_methods: ["get_status"], mcp_verified: true };
    api.status.mockResolvedValueOnce(status).mockRejectedValue(new Error("refresh unavailable")); api.check.mockRejectedValue(new Error("probe unavailable"));
    await manager.open(); await manager.check(); manager.draft.existing_port = 9988; manager.resetDraft(); manager.close(); await manager.open();
    expect(manager.connection.value).toMatchObject({ state: "failed", mcp_verified: false }); expect(manager.summary.value).not.toContain("检查通过");
    expect(manager.error.value).toContain("refresh unavailable"); expect(status.connection.state).toBe("ready");
  });
  it("keeps a started check invalidated across cancellation and failed reopen without accepting a late ready", async () => {
    const { api, manager } = setup(), status = syntheticStatus(); status.settings.mode = "existing";
    status.connection = { state: "ready", phase: "mcp", reason: "previous observation", bridge_version: "1.2.3", supported_methods: ["get_status"], mcp_verified: true };
    api.status.mockResolvedValueOnce(status).mockRejectedValue(new Error("refresh unavailable")); const pending = deferred<FreecadMcpStatus["connection"]>(); api.check.mockReturnValue(pending.promise);
    await manager.open(); const checking = manager.check(); expect(manager.status.value?.connection.state).toBe("not_checked"); manager.close(); await manager.open();
    expect(manager.connection.value).toMatchObject({ state: "not_checked", mcp_verified: false }); expect(manager.connection.value?.reason).toContain("检查已取消"); expect(manager.summary.value).not.toContain("检查通过");
    pending.resolve(status.connection); await checking; expect(manager.connection.value?.state).toBe("not_checked"); expect(manager.summary.value).not.toContain("检查通过"); expect(status.connection.state).toBe("ready");
  });
  it("describes a successful explicit probe as a past observation, not a persistent connection", async () => {
    const { api, manager } = setup(); await manager.open(); api.check.mockResolvedValue({ state: "ready", phase: "mcp", reason: "validated once", bridge_version: "1.2.3", supported_methods: ["get_status"], mcp_verified: true });
    await manager.check(); expect(manager.summary.value).toContain("上次 MCP 检查通过（非持续连接）"); expect(manager.summary.value).not.toContain("MCP 已验证");
  });
  it("blocks installation without a trusted resource, confirmed directory or managed installation", async () => {
    const { api, manager } = setup(); const status = syntheticStatus(); status.resource.state = "missing"; api.status.mockResolvedValue(status);
    await manager.open(); expect(manager.canPreview.value).toBe(false); await manager.preview(); expect(api.preview).not.toHaveBeenCalled();
    status.resource.state = "ready"; status.mod_directory.evidence = "none"; await manager.refresh(); expect(manager.canPreview.value).toBe(false);
    status.mod_directory.evidence = "user_confirmed"; status.installation.state = "modified"; await manager.refresh(); expect(manager.canPreview.value).toBe(false);
  });
  it("saves only after explicit edits using the current revision, and makes the old plan stale", async () => {
    const { api, manager } = setup(); await manager.open(); await manager.preview(); expect(manager.plan.value?.state).toBe("ready");
    manager.draft.mode = "existing"; manager.draft.existing_port = 9988; expect(manager.plan.value).toBeNull(); expect(manager.dirty.value).toBe(true);
    await manager.preview(); expect(api.preview).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled();
    const saved = syntheticStatus(); saved.revision = "synthetic-revision-2"; saved.settings = { ...manager.draft }; api.save.mockResolvedValue(saved);
    await manager.save(); expect(api.save).toHaveBeenCalledWith(saved.settings, "synthetic-revision-1"); expect(manager.status.value?.revision).toBe(saved.revision); expect(manager.dirty.value).toBe(false); expect(manager.plan.value).toBeNull();
  });
  it("requires exact directory reconfirmation after its path changes, including restoration", async () => {
    const { manager } = setup(); await manager.open(); manager.draft.mod_directory = "/synthetic-config/another-Mod";
    expect(manager.draft.mod_directory_confirmed).toBe(false); manager.resetDraft(); expect(manager.draft.mod_directory_confirmed).toBe(true); expect(manager.dirty.value).toBe(false);
  });
  it("does not overwrite unsaved edits with a status refresh", async () => {
    const { api, manager } = setup(); await manager.open(); manager.draft.mode = "existing"; await manager.refresh(); expect(api.status).toHaveBeenCalledTimes(1); expect(manager.draft.mode).toBe("existing");
  });
  it("uses default-cancel confirmation and does not install after cancellation", async () => {
    const { api, manager, prompt } = setup(); await manager.open(); await manager.preview(); prompt.mockResolvedValue({ choiceId: "cancel" }); await manager.apply();
    expect(prompt.mock.calls[0][0]).toMatchObject({ defaultChoiceId: "cancel" }); expect(prompt.mock.calls[0][0].message).toContain("a".repeat(64)); expect(prompt.mock.calls[0][0].message).toContain("摘要核验不代表已发布"); expect(api.apply).not.toHaveBeenCalled();
  });
  it("consumes a plan before installation and blocks double submission or dialog closure while writing", async () => {
    const { api, manager } = setup(); await manager.open(); await manager.preview(); const pending = deferred<Awaited<ReturnType<FreecadMcpApi["apply"]>>>(); api.apply.mockReturnValue(pending.promise);
    const applying = manager.apply(); await nextTick(); expect(api.apply).toHaveBeenCalledOnce(); expect(manager.plan.value).toBeNull(); manager.close(); expect(manager.opened.value).toBe(true); await manager.apply(); expect(api.apply).toHaveBeenCalledOnce();
    pending.resolve({ state: "installed", backup: null, restart_required: true, status: syntheticStatus() }); await applying; expect(manager.message.value).toContain("择机重启"); expect(api.check).not.toHaveBeenCalled(); expect(api.start).not.toHaveBeenCalled();
  });
  it("marks unknown installation outcome, never retries, and requires detection and a new preview", async () => {
    const { api, manager } = setup(); await manager.open(); await manager.preview(); api.apply.mockRejectedValue(new Error("transport interrupted")); await manager.apply();
    expect(manager.outcomeUnknown.value).toBe(true); expect(manager.error.value).toContain("不会自动重发"); expect(manager.plan.value).toBeNull(); await manager.apply(); await manager.preview(); await manager.check(); expect(api.apply).toHaveBeenCalledTimes(1); expect(api.preview).toHaveBeenCalledTimes(1); expect(api.check).not.toHaveBeenCalled();
    await manager.refresh(); expect(manager.outcomeUnknown.value).toBe(false); expect(manager.plan.value).toBeNull(); await manager.apply(); expect(api.apply).toHaveBeenCalledTimes(1);
  });
  it("does not submit an expired plan, including expiry during the confirmation", async () => {
    const { api, manager, prompt } = setup(); await manager.open(); await manager.preview(); vi.setSystemTime(new Date("2030-01-01T00:06:00.000Z")); await manager.apply(); expect(api.apply).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z")); await manager.preview(); prompt.mockImplementation(async () => { vi.setSystemTime(new Date("2030-01-01T00:06:00.000Z")); return { choiceId: "apply" }; }); await manager.apply(); expect(api.apply).not.toHaveBeenCalled();
  });
  it("disables an expired plan with one local timer and never polls or refreshes it automatically", async () => {
    const { api, manager } = setup(); await manager.open(); await manager.preview(); expect(manager.canApply.value).toBe(true); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000); expect(manager.planExpired.value).toBe(true); expect(manager.canApply.value).toBe(false); expect(vi.getTimerCount()).toBe(0);
    expect(api.status).toHaveBeenCalledOnce(); expect(api.preview).toHaveBeenCalledOnce(); await manager.apply(); expect(api.apply).not.toHaveBeenCalled();
  });
  it("clears the local plan-expiry timer on close, replacement and owner disposal", async () => {
    const { manager, scope } = setup(); await manager.open(); await manager.preview(); expect(vi.getTimerCount()).toBe(1);
    await manager.preview(); expect(vi.getTimerCount()).toBe(1); manager.close(); expect(vi.getTimerCount()).toBe(0);
    await manager.open(); await manager.preview(); expect(vi.getTimerCount()).toBe(1); scope.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores stale detection after close and reopen", async () => {
    const { api, manager } = setup(), late = deferred<ReturnType<typeof syntheticStatus>>(); api.status.mockReturnValueOnce(late.promise); const first = manager.open(), signal = api.status.mock.calls[0][0] as AbortSignal; manager.close(); expect(signal.aborted).toBe(true);
    await manager.open(); const old = syntheticStatus(); old.revision = "obsolete"; late.resolve(old); await first; expect(manager.status.value?.revision).toBe("synthetic-revision-1"); expect(manager.operation.value).toBe("");
  });
  it("discards late connection and plan responses once the dialog closes", async () => {
    const { api, manager } = setup(); await manager.open(); const pending = deferred<ReturnType<typeof syntheticPlan>>(); api.preview.mockReturnValue(pending.promise); const request = manager.preview(); manager.close(); pending.resolve(syntheticPlan()); await request; expect(manager.plan.value).toBeNull();
    await manager.open(); const bridge = deferred<FreecadMcpStatus["connection"]>(); api.check.mockReturnValue(bridge.promise); const check = manager.check(); manager.close(); bridge.resolve({ ...syntheticStatus().connection, reason: "late result" }); await check; expect(manager.connection.value?.reason).not.toBe("late result");
  });
  it("does not continue an installation confirmation after configuration changes or parent close", async () => {
    const { api, manager, prompt } = setup(); await manager.open(); await manager.preview(); const answer = deferred<{ choiceId: string }>(); prompt.mockReturnValue(answer.promise); const request = manager.apply(); manager.draft.mode = "existing"; answer.resolve({ choiceId: "apply" }); await request; expect(api.apply).not.toHaveBeenCalled();
  });
  it("aborts a read on owner disposal and does not restart anything", async () => {
    const { api, manager, scope } = setup(), late = deferred<ReturnType<typeof syntheticStatus>>(); api.status.mockReturnValue(late.promise); const request = manager.open(), signal = api.status.mock.calls[0][0] as AbortSignal; scope.stop(); expect(signal.aborted).toBe(true); late.resolve(syntheticStatus()); await request; expect(manager.status.value).toBeNull(); expect(api.start).not.toHaveBeenCalled();
  });
});

describe("M0 explicit owned worker connection test", () => {
  it("never auto-starts, and absent/disabled resources cannot start", async () => {
    const { api, manager, prompt } = setup(); await manager.open(); await manager.startWorker(); expect(prompt).not.toHaveBeenCalled(); expect(api.start).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    api.status.mockResolvedValue(workerStatus("idle", false)); await manager.refresh(); await manager.startWorker(); expect(api.start).not.toHaveBeenCalled();
    const missing = workerStatus(); missing.resource.state = "missing"; api.status.mockResolvedValue(missing); await manager.refresh(); expect(manager.canStartWorker.value).toBe(false);
  });
  it("uses default-cancel Native confirmation and does not start after cancellation", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValue(workerStatus()); await manager.open(); prompt.mockResolvedValue({ choiceId: "cancel" }); await manager.startWorker();
    expect(prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ defaultChoiceId: "cancel", title: "启动独立 worker（连接测试）" })); expect(prompt.mock.calls[0][0].message).toContain("不接管或关闭现有 FreeCAD / CAD"); expect(prompt.mock.calls[0][0].message).toContain("开发候选"); expect(api.start).not.toHaveBeenCalled();
  });
  it("consumes one explicit start, treats starting ownership as not ready, and prevents duplicates", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValue(workerStatus()); await manager.open(); prompt.mockResolvedValue({ choiceId: "start" }); const pending = deferred<OwnedWorkerObservation>(); api.start.mockReturnValue(pending.promise);
    const command = manager.startWorker(); await nextTick(); await manager.startWorker(); expect(api.start).toHaveBeenCalledExactlyOnceWith("synthetic-revision-1"); expect(manager.workerOutcomeUnknown.value).toBe(true); expect(manager.canStartWorker.value).toBe(false);
    pending.resolve(workerObservation("starting")); await command; expect(manager.workerLabel.value).toBe("正在启动"); expect(manager.workerOutcomeUnknown.value).toBe(false); expect(manager.configurationLocked.value).toBe(true); expect(manager.canStartWorker.value).toBe(false); expect(manager.canStopWorker.value).toBe(true);
  });
  it("polls only open active phases every five seconds and never dispatches commands", async () => {
    const { api, manager } = setup(); api.status.mockResolvedValue(workerStatus("starting")); await manager.open(); expect(api.status).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(4999); expect(api.status).toHaveBeenCalledOnce();
    api.status.mockResolvedValue(workerStatus("ready")); await vi.advanceTimersByTimeAsync(1); expect(api.status).toHaveBeenCalledTimes(2); expect(manager.worker.value?.phase).toBe("ready");
    api.status.mockResolvedValue(workerStatus("stopped")); await vi.advanceTimersByTimeAsync(5000); expect(manager.worker.value?.phase).toBe("stopped"); expect(vi.getTimerCount()).toBe(0); expect(api.start).not.toHaveBeenCalled(); expect(api.stop).not.toHaveBeenCalled();
  });
  it("invalidates a previous ready observation on poll failure and waits for explicit refresh", async () => {
    const { api, manager } = setup(); api.status.mockResolvedValueOnce(workerStatus("ready")).mockRejectedValueOnce(new Error("read timeout")); await manager.open(); await vi.advanceTimersByTimeAsync(5000);
    expect(manager.worker.value?.phase).toBe("unknown"); expect(manager.workerLabel.value).not.toContain("连接测试就绪"); expect(vi.getTimerCount()).toBe(0); expect(manager.canStopWorker.value).toBe(true); expect(api.start).not.toHaveBeenCalled(); expect(api.stop).not.toHaveBeenCalled();
    api.status.mockResolvedValue(workerStatus("ready")); await manager.refreshWorker(); expect(manager.worker.value?.phase).toBe("ready");
  });
  it("closing aborts only UI reads, drops late responses and never stops a worker", async () => {
    const { api, manager } = setup(); api.status.mockResolvedValueOnce(workerStatus("ready")); await manager.open(); const late = deferred<FreecadMcpStatus>(); api.status.mockReturnValueOnce(late.promise);
    const observing = manager.refreshWorker(), signal = api.status.mock.calls.at(-1)![0] as AbortSignal; manager.close(); expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0); late.resolve(workerStatus("stopped")); await observing;
    expect(manager.worker.value?.phase).toBe("ready"); expect(api.stop).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(20_000); expect(api.status).toHaveBeenCalledTimes(2);
  });
  it("closing during a start does not cancel it or accept its late result", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValue(workerStatus()); await manager.open(); prompt.mockResolvedValue({ choiceId: "start" }); const pending = deferred<OwnedWorkerObservation>(); api.start.mockReturnValue(pending.promise);
    const starting = manager.startWorker(); await nextTick(); manager.close(); expect(manager.opened.value).toBe(false); pending.resolve(workerObservation("ready")); await starting; expect(manager.worker.value?.phase).toBe("idle"); expect(manager.workerOutcomeUnknown.value).toBe(true); expect(api.stop).not.toHaveBeenCalled();
    api.status.mockResolvedValue(workerStatus("ready")); await manager.open(); expect(manager.worker.value?.id).toBe(managerId); expect(manager.canStartWorker.value).toBe(false); expect(manager.canStopWorker.value).toBe(true);
  });
  it("does not revive readiness after closing and a failed reopen observation", async () => {
    const { api, manager } = setup(); api.status.mockResolvedValueOnce(workerStatus("ready")).mockRejectedValueOnce(new Error("unavailable")); await manager.open(); manager.close(); await manager.open(); expect(manager.worker.value?.phase).toBe("unknown"); expect(manager.workerLabel.value).not.toContain("连接测试就绪"); expect(api.start).not.toHaveBeenCalled(); expect(api.stop).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain start when fresh status still cannot identify the request", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValue(workerStatus()); await manager.open(); prompt.mockResolvedValue({ choiceId: "start" }); api.start.mockRejectedValue(new Error("timeout")); await manager.startWorker();
    expect(api.status).toHaveBeenCalledTimes(2); expect(manager.workerOutcomeUnknown.value).toBe(true); await manager.startWorker(); expect(api.start).toHaveBeenCalledOnce();
    api.status.mockResolvedValue(workerStatus("starting")); await manager.refreshWorker(); expect(manager.worker.value?.id).toBe(managerId); expect(manager.workerOutcomeUnknown.value).toBe(false); expect(manager.canStartWorker.value).toBe(false);
  });
  it("keeps explicit UUID stop available when the candidate is disabled, and waits for its response", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValue(workerStatus("ready", false)); await manager.open(); expect(manager.canStopWorker.value).toBe(true); expect(manager.canStartWorker.value).toBe(false);
    prompt.mockResolvedValue({ choiceId: "stop" }); const pending = deferred<OwnedWorkerObservation>(); api.stop.mockReturnValue(pending.promise); const stopping = manager.stopWorker(); await nextTick(); expect(api.stop).toHaveBeenCalledExactlyOnceWith(managerId); expect(manager.worker.value?.phase).toBe("ready"); expect(manager.workerOutcomeUnknown.value).toBe(true);
    pending.resolve(workerObservation("stopped")); await stopping; expect(manager.worker.value?.phase).toBe("stopped"); expect(manager.message.value).toContain("实际退出");
  });
  it("does not replay stop or adopt another UUID after an uncertain stop", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValueOnce(workerStatus("ready")); await manager.open(); const other = workerStatus("ready"); other.owned_worker.observation.id = "22222222-2222-4222-8222-222222222222"; api.status.mockResolvedValue(other); prompt.mockResolvedValue({ choiceId: "stop" }); api.stop.mockRejectedValue(new Error("timeout")); await manager.stopWorker(); await manager.stopWorker();
    expect(api.stop).toHaveBeenCalledOnce(); expect(manager.worker.value).toBeNull(); expect(manager.workerOutcomeUnknown.value).toBe(true); expect(manager.canStartWorker.value).toBe(false);
  });
  it("locks config/install/probe during owned lifetime, while stop remains possible even for an edited draft", async () => {
    const { api, manager, prompt } = setup(); api.status.mockResolvedValue(workerStatus("ready")); await manager.open(); expect(manager.configurationLocked.value).toBe(true); expect(manager.canPreview.value).toBe(false); expect(manager.canApply.value).toBe(false);
    manager.draft.existing_port = 9988; await manager.save(); await manager.preview(); await manager.check(); await manager.apply(); expect(api.save).not.toHaveBeenCalled(); expect(api.preview).not.toHaveBeenCalled(); expect(api.check).not.toHaveBeenCalled(); expect(api.apply).not.toHaveBeenCalled();
    expect(manager.canStopWorker.value).toBe(true); prompt.mockResolvedValue({ choiceId: "stop" }); api.stop.mockResolvedValue(workerObservation("stopped")); await manager.stopWorker(); expect(api.stop).toHaveBeenCalledExactlyOnceWith(managerId); expect(manager.configurationLocked.value).toBe(false);
  });
  it("does not inherit an observation after editing/resetting or saving a new revision", async () => {
    const { api, manager } = setup(); api.status.mockResolvedValue(workerStatus()); await manager.open(); expect(manager.canStartWorker.value).toBe(true); manager.draft.existing_port = 9988; manager.resetDraft(); expect(manager.workerStale.value).toBe(true); expect(manager.canStartWorker.value).toBe(false);
    await manager.refresh(); expect(manager.canStartWorker.value).toBe(true); manager.draft.existing_port = 9988; const saved = workerStatus(); saved.revision = "new-settings-revision"; saved.settings = { ...manager.draft }; api.save.mockResolvedValue(saved); await manager.save(); expect(manager.worker.value?.phase).toBe("idle"); expect(api.start).not.toHaveBeenCalled();
  });
  it("cancels confirmation after draft change or owner closure and clears polling on disposal", async () => {
    const { api, manager, prompt, scope } = setup(); api.status.mockResolvedValue(workerStatus()); await manager.open(); const answer = deferred<{ choiceId: string }>(); prompt.mockReturnValue(answer.promise); const starting = manager.startWorker(); manager.draft.existing_port = 9988; answer.resolve({ choiceId: "start" }); await starting; expect(api.start).not.toHaveBeenCalled(); manager.resetDraft();
    api.status.mockResolvedValue(workerStatus("ready")); await manager.refresh(); expect(vi.getTimerCount()).toBe(1); scope.stop(); expect(vi.getTimerCount()).toBe(0); expect(api.stop).not.toHaveBeenCalled();
  });
});
