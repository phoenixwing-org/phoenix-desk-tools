import { describe, expect, it } from "vitest";
import { pnwIsDockableToolVisible, pnwReduceDockableToolState } from "phoenix-wing";
import { PDT_BATCH_TASKS_TOOL_DEFINITION, pdtCreateBatchTasksToolState, pdtToggleBatchTasksTool } from "./pdtBatchTasksDockableTool";
describe("batch task presentation only", () => {
  it("has one application-level mode and closing does not alter an independent run", () => {
    const run = { status: "running", cancel_requested: false };
    const floating = pdtToggleBatchTasksTool(pdtCreateBatchTasksToolState());
    expect(pnwIsDockableToolVisible(PDT_BATCH_TASKS_TOOL_DEFINITION, floating, "another-view")).toBe(true);
    const primary = pnwReduceDockableToolState(floating, { type: "dock-primary" });
    const closed = pdtToggleBatchTasksTool(primary);
    expect(closed.mode).toBe("closed"); expect(run).toEqual({ status: "running", cancel_requested: false });
    expect(pdtToggleBatchTasksTool(closed).floatingPosition).toEqual(floating.floatingPosition);
  });
});
