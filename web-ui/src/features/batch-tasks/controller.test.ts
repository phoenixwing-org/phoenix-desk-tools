import { afterEach, describe, expect, it, vi } from "vitest";
import { createBatchTasksController } from "./controller";
import type { BatchTasksApi } from "./api";
import { syntheticAction, syntheticLegacyPlan, syntheticMixedPlan, syntheticNativePlan, syntheticPlan, syntheticRun, syntheticTask } from "./fixtures.test-support";

function setup() {
  const api: BatchTasksApi = {
    actions: vi.fn().mockResolvedValue({ actions: [syntheticAction()] }), tasks: vi.fn().mockResolvedValue({ tasks: [syntheticTask()] }), runs: vi.fn().mockResolvedValue({ runs: [] }),
    save: vi.fn().mockResolvedValue({ task: syntheticTask({ revision: 2 }) }), archive: vi.fn().mockResolvedValue({ task: syntheticTask({ revision: 2, archived: true }) }), preview: vi.fn().mockResolvedValue({ plan: syntheticPlan() }),
    admit: vi.fn().mockResolvedValue({ run: syntheticRun() }), detail: vi.fn().mockResolvedValue({ run: syntheticRun(), steps: [], events: [] }), retryDrafts: vi.fn().mockResolvedValue({ run_id: "run-a", groups: [] }), cancel: vi.fn().mockResolvedValue({ run: syntheticRun({ status: "cancel_requested", cancel_requested: true }) }), byRequest: vi.fn().mockResolvedValue({ run: syntheticRun() }), backup: vi.fn().mockResolvedValue({ schema_version: 1 }),
  };
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  const controller = createBatchTasksController(api, storage);
  return { api, controller, memory, storage };
}
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
describe("application batch task controller", () => {
  it("keeps untouched empty, newly created and archived-only editors clean across workspaces", async () => {
    const { api, controller } = setup(); expect(controller.dirty.value).toBe(false);
    vi.mocked(api.tasks).mockResolvedValue({ tasks: [] }); controller.setWorkspace("/empty-synthetic-workspace");
    expect(controller.dirty.value).toBe(false); await flush(); expect(controller.dirty.value).toBe(false);
    controller.newTask(); expect(controller.dirty.value).toBe(false);
    controller.editPaths("samples/edited.txt"); expect(controller.dirty.value).toBe(true);
    expect(controller.discardDraft()).toBe(true); await controller.refresh();
    expect(controller.state.paths).toBe(""); expect(controller.dirty.value).toBe(false);
    vi.mocked(api.tasks).mockResolvedValue({ tasks: [syntheticTask({ archived: true })] });
    controller.setWorkspace("/archived-only-synthetic-workspace"); await flush();
    expect(controller.state.editingId).toBe(""); expect(controller.dirty.value).toBe(false);
    controller.setWorkspace(""); expect(controller.dirty.value).toBe(false);
    expect(api.save).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });

  it("includes actual file/action failure causes in the error sent to Bottom without hiding successful items", async () => {
    const { api, controller } = setup();
    vi.mocked(api.runs).mockResolvedValue({ runs: [syntheticRun({ status: "running" })] });
    controller.setWorkspace("/independent-workspace"); await flush();
    vi.mocked(api.runs).mockResolvedValue({ runs: [syntheticRun({ status: "partial", total: 2, completed: 1, failed: 1 })] });
    vi.mocked(api.detail).mockResolvedValue({ run: syntheticRun({ status: "partial" }), events: [], steps: [{ id: "failed", run_id: "run-a", item_id: "one", subject: { kind: "file", rel: "samples/Broken.FCStd" }, action_instance_id: "action-a", action_key: "cad.saved-properties", status: "failed", message: "独立合成压缩包无效" }] });
    await controller.refresh();
    expect(controller.state.error).toContain("samples/Broken.FCStd · cad.saved-properties：独立合成压缩包无效");
    expect(controller.state.error).toContain("成功项已保留"); expect(controller.state.stale).toBe(false);
    expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it("loads multiple saved definitions without executing and edits with CAS", async () => {
    const { api, controller } = setup(); vi.mocked(api.tasks).mockResolvedValue({ tasks: [syntheticTask(), syntheticTask({ id: "task-b", name: "第二任务" })] });
    controller.setWorkspace("/independent-workspace"); await flush(); expect(controller.state.tasks).toHaveLength(2); expect(api.admit).not.toHaveBeenCalled();
    controller.editName("Changed"); await controller.save(); expect(api.save).toHaveBeenCalledWith("/independent-workspace", expect.objectContaining({ name: "Changed" }), "task-a", 1, undefined);
    expect(controller.state.editingRevision).toBe(2);
  });
  it("accepts only after preview, keeps a stable request id for an unconfirmed admission, and recovers it", async () => {
    const { api, controller, memory } = setup(); controller.setWorkspace("/independent-workspace"); await flush();
    expect(await controller.admit()).toBe(false); expect(api.admit).not.toHaveBeenCalled(); await controller.preview();
    vi.mocked(api.admit).mockRejectedValueOnce(new Error("connection lost")); await controller.admit(); const request = controller.state.admission;
    expect(request?.client_request_id).toBeTruthy(); expect(request?.protocol_version).toBe(2); expect(vi.mocked(api.admit).mock.calls[0][1].protocol_version).toBe(2); expect(memory.size).toBe(1); expect(controller.state.error).toContain("未确认");
    await controller.submitAdmission(); expect(vi.mocked(api.admit).mock.calls[1][1]).toEqual(request); expect(controller.state.runs).toHaveLength(1); expect(controller.state.admission).toBeNull(); expect(memory.size).toBe(0);
  });
  it("hydrates only an admission pointer and queries the original run after a reload", async () => {
    const { api, controller, storage } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    vi.mocked(api.admit).mockRejectedValueOnce(new Error("connection lost")); await controller.admit();
    const restored = createBatchTasksController(api, storage); restored.setWorkspace("/independent-workspace"); await flush();
    expect(api.byRequest).toHaveBeenCalledWith("/independent-workspace", expect.any(String)); expect(restored.state.runs[0].id).toBe("run-a"); expect(restored.state.admission).toBeNull();
  });
  it("never invents cancelled on HTTP failure, and accepts cancellation only from a server receipt", async () => {
    const { api, controller } = setup(); vi.mocked(api.runs).mockResolvedValue({ runs: [syntheticRun({ status: "running" })] }); controller.setWorkspace("/independent-workspace"); await flush();
    vi.mocked(api.cancel).mockRejectedValueOnce(new Error("not confirmed")); await controller.cancel("run-a"); expect(controller.state.runs[0].status).toBe("running"); expect(controller.state.error).toContain("没有将任务标记为已取消");
    await controller.cancel("run-a"); expect(controller.state.runs[0].status).toBe("cancel_requested");
  });
  it("ignores old workspace admission receipts and leaves server work untouched when polling stops", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/one"); await flush(); await controller.preview();
    let resolve!: (value: Awaited<ReturnType<BatchTasksApi["admit"]>>) => void; vi.mocked(api.admit).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const accepting = controller.admit(); controller.setWorkspace("/two"); resolve({ run: syntheticRun() }); await accepting; await flush(); expect(controller.state.runs).toEqual([]); expect(controller.state.workspace).toBe("/two");
    controller.startPolling(); controller.stopPolling(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it("invalidates preview on edits, preserves a new empty draft through polling, and supports independent backup", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview(); controller.editPaths("samples/changed.txt"); expect(controller.state.plan).toBeNull();
    controller.newTask(); await controller.refresh(); expect(controller.state.editingId).toBe(""); expect(controller.state.paths).toBe("");
    expect(await controller.backup()).toEqual({ schema_version: 1 }); expect(api.backup).toHaveBeenCalledWith("/independent-workspace");
  });
  it("does not preview an externally changed revision using stale editor contents", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush();
    vi.mocked(api.tasks).mockResolvedValue({ tasks: [syntheticTask({ revision: 2, subjects: [{ kind: "file", rel: "samples/other.txt" }] })] }); await controller.refresh();
    expect(await controller.preview()).toBe(false); expect(api.preview).not.toHaveBeenCalled(); expect(controller.state.error).toContain("其他页面更新"); expect(controller.state.paths).toBe("samples/note.txt");
  });
  it("does not submit a second request or invent uncertainty on a double click", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    let resolve!: (value: Awaited<ReturnType<BatchTasksApi["admit"]>>) => void; vi.mocked(api.admit).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = controller.admit(); expect(await controller.admit()).toBe(false); expect(api.admit).toHaveBeenCalledTimes(1); expect(controller.state.error).toBe("");
    resolve({ run: syntheticRun() }); expect(await first).toBe(true); expect(controller.state.error).toBe("");
  });
  it("releases an old preview only after both a definite rejection and missing admission proof", async () => {
    const { api, controller, memory } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    vi.mocked(api.admit).mockRejectedValueOnce(Object.assign(new Error("expired preview"), { status: 400 }));
    vi.mocked(api.byRequest).mockRejectedValueOnce(Object.assign(new Error("no record"), { status: 404 }));
    expect(await controller.admit()).toBe(false); expect(controller.state.admission).toBeNull(); expect(controller.state.plan).toBeNull(); expect(memory.size).toBe(0); expect(controller.state.error).toContain("确认原请求没有运行记录");
  });
  it("preserves the last ledger states when the server reports a stopped scheduler", async () => {
    const { api, controller } = setup(); vi.mocked(api.runs).mockResolvedValue({ runs: [syntheticRun({ status: "running" })] }); controller.setWorkspace("/independent-workspace"); await flush();
    vi.mocked(api.runs).mockRejectedValueOnce(Object.assign(new Error("队列调度已停止，请检查任务库"), { status: 400 })); await controller.refresh();
    expect(controller.state.runs[0].status).toBe("running"); expect(controller.state.stale).toBe(true); expect(controller.state.error).toContain("队列调度已停止"); expect(api.cancel).not.toHaveBeenCalled();
  });
  it("ignores same-workspace reads started before a newer admission or cancellation receipt", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    let resolve!: (value: Awaited<ReturnType<BatchTasksApi["runs"]>>) => void;
    vi.mocked(api.runs).mockReturnValueOnce(new Promise(done => { resolve = done; })); const oldBeforeAdmission = controller.refresh();
    expect(await controller.admit()).toBe(true); resolve({ runs: [] }); await oldBeforeAdmission; expect(controller.state.runs[0].id).toBe("run-a");
    vi.mocked(api.runs).mockReturnValueOnce(new Promise(done => { resolve = done; })); const oldBeforeCancel = controller.refresh();
    vi.mocked(api.cancel).mockResolvedValueOnce({ run: syntheticRun({ status: "cancelled", cancel_requested: true }) }); await controller.cancel("run-a");
    resolve({ runs: [syntheticRun({ status: "running" })] }); await oldBeforeCancel;
    expect(controller.state.runs[0].status).toBe("cancelled"); expect(controller.state.runs[0].cancel_requested).toBe(true);
  });
  it("reuses a stable creation id after an uncertain save, blocking changed drafts and restoring only the pointer", async () => {
    const { api, controller, storage } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); controller.newTask(); controller.editPaths("samples/new.txt");
    vi.mocked(api.save).mockRejectedValueOnce(new Error("response lost")); expect(await controller.save()).toBe(false);
    const original = vi.mocked(api.save).mock.calls[0], creationId = original[4]; expect(creationId).toBeTruthy(); expect(controller.state.creationUncertain).toBe(true);
    controller.editName("changed after uncertain save"); expect(await controller.save()).toBe(false); expect(api.save).toHaveBeenCalledTimes(1); expect(controller.state.error).toContain("草稿内容已经变化");
    const restored = createBatchTasksController(api, storage); restored.setWorkspace("/independent-workspace"); await flush(); expect(restored.state.creationId).toBe(creationId); expect(restored.state.creationUncertain).toBe(true); expect(restored.state.paths).toBe("");
    controller.editName(original[1].name); vi.mocked(api.save).mockResolvedValueOnce({ task: syntheticTask({ id: creationId!, name: original[1].name, subjects: original[1].subjects, actions: original[1].actions }) });
    expect(await controller.save()).toBe(true); expect(vi.mocked(api.save).mock.calls[1][4]).toBe(creationId); expect(controller.state.creationUncertain).toBe(false); expect(controller.state.creationId).toBe("");
  });
  it("releases a definitely rejected new creation only when the complete empty ledger proves it absent", async () => {
    const { api, controller, memory } = setup(); vi.mocked(api.tasks).mockResolvedValue({ tasks: [] }); controller.setWorkspace("/empty-workspace"); await flush();
    controller.newTask(); controller.editPaths("samples/rejected.txt");
    vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error("hidden input rejected"), { status: 400 })); expect(await controller.save()).toBe(false);
    expect(controller.state.creationUncertain).toBe(false); expect(controller.state.creationId).toBe(""); expect(memory.size).toBe(0); expect(controller.state.error).toContain("可以修正草稿");
    controller.newTask(); controller.editPaths("samples/valid.txt");
    vi.mocked(api.save).mockImplementationOnce(async (_workspace, draft, _id, _revision, creationId) => ({ task: syntheticTask({ ...draft, id: creationId! }) }));
    expect(await controller.save()).toBe(true); expect(controller.state.draft.subjects[0].rel).toBe("samples/valid.txt");
  });
  it.each(["already-exists", "lookup-fails"] as const)("retains an uncertain creation after a 400 when %s", async mode => {
    const { api, controller, memory } = setup(); vi.mocked(api.tasks).mockResolvedValue({ tasks: [] }); controller.setWorkspace("/empty-workspace"); await flush(); controller.newTask(); controller.editPaths("samples/note.txt");
    vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error("save rejected"), { status: 400 }));
    if (mode === "already-exists") vi.mocked(api.tasks).mockImplementationOnce(async () => ({ tasks: [syntheticTask({ id: controller.state.creationId })] }));
    else vi.mocked(api.tasks).mockRejectedValueOnce(new Error("lookup connection lost"));
    expect(await controller.save()).toBe(false); const creationId = controller.state.creationId;
    expect(creationId).toBeTruthy(); expect(controller.state.creationUncertain).toBe(true); expect(memory.size).toBe(1);
    controller.editPaths("samples/changed.txt"); expect(await controller.save()).toBe(false); expect(api.save).toHaveBeenCalledTimes(1); expect(controller.state.creationId).toBe(creationId);
  });
  it("does not clear a restored creation pointer with proof from an earlier workspace generation", async () => {
    const { api, controller } = setup(); vi.mocked(api.tasks).mockResolvedValue({ tasks: [] }); controller.setWorkspace("/one"); await flush(); controller.newTask(); controller.editPaths("samples/note.txt");
    vi.mocked(api.save).mockRejectedValueOnce(Object.assign(new Error("save rejected"), { status: 400 }));
    let resolve!: (value: Awaited<ReturnType<BatchTasksApi["tasks"]>>) => void;
    vi.mocked(api.tasks).mockReturnValueOnce(new Promise(done => { resolve = done; })); const saving = controller.save(); await flush(); const creationId = controller.state.creationId;
    controller.setWorkspace("/two"); await flush(); controller.setWorkspace("/one"); await flush(); resolve({ tasks: [] }); await saving;
    expect(controller.state.workspace).toBe("/one"); expect(controller.state.creationId).toBe(creationId); expect(controller.state.creationUncertain).toBe(true);
  });
  it("admits an explicit V2 mixed plan once without expanding its whole-batch step", async () => {
    const { api, controller } = setup(); vi.mocked(api.preview).mockResolvedValueOnce({ plan: syntheticMixedPlan() });
    controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    expect(controller.state.plan?.steps).toHaveLength(3); expect(await controller.admit()).toBe(true);
    expect(api.admit).toHaveBeenCalledTimes(1); expect(api.admit).toHaveBeenCalledWith("/independent-workspace", { protocol_version: 2, plan_id: "plan-a", digest: "independent-digest", client_request_id: expect.any(String), confirmed: true });
  });
  it("never upgrades a versionless legacy preview into V2 permission", async () => {
    const { api, controller } = setup(); vi.mocked(api.preview).mockResolvedValueOnce({ plan: syntheticLegacyPlan() });
    controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    expect(await controller.admit()).toBe(false); expect(api.admit).not.toHaveBeenCalled(); expect(controller.state.admission).toBeNull(); expect(controller.state.error).toContain("旧版预览不能升级");
  });
  it("can hold a pure V3 preview read-only but never submits protocol 3 or creates a V2 admission pointer for it", async () => {
    const { api, controller, memory } = setup(); vi.mocked(api.preview).mockResolvedValueOnce({ plan: syntheticNativePlan() });
    controller.setWorkspace("/independent-workspace"); await flush(); expect(await controller.preview()).toBe(true);
    expect(controller.state.plan?.protocol_version).toBe(3); expect(controller.dirty.value).toBe(false);
    expect(controller.state.plan?.summary.executable).toBe(1); expect(await controller.admit()).toBe(false);
    expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled(); expect(controller.state.admission).toBeNull(); expect(memory.size).toBe(0);
    expect(controller.state.error).toContain("不能升级为 V2 接纳权限"); expect(await controller.submitAdmission()).toBe(false);
  });
  it.each([undefined, 1] as const)("looks up legacy protocol %s pointers without POST or upgrading them", async protocol => {
    const { api, controller, memory } = setup(), pointer = { plan_id: "legacy-plan", digest: "legacy-digest", client_request_id: "legacy-request", confirmed: true, ...(protocol === undefined ? {} : { protocol_version: protocol }) };
    memory.set("phoenix-desk.batch-admission.v1:/independent-workspace", JSON.stringify(pointer));
    controller.setWorkspace("/independent-workspace"); await flush();
    expect(api.byRequest).toHaveBeenCalledWith("/independent-workspace", "legacy-request"); expect(api.admit).not.toHaveBeenCalled(); expect(controller.state.runs[0].id).toBe("run-a"); expect(controller.state.admission).toBeNull(); expect(memory.size).toBe(0);
  });
  it("requires a new preview after an exact missing legacy request rather than resubmitting its old plan", async () => {
    const { api, controller, memory } = setup(); memory.set("phoenix-desk.batch-admission.v1:/independent-workspace", JSON.stringify({ plan_id: "legacy-plan", digest: "legacy-digest", client_request_id: "legacy-request", confirmed: true }));
    vi.mocked(api.byRequest).mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    controller.setWorkspace("/independent-workspace"); await flush();
    expect(controller.state.admission).toBeNull(); expect(controller.state.plan).toBeNull(); expect(memory.size).toBe(0); expect(controller.state.error).toContain("旧计划不会按 V2 重发"); expect(await controller.submitAdmission()).toBe(false); expect(api.admit).not.toHaveBeenCalled();
    await controller.preview(); expect(await controller.admit()).toBe(true); const request = vi.mocked(api.admit).mock.calls[0][1]; expect(request.protocol_version).toBe(2); expect(request.plan_id).toBe("plan-a"); expect(request.client_request_id).not.toBe("legacy-request");
  });
  it("retains an uncertain legacy pointer on failed lookup and refuses even a direct retry call", async () => {
    const { api, controller, memory } = setup(), pointer = { plan_id: "legacy-plan", digest: "legacy-digest", client_request_id: "legacy-request", confirmed: true as const };
    memory.set("phoenix-desk.batch-admission.v1:/independent-workspace", JSON.stringify(pointer)); vi.mocked(api.byRequest).mockRejectedValueOnce(new Error("offline"));
    controller.setWorkspace("/independent-workspace"); await flush(); expect(controller.state.admission).toEqual(pointer); expect(controller.canRetryAdmission.value).toBe(false);
    expect(await controller.submitAdmission()).toBe(false); expect(api.admit).not.toHaveBeenCalled(); expect(controller.state.admission).toEqual(pointer); expect(memory.size).toBe(1);
    await controller.preview(); expect(await controller.admit()).toBe(false); expect(api.admit).not.toHaveBeenCalled(); expect(controller.state.admission).toEqual(pointer);
  });
  it("does not clear a legacy pointer using a delayed 404 from an older workspace generation", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/one"); await flush();
    const pointer = { plan_id: "legacy-plan", digest: "legacy-digest", client_request_id: "same-request", confirmed: true as const };
    controller.state.admission = pointer;
    let reject!: (error: unknown) => void; vi.mocked(api.byRequest).mockReturnValueOnce(new Promise((_resolve, failure) => { reject = failure; }));
    const recovering = controller.recoverAdmission(); controller.setWorkspace("/two"); await flush(); controller.state.admission = { ...pointer };
    reject(Object.assign(new Error("old not found"), { status: 404 })); await recovering;
    expect(controller.state.workspace).toBe("/two"); expect(controller.state.admission).toEqual(pointer); expect(controller.state.error).toBe("");
  });
  it("keeps a V2 missing-run pointer retryable with the same id and protocol", async () => {
    const { api, controller, memory } = setup(), pointer = { protocol_version: 2, plan_id: "plan-a", digest: "independent-digest", client_request_id: "v2-request", confirmed: true };
    memory.set("phoenix-desk.batch-admission.v1:/independent-workspace", JSON.stringify(pointer)); vi.mocked(api.byRequest).mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    controller.setWorkspace("/independent-workspace"); await flush(); expect(controller.state.admission).toEqual(pointer); expect(controller.canRetryAdmission.value).toBe(true);
    expect(await controller.submitAdmission()).toBe(true); expect(api.admit).toHaveBeenCalledWith("/independent-workspace", pointer);
  });
  it("takes registered action versions from the catalog instead of hard-coding version one", async () => {
    const { api, controller } = setup(); vi.mocked(api.actions).mockResolvedValueOnce({ actions: [{ ...syntheticAction(), version: 3 }, { ...syntheticAction(), key: "synthetic.batch", version: 2, scope: "batch" }] });
    controller.setWorkspace("/independent-workspace"); await flush(); controller.newTask(); controller.toggleAction("synthetic.batch", true); controller.toggleAction("unknown.action", true);
    expect(controller.state.draft.actions.map(action => [action.key, action.version])).toEqual([["file.metadata", 3], ["synthetic.batch", 2]]);
  });
  it("moves action instances without changing identity, invalidates preview and preserves order on save", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    const first = controller.state.draft.actions[0], second = { ...first, instance_id: "second-instance" }; controller.state.draft.actions.push(second);
    expect(controller.moveAction(second.instance_id, "up")).toBe(true); expect(controller.state.plan).toBeNull();
    expect(controller.state.draft.actions.map(action => action.instance_id)).toEqual([second.instance_id, first.instance_id]);
    expect(controller.moveAction(second.instance_id, "up")).toBe(false); await controller.save();
    expect(vi.mocked(api.save).mock.calls[0][1].actions.map(action => action.instance_id)).toEqual([second.instance_id, first.instance_id]);
    controller.state.pending = "save"; expect(controller.moveAction(second.instance_id, "down")).toBe(false); controller.state.pending = "";
    controller.state.creationUncertain = true; expect(controller.moveAction(second.instance_id, "down")).toBe(false);
  });
  it("prepares a server failure group as a new draft without saving, previewing or reusing old admission authority", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.preview();
    const action = syntheticTask().actions[0], group = { id: action.instance_id, action_instance_id: action.instance_id, action_key: action.key, action_title: "文件信息", action_version: action.version, scope: "file" as const, failed_steps: 1, available: true, draft: { name: "独立失败项重试", subjects: [{ kind: "file" as const, rel: "samples/failed.txt" }], actions: [action] } };
    vi.mocked(api.retryDrafts).mockResolvedValueOnce({ run_id: "run-a", groups: [group] }); await controller.selectRun("run-a");
    expect(await controller.loadRetryGroups()).toBe(true); expect(controller.startRetryGroup(controller.state.retryGroups[0])).toBe(true);
    expect(controller.state.editingId).toBe(""); expect(controller.state.editingRevision).toBe(0); expect(controller.state.plan).toBeNull(); expect(controller.state.paths).toBe("samples/failed.txt"); expect(controller.state.draft.actions).toEqual([action]);
    expect(api.save).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled(); expect(api.preview).toHaveBeenCalledTimes(1); expect(controller.state.admission).toBeNull();
    expect(await controller.admit()).toBe(false); expect(api.admit).not.toHaveBeenCalled();
    controller.state.creationUncertain = true; const before = JSON.stringify(controller.state.draft); expect(controller.startRetryGroup(group)).toBe(false); expect(JSON.stringify(controller.state.draft)).toBe(before); expect(controller.state.error).toContain("保存结果未确认");
  });
  it("never overwrites an uncertain creation or admission and does not upgrade an unavailable retry version", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.selectRun("run-a");
    const action = syntheticTask().actions[0], group = { id: action.instance_id, action_instance_id: action.instance_id, action_key: action.key, action_title: "文件信息", action_version: action.version, scope: "file" as const, failed_steps: 1, available: true, draft: { name: "Independent retry", subjects: [{ kind: "file" as const, rel: "samples/failed.txt" }], actions: [action] } };
    vi.mocked(api.retryDrafts).mockResolvedValueOnce({ run_id: "run-a", groups: [group] }); await controller.loadRetryGroups();
    controller.state.admission = { protocol_version: 2, plan_id: "uncertain", digest: "old", client_request_id: "original-request", confirmed: true };
    expect(controller.startRetryGroup(group)).toBe(false); expect(controller.state.admission.client_request_id).toBe("original-request");
    controller.state.admission = null; controller.state.actions[0].version++; expect(controller.startRetryGroup(group)).toBe(false); expect(controller.state.error).toContain("精确版本"); expect(api.save).not.toHaveBeenCalled();
  });
  it("preserves the original V2 subject kind when saving a retry draft instead of re-inferring it from its extension", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/independent-workspace"); await flush(); await controller.selectRun("run-a");
    const action = syntheticTask().actions[0], group = { id: action.instance_id, action_instance_id: action.instance_id, action_key: action.key, action_title: "文件信息", action_version: action.version, scope: "file" as const, failed_steps: 1, available: true, draft: { name: "Explicit file retry", subjects: [{ kind: "file" as const, rel: "samples/Independent.FCStd" }], actions: [action] } };
    vi.mocked(api.retryDrafts).mockResolvedValueOnce({ run_id: "run-a", groups: [group] }); await controller.loadRetryGroups(); expect(controller.startRetryGroup(group)).toBe(true);
    await controller.save(); expect(vi.mocked(api.save).mock.calls[0][1].subjects).toEqual([{ kind: "file", rel: "samples/Independent.FCStd" }]); expect(api.admit).not.toHaveBeenCalled();
  });
  it("discards stale retry projections when selection or workspace changes", async () => {
    const { api, controller } = setup(); controller.setWorkspace("/one"); await flush(); await controller.selectRun("run-a");
    let resolve!: (value: Awaited<ReturnType<BatchTasksApi["retryDrafts"]>>) => void; vi.mocked(api.retryDrafts).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const loading = controller.loadRetryGroups(); controller.setWorkspace("/two"); await flush(); resolve({ run_id: "run-a", groups: [] }); await loading;
    expect(controller.state.retryRunId).toBe(""); expect(controller.state.retryGroups).toEqual([]); expect(controller.state.workspace).toBe("/two"); expect(api.save).not.toHaveBeenCalled();
  });
});
