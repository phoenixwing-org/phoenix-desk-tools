import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageSessionApi } from "../../composables/usePageSession";
import { registerPageSession, unregisterPageSession } from "../../composables/usePageSession";
import { createWorkbench } from "../../composables/useWorkbench";
import { createBatchTasksController, type BatchTasksController } from "./controller";
import type { BatchTasksApi } from "./api";
import { syntheticAction, syntheticPlan, syntheticRun, syntheticTask } from "./fixtures.test-support";

const view = vi.hoisted(() => ({ controller: undefined as unknown as BatchTasksController, session: undefined as PageSessionApi | undefined, prompt: vi.fn() }));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }) }));
vi.mock("phoenix-wing", () => ({ pnwPromptChoice: view.prompt }));
vi.mock("./application", async () => ({ batchTasksController: new Proxy({}, { get: (_target, key) => Reflect.get(view.controller, key) }),
  openBatchTasksTool: vi.fn(), batchTasksAutoMonitorEnabled: (await import("vue")).ref(true), setBatchTasksAutoMonitorEnabled: vi.fn() }));
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: () => undefined }));
vi.mock("../../composables/usePageSession", async original => ({ ...await original<typeof import("../../composables/usePageSession")>(),
  usePageSession: (_id: string, session: PageSessionApi) => { view.session = session; } }));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwSidebarBlock.vue", () => ({ default: {} }));
import BatchTasksPage from "./BatchTasksPage.vue";

// Independent DTOs and mocked APIs only: no real task ledger, browser or CAD.
let api: BatchTasksApi;
let storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
let memory: Map<string, string>;
const ids: string[] = [], scopes: EffectScope[] = [];
async function settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); }
function mountPage(workbench: ReturnType<typeof createWorkbench>) {
  const id = workbench.openTab({ pageId: "batch_tasks", title: "批量任务管理" }); ids.push(id);
  const scope = effectScope(); scopes.push(scope);
  scope.run(() => (BatchTasksPage as any).setup({ workbenchTabId: id }, { expose: () => undefined }));
  registerPageSession(id, view.session!);
  return id;
}
async function setup(tasks = [syntheticTask()]) {
  vi.mocked(api.tasks).mockResolvedValue({ tasks });
  view.controller.setWorkspace("/synthetic-workspace"); await settle();
  const workbench = createWorkbench(ref(null));
  const id = mountPage(workbench);
  return { workbench, id, controller: view.controller };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { confirm: vi.fn(() => { throw new Error("Batch close must not use window.confirm"); }) });
  api = {
    actions: vi.fn().mockResolvedValue({ actions: [syntheticAction()] }), tasks: vi.fn().mockResolvedValue({ tasks: [] }), runs: vi.fn().mockResolvedValue({ runs: [] }),
    save: vi.fn().mockResolvedValue({ task: syntheticTask({ revision: 2 }) }), archive: vi.fn(), preview: vi.fn().mockResolvedValue({ plan: syntheticPlan() }),
    admit: vi.fn(), detail: vi.fn(), retryDrafts: vi.fn(), cancel: vi.fn(), byRequest: vi.fn(), backup: vi.fn(),
  };
  memory = new Map(); storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); }, removeItem: key => { memory.delete(key); } };
  view.controller = createBatchTasksController(api, storage); view.session = undefined;
  view.prompt.mockResolvedValue({ choiceId: "cancel", checkedIds: [] });
});
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); ids.splice(0).forEach(unregisterPageSession); vi.unstubAllGlobals(); });

