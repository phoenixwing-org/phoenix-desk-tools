import { nextTick } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pnwReduceDockableToolState } from "phoenix-wing";
import { createBatchTasksApplication, PDT_BATCH_TASKS_AUTO_MONITOR_KEY } from "./application";
import { createBatchTasksController } from "./controller";
import type { BatchTasksApi } from "./api";
import { syntheticAction, syntheticPlan, syntheticRun, syntheticTask } from "./fixtures.test-support";

beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await nextTick(); };
function fixture(initial?: string) {
  const values = new Map<string, string>(initial ? [[PDT_BATCH_TASKS_AUTO_MONITOR_KEY, initial]] : []);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const api: BatchTasksApi = { actions: vi.fn().mockResolvedValue({ actions: [syntheticAction()] }), tasks: vi.fn().mockResolvedValue({ tasks: [syntheticTask()] }), runs: vi.fn().mockResolvedValue({ runs: [] }), detail: vi.fn().mockResolvedValue({ run: syntheticRun(), steps: [], events: [] }), save: vi.fn(), archive: vi.fn(), preview: vi.fn(), admit: vi.fn(), cancel: vi.fn(), byRequest: vi.fn(), backup: vi.fn(), retryDrafts: vi.fn() };
  const controller = createBatchTasksController(api, storage), app = createBatchTasksApplication(controller, storage);
  controller.setWorkspace("/independent-workspace"); return { api, controller, app, values, storage };
}
it("persists the default-on display switch without calling execution APIs", async () => {
  const f = fixture(); await flush(); expect(f.app.autoMonitorEnabled.value).toBe(true);
  f.app.setAutoMonitorEnabled(false); expect(JSON.parse(f.values.get(PDT_BATCH_TASKS_AUTO_MONITOR_KEY)!)).toEqual({ version: 1, enabled: false });
  const restored = createBatchTasksApplication(f.controller, f.storage); expect(restored.autoMonitorEnabled.value).toBe(false);
  expect(f.api.admit).not.toHaveBeenCalled(); expect(f.api.cancel).not.toHaveBeenCalled(); restored.dispose(); f.app.dispose();
});
it("a rejected admission does not open a monitor; a later accepted ledger run does", async () => {
  const f = fixture(); await flush(); f.controller.state.plan = syntheticPlan();
  vi.mocked(f.api.admit).mockRejectedValue(Object.assign(new Error("Independent rejection"), { status: 400 })); vi.mocked(f.api.byRequest).mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
  expect(await f.controller.admit()).toBe(false); await flush(); vi.advanceTimersByTime(3000); expect(f.app.toolState.value.mode).toBe("closed");
  f.controller.state.runs = [syntheticRun()]; await flush(); expect(f.app.toolState.value.mode).toBe("floating"); vi.advanceTimersByTime(2000); expect(f.app.toolState.value.mode).toBe("primary");
  expect(f.api.cancel).not.toHaveBeenCalled(); expect(f.api.admit).toHaveBeenCalledTimes(1); f.app.dispose();
});
it("manual application updates win over a pending automatic dock", async () => {
  const f = fixture(); await flush(); f.controller.state.runs = [syntheticRun()]; await flush();
  f.app.updateToolState(pnwReduceDockableToolState(f.app.toolState.value, { type: "close" })); await f.controller.refresh(); await flush(); vi.runAllTimers();
  expect(f.app.toolState.value.mode).toBe("closed"); expect(f.api.cancel).not.toHaveBeenCalled(); f.app.dispose();
});
