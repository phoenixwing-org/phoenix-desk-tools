import { ref, watch } from "vue";
import { pnwNormalizeDockableToolState, pnwReduceDockableToolState, type PnwDockableToolState } from "phoenix-wing";
import { pdtCreateBatchTasksToolState, PDT_BATCH_TASKS_TOOL_STATE_KEY } from "../../workbench/pdtBatchTasksDockableTool";
import { createBatchTasksController, type BatchTasksController } from "./controller";
import { createBatchTasksAutoMonitor, type BatchAutoMonitorTimer } from "./autoMonitor";

const storage = typeof window === "undefined" ? undefined : (() => { try { return window.localStorage; } catch { return undefined; } })();
export const PDT_BATCH_TASKS_AUTO_MONITOR_KEY = "phoenix-desk.batch-tool.auto-monitor.v1";
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createBatchTasksApplication(controller: BatchTasksController, preferences?: StoragePort, timer?: BatchAutoMonitorTimer) {
  function readToolState() {
    try { return pdtCreateBatchTasksToolState(JSON.parse(preferences?.getItem(PDT_BATCH_TASKS_TOOL_STATE_KEY) ?? "null")); }
    catch { return pdtCreateBatchTasksToolState(); }
  }
  function readAutoMonitor() {
    try { const value = JSON.parse(preferences?.getItem(PDT_BATCH_TASKS_AUTO_MONITOR_KEY) ?? "null"); return value?.version === 1 && typeof value.enabled === "boolean" ? value.enabled : true; }
    catch { return true; }
  }
  const toolState = ref(readToolState()), autoMonitorEnabled = ref(readAutoMonitor());
  function present(state: PnwDockableToolState) {
    toolState.value = pnwNormalizeDockableToolState(state);
    try { preferences?.setItem(PDT_BATCH_TASKS_TOOL_STATE_KEY, JSON.stringify(toolState.value)); } catch { /* Display preference only. */ }
  }
  const monitor = createBatchTasksAutoMonitor({ toolState: () => toolState.value, present,
    selectRun: id => { void controller.selectRun(id); }, timer });
  monitor.setEnabled(autoMonitorEnabled.value);
  const stopObserving = watch(() => ({ workspace: controller.state.workspace, runs: controller.state.runs.map(run => ({ id: run.id, status: run.status })), stale: controller.state.stale }), value => monitor.observe(value), { immediate: true, flush: "post" });
  function updateToolState(state: PnwDockableToolState) { monitor.manualChange(); present(state); }
  function setAutoMonitorEnabled(value: boolean) {
    autoMonitorEnabled.value = value; monitor.setEnabled(value);
    try { preferences?.setItem(PDT_BATCH_TASKS_AUTO_MONITOR_KEY, JSON.stringify({ version: 1, enabled: value })); } catch { /* Preference only. */ }
  }
  function openTool() { updateToolState(pnwReduceDockableToolState(toolState.value, { type: "open-floating" })); }
  return { controller, toolState, autoMonitorEnabled, updateToolState, setAutoMonitorEnabled, openTool,
    dispose() { stopObserving(); monitor.dispose(); } };
}
const application = createBatchTasksApplication(createBatchTasksController(undefined, storage), storage);
export const batchTasksController = application.controller;
export const batchTasksToolState = application.toolState;
export const batchTasksAutoMonitorEnabled = application.autoMonitorEnabled;
export const updateBatchTasksToolState = application.updateToolState;
export const setBatchTasksAutoMonitorEnabled = application.setAutoMonitorEnabled;
export const openBatchTasksTool = application.openTool;