describe("batch task detail close flow", () => {
  it("closes an untouched empty page and an untouched new task without prompting or saving", async () => {
    expect(view.controller.dirty.value).toBe(false);
    const { controller, workbench, id } = await setup([]);
    expect(controller.dirty.value).toBe(false);
    expect(await workbench.closeTab(id)).toBe(true);
    const next = mountPage(workbench); controller.newTask();
    expect(controller.state.paths).toBe(""); expect(controller.dirty.value).toBe(false);
    expect(await workbench.closeTab(next)).toBe(true);
    expect(view.prompt).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
  });

  it("saves a valid edit and closes with one task-specific three-choice prompt", async () => {
    const { controller, workbench, id } = await setup(); controller.editName("Edited synthetic definition");
    vi.mocked(api.save).mockResolvedValueOnce({ task: syntheticTask({ revision: 2, name: "Edited synthetic definition" }) });
    view.prompt.mockResolvedValueOnce({ choiceId: "save", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(true);
    expect(controller.dirty.value).toBe(false); expect(workbench.tabs.value).toHaveLength(0);
    expect(view.prompt).toHaveBeenCalledOnce();
    const prompt = view.prompt.mock.calls[0][0];
    expect(prompt.choices.map((choice: any) => choice.label)).toEqual(["保存任务定义并关闭", "放弃草稿并关闭", "返回"]);
    expect(prompt.message).not.toContain("写入文件"); expect(prompt.defaultChoiceId).toBe("cancel");
    expect(api.save).toHaveBeenCalledExactlyOnceWith("/synthetic-workspace", expect.objectContaining({ name: "Edited synthetic definition" }), "task-a", 1, undefined);
    expect(api.preview).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });

  it.each(["invalid", "rejected"])("keeps the edited page and its error when saving is %s", async mode => {
    const { controller, workbench, id } = await setup();
    if (mode === "invalid") controller.editPaths("");
    else { controller.editName("Edited synthetic definition"); vi.mocked(api.save).mockRejectedValueOnce(new Error("Synthetic save failure")); }
    view.prompt.mockResolvedValueOnce({ choiceId: "save", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(false);
    expect(workbench.getTab(id)).toBeDefined(); expect(controller.dirty.value).toBe(true);
    expect(controller.state.error).toContain(mode === "invalid" ? "请填写至少一个" : "Synthetic save failure");
    expect(api.save).toHaveBeenCalledTimes(mode === "invalid" ? 0 : 1);
  });

  it("returns without touching the draft when the close prompt is cancelled", async () => {
    const { controller, workbench, id } = await setup(); controller.editName("Keep this edit");
    expect(await workbench.closeTab(id)).toBe(false);
    expect(controller.state.draft.name).toBe("Keep this edit"); expect(controller.dirty.value).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("discards only the editor and reopens clean while a background run continues", async () => {
    const { controller, workbench, id } = await setup();
    const run = syntheticRun({ status: "running" });
    controller.state.runs = [run]; controller.state.selectedRunId = run.id;
    controller.state.detail = { run, steps: [], events: [] }; controller.state.plan = syntheticPlan();
    controller.editName("Discard this edit");
    view.prompt.mockResolvedValueOnce({ choiceId: "discard", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(true);
    expect(controller.state.draft.name).toBe(syntheticTask().name); expect(controller.dirty.value).toBe(false);
    expect(controller.state.plan).toBeNull(); expect(controller.state.runs).toEqual([run]);
    expect(controller.state.detail).toEqual({ run, steps: [], events: [] }); expect(controller.state.selectedRunId).toBe(run.id);
    const next = mountPage(workbench);
    expect(await workbench.closeTab(next)).toBe(true); expect(view.prompt).toHaveBeenCalledOnce();
    expect(api.save).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });

  it("discards a new draft without polling or reopening resurrecting its edits", async () => {
    const { controller, workbench, id } = await setup([]); controller.newTask(); controller.editPaths("samples/discarded.txt");
    view.prompt.mockResolvedValueOnce({ choiceId: "discard", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(true); expect(controller.state.paths).toBe("");
    await controller.refresh();
    const next = mountPage(workbench); expect(controller.dirty.value).toBe(false);
    expect(await workbench.closeTab(next)).toBe(true); expect(view.prompt).toHaveBeenCalledOnce();
    expect(api.save).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });

  it("keeps an uncertain creation pointer through discard and offers read-only lookup after reopening", async () => {
    const { controller, workbench, id } = await setup([]); controller.newTask(); controller.editPaths("samples/uncertain.txt");
    vi.mocked(api.save).mockRejectedValueOnce(new Error("Synthetic response lost"));
    expect(await controller.save()).toBe(false);
    const pointer = { id: controller.state.creationId, fingerprint: controller.state.creationFingerprint }, saved = [...memory];
    view.prompt.mockResolvedValueOnce({ choiceId: "save", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(false); expect(api.save).toHaveBeenCalledOnce();
    expect(view.prompt.mock.calls[0][0].choices.find((choice: any) => choice.id === "save").disabled).toBe(true);
    view.prompt.mockResolvedValueOnce({ choiceId: "discard", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(true);
    mountPage(workbench);
    expect(controller.state.creationUncertain).toBe(true); expect(controller.state.creationId).toBe(pointer.id);
    expect(controller.state.creationFingerprint).toBe(pointer.fingerprint); expect([...memory]).toEqual(saved);
    expect(controller.state.paths).toBe(""); expect(controller.dirty.value).toBe(false);
    await view.session!.refresh!();
    expect(controller.state.creationId).toBe(pointer.id); expect([...memory]).toEqual(saved);
    const restored = createBatchTasksController(api, storage); restored.setWorkspace("/synthetic-workspace"); await settle();
    expect(restored.state.creationId).toBe(pointer.id); expect(restored.state.creationUncertain).toBe(true);
    expect(api.save).toHaveBeenCalledOnce(); expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });

  it("retains the exact uncertain admission and recovers the original run after discard", async () => {
    const { controller, workbench, id } = await setup(); await controller.preview();
    vi.mocked(api.admit).mockRejectedValueOnce(new Error("Synthetic admission response lost"));
    expect(await controller.admit()).toBe(false);
    const admission = structuredClone({ ...controller.state.admission! }), saved = [...memory];
    controller.editName("Discard local changes, not the admitted request");
    view.prompt.mockResolvedValueOnce({ choiceId: "discard", checkedIds: [] });
    expect(await workbench.closeTab(id)).toBe(true); mountPage(workbench);
    expect(controller.state.admission).toEqual(admission); expect([...memory]).toEqual(saved); expect(controller.state.plan).toBeNull();
    expect(api.admit).toHaveBeenCalledOnce(); expect(api.save).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
    vi.mocked(api.byRequest).mockResolvedValueOnce({ run: syntheticRun({ client_request_id: admission.client_request_id }) });
    expect(await controller.recoverAdmission()).toBe(true);
    expect(api.byRequest).toHaveBeenCalledExactlyOnceWith("/synthetic-workspace", admission.client_request_id);
    expect(controller.state.admission).toBeNull(); expect(controller.state.runs).toHaveLength(1);
  });

  it("refuses to discard while busy or after the close prompt changes workspace", async () => {
    const { controller, workbench, id } = await setup(); controller.editName("Retain edit");
    controller.state.pending = "preview";
    expect(controller.discardDraft()).toBe(false); expect(await workbench.closeTab(id)).toBe(false);
    expect(view.prompt).not.toHaveBeenCalled(); expect(controller.state.draft.name).toBe("Retain edit");
    controller.state.pending = "";
    view.prompt.mockImplementationOnce(async () => { controller.state.pending = "preview"; return { choiceId: "discard", checkedIds: [] }; });
    expect(await workbench.closeTab(id)).toBe(false); expect(controller.state.draft.name).toBe("Retain edit");
    controller.state.pending = "";
    view.prompt.mockImplementationOnce(async () => { controller.setWorkspace("/other-synthetic-workspace"); return { choiceId: "discard", checkedIds: [] }; });
    expect(await workbench.closeTab(id)).toBe(false); expect(workbench.getTab(id)).toBeDefined();
    expect(api.save).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
});
