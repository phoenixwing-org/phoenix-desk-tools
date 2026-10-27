import { pnwNormalizeDockableToolState, pnwReduceDockableToolState, type PnwDockableToolDefinition, type PnwDockableToolState } from "phoenix-wing";

export const PDT_BATCH_TASKS_TOOL_STATE_KEY = "phoenix-desk.batch-tool.v1";
export const PDT_BATCH_TASKS_TOOL_DEFINITION = {
  id: "phoenix-desk.batch-tasks", title: "批量任务", ariaLabel: "批量任务监控", scope: "application",
  frame: { ownerKind: "tool", movable: true, resizable: "both", recommendedSize: { width: 420, height: 390 }, minSize: { width: 300, height: 260 }, maxSize: { width: 800, height: 760 }, rememberBounds: true, closeBehavior: "close" },
} as const satisfies PnwDockableToolDefinition;
export function pdtCreateBatchTasksToolState(stored?: Partial<PnwDockableToolState> | null) {
  return pnwNormalizeDockableToolState(stored ?? { mode: "closed", floatingPosition: { x: 64, y: 108 }, floatingSize: { width: 420, height: 390 }, primaryPlacement: "last", primaryExpanded: true });
}
/** A presentation command has no access to the task execution API. */
export function pdtToggleBatchTasksTool(state: PnwDockableToolState) {
  return pnwReduceDockableToolState(state, { type: state.mode === "closed" ? "open-floating" : "close" });
}
